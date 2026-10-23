//! 系统菜单栏。
//!
//! Tauri 自带的菜单写死了英文，macOS 上「帮助」还是空的，「关闭」在文件和窗口里各有一份。
//! 这里改成系统习惯的简体中文，并在应用菜单补上「设置…」。

use tauri::menu::{
    AboutMetadata, Menu, MenuEvent, MenuItem, PredefinedMenuItem, Submenu, WINDOW_SUBMENU_ID,
};
use tauri::{AppHandle, Manager, Runtime};

#[cfg(not(target_os = "macos"))]
use tauri::menu::HELP_SUBMENU_ID;

const SETTINGS_ID: &str = "settings";

pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    #[cfg(target_os = "macos")]
    {
        build_macos(app)
    }
    #[cfg(windows)]
    {
        build_windows(app)
    }
    #[cfg(not(any(target_os = "macos", windows)))]
    {
        build_linux(app)
    }
}

/// 菜单点击发生在原生层，页面路由在 WebView。只把「打开设置」交回去。
pub fn on_event<R: Runtime>(app: &AppHandle<R>, event: MenuEvent) {
    if event.id() != SETTINGS_ID {
        return;
    }
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let _ =
        window.eval("window.dispatchEvent(new CustomEvent('qingyue:menu',{detail:'settings'}))");
}

#[cfg(target_os = "macos")]
fn build_macos<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let app_menu = macos_app_menu(app)?;
    let file = file_menu(app, false)?;
    let edit = edit_menu(app)?;
    let view = view_menu(app)?;
    let window = window_menu(app)?;
    Menu::with_items(app, &[&app_menu, &file, &edit, &view, &window])
}

#[cfg(windows)]
fn build_windows<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let file = file_menu(app, true)?;
    let edit = edit_menu(app)?;
    let window = window_menu(app)?;
    let help = help_menu(app, false)?;
    Menu::with_items(app, &[&file, &edit, &window, &help])
}

#[cfg(not(any(target_os = "macos", windows)))]
fn build_linux<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let edit = edit_menu(app)?;
    let window = window_menu(app)?;
    let help = help_menu(app, true)?;
    Menu::with_items(app, &[&edit, &window, &help])
}

#[cfg(target_os = "macos")]
fn macos_app_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Submenu<R>> {
    let name = app.package_info().name.clone();
    let hide_label = format!("隐藏{name}");
    let quit_label = format!("退出{name}");

    let about = about_item(app)?;
    let settings = settings_item(app)?;
    let above_services = PredefinedMenuItem::separator(app)?;
    let services = PredefinedMenuItem::services(app, Some("服务"))?;
    let above_hide = PredefinedMenuItem::separator(app)?;
    let hide = PredefinedMenuItem::hide(app, Some(&hide_label))?;
    let hide_others = PredefinedMenuItem::hide_others(app, Some("隐藏其他"))?;
    let show_all = PredefinedMenuItem::show_all(app, Some("全部显示"))?;
    let above_quit = PredefinedMenuItem::separator(app)?;
    let quit = PredefinedMenuItem::quit(app, Some(&quit_label))?;

    Submenu::with_items(
        app,
        &name,
        true,
        &[
            &about,
            &settings,
            &above_services,
            &services,
            &above_hide,
            &hide,
            &hide_others,
            &show_all,
            &above_quit,
            &quit,
        ],
    )
}

/// `with_settings` 为真时把「设置…」放进文件菜单（Windows）。
/// macOS 的设置在应用菜单里，文件菜单只留「关闭」。
#[cfg(any(target_os = "macos", windows))]
fn file_menu<R: Runtime>(app: &AppHandle<R>, with_settings: bool) -> tauri::Result<Submenu<R>> {
    let close = PredefinedMenuItem::close_window(app, Some("关闭"))?;
    if !with_settings {
        return Submenu::with_items(app, "文件", true, &[&close]);
    }

    let settings = settings_item(app)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let quit = PredefinedMenuItem::quit(app, Some("退出"))?;
    Submenu::with_items(app, "文件", true, &[&settings, &sep, &close, &quit])
}

