//! Installs a signed release into a disposable .app copy, never the user's app.
use std::{path::PathBuf, process::Command, time::Duration};
use tauri_plugin_updater::UpdaterExt;

fn main() {
    let original = PathBuf::from(
        std::env::var("FISHTIME_UPDATE_TEST_APP")
            .expect("Set FISHTIME_UPDATE_TEST_APP to a built .app"),
    );
    let temporary = std::env::temp_dir()
        .join(format!("fishtime-update-test-{}", std::process::id()))
        .join("FishTime.app");
    assert!(Command::new("/usr/bin/ditto")
        .arg(original)
        .arg(&temporary)
        .status()
        .unwrap()
        .success());
    let endpoint =
        std::env::var("FISHTIME_UPDATE_TEST_ENDPOINT").expect("Set an HTTPS manifest endpoint");
    assert!(endpoint.starts_with("https://github.com/pxxiao-hz/FishTime/"));
    let mut context = tauri::generate_context!();
    context.config_mut().app.windows.clear();
    tauri::Builder::default().plugin(tauri_plugin_updater::Builder::new().build()).setup(move |app| {
        app.set_activation_policy(tauri::ActivationPolicy::Accessory);
        let handle=app.handle().clone();
        tauri::async_runtime::spawn(async move {
            let result:Result<(),Box<dyn std::error::Error+Send+Sync>>=async {
                let update=handle.updater_builder().timeout(Duration::from_secs(180))
                    .executable_path(temporary.join("Contents/MacOS/fishtime"))
                    .endpoints(vec![endpoint.parse()?])?.version_comparator(|_,_|true).build()?.check().await?.ok_or("No test update")?;
                let bytes=update.download(|_,_|{},||{}).await?;
                let mut tampered=bytes.clone();tampered[0]^=1;
                assert!(update.verify(&tampered).is_err(),"tampered archive accepted");
                update.verify(&bytes)?;
                update.install(&bytes)?;
                assert!(Command::new("/usr/bin/codesign").args(["--verify","--deep","--strict"]).arg(&temporary).status()?.success());
                println!("PASS: HTTPS check, signed download, tamper rejection, install into disposable app, codesign verification");
                Ok(())
            }.await;
            if let Err(error)=result {eprintln!("Updater smoke test failed: {error}");handle.exit(1);} else {handle.exit(0);}
        });
        Ok(())
    }).run(context).expect("Unable to run updater smoke test");
}
