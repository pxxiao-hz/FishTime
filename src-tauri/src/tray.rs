use chrono::{Local, TimeZone};
use serde::Deserialize;
use std::{collections::HashMap, sync::Mutex, time::Duration};
use tauri::{
    menu::{MenuBuilder, MenuItem, MenuItemBuilder},
    tray::TrayIconBuilder,
    Emitter, Manager,
};

#[derive(Clone, Deserialize)]
pub struct Interval {
    start_ms: i64,
    end_ms: Option<i64>,
}

// Read-only projection of the persisted frontend session. All actions use the
// same frontend handlers; the native clock never writes a second copy of records.
#[derive(Clone, Deserialize)]
pub struct Snapshot {
    revision: u64,
    workspace: String,
    language: String,
    state: String,
    intervals: Vec<Interval>,
    daily_totals: HashMap<String, u64>,
}

pub struct TrayState {
    snapshot: Mutex<Option<Snapshot>>,
    last_frame: Mutex<Option<(u64, u64, u64)>>,
    status: MenuItem<tauri::Wry>,
    workspace: MenuItem<tauri::Wry>,
    session: MenuItem<tauri::Wry>,
    today: MenuItem<tauri::Wry>,
    start: MenuItem<tauri::Wry>,
    pause: MenuItem<tauri::Wry>,
    stop: MenuItem<tauri::Wry>,
    open: MenuItem<tauri::Wry>,
    about: MenuItem<tauri::Wry>,
    settings: MenuItem<tauri::Wry>,
    quit: MenuItem<tauri::Wry>,
}

fn duration_text(ms: u64) -> String {
    let seconds = ms / 1000;
    format!(
        "{:02}:{:02}:{:02}",
        seconds / 3600,
        seconds / 60 % 60,
        seconds % 60
    )
}

fn interval_total(intervals: &[Interval], now: i64, lower: i64, upper: i64) -> u64 {
    intervals
        .iter()
        .map(|interval| {
            let start = interval.start_ms.max(lower);
            let end = interval.end_ms.unwrap_or(now).min(now).min(upper);
            end.saturating_sub(start).max(0) as u64
        })
        .sum()
}

