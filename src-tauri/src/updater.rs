//! Mises à jour de l’application desktop.
//!
//! Aucune requête n’est faite sans action ou réglage explicite de
//! l’utilisateur : la vérification est déclenchée par l’interface (bouton
//! « Rechercher », ou fréquence choisie dans les réglages, désactivée par
//! défaut).
//!
//! - Source : les releases GitHub du projet (aucun serveur Coffre). Le canal
//!   stable lit le `latest.json` de la dernière release publiée ; le canal bêta
//!   lit celui de la release roulante `canal-beta`.
//! - Authenticité : chaque paquet est signé (minisign) par la clé de release ;
//!   la clé publique est intégrée à la compilation (`COFFRE_UPDATER_PUBKEY`).
//!   Sans elle, la fonction est désactivée (« non configurée »).
//! - Anti-retour en arrière : `requireSignedVersion` (tauri.conf.json) exige
//!   que la signature couvre la version annoncée, pour qu’un manifeste modifié
//!   ne puisse pas réinstaller une ancienne version authentique.
//!
//! La WebView n’a aucune permission `updater:*` : elle passe par les
//! commandes ci-dessous, qui fixent l’adresse et la clé côté Rust.

use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, Runtime, State, Url};
use tauri_plugin_updater::{Update, UpdaterExt};

/// Dépôt dont les releases publient les mises à jour.
const REPOSITORY: &str = "1wxxhktop/coffre";

/// Release roulante qui porte le manifeste du canal bêta.
const BETA_TAG: &str = "canal-beta";

/// Clé publique minisign, fournie à la compilation par la CI de release.
const PUBKEY: Option<&str> = option_env!("COFFRE_UPDATER_PUBKEY");

/// Événement de progression du téléchargement.
pub const PROGRESS_EVENT: &str = "coffre://update-progress";

#[derive(Default)]
pub struct UpdaterState {
    inner: Mutex<Pending>,
}

#[derive(Default)]
struct Pending {
    update: Option<Update>,
    bytes: Option<Vec<u8>>,
    install_on_exit: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdaterInfo {
    configured: bool,
    current_version: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateDescription {
    version: String,
    current_version: String,
    date: Option<String>,
    notes: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Progress {
    downloaded: u64,
    total: Option<u64>,
}

fn configured_pubkey() -> Option<&'static str> {
    PUBKEY.map(str::trim).filter(|key| !key.is_empty())
}

/// Adresse du manifeste pour un canal. Toujours en HTTPS, sur GitHub.
fn endpoint(channel: &str) -> Result<Url, String> {
    let url = match channel {
        "stable" => format!("https://github.com/{REPOSITORY}/releases/latest/download/latest.json"),
        "beta" => {
            format!("https://github.com/{REPOSITORY}/releases/download/{BETA_TAG}/latest.json")
        }
        _ => return Err("invalid-channel".to_string()),
    };
    Url::parse(&url).map_err(|_| "invalid-channel".to_string())
}

fn notes(text: Option<&str>) -> Option<String> {
    text.map(str::trim)
        .filter(|value| !value.is_empty())
        // Les notes viennent du manifeste : affichées en texte brut, bornées.
        .map(|value| value.chars().take(20_000).collect())
}

#[tauri::command]
pub fn updater_info<R: Runtime>(app: AppHandle<R>) -> UpdaterInfo {
    UpdaterInfo {
        configured: configured_pubkey().is_some(),
        current_version: app.package_info().version.to_string(),
    }
}

#[tauri::command]
pub async fn updater_check<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, UpdaterState>,
    channel: String,
) -> Result<Option<UpdateDescription>, String> {
    let pubkey = configured_pubkey().ok_or_else(|| "not-configured".to_string())?;
    let url = endpoint(&channel)?;
    let updater = app
        .updater_builder()
        .pubkey(pubkey)
        .endpoints(vec![url])
        .map_err(|_| "invalid-channel".to_string())?
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|error| format!("check-failed: {error}"))?;
    let update = updater
        .check()
        .await
        .map_err(|error| format!("check-failed: {error}"))?;

    let mut pending = state.inner.lock().map_err(|_| "busy".to_string())?;
    pending.bytes = None;
    pending.install_on_exit = false;
    let Some(update) = update else {
        pending.update = None;
        return Ok(None);
    };
    let description = UpdateDescription {
        version: update.version.clone(),
        current_version: update.current_version.clone(),
        date: update.date.map(|date| date.to_string()),
        notes: notes(update.body.as_deref()),
    };
    pending.update = Some(update);
    Ok(Some(description))
}

