use std::process::Command;
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder},
    Emitter,
};
mod tray;
mod updates;

fn keychain_service(provider: &str) -> Result<String, String> {
    match provider {
        "gemini" | "silicon" => Ok(format!("com.fishtime.desktop.ai-key.{provider}")),
        _ => Err("Unsupported AI provider".into()),
    }
}

#[tauri::command]
fn load_api_key(provider: String) -> Result<String, String> {
    let service = keychain_service(&provider)?;
    let output = Command::new("/usr/bin/security")
        .args([
            "find-generic-password",
            "-a",
            "FishTime",
            "-s",
            &service,
            "-w",
        ])
        .output()
        .map_err(|error| error.to_string())?;
    if output.status.success() {
        return Ok(String::from_utf8_lossy(&output.stdout).trim().to_string());
    }
    // 未保存时 security 返回非零；对界面而言这就是空 Key。
    Ok(String::new())
}

#[tauri::command]
fn save_api_key(provider: String, api_key: String) -> Result<(), String> {
    let service = keychain_service(&provider)?;
    if api_key.is_empty() {
        let _ = Command::new("/usr/bin/security")
            .args(["delete-generic-password", "-a", "FishTime", "-s", &service])
            .output();
        return Ok(());
    }
    let output = Command::new("/usr/bin/security")
        .args([
            "add-generic-password",
            "-U",
            "-a",
            "FishTime",
            "-s",
            &service,
            "-w",
            &api_key,
        ])
        .output()
        .map_err(|error| error.to_string())?;
    if output.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
    }
}

#[tauri::command]
fn app_version(app: tauri::AppHandle) -> String {
    app.package_info().version.to_string()
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(updates::UpdateState::default())
        .invoke_handler(tauri::generate_handler![
            load_api_key,
            save_api_key,
            app_version,
            tray::sync_tray,
            tray::exit_app,
            updates::check_for_update,
            updates::download_update,
            updates::install_update,
            updates::restart_after_update,
            updates::open_release_page
        ])
        .on_window_event(|window, event| {
            if window.label() == "main" {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .setup(|app| {
            // Match LSUIElement in packaged builds, including when running via
            // `tauri dev`: keep windows interactive without a Dock icon.
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);
            let about = MenuItemBuilder::with_id("app:about", "About FishTime").build(app)?;
            let check_update =
                MenuItemBuilder::with_id("app:check-update", "Check for Updates…").build(app)?;
            let new_workspace = MenuItemBuilder::with_id("workspace:new", "New Workspace")
                .accelerator("CmdOrCtrl+Shift+N")
                .build(app)?;
            let switch_workspace = MenuItemBuilder::with_id("workspace:switch", "Switch Workspace")
                .accelerator("CmdOrCtrl+Shift+S")
                .build(app)?;
            let open_settings = MenuItemBuilder::with_id("settings:open", "Settings")
                .accelerator("CmdOrCtrl+,")
                .build(app)?;
            let app_menu = SubmenuBuilder::new(app, "FishTime")
                .item(&about)
                .item(&check_update)
                .separator()
                .item(&new_workspace)
                .item(&switch_workspace)
                .separator()
                .item(&open_settings)
                .separator()
                .quit()
                .build()?;
            let edit_menu = SubmenuBuilder::new(app, "Edit")
                .undo()
                .redo()
                .separator()
                .cut()
                .copy()
                .paste()
                .select_all()
                .build()?;
            let window_menu = SubmenuBuilder::new(app, "Window")
                .minimize()
                .close_window()
                .build()?;
            let menu = MenuBuilder::new(app)
                .items(&[&app_menu, &edit_menu, &window_menu])
                .build()?;
            app.set_menu(menu)?;
            tray::setup(app)?;

            app.on_menu_event(|app, event| {
                let event_name = event.id().0.as_str();
                match event_name {
                    "tray:open" => tray::show_main(app),
                    "tray:about" | "tray:settings" | "tray:update" => {
                        tray::show_main(app);
                        let target = if event_name == "tray:about" {
                            "app:about"
                        } else if event_name == "tray:update" {
                            "app:check-update"
                        } else {
                            "settings:open"
                        };
                        let _ = app.emit_to("main", target, ());
                    }
                    "tray:quit" => tray::request_quit(app),
                    "tray:start" | "tray:pause" | "tray:stop" => {
                        let _ = app.emit_to("main", "timer:action", &event_name[5..]);
                    }
                    _ => {}
                }
                if matches!(
                    event_name,
                    "app:about"
                        | "app:check-update"
                        | "workspace:new"
                        | "workspace:switch"
                        | "settings:open"
                ) {
                    tray::show_main(app);
                    let _ = app.emit(event_name, ());
                }
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building FishTime")
        .run(|app, event| match event {
            tauri::RunEvent::ExitRequested {
                code: None, api, ..
            } => {
                api.prevent_exit();
                tray::request_quit(app);
            }
            #[cfg(target_os = "macos")]
            tauri::RunEvent::Reopen { .. } => tray::show_main(app),
            _ => {}
        });
}
