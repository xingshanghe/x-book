//! 朗读引擎只在用户确认后下载到应用数据目录，不打进安装包。

use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::thread;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

static CANCELLED: AtomicBool = AtomicBool::new(false);
static DOWNLOAD_PID: AtomicU32 = AtomicU32::new(0);

#[derive(Deserialize)]
pub(crate) struct EngineFileSpec {
    name: String,
    url: String,
    sha256: String,
    #[serde(default)]
    bytes: u64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DownloadProgress {
    name: String,
    received: u64,
    total: u64,
    index: usize,
    count: usize,
    stage: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SpeakRequest {
    version: String,
    text: String,
    ref_text: String,
    builtin_file: Option<String>,
    ref_wav: Option<Vec<u8>>,
}

fn safe_version(version: &str) -> Result<(), String> {
    if version.is_empty() || version.contains("..") || version.contains('/') || version.contains('\\') {
        return Err("版本号不合法".into());
    }
    Ok(())
}

fn engine_dir(app: &AppHandle, version: &str) -> Result<PathBuf, String> {
    safe_version(version)?;
    let root = app.path().app_data_dir().map_err(|err| err.to_string())?;
    Ok(root.join("tts").join("engine").join(version))
}

#[tauri::command]
pub fn tts_cancel_download() {
    CANCELLED.store(true, Ordering::SeqCst);
    let pid = DOWNLOAD_PID.swap(0, Ordering::SeqCst);
    if pid > 0 {
        let _ = Command::new("kill").arg(pid.to_string()).status();
    }
}

#[tauri::command]
pub fn tts_download_engine(app: AppHandle, version: String, files: Vec<EngineFileSpec>) -> Result<(), String> {
    if files.is_empty() {
        return Err("引擎清单是空的".into());
    }
    CANCELLED.store(false, Ordering::SeqCst);
    let dir = engine_dir(&app, &version)?;
    fs::create_dir_all(&dir).map_err(|err| err.to_string())?;
    let grand = files.iter().map(|file| file.bytes).sum::<u64>().max(1);
    let mut done_before = 0u64;
    for (index, file) in files.iter().enumerate() {
        validate_file(file)?;
        download_file(&app, &dir, file, index, files.len(), done_before, grand)?;
        done_before = done_before.saturating_add(file.bytes);
    }
    fs::write(dir.join("installed.json"), format!(r#"{{"version":"{version}"}}"#)).map_err(|err| err.to_string())?;
    Ok(())
}

fn validate_file(file: &EngineFileSpec) -> Result<(), String> {
    if file.sha256.len() != 64 || !file.sha256.chars().all(|ch| ch.is_ascii_hexdigit()) {
        return Err("引擎清单还没有校验值，暂不能下载".into());
    }
    if file.name.contains("..") || file.name.contains('/') || file.name.contains('\\') {
        return Err("文件名不合法".into());
    }
    if !allowed_download_url(&file.url) {
        return Err("下载地址不在允许的发布源里".into());
    }
    Ok(())
}

fn download_file(
    app: &AppHandle,
    dir: &Path,
    file: &EngineFileSpec,
    index: usize,
    count: usize,
    done_before: u64,
    grand: u64,
) -> Result<(), String> {
    let part = dir.join(format!("{}.part", file.name));
    let dest = dir.join(&file.name);
    if dest.is_file() && sha256_file(&dest)?.eq_ignore_ascii_case(&file.sha256) {
        unpack_archive(dir, file, &dest)?;
        emit_progress(app, file, index, count, done_before.saturating_add(file.bytes), grand, "verifying");
        return Ok(());
    }
    let _ = fs::remove_file(&dest);
    if cancelled() {
        return Err("已取消".into());
    }
    let mut child = Command::new("curl")
        .args(["-L", "--fail", "--retry", "3", "--retry-delay", "1", "--continue-at", "-", "-o"])
        .arg(&part)
        .arg(&file.url)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|err| format!("无法启动下载：{err}"))?;
    DOWNLOAD_PID.store(child.id(), Ordering::SeqCst);
    let status = loop {
        let received = fs::metadata(&part).map(|meta| meta.len()).unwrap_or(0);
        emit_progress(app, file, index, count, done_before.saturating_add(received), grand, "downloading");
        if cancelled() {
            let _ = child.kill();
            let _ = child.wait();
            DOWNLOAD_PID.store(0, Ordering::SeqCst);
            return Err("已取消".into());
        }
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) => thread::sleep(Duration::from_millis(200)),
            Err(err) => {
                DOWNLOAD_PID.store(0, Ordering::SeqCst);
                return Err(err.to_string());
            }
        }
    };
    DOWNLOAD_PID.store(0, Ordering::SeqCst);
    if cancelled() {
        return Err("已取消".into());
    }
    if !status.success() {
        let len = fs::metadata(&part).map(|meta| meta.len()).unwrap_or(0);
        if file.bytes > 0 && len >= file.bytes {
            let _ = fs::remove_file(&part);
            return Err("下载不完整，请再试一次".into());
        }
        return Err("下载没有完成，已保留进度，可以继续".into());
    }
    emit_progress(app, file, index, count, done_before.saturating_add(file.bytes.max(1)), grand, "verifying");
    let sum = sha256_file(&part)?;
    if !sum.eq_ignore_ascii_case(&file.sha256) {
        let _ = fs::remove_file(&part);
        return Err("校验不一致，已删除未完成的文件".into());
    }
    fs::rename(&part, &dest).map_err(|err| err.to_string())?;
    unpack_archive(dir, file, &dest)?;
    Ok(())
}

fn unpack_archive(dir: &Path, file: &EngineFileSpec, dest: &Path) -> Result<(), String> {
    if !file.name.ends_with(".tar.bz2") {
        return Ok(());
    }
    let unpacked = Command::new("tar")
        .arg("-xf")
        .arg(dest)
        .current_dir(dir)
        .status()
        .map_err(|err| err.to_string())?;
    if unpacked.success() {
        Ok(())
    } else {
        Err("解压引擎包失败".into())
    }
}

fn emit_progress(app: &AppHandle, file: &EngineFileSpec, index: usize, count: usize, received: u64, total: u64, stage: &str) {
    let _ = app.emit(
        "tts-download-progress",
        DownloadProgress {
            name: file.name.clone(),
            received: received.min(total),
            total,
            index,
            count,
            stage: stage.to_string(),
        },
    );
}

fn cancelled() -> bool {
    CANCELLED.load(Ordering::SeqCst)
}

#[tauri::command]
pub fn tts_delete_engine(app: AppHandle, version: String) -> Result<(), String> {
    let dir = engine_dir(&app, &version)?;
    if dir.exists() {
        fs::remove_dir_all(&dir).map_err(|err| err.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn tts_speak(app: AppHandle, request: SpeakRequest) -> Result<Vec<u8>, String> {
    let dir = engine_dir(&app, &request.version)?;
    if !dir.join("installed.json").exists() {
        return Err("请先下载朗读引擎".into());
    }
    let binary = find_binary(&dir).ok_or("引擎包里还没有 sherpa-onnx-offline-tts")?;
    let ref_path = if let Some(rel) = request.builtin_file.as_deref() {
        let path = dir.join(rel);
        if !path.starts_with(&dir) {
            return Err("示例音色路径不合法".into());
        }
        path
    } else {
        let bytes = request.ref_wav.ok_or("缺少参考音频")?;
        let path = dir.join("ref-user.wav");
        fs::write(&path, bytes).map_err(|err| err.to_string())?;
        path
    };
    let out = dir.join("last-sentence.wav");
    let encoder = find_file(&dir, "encoder.int8.onnx").ok_or("缺少 encoder.int8.onnx")?;
    let decoder = find_file(&dir, "decoder.int8.onnx").ok_or("缺少 decoder.int8.onnx")?;
    let vocoder = find_file(&dir, "vocos_24khz.onnx").ok_or("缺少 vocos_24khz.onnx")?;
    let lexicon = find_file(&dir, "lexicon.txt").ok_or("缺少 lexicon.txt")?;
    let tokens = find_file(&dir, "tokens.txt").ok_or("缺少 tokens.txt")?;
    let data_dir = find_dir(&dir, "espeak-ng-data").ok_or("缺少 espeak-ng-data")?;
    let status = Command::new(&binary)
        .arg(format!("--zipvoice-encoder={}", encoder.display()))
        .arg(format!("--zipvoice-decoder={}", decoder.display()))
        .arg(format!("--zipvoice-data-dir={}", data_dir.display()))
        .arg(format!("--zipvoice-lexicon={}", lexicon.display()))
        .arg(format!("--zipvoice-tokens={}", tokens.display()))
        .arg(format!("--zipvoice-vocoder={}", vocoder.display()))
        .arg(format!("--reference-audio={}", ref_path.display()))
        .arg(format!("--reference-text={}", request.ref_text))
        .arg("--num-steps=4")
        .arg(format!("--output-filename={}", out.display()))
        .arg(&request.text)
        .status()
        .map_err(|err| format!("无法启动朗读引擎：{err}"))?;
    if !status.success() {
        return Err("这一句没有合成出来".into());
    }
    fs::read(&out).map_err(|err| err.to_string())
}

fn allowed_download_url(url: &str) -> bool {
    const HOSTS: [&str; 5] = [
        "http://118.25.79.136/",
        "https://github.com/",
        "https://objects.githubusercontent.com/",
        "https://release-assets.githubusercontent.com/",
        "https://github-releases.githubusercontent.com/",
    ];
    HOSTS.iter().any(|prefix| url.starts_with(prefix))
}

fn sha256_file(path: &Path) -> Result<String, String> {
    let output = Command::new("shasum")
        .args(["-a", "256"])
        .arg(path)
        .output()
        .map_err(|err| format!("无法校验文件：{err}"))?;
    if !output.status.success() {
        return Err("无法校验文件".into());
    }
    let text = String::from_utf8_lossy(&output.stdout);
    text.split_whitespace()
        .next()
        .map(str::to_string)
        .ok_or_else(|| "无法校验文件".into())
}

fn find_binary(dir: &Path) -> Option<PathBuf> {
    find_file(dir, "sherpa-onnx-offline-tts")
}

fn find_file(dir: &Path, name: &str) -> Option<PathBuf> {
    let mut stack = vec![dir.to_path_buf()];
    while let Some(current) = stack.pop() {
        let Ok(entries) = fs::read_dir(&current) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
            } else if path.file_name().and_then(|item| item.to_str()) == Some(name) {
                return Some(path);
            }
        }
    }
    None
}

fn find_dir(dir: &Path, name: &str) -> Option<PathBuf> {
    let mut stack = vec![dir.to_path_buf()];
    while let Some(current) = stack.pop() {
        let Ok(entries) = fs::read_dir(&current) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                if path.file_name().and_then(|item| item.to_str()) == Some(name) {
                    return Some(path);
                }
                stack.push(path);
            }
        }
    }
    None
}