pub fn show_main(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

pub fn request_quit(app: &tauri::AppHandle) {
    let ready = app.state::<TrayState>().snapshot.lock().unwrap().is_some();
    if ready {
        let _ = app.emit_to("main", "timer:action", "quit");
    } else {
        app.exit(0);
    }
}

#[tauri::command]
pub fn exit_app(app: tauri::AppHandle) {
    app.exit(0);
}

#[tauri::command]
pub fn sync_tray(app: tauri::AppHandle, snapshot: Snapshot) {
    let state = app.state::<TrayState>();
    {
        let mut saved = state.snapshot.lock().unwrap();
        if saved
            .as_ref()
            .is_some_and(|previous| previous.revision > snapshot.revision)
        {
            return;
        }
        *saved = Some(snapshot);
    }
    refresh(&app);
}

fn refresh(app: &tauri::AppHandle) {
    let state = app.state::<TrayState>();
    let snapshot = state.snapshot.lock().unwrap().clone();
    let Some(snapshot) = snapshot else { return };
    let en = snapshot.language == "en";
    let now = Local::now();
    let now_ms = now.timestamp_millis();
    let date = now.date_naive();
    // Use local calendar boundaries, including DST, rather than 24-hour division.
    let midnight = Local
        .from_local_datetime(&date.and_hms_opt(0, 0, 0).unwrap())
        .earliest()
        .map(|time| time.timestamp_millis())
        .unwrap_or(now_ms);
    let elapsed = interval_total(&snapshot.intervals, now_ms, i64::MIN, i64::MAX);
    let today = snapshot
        .daily_totals
        .get(&date.to_string())
        .copied()
        .unwrap_or(0)
        + interval_total(&snapshot.intervals, now_ms, midnight, now_ms);
    let frame = (snapshot.revision, elapsed / 1000, today / 1000);
    {
        let mut previous = state.last_frame.lock().unwrap();
        if previous.as_ref() == Some(&frame) {
            return;
        }
        *previous = Some(frame);
    }
    let running = snapshot.state == "running";
    let active = running || snapshot.state == "paused";
    let status = match (snapshot.state.as_str(), en) {
        ("running", true) => "Running",
        ("running", false) => "正在计时",
        ("paused", true) => "Paused",
        ("paused", false) => "已暂停",
        (_, true) => "Ready",
        (_, false) => "未在计时",
    };
    let title = if active {
        format!(
            "{} {}",
            if running { "▶" } else { "Ⅱ" },
            duration_text(elapsed)
        )
    } else {
        "FishTime".to_string()
    };
    if let Some(tray) = app.tray_by_id("timer") {
        let _ = tray.set_title(Some(&title));
        let _ = tray.set_tooltip(Some(format!("FishTime · {status}")));
    }
    let _ = state.status.set_text(status);
    let _ = state.workspace.set_text(format!(
        "{}: {}",
        if en { "Workspace" } else { "分区" },
        snapshot.workspace
    ));
    let _ = state.session.set_text(format!(
        "{}: {}",
        if en { "Session" } else { "本次" },
        duration_text(elapsed)
    ));
    let _ = state.today.set_text(format!(
        "{}: {}",
        if en { "Today" } else { "今日累计" },
        duration_text(today)
    ));
    let _ = state.start.set_text(if active {
        if en {
            "Resume"
        } else {
            "继续计时"
        }
    } else if en {
        "Start"
    } else {
        "开始计时"
    });
    let _ = state.start.set_enabled(!running);
    let _ = state.pause.set_text(if en { "Pause" } else { "暂停计时" });
    let _ = state.pause.set_enabled(running);
    let _ = state.stop.set_text(if en {
        "Finish and Save"
    } else {
        "结束并保存"
    });
    let _ = state.stop.set_enabled(active);
    let _ = state.open.set_text(if en {
        "Open FishTime"
    } else {
        "打开 FishTime"
    });
    let _ = state.about.set_text("About FishTime");
    let _ = state
        .settings
        .set_text(if en { "Settings" } else { "设置" });
    let _ = state.quit.set_text(if en {
        "Quit FishTime"
    } else {
        "退出 FishTime"
    });
}

pub fn setup(app: &tauri::App) -> tauri::Result<()> {
    let info = |id, text| MenuItemBuilder::with_id(id, text).enabled(false).build(app);
    let status = info("tray:status", "正在加载…")?;
    let workspace = info("tray:workspace", "分区")?;
    let session = info("tray:session", "本次: 00:00:00")?;
    let today = info("tray:today", "今日累计: 00:00:00")?;
    let start = info("tray:start", "开始计时")?;
    let pause = info("tray:pause", "暂停计时")?;
    let stop = info("tray:stop", "结束并保存")?;
    let open = MenuItemBuilder::with_id("tray:open", "打开 FishTime").build(app)?;
    let about = MenuItemBuilder::with_id("tray:about", "About FishTime").build(app)?;
    let settings = MenuItemBuilder::with_id("tray:settings", "设置").build(app)?;
    let quit = MenuItemBuilder::with_id("tray:quit", "退出 FishTime").build(app)?;
    let menu = MenuBuilder::new(app)
        .items(&[&status, &workspace, &session, &today])
        .separator()
        .items(&[&start, &pause, &stop])
        .separator()
        .items(&[&open, &settings, &about])
        .separator()
        .item(&quit)
        .build()?;
    // A small monochrome fish template stays legible in light and dark menu bars.
    let mut pixels = vec![0u8; 22 * 22 * 4];
    for y in 0..22i32 {
        for x in 0..22i32 {
            let body = (x - 9).pow(2) * 25 + (y - 11).pow(2) * 49 <= 1225;
            let tail = (15..=20).contains(&x) && (y - 11).abs() <= (x - 14) * 4 / 5;
            let eye = (x - 6).pow(2) + (y - 9).pow(2) <= 1;
            if (body || tail) && !eye {
                pixels[((y * 22 + x) * 4 + 3) as usize] = 255;
            }
        }
    }
    TrayIconBuilder::with_id("timer")
        .icon(tauri::image::Image::new_owned(pixels, 22, 22))
        .icon_as_template(true)
        .title("FishTime")
        .tooltip("FishTime")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .build(app)?;
    app.manage(TrayState {
        snapshot: Mutex::new(None),
        last_frame: Mutex::new(None),
        status,
        workspace,
        session,
        today,
        start,
        pause,
        stop,
        open,
        about,
        settings,
        quit,
    });
    let handle = app.handle().clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_secs(1));
        let app = handle.clone();
        if handle.run_on_main_thread(move || refresh(&app)).is_err() {
            break;
        }
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn running_and_paused_segments_exclude_breaks() {
        let intervals = vec![
            Interval {
                start_ms: 1000,
                end_ms: Some(3000),
            },
            Interval {
                start_ms: 5000,
                end_ms: None,
            },
        ];
        assert_eq!(interval_total(&intervals, 8000, i64::MIN, i64::MAX), 5000);
        assert_eq!(interval_total(&intervals, 9000, 6000, 9000), 3000);
        let paused = vec![Interval {
            start_ms: 1000,
            end_ms: Some(3000),
        }];
        assert_eq!(interval_total(&paused, 9000, i64::MIN, i64::MAX), 2000);
    }

    #[test]
    fn midnight_and_backward_clock_are_clipped() {
        let intervals = vec![Interval {
            start_ms: 1000,
            end_ms: None,
        }];
        assert_eq!(interval_total(&intervals, 8000, 6000, 8000), 2000);
        assert_eq!(interval_total(&intervals, 500, i64::MIN, i64::MAX), 0);
        assert_eq!(duration_text(3661000), "01:01:01");
        assert_eq!(duration_text(100 * 3600000), "100:00:00");
    }
}
