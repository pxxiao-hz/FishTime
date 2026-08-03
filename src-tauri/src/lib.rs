use tauri::{
    menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder},
    Emitter,
};
use std::process::Command;

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
        .args(["find-generic-password", "-a", "FishTime", "-s", &service, "-w"])
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
        .args(["add-generic-password", "-U", "-a", "FishTime", "-s", &service, "-w", &api_key])
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
        .invoke_handler(tauri::generate_handler![load_api_key, save_api_key, app_version])
        .setup(|app| {
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

            app.on_menu_event(|app, event| {
                let event_name = event.id().0.as_str();
                if matches!(
                    event_name,
                    "workspace:new" | "workspace:switch" | "settings:open"
                ) {
                    let _ = app.emit(event_name, ());
                }
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running FishTime");
}
