//! Synchronisation directe sur le réseau local (F2).
//!
//! Ce module fournit l’appairage et le transport. Il ne fusionne pas les
//! coffres : l’application reçoit le fichier chiffré de l’autre appareil et
//! applique `reconcileVaultFiles` comme pour la synchronisation par dossier.
//!
//! Le port d’écoute n’est ouvert que pendant une fenêtre d’appairage ou de
//! synchronisation demandée explicitement. Aucune connexion sortante vers
//! Internet n’est effectuée : les adresses viennent du code d’appairage ou du
//! carnet de pairs local.

use std::io::{Read, Write};
use std::net::{IpAddr, TcpListener, TcpStream};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use base64::Engine;
use mdns_sd::{ServiceDaemon, ServiceEvent, ServiceInfo};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use snow::{Builder, HandshakeState, TransportState, params::NoiseParams};
use tauri::{AppHandle, Emitter, State};

use crate::blob_store::{blob_dir, valid_id};
use crate::bridge::app_data_root;

/// Version du protocole d’appairage et de synchronisation LAN.
pub const LAN_PROTOCOL_VERSION: u8 = 1;
const NOISE_PARAMS: &str = "Noise_XX_25519_ChaChaPoly_BLAKE2s";
const LAN_PORT: u16 = 47_823;
const PAIR_TTL: Duration = Duration::from_secs(120);
const SYNC_TTL: Duration = Duration::from_secs(120);
const MAX_FRAME: usize = 64 * 1024 * 1024;
const IO_TIMEOUT: Duration = Duration::from_secs(15);
// Noise XX avec X25519 : message 1 = e, message 2 = e, ee, s, es,
// message 3 = s, se. Les tailles sont fixes tant que NOISE_PARAMS ne change pas.
const NOISE_MSG1_LEN: usize = 32;
const NOISE_MSG2_LEN: usize = 96;
const NOISE_MSG3_LEN: usize = 64;

#[derive(Default)]
pub struct LanState {
    pending: Arc<AtomicBool>,
    serving: Arc<AtomicBool>,
    peers: Arc<Mutex<Vec<LanPeer>>>,
}

