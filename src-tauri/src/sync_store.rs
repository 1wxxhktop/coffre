//! Synchronisation par dossier partagé.
//!
//! L’utilisateur choisit un dossier déjà synchronisé (iCloud Drive, Dropbox,
//! Syncthing, clé USB…). Coffre y crée `Coffre/<idFichier>/` et chaque appareil
//! n’écrit que son propre fichier `.coffre`.
//!
//! Toutes les commandes valident le dossier et n’acceptent qu’un nom de fichier
//! simple (aucun séparateur, aucune remontée `..`). Les fichiers sont écrits de
//! façon atomique avec des permissions `0600`.

use std::fs::{self, File, OpenOptions};
use std::io::{ErrorKind, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::mpsc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use notify::{RecursiveMode, Watcher};
use serde::Serialize;

const MAX_SYNC_BYTES: u64 = 100 * 1024 * 1024;
const MAX_NAME_BYTES: usize = 200;
const WATCH_DEBOUNCE_MS: u64 = 500;
const README_TEXT: &str = "\
Coffre — synchronisation locale
================================

Ce dossier contient un fichier .coffre par appareil. Chaque appareil n’écrit
que son propre fichier et lit les autres pour les fusionner.

Ne modifiez pas ces fichiers à la main. Ne les mettez pas dans un dossier
partagé avec des personnes que vous ne souhaitez pas voir accéder à vos
métadonnées chiffrées.

Aucun serveur Coffre n’intervient : la synchronisation utilise uniquement le
service de fichiers choisi par l’utilisateur.
";

#[derive(Default)]
pub struct SyncState {
    watcher: std::sync::Mutex<Option<notify::RecommendedWatcher>>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncFileInfo {
    pub name: String,
    pub size: u64,
    pub modified_at: Option<u64>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SyncChanged {
    dir: String,
}

#[cfg(unix)]
fn set_mode(path: &Path, mode: u32) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(mode)).map_err(|error| error.to_string())
}

#[cfg(not(unix))]
fn set_mode(_path: &Path, _mode: u32) -> Result<(), String> {
    Ok(())
}

fn canonical_directory(dir: &str) -> Result<PathBuf, String> {
    if dir.trim().is_empty() {
        return Err("Dossier de synchronisation vide".into());
    }
    let path =
        fs::canonicalize(dir).map_err(|_| "Dossier de synchronisation introuvable".to_string())?;
    let metadata = fs::metadata(&path).map_err(|error| error.to_string())?;
    if !metadata.is_dir() {
        return Err("Le chemin de synchronisation n’est pas un dossier".into());
    }
    Ok(path)
}

fn validate_file_id(file_id: &str) -> Result<(), String> {
    if file_id.is_empty()
        || file_id.len() > 80
        || !file_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
    {
        return Err("Identifiant de coffre invalide pour la synchronisation".into());
    }
    Ok(())
}

fn validate_name(name: &str) -> Result<(), String> {
    if name.is_empty() || name.len() > MAX_NAME_BYTES {
        return Err("Nom de fichier de synchronisation invalide".into());
    }
    let path = Path::new(name);
    let mut components = path.components();
    let first = components.next();
    if components.next().is_some()
        || !matches!(first, Some(Component::Normal(_)))
        || !name.ends_with(".coffre")
    {
        return Err("Nom de fichier de synchronisation invalide".into());
    }
    let stem = &name[..name.len() - ".coffre".len()];
    if stem.is_empty()
        || !stem
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
    {
        return Err("Nom de fichier de synchronisation invalide".into());
    }
    Ok(())
}

fn entry_path(dir: &Path, name: &str) -> Result<PathBuf, String> {
    validate_name(name)?;
    Ok(dir.join(name))
}

fn modified_ms(metadata: &fs::Metadata) -> Option<u64> {
    metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as u64)
}

