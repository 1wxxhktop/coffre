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

mod vault_store;

const KEYCHAIN_SERVICE: &str = "app.coffre.desktop";
/// Service séparé : une clé biométrique ne peut pas être lue par
/// `keychain_load`, qui ne connaît que `KEYCHAIN_SERVICE`.
const BIOMETRIC_SERVICE: &str = "app.coffre.desktop.biometric";

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

/// Vrai si l’appareil propose une biométrie utilisable (Touch ID).
#[tauri::command]
fn biometric_available() -> bool {
    #[cfg(target_os = "macos")]
    {
        biometric::available()
    }
    #[cfg(not(target_os = "macos"))]
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
/// lire une clé biométrique sans passer par Touch ID.
#[tauri::command]
async fn biometric_load(account: String, reason: String) -> Result<BiometricResult, String> {
    #[cfg(target_os = "macos")]
    {
        let authenticated =
            tauri::async_runtime::spawn_blocking(move || biometric::authenticate(&reason))
                .await
                .map_err(|error| error.to_string())??;

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
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (account, reason);
        Err("Le déverrouillage par empreinte n’est pas disponible sur cette plateforme.".into())
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

#[cfg(desktop)]
fn quick_search_shortcut() -> Shortcut {
    let modifier = if cfg!(target_os = "macos") {
        Modifiers::SUPER
    } else {
        Modifiers::CONTROL
    };
    Shortcut::new(Some(modifier | Modifiers::SHIFT), Code::Space)
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

/// Supprime le coffre courant et ses sauvegardes natives.
#[tauri::command(async)]
fn vault_clear(app: tauri::AppHandle) -> Result<(), String> {
    vault_store::clear(&vault_dir(&app)?)
}

/// Vrai pour les URL internes de l’application (production et développement).
fn is_local_url(url: &tauri::Url) -> bool {
    match url.scheme() {
        "tauri" => true,
        "http" | "https" => {
            let host = url.host_str();
            let port = url.port_or_known_default();
            host == Some("tauri.localhost")
                || (host == Some("localhost") || host == Some("127.0.0.1")) && port == Some(1420)
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

/// Ouvre un lien externe validé dans le navigateur système.
#[tauri::command]
fn open_external_url(url: String) -> Result<(), String> {
    launch_external(&url)
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
    let builder = tauri::Builder::default()
        .plugin(NavigationGuard)
        .invoke_handler(tauri::generate_handler![
            keychain_store,
            keychain_load,
            keychain_delete,
            biometric_available,
            biometric_store,
            biometric_delete,
            biometric_load,
            open_external_url,
            vault_read,
            vault_write,
            vault_backup_read,
            vault_backup_write,
            vault_clear
        ]);

    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
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
        .setup(|app| {
            if let Err(error) = app.global_shortcut().register(quick_search_shortcut()) {
                eprintln!("Raccourci global de recherche indisponible : {error}");
            }
            Ok(())
        });

    builder
        .run(tauri::generate_context!())
        .expect("impossible de démarrer Coffre");
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    #[test]
    fn internal_urls_are_allowed() {
        assert!(super::is_local_url(
            &tauri::Url::parse("tauri://localhost/index.html").unwrap()
        ));
        assert!(super::is_local_url(
            &tauri::Url::parse("http://tauri.localhost/").unwrap()
        ));
        assert!(super::is_local_url(
            &tauri::Url::parse("http://localhost:1420/").unwrap()
        ));
        assert!(!super::is_local_url(
            &tauri::Url::parse("https://example.com/").unwrap()
        ));
        assert!(!super::is_local_url(
            &tauri::Url::parse("http://localhost:9999/").unwrap()
        ));
    }

    #[test]
    fn local_authentication_is_queryable() {
        // Aucune authentification n’est déclenchée : on vérifie seulement que
        // LocalAuthentication répond sans paniquer sur la machine.
        let available = super::biometric::available();
        println!("Touch ID disponible : {available}");
    }
}
