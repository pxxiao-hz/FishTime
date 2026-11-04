use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

const EXTENSIONS: &[&str] = &["mp3", "m4a", "wav", "aac", "aif", "aiff", "flac"];
const MAX_BYTES: u64 = 200 * 1024 * 1024;
static SEQUENCE: AtomicU64 = AtomicU64::new(0);
#[derive(Default)]
pub struct MusicState(pub Mutex<()>);
#[derive(Clone, Serialize, Deserialize)]
struct Track {
    id: String,
    name: String,
    file: String,
    bytes: u64,
}
#[derive(Serialize, Deserialize)]
struct Library {
    version: u8,
    tracks: Vec<Track>,
}
#[derive(Serialize)]
pub struct TrackView {
    id: String,
    name: String,
    bytes: u64,
    available: bool,
    path: Option<String>,
}
#[derive(Serialize)]
pub struct LibraryView {
    tracks: Vec<TrackView>,
    added: usize,
    duplicates: usize,
    errors: Vec<String>,
    last_id: Option<String>,
}

fn scratch(root: &Path, kind: &str) -> PathBuf {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    root.join(format!(
        ".{kind}-{now}-{}",
        SEQUENCE.fetch_add(1, Ordering::Relaxed)
    ))
}
fn media_path(root: &Path, track: &Track) -> Result<PathBuf, String> {
    let valid_id = track
        .id
        .strip_prefix("track-")
        .is_some_and(|hash| hash.len() == 64 && hash.bytes().all(|c| c.is_ascii_hexdigit()));
    let extension = Path::new(&track.file)
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("");
    if !valid_id
        || !EXTENSIONS.contains(&extension)
        || track.file != format!("{}.{}", track.id, extension)
    {
        return Err("invalid_library".into());
    }
    Ok(root.join(&track.file))
}
fn regular_file(path: &Path) -> bool {
    fs::symlink_metadata(path).is_ok_and(|metadata| metadata.file_type().is_file())
}
fn load(root: &Path) -> Result<Library, String> {
    fs::create_dir_all(root).map_err(|_| "library_unavailable")?;
    if fs::symlink_metadata(root)
        .map_err(|_| "library_unavailable")?
        .file_type()
        .is_symlink()
    {
        return Err("invalid_library".into());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(root, fs::Permissions::from_mode(0o700))
            .map_err(|_| "library_unavailable")?;
    }
    let manifest = root.join("library.json");
    if !manifest.exists() {
        return Ok(Library {
            version: 1,
            tracks: vec![],
        });
    }
    if !regular_file(&manifest) {
        return Err("invalid_library".into());
    }
    let library: Library =
        serde_json::from_slice(&fs::read(&manifest).map_err(|_| "library_unavailable")?)
            .map_err(|_| "invalid_library")?;
    if library.version != 1 {
        return Err("invalid_library".into());
    }
    for track in &library.tracks {
        let path = media_path(root, track)?;
        let staged = root.join(format!(".delete-{}", track.file));
        // A crash between staging deletion and writing metadata must not lose a track.
        if !path.exists() && regular_file(&staged) {
            fs::rename(staged, path).map_err(|_| "library_unavailable")?;
        }
    }
    Ok(library)
}
fn save(root: &Path, library: &Library) -> Result<(), String> {
    let temp = scratch(root, "library");
    let result = (|| {
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)
            .map_err(|_| "save_failed")?;
        file.write_all(&serde_json::to_vec_pretty(library).map_err(|_| "save_failed")?)
            .map_err(|_| "save_failed")?;
        file.sync_all().map_err(|_| "save_failed")?;
        fs::rename(&temp, root.join("library.json")).map_err(|_| "save_failed")?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(temp);
    }
    result
}
fn view(root: &Path, library: &Library) -> Result<LibraryView, String> {
    let tracks = library
        .tracks
        .iter()
        .map(|track| {
            let path = media_path(root, track)?;
            let available = regular_file(&path);
            Ok(TrackView {
                id: track.id.clone(),
                name: track.name.clone(),
                bytes: track.bytes,
                available,
                path: available.then(|| path.to_string_lossy().into_owned()),
            })
        })
        .collect::<Result<Vec<_>, String>>()?;
    Ok(LibraryView {
        tracks,
        added: 0,
        duplicates: 0,
        errors: vec![],
        last_id: None,
    })
}
fn copy_track(root: &Path, source: &Path) -> Result<(Track, PathBuf), String> {
    let extension = source
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if !EXTENSIONS.contains(&extension.as_str()) {
        return Err("unsupported_format".into());
    }
    let mut input = fs::File::open(source).map_err(|_| "read_failed")?;
    let size = input.metadata().map_err(|_| "read_failed")?.len();
    if size == 0 || size > MAX_BYTES {
        return Err("invalid_size".into());
    }
    let temp = scratch(root, "import");
    let result = (|| {
        let mut output = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)
            .map_err(|_| "save_failed")?;
        let mut hash = Sha256::new();
        let mut total = 0u64;
        let mut buffer = [0u8; 65536];
        loop {
            let count = input.read(&mut buffer).map_err(|_| "read_failed")?;
            if count == 0 {
                break;
            }
            total += count as u64;
            if total > MAX_BYTES {
                return Err("invalid_size".into());
            }
            hash.update(&buffer[..count]);
            output
                .write_all(&buffer[..count])
                .map_err(|_| "save_failed")?;
        }
        output.sync_all().map_err(|_| "save_failed")?;
        let id = format!("track-{:x}", hash.finalize());
        let name = source
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("Music")
            .chars()
            .take(100)
            .collect();
        Ok(Track {
            id: id.clone(),
            name,
            file: format!("{id}.{extension}"),
            bytes: total,
        })
    })();
    match result {
        Ok(track) => Ok((track, temp)),
        Err(error) => {
            let _ = fs::remove_file(temp);
            Err(error)
        }
    }
}
fn import_paths(root: &Path, sources: &[PathBuf]) -> Result<LibraryView, String> {
    let mut library = load(root)?;
    let mut added_paths = vec![];
    let mut duplicates = 0;
    let mut errors = vec![];
    let mut last_id = None;
    for source in sources {
        if library.tracks.len() >= 1000 {
            errors.push("library_full".into());
            break;
        }
        match copy_track(root, source) {
            Ok((track, temp)) => {
                if let Some(existing) = library.tracks.iter().find(|item| item.id == track.id) {
                    if regular_file(&media_path(root, existing)?) {
                        duplicates += 1;
                        last_id = Some(existing.id.clone());
                        let _ = fs::remove_file(temp);
                        continue;
                    }
                    // Re-importing the source repairs a missing library copy.
                    let path = media_path(root, existing)?;
                    fs::rename(&temp, path).map_err(|_| "save_failed")?;
                    last_id = Some(existing.id.clone());
                    continue;
                }
                let path = media_path(root, &track)?;
                if let Err(_) = fs::rename(&temp, &path) {
                    let _ = fs::remove_file(temp);
                    errors.push("save_failed".into());
                    continue;
                }
                added_paths.push(path);
                last_id = Some(track.id.clone());
                library.tracks.push(track);
            }
            Err(error) => errors.push(error),
        }
    }
    if let Err(error) = save(root, &library) {
        for path in added_paths {
            let _ = fs::remove_file(path);
        }
        return Err(error);
    }
    let mut result = view(root, &library)?;
    result.added = added_paths.len();
    result.duplicates = duplicates;
    result.errors = errors;
    result.last_id = last_id;
    Ok(result)
}
fn rename_track(root: &Path, id: &str, name: &str) -> Result<LibraryView, String> {
    let name = name.trim();
    if name.is_empty() || name.chars().count() > 100 {
        return Err("invalid_name".into());
    }
    let mut library = load(root)?;
    library
        .tracks
        .iter_mut()
        .find(|track| track.id == id)
        .ok_or("track_missing")?
        .name = name.into();
    save(root, &library)?;
    view(root, &library)
}
fn remove_track(root: &Path, id: &str) -> Result<LibraryView, String> {
    let mut library = load(root)?;
    let index = library
        .tracks
        .iter()
        .position(|track| track.id == id)
        .ok_or("track_missing")?;
    let track = library.tracks.remove(index);
    let path = media_path(root, &track)?;
    let staged = root.join(format!(".delete-{}", track.file));
    let moved = regular_file(&path);
    if moved {
        fs::rename(&path, &staged).map_err(|_| "remove_failed")?;
    }
    if let Err(error) = save(root, &library) {
        if moved {
            let _ = fs::rename(&staged, &path);
        }
        return Err(error);
    }
    if moved {
        let _ = fs::remove_file(staged);
    }
    view(root, &library)
}
fn root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|_| "library_unavailable")?
        .join("music"))
}

