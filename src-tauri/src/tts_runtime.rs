//! 各桌面系统启动 sherpa 程序时的差异：校验、动态库和可执行文件。

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

pub(crate) fn sha256_file(path: &Path) -> Result<String, String> {
    if let Some(sum) = hash_command("sha256sum", &[], path) {
        return Ok(sum);
    }
    if let Some(sum) = hash_command("shasum", &["-a", "256"], path) {
        return Ok(sum);
    }
    if let Some(sum) = hash_command("certutil", &["-hashfile"], path) {
        return Ok(sum);
    }
    Err("无法校验文件".into())
}

fn hash_command(program: &str, args: &[&str], path: &Path) -> Option<String> {
    let mut cmd = tool(program);
    cmd.args(args);
    if program == "certutil" {
        cmd.arg(path).arg("SHA256");
    } else {
        cmd.arg(path);
    }
    let output = cmd.output().ok()?;
    if !output.status.success() {
        return None;
    }
    hash_from_output(&String::from_utf8_lossy(&output.stdout))
}

fn hash_from_output(text: &str) -> Option<String> {
    text.split_whitespace()
        .find(|token| token.len() == 64 && token.chars().all(|ch| ch.is_ascii_hexdigit()))
        .map(str::to_string)
}

pub(crate) fn clear_download_mark(dir: &Path) {
    #[cfg(target_os = "macos")]
    {
        let _ = tool("xattr")
            .args(["-dr", "com.apple.quarantine"])
            .arg(dir)
            .status();
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = dir;
    }
}

pub(crate) fn mark_executable(binary: &Path) {
    #[cfg(unix)]
    {
        let _ = tool("chmod").args(["a+x"]).arg(binary).status();
    }
    #[cfg(not(unix))]
    {
        let _ = binary;
    }
}

pub(crate) fn find_binary(dir: &Path) -> Option<PathBuf> {
    #[cfg(windows)]
    {
        find_file(dir, "sherpa-onnx-offline-tts.exe")
            .or_else(|| find_file(dir, "sherpa-onnx-offline-tts"))
    }
    #[cfg(not(windows))]
    {
        find_file(dir, "sherpa-onnx-offline-tts")
    }
}

pub(crate) fn configure_runtime_libs(cmd: &mut Command, dir: &Path) {
    let mut dirs = Vec::new();
    if let Some(parent) = find_onnxruntime(dir).and_then(|path| path.parent().map(Path::to_path_buf)) {
        dirs.push(parent);
    }
    if let Some(parent) = find_binary(dir).and_then(|path| path.parent().map(Path::to_path_buf)) {
        if !dirs.iter().any(|item| item == &parent) {
            dirs.push(parent);
        }
    }
    if dirs.is_empty() {
        return;
    }
    #[cfg(target_os = "macos")]
    if let Ok(joined) = std::env::join_paths(&dirs) {
        cmd.env("DYLD_LIBRARY_PATH", joined);
    }
    #[cfg(target_os = "linux")]
    if let Ok(joined) = std::env::join_paths(&dirs) {
        cmd.env("LD_LIBRARY_PATH", joined);
    }
    #[cfg(windows)]
    if let Ok(joined) = std::env::join_paths(&dirs) {
        let mut path = joined;
        path.push(";");
        if let Some(old) = std::env::var_os("PATH") {
            path.push(old);
        }
        cmd.env("PATH", path);
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux", windows)))]
    {
        let _ = cmd;
    }
}

fn find_onnxruntime(dir: &Path) -> Option<PathBuf> {
    find_file_where(dir, is_onnxruntime_name)
}

fn is_onnxruntime_name(name: &str) -> bool {
    name == "libonnxruntime.dylib"
        || name == "libonnxruntime.so"
        || name.starts_with("libonnxruntime.so.")
        || name == "onnxruntime.dll"
}

pub(crate) fn tool(program: impl AsRef<std::ffi::OsStr>) -> Command {
    let mut cmd = Command::new(program);
    hide_console(&mut cmd);
    cmd
}

fn hide_console(cmd: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    #[cfg(not(windows))]
    {
        let _ = cmd;
    }
}

pub(crate) fn stop_pid(pid: u32) {
    if pid == 0 {
        return;
    }
    #[cfg(windows)]
    {
        let _ = tool("taskkill").args(["/F", "/PID", &pid.to_string()]).status();
    }
    #[cfg(not(windows))]
    {
        let _ = tool("kill").arg(pid.to_string()).status();
    }
}

pub(crate) fn find_file(dir: &Path, name: &str) -> Option<PathBuf> {
    find_file_where(dir, |item| item == name)
}

fn find_file_where(dir: &Path, pred: impl Fn(&str) -> bool) -> Option<PathBuf> {
    let mut stack = vec![dir.to_path_buf()];
    while let Some(current) = stack.pop() {
        let Ok(entries) = fs::read_dir(&current) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
            } else if path.file_name().and_then(|item| item.to_str()).is_some_and(&pred) {
                return Some(path);
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::{hash_from_output, is_onnxruntime_name};

    #[test]
    fn hash_line_reads_sha256sum_and_certutil() {
        assert_eq!(
            hash_from_output(
                "ca352a87d313fb1cce311c7b5ddc2e48df3ff899fb2c43ce8076071f029d1d3f  file\n"
            )
            .as_deref(),
            Some("ca352a87d313fb1cce311c7b5ddc2e48df3ff899fb2c43ce8076071f029d1d3f")
        );
        let cert = "SHA256 hash of a.bin:\nCA352A87D313FB1CCE311C7B5DDC2E48DF3FF899FB2C43CE8076071F029D1D3F\nCertUtil: -hashfile command completed successfully.\n";
        assert_eq!(
            hash_from_output(cert).as_deref(),
            Some("CA352A87D313FB1CCE311C7B5DDC2E48DF3FF899FB2C43CE8076071F029D1D3F")
        );
        assert!(hash_from_output("no hash here").is_none());
    }

    #[test]
    fn onnxruntime_names_cover_each_desktop() {
        assert!(is_onnxruntime_name("libonnxruntime.dylib"));
        assert!(is_onnxruntime_name("libonnxruntime.so"));
        assert!(is_onnxruntime_name("libonnxruntime.so.1.28.2"));
        assert!(is_onnxruntime_name("onnxruntime.dll"));
        assert!(!is_onnxruntime_name("libsherpa-onnx-c-api.so"));
    }
}
