/**
 * 轻阅 Tauri 壳。
 *
 * 设计原则：壳只负责「装」，不负责「功能」。
 * 所有业务逻辑都在 WebView 里，因此：
 *   · 朗读引擎的下载和调用是唯一的 IPC，模型文件不在安装包里；
 *   · 用内置资产协议加载 dist，完全离线；
 *   · 去掉原生壳后 dist/ 依然是一个可用的 PWA。
 */

#[cfg(desktop)]
mod menu;
#[cfg(desktop)]
mod tts;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
    #[cfg(desktop)]
    let builder = builder.menu(menu::build).on_menu_event(menu::on_event);

    #[cfg(desktop)]
    let builder = builder.invoke_handler(tauri::generate_handler![
        tts::tts_download_engine,
        tts::tts_cancel_download,
        tts::tts_delete_engine,
        tts::tts_speak,
    ]);

    builder
        .run(tauri::generate_context!())
        .expect("启动轻阅主窗口失败");
}
