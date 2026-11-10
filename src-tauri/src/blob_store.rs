//! Coffre de fichiers chiffrés en flux (F8).
//!
//! Chaque document est stocké hors du fichier `.coffre`, dans
//! `vault/blobs/<id>`, chiffré par blocs de 64 Kio avec AES-256-GCM.
//! La construction STREAM utilise un nonce de 12 octets :
//! 7 octets d’en-tête aléatoires, 4 octets de compteur et 1 octet de dernier
//! bloc. Chaque bloc porte un indicateur `last` authentifié, ce qui détecte
//! troncature, réordonnancement et substitution.
//!
//! Aucune écriture en clair n’est effectuée pour les aperçus : le déchiffrement
//! en mémoire est plafonné par l’appelant.

use std::fs::{File, OpenOptions};
use std::io::{BufRead, BufReader, BufWriter, Read, Write};
use std::path::{Path, PathBuf};

use aes_gcm::aead::{Aead, Payload};
use aes_gcm::{Aes256Gcm, KeyInit, Nonce};
use base64::Engine;
use sha2::{Digest, Sha256};
use tauri::Manager;

const MAGIC: &[u8; 8] = b"COFFBLOB";
const VERSION: u8 = 1;
const BLOCK_SIZE: usize = 64 * 1024;
const TAG_SIZE: usize = 16;
const HEADER_SIZE: usize = 8 + 1 + 7 + 4;
const MAX_PREVIEW: usize = 16 * 1024 * 1024;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BlobInfo {
    pub size: u64,
    pub sha256: String,
    pub path: String,
}

fn decode_key(value: &str) -> Result<[u8; 32], String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(value)
        .map_err(|_| "Clé de blob invalide".to_string())?;
    bytes
        .try_into()
        .map_err(|_| "La clé de blob doit faire 32 octets".to_string())
}

pub(crate) fn blob_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("vault")
        .join("blobs");
    std::fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700));
    }
    Ok(dir)
}

pub(crate) fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 80
        && id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
}

fn blob_path(app: &tauri::AppHandle, id: &str) -> Result<PathBuf, String> {
    if !valid_id(id) {
        return Err("Identifiant de blob invalide".into());
    }
    Ok(blob_dir(app)?.join(id))
}

fn nonce(prefix: &[u8; 7], index: u32, last: bool) -> [u8; 12] {
    let mut value = [0u8; 12];
    value[..7].copy_from_slice(prefix);
    value[7..11].copy_from_slice(&index.to_be_bytes());
    value[11] = u8::from(last);
    value
}

fn aad(header: &[u8], index: u32, last: bool) -> Vec<u8> {
    let mut value = Vec::with_capacity(header.len() + 5);
    value.extend_from_slice(header);
    value.extend_from_slice(&index.to_be_bytes());
    value.push(u8::from(last));
    value
}

fn write_header(writer: &mut impl Write, prefix: &[u8; 7]) -> Result<Vec<u8>, String> {
    let mut header = Vec::with_capacity(HEADER_SIZE);
    header.extend_from_slice(MAGIC);
    header.push(VERSION);
    header.extend_from_slice(prefix);
    header.extend_from_slice(&(BLOCK_SIZE as u32).to_le_bytes());
    writer
        .write_all(&header)
        .map_err(|error| error.to_string())?;
    Ok(header)
}

fn read_full(reader: &mut impl Read, buffer: &mut [u8]) -> Result<usize, String> {
    let mut filled = 0;
    while filled < buffer.len() {
        let read = reader
            .read(&mut buffer[filled..])
            .map_err(|error| error.to_string())?;
        if read == 0 {
            break;
        }
        filled += read;
    }
    Ok(filled)
}

