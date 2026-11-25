mod agent;
mod ai;
mod browser;
mod env;
mod fs;
mod git;
mod mem;
mod ports;
mod pty;

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Emitter, Manager, RunEvent, Runtime, WindowEvent};

fn menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let item = |id: &str, label: &str, accel: &str| MenuItem::with_id(app, id, label, true, Some(accel));
    let sep = || PredefinedMenuItem::separator(app);
    Menu::with_items(
        app,
        &[
            &Submenu::with_items(
                app,
                "Aira",
                true,
                &[
                    &PredefinedMenuItem::about(app, None, None)?,
                    &MenuItem::with_id(app, "check-updates", "Check for Updates…", true, None::<&str>)?,
                    &sep()?,
                    &item("settings", "Settings…", "CmdOrCtrl+,")?,
                    &sep()?,
                    &PredefinedMenuItem::hide(app, None)?,
                    &PredefinedMenuItem::hide_others(app, None)?,
                    &PredefinedMenuItem::show_all(app, None)?,
                    &sep()?,
                    // Custom (not predefined) so quitting goes through the running-scripts confirm.
                    &item("quit", "Quit Aira", "CmdOrCtrl+Q")?,
                ],
            )?,
            &Submenu::with_items(
                app,
                "File",
                true,
                &[
                    &item("open-folder", "Open Folder…", "CmdOrCtrl+O")?,
                    &item("new-terminal", "New Terminal", "CmdOrCtrl+T")?,
                    &item("new-browser", "New Browser Tab", "CmdOrCtrl+Shift+B")?,
                    &sep()?,
                    // Cmd+W closes a tab, never the window (that would kill every dev server).
                    &item("close-tab", "Close Tab", "CmdOrCtrl+W")?,
                ],
            )?,
            // Clipboard items are required for Cmd+C/V/X/A to work in WKWebView. Undo/redo are
            // left out so Cmd+Z reaches Monaco's own undo stack.
            &Submenu::with_items(
                app,
                "Edit",
                true,
                &[
                    &PredefinedMenuItem::cut(app, None)?,
                    &PredefinedMenuItem::copy(app, None)?,
                    &PredefinedMenuItem::paste(app, None)?,
                    &PredefinedMenuItem::select_all(app, None)?,
                ],
            )?,
            &Submenu::with_items(
                app,
                "View",
                true,
                &[
                    &item("toggle-left", "Toggle Projects Panel", "CmdOrCtrl+B")?,
                    &item("toggle-right", "Toggle Files/Git Panel", "CmdOrCtrl+Alt+B")?,
                    &sep()?,
                    &PredefinedMenuItem::fullscreen(app, None)?,
                ],
            )?,
            &Submenu::with_items(
                app,
                "Window",
                true,
                &[&PredefinedMenuItem::minimize(app, None)?, &PredefinedMenuItem::maximize(app, None)?],
            )?,
        ],
    )
}

/// Called by the frontend after it confirmed quitting and saved which scripts were running.
#[tauri::command]
async fn quit_app(app: AppHandle) {
    let a = app.clone();
    let _ = tauri::async_runtime::spawn_blocking(move || pty::kill_all(&a)).await;
    app.exit(0);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    std::thread::spawn(|| {
        env::get(); // warm up: resolving the login-shell env takes ~0.2–2s
    });
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(pty::Ptys::default())
        .manage(fs::Watch::default())
        .manage(browser::Browsers::default())
        .manage(browser::Popped::default())
        .menu(menu)
        .on_menu_event(|app, event| {
            let _ = match event.id().as_ref() {
                "quit" => app.emit("quit-requested", ()),
                id if id.starts_with("ctx:") => Ok(()), // context menus built in JS handle their own actions
                id => app.emit("menu", id),
            };
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                // A browser pop-out closes for real; its page goes back into the tab first.
                if let Some(id) = window.label().strip_prefix("popout-") {
                    browser::dock(window.app_handle(), id);
                    return;
                }
                api.prevent_close();
                let _ = window.emit("quit-requested", ());
            }
        })
        .setup(|app| {
            let cfg = app.config().app.windows.first().cloned().expect("window config");
            tauri::WebviewWindowBuilder::from_config(app.handle(), &cfg)?
                // Never navigate the app webview away from the bundled UI.
                .on_navigation(|url| {
                    url.scheme() == "tauri"
                        || matches!(url.host_str(), Some("localhost" | "tauri.localhost" | "ipc.localhost"))
                })
                .build()?;
            mem::start(app.handle().clone());
            agent::clear_all(app.handle());
            agent::init_notifications(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            quit_app,
            pty::pty_spawn,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_ack,
            pty::pty_kill,
            pty::pty_busy,
            ports::ports_list,
            ports::kill_pid,
            fs::read_dir,
            fs::read_file,
            fs::read_file_bytes,
            fs::write_file,
            fs::create_path,
            fs::copy_text,
            fs::clipboard_paths,
            fs::list_fonts,
            fs::load_config,
            fs::save_config,
            fs::which,
            fs::watch_set,
            git::git_discover,
            git::git_status,
            git::git_file_versions,
            git::git_stage,
            git::git_unstage,
            git::git_discard,
            git::git_commit,
            git::git_last_message,
            git::git_init,
            git::git_branches,
            git::git_switch,
            git::git_branch_delete,
            git::git_fetch,
            git::git_pull,
            git::git_push,
            git::git_worktree_add,
            git::git_worktree_remove,
            ai::ai_set_key,
            ai::ai_commit_message,
            ai::ai_list_models,
            agent::agent_events,
            agent::agent_events_clear,
            agent::agent_usage,
            agent::notify_agent,
            agent::agent_setup,
            agent::agent_repo_hooks,
            browser::browser_open,
            browser::browser_bounds,
            browser::browser_navigate,
            browser::browser_nav_action,
            browser::browser_show,
            browser::browser_close,
            browser::browser_devtools,
            browser::browser_zoom,
            browser::browser_favicon,
            browser::browser_query,
            browser::browser_snapshot,
            browser::browser_still,
            browser::browser_fullpage,
            browser::browser_save_shot,
            browser::browser_popout,
            browser::browser_dock,
            browser::cookie_sources,
            browser::cookie_import,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| match event {
            RunEvent::ExitRequested { code: None, api, .. } => {
                api.prevent_exit();
                let _ = app.emit("quit-requested", ());
            }
            RunEvent::Exit => pty::kill_all(app),
            _ => {}
        });
}
