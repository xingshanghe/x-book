//! 朗读引擎只在用户确认后下载到应用数据目录，不打进安装包。

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::thread;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

static CANCELLED: AtomicBool = AtomicBool::new(false);
static DOWNLOAD_PID: AtomicU32 = AtomicU32::new(0);
static SPEAKING: AtomicU32 = AtomicU32::new(0);
static FILE_SEQ: AtomicU64 = AtomicU64::new(1);
const SPEAK_LIMIT: u32 = 2;

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
    #[serde(default)]
    silence_scale: f32,
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
pub async fn tts_download_engine(
    app: AppHandle,
    version: String,
    files: Vec<EngineFileSpec>,
) -> Result<(), String> {
    // 命令本身立刻返回，真正的下载、校验和等待都在阻塞线程池里，不占主线程。
    tauri::async_runtime::spawn_blocking(move || run_download(app, version, files))
        .await
        .map_err(|err| format!("下载任务中断：{err}"))?
}

fn run_download(app: AppHandle, version: String, files: Vec<EngineFileSpec>) -> Result<(), String> {
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
    fs::write(
        dir.join("installed.json"),
        format!(r#"{{"version":"{version}"}}"#),
    )
    .map_err(|err| err.to_string())?;
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
    if !unpacked.success() {
        return Err("解压引擎包失败".into());
    }
    let _ = Command::new("xattr")
        .args(["-dr", "com.apple.quarantine"])
        .arg(dir)
        .status();
    if let Some(binary) = find_binary(dir) {
        let _ = Command::new("chmod").args(["a+x"]).arg(&binary).status();
    }
    Ok(())
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
pub async fn tts_speak(app: AppHandle, request: SpeakRequest) -> Result<Vec<u8>, String> {
    tauri::async_runtime::spawn_blocking(move || speak_blocking(app, request))
        .await
        .map_err(|err| format!("朗读任务中断：{err}"))?
}

fn speak_blocking(app: AppHandle, request: SpeakRequest) -> Result<Vec<u8>, String> {
    let _slot = SpeakSlot::enter();
    let dir = engine_dir(&app, &request.version)?;
    if !dir.join("installed.json").exists() {
        return Err("请先下载朗读引擎".into());
    }
    let binary = find_binary(&dir).ok_or("引擎包里还没有 sherpa-onnx-offline-tts")?;
    let seq = FILE_SEQ.fetch_add(1, Ordering::Relaxed);
    let owned_ref = if let Some(rel) = request.builtin_file.as_deref() {
        let path = dir.join(rel);
        if !path.starts_with(&dir) {
            return Err("示例音色路径不合法".into());
        }
        None
    } else {
        let bytes = request.ref_wav.ok_or("缺少参考音频")?;
        let path = dir.join(format!("ref-{seq}.wav"));
        fs::write(&path, bytes).map_err(|err| err.to_string())?;
        Some(RemoveOnDrop(path))
    };
    let ref_path = match &owned_ref {
        Some(path) => path.path().to_path_buf(),
        None => dir.join(request.builtin_file.as_deref().unwrap_or("")),
    };
    let out = RemoveOnDrop(dir.join(format!("sentence-{seq}.wav")));
    let encoder = find_file(&dir, "encoder.int8.onnx").ok_or("缺少 encoder.int8.onnx")?;
    let decoder = find_file(&dir, "decoder.int8.onnx").ok_or("缺少 decoder.int8.onnx")?;
    let vocoder = find_file(&dir, "vocos_24khz.onnx").ok_or("缺少 vocos_24khz.onnx")?;
    let lexicon = find_file(&dir, "lexicon.txt").ok_or("缺少 lexicon.txt")?;
    let tokens = find_file(&dir, "tokens.txt").ok_or("缺少 tokens.txt")?;
    let scale = if request.silence_scale > 0.0 {
        request.silence_scale
    } else {
        1.0
    };
    let scale = scale.clamp(0.2, 1.8);
    let mut cmd = Command::new(&binary);
    cmd.arg(format!("--zipvoice-encoder={}", encoder.display()))
        .arg(format!("--zipvoice-decoder={}", decoder.display()))
        .arg(format!("--zipvoice-lexicon={}", lexicon.display()))
        .arg(format!("--zipvoice-tokens={}", tokens.display()))
        .arg(format!("--zipvoice-vocoder={}", vocoder.display()))
        .arg(format!("--reference-audio={}", ref_path.display()))
        .arg(format!("--reference-text={}", request.ref_text))
        .arg("--num-steps=4")
        .arg(format!("--num-threads={}", synth_threads()))
        .arg(format!("--tts-silence-scale={scale:.2}"))
        .arg(format!("--output-filename={}", out.path().display()))
        .arg(&request.text);
    if let Some(lib) = find_file(&dir, "libonnxruntime.dylib").and_then(|path| path.parent().map(Path::to_path_buf)) {
        cmd.env("DYLD_LIBRARY_PATH", lib);
    }
    let output = cmd.output().map_err(|err| format!("无法启动朗读引擎：{err}"))?;
    if !output.status.success() {
        let detail = String::from_utf8_lossy(&output.stderr);
        let detail = detail.trim();
        if detail.is_empty() {
            return Err("这一句没有合成出来".into());
        }
        let clipped = detail.chars().rev().take(160).collect::<String>().chars().rev().collect::<String>();
        return Err(format!("这一句没有合成出来：{clipped}"));
    }
    fs::read(out.path()).map_err(|err| err.to_string())
}

fn synth_threads() -> usize {
    let cores = std::thread::available_parallelism().map(|count| count.get()).unwrap_or(4);
    (cores / SPEAK_LIMIT as usize).clamp(2, 4)
}

struct SpeakSlot;

impl SpeakSlot {
    fn enter() -> Self {
        loop {
            let now = SPEAKING.load(Ordering::SeqCst);
            if now >= SPEAK_LIMIT {
                thread::sleep(Duration::from_millis(12));
                continue;
            }
            if SPEAKING
                .compare_exchange(now, now + 1, Ordering::SeqCst, Ordering::SeqCst)
                .is_ok()
            {
                return Self;
            }
        }
    }
}

impl Drop for SpeakSlot {
    fn drop(&mut self) {
        SPEAKING.fetch_sub(1, Ordering::SeqCst);
    }
}

struct RemoveOnDrop(PathBuf);

impl RemoveOnDrop {
    fn path(&self) -> &Path {
        &self.0
    }
}

impl Drop for RemoveOnDrop {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AccountHttpRequest {
    method: String,
    url: String,
    body_base64: Option<String>,
    headers: HashMap<String, String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AccountHttpResponse {
    status: u16,
    body: String,
}

#[tauri::command]
pub async fn account_http(request: AccountHttpRequest) -> Result<AccountHttpResponse, String> {
    tauri::async_runtime::spawn_blocking(move || account_http_blocking(request))
        .await
        .map_err(|err| format!("连不上账号服务：{err}"))?
}

fn account_http_blocking(request: AccountHttpRequest) -> Result<AccountHttpResponse, String> {
    let method = request.method.to_ascii_uppercase();
    if method != "GET" && method != "POST" && method != "DELETE" {
        return Err("不支持的账号请求".into());
    }
    if !account_url_allowed(&request.url) {
        return Err("账号服务地址不正确".into());
    }
    let body = match request.body_base64.as_deref() {
        Some(raw) if !raw.is_empty() => Some(decode_base64(raw)?),
        _ => None,
    };
    if body.as_ref().is_some_and(|bytes| bytes.len() > 8 * 1024 * 1024) {
        return Err("上传内容太大".into());
    }
    let seq = FILE_SEQ.fetch_add(1, Ordering::Relaxed);
    let body_file = RemoveOnDrop(std::env::temp_dir().join(format!("qingyue-account-{seq}.bin")));
    let out_file = RemoveOnDrop(std::env::temp_dir().join(format!("qingyue-account-{seq}.out")));
    if let Some(bytes) = &body {
        fs::write(body_file.path(), bytes).map_err(|err| err.to_string())?;
    }
    let mut cmd = Command::new("curl");
    cmd.args([
        "-sS",
        "--proto",
        "=http,https",
        "--proto-redir",
        "=http,https",
        "--max-time",
        "40",
        "-o",
    ])
    .arg(out_file.path())
    .args(["-w", "%{http_code}", "-X", &method]);
    for (name, value) in &request.headers {
        if !account_header_allowed(name) || value.contains('\n') || value.contains('\r') || value.len() > 4096 {
            continue;
        }
        cmd.arg("-H").arg(format!("{name}: {value}"));
    }
    if body.is_some() {
        cmd.arg("--data-binary").arg(format!("@{}", body_file.path().display()));
    }
    cmd.arg(&request.url);
    let output = cmd.output().map_err(|_| "连不上账号服务".to_string())?;
    if !output.status.success() {
        return Err("连不上账号服务".into());
    }
    let status = String::from_utf8_lossy(&output.stdout)
        .trim()
        .parse::<u16>()
        .unwrap_or(0);
    if status == 0 {
        return Err("连不上账号服务".into());
    }
    let payload = fs::read(out_file.path()).unwrap_or_default();
    let text = String::from_utf8_lossy(&payload).into_owned();
    Ok(AccountHttpResponse { status, body: text })
}

fn account_url_allowed(url: &str) -> bool {
    if url.len() > 2000 || url.starts_with('-') || url.chars().any(|ch| ch.is_control()) {
        return false;
    }
    let rest = url
        .strip_prefix("https://")
        .or_else(|| url.strip_prefix("http://"));
    matches!(rest, Some(host) if !host.is_empty() && !host.starts_with('/'))
}

fn account_header_allowed(name: &str) -> bool {
    let name = name.to_ascii_lowercase();
    name == "content-type" || name == "authorization"
}

fn decode_base64(input: &str) -> Result<Vec<u8>, String> {
    fn value(byte: u8) -> Result<u8, String> {
        match byte {
            b'A'..=b'Z' => Ok(byte - b'A'),
            b'a'..=b'z' => Ok(byte - b'a' + 26),
            b'0'..=b'9' => Ok(byte - b'0' + 52),
            b'+' => Ok(62),
            b'/' => Ok(63),
            _ => Err("请求内容无法解析".into()),
        }
    }
    let cleaned: Vec<u8> = input.bytes().filter(|byte| !byte.is_ascii_whitespace()).collect();
    if cleaned.is_empty() || cleaned.len() % 4 != 0 {
        return Err("请求内容无法解析".into());
    }
    let mut out = Vec::with_capacity(cleaned.len() / 4 * 3);
    for chunk in cleaned.chunks(4) {
        let mut pad = 0;
        let mut vals = [0u8; 4];
        for (index, &byte) in chunk.iter().enumerate() {
            if byte == b'=' {
                pad += 1;
                continue;
            }
            if pad > 0 {
                return Err("请求内容无法解析".into());
            }
            vals[index] = value(byte)?;
        }
        if pad > 2 {
            return Err("请求内容无法解析".into());
        }
        let packed = ((vals[0] as u32) << 18)
            | ((vals[1] as u32) << 12)
            | ((vals[2] as u32) << 6)
            | (vals[3] as u32);
        out.push((packed >> 16) as u8);
        if pad < 2 {
            out.push((packed >> 8) as u8);
        }
        if pad < 1 {
            out.push(packed as u8);
        }
    }
    Ok(out)
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

#[cfg(test)]
mod tests {
    use super::{account_header_allowed, account_url_allowed, decode_base64};

    #[test]
    fn account_url_accepts_the_enroll_host() {
        assert!(account_url_allowed("http://118.25.79.136/v1/auth/login"));
        assert!(account_url_allowed("https://enroll.example/v1/auth/me"));
        assert!(!account_url_allowed("file:///etc/passwd"));
        assert!(!account_url_allowed("-http://evil"));
        assert!(!account_url_allowed("http://"));
    }

    #[test]
    fn account_headers_stay_on_the_auth_request() {
        assert!(account_header_allowed("Content-Type"));
        assert!(account_header_allowed("Authorization"));
        assert!(!account_header_allowed("Cookie"));
    }

    #[test]
    fn base64_roundtrip_matches_login_json() {
        let decoded = decode_base64("aGVsbG8=").expect("decode");
        assert_eq!(decoded, b"hello");
    }
}