#[tauri::command]
pub async fn updater_download<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, UpdaterState>,
) -> Result<(), String> {
    let update = {
        let pending = state.inner.lock().map_err(|_| "busy".to_string())?;
        if pending.bytes.is_some() {
            return Ok(());
        }
        pending
            .update
            .clone()
            .ok_or_else(|| "no-update".to_string())?
    };
    let mut downloaded: u64 = 0;
    let emitter = app.clone();
    // `download` vérifie la signature avant de rendre les octets.
    let bytes = update
        .download(
            move |chunk, total| {
                downloaded += chunk as u64;
                let _ = emitter.emit(PROGRESS_EVENT, Progress { downloaded, total });
            },
            || {},
        )
        .await
        .map_err(|error| format!("download-failed: {error}"))?;
    let mut pending = state.inner.lock().map_err(|_| "busy".to_string())?;
    // Une nouvelle vérification a pu remplacer la mise à jour entre-temps.
    if pending
        .update
        .as_ref()
        .is_some_and(|current| current.version == update.version)
    {
        pending.bytes = Some(bytes);
        Ok(())
    } else {
        Err("no-update".to_string())
    }
}

/// Installe la mise à jour téléchargée puis redémarre Coffre. L’interface a
/// verrouillé le coffre et attendu la fin des écritures avant d’appeler.
#[tauri::command]
pub fn updater_install<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, UpdaterState>,
) -> Result<(), String> {
    let (update, bytes) = {
        let mut pending = state.inner.lock().map_err(|_| "busy".to_string())?;
        let update = pending
            .update
            .clone()
            .ok_or_else(|| "no-update".to_string())?;
        let bytes = pending
            .bytes
            .take()
            .ok_or_else(|| "not-downloaded".to_string())?;
        pending.install_on_exit = false;
        (update, bytes)
    };
    update
        .install(bytes)
        .map_err(|error| format!("install-failed: {error}"))?;
    app.restart();
}

/// Installe la mise à jour téléchargée à la fermeture de Coffre.
#[tauri::command]
pub fn updater_install_on_exit(
    state: State<'_, UpdaterState>,
    enabled: bool,
) -> Result<(), String> {
    let mut pending = state.inner.lock().map_err(|_| "busy".to_string())?;
    if enabled && pending.bytes.is_none() {
        return Err("not-downloaded".to_string());
    }
    pending.install_on_exit = enabled;
    Ok(())
}

/// Oublie la mise à jour trouvée ou téléchargée (« Plus tard », « Ignorer »).
#[tauri::command]
pub fn updater_discard(state: State<'_, UpdaterState>) -> Result<(), String> {
    let mut pending = state.inner.lock().map_err(|_| "busy".to_string())?;
    *pending = Pending::default();
    Ok(())
}

/// Appelé à la fermeture de l’application : installe la mise à jour si
/// l’utilisateur a choisi « à la fermeture ».
pub fn install_pending_on_exit<R: Runtime>(app: &AppHandle<R>) {
    let Some(state) = app.try_state::<UpdaterState>() else {
        return;
    };
    let Ok(mut pending) = state.inner.lock() else {
        return;
    };
    if !pending.install_on_exit {
        return;
    }
    pending.install_on_exit = false;
    if let (Some(update), Some(bytes)) = (pending.update.take(), pending.bytes.take())
        && let Err(error) = update.install(bytes)
    {
        eprintln!("Mise à jour non installée à la fermeture : {error}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn canaux_sur_github_en_https() {
        let stable = endpoint("stable").unwrap();
        assert_eq!(stable.scheme(), "https");
        assert_eq!(stable.host_str(), Some("github.com"));
        assert!(
            stable
                .path()
                .ends_with("/releases/latest/download/latest.json")
        );

        let beta = endpoint("beta").unwrap();
        assert_eq!(beta.scheme(), "https");
        assert!(
            beta.path()
                .ends_with("/releases/download/canal-beta/latest.json")
        );

        assert!(endpoint("nightly").is_err());
        assert!(endpoint("https://exemple.test/latest.json").is_err());
    }

    #[test]
    fn notes_bornees_et_vides_ignorees() {
        assert_eq!(notes(Some("   ")), None);
        assert_eq!(notes(None), None);
        assert_eq!(notes(Some(" Corrections ")).as_deref(), Some("Corrections"));
        let long = "a".repeat(30_000);
        assert_eq!(notes(Some(&long)).unwrap().len(), 20_000);
    }
}
