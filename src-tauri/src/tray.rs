use chrono::{Datelike, Local, NaiveDate, TimeZone};
use serde::{Deserialize, Serialize};
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
    #[serde(default)]
    reminder: Reminder,
}

#[derive(Clone, Default, Deserialize)]
pub struct Reminder {
    enabled: bool,
    after_ms: u64,
    next_at_ms: Option<i64>,
    presented: bool,
}
#[derive(Clone, Serialize)]
struct ReminderEvent {
    workspace: String,
    started_ms: i64,
}

pub struct TrayState {
    snapshot: Mutex<Option<Snapshot>>,
    last_frame: Mutex<Option<(u64, u64, u64, String)>>,
    last_reminder: Mutex<Option<(String, i64, i64, i64)>>,
    update_version: Mutex<Option<String>>,
    status: MenuItem<tauri::Wry>,
    workspace: MenuItem<tauri::Wry>,
    session: MenuItem<tauri::Wry>,
    today: MenuItem<tauri::Wry>,
    month: MenuItem<tauri::Wry>,
    forecast: MenuItem<tauri::Wry>,
    start: MenuItem<tauri::Wry>,
    pause: MenuItem<tauri::Wry>,
    stop: MenuItem<tauri::Wry>,
    open: MenuItem<tauri::Wry>,
    about: MenuItem<tauri::Wry>,
    settings: MenuItem<tauri::Wry>,
    update: MenuItem<tauri::Wry>,
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

pub fn configure_counter_font(tray: &tauri::tray::TrayIcon) -> tauri::Result<()> {
    #[cfg(target_os = "macos")]
    tray.with_inner_tray_icon(|inner| {
        let mtm = objc2::MainThreadMarker::new().expect("tray callback must run on main thread");
        if let Some(button) = inner.ns_status_item().and_then(|item| item.button(mtm)) {
            let size = button
                .font()
                .map(|font| font.pointSize())
                .filter(|size| *size > 0.0)
                .unwrap_or(13.0);
            let font = objc2_app_kit::NSFont::monospacedDigitSystemFontOfSize_weight(size, 0.0);
            button.setFont(Some(&font));
        }
    })?;
    Ok(())
}

fn month_totals(
    snapshot: &Snapshot,
    now: i64,
    start: i64,
    end: i64,
    date: &str,
    elapsed_days: u32,
    month_days: u32,
) -> (u64, Option<u64>) {
    let prefix = &date[..7];
    let month = snapshot
        .daily_totals
        .iter()
        .filter(|(day, _)| day.starts_with(prefix))
        .map(|(_, ms)| *ms)
        .sum::<u64>()
        + interval_total(&snapshot.intervals, now, start, end);
    let to_date = snapshot
        .daily_totals
        .iter()
        .filter(|(day, _)| day.starts_with(prefix) && day.as_str() <= date)
        .map(|(_, ms)| *ms)
        .sum::<u64>()
        + interval_total(&snapshot.intervals, now, start, now);
    (
        month,
        (to_date > 0).then(|| {
            (to_date as f64 / elapsed_days.max(1) as f64 * month_days as f64).round() as u64
        }),
    )
}
fn reminder_due(snapshot: &Snapshot, now: i64) -> Option<(i64, i64)> {
    let settings = &snapshot.reminder;
    if !settings.enabled
        || settings.presented
        || snapshot.state != "running"
        || !(60_000..=86_400_000).contains(&settings.after_ms)
    {
        return None;
    }
    let segment = snapshot.intervals.last()?;
    if segment.end_ms.is_some() {
        return None;
    }
    let due = (segment.start_ms.saturating_add(settings.after_ms as i64))
        .max(settings.next_at_ms.unwrap_or(0));
    (now >= due).then_some((segment.start_ms, due))
}

pub fn show_main(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

pub fn request_quit(app: &tauri::AppHandle) {
    if crate::updates::installing(app) {
        show_main(app);
        return;
    }
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
pub fn show_reminder_window(app: tauri::AppHandle) {
    let ready = app
        .state::<TrayState>()
        .snapshot
        .lock()
        .unwrap()
        .as_ref()
        .is_some_and(|snapshot| snapshot.reminder.enabled && snapshot.state == "running");
    if ready && !crate::updates::installing(&app) {
        show_main(&app);
    }
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

#[tauri::command]
pub fn set_update_badge(app: tauri::AppHandle, version: Option<String>) -> Result<(), String> {
    if version.as_ref().is_some_and(|value| {
        value.is_empty()
            || value.len() > 64
            || !value
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || b".+-".contains(&c))
    }) {
        return Err("invalid_update_version".into());
    }
    let state = app.state::<TrayState>();
    *state.update_version.lock().unwrap() = version;
    *state.last_frame.lock().unwrap() = None;
    refresh(&app);
    Ok(())
}

fn refresh(app: &tauri::AppHandle) {
    let state = app.state::<TrayState>();
    let snapshot = state.snapshot.lock().unwrap().clone();
    let Some(snapshot) = snapshot else { return };
    let en = snapshot.language == "en";
    let update_version = state.update_version.lock().unwrap().clone();
    let now = Local::now();
    let now_ms = now.timestamp_millis();
    let date = now.date_naive();
    let date_key = date.to_string();
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
    let start_date = NaiveDate::from_ymd_opt(date.year(), date.month(), 1).unwrap();
    let next_date = if date.month() == 12 {
        NaiveDate::from_ymd_opt(date.year() + 1, 1, 1).unwrap()
    } else {
        NaiveDate::from_ymd_opt(date.year(), date.month() + 1, 1).unwrap()
    };
    let boundary = |date: NaiveDate| {
        Local
            .from_local_datetime(&date.and_hms_opt(0, 0, 0).unwrap())
            .earliest()
            .map(|time| time.timestamp_millis())
            .unwrap_or(now_ms)
    };
    let (month, forecast) = month_totals(
        &snapshot,
        now_ms,
        boundary(start_date),
        boundary(next_date),
        &date_key,
        date.day(),
        (next_date - start_date).num_days() as u32,
    );
    if !snapshot.reminder.enabled || snapshot.state != "running" {
        *state.last_reminder.lock().unwrap() = None;
    }
    if let Some((started, due)) = reminder_due(&snapshot, now_ms) {
        let mut last = state.last_reminder.lock().unwrap();
        let repeat = last.as_ref().is_some_and(|(ws, start, target, sent)| {
            ws == &snapshot.workspace
                && *start == started
                && *target == due
                && now_ms - *sent < 60_000
        });
        if !repeat && !crate::updates::installing(app) {
            *last = Some((snapshot.workspace.clone(), started, due, now_ms));
            drop(last);
            // Wake a hidden WebView before delivering the reminder event.
            show_main(app);
            let _ = app.emit_to(
                "main",
                "timer:rest-reminder",
                ReminderEvent {
                    workspace: snapshot.workspace.clone(),
                    started_ms: started,
                },
            );
        }
    }
    let frame = (snapshot.revision, elapsed / 1000, today / 1000, date_key);
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
    let mut title = if active {
        format!(
            "{} {}",
            if running { "▶" } else { "Ⅱ" },
            duration_text(elapsed)
        )
    } else {
        "FishTime".to_string()
    };
    if update_version.is_some() {
        title.push_str(" •");
    }
    if let Some(tray) = app.tray_by_id("timer") {
        let _ = tray.set_title(Some(&title));
        let tooltip = match &update_version {
            Some(version) => format!(
                "FishTime · {status} · {} {version}",
                if en {
                    "Update available"
                } else {
                    "有新版本"
                }
            ),
            None => format!("FishTime · {status}"),
        };
        let _ = tray.set_tooltip(Some(tooltip));
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
    let _ = state.month.set_text(format!(
        "{}: {}",
        if en { "This month" } else { "本月累计" },
        duration_text(month)
    ));
    let _ = state.forecast.set_text(format!(
        "{}: {}",
        if en { "Month estimate" } else { "本月预估" },
        forecast.map(duration_text).unwrap_or_else(|| if en {
            "No data".into()
        } else {
            "暂无数据".into()
        })
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
    let update_label = match &update_version {
        Some(version) => format!(
            "{} {version}…",
            if en {
                "Update available"
            } else {
                "发现新版本"
            }
        ),
        None => {
            if en {
                "Check for Updates…".into()
            } else {
                "检查更新…".into()
            }
        }
    };
    let _ = state.update.set_text(update_label);
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
    let month = info("tray:month", "本月累计: 00:00:00")?;
    let forecast = info("tray:forecast", "本月预估: 暂无数据")?;
    let start = info("tray:start", "开始计时")?;
    let pause = info("tray:pause", "暂停计时")?;
    let stop = info("tray:stop", "结束并保存")?;
    let open = MenuItemBuilder::with_id("tray:open", "打开 FishTime").build(app)?;
    let about = MenuItemBuilder::with_id("tray:about", "About FishTime").build(app)?;
    let settings = MenuItemBuilder::with_id("tray:settings", "设置").build(app)?;
    let update = MenuItemBuilder::with_id("tray:update", "检查更新…").build(app)?;
    let quit = MenuItemBuilder::with_id("tray:quit", "退出 FishTime").build(app)?;
    let menu = MenuBuilder::new(app)
        .items(&[&status, &workspace, &session, &today, &month, &forecast])
        .separator()
        .items(&[&start, &pause, &stop])
        .separator()
        .items(&[&open, &settings, &update, &about])
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
    let tray = TrayIconBuilder::with_id("timer")
        .icon(tauri::image::Image::new_owned(pixels, 22, 22))
        .icon_as_template(true)
        .title("FishTime")
        .tooltip("FishTime")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .build(app)?;
    configure_counter_font(&tray)?;
    app.manage(TrayState {
        snapshot: Mutex::new(None),
        last_frame: Mutex::new(None),
        last_reminder: Mutex::new(None),
        update_version: Mutex::new(None),
        status,
        workspace,
        session,
        today,
        month,
        forecast,
        start,
        pause,
        stop,
        open,
        about,
        settings,
        update,
        quit,
    });
    let handle = app.handle().clone();
    std::thread::spawn(move || {
        let mut seconds = 0u8;
        loop {
            std::thread::sleep(Duration::from_secs(1));
            let app = handle.clone();
            if handle.run_on_main_thread(move || refresh(&app)).is_err() {
                break;
            }
            seconds += 1;
            if seconds >= 60 {
                seconds = 0;
                let _ = handle.emit_to("main", "updater:tick", ());
            }
        }
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn snapshot() -> Snapshot {
        serde_json::from_value(serde_json::json!({"revision":1,"workspace":"default","language":"zh","state":"running","intervals":[{"start_ms":1000,"end_ms":null}],"daily_totals":{}})).unwrap()
    }
    #[test]
    fn month_estimate_matches_calendar_day_average_and_clips_cross_month_time() {
        let mut value = snapshot();
        value.daily_totals.insert("2024-02-02".into(), 3600000);
        value.daily_totals.insert("2024-02-29".into(), 3600000);
        value.daily_totals.insert("2024-01-31".into(), 99999999);
        let (month, forecast) = month_totals(&value, 10000, 0, 20000, "2024-02-15", 15, 29);
        assert_eq!(month, 7209000);
        assert_eq!(forecast, Some((3609000f64 / 15.0 * 29.0).round() as u64));
        value.daily_totals.clear();
        value.intervals[0].start_ms = -1000;
        assert_eq!(
            month_totals(&value, 10000, 0, 20000, "2024-02-29", 29, 29),
            (10000, Some(10000))
        );
    }
    #[test]
    fn reminders_are_opt_in_and_honor_snooze_pause_and_presented_state() {
        let mut value = snapshot();
        assert_eq!(reminder_due(&value, 99999999), None);
        value.reminder = Reminder {
            enabled: true,
            after_ms: 60000,
            next_at_ms: None,
            presented: false,
        };
        assert_eq!(reminder_due(&value, 60999), None);
        assert_eq!(reminder_due(&value, 61000), Some((1000, 61000)));
        value.reminder.next_at_ms = Some(120000);
        assert_eq!(reminder_due(&value, 119999), None);
        assert_eq!(reminder_due(&value, 120000), Some((1000, 120000)));
        value.reminder.presented = true;
        assert_eq!(reminder_due(&value, 120000), None);
        value.reminder.presented = false;
        value.state = "paused".into();
        assert_eq!(reminder_due(&value, 120000), None);
    }

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
