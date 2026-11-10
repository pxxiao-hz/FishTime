//! Check actual AppKit status-button widths without opening user data/windows.
#[allow(dead_code)]
#[path = "../src/tray.rs"]
mod tray;
mod updates {
    pub fn installing(_: &tauri::AppHandle) -> bool {
        false
    }
}
fn main() {
    let mut context = tauri::generate_context!();
    context.config_mut().app.windows.clear();
    tauri::Builder::default().setup(|app|{
        app.set_activation_policy(tauri::ActivationPolicy::Accessory);
        tray::setup(app)?;let icon=app.tray_by_id("timer").unwrap();let mut widths=vec![];
        for title in ["▶ 00:00:00","▶ 11:11:11","▶ 09:59:59","▶ 10:00:00"]{
            icon.set_title(Some(title))?;
            let width=icon.with_inner_tray_icon(|inner|{
                let mtm=objc2::MainThreadMarker::new().unwrap();let button=inner.ns_status_item().unwrap().button(mtm).unwrap();
                button.sizeToFit();button.frame().size.width
            })?;assert!(width>0.0);widths.push(width);
        }
        let first=widths[0];assert!(widths.iter().all(|width|(width-first).abs()<0.01),"digit widths changed: {widths:?}");
        println!("PASS: native status-button widths are fixed for zeros, ones and rollovers: {widths:?}");
        app.handle().exit(0);Ok(())
    }).run(context).expect("Unable to test status button");
}
