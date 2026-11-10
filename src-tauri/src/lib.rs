//! Coffre — hôte desktop Tauri.
//!
//! L’interface reste dans la WebView ; ce module expose le trousseau du
//! système, l’authentification biométrique macOS, le stockage natif du coffre
//! et l’ouverture contrôlée des liens externes. Aucune autre commande n’est
//! ouverte à la WebView.

#[cfg(desktop)]
use tauri::Emitter;
use tauri::Manager;
use tauri::Runtime;
use tauri::plugin::Plugin;
#[cfg(desktop)]
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

mod alias_service;
mod autotype;
mod backup_store;
mod blob_store;
mod bridge;
mod lan_sync;
mod session_watch;
mod ssh_agent;
mod sync_store;
#[cfg(desktop)]
mod tray;
#[cfg(desktop)]
mod updater;
mod vault_store;

pub use bridge::{is_native_host_invocation, run_native_host};

const KEYCHAIN_SERVICE: &str = "app.coffre.desktop";
/// Service séparé : une clé biométrique ne peut pas être lue par
/// `keychain_load`, qui ne connaît que `KEYCHAIN_SERVICE`.
const BIOMETRIC_SERVICE: &str = "app.coffre.desktop.biometric";
/// Texte du dialogue biométrique. Il est fixé ici, et non fourni par la
/// WebView, pour qu’un script ne puisse pas présenter une demande trompeuse.
#[cfg(any(target_os = "macos", target_os = "windows"))]
const BIOMETRIC_REASON: &str = "déverrouiller Coffre";

/// Indique si le lancement courant vient de l’ouverture de session.
struct StartupState {
    hidden: bool,
}

#[tauri::command]
fn startup_is_hidden(state: tauri::State<'_, StartupState>) -> bool {
    state.hidden
}

#[tauri::command]
fn autostart_enabled(app: tauri::AppHandle) -> Result<bool, String> {
    #[cfg(desktop)]
    {
        use tauri_plugin_autostart::ManagerExt;
        app.autolaunch()
            .is_enabled()
            .map_err(|error| error.to_string())
    }
    #[cfg(not(desktop))]
    {
        let _ = app;
        Err("Le démarrage automatique n’est pas disponible sur cette plateforme.".into())
    }
}

#[tauri::command]
fn autostart_set(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    #[cfg(desktop)]
    {
        use tauri_plugin_autostart::ManagerExt;
        let manager = app.autolaunch();
        if enabled {
            manager.enable().map_err(|error| error.to_string())
        } else {
            manager.disable().map_err(|error| error.to_string())
        }
    }
    #[cfg(not(desktop))]
    {
        let _ = (app, enabled);
        Err("Le démarrage automatique n’est pas disponible sur cette plateforme.".into())
    }
}

#[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
fn entry_for(service: &str, account: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(service, account).map_err(|error| error.to_string())
}

/// Enregistre un secret dans le trousseau du système.
#[tauri::command]
fn keychain_store(account: String, secret: String) -> Result<(), String> {
    #[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
    {
        entry_for(KEYCHAIN_SERVICE, &account)?
            .set_password(&secret)
            .map_err(|error| error.to_string())
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        let _ = (account, secret);
        Err("Le trousseau du système n’est pas disponible sur cette plateforme.".into())
    }
}

