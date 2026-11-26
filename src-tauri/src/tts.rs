//! 朗读引擎只在用户确认后下载到应用数据目录，不打进安装包。

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::thread;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

use crate::tts_runtime::{
    clear_download_mark, configure_runtime_libs, find_binary, find_file, mark_executable, sha256_file,
    stop_pid, tool,
};

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
    /// 主地址没有这份文件时再试。两边必须是同一份字节。
    #[serde(default, rename = "fallbackUrl")]
    fallback_url: Option<String>,
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
    /// 用户注音。引擎先载入这份，同词的原读音会被略过。
    #[serde(default)]
    pronunciations: Vec<PronunciationEntry>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PronunciationEntry {
    word: String,
    phones: String,
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
    stop_pid(pid);
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
    if let Some(fallback) = file.fallback_url.as_deref() {
        if !fallback.is_empty() && !allowed_download_url(fallback) {
            return Err("下载地址不在允许的发布源里".into());
        }
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
    let dest = dir.join(&file.name);
    if dest.is_file() && sha256_file(&dest)?.eq_ignore_ascii_case(&file.sha256) {
        unpack_archive(dir, file, &dest)?;
        emit_progress(app, file, index, count, done_before.saturating_add(file.bytes), grand, "verifying");
        return Ok(());
    }
    let _ = fs::remove_file(&dest);
    let urls = source_urls(file);
    let mut last = "下载没有完成".to_string();
    for (attempt, url) in urls.iter().enumerate() {
        match download_from(app, dir, file, url, index, count, done_before, grand) {
            Ok(()) => return Ok(()),
            Err(err) if err == "已取消" => return Err(err),
            Err(err) => {
                last = err;
                let received = fs::metadata(part_path(dir, file)).map(|meta| meta.len()).unwrap_or(0);
                if received >= 4_096 || attempt + 1 == urls.len() {
                    return Err(last);
                }
            }
        }
    }
    Err(last)
}

fn source_urls(file: &EngineFileSpec) -> Vec<&str> {
    let mut urls = vec![file.url.as_str()];
    if let Some(fallback) = file.fallback_url.as_deref() {
        if !fallback.is_empty() && fallback != file.url {
            urls.push(fallback);
        }
    }
    urls
}

fn part_path(dir: &Path, file: &EngineFileSpec) -> PathBuf {
    dir.join(format!("{}.part", file.name))
}

fn part_marker(dir: &Path, file: &EngineFileSpec) -> PathBuf {
    dir.join(format!("{}.part.from", file.name))
}

/// 换了下载地址就丢掉上一个地址留下的半截文件，避免续传拼到另一份内容上。
fn prepare_part(dir: &Path, file: &EngineFileSpec, url: &str) -> Result<PathBuf, String> {
    let part = part_path(dir, file);
    let marker = part_marker(dir, file);
    let previous = fs::read_to_string(&marker).unwrap_or_default();
    if previous.trim() != url {
        let _ = fs::remove_file(&part);
        fs::write(&marker, url).map_err(|err| err.to_string())?;
    }
    Ok(part)
}

fn download_from(
    app: &AppHandle,
    dir: &Path,
    file: &EngineFileSpec,
    url: &str,
    index: usize,
    count: usize,
    done_before: u64,
    grand: u64,
) -> Result<(), String> {
    let part = prepare_part(dir, file, url)?;
    let dest = dir.join(&file.name);
    if cancelled() {
        return Err("已取消".into());
    }
    let mut child = tool("curl")
        .args(["-L", "--fail", "--retry", "3", "--retry-delay", "1", "--continue-at", "-", "-o"])
        .arg(&part)
        .arg(url)
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
    let _ = fs::remove_file(part_marker(dir, file));
    unpack_archive(dir, file, &dest)?;
    Ok(())
}

fn unpack_archive(dir: &Path, file: &EngineFileSpec, dest: &Path) -> Result<(), String> {
    if !file.name.ends_with(".tar.bz2") {
        return Ok(());
    }
    let unpacked = tool("tar")
        .arg("-xf")
        .arg(dest)
        .current_dir(dir)
        .status()
        .map_err(|err| format!("解压引擎包失败：{err}"))?;
    if !unpacked.success() {
        return Err("解压引擎包失败".into());
    }
    clear_download_mark(dir);
    if let Some(binary) = find_binary(dir) {
        mark_executable(&binary);
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
    let (lexicon_arg, _user_lexicon) =
        prepare_user_lexicon(&dir, seq, &lexicon, &request.pronunciations)?;
    let scale = if request.silence_scale > 0.0 {
        request.silence_scale
    } else {
        1.0
    };
    let scale = scale.clamp(0.2, 1.8);
    let mut cmd = tool(binary);
    cmd.arg(format!("--zipvoice-encoder={}", encoder.display()))
        .arg(format!("--zipvoice-decoder={}", decoder.display()))
        .arg(format!("--zipvoice-lexicon={lexicon_arg}"))
        .arg(format!("--zipvoice-tokens={}", tokens.display()))
        .arg(format!("--zipvoice-vocoder={}", vocoder.display()))
        .arg(format!("--reference-audio={}", ref_path.display()))
        .arg(format!("--reference-text={}", request.ref_text))
        .arg("--num-steps=4")
        .arg(format!("--num-threads={}", synth_threads()))
        .arg(format!("--tts-silence-scale={scale:.2}"))
        .arg(format!("--output-filename={}", out.path().display()))
        .arg(&request.text);
    configure_runtime_libs(&mut cmd, &dir);
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
    let mut cmd = tool("curl");
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

/// 云书架请求：桌面壳里 WebView 直连 http:// 会被系统拦住（表现就是 Load failed），
/// 跟账号一样改走本机 curl。响应一律 base64，避免 PDF 被当成 UTF-8 弄坏。
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CloudHttpRequest {
    method: String,
    url: String,
    body_base64: Option<String>,
    headers: HashMap<String, String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CloudHttpResponse {
    status: u16,
    body_base64: String,
    content_type: String,
}

#[tauri::command]
pub async fn cloud_http(request: CloudHttpRequest) -> Result<CloudHttpResponse, String> {
    tauri::async_runtime::spawn_blocking(move || cloud_http_blocking(request))
        .await
        .map_err(|err| format!("连不上云书架：{err}"))?
}

fn cloud_http_blocking(request: CloudHttpRequest) -> Result<CloudHttpResponse, String> {
    let method = request.method.to_ascii_uppercase();
    if method != "GET" && method != "PUT" && method != "DELETE" && method != "POST" {
        return Err("不支持的云书架请求".into());
    }
    if !cloud_url_allowed(&request.url) {
        return Err("云书架地址不正确".into());
    }
    let body = match request.body_base64.as_deref() {
        Some(raw) if !raw.is_empty() => Some(decode_base64(raw)?),
        _ => None,
    };
    // 与 nginx / book-cloud 的 300MB 上限对齐
    if body.as_ref().is_some_and(|bytes| bytes.len() > 300 * 1024 * 1024) {
        return Err("上传内容太大".into());
    }
    let seq = FILE_SEQ.fetch_add(1, Ordering::Relaxed);
    let body_file = RemoveOnDrop(std::env::temp_dir().join(format!("qingyue-cloud-{seq}.bin")));
    let out_file = RemoveOnDrop(std::env::temp_dir().join(format!("qingyue-cloud-{seq}.out")));
    let hdr_file = RemoveOnDrop(std::env::temp_dir().join(format!("qingyue-cloud-{seq}.hdr")));
    if let Some(bytes) = &body {
        fs::write(body_file.path(), bytes).map_err(|err| err.to_string())?;
    }
    const MAX_BYTES: u64 = 300 * 1024 * 1024;
    let mut cmd = tool("curl");
    cmd.args([
        "-sS",
        "--proto",
        "=http,https",
        "--proto-redir",
        "=http,https",
        "--max-time",
        "600",
        "--max-filesize",
        "314572800",
        "-D",
    ])
    .arg(hdr_file.path())
    .arg("-o")
    .arg(out_file.path())
    .args(["-w", "%{http_code}", "-X", &method]);
    for (name, value) in &request.headers {
        if !cloud_header_allowed(name) || value.contains('\n') || value.contains('\r') || value.len() > 4096 {
            continue;
        }
        cmd.arg("-H").arg(format!("{name}: {value}"));
    }
    if body.is_some() {
        cmd.arg("--data-binary").arg(format!("@{}", body_file.path().display()));
    }
    cmd.arg(&request.url);
    let output = cmd.output().map_err(|_| "连不上云书架".to_string())?;
    if !output.status.success() {
        return Err("连不上云书架".into());
    }
    let status = String::from_utf8_lossy(&output.stdout)
        .trim()
        .parse::<u16>()
        .unwrap_or(0);
    if status == 0 {
        return Err("连不上云书架".into());
    }
    let content_type = read_content_type(hdr_file.path()).unwrap_or_else(|| {
        if status >= 400 {
            "application/json".into()
        } else {
            "application/octet-stream".into()
        }
    });
    if let Ok(meta) = fs::metadata(out_file.path()) {
        if meta.len() > MAX_BYTES {
            return Err("云书架响应过大".into());
        }
    }
    let payload = fs::read(out_file.path()).map_err(|err| format!("读取云书架响应失败：{err}"))?;
    Ok(CloudHttpResponse {
        status,
        body_base64: encode_base64(&payload),
        content_type,
    })
}

fn cloud_url_allowed(url: &str) -> bool {
    if url.len() > 2000 || url.starts_with('-') || url.chars().any(|ch| ch.is_control()) {
        return false;
    }
    if url.contains('@') {
        // 拒绝 userinfo，避免 http://user@host 绕过
        return false;
    }
    let rest = url
        .strip_prefix("https://")
        .or_else(|| url.strip_prefix("http://"));
    let Some(rest) = rest else {
        return false;
    };
    let Some((host_port, path_and_query)) = rest.split_once('/') else {
        return false;
    };
    let host = host_port.split(':').next().unwrap_or(host_port);
    let host_ok = matches!(host, "47.108.79.158" | "127.0.0.1" | "localhost");
    if !host_ok {
        return false;
    }
    let path = path_and_query.split(['?', '#']).next().unwrap_or(path_and_query);
    if path.split('/').any(|seg| seg == "..") {
        return false;
    }
    // 路径前缀匹配，禁止把 /v1/books/ 塞进 query 绕过
    path == "v1/books" || path.starts_with("v1/books/")
}

fn cloud_header_allowed(name: &str) -> bool {
    let name = name.to_ascii_lowercase();
    name == "content-type" || name == "authorization"
}

fn read_content_type(path: &Path) -> Option<String> {
    let text = fs::read_to_string(path).ok()?;
    for line in text.lines() {
        let lower = line.to_ascii_lowercase();
        if !lower.starts_with("content-type:") {
            continue;
        }
        let raw = line.split_once(':').map(|(_, v)| v.trim()).unwrap_or("");
        let mime = raw.split(';').next().unwrap_or(raw).trim();
        if !mime.is_empty() {
            return Some(mime.to_string());
        }
    }
    None
}

fn encode_base64(bytes: &[u8]) -> String {
    const TABLE: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = chunk.get(1).copied().unwrap_or(0) as u32;
        let b2 = chunk.get(2).copied().unwrap_or(0) as u32;
        let n = (b0 << 16) | (b1 << 8) | b2;
        out.push(TABLE[((n >> 18) & 63) as usize] as char);
        out.push(TABLE[((n >> 12) & 63) as usize] as char);
        if chunk.len() > 1 {
            out.push(TABLE[((n >> 6) & 63) as usize] as char);
        } else {
            out.push('=');
        }
        if chunk.len() > 2 {
            out.push(TABLE[(n & 63) as usize] as char);
        } else {
            out.push('=');
        }
    }
    out
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

/// 用户词表单独写成一个小文件，排在原词表前面。路径里有逗号时改成合并成一份，避免被拆开。
fn prepare_user_lexicon(
    dir: &Path,
    seq: u64,
    stock: &Path,
    entries: &[PronunciationEntry],
) -> Result<(String, Option<RemoveOnDrop>), String> {
    let body = lexicon_body(entries);
    if body.is_empty() {
        return Ok((stock.display().to_string(), None));
    }
    let path = dir.join(format!("lexicon-{seq}.txt"));
    let user = path.display().to_string();
    let stock_path = stock.display().to_string();
    let (arg, contents) = if user.contains(',') || stock_path.contains(',') {
        let stock_text = fs::read_to_string(stock).map_err(|err| err.to_string())?;
        (user, format!("{body}{stock_text}"))
    } else {
        (format!("{user},{stock_path}"), body)
    };
    fs::write(&path, contents).map_err(|err| err.to_string())?;
    Ok((arg, Some(RemoveOnDrop(path))))
}

fn lexicon_body(entries: &[PronunciationEntry]) -> String {
    let mut seen = HashSet::new();
    let mut out = String::new();
    for entry in entries {
        let Some(line) = lexicon_line(&entry.word, &entry.phones) else {
            continue;
        };
        let word = line.split_once(' ').map(|(word, _)| word).unwrap_or("");
        if !seen.insert(word.to_string()) {
            continue;
        }
        out.push_str(&line);
        out.push('\n');
    }
    out
}

fn lexicon_line(word: &str, phones: &str) -> Option<String> {
    let word = word.trim();
    if word.is_empty() || word.chars().count() > 10 {
        return None;
    }
    if !word
        .chars()
        .all(|ch| ('\u{3400}'..='\u{9fff}').contains(&ch))
    {
        return None;
    }
    let phones = phones.trim();
    if !valid_phones(phones) {
        return None;
    }
    Some(format!("{word} {phones}"))
}

fn valid_phones(phones: &str) -> bool {
    let mut any = false;
    for phone in phones.split_whitespace() {
        any = true;
        let chars: Vec<char> = phone.chars().collect();
        if chars.len() < 2 || chars.len() > 8 {
            return false;
        }
        let tone = chars[chars.len() - 1];
        if !tone.is_ascii_digit() {
            return false;
        }
        if !chars[..chars.len() - 1]
            .iter()
            .all(|ch| ch.is_ascii_lowercase() || *ch == 'ê')
        {
            return false;
        }
    }
    any
}

#[derive(Serialize)]
pub struct SynthHost {
    os: &'static str,
    arch: &'static str,
}

#[tauri::command]
pub fn tts_host() -> SynthHost {
    SynthHost {
        os: std::env::consts::OS,
        arch: std::env::consts::ARCH,
    }
}

#[cfg(test)]
mod tests {
    use super::{
        account_header_allowed, account_url_allowed, cloud_header_allowed, cloud_url_allowed,
        decode_base64, encode_base64, lexicon_body, PronunciationEntry,
    };

    #[test]
    fn user_lexicon_keeps_the_first_reading_and_drops_junk() {
        let lines = lexicon_body(&[
            PronunciationEntry {
                word: "行长".into(),
                phones: "h0 ang2 zh0 ang3".into(),
            },
            PronunciationEntry {
                word: "行长".into(),
                phones: "x0 ing2 zh0 ang3".into(),
            },
            PronunciationEntry {
                word: "hello".into(),
                phones: "h0 e1".into(),
            },
            PronunciationEntry {
                word: "啊".into(),
                phones: "not phones".into(),
            },
        ]);
        assert_eq!(lines, "行长 h0 ang2 zh0 ang3\n");
    }

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
        assert_eq!(encode_base64(b"hello"), "aGVsbG8=");
        assert_eq!(encode_base64(b"hi"), "aGk=");
    }

    #[test]
    fn cloud_url_only_allows_book_api_on_known_hosts() {
        assert!(cloud_url_allowed("http://47.108.79.158/v1/books/cloud"));
        assert!(cloud_url_allowed(
            "http://47.108.79.158/v1/books/cloud/abc-def/file"
        ));
        assert!(cloud_url_allowed("http://127.0.0.1:8790/v1/books/cloud"));
        assert!(!cloud_url_allowed("http://47.108.79.158/v1/auth/login"));
        assert!(!cloud_url_allowed("http://evil.example/v1/books/cloud"));
        assert!(!cloud_url_allowed("file:///etc/passwd"));
        assert!(!cloud_url_allowed("http://47.108.79.158/health?x=/v1/books/"));
        assert!(!cloud_url_allowed("http://127.0.0.1/admin?=/v1/books/"));
        assert!(!cloud_url_allowed(
            "http://47.108.79.158/v1/books/../auth/login"
        ));
        assert!(!cloud_url_allowed("http://user@47.108.79.158/v1/books/cloud"));
    }

    #[test]
    fn cloud_headers_stay_narrow() {
        assert!(cloud_header_allowed("Content-Type"));
        assert!(cloud_header_allowed("Authorization"));
        assert!(!cloud_header_allowed("Cookie"));
    }
}
