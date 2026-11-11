//! Pont natif entre l’extension navigateur et l’application desktop.
//!
//! Le binaire Coffre peut être lancé par le navigateur comme hôte de
//! messagerie native. Dans ce mode, il relaie les trames préfixées par leur
//! longueur entre stdin/stdout et un socket local appartenant à l’utilisateur.
//! L’application écoute ce socket et transmet les trames à la WebView, qui gère
//! l’appairage et le chiffrement. Le relais ne voit jamais de secret en clair.

use std::collections::HashMap;
use std::io::{self, Read, Write};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
#[cfg(unix)]
use std::time::Duration;

use serde::Serialize;
use tauri::{Emitter, Manager};

const MAX_FRAME_BYTES: usize = 1024 * 1024;
const MAX_BRIDGE_CONNECTIONS: usize = 16;
const SOCKET_FILE: &str = "bridge.sock";
/// Identifiant stable de l’extension Chromium (dérivé de la clé du manifeste).
pub const CHROME_EXTENSION_ID: &str = "dmajddgmehhebmpcdooifjdakjjngdla";
/// Identifiant de l’extension Firefox.
pub const FIREFOX_EXTENSION_ID: &str = "coffre@1wxxhktop.github.io";

#[derive(Default)]
pub struct BridgeState {
    #[cfg(unix)]
    connections: Mutex<HashMap<u64, Arc<Mutex<std::os::unix::net::UnixStream>>>>,
    next_id: AtomicU64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct BridgeFrame {
    connection_id: u64,
    data: Vec<u8>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct BridgeClosed {
    connection_id: u64,
}

fn home_dir() -> Result<PathBuf, String> {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .ok_or_else(|| "Dossier personnel introuvable".to_string())
}

/// Dossier de données de l’application, identique à `app_data_dir()` de Tauri.
#[cfg(target_os = "macos")]
pub(crate) fn app_data_root() -> Result<PathBuf, String> {
    Ok(home_dir()?.join("Library/Application Support/app.coffre.desktop"))
}

#[cfg(target_os = "linux")]
pub(crate) fn app_data_root() -> Result<PathBuf, String> {
    let base = std::env::var_os("XDG_DATA_HOME")
        .map(PathBuf::from)
        .unwrap_or(home_dir()?.join(".local/share"));
    Ok(base.join("app.coffre.desktop"))
}

#[cfg(target_os = "windows")]
pub(crate) fn app_data_root() -> Result<PathBuf, String> {
    let base = std::env::var_os("APPDATA")
        .map(PathBuf::from)
        .ok_or_else(|| "APPDATA introuvable".to_string())?;
    Ok(base.join("app.coffre.desktop"))
}

#[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
pub(crate) fn app_data_root() -> Result<PathBuf, String> {
    Err("Plateforme non prise en charge par le pont natif".into())
}

fn socket_path() -> Result<PathBuf, String> {
    // Variable réservée aux tests d’intégration du relais ; elle ne doit pas
    // être active dans un binaire de production.
    #[cfg(debug_assertions)]
    if let Some(path) = std::env::var_os("COFFRE_BRIDGE_SOCKET") {
        return Ok(PathBuf::from(path));
    }
    Ok(app_data_root()?.join("bridge").join(SOCKET_FILE))
}

#[cfg(unix)]
fn set_mode(path: &std::path::Path, mode: u32) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(mode))
        .map_err(|error| error.to_string())
}

#[cfg(not(unix))]
fn set_mode(_path: &std::path::Path, _mode: u32) -> Result<(), String> {
    Ok(())
}

fn read_frame<R: Read>(reader: &mut R) -> Result<Option<Vec<u8>>, String> {
    let mut header = [0u8; 4];
    match reader.read_exact(&mut header) {
        Ok(()) => {}
        Err(error) if error.kind() == io::ErrorKind::UnexpectedEof => return Ok(None),
        Err(error) if error.kind() == io::ErrorKind::ConnectionReset => return Ok(None),
        Err(error) => return Err(error.to_string()),
    }
    let length = u32::from_ne_bytes(header) as usize;
    if length == 0 || length > MAX_FRAME_BYTES {
        return Err("Trame de pont invalide".into());
    }
    let mut data = vec![0u8; length];
    reader
        .read_exact(&mut data)
        .map_err(|error| error.to_string())?;
    Ok(Some(data))
}