impl LanState {
    pub fn load() -> Self {
        Self {
            pending: Arc::new(AtomicBool::new(false)),
            serving: Arc::new(AtomicBool::new(false)),
            peers: Arc::new(Mutex::new(load_peers_from_disk())),
        }
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LanPeer {
    pub id: String,
    pub name: String,
    pub public_key: String,
    pub host: String,
    pub added_at: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LanIdentityInfo {
    pub fingerprint: String,
    pub public_key: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LanPairCode {
    pub code: String,
    pub host: String,
    pub port: u16,
    pub fingerprint: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LanDiscovery {
    pub name: String,
    pub host: String,
    pub port: u16,
    pub id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LanSyncResult {
    pub peer: LanPeer,
    pub file: String,
    pub blobs_received: usize,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BlobList {
    ids: Vec<String>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BlobRequest {
    ids: Vec<String>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BlobChunk {
    id: String,
    data: String,
    last: bool,
    missing: bool,
}

const BLOB_CHUNK: usize = 256 * 1024;
const MAX_BLOB_TRANSFER: usize = 2 * 1024 * 1024 * 1024;

fn clean_blob_ids(ids: &[String]) -> Result<Vec<String>, String> {
    if ids.len() > 500 {
        return Err("Trop de blobs à transférer".into());
    }
    let mut clean: Vec<String> = ids.iter().filter(|id| valid_id(id)).cloned().collect();
    clean.sort();
    clean.dedup();
    Ok(clean)
}

fn send_blobs(stream: &mut TcpStream, dir: &std::path::Path, ids: &[String]) -> Result<(), String> {
    for id in ids {
        let path = dir.join(id);
        if !path.is_file() {
            write_json(
                stream,
                &BlobChunk {
                    id: id.clone(),
                    data: String::new(),
                    last: true,
                    missing: true,
                },
            )?;
            continue;
        }
        let mut file = std::fs::File::open(path).map_err(|error| error.to_string())?;
        let mut buffer = vec![0u8; BLOB_CHUNK];
        loop {
            let read = file.read(&mut buffer).map_err(|error| error.to_string())?;
            let last = read < BLOB_CHUNK;
            write_json(
                stream,
                &BlobChunk {
                    id: id.clone(),
                    data: base64_std(&buffer[..read]),
                    last,
                    missing: false,
                },
            )?;
            if last {
                break;
            }
        }
    }
    Ok(())
}

fn receive_blobs(
    stream: &mut TcpStream,
    dir: &std::path::Path,
    ids: &[String],
) -> Result<usize, String> {
    if ids.is_empty() {
        return Ok(0);
    }
    let mut pending: std::collections::HashSet<String> = ids.iter().cloned().collect();
    let mut files: std::collections::HashMap<String, std::fs::File> =
        std::collections::HashMap::new();
    let mut received = 0usize;
    let mut total_bytes = 0usize;
    while !pending.is_empty() {
        let chunk: BlobChunk = read_json(stream)?;
        if !valid_id(&chunk.id) || !pending.contains(&chunk.id) {
            return Err("Blob inattendu pendant le transfert".into());
        }
        if chunk.missing {
            pending.remove(&chunk.id);
            continue;
        }
        let part = dir.join(format!("{}.part", chunk.id));
        let file = match files.get_mut(&chunk.id) {
            Some(file) => file,
            None => {
                let created = std::fs::OpenOptions::new()
                    .create(true)
                    .truncate(true)
                    .write(true)
                    .open(&part)
                    .map_err(|error| error.to_string())?;
                files.insert(chunk.id.clone(), created);
                files.get_mut(&chunk.id).expect("fichier inséré")
            }
        };
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(&chunk.data)
            .map_err(|_| "Blob transféré invalide".to_string())?;
        total_bytes = total_bytes
            .checked_add(bytes.len())
            .ok_or_else(|| "Transfert de blobs trop volumineux".to_string())?;
        if total_bytes > MAX_BLOB_TRANSFER {
            return Err("Transfert de blobs supérieur à 2 Gio".into());
        }
        file.write_all(&bytes).map_err(|error| error.to_string())?;
        if chunk.last {
            file.flush().map_err(|error| error.to_string())?;
            files.remove(&chunk.id);
            std::fs::rename(&part, dir.join(&chunk.id)).map_err(|error| error.to_string())?;
            pending.remove(&chunk.id);
            received += 1;
        }
    }
    Ok(received)
}

fn exchange_blobs_initiator(
    stream: &mut TcpStream,
    dir: &std::path::Path,
    local_ids: &[String],
) -> Result<usize, String> {
    let local = clean_blob_ids(local_ids)?;
    write_json(stream, &BlobList { ids: local.clone() })?;
    let remote: BlobList = read_json(stream)?;
    let remote = clean_blob_ids(&remote.ids)?;
    let local_set: std::collections::HashSet<&String> = local.iter().collect();
    let wanted: Vec<String> = remote
        .iter()
        .filter(|id| !local_set.contains(id))
        .cloned()
        .collect();
    write_json(
        stream,
        &BlobRequest {
            ids: wanted.clone(),
        },
    )?;
    let received = receive_blobs(stream, dir, &wanted)?;
    let request: BlobRequest = read_json(stream)?;
    let request = clean_blob_ids(&request.ids)?;
    send_blobs(stream, dir, &request)?;
    Ok(received)
}

fn exchange_blobs_responder(
    stream: &mut TcpStream,
    dir: &std::path::Path,
    local_ids: &[String],
) -> Result<usize, String> {
    let local = clean_blob_ids(local_ids)?;
    let initiator: BlobList = read_json(stream)?;
    let initiator = clean_blob_ids(&initiator.ids)?;
    write_json(stream, &BlobList { ids: local.clone() })?;
    let request: BlobRequest = read_json(stream)?;
    let request = clean_blob_ids(&request.ids)?;
    send_blobs(stream, dir, &request)?;
    let local_set: std::collections::HashSet<&String> = local.iter().collect();
    let wanted: Vec<String> = initiator
        .iter()
        .filter(|id| !local_set.contains(id))
        .cloned()
        .collect();
    write_json(
        stream,
        &BlobRequest {
            ids: wanted.clone(),
        },
    )?;
    receive_blobs(stream, dir, &wanted)
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct IdentityFile {
    private_key: String,
    public_key: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PairPayload {
    v: u8,
    host: String,
    port: u16,
    public_key: String,
    secret: String,
    name: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PairRequest {
    secret: String,
    name: String,
    public_key: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PairReply {
    ok: bool,
    error: Option<String>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SyncMessage {
    file: String,
}

fn base64_url(bytes: &[u8]) -> String {
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

fn base64_std(bytes: &[u8]) -> String {
    base64::engine::general_purpose::STANDARD.encode(bytes)
}

fn decode_std(value: &str) -> Result<Vec<u8>, String> {
    base64::engine::general_purpose::STANDARD
        .decode(value)
        .map_err(|_| "Clé locale illisible".to_string())
}

fn decode_url(value: &str) -> Result<Vec<u8>, String> {
    base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(value)
        .map_err(|_| "Code d’appairage invalide".to_string())
}

fn fingerprint(public_key: &[u8]) -> String {
    let digest = Sha256::digest(public_key);
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn now() -> String {
    // Horodatage ISO suffisant pour l’affichage ; aucune dépendance de date.
    let seconds = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_secs())
        .unwrap_or(0);
    format!("{seconds}")
}

fn lan_dir() -> Result<PathBuf, String> {
    let dir = app_data_root()?.join("lan");
    std::fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700));
    }
    Ok(dir)
}

fn write_private(path: &PathBuf, contents: &str) -> Result<(), String> {
    std::fs::write(path, contents).map_err(|error| error.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

fn noise_params() -> Result<NoiseParams, String> {
    NOISE_PARAMS
        .parse()
        .map_err(|error| format!("Paramètres Noise invalides : {error}"))
}

fn load_identity() -> Result<IdentityFile, String> {
    let path = lan_dir()?.join("identity.json");
    if path.exists() {
        let text = std::fs::read_to_string(&path).map_err(|error| error.to_string())?;
        return serde_json::from_str(&text).map_err(|_| "Identité locale illisible".to_string());
    }
    let keypair = Builder::new(noise_params()?)
        .generate_keypair()
        .map_err(|error| error.to_string())?;
    let identity = IdentityFile {
        private_key: base64_std(&keypair.private),
        public_key: base64_std(&keypair.public),
    };
    write_private(
        &path,
        &serde_json::to_string(&identity).map_err(|error| error.to_string())?,
    )?;
    Ok(identity)
}

fn load_peers_from_disk() -> Vec<LanPeer> {
    let Ok(dir) = lan_dir() else {
        return Vec::new();
    };
    let path = dir.join("peers.json");
    let Ok(text) = std::fs::read_to_string(path) else {
        return Vec::new();
    };
    serde_json::from_str(&text).unwrap_or_default()
}

fn save_peers(peers: &[LanPeer]) -> Result<(), String> {
    let path = lan_dir()?.join("peers.json");
    write_private(
        &path,
        &serde_json::to_string(peers).map_err(|error| error.to_string())?,
    )
}

fn peer_from_public(public_key: &[u8], name: &str, host: &str) -> LanPeer {
    LanPeer {
        id: fingerprint(public_key),
        name: name.trim().chars().take(80).collect(),
        public_key: base64_std(public_key),
        host: host.to_string(),
        added_at: now(),
    }
}

fn add_peer(state: &LanState, peer: LanPeer) -> Result<LanPeer, String> {
    let mut peers = state.peers.lock().map_err(|_| "Pairs illisibles")?;
    peers.retain(|entry| entry.id != peer.id);
    peers.push(peer.clone());
    save_peers(&peers)?;
    Ok(peer)
}

fn find_peer(state: &LanState, id: &str) -> Result<LanPeer, String> {
    let peers = state.peers.lock().map_err(|_| "Pairs illisibles")?;
    peers
        .iter()
        .find(|peer| peer.id == id)
        .cloned()
        .ok_or_else(|| "Appareil non appairé".to_string())
}

fn read_frame(stream: &mut TcpStream) -> Result<Vec<u8>, String> {
    let mut length = [0u8; 4];
    stream
        .read_exact(&mut length)
        .map_err(|_| "Connexion interrompue".to_string())?;
    let size = u32::from_be_bytes(length) as usize;
    if size > MAX_FRAME {
        return Err("Message local trop volumineux".into());
    }
    let mut data = vec![0u8; size];
    stream
        .read_exact(&mut data)
        .map_err(|_| "Message local tronqué".to_string())?;
    Ok(data)
}

fn write_frame(stream: &mut TcpStream, data: &[u8]) -> Result<(), String> {
    let size = u32::try_from(data.len()).map_err(|_| "Message local trop volumineux")?;
    stream
        .write_all(&size.to_be_bytes())
        .and_then(|_| stream.write_all(data))
        .and_then(|_| stream.flush())
        .map_err(|_| "Connexion interrompue".to_string())
}

fn write_json<T: Serialize>(stream: &mut TcpStream, value: &T) -> Result<(), String> {
    let data = serde_json::to_vec(value).map_err(|error| error.to_string())?;
    write_frame(stream, &data)
}

fn read_json<T: for<'de> Deserialize<'de>>(stream: &mut TcpStream) -> Result<T, String> {
    let data = read_frame(stream)?;
    serde_json::from_slice(&data).map_err(|_| "Message local invalide".to_string())
}

fn build_session(identity: &IdentityFile, initiator: bool) -> Result<HandshakeState, String> {
    let private = decode_std(&identity.private_key)?;
    let builder = Builder::new(noise_params()?).local_private_key(&private);
    if initiator {
        builder.build_initiator().map_err(|error| error.to_string())
    } else {
        builder.build_responder().map_err(|error| error.to_string())
    }
}

fn read_noise_message(
    stream: &mut TcpStream,
    buffer: &mut [u8],
    expected: usize,
) -> Result<(), String> {
    if buffer.len() < expected {
        return Err("Tampon Noise trop petit".to_string());
    }
    stream
        .read_exact(&mut buffer[..expected])
        .map_err(|_| "Connexion interrompue".to_string())
}

fn write_noise_message(
    stream: &mut TcpStream,
    message: &[u8],
    expected: usize,
) -> Result<(), String> {
    if message.len() != expected {
        return Err("Message Noise inattendu".to_string());
    }
    stream
        .write_all(message)
        .map_err(|_| "Connexion interrompue".to_string())
}

fn handshake(
    stream: &mut TcpStream,
    identity: &IdentityFile,
    initiator: bool,
) -> Result<TransportState, String> {
    let mut session = build_session(identity, initiator)?;
    let mut buffer = vec![0u8; 65_535];
    let mut message = vec![0u8; 65_535];
    if initiator {
        let size = session
            .write_message(&[], &mut message)
            .map_err(|error| error.to_string())?;
        write_noise_message(stream, &message[..size], NOISE_MSG1_LEN)?;
        read_noise_message(stream, &mut buffer, NOISE_MSG2_LEN)?;
        session
            .read_message(&buffer[..NOISE_MSG2_LEN], &mut message)
            .map_err(|_| "Négociation Noise invalide".to_string())?;
        let size = session
            .write_message(&[], &mut message)
            .map_err(|error| error.to_string())?;
        write_noise_message(stream, &message[..size], NOISE_MSG3_LEN)?;
    } else {
        read_noise_message(stream, &mut buffer, NOISE_MSG1_LEN)?;
        session
            .read_message(&buffer[..NOISE_MSG1_LEN], &mut message)
            .map_err(|_| "Négociation Noise invalide".to_string())?;
        let size = session
            .write_message(&[], &mut message)
            .map_err(|error| error.to_string())?;
        write_noise_message(stream, &message[..size], NOISE_MSG2_LEN)?;
        read_noise_message(stream, &mut buffer, NOISE_MSG3_LEN)?;
        session
            .read_message(&buffer[..NOISE_MSG3_LEN], &mut message)
            .map_err(|_| "Négociation Noise invalide".to_string())?;
    }
    session
        .into_transport_mode()
        .map_err(|error| error.to_string())
}

fn remote_static(session: &TransportState) -> Result<Vec<u8>, String> {
    session
        .get_remote_static()
        .map(|value| value.to_vec())
        .ok_or_else(|| "Clé distante absente".to_string())
}

fn constant_time_equal(left: &[u8], right: &[u8]) -> bool {
    if left.len() != right.len() {
        return false;
    }
    let mut difference = 0u8;
    for (a, b) in left.iter().zip(right.iter()) {
        difference |= a ^ b;
    }
    difference == 0
}

fn handle_pair(
    stream: &mut TcpStream,
    identity: &IdentityFile,
    secret: &[u8],
) -> Result<LanPeer, String> {
    let session = handshake(stream, identity, false)?;
    let public = remote_static(&session)?;
    let request: PairRequest = read_json(stream)?;
    let provided = decode_url(&request.secret)?;
    if !constant_time_equal(&provided, secret) {
        let _ = write_json(
            stream,
            &PairReply {
                ok: false,
                error: Some("secret".into()),
            },
        );
        return Err("Secret d’appairage incorrect".into());
    }
    if !constant_time_equal(&decode_std(&request.public_key)?, &public) {
        return Err("Clé d’appareil incohérente".into());
    }
    write_json(
        stream,
        &PairReply {
            ok: true,
            error: None,
        },
    )?;
    let host = stream
        .peer_addr()
        .map(|address| address.ip().to_string())
        .unwrap_or_default();
    Ok(peer_from_public(&public, &request.name, &host))
}

fn pair_code(host: &str, port: u16, public_key: &str, secret: &[u8], name: &str) -> String {
    let payload = PairPayload {
        v: LAN_PROTOCOL_VERSION,
        host: host.to_string(),
        port,
        public_key: public_key.to_string(),
        secret: base64_url(secret),
        name: name.chars().take(80).collect(),
    };
    let json = serde_json::to_vec(&payload).unwrap_or_default();
    format!("coffre-lan://pair/{}", base64_url(&json))
}

fn decode_pair_code(code: &str) -> Result<PairPayload, String> {
    let trimmed = code.trim();
    let encoded = trimmed
        .strip_prefix("coffre-lan://pair/")
        .or_else(|| trimmed.strip_prefix("coffre-lan:pair/"))
        .ok_or_else(|| "Code d’appairage invalide".to_string())?;
    let data = decode_url(encoded)?;
    let payload: PairPayload =
        serde_json::from_slice(&data).map_err(|_| "Code d’appairage invalide".to_string())?;
    if payload.v != LAN_PROTOCOL_VERSION || payload.host.trim().is_empty() || payload.port == 0 {
        return Err("Code d’appairage invalide".into());
    }
    Ok(payload)
}

fn local_ip() -> String {
    local_ip_address::local_ip()
        .ok()
        .filter(|address| matches!(address, IpAddr::V4(_)))
        .map(|address| address.to_string())
        .unwrap_or_else(|| "127.0.0.1".into())
}

fn listen_once(listener: &TcpListener, timeout: Duration) -> Result<TcpStream, String> {
    listener
        .set_nonblocking(true)
        .map_err(|error| error.to_string())?;
    let deadline = Instant::now() + timeout;
    loop {
        if Instant::now() > deadline {
            return Err("Délai dépassé".into());
        }
        match listener.accept() {
            Ok((stream, _)) => {
                stream
                    .set_nonblocking(false)
                    .map_err(|error| error.to_string())?;
                stream
                    .set_read_timeout(Some(IO_TIMEOUT))
                    .map_err(|error| error.to_string())?;
                stream
                    .set_write_timeout(Some(IO_TIMEOUT))
                    .map_err(|error| error.to_string())?;
                return Ok(stream);
            }
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(100));
            }
            Err(error) => return Err(error.to_string()),
        }
    }
}

#[tauri::command]
pub fn lan_identity() -> Result<LanIdentityInfo, String> {
    let identity = load_identity()?;
    let public = decode_std(&identity.public_key)?;
    Ok(LanIdentityInfo {
        fingerprint: fingerprint(&public),
        public_key: identity.public_key,
    })
}

#[tauri::command]
pub async fn lan_pair_start(
    app: AppHandle,
    state: State<'_, LanState>,
    name: String,
) -> Result<LanPairCode, String> {
    if state
        .pending
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Err("Un appairage est déjà en cours".into());
    }
    let identity = match load_identity() {
        Ok(identity) => identity,
        Err(error) => {
            state.pending.store(false, Ordering::SeqCst);
            return Err(error);
        }
    };
    let mut secret = [0u8; 32];
    if let Err(error) = getrandom::fill(&mut secret) {
        state.pending.store(false, Ordering::SeqCst);
        return Err(error.to_string());
    }
    let listener = match TcpListener::bind(("0.0.0.0", 0)) {
        Ok(listener) => listener,
        Err(error) => {
            state.pending.store(false, Ordering::SeqCst);
            return Err(error.to_string());
        }
    };
    let port = listener
        .local_addr()
        .map_err(|error| error.to_string())?
        .port();
    let host = local_ip();
    let public = decode_std(&identity.public_key)?;
    let code = pair_code(&host, port, &identity.public_key, &secret, &name);
    let pending = state.pending.clone();
    let peers = state.peers.clone();
    std::thread::spawn(move || {
        let result = listen_once(&listener, PAIR_TTL)
            .and_then(|mut stream| handle_pair(&mut stream, &identity, &secret));
        match result {
            Ok(peer) => {
                if let Ok(mut list) = peers.lock() {
                    list.retain(|entry| entry.id != peer.id);
                    list.push(peer.clone());
                    let _ = save_peers(&list);
                }
                let _ = app.emit("coffre:lan-paired", peer);
            }
            Err(error) => {
                let _ = app.emit("coffre:lan-pair-failed", error);
            }
        }
        pending.store(false, Ordering::SeqCst);
    });
    Ok(LanPairCode {
        code,
        host,
        port,
        fingerprint: fingerprint(&public),
    })
}

#[tauri::command]
pub async fn lan_pair_join(
    state: State<'_, LanState>,
    code: String,
    name: String,
) -> Result<LanPeer, String> {
    let payload = decode_pair_code(&code)?;
    let identity = load_identity()?;
    let mut stream = TcpStream::connect((payload.host.as_str(), payload.port))
        .map_err(|_| "Appareil injoignable sur le réseau local".to_string())?;
    stream
        .set_read_timeout(Some(IO_TIMEOUT))
        .map_err(|error| error.to_string())?;
    stream
        .set_write_timeout(Some(IO_TIMEOUT))
        .map_err(|error| error.to_string())?;
    let session = handshake(&mut stream, &identity, true)?;
    let remote = remote_static(&session)?;
    if !constant_time_equal(&decode_std(&payload.public_key)?, &remote) {
        return Err("L’appareil distant ne correspond pas au code".into());
    }
    write_json(
        &mut stream,
        &PairRequest {
            secret: payload.secret.clone(),
            name,
            public_key: identity.public_key.clone(),
        },
    )?;
    let reply: PairReply = read_json(&mut stream)?;
    if !reply.ok {
        return Err(match reply.error.as_deref() {
            Some("secret") => "Secret d’appairage incorrect".into(),
            _ => "Appairage refusé".into(),
        });
    }
    let peer = peer_from_public(&remote, &payload.name, &payload.host);
    add_peer(&state, peer)
}

#[tauri::command]
pub fn lan_peers(state: State<'_, LanState>) -> Vec<LanPeer> {
    state
        .peers
        .lock()
        .map(|peers| peers.clone())
        .unwrap_or_default()
}

#[tauri::command]
pub fn lan_forget_peer(state: State<'_, LanState>, id: String) -> Result<(), String> {
    let mut peers = state.peers.lock().map_err(|_| "Pairs illisibles")?;
    peers.retain(|peer| peer.id != id);
    save_peers(&peers)
}

#[tauri::command]
pub async fn lan_discover(timeout_ms: Option<u64>) -> Result<Vec<LanDiscovery>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let daemon = ServiceDaemon::new().map_err(|error| error.to_string())?;
        let receiver = daemon
            .browse("_coffre._tcp.local.")
            .map_err(|error| error.to_string())?;
        let deadline =
            Instant::now() + Duration::from_millis(timeout_ms.unwrap_or(2_500).clamp(500, 10_000));
        let mut found = std::collections::BTreeMap::new();
        while Instant::now() < deadline {
            let remaining = deadline.saturating_duration_since(Instant::now());
            match receiver.recv_timeout(remaining.min(Duration::from_millis(250))) {
                Ok(ServiceEvent::ServiceResolved(service)) => {
                    let id = service.get_property_val_str("id").unwrap_or("").to_string();
                    let host = service
                        .get_addresses_v4()
                        .into_iter()
                        .next()
                        .map(|address| address.to_string())
                        .unwrap_or_else(|| service.get_hostname().to_string());
                    found.insert(
                        service.get_fullname().to_string(),
                        LanDiscovery {
                            name: service
                                .get_property_val_str("name")
                                .unwrap_or(service.get_fullname())
                                .to_string(),
                            host,
                            port: service.get_port(),
                            id,
                        },
                    );
                }
                Ok(_) => {}
                Err(_) => {}
            }
        }
        let _ = daemon.stop_browse("_coffre._tcp.local.");
        let _ = daemon.shutdown();
        Ok(found.into_values().collect())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub fn lan_update_peer_host(
    state: State<'_, LanState>,
    id: String,
    host: String,
) -> Result<LanPeer, String> {
    let mut peers = state.peers.lock().map_err(|_| "Pairs illisibles")?;
    let peer = peers
        .iter_mut()
        .find(|peer| peer.id == id)
        .ok_or_else(|| "Appareil non appairé".to_string())?;
    peer.host = host.trim().to_string();
    let updated = peer.clone();
    save_peers(&peers)?;
    Ok(updated)
}

#[tauri::command]
pub async fn lan_sync_serve(
    app: AppHandle,
    state: State<'_, LanState>,
    file: String,
    blob_ids: Vec<String>,
) -> Result<LanSyncResult, String> {
    if state
        .serving
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Err("Une réception est déjà en cours".into());
    }
    let serving = state.serving.clone();
    let peers = state.peers.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let identity = load_identity()?;
        let local_fingerprint = fingerprint(&decode_std(&identity.public_key)?);
        let daemon = ServiceDaemon::new().ok();
        if let Some(daemon) = &daemon {
            let properties = [("id", local_fingerprint.as_str()), ("name", "Coffre")];
            if let Ok(info) = ServiceInfo::new(
                "_coffre._tcp.local.",
                &format!(
                    "coffre-{}",
                    &local_fingerprint[..local_fingerprint.len().min(8)]
                ),
                "coffre.local.",
                local_ip(),
                LAN_PORT,
                &properties[..],
            ) {
                let _ = daemon.register(info);
            }
        }
        let listener = TcpListener::bind(("0.0.0.0", LAN_PORT))
            .map_err(|_| "Le port de synchronisation est déjà utilisé".to_string())?;
        let mut stream = listen_once(&listener, SYNC_TTL)?;
        let session = handshake(&mut stream, &identity, false)?;
        let public = remote_static(&session)?;
        let id = fingerprint(&public);
        let peer = {
            let list = peers.lock().map_err(|_| "Pairs illisibles")?;
            list.iter()
                .find(|peer| peer.id == id)
                .cloned()
                .ok_or_else(|| "Appareil non appairé".to_string())?
        };
        let message: SyncMessage = read_json(&mut stream)?;
        write_json(&mut stream, &SyncMessage { file })?;
        let blobs_received = exchange_blobs_responder(&mut stream, &blob_dir(&app)?, &blob_ids)?;
        if let Some(daemon) = daemon {
            let _ = daemon.shutdown();
        }
        Ok::<LanSyncResult, String>(LanSyncResult {
            peer,
            file: message.file,
            blobs_received,
        })
    })
    .await
    .map_err(|error| error.to_string())?;
    serving.store(false, Ordering::SeqCst);
    result
}

#[tauri::command]
pub async fn lan_sync_pull(
    app: AppHandle,
    state: State<'_, LanState>,
    id: String,
    file: String,
    blob_ids: Vec<String>,
) -> Result<LanSyncResult, String> {
    let peer = find_peer(&state, &id)?;
    let identity = load_identity()?;
    let mut stream = TcpStream::connect((peer.host.as_str(), LAN_PORT)).map_err(|_| {
        "Appareil injoignable : lancez une réception sur l’autre appareil".to_string()
    })?;
    stream
        .set_read_timeout(Some(IO_TIMEOUT))
        .map_err(|error| error.to_string())?;
    stream
        .set_write_timeout(Some(IO_TIMEOUT))
        .map_err(|error| error.to_string())?;
    let session = handshake(&mut stream, &identity, true)?;
    let remote = remote_static(&session)?;
    if !constant_time_equal(&decode_std(&peer.public_key)?, &remote) {
        return Err("L’appareil distant ne correspond pas au pair enregistré".into());
    }
    write_json(&mut stream, &SyncMessage { file })?;
    let message: SyncMessage = read_json(&mut stream)?;
    let blobs_received = exchange_blobs_initiator(&mut stream, &blob_dir(&app)?, &blob_ids)?;
    Ok(LanSyncResult {
        peer,
        file: message.file,
        blobs_received,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encode_et_decode_le_code_d_appairage() {
        let secret = [7u8; 32];
        let code = pair_code("192.168.1.20", 47_823, "public", &secret, "Salon");
        let payload = decode_pair_code(&code).expect("code");
        assert_eq!(payload.host, "192.168.1.20");
        assert_eq!(payload.port, 47_823);
        assert_eq!(payload.name, "Salon");
        assert_eq!(decode_url(&payload.secret).unwrap(), secret);
    }

    #[test]
    fn refuse_un_code_invalide() {
        assert!(decode_pair_code("https://example.com").is_err());
        assert!(decode_pair_code("coffre-lan://pair/abc").is_err());
    }

    #[test]
    fn compare_les_secrets_en_temps_constant() {
        assert!(constant_time_equal(b"secret", b"secret"));
        assert!(!constant_time_equal(b"secret", b"secreu"));
        assert!(!constant_time_equal(b"secret", b"secret "));
    }

    fn test_identity() -> IdentityFile {
        let keypair = Builder::new(noise_params().unwrap())
            .generate_keypair()
            .unwrap();
        IdentityFile {
            private_key: base64_std(&keypair.private),
            public_key: base64_std(&keypair.public),
        }
    }

    #[test]
    fn appairage_accepte_le_bon_secret_et_refuse_l_autre() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        let responder = test_identity();
        let initiator = test_identity();
        let expected = responder.public_key.clone();
        let secret = [9u8; 32];

        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            stream.set_read_timeout(Some(IO_TIMEOUT)).unwrap();
            stream.set_write_timeout(Some(IO_TIMEOUT)).unwrap();
            handle_pair(&mut stream, &responder, &secret)
        });

        let mut stream = TcpStream::connect(("127.0.0.1", port)).unwrap();
        stream.set_read_timeout(Some(IO_TIMEOUT)).unwrap();
        stream.set_write_timeout(Some(IO_TIMEOUT)).unwrap();
        let session = handshake(&mut stream, &initiator, true).unwrap();
        let remote = remote_static(&session).unwrap();
        assert_eq!(base64_std(&remote), expected);
        write_json(
            &mut stream,
            &PairRequest {
                secret: base64_url(&secret),
                name: "Téléphone".into(),
                public_key: initiator.public_key.clone(),
            },
        )
        .unwrap();
        let reply: PairReply = read_json(&mut stream).unwrap();
        assert!(reply.ok);
        let peer = server.join().unwrap().unwrap();
        assert_eq!(peer.name, "Téléphone");
        assert_eq!(peer.public_key, initiator.public_key);
    }

    #[test]
    fn echange_les_blobs_manquants_entre_deux_dossiers() {
        let root = std::env::temp_dir().join(format!(
            "coffre-lan-blobs-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let dir_a = root.join("a");
        let dir_b = root.join("b");
        std::fs::create_dir_all(&dir_a).unwrap();
        std::fs::create_dir_all(&dir_b).unwrap();
        let payload = vec![9u8; BLOB_CHUNK + 17];
        std::fs::write(dir_a.join("blob1"), &payload).unwrap();

        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            exchange_blobs_responder(&mut stream, &dir_a, &["blob1".into()]).unwrap()
        });

        let mut stream = TcpStream::connect(("127.0.0.1", port)).unwrap();
        let received = exchange_blobs_initiator(&mut stream, &dir_b, &[]).unwrap();
        assert_eq!(received, 1);
        assert_eq!(server.join().unwrap(), 0);
        assert_eq!(std::fs::read(dir_b.join("blob1")).unwrap(), payload);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn handshake_noise_et_transport_de_bout_en_bout() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        let responder = test_identity();
        let initiator = test_identity();
        let expected = responder.public_key.clone();

        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let session = handshake(&mut stream, &responder, false).unwrap();
            let public = remote_static(&session).unwrap();
            write_frame(&mut stream, b"bonjour").unwrap();
            base64_std(&public)
        });

        let mut stream = TcpStream::connect(("127.0.0.1", port)).unwrap();
        let session = handshake(&mut stream, &initiator, true).unwrap();
        let remote = base64_std(&remote_static(&session).unwrap());
        assert_eq!(read_frame(&mut stream).unwrap(), b"bonjour");
        assert_eq!(remote, expected);
        assert_eq!(
            server.join().unwrap(),
            base64_std(&decode_std(&initiator.public_key).unwrap())
        );
    }
}
