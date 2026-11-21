//! Mises à jour de l’APK Android.
//!
//! Android ne passe pas par `tauri-plugin-updater` : un APK sideloadé ne peut
//! pas être remplacé silencieusement. Le flux vérifie `android-beta.json`,
//! télécharge l’APK, contrôle son SHA-256, puis ouvre l’installateur système.
//! Aucune requête n’est faite sans réglage ou action explicite.
//!
//! Android vérifie de son côté que le nouvel APK est signé par la même clé que
//! l’application installée : le SHA-256 protège le téléchargement, la signature
//! protège l’identité de l’application.

#[cfg(any(target_os = "android", test))]
use std::collections::HashMap;

use tauri::AppHandle;

#[cfg(any(target_os = "android", test))]
const REPOSITORY: &str = "1wxxhktop/coffre";
#[cfg(any(target_os = "android", test))]
const BETA_MANIFEST: &str =
    "https://github.com/1wxxhktop/coffre/releases/download/canal-beta/android-beta.json";
#[cfg(target_os = "android")]
const PROGRESS_EVENT: &str = "coffre://update-progress";

/// Résultat renvoyé à l’interface, identique au manifeste desktop.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AndroidUpdateDescription {
    pub version: String,
    pub current_version: String,
    pub date: Option<String>,
    pub notes: Option<String>,
}

#[cfg(any(target_os = "android", test))]
#[derive(Debug, serde::Deserialize)]
#[allow(dead_code)] // Certains champs ne servent qu’au manifeste Android.
struct BetaManifest {
    version: String,
    url: String,
    sha256: String,
    notes: Option<String>,
    pub_date: Option<String>,
}

#[cfg(any(target_os = "android", test))]
#[derive(Debug, serde::Deserialize)]
#[allow(dead_code)] // Certains champs ne servent qu’au manifeste Android.
struct StableManifest {
    version: String,
    notes: Option<String>,
    pub_date: Option<String>,
    platforms: HashMap<String, StablePlatform>,
}

#[cfg(any(target_os = "android", test))]
#[derive(Debug, serde::Deserialize)]
#[allow(dead_code)] // Certains champs ne servent qu’au manifeste Android.
struct StablePlatform {
    url: String,
    sha256: Option<String>,
}

#[cfg(any(target_os = "android", test))]
fn manifest_url(channel: &str) -> Result<String, String> {
    match channel {
        "beta" | "" => Ok(BETA_MANIFEST.to_string()),
        "stable" => Ok(format!(
            "https://github.com/{REPOSITORY}/releases/latest/download/latest.json"
        )),
        _ => Err("invalid-channel".into()),
    }
}

#[cfg(any(target_os = "android", test))]
fn parse_beta_manifest(body: &str) -> Result<BetaManifest, String> {
    serde_json::from_str(body).map_err(|_| "check-failed".to_string())
}

#[cfg(any(target_os = "android", test))]
fn parse_stable_manifest(body: &str) -> Result<StableManifest, String> {
    serde_json::from_str(body).map_err(|_| "check-failed".to_string())
}

/// Vrai si la version distante est strictement plus récente que la version
/// installée. Les préversions suivent semver : `0.18.0` est plus récent que
/// `0.18.0-beta.131.1`.
#[cfg(any(target_os = "android", test))]
fn is_newer(remote: &str, local: &str) -> Result<bool, String> {
    let remote = semver::Version::parse(remote).map_err(|_| "check-failed".to_string())?;
    let local = semver::Version::parse(local).map_err(|_| "check-failed".to_string())?;
    Ok(remote > local)
}

#[cfg(target_os = "android")]
mod imp {
    use std::io::Write;
    use std::path::{Path, PathBuf};
    use std::sync::Mutex;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::time::Duration;

    use sha2::{Digest, Sha256};
    use tauri::{AppHandle, Emitter, Manager};

    use super::{
        AndroidUpdateDescription, BetaManifest, PROGRESS_EVENT, is_newer, manifest_url,
        parse_beta_manifest, parse_stable_manifest,
    };