fn write_frame<W: Write>(writer: &mut W, data: &[u8]) -> Result<(), String> {
    if data.is_empty() || data.len() > MAX_FRAME_BYTES {
        return Err("Trame de pont invalide".into());
    }
    writer
        .write_all(&(data.len() as u32).to_ne_bytes())
        .map_err(|error| error.to_string())?;
    writer.write_all(data).map_err(|error| error.to_string())?;
    writer.flush().map_err(|error| error.to_string())
}

#[cfg(unix)]
fn spawn_connection(app: tauri::AppHandle, stream: std::os::unix::net::UnixStream) {
    use std::os::unix::net::UnixStream as StdUnixStream;

    let id = app
        .state::<BridgeState>()
        .next_id
        .fetch_add(1, Ordering::Relaxed);
    let writer: StdUnixStream = match stream.try_clone() {
        Ok(writer) => writer,
        Err(_) => return,
    };
    {
        let state = app.state::<BridgeState>();
        let mut connections = match state.connections.lock() {
            Ok(connections) => connections,
            Err(_) => return,
        };
        connections.insert(id, Arc::new(Mutex::new(writer)));
    }

    std::thread::spawn(move || {
        let mut reader = stream;
        loop {
            match read_frame(&mut reader) {
                Ok(Some(data)) => {
                    let _ = app.emit(
                        "coffre:bridge-message",
                        BridgeFrame {
                            connection_id: id,
                            data,
                        },
                    );
                }
                Ok(None) => break,
                Err(_) => break,
            }
        }
        if let Some(state) = app.try_state::<BridgeState>()
            && let Ok(mut connections) = state.connections.lock()
        {
            connections.remove(&id);
        }
        let _ = app.emit("coffre:bridge-closed", BridgeClosed { connection_id: id });
    });
}

/// Démarre le serveur local. Un échec n’empêche pas l’application de
/// fonctionner : le pont natif reste simplement indisponible.
#[cfg(unix)]
pub fn start_server(app: tauri::AppHandle) -> Result<(), String> {
    use std::os::unix::net::UnixListener;

    let path = socket_path()?;
    let dir = path
        .parent()
        .ok_or_else(|| "Dossier de socket invalide".to_string())?;
    std::fs::create_dir_all(dir).map_err(|error| error.to_string())?;
    set_mode(dir, 0o700)?;
    match std::fs::remove_file(&path) {
        Ok(()) => {}
        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
        Err(error) => return Err(error.to_string()),
    }
    let listener = UnixListener::bind(&path).map_err(|error| error.to_string())?;
    set_mode(&path, 0o600)?;

    std::thread::spawn(move || {
        for stream in listener.incoming() {
            match stream {
                Ok(stream) => {
                    let at_capacity = app
                        .try_state::<BridgeState>()
                        .and_then(|state| {
                            state
                                .connections
                                .lock()
                                .ok()
                                .map(|connections| connections.len() >= MAX_BRIDGE_CONNECTIONS)
                        })
                        .unwrap_or(true);
                    if at_capacity {
                        // Une connexion excédentaire est fermée immédiatement :
                        // un processus local ne doit pas épuiser les threads.
                        drop(stream);
                        continue;
                    }
                    spawn_connection(app.clone(), stream);
                }
                Err(_) => break,
            }
        }
    });
    Ok(())
}

#[cfg(not(unix))]
pub fn start_server(_app: tauri::AppHandle) -> Result<(), String> {
    Ok(())
}