/// Lit un secret du trousseau ; `None` s’il n’existe pas.
#[tauri::command]
fn keychain_load(account: String) -> Result<Option<String>, String> {
    #[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
    {
        match entry_for(KEYCHAIN_SERVICE, &account)?.get_password() {
            Ok(secret) => Ok(Some(secret)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(error) => Err(error.to_string()),
        }
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        let _ = account;
        Ok(None)
    }
}

/// Supprime un secret du trousseau. Une entrée absente n’est pas une erreur.
#[tauri::command]
fn keychain_delete(account: String) -> Result<(), String> {
    #[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
    {
        match entry_for(KEYCHAIN_SERVICE, &account)?.delete_credential() {
            Ok(()) => Ok(()),
            Err(keyring::Error::NoEntry) => Ok(()),
            Err(error) => Err(error.to_string()),
        }
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        let _ = account;
        Ok(())
    }
}

/// Vrai si l’appareil propose une biométrie utilisable (Touch ID ou Windows
/// Hello).
#[tauri::command]
async fn biometric_available() -> bool {
    #[cfg(target_os = "macos")]
    {
        tauri::async_runtime::spawn_blocking(biometric::available)
            .await
            .unwrap_or(false)
    }
    #[cfg(target_os = "windows")]
    {
        tauri::async_runtime::spawn_blocking(windows_hello::available)
            .await
            .unwrap_or(false)
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        false
    }
}

/// Enregistre une clé protégée par empreinte, dans un service distinct.
#[tauri::command]
fn biometric_store(account: String, secret: String) -> Result<(), String> {
    #[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
    {
        entry_for(BIOMETRIC_SERVICE, &account)?
            .set_password(&secret)
            .map_err(|error| error.to_string())
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        let _ = (account, secret);
        Err("La biométrie n’est pas disponible sur cette plateforme.".into())
    }
}

/// Supprime une clé biométrique. Une entrée absente n’est pas une erreur.
#[tauri::command]
fn biometric_delete(account: String) -> Result<(), String> {
    #[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
    {
        match entry_for(BIOMETRIC_SERVICE, &account)?.delete_credential() {
            Ok(()) => Ok(()),
            Err(keyring::Error::NoEntry) => Ok(()),
            Err(error) => Err(error.to_string()),
        }
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        let _ = account;
        Ok(())
    }
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct BiometricResult {
    authenticated: bool,
    secret: Option<String>,
}

/// Authentifie par empreinte puis libère la clé.
///
/// L’authentification est faite dans cette commande : la WebView ne peut pas
/// lire une clé biométrique sans passer par Touch ID ou Windows Hello.
#[tauri::command]
async fn biometric_load(account: String) -> Result<BiometricResult, String> {
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    {
        let authenticated = {
            let reason = BIOMETRIC_REASON;
            #[cfg(target_os = "macos")]
            {
                tauri::async_runtime::spawn_blocking(move || biometric::authenticate(reason))
                    .await
                    .map_err(|error| error.to_string())??
            }
            #[cfg(target_os = "windows")]
            {
                tauri::async_runtime::spawn_blocking(move || windows_hello::confirm(reason))
                    .await
                    .map_err(|error| error.to_string())??
            }
        };

        if !authenticated {
            return Ok(BiometricResult {
                authenticated: false,
                secret: None,
            });
        }

        let secret = match entry_for(BIOMETRIC_SERVICE, &account)?.get_password() {
            Ok(secret) => Some(secret),
            Err(keyring::Error::NoEntry) => None,
            Err(error) => return Err(error.to_string()),
        };

        Ok(BiometricResult {
            authenticated: true,
            secret,
        })
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = account;
        Err("Le déverrouillage biométrique n’est pas disponible sur cette plateforme.".into())
    }
}

/// Demande une authentification biométrique sans lire de secret.
#[tauri::command]
async fn biometric_confirm(reason: String) -> Result<bool, String> {
    #[cfg(target_os = "macos")]
    {
        tauri::async_runtime::spawn_blocking(move || biometric::authenticate(&reason))
            .await
            .map_err(|error| error.to_string())?
    }
    #[cfg(target_os = "windows")]
    {
        tauri::async_runtime::spawn_blocking(move || windows_hello::confirm(&reason))
            .await
            .map_err(|error| error.to_string())?
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = reason;
        Ok(false)
    }
}

#[cfg(target_os = "macos")]
mod biometric {
    use std::sync::mpsc;
    use std::time::Duration;

    use block2::RcBlock;
    use objc2::runtime::Bool;
    use objc2_foundation::{NSError, NSString};
    use objc2_local_authentication::{LAContext, LAPolicy};

    pub fn available() -> bool {
        let context = unsafe { LAContext::new() };
        unsafe {
            context
                .canEvaluatePolicy_error(LAPolicy::DeviceOwnerAuthenticationWithBiometrics)
                .is_ok()
        }
    }

    /// Bloque le thread courant jusqu’à la réponse de Touch ID.
    pub fn authenticate(reason: &str) -> Result<bool, String> {
        let context = unsafe { LAContext::new() };
        unsafe {
            if context
                .canEvaluatePolicy_error(LAPolicy::DeviceOwnerAuthenticationWithBiometrics)
                .is_err()
            {
                return Err(
                    "Touch ID n’est pas disponible ou n’est pas configuré sur cet appareil.".into(),
                );
            }

            let reason = NSString::from_str(reason);
            let (sender, receiver) = mpsc::channel();
            let reply = RcBlock::new(move |success: Bool, _error: *mut NSError| {
                let _ = sender.send(success.as_bool());
            });

            context.evaluatePolicy_localizedReason_reply(
                LAPolicy::DeviceOwnerAuthenticationWithBiometrics,
                &reason,
                &reply,
            );
            drop(reply);

            match receiver.recv_timeout(Duration::from_secs(120)) {
                Ok(success) => Ok(success),
                Err(_) => Err("L’authentification par empreinte a expiré.".into()),
            }
        }
    }
}

#[cfg(target_os = "windows")]
mod windows_hello {
    use windows::Security::Credentials::UI::{
        UserConsentVerificationResult, UserConsentVerifier, UserConsentVerifierAvailability,
    };
    use windows::Win32::System::WinRT::{RO_INIT_MULTITHREADED, RoInitialize};
    use windows::core::HSTRING;

    fn ensure_com() {
        // Les commandes tournent dans `spawn_blocking` ; chaque thread doit
        // initialiser son appartement avant d’appeler une API WinRT.
        unsafe {
            let _ = RoInitialize(RO_INIT_MULTITHREADED);
        }
    }

    pub fn available() -> bool {
        ensure_com();
        UserConsentVerifier::CheckAvailabilityAsync()
            .and_then(|operation| operation.get())
            .map(|availability| availability == UserConsentVerifierAvailability::Available)
            .unwrap_or(false)
    }

    /// Demande une vérification Windows Hello. Un refus, une annulation ou un
    /// échec ne libère jamais la clé : l’appelant reçoit `false` ou une erreur.
    pub fn confirm(reason: &str) -> Result<bool, String> {
        ensure_com();
        if !available() {
            return Err(
                "Windows Hello n’est pas disponible ou n’est pas configuré sur cet appareil."
                    .into(),
            );
        }
        let message = HSTRING::from(reason);
        UserConsentVerifier::RequestVerificationAsync(&message)
            .and_then(|operation| operation.get())
            .map(|result| result == UserConsentVerificationResult::Verified)
            .map_err(|error| error.to_string())
    }
}

#[cfg(desktop)]
fn quick_search_shortcut() -> Shortcut {
    let modifier = if cfg!(target_os = "macos") {
        Modifiers::SUPER
    } else {
        Modifiers::CONTROL
    };
    Shortcut::new(Some(modifier | Modifiers::SHIFT), Code::Space)
}

#[cfg(desktop)]
fn autotype_shortcut() -> Shortcut {
    let modifier = if cfg!(target_os = "macos") {
        Modifiers::SUPER
    } else {
        Modifiers::CONTROL
    };
    Shortcut::new(Some(modifier | Modifiers::SHIFT), Code::KeyA)
}

fn vault_dir(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join("vault"))
        .map_err(|error| error.to_string())
}

/// Lit le coffre courant depuis le stockage natif ; `None` s’il n’existe pas.
#[tauri::command(async)]
fn vault_read(app: tauri::AppHandle) -> Result<Option<String>, String> {
    vault_store::read_current(&vault_dir(&app)?)
}

/// Écrit le coffre courant et fait tourner les trois sauvegardes.
#[tauri::command(async)]
fn vault_write(app: tauri::AppHandle, contents: String) -> Result<(), String> {
    vault_store::write_current(&vault_dir(&app)?, &contents)
}

/// Lit une sauvegarde native (génération 1 à 3).
#[tauri::command(async)]
fn vault_backup_read(app: tauri::AppHandle, generation: u32) -> Result<Option<String>, String> {
    vault_store::read_backup(&vault_dir(&app)?, generation)
}

/// Écrit une sauvegarde native (migration depuis IndexedDB).
#[tauri::command(async)]
fn vault_backup_write(
    app: tauri::AppHandle,
    generation: u32,
    contents: String,
) -> Result<(), String> {
    vault_store::write_backup(&vault_dir(&app)?, generation, &contents)
}

/// Lit l’état anti-retour en arrière (révision maximale vue).
#[tauri::command(async)]
fn vault_state_read(app: tauri::AppHandle) -> Result<Option<String>, String> {
    vault_store::read_state(&vault_dir(&app)?)
}

/// Enregistre l’état anti-retour en arrière.
#[tauri::command(async)]
fn vault_state_write(app: tauri::AppHandle, contents: String) -> Result<(), String> {
    vault_store::write_state(&vault_dir(&app)?, &contents)
}

/// Supprime le coffre courant et ses sauvegardes natives.
#[tauri::command(async)]
fn vault_clear(app: tauri::AppHandle) -> Result<(), String> {
    vault_store::clear(&vault_dir(&app)?)
}

/// Indique si le dossier cible de sauvegarde existe et est accessible.
#[tauri::command(async)]
fn backup_status(dir: String) -> Result<backup_store::BackupStatus, String> {
    backup_store::status(&dir)
}

/// Liste les fichiers de sauvegarde datés d’un dossier.
#[tauri::command(async)]
fn backup_list(dir: String) -> Result<Vec<backup_store::BackupFileInfo>, String> {
    backup_store::list(&dir)
}

/// Supprime des sauvegardes datées après application de la rétention.
#[tauri::command(async)]
fn backup_delete(dir: String, names: Vec<String>) -> Result<usize, String> {
    backup_store::delete(&dir, &names)
}

/// Copie le coffre courant, déjà chiffré, dans le dossier de sauvegarde.
#[tauri::command(async)]
fn backup_copy_current(
    app: tauri::AppHandle,
    dir: String,
    names: Vec<String>,
) -> Result<backup_store::CopyResult, String> {
    let source = vault_dir(&app)?.join("vault.coffre");
    backup_store::copy_current(&source, &dir, &names)
}

/// Lit une sauvegarde pour le test de restauration, sans toucher au coffre.
#[tauri::command(async)]
fn backup_read(dir: String, name: String) -> Result<String, String> {
    backup_store::read(&dir, &name)
}

/// Lit l’identifiant du coffre courant sans le déchiffrer.
#[tauri::command(async)]
fn backup_current_file_id(app: tauri::AppHandle) -> Result<Option<String>, String> {
    backup_store::current_file_id(&vault_dir(&app)?.join("vault.coffre"))
}

/// Prépare `Coffre/<idFichier>/` dans un dossier synchronisé choisi.
#[tauri::command(async)]
fn sync_prepare(base: String, file_id: String) -> Result<String, String> {
    sync_store::prepare(&base, &file_id)
}

/// Liste les fichiers `.coffre` d’un dossier synchronisé.
#[tauri::command(async)]
fn sync_list(dir: String) -> Result<Vec<sync_store::SyncFileInfo>, String> {
    sync_store::list(&dir)
}

/// Lit un fichier `.coffre` d’un dossier synchronisé.
#[tauri::command(async)]
fn sync_read(dir: String, name: String) -> Result<Option<String>, String> {
    sync_store::read(&dir, &name)
}

/// Écrit un fichier `.coffre` de façon atomique dans un dossier synchronisé.
#[tauri::command(async)]
fn sync_write(dir: String, name: String, contents: String) -> Result<(), String> {
    sync_store::write(&dir, &name, &contents)
}

/// Surveille un dossier synchronisé et émet `coffre:sync-changed`.
#[tauri::command]
fn sync_watch(
    app: tauri::AppHandle,
    state: tauri::State<'_, sync_store::SyncState>,
    dir: String,
) -> Result<(), String> {
    sync_store::watch(app, state, &dir)
}

#[tauri::command]
fn sync_unwatch(state: tauri::State<'_, sync_store::SyncState>) -> Result<(), String> {
    sync_store::unwatch(state)
}

/// Vrai pour les URL internes de l’application. Le serveur de développement
/// (`localhost:1420`) n’est accepté que dans les builds de débogage : en
/// production, une page locale quelconque sur ce port ne doit pas pouvoir
/// s’exécuter dans la coque Tauri ni appeler ses commandes.
fn is_local_url(url: &tauri::Url) -> bool {
    is_local_url_for(url, cfg!(debug_assertions))
}

fn is_local_url_for(url: &tauri::Url, allow_dev_server: bool) -> bool {
    match url.scheme() {
        "tauri" => true,
        "http" | "https" => {
            let host = url.host_str();
            let port = url.port_or_known_default();
            host == Some("tauri.localhost")
                || allow_dev_server
                    && (host == Some("localhost") || host == Some("127.0.0.1"))
                    && port == Some(1420)
        }
        _ => false,
    }
}

/// Ouvre une URL http(s) dans le navigateur système, sans passer par un shell.
fn launch_external(url: &str) -> Result<(), String> {
    let parsed = tauri::Url::parse(url).map_err(|error| error.to_string())?;
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return Err("Seules les URL http(s) sont autorisées.".into());
    }
    if parsed.host_str().is_none() || url.chars().any(|character| character.is_control()) {
        return Err("URL externe invalide.".into());
    }

    #[cfg(target_os = "macos")]
    let mut command = {
        let mut command = std::process::Command::new("open");
        command.arg(url);
        command
    };

    #[cfg(target_os = "windows")]
    let mut command = {
        let mut command = std::process::Command::new("rundll32");
        command.args(["url.dll,FileProtocolHandler", url]);
        command
    };

    #[cfg(target_os = "linux")]
    let mut command = {
        let mut command = std::process::Command::new("xdg-open");
        command.arg(url);
        command
    };

    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        let _ = url;
        return Err("Ouverture de lien non prise en charge sur cette plateforme.".into());
    }

    command
        .spawn()
        .map(|_| ())
        .map_err(|error| error.to_string())
}