/// Chiffre un fichier source vers un blob. Le fichier source n’est pas modifié.
pub fn encrypt_file(source: &Path, target: &Path, key: &[u8; 32]) -> Result<BlobInfo, String> {
    let input = File::open(source).map_err(|error| error.to_string())?;
    let mut reader = BufReader::new(input);
    let temporary = target.with_extension("tmp");
    let output = OpenOptions::new()
        .create(true)
        .truncate(true)
        .write(true)
        .open(&temporary)
        .map_err(|error| error.to_string())?;
    let mut writer = BufWriter::new(output);
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|_| "Clé AES invalide".to_string())?;
    let mut prefix = [0u8; 7];
    getrandom::fill(&mut prefix).map_err(|error| error.to_string())?;
    let header = write_header(&mut writer, &prefix)?;
    let mut buffer = vec![0u8; BLOCK_SIZE];
    let mut hasher = Sha256::new();
    let mut size = 0u64;
    let mut index = 0u32;
    loop {
        let filled = read_full(&mut reader, &mut buffer)?;
        let last = if filled < BLOCK_SIZE {
            true
        } else {
            reader
                .fill_buf()
                .map_err(|error| error.to_string())?
                .is_empty()
        };
        let block_aad = aad(&header, index, last);
        let block_nonce = nonce(&prefix, index, last);
        let ciphertext = cipher
            .encrypt(
                &Nonce::from(block_nonce),
                Payload {
                    msg: &buffer[..filled],
                    aad: &block_aad,
                },
            )
            .map_err(|_| "Chiffrement du blob impossible".to_string())?;
        writer
            .write_all(&[u8::from(last)])
            .and_then(|_| writer.write_all(&(ciphertext.len() as u32).to_le_bytes()))
            .and_then(|_| writer.write_all(&ciphertext))
            .map_err(|error| error.to_string())?;
        hasher.update(&buffer[..filled]);
        size += filled as u64;
        if last {
            break;
        }
        index = index
            .checked_add(1)
            .ok_or_else(|| "Blob trop volumineux".to_string())?;
    }
    writer.flush().map_err(|error| error.to_string())?;
    drop(writer);
    std::fs::rename(&temporary, target).map_err(|error| error.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(target, std::fs::Permissions::from_mode(0o600));
    }
    Ok(BlobInfo {
        size,
        sha256: hasher
            .finalize()
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect(),
        path: target.to_string_lossy().to_string(),
    })
}

fn open_header(reader: &mut impl Read) -> Result<([u8; 7], Vec<u8>), String> {
    let mut header = [0u8; HEADER_SIZE];
    reader
        .read_exact(&mut header)
        .map_err(|_| "Blob tronqué".to_string())?;
    if &header[..8] != MAGIC {
        return Err("Ce fichier n’est pas un blob Coffre".into());
    }
    if header[8] != VERSION {
        return Err("Version de blob non prise en charge".into());
    }
    let mut prefix = [0u8; 7];
    prefix.copy_from_slice(&header[9..16]);
    let block_size = u32::from_le_bytes(
        header[16..20]
            .try_into()
            .map_err(|_| "En-tête de blob invalide".to_string())?,
    ) as usize;
    if block_size != BLOCK_SIZE {
        return Err("Taille de bloc de blob non prise en charge".into());
    }
    Ok((prefix, header.to_vec()))
}