/// Écrit une trame vers une connexion ouverte par l’hôte natif.
#[tauri::command]
pub fn bridge_send(
    state: tauri::State<'_, BridgeState>,
    connection_id: u64,
    data: Vec<u8>,
) -> Result<(), String> {
    #[cfg(unix)]
    {
        let stream = {
            let connections = state
                .connections
                .lock()
                .map_err(|_| "Pont natif verrouillé".to_string())?;
            connections
                .get(&connection_id)
                .cloned()
                .ok_or_else(|| "Connexion de pont inconnue".to_string())?
        };
        let mut writer = stream
            .lock()
            .map_err(|_| "Connexion de pont verrouillée".to_string())?;
        write_frame(&mut *writer, &data)
    }
    #[cfg(not(unix))]
    {
        let _ = (state, connection_id, data);
        Err("Le pont natif n’est pas pris en charge sur cette plateforme".into())
    }
}

fn chrome_manifest(executable: &str) -> serde_json::Value {
    serde_json::json!({
        "name": "app.coffre.bridge",
        "description": "Pont local entre Coffre et son extension navigateur",
        "path": executable,
        "type": "stdio",
        "allowed_origins": [format!("chrome-extension://{CHROME_EXTENSION_ID}/")],
    })
}

fn firefox_manifest(executable: &str) -> serde_json::Value {
    serde_json::json!({
        "name": "app.coffre.bridge",
        "description": "Pont local entre Coffre et son extension navigateur",
        "path": executable,
        "type": "stdio",
        "allowed_extensions": [FIREFOX_EXTENSION_ID],
    })
}

fn write_manifest(path: &std::path::Path, manifest: &serde_json::Value) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let mut text = serde_json::to_string_pretty(manifest).map_err(|error| error.to_string())?;
    text.push('\n');
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .mode(0o600)
            .open(path)
            .map_err(|error| error.to_string())?;
        file.write_all(text.as_bytes())
            .map_err(|error| error.to_string())?;
        file.flush().map_err(|error| error.to_string())?;
        drop(file);
        set_mode(path, 0o600)?;
    }
    #[cfg(not(unix))]
    {
        std::fs::write(path, text).map_err(|error| error.to_string())?;
    }
    Ok(())
}

/// Installe les manifestes d’hôte natif pour les navigateurs présents.
/// L’opération est idempotente et ne touche qu’aux dossiers de l’utilisateur.
#[cfg(target_os = "macos")]
pub fn install_native_hosts() -> Result<(), String> {
    let executable = std::env::current_exe()
        .map_err(|error| error.to_string())?
        .to_str()
        .ok_or_else(|| "Chemin de l’application non UTF-8".to_string())?
        .to_string();
    let support = home_dir()?.join("Library/Application Support");
    let chrome = chrome_manifest(&executable);
    let mut installed = 0usize;
    for relative in [
        "Google/Chrome",
        "Google/Chrome Beta",
        "Google/Chrome Dev",
        "Google/Chrome Canary",
        "Chromium",
        "Microsoft Edge",
        "Microsoft Edge Beta",
        "Microsoft Edge Dev",
        "BraveSoftware/Brave-Browser",
        "BraveSoftware/Brave-Browser-Beta",
        "BraveSoftware/Brave-Browser-Dev",
        "Vivaldi",
    ] {
        let base = support.join(relative);
        if !base.exists() {
            continue;
        }
        let path = base.join("NativeMessagingHosts/app.coffre.bridge.json");
        write_manifest(&path, &chrome)?;
        installed += 1;
    }
    let firefox_base = support.join("Mozilla");
    let firefox_installed = firefox_base.exists()
        || std::path::Path::new("/Applications/Firefox.app").exists()
        || home_dir()?.join("Applications/Firefox.app").exists();
    if firefox_installed {
        let path = firefox_base.join("NativeMessagingHosts/app.coffre.bridge.json");
        write_manifest(&path, &firefox_manifest(&executable))?;
        installed += 1;
    }
    if installed == 0 {
        return Err("Aucun navigateur compatible détecté pour le pont natif".into());
    }
    Ok(())
}

