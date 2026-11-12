//! Clé d’appairage du pont natif et copie gérée de l’extension navigateur.
//!
//! **Clé d’appairage.** Sous macOS, le trousseau lie chaque entrée à la
//! signature de l’application qui l’a créée. Coffre est signé ad hoc : sa
//! signature change à chaque version, et le trousseau refuserait la clé après
//! chaque mise à jour, ce qui redemandait d’associer l’extension. La clé y est
//! donc gardée dans un fichier privé du dossier de données (mode 0600). Elle
//! ne protège que le canal local entre l’extension et l’application, et
//! l’extension en garde déjà une copie dans son propre stockage : le fichier
//! n’abaisse pas le niveau de protection. La clé maîtresse du coffre, elle,
//! reste dans le trousseau. Sous Windows et Linux, le trousseau n’a pas cette
//! contrainte et reste utilisé.
//!
//! **Copie gérée de l’extension.** Un navigateur Chromium ne met pas à jour une
//! extension chargée hors de son magasin. L’application embarque donc
//! l’extension et en tient une copie à jour dans un dossier fixe de son dossier
//! de données. L’utilisateur charge ce dossier une seule fois ; après chaque
//! mise à jour de Coffre, la copie est remplacée et l’extension, prévenue par
//! le pont natif, se recharge d’elle-même.

use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::{AppHandle, Manager, Runtime};

/// Sous-dossier des ressources embarquées et du dossier de données.
const EXTENSION_DIR: &str = "extension";
const MANIFEST_FILE: &str = "manifest.json";
/// Une clé de session encodée fait 44 caractères ; marge large.
const MAX_KEY_LENGTH: usize = 256;

#[cfg(target_os = "macos")]
const BRIDGE_KEY_FILE: &str = "bridge/session.key";
#[cfg(not(target_os = "macos"))]
const BRIDGE_KEY_ACCOUNT: &str = "bridge:session";

fn data_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(|error| error.to_string())
}

fn valid_key(secret: &str) -> bool {
    !secret.is_empty()
        && secret.len() <= MAX_KEY_LENGTH
        && secret.bytes().all(|byte| {
            byte.is_ascii_alphanumeric() || matches!(byte, b'+' | b'/' | b'=' | b'-' | b'_')
        })
}

#[cfg(target_os = "macos")]
fn restrict(path: &Path, mode: u32) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(mode)).map_err(|error| error.to_string())
}

/// Écrit la clé dans un fichier privé, par remplacement atomique.
#[cfg(target_os = "macos")]
fn write_key_file(path: &Path, secret: &str) -> Result<(), String> {
    use std::io::Write;
    use std::os::unix::fs::OpenOptionsExt;

    let parent = path
        .parent()
        .ok_or_else(|| "Chemin de clé invalide.".to_string())?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    restrict(parent, 0o700)?;
    let temporary = path.with_extension("key.tmp");
    let _ = fs::remove_file(&temporary);
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(&temporary)
        .map_err(|error| error.to_string())?;
    file.write_all(secret.as_bytes())
        .and_then(|()| file.sync_all())
        .map_err(|error| error.to_string())?;
    fs::rename(&temporary, path).map_err(|error| error.to_string())
}

/// Relit la clé d’appairage du pont natif ; `None` si aucune n’est enregistrée.
#[tauri::command]
pub fn bridge_key_load<R: Runtime>(app: AppHandle<R>) -> Result<Option<String>, String> {
    #[cfg(target_os = "macos")]
    {
        let path = data_dir(&app)?.join(BRIDGE_KEY_FILE);
        match fs::read_to_string(&path) {
            Ok(secret) => {
                let secret = secret.trim().to_string();
                Ok(valid_key(&secret).then_some(secret))
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(error) => Err(error.to_string()),
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        crate::keychain_load(BRIDGE_KEY_ACCOUNT.to_string())
    }
}

/// Enregistre la clé d’appairage du pont natif.
#[tauri::command]
pub fn bridge_key_store<R: Runtime>(app: AppHandle<R>, secret: String) -> Result<(), String> {
    if !valid_key(&secret) {
        return Err("Clé d’appairage invalide.".into());
    }
    #[cfg(target_os = "macos")]
    {
        write_key_file(&data_dir(&app)?.join(BRIDGE_KEY_FILE), &secret)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        crate::keychain_store(BRIDGE_KEY_ACCOUNT.to_string(), secret)
    }
}

/// Oublie la clé d’appairage. Une clé absente n’est pas une erreur.
#[tauri::command]
pub fn bridge_key_delete<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        match fs::remove_file(data_dir(&app)?.join(BRIDGE_KEY_FILE)) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(error.to_string()),
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        crate::keychain_delete(BRIDGE_KEY_ACCOUNT.to_string())
    }
}

