//! Validate the real macOS WebView asset protocol using isolated app data.
use std::{
    fs,
    sync::atomic::{AtomicBool, Ordering},
    time::Duration,
};
use tauri::{
    utils::config::{AppDirectoriesOverride, AppDirectoryOverrides},
    Manager,
};
static REPORTED: AtomicBool = AtomicBool::new(false);
#[tauri::command]
fn music_smoke_report(app: tauri::AppHandle, success: bool, detail: String) {
    if REPORTED.swap(true, Ordering::SeqCst) {
        return;
    }
    if success {
        println!("PASS: native WebKit decoded local WAV through the scoped asset protocol");
        app.exit(0);
    } else {
        eprintln!("Native music smoke test failed: {detail}");
        app.exit(1);
    }
}
fn main() {
    let temporary =
        std::env::temp_dir().join(format!("fishtime-native-music-{}", std::process::id()));
    let mut context = tauri::generate_context!();
    context.config_mut().app.windows.clear();
    context.config_mut().identifier = format!("com.fishtime.music-smoke-{}", std::process::id());
    context.config_mut().app.app_directories_override =
        Some(AppDirectoriesOverride::Directories(AppDirectoryOverrides {
            data: Some(temporary.join("data")),
            local_data: Some(temporary.join("local")),
            cache: Some(temporary.join("cache")),
            config: Some(temporary.join("config")),
            log: Some(temporary.join("log")),
        }));
    tauri::Builder::default().invoke_handler(tauri::generate_handler![music_smoke_report]).setup(move|app|{
        app.set_activation_policy(tauri::ActivationPolicy::Accessory);
        let music=app.path().app_data_dir()?.join("music");fs::create_dir_all(&music)?;
        let mut wave=Vec::new();let length=22050u32*2;
        wave.extend(b"RIFF");wave.extend((length+36).to_le_bytes());wave.extend(b"WAVEfmt ");wave.extend(16u32.to_le_bytes());wave.extend(1u16.to_le_bytes());wave.extend(1u16.to_le_bytes());wave.extend(22050u32.to_le_bytes());wave.extend(44100u32.to_le_bytes());wave.extend(2u16.to_le_bytes());wave.extend(16u16.to_le_bytes());wave.extend(b"data");wave.extend(length.to_le_bytes());wave.resize(44+length as usize,0);
        let sample=music.join("silence.wav");fs::write(&sample,&wave)?;
        let outside=temporary.join("outside.wav");fs::write(&outside,&wave)?;
        assert!(app.asset_protocol_scope().is_allowed(&sample));
        assert!(!app.asset_protocol_scope().is_allowed(&outside));
        let script=format!(r#"document.addEventListener('DOMContentLoaded',()=>{{const sound=new Audio();window.__nativeMusicTestAudio=sound;sound.onloadedmetadata=()=>window.__TAURI__.core.invoke('music_smoke_report',{{success:sound.duration>0,detail:String(sound.duration)}});sound.onerror=()=>window.__TAURI__.core.invoke('music_smoke_report',{{success:false,detail:'audio error '+sound.error?.code}});sound.src=window.__TAURI__.core.convertFileSrc({});sound.load();}});"#,serde_json::to_string(&sample.to_string_lossy())?);
        tauri::WebviewWindowBuilder::new(app,"main",tauri::WebviewUrl::App("index.html".into())).visible(false).data_directory(temporary.join("webview")).initialization_script(script).build()?;
        let handle=app.handle().clone();std::thread::spawn(move||{std::thread::sleep(Duration::from_secs(25));if !REPORTED.load(Ordering::SeqCst){eprintln!("Native audio metadata timed out");handle.exit(1);}});
        Ok(())
    }).run(context).expect("Unable to run isolated music smoke test");
}