    #[derive(Clone)]
    struct Pending {
        version: String,
        url: String,
        sha256: String,
        path: Option<PathBuf>,
    }

    static PENDING: Mutex<Option<Pending>> = Mutex::new(None);
    static DOWNLOADING: AtomicBool = AtomicBool::new(false);
    /// Plafond de sécurité : l’APK publié pèse environ 30 Mo.
    const MAX_APK_BYTES: u64 = 200 * 1024 * 1024;

    #[derive(Clone, serde::Serialize)]
    #[serde(rename_all = "camelCase")]
    struct Progress {
        downloaded: u64,
        total: Option<u64>,
    }

    async fn fetch_manifest(channel: &str) -> Result<Option<BetaManifest>, String> {
        let url = manifest_url(channel)?;
        let response = reqwest::Client::builder()
            .timeout(Duration::from_secs(30))
            .build()
            .map_err(|_| "check-failed".to_string())?
            .get(&url)
            .send()
            .await
            .map_err(|_| "check-failed".to_string())?;
        if !response.status().is_success() {
            return Err("check-failed".into());
        }
        let body = response
            .text()
            .await
            .map_err(|_| "check-failed".to_string())?;
        if channel == "beta" || channel.is_empty() {
            return parse_beta_manifest(&body).map(Some);
        }
        let stable = parse_stable_manifest(&body)?;
        let Some(platform) = stable
            .platforms
            .get("android-aarch64")
            .or_else(|| stable.platforms.get("android-arm64"))
        else {
            return Ok(None);
        };
        let sha256 = platform
            .sha256
            .clone()
            .ok_or_else(|| "checksum-missing".to_string())?;
        Ok(Some(BetaManifest {
            version: stable.version,
            url: platform.url.clone(),
            sha256,
            notes: stable.notes,
            pub_date: stable.pub_date,
        }))
    }

    pub async fn check(
        app: AppHandle,
        channel: String,
    ) -> Result<Option<AndroidUpdateDescription>, String> {
        if DOWNLOADING.load(Ordering::SeqCst) {
            return Err("busy".into());
        }
        let Some(manifest) = fetch_manifest(&channel).await? else {
            *PENDING.lock().map_err(|_| "busy".to_string())? = None;
            return Ok(None);
        };
        let current = app.package_info().version.to_string();
        if !is_newer(&manifest.version, &current)? {
            *PENDING.lock().map_err(|_| "busy".to_string())? = None;
            return Ok(None);
        }
        let sha256 = manifest.sha256.to_lowercase();
        if sha256.len() != 64 || !sha256.chars().all(|c| c.is_ascii_hexdigit()) {
            return Err("checksum-missing".into());
        }
        *PENDING.lock().map_err(|_| "busy".to_string())? = Some(Pending {
            version: manifest.version.clone(),
            url: manifest.url,
            sha256,
            path: None,
        });
        Ok(Some(AndroidUpdateDescription {
            version: manifest.version,
            current_version: current,
            date: manifest.pub_date,
            notes: manifest
                .notes
                .map(|value| value.chars().take(20_000).collect()),
        }))
    }