/// Déchiffre un blob vers un fichier de destination.
pub fn decrypt_file(source: &Path, target: &Path, key: &[u8; 32]) -> Result<BlobInfo, String> {
    let input = File::open(source).map_err(|error| error.to_string())?;
    let mut reader = BufReader::new(input);
    let (prefix, header) = open_header(&mut reader)?;
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|_| "Clé AES invalide".to_string())?;
    let temporary = target.with_extension("tmp");
    let output = OpenOptions::new()
        .create(true)
        .truncate(true)
        .write(true)
        .open(&temporary)
        .map_err(|error| error.to_string())?;
    let mut writer = BufWriter::new(output);
    let mut hasher = Sha256::new();
    let mut size = 0u64;
    let mut index = 0u32;
    loop {
        let mut last = [0u8; 1];
        reader
            .read_exact(&mut last)
            .map_err(|_| "Blob tronqué : indicateur de dernier bloc absent".to_string())?;
        let is_last = last[0] == 1;
        if last[0] > 1 {
            return Err("Indicateur de dernier bloc invalide".into());
        }
        let mut length = [0u8; 4];
        reader
            .read_exact(&mut length)
            .map_err(|_| "Blob tronqué : taille de bloc absente".to_string())?;
        let length = u32::from_le_bytes(length) as usize;
        if length > BLOCK_SIZE + TAG_SIZE {
            return Err("Bloc de blob trop volumineux".into());
        }
        let mut ciphertext = vec![0u8; length];
        reader
            .read_exact(&mut ciphertext)
            .map_err(|_| "Blob tronqué : bloc incomplet".to_string())?;
        let block_aad = aad(&header, index, is_last);
        let block_nonce = nonce(&prefix, index, is_last);
        let plaintext = cipher
            .decrypt(
                &Nonce::from(block_nonce),
                Payload {
                    msg: &ciphertext,
                    aad: &block_aad,
                },
            )
            .map_err(|_| "Blob altéré : authentification du bloc échouée".to_string())?;
        writer
            .write_all(&plaintext)
            .map_err(|error| error.to_string())?;
        hasher.update(&plaintext);
        size += plaintext.len() as u64;
        if is_last {
            if !reader
                .fill_buf()
                .map_err(|error| error.to_string())?
                .is_empty()
            {
                return Err("Données après le dernier bloc du blob".into());
            }
            break;
        }
        index = index
            .checked_add(1)
            .ok_or_else(|| "Blob trop volumineux".to_string())?;
    }
    writer.flush().map_err(|error| error.to_string())?;
    drop(writer);
    std::fs::rename(&temporary, target).map_err(|error| error.to_string())?;
    Ok(BlobInfo {
        size,
        sha256: hasher
            .finalize()
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect(),
        path: target.to_string_lossy().to_string(),
    })
}

/// Déchiffre au plus `max_bytes` pour un aperçu en mémoire.
pub fn decrypt_preview(source: &Path, key: &[u8; 32], max_bytes: usize) -> Result<Vec<u8>, String> {
    let limit = max_bytes.min(MAX_PREVIEW);
    let input = File::open(source).map_err(|error| error.to_string())?;
    let mut reader = BufReader::new(input);
    let (prefix, header) = open_header(&mut reader)?;
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|_| "Clé AES invalide".to_string())?;
    let mut output = Vec::with_capacity(limit.min(BLOCK_SIZE));
    let mut index = 0u32;
    loop {
        let mut last = [0u8; 1];
        reader
            .read_exact(&mut last)
            .map_err(|_| "Blob tronqué".to_string())?;
        let is_last = last[0] == 1;
        let mut length = [0u8; 4];
        reader
            .read_exact(&mut length)
            .map_err(|_| "Blob tronqué".to_string())?;
        let length = u32::from_le_bytes(length) as usize;
        if length > BLOCK_SIZE + TAG_SIZE {
            return Err("Bloc de blob trop volumineux".into());
        }
        let mut ciphertext = vec![0u8; length];
        reader
            .read_exact(&mut ciphertext)
            .map_err(|_| "Blob tronqué".to_string())?;
        let plaintext = cipher
            .decrypt(
                &Nonce::from(nonce(&prefix, index, is_last)),
                Payload {
                    msg: &ciphertext,
                    aad: &aad(&header, index, is_last),
                },
            )
            .map_err(|_| "Blob altéré".to_string())?;
        let remaining = limit.saturating_sub(output.len());
        output.extend_from_slice(&plaintext[..plaintext.len().min(remaining)]);
        if is_last || output.len() >= limit {
            break;
        }
        index = index
            .checked_add(1)
            .ok_or_else(|| "Blob trop volumineux".to_string())?;
    }
    Ok(output)
}