/// Fusionne des fichiers `.coffre` déjà authentifiés sans les déchiffrer.
/// La WebView fournit uniquement les JSON chiffrés ; aucun mot de passe ni
/// contenu clair ne traverse cette commande.
#[tauri::command]
fn core_merge_files(local_json: String, remotes_json: Vec<String>) -> Result<String, String> {
    let local = coffre_core::VaultFile::parse(&local_json).map_err(|error| error.to_string())?;
    let mut remotes = Vec::with_capacity(remotes_json.len());
    for remote in remotes_json {
        remotes.push(coffre_core::VaultFile::parse(&remote).map_err(|error| error.to_string())?);
    }
    let result = coffre_core::merge(&local, &remotes).map_err(|error| error.to_string())?;
    serde_json::to_string(&serde_json::json!({
        "file": result.file,
        "conflicts": result.conflicts,
        "warnings": result.warnings,
    }))
    .map_err(|error| error.to_string())
}

/// Ouvre un lien externe validé dans le navigateur système.
#[tauri::command]
fn open_external_url(url: String) -> Result<(), String> {
    launch_external(&url)
}

const HIBP_PREFIX_LENGTH: usize = 5;
const HIBP_MAX_RESPONSE_BYTES: usize = 2_000_000;

/// Valide un préfixe HIBP avant toute requête réseau : cinq caractères
/// hexadécimaux, jamais une URL ou un hash complet.
fn normalize_hibp_prefix(prefix: &str) -> Result<String, String> {
    let value = prefix.trim().to_ascii_uppercase();
    if value.len() != HIBP_PREFIX_LENGTH || !value.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err("Préfixe HIBP invalide".into());
    }
    Ok(value)
}

