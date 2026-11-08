//! Stockage natif du coffre sur le bureau.
//!
//! Le fichier `.coffre` chiffré est écrit dans le dossier de données de
//! l’application, avec trois sauvegardes tournantes. Les écritures sont
//! atomiques (fichier temporaire + synchronisation + renommage) et les
//! permissions sont restrictives sur macOS/Linux.

use std::fs::{self, File, OpenOptions};
use std::io::{ErrorKind, Write};
use std::path::{Path, PathBuf};

const CURRENT_FILE: &str = "vault.coffre";
const TEMP_FILE: &str = "vault.coffre.tmp";
const STATE_FILE: &str = "state.json";
const MAX_BYTES: u64 = 100 * 1024 * 1024;
const MAX_STATE_BYTES: usize = 64 * 1024;
const BACKUP_GENERATIONS: [u32; 3] = [1, 2, 3];

/// Sérialise les écritures : deux sauvegardes simultanées ne doivent pas
/// partager le même fichier temporaire.
static WRITE_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

fn ensure_dir(dir: &Path) -> Result<(), String> {
    fs::create_dir_all(dir).map_err(|error| error.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(dir, fs::Permissions::from_mode(0o700));
    }
    Ok(())
}

fn backup_path(dir: &Path, generation: u32) -> Result<PathBuf, String> {
    if !BACKUP_GENERATIONS.contains(&generation) {
        return Err("Génération de sauvegarde invalide".into());
    }
    Ok(dir.join(format!("{CURRENT_FILE}.bak{generation}")))
}

fn set_file_permissions(path: &Path) -> Result<(), String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o600))
            .map_err(|error| error.to_string())?;
    }
    #[cfg(not(unix))]
    {
        let _ = path;
    }
    Ok(())
}

