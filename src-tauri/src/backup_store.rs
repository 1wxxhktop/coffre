//! Sauvegardes planifiées dans un dossier choisi par l’utilisateur.
//!
//! Le fichier source est le `.coffre` déjà chiffré. Aucun déchiffrement n’est
//! effectué : la copie est atomique, vérifiée par SHA-256, et les noms sont
//! strictement contrôlés pour empêcher toute traversée de chemin.

use serde::Serialize;
use sha2::{Digest, Sha256};
use std::fs::{self, File, OpenOptions};
use std::io::{ErrorKind, Write};
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

const MAX_BYTES: u64 = 100 * 1024 * 1024;
const PREFIXES: [&str; 3] = ["coffre-daily-", "coffre-weekly-", "coffre-monthly-"];

#[derive(Clone, Debug, Serialize)]
pub struct BackupStatus {
    pub exists: bool,
    #[serde(rename = "isDirectory")]
    pub is_directory: bool,
}

#[derive(Clone, Debug, Serialize)]
pub struct BackupFileInfo {
    pub name: String,
    pub size: u64,
    #[serde(rename = "modifiedAt")]
    pub modified_at: u64,
}

#[derive(Clone, Debug, Serialize)]
pub struct CopyResult {
    pub written: Vec<String>,
    /// SHA-256 hexadécimal du fichier source, identique aux copies.
    pub sha256: String,
    #[serde(rename = "sourceSize")]
    pub source_size: u64,
}

fn validate_dir(dir: &str) -> Result<PathBuf, String> {
    if dir.trim().is_empty() {
        return Err("missing-folder".into());
    }
    let path = PathBuf::from(dir);
    let canonical = fs::canonicalize(&path).map_err(|error| {
        if error.kind() == ErrorKind::NotFound {
            "missing-folder".to_string()
        } else {
            error.to_string()
        }
    })?;
    let metadata = fs::metadata(&canonical).map_err(|error| error.to_string())?;
    if !metadata.is_dir() {
        return Err("not-a-directory".into());
    }
    Ok(canonical)
}

fn validate_name(name: &str) -> Result<(), String> {
    if name.len() < 20 || name.len() > 120 {
        return Err("invalid-name".into());
    }
    if name.contains('/') || name.contains('\\') || name.contains("..") || name.contains('\0') {
        return Err("invalid-name".into());
    }
    let rest = PREFIXES
        .iter()
        .find_map(|prefix| name.strip_prefix(prefix))
        .ok_or_else(|| "invalid-name".to_string())?;
    let stem = rest
        .strip_suffix(".coffre")
        .ok_or_else(|| "invalid-name".to_string())?;
    if stem.is_empty()
        || !stem
            .chars()
            .all(|character| character.is_ascii_digit() || matches!(character, '-' | 'T' | 'W'))
    {
        return Err("invalid-name".into());
    }
    Ok(())
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

fn hex(bytes: &[u8]) -> String {
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        use std::fmt::Write as _;
        let _ = write!(output, "{byte:02x}");
    }
    output
}

pub fn status(dir: &str) -> Result<BackupStatus, String> {
    match validate_dir(dir) {
        Ok(_) => Ok(BackupStatus {
            exists: true,
            is_directory: true,
        }),
        Err(code) if code == "missing-folder" => Ok(BackupStatus {
            exists: false,
            is_directory: false,
        }),
        Err(error) => Err(error),
    }
}

pub fn list(dir: &str) -> Result<Vec<BackupFileInfo>, String> {
    let dir = validate_dir(dir)?;
    let entries = fs::read_dir(&dir).map_err(|error| error.to_string())?;
    let mut files = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|error| error.to_string())?;
        let name = entry.file_name().to_string_lossy().to_string();
        if validate_name(&name).is_err() {
            continue;
        }
        let metadata = match fs::symlink_metadata(entry.path()) {
            Ok(metadata) => metadata,
            Err(_) => continue,
        };
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            continue;
        }
        let modified_at = metadata
            .modified()
            .ok()
            .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
            .map(|duration| duration.as_millis() as u64)
            .unwrap_or(0);
        files.push(BackupFileInfo {
            name,
            size: metadata.len(),
            modified_at,
        });
    }
    files.sort_by(|first, second| second.name.cmp(&first.name));
    Ok(files)
}

pub fn delete(dir: &str, names: &[String]) -> Result<usize, String> {
    let dir = validate_dir(dir)?;
    let mut removed = 0;
    for name in names {
        validate_name(name)?;
        let path = dir.join(name);
        let metadata = match fs::symlink_metadata(&path) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == ErrorKind::NotFound => continue,
            Err(error) => return Err(error.to_string()),
        };
        if metadata.file_type().is_symlink() {
            return Err("symlink-refused".into());
        }
        if !metadata.is_file() {
            continue;
        }
        fs::remove_file(&path).map_err(|error| error.to_string())?;
        removed += 1;
    }
    Ok(removed)
}

pub fn read(dir: &str, name: &str) -> Result<String, String> {
    validate_name(name)?;
    let dir = validate_dir(dir)?;
    let path = dir.join(name);
    let metadata = fs::symlink_metadata(&path).map_err(|error| error.to_string())?;
    if metadata.file_type().is_symlink() {
        return Err("symlink-refused".into());
    }
    if !metadata.is_file() || metadata.len() > MAX_BYTES {
        return Err("invalid-backup".into());
    }
    fs::read_to_string(&path).map_err(|error| error.to_string())
}