#[tauri::command]
pub async fn music_list(app: tauri::AppHandle) -> Result<LibraryView, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<MusicState>();
        let _lock = state.0.lock().unwrap();
        let root = root(&app)?;
        view(&root, &load(&root)?)
    })
    .await
    .map_err(|_| "library_unavailable")?
}
#[tauri::command]
pub async fn music_import(app: tauri::AppHandle) -> Result<LibraryView, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let paths = app
            .dialog()
            .file()
            .add_filter("Audio", EXTENSIONS)
            .blocking_pick_files()
            .unwrap_or_default();
        let paths = paths
            .into_iter()
            .filter_map(|file| file.into_path().ok())
            .collect::<Vec<_>>();
        let state = app.state::<MusicState>();
        let _lock = state.0.lock().unwrap();
        import_paths(&root(&app)?, &paths)
    })
    .await
    .map_err(|_| "library_unavailable")?
}
#[tauri::command]
pub async fn music_rename(
    app: tauri::AppHandle,
    id: String,
    name: String,
) -> Result<LibraryView, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<MusicState>();
        let _lock = state.0.lock().unwrap();
        rename_track(&root(&app)?, &id, &name)
    })
    .await
    .map_err(|_| "library_unavailable")?
}
#[tauri::command]
pub async fn music_remove(app: tauri::AppHandle, id: String) -> Result<LibraryView, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<MusicState>();
        let _lock = state.0.lock().unwrap();
        remove_track(&root(&app)?, &id)
    })
    .await
    .map_err(|_| "library_unavailable")?
}
#[tauri::command]
pub fn music_open_folder(app: tauri::AppHandle) -> Result<(), String> {
    let state = app.state::<MusicState>();
    let _lock = state.0.lock().unwrap();
    let root = root(&app)?;
    fs::create_dir_all(&root).map_err(|_| "library_unavailable")?;
    if fs::symlink_metadata(&root)
        .map_err(|_| "library_unavailable")?
        .file_type()
        .is_symlink()
    {
        return Err("invalid_library".into());
    }
    std::process::Command::new("/usr/bin/open")
        .arg(root)
        .spawn()
        .map_err(|_| "library_unavailable")?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn workspace() -> PathBuf {
        let path = scratch(&std::env::temp_dir(), "fishtime-music-test");
        fs::create_dir_all(&path).unwrap();
        path
    }
    #[test]
    fn imports_are_copies_persist_rename_deduplicate_and_remove_without_touching_originals() {
        let dir = workspace();
        let root = dir.join("music");
        let source = dir.join("Original.wav");
        fs::write(&source, b"RIFF-test-wave").unwrap();
        let result = import_paths(&root, &[source.clone()]).unwrap();
        assert_eq!(result.added, 1);
        let id = result.tracks[0].id.clone();
        let copied = PathBuf::from(result.tracks[0].path.clone().unwrap());
        assert_eq!(fs::read(&copied).unwrap(), fs::read(&source).unwrap());
        assert_eq!(
            import_paths(&root, &[source.clone()]).unwrap().duplicates,
            1
        );
        rename_track(&root, &id, "My track").unwrap();
        assert_eq!(load(&root).unwrap().tracks[0].name, "My track");
        fs::remove_file(&source).unwrap();
        assert!(view(&root, &load(&root).unwrap()).unwrap().tracks[0].available);
        fs::write(&source, b"RIFF-test-wave").unwrap();
        remove_track(&root, &id).unwrap();
        assert!(source.exists());
        assert!(!copied.exists());
        assert!(load(&root).unwrap().tracks.is_empty());
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn missing_files_can_be_repaired_and_path_traversal_is_rejected() {
        let dir = workspace();
        let root = dir.join("music");
        let source = dir.join("Original.mp3");
        fs::write(&source, b"ID3-test").unwrap();
        let result = import_paths(&root, &[source.clone()]).unwrap();
        fs::remove_file(result.tracks[0].path.as_ref().unwrap()).unwrap();
        assert!(!view(&root, &load(&root).unwrap()).unwrap().tracks[0].available);
        assert!(import_paths(&root, &[source]).unwrap().tracks[0].available);
        let malicious = Track {
            id: "../outside".into(),
            name: "bad".into(),
            file: "../outside.mp3".into(),
            bytes: 1,
        };
        assert!(media_path(&root, &malicious).is_err());
        assert!(rename_track(&root, &result.tracks[0].id, " ").is_err());
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn invalid_or_corrupt_libraries_are_not_silently_overwritten() {
        let dir = workspace();
        let root = dir.join("music");
        load(&root).unwrap();
        fs::write(root.join("library.json"), "broken").unwrap();
        assert!(load(&root).is_err());
        assert_eq!(
            fs::read_to_string(root.join("library.json")).unwrap(),
            "broken"
        );
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn interrupted_deletion_restores_a_referenced_copy() {
        let dir = workspace();
        let root = dir.join("music");
        let source = dir.join("Original.wav");
        fs::write(&source, b"RIFF-recovery").unwrap();
        import_paths(&root, &[source]).unwrap();
        let library = load(&root).unwrap();
        let track = &library.tracks[0];
        let path = media_path(&root, track).unwrap();
        let staged = root.join(format!(".delete-{}", track.file));
        fs::rename(&path, &staged).unwrap();
        assert!(load(&root).unwrap().tracks.len() == 1);
        assert!(path.exists());
        assert!(!staged.exists());
        fs::remove_dir_all(dir).unwrap();
    }
}