/// Interroge Have I Been Pwned en k-anonymat. La WebView ne fait aucune
/// requête réseau : la CSP desktop reste sans `connect-src` externe.
#[tauri::command(async)]
async fn hibp_range(prefix: String) -> Result<String, String> {
    let prefix = normalize_hibp_prefix(&prefix)?;
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|_| "Client HTTP indisponible".to_string())?;
    let response = client
        .get(format!("https://api.pwnedpasswords.com/range/{prefix}"))
        .header("Add-Padding", "true")
        .header("User-Agent", concat!("Coffre/", env!("CARGO_PKG_VERSION")))
        .send()
        .await
        .map_err(|_| "Requête HIBP impossible".to_string())?;
    if !response.status().is_success() {
        return Err(format!("HIBP HTTP {}", response.status().as_u16()));
    }
    let body = response
        .text()
        .await
        .map_err(|_| "Réponse HIBP illisible".to_string())?;
    if body.len() > HIBP_MAX_RESPONSE_BYTES {
        return Err("Réponse HIBP trop volumineuse".into());
    }
    Ok(body)
}

/// Copie un secret dans le presse-papiers du système en demandant aux
/// gestionnaires d’historique (macOS, Windows, Linux) de l’ignorer.
#[tauri::command]
fn clipboard_copy_secret(app: tauri::AppHandle, text: String) -> Result<(), String> {
    use tauri_plugin_clipboard_manager::ClipboardExt;
    app.clipboard()
        .write_secret(text)
        .map_err(|error| error.to_string())
}