fn edit_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Submenu<R>> {
    let undo = PredefinedMenuItem::undo(app, Some("撤销"))?;
    let redo = PredefinedMenuItem::redo(app, Some("重做"))?;
    let sep = PredefinedMenuItem::separator(app)?;
    let cut = PredefinedMenuItem::cut(app, Some("剪切"))?;
    let copy = PredefinedMenuItem::copy(app, Some(copy_label()))?;
    let paste = PredefinedMenuItem::paste(app, Some("粘贴"))?;
    let select_all = PredefinedMenuItem::select_all(app, Some("全选"))?;
    Submenu::with_items(
        app,
        "编辑",
        true,
        &[&undo, &redo, &sep, &cut, &copy, &paste, &select_all],
    )
}

#[cfg(target_os = "macos")]
fn view_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Submenu<R>> {
    let fullscreen = PredefinedMenuItem::fullscreen(app, Some("进入全屏"))?;
    Submenu::with_items(app, "显示", true, &[&fullscreen])
}

fn window_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Submenu<R>> {
    let minimize = PredefinedMenuItem::minimize(app, Some("最小化"))?;
    let zoom_label = if cfg!(target_os = "macos") {
        "缩放"
    } else {
        "最大化"
    };
    let zoom = PredefinedMenuItem::maximize(app, Some(zoom_label))?;

    // macOS 的「关闭」放在文件菜单，窗口菜单不再重复一份。
    #[cfg(target_os = "macos")]
    {
        return Submenu::with_id_and_items(
            app,
            WINDOW_SUBMENU_ID,
            "窗口",
            true,
            &[&minimize, &zoom],
        );
    }

    #[cfg(not(target_os = "macos"))]
    {
        let sep = PredefinedMenuItem::separator(app)?;
        let close = PredefinedMenuItem::close_window(app, Some("关闭"))?;
        Submenu::with_id_and_items(
            app,
            WINDOW_SUBMENU_ID,
            "窗口",
            true,
            &[&minimize, &zoom, &sep, &close],
        )
    }
}

#[cfg(not(target_os = "macos"))]
fn help_menu<R: Runtime>(app: &AppHandle<R>, with_settings: bool) -> tauri::Result<Submenu<R>> {
    let about = about_item(app)?;
    if !with_settings {
        return Submenu::with_id_and_items(app, HELP_SUBMENU_ID, "帮助", true, &[&about]);
    }
    let settings = settings_item(app)?;
    let sep = PredefinedMenuItem::separator(app)?;
    Submenu::with_id_and_items(
        app,
        HELP_SUBMENU_ID,
        "帮助",
        true,
        &[&settings, &sep, &about],
    )
}

fn settings_item<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<MenuItem<R>> {
    MenuItem::with_id(app, SETTINGS_ID, "设置…", true, Some("CmdOrCtrl+,"))
}

fn about_item<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<PredefinedMenuItem<R>> {
    let label = format!("关于{}", app.package_info().name);
    PredefinedMenuItem::about(app, Some(&label), Some(about_metadata(app)))
}

fn about_metadata<R: Runtime>(app: &AppHandle<R>) -> AboutMetadata<'_> {
    let pkg = app.package_info();
    let bundle = &app.config().bundle;
    AboutMetadata {
        name: Some(pkg.name.clone()),
        version: Some(pkg.version.to_string()),
        copyright: bundle.copyright.clone(),
        authors: bundle.publisher.clone().map(|publisher| vec![publisher]),
        comments: bundle.short_description.clone(),
        ..Default::default()
    }
}

fn copy_label() -> &'static str {
    #[cfg(target_os = "macos")]
    {
        "拷贝"
    }
    #[cfg(not(target_os = "macos"))]
    {
        "复制"
    }
}