    pub async fn download(app: AppHandle) -> Result<(), String> {
        // Un seul téléchargement à la fois : `check` et `discard` ne doivent
        // pas remplacer l’entrée pendant l’écriture du fichier.
        if DOWNLOADING.swap(true, Ordering::SeqCst) {
            return Err("busy".into());
        }
        struct Reset;
        impl Drop for Reset {
            fn drop(&mut self) {
                DOWNLOADING.store(false, Ordering::SeqCst);
            }
        }
        let _reset = Reset;

        let pending = PENDING
            .lock()
            .map_err(|_| "busy".to_string())?
            .clone()
            .ok_or_else(|| "no-update".to_string())?;
        // Une recherche manuelle peut avoir réinitialisé le statut côté
        // interface : ne pas retélécharger un APK déjà présent.
        if pending.path.as_ref().is_some_and(|path| path.is_file()) {
            return Ok(());
        }
        let directory = app
            .path()
            .app_cache_dir()
            .map_err(|_| "download-failed".to_string())?;
        std::fs::create_dir_all(&directory).map_err(|_| "download-failed".to_string())?;
        let part = directory.join("Coffre-update.apk.part");
        let final_path = directory.join("Coffre-update.apk");
        let _ = std::fs::remove_file(&part);

        if let Err(error) = write_apk(&app, &pending, &part).await {
            let _ = std::fs::remove_file(&part);
            return Err(error);
        }
        if let Err(error) = std::fs::rename(&part, &final_path) {
            let _ = std::fs::remove_file(&part);
            return Err(format!("download-failed: {error}"));
        }
        {
            let mut current = PENDING.lock().map_err(|_| "busy".to_string())?;
            let Some(update) = current.as_mut() else {
                let _ = std::fs::remove_file(&final_path);
                return Err("no-update".into());
            };
            if update.version != pending.version {
                let _ = std::fs::remove_file(&final_path);
                return Err("no-update".into());
            }
            update.path = Some(final_path);
        }
        Ok(())
    }

    async fn write_apk(app: &AppHandle, pending: &Pending, path: &Path) -> Result<(), String> {
        let mut response = reqwest::Client::builder()
            .timeout(Duration::from_secs(600))
            .build()
            .map_err(|_| "download-failed".to_string())?
            .get(&pending.url)
            .send()
            .await
            .map_err(|_| "download-failed".to_string())?;
        if !response.status().is_success() {
            return Err("download-failed".into());
        }
        let total = response.content_length();
        if total.is_some_and(|size| size > MAX_APK_BYTES) {
            return Err("download-failed".into());
        }
        let mut file = std::fs::File::create(path).map_err(|_| "download-failed".to_string())?;
        let mut hasher = Sha256::new();
        let mut downloaded = 0_u64;
        let mut last_emit = 0_u64;
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|_| "download-failed".to_string())?
        {
            file.write_all(&chunk)
                .map_err(|_| "download-failed".to_string())?;
            hasher.update(&chunk);
            downloaded += chunk.len() as u64;
            if downloaded > MAX_APK_BYTES {
                return Err("download-failed".into());
            }
            if downloaded - last_emit >= 262_144 || total.is_some_and(|size| downloaded >= size) {
                let _ = app.emit(PROGRESS_EVENT, Progress { downloaded, total });
                last_emit = downloaded;
            }
        }
        file.flush().map_err(|_| "download-failed".to_string())?;
        drop(file);
        let digest = format!("{:x}", hasher.finalize());
        if digest != pending.sha256 {
            return Err("checksum-failed".into());
        }
        let _ = app.emit(PROGRESS_EVENT, Progress { downloaded, total });
        Ok(())
    }

    pub fn install() -> Result<(), String> {
        let path = PENDING
            .lock()
            .map_err(|_| "busy".to_string())?
            .as_ref()
            .and_then(|pending| pending.path.clone())
            .ok_or_else(|| "not-downloaded".to_string())?;
        install_apk(&path)
    }

    pub fn discard() {
        let path = PENDING
            .lock()
            .ok()
            .and_then(|mut pending| pending.take())
            .and_then(|pending| pending.path);
        if let Some(path) = path {
            let _ = std::fs::remove_file(path);
        }
    }

    fn install_apk(path: &Path) -> Result<(), String> {
        let path = path.to_string_lossy().to_string();
        let context = ndk_context::android_context();
        let vm = unsafe { jni::JavaVM::from_raw(context.vm().cast()) }
            .map_err(|_| "install-failed".to_string())?;
        let mut env = vm
            .attach_current_thread()
            .map_err(|_| "install-failed".to_string())?;
        // `ndk_context` conserve le contexte d’application, pas l’activité :
        // `CoffreApplication.installApk` démarre l’installateur avec
        // `FLAG_ACTIVITY_NEW_TASK`.
        let application = unsafe { jni::objects::JObject::from_raw(context.context().cast()) };
        let path = env
            .new_string(path)
            .map_err(|_| "install-failed".to_string())?;
        let result = env
            .call_method(
                &application,
                "installApk",
                "(Ljava/lang/String;)Z",
                &[jni::objects::JValue::Object(&*path)],
            )
            .map_err(|_| "install-failed".to_string())?;
        if result.z().unwrap_or(false) {
            Ok(())
        } else {
            Err("install-failed".into())
        }
    }
}