/// Efface le presse-papiers s’il contient encore exactement `expected`.
///
/// La lecture native ne dépend pas d’un geste de l’utilisateur, contrairement à
/// `navigator.clipboard.readText()` dans WebKit : l’effacement différé
/// fonctionne donc réellement dans l’application desktop. Un contenu copié
/// entre-temps par l’utilisateur n’est jamais effacé.
#[tauri::command]
fn clipboard_clear_if(app: tauri::AppHandle, expected: String) -> Result<bool, String> {
    use tauri_plugin_clipboard_manager::ClipboardExt;
    let clipboard = app.clipboard();
    match clipboard.read_text() {
        Ok(current) if !expected.is_empty() && current == expected => {
            clipboard.clear().map_err(|error| error.to_string())?;
            Ok(true)
        }
        _ => Ok(false),
    }
}

/// Empêche la WebView de naviguer vers un site distant. Une telle navigation
/// est redirigée vers le navigateur système, ce qui évite d’exécuter du contenu
/// distant dans la coque Tauri.
struct NavigationGuard;

impl<R: Runtime> Plugin<R> for NavigationGuard {
    fn name(&self) -> &'static str {
        "coffre-navigation-guard"
    }

    fn on_navigation(&mut self, _webview: &tauri::Webview<R>, url: &tauri::Url) -> bool {
        if is_local_url(url) {
            return true;
        }
        let _ = launch_external(url.as_str());
        false
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let started_hidden = std::env::args().any(|argument| argument == "--autostart");
    let builder = tauri::Builder::default()
        .manage(bridge::BridgeState::default())
        .manage(sync_store::SyncState::default())
        .manage(lan_sync::LanState::load())
        .manage(ssh_agent::SshAgentState::default())
        .manage(StartupState {
            hidden: started_hidden,
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(NavigationGuard)
        // Utilisé uniquement depuis les commandes Rust ci-dessus : aucune
        // permission `clipboard-manager:*` n’est accordée à la WebView.
        .plugin(tauri_plugin_clipboard_manager::init())
        .invoke_handler(tauri::generate_handler![
            keychain_store,
            keychain_load,
            keychain_delete,
            biometric_available,
            biometric_confirm,
            biometric_store,
            biometric_delete,
            biometric_load,
            open_external_url,
            hibp_range,
            core_merge_files,
            ssh_agent::ssh_agent_start,
            ssh_agent::ssh_agent_stop,
            ssh_agent::ssh_agent_status,
            ssh_agent::ssh_agent_respond,
            bridge::bridge_send,
            clipboard_copy_secret,
            clipboard_clear_if,
            vault_read,
            vault_write,
            vault_backup_read,
            vault_backup_write,
            vault_state_read,
            vault_state_write,
            vault_clear,
            backup_status,
            backup_list,
            backup_delete,
            backup_copy_current,
            backup_read,
            backup_current_file_id,
            alias_service::alias_create,
            blob_store::blob_encrypt,
            blob_store::blob_list,
            blob_store::blob_export_to,
            blob_store::blob_import_from,
            blob_store::blob_decrypt,
            blob_store::blob_preview,
            blob_store::blob_remove,
            autotype::autotype_active_window,
            autotype::autotype_run,
            lan_sync::lan_discover,
            lan_sync::lan_update_peer_host,
            lan_sync::lan_identity,
            lan_sync::lan_pair_start,
            lan_sync::lan_pair_join,
            lan_sync::lan_peers,
            lan_sync::lan_forget_peer,
            lan_sync::lan_sync_serve,
            lan_sync::lan_sync_pull,
            sync_prepare,
            sync_list,
            sync_read,
            sync_write,
            sync_watch,
            sync_unwatch,
            autostart_enabled,
            autostart_set,
            startup_is_hidden,
            tray::tray_set_language,
            tray::tray_set_keep_on_close,
            updater::updater_info,
            updater::updater_check,
            updater::updater_download,
            updater::updater_install,
            updater::updater_install_on_exit,
            updater::updater_discard
        ]);

    #[cfg(desktop)]
    let builder = builder
        .manage(tray::TrayState::default())
        .manage(updater::UpdaterState::default())
        // Aucune permission `updater:*` n’est accordée à la WebView : les
        // commandes de `updater.rs` fixent l’adresse et la clé côté Rust.
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--autostart"]),
        ))
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }));

    #[cfg(desktop)]
    let builder = builder
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state == ShortcutState::Pressed && shortcut == &autotype_shortcut() {
                        let window_info = autotype::autotype_active_window().ok();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.unminimize();
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                        if let Some(info) = window_info {
                            let _ = app.emit("coffre:autotype-request", info);
                        }
                        return;
                    }
                    if event.state == ShortcutState::Pressed && shortcut == &quick_search_shortcut()
                    {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.unminimize();
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                        let _ = app.emit("coffre:quick-search", ());
                    }
                })
                .build(),
        )
        .on_window_event(|window, event| {
            if window.label() != "main" {
                return;
            }
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                if tray::keeps_window_on_close(window.app_handle()) {
                    let _ = window.hide();
                } else {
                    window.app_handle().exit(0);
                }
            }
        })
        .setup(move |app| {
            if let Err(error) = tray::init(app.handle()) {
                eprintln!("Icône de barre de menus indisponible : {error}");
            }
            if let Err(error) = session_watch::start(app.handle().clone()) {
                eprintln!("Surveillance de session indisponible : {error}");
            }
            if started_hidden && let Some(window) = app.get_webview_window("main") {
                let _ = window.hide();
            }
            if let Err(error) = app.global_shortcut().register(quick_search_shortcut()) {
                eprintln!("Raccourci global de recherche indisponible : {error}");
            }
            if let Err(error) = app.global_shortcut().register(autotype_shortcut()) {
                eprintln!("Raccourci global de saisie automatique indisponible : {error}");
            }
            if let Err(error) = bridge::start_server(app.handle().clone()) {
                eprintln!("Pont natif indisponible : {error}");
            }
            if let Err(error) = bridge::install_native_hosts() {
                #[cfg(debug_assertions)]
                eprintln!("Hôte de messagerie native non installé : {error}");
                let _ = error;
            }
            Ok(())
        });

    builder
        .build(tauri::generate_context!())
        .expect("impossible de démarrer Coffre")
        .run(|app, event| {
            // Option « Installer à la fermeture » des mises à jour.
            #[cfg(desktop)]
            if let tauri::RunEvent::Exit = event {
                updater::install_pending_on_exit(app);
            }
            #[cfg(not(desktop))]
            let _ = (app, event);
        });
}

