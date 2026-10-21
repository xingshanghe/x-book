/**
 * 轻阅 Tauri 壳。
 *
 * 设计原则：壳只负责「装」，不负责「功能」。
 * 所有业务逻辑都在 WebView 里，因此：
 *   · 无自定义 IPC 命令，无网络请求，无 window.opener；
 *   · 用内置资产协议加载 dist，完全离线；
 *   · 去掉原生壳后 dist/ 依然是一个可用的 PWA。
 */

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("启动轻阅主窗口失败");
}