/// Crée `Coffre/<idFichier>/` sous le dossier choisi et y dépose un README.
pub fn prepare(base: &str, file_id: &str) -> Result<String, String> {
    validate_file_id(file_id)?;
    let base = canonical_directory(base)?;
    let coffre = base.join("Coffre");
    fs::create_dir_all(&coffre).map_err(|error| error.to_string())?;
    set_mode(&coffre, 0o700)?;

    let dir = coffre.join(file_id);
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    set_mode(&dir, 0o700)?;

    // Un dossier existant pourrait être un lien symbolique vers l’extérieur.
    let canonical = fs::canonicalize(&dir).map_err(|error| error.to_string())?;
    if !canonical.starts_with(&base) {
        return Err("Le dossier de synchronisation sort du dossier choisi".into());
    }

    let readme = canonical.join("README.txt");
    match fs::symlink_metadata(&readme) {
        Ok(metadata) if metadata.file_type().is_symlink() => {
            return Err("Le README de synchronisation est un lien symbolique".into());
        }
        Ok(_) => {}
        Err(error) if error.kind() == ErrorKind::NotFound => {
            let mut file = OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&readme)
                .map_err(|error| error.to_string())?;
            file.write_all(README_TEXT.as_bytes())
                .map_err(|error| error.to_string())?;
            file.flush().map_err(|error| error.to_string())?;
            drop(file);
            set_mode(&readme, 0o600)?;
        }
        Err(error) => return Err(error.to_string()),
    }

    Ok(canonical.to_string_lossy().into_owned())
}

/// Liste les fichiers `.coffre` du dossier, triés par nom.
pub fn list(dir: &str) -> Result<Vec<SyncFileInfo>, String> {
    let dir = canonical_directory(dir)?;
    let mut files = Vec::new();
    for entry in fs::read_dir(&dir).map_err(|error| error.to_string())? {
        let entry = match entry {
            Ok(entry) => entry,
            Err(_) => continue,
        };
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if validate_name(&name).is_err() {
            continue;
        }
        let metadata = match fs::symlink_metadata(entry.path()) {
            Ok(metadata) => metadata,
            Err(_) => continue,
        };
        if !metadata.file_type().is_file() || metadata.len() > MAX_SYNC_BYTES {
            continue;
        }
        files.push(SyncFileInfo {
            name: name.into_owned(),
            size: metadata.len(),
            modified_at: modified_ms(&metadata),
        });
    }
    files.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(files)
}

/// Lit un fichier `.coffre` du dossier. Refuse les liens symboliques.
pub fn read(dir: &str, name: &str) -> Result<Option<String>, String> {
    let dir = canonical_directory(dir)?;
    let path = entry_path(&dir, name)?;
    let metadata = match fs::symlink_metadata(&path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.to_string()),
    };
    if metadata.file_type().is_symlink() {
        return Err("Le fichier de synchronisation est un lien symbolique".into());
    }
    if !metadata.is_file() {
        return Err("Le chemin de synchronisation n’est pas un fichier".into());
    }
    if metadata.len() > MAX_SYNC_BYTES {
        return Err("Fichier de synchronisation trop volumineux".into());
    }
    fs::read_to_string(&path)
        .map(Some)
        .map_err(|error| error.to_string())
}

fn temporary_path(dir: &Path, name: &str) -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    dir.join(format!(".{name}.{}-{nanos}.tmp", std::process::id()))
}