#[cfg(target_os = "linux")]
pub fn install_native_hosts() -> Result<(), String> {
    let executable = std::env::current_exe()
        .map_err(|error| error.to_string())?
        .to_str()
        .ok_or_else(|| "Chemin de l’application non UTF-8".to_string())?
        .to_string();
    let config = std::env::var_os("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .unwrap_or(home_dir()?.join(".config"));
    let chrome = chrome_manifest(&executable);
    let mut installed = 0usize;
    for relative in [
        "google-chrome",
        "google-chrome-beta",
        "google-chrome-unstable",
        "chromium",
        "microsoft-edge",
        "microsoft-edge-beta",
        "microsoft-edge-dev",
        "BraveSoftware/Brave-Browser",
        "BraveSoftware/Brave-Browser-Beta",
        "BraveSoftware/Brave-Browser-Dev",
        "vivaldi",
    ] {
        let base = config.join(relative);
        if !base.exists() {
            continue;
        }
        let path = base.join("NativeMessagingHosts/app.coffre.bridge.json");
        write_manifest(&path, &chrome)?;
        installed += 1;
    }
    let firefox_dir = home_dir()?.join(".mozilla/native-messaging-hosts");
    if firefox_dir.exists() {
        write_manifest(
            &firefox_dir.join("app.coffre.bridge.json"),
            &firefox_manifest(&executable),
        )?;
        installed += 1;
    }
    if installed == 0 {
        return Err("Aucun navigateur compatible détecté pour le pont natif".into());
    }
    Ok(())
}

#[cfg(target_os = "windows")]
pub fn install_native_hosts() -> Result<(), String> {
    Err("L’installation automatique du pont natif n’est pas prise en charge sur Windows".into())
}

#[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
pub fn install_native_hosts() -> Result<(), String> {
    Err("Plateforme non prise en charge par le pont natif".into())
}

/// Vrai lorsque le binaire a été lancé par un navigateur comme hôte natif.
pub fn is_native_host_invocation() -> bool {
    std::env::args().skip(1).any(|argument| {
        argument.starts_with("chrome-extension://") || argument.starts_with("moz-extension://")
    })
}

/// Une demande explicite de déverrouillage peut demander le démarrage de
/// l’application. Une simple lecture d’état ne le fait jamais.
#[cfg(unix)]
fn frame_requests_launch(data: &[u8]) -> bool {
    serde_json::from_slice::<serde_json::Value>(data)
        .ok()
        .and_then(|value| value.get("launch").and_then(serde_json::Value::as_bool))
        .unwrap_or(false)
}

#[cfg(unix)]
fn launch_desktop_app() -> Result<(), String> {
    use std::process::{Command, Stdio};

    let executable = std::env::current_exe().map_err(|error| error.to_string())?;

    #[cfg(target_os = "macos")]
    {
        // Dans une application empaquetée, `open` passe par LaunchServices et
        // restaure correctement l’icône, le focus et le bundle.
        if let Some(bundle) = executable
            .ancestors()
            .find(|path| path.extension().is_some_and(|extension| extension == "app"))
        {
            return Command::new("open")
                .arg(bundle)
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status()
                .map(|status| {
                    if status.success() {
                        Ok(())
                    } else {
                        Err("Impossible de démarrer Coffre".to_string())
                    }
                })
                .map_err(|error| error.to_string())?;
        }
    }

    Command::new(&executable)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map(|_| ())
        .map_err(|error| error.to_string())
}

#[cfg(unix)]
fn connect_socket_with_retry(
    path: &std::path::Path,
    attempts: usize,
    delay: Duration,
) -> Result<std::os::unix::net::UnixStream, String> {
    use std::os::unix::net::UnixStream;

    let mut last_error = String::from("Coffre n’est pas ouvert");
    for _ in 0..attempts {
        match UnixStream::connect(path) {
            Ok(stream) => return Ok(stream),
            Err(error) => last_error = error.to_string(),
        }
        std::thread::sleep(delay);
    }
    Err(last_error)
}

/// Mode hôte de messagerie native : relaie stdin/stdout vers le socket local.
///
/// Si l’application est fermée, le premier message entrant est examiné : seul
/// un `hello` portant `launch: true` (clic « Déverrouiller » dans l’extension)
/// démarre l’application. Les lectures d’état ordinaires échouent proprement.
#[cfg(unix)]
pub fn run_native_host() -> Result<(), String> {
    use std::os::unix::net::UnixStream;

    let path = socket_path()?;
    let mut stream = match UnixStream::connect(&path) {
        Ok(stream) => stream,
        Err(_) => {
            let stdin = io::stdin();
            let mut input = stdin.lock();
            let first = read_frame(&mut input)?
                .ok_or_else(|| "Aucune demande de pont reçue".to_string())?;
            if !frame_requests_launch(&first) {
                return Err(
                    "Coffre n’est pas ouvert : impossible de joindre le pont natif".to_string(),
                );
            }
            launch_desktop_app()?;
            let stream = connect_socket_with_retry(&path, 40, Duration::from_millis(250))?;
            let mut writer = stream.try_clone().map_err(|error| error.to_string())?;
            write_frame(&mut writer, &first)?;
            stream
        }
    };
    let mut writer = stream.try_clone().map_err(|error| error.to_string())?;

    std::thread::spawn(move || {
        let stdin = io::stdin();
        let mut input = stdin.lock();
        loop {
            match read_frame(&mut input) {
                Ok(Some(data)) => {
                    if write_frame(&mut writer, &data).is_err() {
                        break;
                    }
                }
                Ok(None) => break,
                Err(_) => break,
            }
        }
        let _ = writer.shutdown(std::net::Shutdown::Both);
    });

    let stdout = io::stdout();
    let mut output = stdout.lock();
    loop {
        match read_frame(&mut stream) {
            Ok(Some(data)) => {
                if write_frame(&mut output, &data).is_err() {
                    break;
                }
            }
            Ok(None) => break,
            Err(_) => break,
        }
    }
    Ok(())
}

#[cfg(not(unix))]
pub fn run_native_host() -> Result<(), String> {
    Err("L’hôte natif n’est pas pris en charge sur cette plateforme".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn trame_aller_retour() {
        let mut buffer = Vec::new();
        write_frame(&mut buffer, b"{\"type\":\"hello\"}").unwrap();
        let mut reader = std::io::Cursor::new(buffer);
        let data = read_frame(&mut reader).unwrap().unwrap();
        assert_eq!(data, b"{\"type\":\"hello\"}");
        assert!(read_frame(&mut reader).unwrap().is_none());
    }

    #[test]
    fn refuse_une_trame_trop_grande() {
        let mut buffer = Vec::new();
        buffer.extend_from_slice(&(MAX_FRAME_BYTES as u32 + 1).to_be_bytes());
        let mut reader = std::io::Cursor::new(buffer);
        assert!(read_frame(&mut reader).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn seul_un_hello_de_launch_demarre_l_application() {
        assert!(frame_requests_launch(
            br#"{"id":"1","type":"hello","launch":true}"#
        ));
        assert!(!frame_requests_launch(br#"{"id":"1","type":"hello"}"#));
        assert!(!frame_requests_launch(br#"{"id":"1","type":"status"}"#));
        assert!(!frame_requests_launch(b"pas du JSON"));
    }

    #[test]
    fn manifestes_contiennent_les_origines_attendues() {
        let chrome = chrome_manifest("/tmp/coffre");
        assert_eq!(
            chrome["allowed_origins"][0],
            format!("chrome-extension://{CHROME_EXTENSION_ID}/")
        );
        let firefox = firefox_manifest("/tmp/coffre");
        assert_eq!(firefox["allowed_extensions"][0], FIREFOX_EXTENSION_ID);
    }

    #[test]
    fn ecrit_un_manifeste_avec_permissions_restrictives() {
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!(
            "coffre-bridge-manifest-{}-{stamp}",
            std::process::id()
        ));
        let path = dir.join("NativeMessagingHosts/app.coffre.bridge.json");
        write_manifest(&path, &chrome_manifest("/tmp/coffre")).unwrap();
        let text = std::fs::read_to_string(&path).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&text).unwrap();
        assert_eq!(parsed["name"], "app.coffre.bridge");
        assert_eq!(parsed["type"], "stdio");
        assert_eq!(parsed["path"], "/tmp/coffre");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(&path).unwrap().permissions().mode() & 0o777;
            assert_eq!(mode, 0o600);
        }
        let _ = std::fs::remove_dir_all(&dir);
    }
}