/// État de la copie gérée de l’extension, pour les réglages et le pont natif.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionInfo {
    /// Faux si ce build n’embarque pas l’extension (build de développement).
    pub available: bool,
    /// Version de l’extension embarquée, donc de la copie gérée.
    pub version: Option<String>,
    /// Dossier à charger une fois dans le navigateur.
    pub path: Option<String>,
    /// Vrai si la copie vient d’être créée ou remplacée.
    pub updated: bool,
}

/// Version déclarée par un `manifest.json` d’extension.
fn manifest_version(dir: &Path) -> Option<String> {
    let raw = fs::read_to_string(dir.join(MANIFEST_FILE)).ok()?;
    let manifest: serde_json::Value = serde_json::from_str(&raw).ok()?;
    let version = manifest.get("version")?.as_str()?.trim();
    let valid = !version.is_empty()
        && version.len() <= 32
        && version
            .bytes()
            .all(|byte| byte.is_ascii_digit() || byte == b'.');
    valid.then(|| version.to_string())
}

/// Copie un dossier, fichiers et sous-dossiers seulement (aucun lien suivi).
fn copy_tree(source: &Path, target: &Path) -> Result<(), String> {
    fs::create_dir_all(target).map_err(|error| error.to_string())?;
    for entry in fs::read_dir(source).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let kind = entry.file_type().map_err(|error| error.to_string())?;
        let destination = target.join(entry.file_name());
        if kind.is_dir() {
            copy_tree(&entry.path(), &destination)?;
        } else if kind.is_file() {
            fs::copy(entry.path(), &destination).map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

/// Met la copie gérée au niveau de l’extension embarquée.
///
/// La copie n’est remplacée que si la version diffère. Le remplacement passe
/// par un dossier voisin puis deux renommages, pour que le navigateur ne voie
/// jamais un dossier à moitié écrit.
fn sync_extension(bundled: &Path, managed: &Path) -> Result<ExtensionInfo, String> {
    let Some(version) = manifest_version(bundled) else {
        return Ok(ExtensionInfo::default());
    };
    let path = Some(managed.to_string_lossy().into_owned());
    if manifest_version(managed).as_deref() == Some(version.as_str()) {
        return Ok(ExtensionInfo {
            available: true,
            version: Some(version),
            path,
            updated: false,
        });
    }

    let parent = managed
        .parent()
        .ok_or_else(|| "Dossier de l’extension invalide.".to_string())?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let staging = parent.join(format!("{EXTENSION_DIR}.nouveau"));
    let previous = parent.join(format!("{EXTENSION_DIR}.ancien"));
    let _ = fs::remove_dir_all(&staging);
    let _ = fs::remove_dir_all(&previous);
    copy_tree(bundled, &staging)?;
    if managed.exists() {
        fs::rename(managed, &previous).map_err(|error| error.to_string())?;
    }
    if let Err(error) = fs::rename(&staging, managed) {
        // Remettre l’ancienne copie plutôt que de laisser le dossier vide.
        let _ = fs::rename(&previous, managed);
        return Err(error.to_string());
    }
    let _ = fs::remove_dir_all(&previous);

    Ok(ExtensionInfo {
        available: true,
        version: Some(version),
        path,
        updated: true,
    })
}

fn sync<R: Runtime>(app: &AppHandle<R>) -> Result<ExtensionInfo, String> {
    let bundled = app
        .path()
        .resource_dir()
        .map_err(|error| error.to_string())?
        .join(EXTENSION_DIR);
    sync_extension(&bundled, &data_dir(app)?.join(EXTENSION_DIR))
}

/// Met à jour la copie gérée au démarrage ; un échec n’empêche pas de lancer
/// l’application.
pub fn sync_at_startup<R: Runtime>(app: &AppHandle<R>) {
    if let Err(error) = sync(app) {
        eprintln!("Copie de l’extension non mise à jour : {error}");
    }
}

/// État de la copie gérée, mise à jour au passage si nécessaire.
#[tauri::command]
pub fn extension_info<R: Runtime>(app: AppHandle<R>) -> Result<ExtensionInfo, String> {
    sync(&app)
}

/// Ouvre le dossier de la copie gérée dans le gestionnaire de fichiers.
#[tauri::command]
pub fn extension_reveal<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    let info = sync(&app)?;
    let path = info
        .path
        .filter(|_| info.available)
        .ok_or_else(|| "L’extension n’est pas embarquée dans ce build.".to_string())?;
    #[cfg(target_os = "macos")]
    let program = "open";
    #[cfg(target_os = "windows")]
    let program = "explorer";
    #[cfg(all(unix, not(target_os = "macos")))]
    let program = "xdg-open";
    std::process::Command::new(program)
        .arg(path)
        .spawn()
        .map(|_| ())
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "coffre-extension-test-{}-{name}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn write_extension(dir: &Path, version: &str, marker: &str) {
        fs::create_dir_all(dir.join("icons")).unwrap();
        fs::write(
            dir.join(MANIFEST_FILE),
            format!(r#"{{"manifest_version":3,"version":"{version}"}}"#),
        )
        .unwrap();
        fs::write(dir.join("background.js"), marker).unwrap();
        fs::write(dir.join("icons/icon.png"), marker).unwrap();
    }

    #[test]
    fn cree_la_copie_puis_ne_la_touche_plus() {
        let root = scratch("creation");
        let bundled = root.join("embarquee");
        let managed = root.join("donnees").join(EXTENSION_DIR);
        write_extension(&bundled, "1.2.0", "a");

        let first = sync_extension(&bundled, &managed).unwrap();
        assert!(first.available && first.updated);
        assert_eq!(first.version.as_deref(), Some("1.2.0"));
        assert_eq!(
            fs::read_to_string(managed.join("icons/icon.png")).unwrap(),
            "a"
        );

        // Un fichier ajouté à la main prouve que la copie n’est pas refaite.
        fs::write(managed.join("temoin"), "x").unwrap();
        let second = sync_extension(&bundled, &managed).unwrap();
        assert!(second.available && !second.updated);
        assert!(managed.join("temoin").exists());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn remplace_la_copie_quand_la_version_change() {
        let root = scratch("remplacement");
        let bundled = root.join("embarquee");
        let managed = root.join("donnees").join(EXTENSION_DIR);
        write_extension(&bundled, "1.2.0", "a");
        sync_extension(&bundled, &managed).unwrap();
        fs::write(managed.join("ancien-fichier.js"), "x").unwrap();

        write_extension(&bundled, "1.3.0", "b");
        let info = sync_extension(&bundled, &managed).unwrap();
        assert!(info.updated);
        assert_eq!(manifest_version(&managed).as_deref(), Some("1.3.0"));
        assert_eq!(
            fs::read_to_string(managed.join("background.js")).unwrap(),
            "b"
        );
        // Les fichiers de l’ancienne version ne survivent pas.
        assert!(!managed.join("ancien-fichier.js").exists());
        assert!(!root.join("donnees").join("extension.ancien").exists());
        assert!(!root.join("donnees").join("extension.nouveau").exists());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn signale_un_build_sans_extension() {
        let root = scratch("absente");
        let bundled = root.join("embarquee");
        fs::create_dir_all(&bundled).unwrap();
        fs::write(bundled.join(".gitkeep"), "").unwrap();
        let managed = root.join("donnees").join(EXTENSION_DIR);

        let info = sync_extension(&bundled, &managed).unwrap();
        assert_eq!(info, ExtensionInfo::default());
        assert!(!managed.exists());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn refuse_une_version_fantaisiste() {
        let root = scratch("version");
        fs::write(root.join(MANIFEST_FILE), r#"{"version":"1.0; rm -rf"}"#).unwrap();
        assert_eq!(manifest_version(&root), None);
        fs::write(root.join(MANIFEST_FILE), r#"{"version":"0.12.0"}"#).unwrap();
        assert_eq!(manifest_version(&root).as_deref(), Some("0.12.0"));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn valide_la_forme_de_la_cle() {
        assert!(valid_key("q83vEjRWeJCrze8BI0VniavN7wEjRWeJq83vASNFZ4k="));
        assert!(!valid_key(""));
        assert!(!valid_key("clé avec espace"));
        assert!(!valid_key(&"a".repeat(MAX_KEY_LENGTH + 1)));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn ecrit_la_cle_dans_un_fichier_prive() {
        use std::os::unix::fs::PermissionsExt;
        let root = scratch("cle");
        let path = root.join("bridge/session.key");
        write_key_file(&path, "premiere").unwrap();
        write_key_file(&path, "seconde").unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "seconde");
        let mode = fs::metadata(&path).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600);
        let _ = fs::remove_dir_all(root);
    }
}