/// Écrit un fichier `.coffre` de façon atomique et avec des permissions `0600`.
pub fn write(dir: &str, name: &str, contents: &str) -> Result<(), String> {
    if contents.len() as u64 > MAX_SYNC_BYTES {
        return Err("Fichier de synchronisation trop volumineux".into());
    }
    let dir = canonical_directory(dir)?;
    let target = entry_path(&dir, name)?;
    let temp = temporary_path(&dir, name);

    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temp)
        .map_err(|error| error.to_string())?;
    let write_result = (|| -> Result<(), String> {
        file.write_all(contents.as_bytes())
            .map_err(|error| error.to_string())?;
        file.flush().map_err(|error| error.to_string())?;
        file.sync_all().map_err(|error| error.to_string())
    })();
    drop(file);
    if let Err(error) = write_result {
        let _ = fs::remove_file(&temp);
        return Err(error);
    }

    let result = (|| -> Result<(), String> {
        set_mode(&temp, 0o600)?;
        fs::rename(&temp, &target).map_err(|error| error.to_string())?;
        set_mode(&target, 0o600)?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result?;

    // Rendre le renommage durable lorsque la plateforme le permet.
    #[cfg(unix)]
    {
        if let Ok(directory) = File::open(&dir) {
            let _ = directory.sync_all();
        }
    }
    Ok(())
}

/// Surveille le dossier et émet `coffre:sync-changed` après anti-rebond.
pub fn watch(
    app: tauri::AppHandle,
    state: tauri::State<'_, SyncState>,
    dir: &str,
) -> Result<(), String> {
    use tauri::Emitter;

    let dir = canonical_directory(dir)?;
    let (sender, receiver) = mpsc::channel::<()>();
    let mut watcher =
        notify::recommended_watcher(move |result: Result<notify::Event, notify::Error>| {
            if result.is_ok() {
                let _ = sender.send(());
            }
        })
        .map_err(|error| error.to_string())?;
    watcher
        .watch(&dir, RecursiveMode::NonRecursive)
        .map_err(|error| error.to_string())?;

    let display = dir.to_string_lossy().into_owned();
    let app = app.clone();
    std::thread::spawn(move || {
        while receiver.recv().is_ok() {
            loop {
                match receiver.recv_timeout(Duration::from_millis(WATCH_DEBOUNCE_MS)) {
                    Ok(()) => continue,
                    Err(mpsc::RecvTimeoutError::Timeout) => break,
                    Err(mpsc::RecvTimeoutError::Disconnected) => return,
                }
            }
            let _ = app.emit(
                "coffre:sync-changed",
                SyncChanged {
                    dir: display.clone(),
                },
            );
        }
    });

    let mut slot = state
        .watcher
        .lock()
        .map_err(|_| "État de surveillance de synchronisation verrouillé".to_string())?;
    *slot = Some(watcher);
    Ok(())
}

pub fn unwatch(state: tauri::State<'_, SyncState>) -> Result<(), String> {
    let mut slot = state
        .watcher
        .lock()
        .map_err(|_| "État de surveillance de synchronisation verrouillé".to_string())?;
    *slot = None;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir() -> PathBuf {
        use std::sync::atomic::{AtomicU64, Ordering};
        static COUNTER: AtomicU64 = AtomicU64::new(0);

        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let sequence = COUNTER.fetch_add(1, Ordering::Relaxed);
        let dir = std::env::temp_dir().join(format!(
            "coffre-sync-{}-{stamp}-{sequence}",
            std::process::id()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn prepare_ecrit_un_dossier_et_un_readme() {
        let base = temp_dir();
        let dir = prepare(base.to_str().unwrap(), "vf_test").unwrap();
        assert!(Path::new(&dir).is_dir());
        assert!(Path::new(&dir).join("README.txt").is_file());
        assert!(Path::new(&dir).ends_with(Path::new("Coffre").join("vf_test")));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(&dir).unwrap().permissions().mode() & 0o777,
                0o700
            );
        }
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn ecrit_lit_et_liste_un_fichier() {
        let base = temp_dir();
        let dir = prepare(base.to_str().unwrap(), "vf_test").unwrap();
        write(&dir, "w_device.coffre", "{\"format\":\"coffre\"}").unwrap();
        assert_eq!(
            read(&dir, "w_device.coffre").unwrap().as_deref(),
            Some("{\"format\":\"coffre\"}")
        );
        let files = list(&dir).unwrap();
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].name, "w_device.coffre");
        assert!(files[0].size > 0);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let path = Path::new(&dir).join("w_device.coffre");
            assert_eq!(
                fs::metadata(&path).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn confine_les_noms_et_les_liens() {
        let base = temp_dir();
        let dir = prepare(base.to_str().unwrap(), "vf_test").unwrap();
        for name in [
            "../evasion.coffre",
            "sub/evasion.coffre",
            "..\\evasion.coffre",
            "fichier.txt",
            ".cache.coffre",
            "nom avec espace.coffre",
            "",
        ] {
            assert!(write(&dir, name, "{}").is_err(), "nom accepté : {name}");
            assert!(read(&dir, name).is_err(), "nom accepté : {name}");
        }

        #[cfg(unix)]
        {
            let outside = base.join("outside.coffre");
            fs::write(&outside, "secret").unwrap();
            std::os::unix::fs::symlink(&outside, Path::new(&dir).join("lien.coffre")).unwrap();
            assert!(read(&dir, "lien.coffre").is_err());
            assert!(list(&dir).unwrap().is_empty());
        }
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn refuse_un_identifiant_de_coffre_invalide() {
        let base = temp_dir();
        assert!(prepare(base.to_str().unwrap(), "../evasion").is_err());
        assert!(prepare(base.to_str().unwrap(), "vf/evasion").is_err());
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn un_fichier_absent_est_null() {
        let base = temp_dir();
        let dir = prepare(base.to_str().unwrap(), "vf_test").unwrap();
        assert!(read(&dir, "absent.coffre").unwrap().is_none());
        let _ = fs::remove_dir_all(&base);
    }
}