#[tauri::command]
pub async fn blob_encrypt(
    app: tauri::AppHandle,
    id: String,
    source: String,
    key: String,
) -> Result<BlobInfo, String> {
    let key = decode_key(&key)?;
    let target = blob_path(&app, &id)?;
    let source = PathBuf::from(source);
    tauri::async_runtime::spawn_blocking(move || encrypt_file(&source, &target, &key))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn blob_decrypt(
    app: tauri::AppHandle,
    id: String,
    target: String,
    key: String,
) -> Result<BlobInfo, String> {
    let key = decode_key(&key)?;
    let source = blob_path(&app, &id)?;
    let target = PathBuf::from(target);
    tauri::async_runtime::spawn_blocking(move || decrypt_file(&source, &target, &key))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn blob_preview(
    app: tauri::AppHandle,
    id: String,
    key: String,
    max_bytes: usize,
) -> Result<String, String> {
    let key = decode_key(&key)?;
    let source = blob_path(&app, &id)?;
    let bytes =
        tauri::async_runtime::spawn_blocking(move || decrypt_preview(&source, &key, max_bytes))
            .await
            .map_err(|error| error.to_string())??;
    Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
}

/// Copie les blobs référencés vers `dir/blobs` (synchronisation par dossier).
#[tauri::command]
pub async fn blob_export_to(
    app: tauri::AppHandle,
    dir: String,
    ids: Vec<String>,
) -> Result<usize, String> {
    let source_dir = blob_dir(&app)?;
    let target_dir = PathBuf::from(dir).join("blobs");
    std::fs::create_dir_all(&target_dir).map_err(|error| error.to_string())?;
    let mut copied = 0;
    for id in ids {
        if !valid_id(&id) {
            continue;
        }
        let source = source_dir.join(&id);
        if !source.is_file() {
            continue;
        }
        let target = target_dir.join(&id);
        std::fs::copy(&source, &target).map_err(|error| error.to_string())?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&target, std::fs::Permissions::from_mode(0o600));
        }
        copied += 1;
    }
    Ok(copied)
}

/// Importe les blobs absents depuis `dir/blobs`.
#[tauri::command]
pub async fn blob_import_from(app: tauri::AppHandle, dir: String) -> Result<usize, String> {
    let target_dir = blob_dir(&app)?;
    let source_dir = PathBuf::from(dir).join("blobs");
    if !source_dir.is_dir() {
        return Ok(0);
    }
    let mut copied = 0;
    for entry in std::fs::read_dir(source_dir).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let name = entry.file_name().to_string_lossy().to_string();
        if !valid_id(&name) || !entry.path().is_file() {
            continue;
        }
        let target = target_dir.join(&name);
        if target.exists() {
            continue;
        }
        std::fs::copy(entry.path(), &target).map_err(|error| error.to_string())?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&target, std::fs::Permissions::from_mode(0o600));
        }
        copied += 1;
    }
    Ok(copied)
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BlobEntry {
    pub id: String,
    pub size: u64,
}

#[tauri::command]
pub fn blob_list(app: tauri::AppHandle) -> Result<Vec<BlobEntry>, String> {
    let dir = blob_dir(&app)?;
    let mut entries = Vec::new();
    for entry in std::fs::read_dir(dir).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let id = entry.file_name().to_string_lossy().to_string();
        if !valid_id(&id) || !entry.path().is_file() {
            continue;
        }
        entries.push(BlobEntry {
            id,
            size: entry.metadata().map(|meta| meta.len()).unwrap_or(0),
        });
    }
    entries.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(entries)
}