fn read_text(path: &Path) -> Result<Option<String>, String> {
    match fs::metadata(path) {
        Ok(metadata) => {
            if metadata.len() > MAX_BYTES {
                return Err("Fichier de coffre trop volumineux".into());
            }
        }
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.to_string()),
    }

    match fs::read_to_string(path) {
        Ok(contents) => Ok(Some(contents)),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

fn write_temp(dir: &Path, contents: &str) -> Result<PathBuf, String> {
    if contents.len() as u64 > MAX_BYTES {
        return Err("Coffre trop volumineux".into());
    }
    ensure_dir(dir)?;
    let temp = dir.join(TEMP_FILE);

    #[cfg(unix)]
    let mut file = {
        use std::os::unix::fs::OpenOptionsExt;
        OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .mode(0o600)
            .open(&temp)
            .map_err(|error| error.to_string())?
    };
    #[cfg(not(unix))]
    let mut file = OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .open(&temp)
        .map_err(|error| error.to_string())?;

    let result = (|| -> Result<(), String> {
        file.write_all(contents.as_bytes())
            .map_err(|error| error.to_string())?;
        file.flush().map_err(|error| error.to_string())?;
        file.sync_all().map_err(|error| error.to_string())?;
        drop(file);
        set_file_permissions(&temp)?;
        Ok(())
    })();

    if result.is_err() {
        let _ = fs::remove_file(&temp);
        result?;
    }
    Ok(temp)
}

fn write_atomic(path: &Path, contents: &str) -> Result<(), String> {
    let dir = path.parent().ok_or("Dossier de coffre invalide")?;
    let temp = write_temp(dir, contents)?;
    fs::rename(&temp, path).map_err(|error| {
        let _ = fs::remove_file(&temp);
        error.to_string()
    })?;
    set_file_permissions(path)
}

fn rotate_backups(dir: &Path) -> Result<(), String> {
    let bak1 = backup_path(dir, 1)?;
    let bak2 = backup_path(dir, 2)?;
    let bak3 = backup_path(dir, 3)?;

    match fs::remove_file(&bak3) {
        Ok(()) => {}
        Err(error) if error.kind() == ErrorKind::NotFound => {}
        Err(error) => return Err(error.to_string()),
    }
    for (from, to) in [(&bak2, &bak3), (&bak1, &bak2)] {
        match fs::rename(from, to) {
            Ok(()) => {}
            Err(error) if error.kind() == ErrorKind::NotFound => {}
            Err(error) => return Err(error.to_string()),
        }
    }

    let current = dir.join(CURRENT_FILE);
    if current.exists() {
        fs::copy(&current, &bak1).map_err(|error| error.to_string())?;
        set_file_permissions(&bak1)?;
        if let Ok(file) = File::open(&bak1) {
            let _ = file.sync_all();
        }
    }
    Ok(())
}

pub fn read_current(dir: &Path) -> Result<Option<String>, String> {
    read_text(&dir.join(CURRENT_FILE))
}

pub fn write_current(dir: &Path, contents: &str) -> Result<(), String> {
    let _guard = WRITE_LOCK.lock().map_err(|error| error.to_string())?;
    ensure_dir(dir)?;
    // Écrire d’abord le nouveau fichier dans un temporaire, puis faire tourner
    // les sauvegardes (l’ancien courant devient bak1), puis remplacer le
    // courant. Une panne entre les étapes laisse toujours l’ancien courant ou
    // sa copie sur disque.
    let current = dir.join(CURRENT_FILE);
    let temp = write_temp(dir, contents)?;
    if let Err(error) = rotate_backups(dir) {
        let _ = fs::remove_file(&temp);
        return Err(format!(
            "Rotation des sauvegardes impossible, coffre courant conservé : {error}"
        ));
    }
    fs::rename(&temp, &current).map_err(|error| {
        let _ = fs::remove_file(&temp);
        error.to_string()
    })?;
    set_file_permissions(&current)
}

pub fn read_backup(dir: &Path, generation: u32) -> Result<Option<String>, String> {
    read_text(&backup_path(dir, generation)?)
}

pub fn write_backup(dir: &Path, generation: u32, contents: &str) -> Result<(), String> {
    let _guard = WRITE_LOCK.lock().map_err(|error| error.to_string())?;
    ensure_dir(dir)?;
    let path = backup_path(dir, generation)?;
    write_atomic(&path, contents)
}

/// Lit l’état anti-retour en arrière (`state.json`), jamais chiffré mais sans
/// secret : identifiant de fichier et révision maximale vue.
pub fn read_state(dir: &Path) -> Result<Option<String>, String> {
    let path = dir.join(STATE_FILE);
    match fs::metadata(&path) {
        Ok(metadata) => {
            if metadata.len() > MAX_STATE_BYTES as u64 {
                return Err("État du coffre trop volumineux".into());
            }
        }
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.to_string()),
    }
    match fs::read_to_string(&path) {
        Ok(contents) => Ok(Some(contents)),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

pub fn write_state(dir: &Path, contents: &str) -> Result<(), String> {
    if contents.len() > MAX_STATE_BYTES {
        return Err("État du coffre trop volumineux".into());
    }
    let _guard = WRITE_LOCK.lock().map_err(|error| error.to_string())?;
    ensure_dir(dir)?;
    write_atomic(&dir.join(STATE_FILE), contents)
}

pub fn clear(dir: &Path) -> Result<(), String> {
    let _guard = WRITE_LOCK.lock().map_err(|error| error.to_string())?;
    for path in std::iter::once(dir.join(CURRENT_FILE))
        .chain(
            BACKUP_GENERATIONS
                .iter()
                .map(|generation| dir.join(format!("{CURRENT_FILE}.bak{generation}"))),
        )
        .chain(std::iter::once(dir.join(TEMP_FILE)))
        .chain(std::iter::once(dir.join(STATE_FILE)))
    {
        match fs::remove_file(&path) {
            Ok(()) => {}
            Err(error) if error.kind() == ErrorKind::NotFound => {}
            Err(error) => return Err(error.to_string()),
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir() -> PathBuf {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("coffre-store-{}-{stamp}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn ecrit_lit_et_fait_tourner_les_sauvegardes() {
        let dir = temp_dir();
        assert_eq!(read_current(&dir).unwrap(), None);

        write_current(&dir, "A").unwrap();
        assert_eq!(read_current(&dir).unwrap().as_deref(), Some("A"));
        assert_eq!(read_backup(&dir, 1).unwrap(), None);

        write_current(&dir, "B").unwrap();
        write_current(&dir, "C").unwrap();
        write_current(&dir, "D").unwrap();

        assert_eq!(read_current(&dir).unwrap().as_deref(), Some("D"));
        assert_eq!(read_backup(&dir, 1).unwrap().as_deref(), Some("C"));
        assert_eq!(read_backup(&dir, 2).unwrap().as_deref(), Some("B"));
        assert_eq!(read_backup(&dir, 3).unwrap().as_deref(), Some("A"));

        write_backup(&dir, 2, "X").unwrap();
        assert_eq!(read_backup(&dir, 2).unwrap().as_deref(), Some("X"));

        assert_eq!(read_state(&dir).unwrap(), None);
        write_state(&dir, r#"{"fileId":"vf_1","revision":4}"#).unwrap();
        assert_eq!(
            read_state(&dir).unwrap().as_deref(),
            Some(r#"{"fileId":"vf_1","revision":4}"#)
        );
        assert!(write_state(&dir, &"A".repeat(MAX_STATE_BYTES + 1)).is_err());

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let file_mode = fs::metadata(dir.join(CURRENT_FILE))
                .unwrap()
                .permissions()
                .mode()
                & 0o777;
            assert_eq!(file_mode, 0o600);
            let dir_mode = fs::metadata(&dir).unwrap().permissions().mode() & 0o777;
            assert_eq!(dir_mode, 0o700);
        }

        clear(&dir).unwrap();
        assert_eq!(read_current(&dir).unwrap(), None);
        assert_eq!(read_backup(&dir, 1).unwrap(), None);
        assert_eq!(read_state(&dir).unwrap(), None);
        let _ = fs::remove_dir_all(&dir);
    }
}