#[cfg(test)]
mod hibp_tests {
    #[test]
    fn valide_le_prefixe_hibp() {
        assert_eq!(super::normalize_hibp_prefix("5baa6").unwrap(), "5BAA6");
        assert!(super::normalize_hibp_prefix("5BAA6").is_ok());
        assert!(super::normalize_hibp_prefix("5BAA").is_err());
        assert!(super::normalize_hibp_prefix("5BAA61").is_err());
        assert!(super::normalize_hibp_prefix("5BAAZ").is_err());
        assert!(super::normalize_hibp_prefix("https://example.com").is_err());
    }
}

#[cfg(test)]
mod tests {
    use super::is_local_url_for;

    fn url(value: &str) -> tauri::Url {
        tauri::Url::parse(value).unwrap()
    }

    #[test]
    fn urls_internes_autorisees() {
        for allow_dev in [false, true] {
            assert!(is_local_url_for(
                &url("tauri://localhost/index.html"),
                allow_dev
            ));
            assert!(is_local_url_for(&url("http://tauri.localhost/"), allow_dev));
            assert!(!is_local_url_for(&url("https://example.com/"), allow_dev));
            assert!(!is_local_url_for(&url("http://localhost:9999/"), allow_dev));
            assert!(!is_local_url_for(&url("file:///etc/passwd"), allow_dev));
        }
    }

    #[test]
    fn serveur_de_dev_refuse_en_production() {
        assert!(is_local_url_for(&url("http://localhost:1420/"), true));
        assert!(is_local_url_for(&url("http://127.0.0.1:1420/"), true));
        assert!(!is_local_url_for(&url("http://localhost:1420/"), false));
        assert!(!is_local_url_for(&url("http://127.0.0.1:1420/"), false));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn local_authentication_is_queryable() {
        // Aucune authentification n’est déclenchée : on vérifie seulement que
        // LocalAuthentication répond sans paniquer sur la machine.
        let available = super::biometric::available();
        println!("Touch ID disponible : {available}");
    }
}