#[tauri::command]
pub async fn blob_remove(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let path = blob_path(&app, &id)?;
    if path.exists() {
        std::fs::remove_file(path).map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn key() -> [u8; 32] {
        [7u8; 32]
    }

    fn temp(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "coffre-blob-{}-{}-{}",
            std::process::id(),
            name,
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ))
    }

    #[test]
    fn chiffre_et_dechiffre_un_fichier() {
        let source = temp("source");
        let blob = temp("blob");
        let target = temp("target");
        let mut file = File::create(&source).unwrap();
        let data: Vec<u8> = (0..(BLOCK_SIZE * 2 + 123))
            .map(|index| (index % 251) as u8)
            .collect();
        file.write_all(&data).unwrap();
        drop(file);

        let info = encrypt_file(&source, &blob, &key()).unwrap();
        assert_eq!(info.size, data.len() as u64);
        let decrypted = decrypt_file(&blob, &target, &key()).unwrap();
        assert_eq!(decrypted.size, data.len() as u64);
        assert_eq!(std::fs::read(&target).unwrap(), data);
        let preview = decrypt_preview(&blob, &key(), 1024).unwrap();
        assert_eq!(preview, &data[..1024]);
        let _ = std::fs::remove_file(source);
        let _ = std::fs::remove_file(blob);
        let _ = std::fs::remove_file(target);
    }

    #[test]
    fn detecte_une_troncature() {
        let source = temp("source-trunc");
        let blob = temp("blob-trunc");
        let target = temp("target-trunc");
        std::fs::write(&source, vec![1u8; BLOCK_SIZE * 2]).unwrap();
        encrypt_file(&source, &blob, &key()).unwrap();
        let bytes = std::fs::read(&blob).unwrap();
        std::fs::write(&blob, &bytes[..bytes.len() - 10]).unwrap();
        assert!(decrypt_file(&blob, &target, &key()).is_err());
        let _ = std::fs::remove_file(source);
        let _ = std::fs::remove_file(blob);
        let _ = std::fs::remove_file(target);
    }

    #[test]
    fn detecte_un_reordonnancement_de_blocs() {
        let source = temp("source-order");
        let blob = temp("blob-order");
        let target = temp("target-order");
        std::fs::write(&source, vec![3u8; BLOCK_SIZE * 2]).unwrap();
        encrypt_file(&source, &blob, &key()).unwrap();
        let mut bytes = std::fs::read(&blob).unwrap();
        let first_start = HEADER_SIZE;
        let first_len = 1 + 4 + BLOCK_SIZE + TAG_SIZE;
        let second_start = first_start + first_len;
        let second_len = 1 + 4 + BLOCK_SIZE + TAG_SIZE;
        let first = bytes[first_start..first_start + first_len].to_vec();
        let second = bytes[second_start..second_start + second_len].to_vec();
        bytes[first_start..first_start + first_len].copy_from_slice(&second);
        bytes[second_start..second_start + second_len].copy_from_slice(&first);
        std::fs::write(&blob, bytes).unwrap();
        assert!(decrypt_file(&blob, &target, &key()).is_err());
        let _ = std::fs::remove_file(source);
        let _ = std::fs::remove_file(blob);
        let _ = std::fs::remove_file(target);
    }

    #[test]
    #[ignore = "test manuel de 1 Gio : cargo test -p coffre --lib blob_store::tests::fichier_1_gio -- --ignored"]
    fn fichier_1_gio_en_memoire_constante() {
        let source = temp("source-1g");
        let blob = temp("blob-1g");
        let target = temp("target-1g");
        let file = File::create(&source).unwrap();
        file.set_len(1024 * 1024 * 1024).unwrap();
        drop(file);
        let info = encrypt_file(&source, &blob, &key()).unwrap();
        assert_eq!(info.size, 1024 * 1024 * 1024);
        let decrypted = decrypt_file(&blob, &target, &key()).unwrap();
        assert_eq!(decrypted.size, 1024 * 1024 * 1024);
        assert_eq!(
            std::fs::metadata(&target).unwrap().len(),
            1024 * 1024 * 1024
        );
        let _ = std::fs::remove_file(source);
        let _ = std::fs::remove_file(blob);
        let _ = std::fs::remove_file(target);
    }

    #[test]
    fn detecte_une_substitution_de_bloc() {
        let source = temp("source-sub");
        let blob = temp("blob-sub");
        let target = temp("target-sub");
        std::fs::write(&source, vec![2u8; BLOCK_SIZE * 2]).unwrap();
        encrypt_file(&source, &blob, &key()).unwrap();
        let mut bytes = std::fs::read(&blob).unwrap();
        let last = bytes.len() - 1;
        bytes[last] ^= 0xff;
        std::fs::write(&blob, bytes).unwrap();
        assert!(decrypt_file(&blob, &target, &key()).is_err());
        let _ = std::fs::remove_file(source);
        let _ = std::fs::remove_file(blob);
        let _ = std::fs::remove_file(target);
    }
}
