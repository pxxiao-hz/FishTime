use serde::Serialize;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex,
};
use std::time::Duration;
use tauri::{Emitter, Manager};
use tauri_plugin_updater::{Update, UpdaterExt};

struct Pending {
    update: Update,
    bytes: Option<Vec<u8>>,
}
#[derive(Default)]
pub struct UpdateState {
    pending: Mutex<Option<Pending>>,
    busy: AtomicBool,
    installing: AtomicBool,
    installed: AtomicBool,
}
struct Operation<'a>(&'a AtomicBool);
impl Drop for Operation<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}
fn begin(flag: &AtomicBool) -> Result<Operation<'_>, String> {
    flag.compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .map_err(|_| "update_busy".to_string())?;
    Ok(Operation(flag))
}
pub fn installing(app: &tauri::AppHandle) -> bool {
    app.try_state::<UpdateState>()
        .is_some_and(|state| state.installing.load(Ordering::SeqCst))
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Metadata {
    version: String,
    current_version: String,
    notes: String,
}
#[derive(Clone, Serialize)]
struct Progress {
    downloaded: u64,
    total: Option<u64>,
}

#[tauri::command]
pub async fn check_for_update(app: tauri::AppHandle) -> Result<Option<Metadata>, String> {
    let state = app.state::<UpdateState>();
    let _operation = begin(&state.busy)?;
    let update = app
        .updater_builder()
        .timeout(Duration::from_secs(90))
        .build()
        .map_err(|error| error.to_string())?
        .check()
        .await
        .map_err(|error| error.to_string())?;
    let metadata = update.as_ref().map(|update| Metadata {
        version: update.version.clone(),
        current_version: update.current_version.clone(),
        notes: update
            .body
            .as_deref()
            .unwrap_or("")
            .chars()
            .take(6000)
            .collect(),
    });
    *state.pending.lock().unwrap() = update.map(|update| Pending {
        update,
        bytes: None,
    });
    Ok(metadata)
}

#[tauri::command]
pub async fn download_update(app: tauri::AppHandle) -> Result<(), String> {
    let state = app.state::<UpdateState>();
    let _operation = begin(&state.busy)?;
    let mut pending = state
        .pending
        .lock()
        .unwrap()
        .take()
        .ok_or("no_pending_update")?;
    let mut downloaded = 0u64;
    let mut reported = 0u64;
    let result = pending
        .update
        .download(
            |chunk, total| {
                downloaded += chunk as u64;
                if downloaded.saturating_sub(reported) >= 128 * 1024
                    || total.is_some_and(|total| downloaded >= total)
                {
                    reported = downloaded;
                    let _ = app.emit_to("main", "updater:progress", Progress { downloaded, total });
                }
            },
            || {},
        )
        .await;
    match result {
        Ok(bytes) => {
            pending.bytes = Some(bytes);
            *state.pending.lock().unwrap() = Some(pending);
            Ok(())
        }
        Err(error) => {
            *state.pending.lock().unwrap() = Some(pending);
            Err(error.to_string())
        }
    }
}

#[tauri::command]
pub async fn install_update(app: tauri::AppHandle) -> Result<(), String> {
    let state = app.state::<UpdateState>();
    let _operation = begin(&state.busy)?;
    if std::env::current_exe()
        .map_err(|error| error.to_string())?
        .starts_with("/Volumes")
    {
        return Err("move_to_applications".into());
    }
    let mut pending = state
        .pending
        .lock()
        .unwrap()
        .take()
        .ok_or("no_pending_update")?;
    let bytes = pending.bytes.take().ok_or("update_not_downloaded")?;
    state.installing.store(true, Ordering::SeqCst);
    let result = pending
        .update
        .install(bytes)
        .map_err(|error| error.to_string());
    if result.is_ok() {
        state.installed.store(true, Ordering::SeqCst);
    }
    state.installing.store(false, Ordering::SeqCst);
    result
}

#[tauri::command]
pub fn restart_after_update(app: tauri::AppHandle) -> Result<(), String> {
    if !app.state::<UpdateState>().installed.load(Ordering::SeqCst) {
        return Err("no_installed_update".into());
    }
    app.restart();
}

#[tauri::command]
pub fn open_release_page() -> Result<(), String> {
    std::process::Command::new("/usr/bin/open")
        .arg("https://github.com/pxxiao-hz/FishTime/releases/latest")
        .spawn()
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn concurrent_operations_are_rejected_and_errors_release_the_guard() {
        let flag = AtomicBool::new(false);
        let operation = begin(&flag).unwrap();
        assert!(begin(&flag).is_err());
        drop(operation);
        assert!(begin(&flag).is_ok());
    }
}