pub fn current_file_id(source: &Path) -> Result<Option<String>, String> {
    let metadata = match fs::symlink_metadata(source) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.to_string()),
    };
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err("invalid-vault".into());
    }
    if metadata.len() > MAX_BYTES {
        return Err("vault-too-large".into());
    }
    let text = fs::read_to_string(source).map_err(|error| error.to_string())?;
    let value: serde_json::Value =
        serde_json::from_str(&text).map_err(|_| "invalid-vault".to_string())?;
    Ok(value
        .get("id")
        .and_then(|id| id.as_str())
        .filter(|id| !id.is_empty())
        .map(str::to_string))
}

pub fn copy_current(source: &Path, dir: &str, names: &[String]) -> Result<CopyResult, String> {
    let dir = validate_dir(dir)?;
    let metadata = fs::symlink_metadata(source).map_err(|error| {
        if error.kind() == ErrorKind::NotFound {
            "no-vault".to_string()
        } else {
            error.to_string()
        }
    })?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err("invalid-vault".into());
    }
    if metadata.len() > MAX_BYTES {
        return Err("vault-too-large".into());
    }
    let contents = fs::read(source).map_err(|error| error.to_string())?;
    let hash = hex(&Sha256::digest(&contents));

    for name in names {
        validate_name(name)?;
        let path = dir.join(name);
        if let Ok(existing) = fs::symlink_metadata(&path)
            && existing.file_type().is_symlink()
        {
            return Err("symlink-refused".into());
        }
        let temp = dir.join(format!(".{name}.tmp"));
        let _ = fs::remove_file(&temp);
        let mut file: File = {
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt;
                OpenOptions::new()
                    .write(true)
                    .create(true)
                    .truncate(true)
                    .mode(0o600)
                    .open(&temp)
                    .map_err(|error| error.to_string())?
            }
            #[cfg(not(unix))]
            {
                OpenOptions::new()
                    .write(true)
                    .create(true)
                    .truncate(true)
                    .open(&temp)
                    .map_err(|error| error.to_string())?
            }
        };
        let write_result = (|| -> Result<(), String> {
            file.write_all(&contents)
                .map_err(|error| error.to_string())?;
            file.flush().map_err(|error| error.to_string())?;
            file.sync_all().map_err(|error| error.to_string())?;
            drop(file);
            set_file_permissions(&temp)?;
            // `rename` remplace atomiquement sur Unix ; sur Windows, il refuse
            // une destination existante (sauvegarde hebdomadaire ou mensuelle
            // réécrite manuellement dans la même période).
            #[cfg(windows)]
            if path.exists() {
                fs::remove_file(&path).map_err(|error| {
                    let _ = fs::remove_file(&temp);
                    error.to_string()
                })?;
            }
            fs::rename(&temp, &path).map_err(|error| {
                let _ = fs::remove_file(&temp);
                error.to_string()
            })?;
            set_file_permissions(&path)?;
            let copied = fs::read(&path).map_err(|error| error.to_string())?;
            if Sha256::digest(&copied) != Sha256::digest(&contents) {
                let _ = fs::remove_file(&path);
                return Err("copy-verification-failed".into());
            }
            Ok(())
        })();
        if let Err(error) = write_result {
            let _ = fs::remove_file(&temp);
            return Err(error);
        }
    }

    Ok(CopyResult {
        written: names.to_vec(),
        sha256: hash,
        source_size: metadata.len(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "coffre-backup-{label}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn source(dir: &Path) -> PathBuf {
        let path = dir.join("vault.coffre");
        fs::write(&path, r#"{"id":"vf_test","format":"coffre","version":4}"#).unwrap();
        path
    }

    #[test]
    fn copie_liste_et_supprime_des_sauvegardes() {
        let root = temp_dir("copy");
        let source = source(&root);
        let target = root.join("target");
        fs::create_dir_all(&target).unwrap();
        let names = vec![
            "coffre-daily-2026-11-09T10-00-00.coffre".to_string(),
            "coffre-weekly-2026-W45.coffre".to_string(),
            "coffre-monthly-2026-11.coffre".to_string(),
        ];
        let result = copy_current(&source, target.to_str().unwrap(), &names).unwrap();
        assert_eq!(result.written.len(), 3);
        assert_eq!(result.sha256.len(), 64);

        let files = list(target.to_str().unwrap()).unwrap();
        assert_eq!(files.len(), 3);

        assert_eq!(delete(target.to_str().unwrap(), &names[..1]).unwrap(), 1);
        assert_eq!(list(target.to_str().unwrap()).unwrap().len(), 2);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn refuse_les_noms_dangereux_et_les_dossiers_absents() {
        let root = temp_dir("names");
        let source = source(&root);
        let target = root.join("target");
        fs::create_dir_all(&target).unwrap();
        for name in [
            "../coffre-daily-2026-11-09T10-00-00.coffre",
            "coffre-daily-2026-11-09T10-00-00.coffre/../x",
            "coffre-daily-2026-11-09T10-00-00.txt",
            "autre-2026-11-09.coffre",
        ] {
            assert!(validate_name(name).is_err(), "{name}");
        }
        assert!(
            !status(root.join("absent").to_str().unwrap())
                .unwrap()
                .exists
        );
        assert!(copy_current(&source, root.join("absent").to_str().unwrap(), &[]).is_err());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn lit_l_identifiant_sans_dechiffrer() {
        let root = temp_dir("id");
        let source = source(&root);
        assert_eq!(
            current_file_id(&source).unwrap().as_deref(),
            Some("vf_test")
        );
        fs::remove_dir_all(root).unwrap();
    }
}