#[tauri::command]
pub async fn android_updater_check(
    app: AppHandle,
    channel: String,
) -> Result<Option<AndroidUpdateDescription>, String> {
    #[cfg(target_os = "android")]
    {
        imp::check(app, channel).await
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, channel);
        Err("unsupported".into())
    }
}

#[tauri::command]
pub async fn android_updater_download(app: AppHandle) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        imp::download(app).await
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        Err("unsupported".into())
    }
}

#[tauri::command]
pub fn android_updater_install() -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        imp::install()
    }
    #[cfg(not(target_os = "android"))]
    {
        Err("unsupported".into())
    }
}

#[tauri::command]
pub fn android_updater_discard() -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        imp::discard();
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn construit_les_adresses_des_manifestes() {
        assert!(
            manifest_url("beta")
                .unwrap()
                .ends_with("/canal-beta/android-beta.json")
        );
        assert!(
            manifest_url("")
                .unwrap()
                .ends_with("/canal-beta/android-beta.json")
        );
        let stable = manifest_url("stable").unwrap();
        assert!(stable.ends_with("/releases/latest/download/latest.json"));
        assert_eq!(manifest_url("nuit"), Err("invalid-channel".to_string()));
    }

    #[test]
    fn lit_un_manifeste_beta_complet() {
        let manifest = parse_beta_manifest(
            r#"{
                "version": "0.18.0-beta.131.1",
                "url": "https://example.com/Coffre.apk",
                "sha256": "ABCDEF",
                "notes": "Bêta",
                "pub_date": "2026-11-21T00:00:00Z"
            }"#,
        )
        .unwrap();
        assert_eq!(manifest.version, "0.18.0-beta.131.1");
        assert_eq!(manifest.sha256, "ABCDEF");
        assert_eq!(manifest.notes.as_deref(), Some("Bêta"));
    }

    #[test]
    fn refuse_un_manifeste_beta_incomplet() {
        assert_eq!(parse_beta_manifest("{}").unwrap_err(), "check-failed");
        assert_eq!(
            parse_beta_manifest("pas du json").unwrap_err(),
            "check-failed"
        );
    }

    #[test]
    fn lit_le_manifeste_stable_android() {
        let stable = parse_stable_manifest(
            r#"{
                "version": "1.2.3",
                "platforms": {
                    "android-aarch64": {
                        "url": "https://example.com/Coffre.apk",
                        "sha256": "abc"
                    }
                }
            }"#,
        )
        .unwrap();
        assert_eq!(stable.version, "1.2.3");
        assert_eq!(
            stable
                .platforms
                .get("android-aarch64")
                .unwrap()
                .sha256
                .as_deref(),
            Some("abc")
        );
    }

    #[test]
    fn compare_les_versions_semver() {
        assert!(is_newer("0.18.0-beta.131.1", "0.18.0-beta.130.1").unwrap());
        assert!(is_newer("0.18.0", "0.18.0-beta.131.1").unwrap());
        assert!(!is_newer("0.18.0-beta.130.1", "0.18.0-beta.130.1").unwrap());
        assert!(!is_newer("0.17.0", "0.18.0-beta.130.1").unwrap());
        assert_eq!(
            is_newer("pas-une-version", "0.18.0").unwrap_err(),
            "check-failed"
        );
    }
}
