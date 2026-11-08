//! Cœur partagé du format Coffre.
//!
//! Cette première tranche (L2a) couvre la lecture chiffrée v1 à v4, la
//! vérification du MAC global v4 et le manifeste canonique. Les mutations, la
//! rotation et la fusion seront ajoutées dans les tranches suivantes.

mod crypto;
mod format;

use std::collections::HashMap;
use std::fmt;
use zeroize::Zeroizing;

pub use crypto::{
    SealedValue, constant_time_eq, derive_master_key, from_base64, hmac_sha256, integrity_key_aad,
    item_attachment_aad, item_content_aad, item_key_aad, item_version_aad, open_bytes,
    recovery_guard_aad, seal_bytes, seal_bytes_with_nonce, sha256, to_base64, validate_kdf,
    vault_key_aad, vault_meta_aad,
};
pub use format::{
    AttachmentRecord, Clock, Integrity, ItemRecord, KdfParams, Manifest, RecoveryEnvelope,
    RecoveryWrap, Tombstone, VaultFile, VaultRecord, VersionRecord, canonical_json,
};

#[derive(Debug)]
pub enum CoreError {
    InvalidFormat(String),
    Crypto(String),
    WrongPassword,
}

impl fmt::Display for CoreError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            CoreError::InvalidFormat(message) => write!(formatter, "format invalide : {message}"),
            CoreError::Crypto(message) => write!(formatter, "cryptographie : {message}"),
            CoreError::WrongPassword => write!(formatter, "mot de passe incorrect"),
        }
    }
}

impl std::error::Error for CoreError {}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum IntegrityState {
    Valid,
    Unsigned,
    Invalid,
}

impl IntegrityState {
    pub fn as_str(self) -> &'static str {
        match self {
            IntegrityState::Valid => "valid",
            IntegrityState::Unsigned => "unsigned",
            IntegrityState::Invalid => "invalid",
        }
    }
}

pub struct Session {
    master_key: Zeroizing<Vec<u8>>,
    vault_keys: HashMap<String, Zeroizing<Vec<u8>>>,
    recovery_key: Option<Zeroizing<Vec<u8>>>,
    integrity_key: Option<Zeroizing<Vec<u8>>>,
}

impl Session {
    fn new(master_key: &[u8]) -> Self {
        Self {
            master_key: Zeroizing::new(master_key.to_vec()),
            vault_keys: HashMap::new(),
            recovery_key: None,
            integrity_key: None,
        }
    }

    pub fn master_key(&self) -> &[u8] {
        &self.master_key
    }

    pub fn vault_key(&self, vault_id: &str) -> Option<&[u8]> {
        self.vault_keys.get(vault_id).map(|key| key.as_slice())
    }

    pub fn integrity_key(&self) -> Option<&[u8]> {
        self.integrity_key.as_deref().map(|key| key.as_slice())
    }

    pub fn has_recovery_key(&self) -> bool {
        self.recovery_key.is_some()
    }

    /// Efface les clés en mémoire. Les buffers `Zeroizing` restent la
    /// propriété de la session et sont écrasés avant d’être retirés.
    pub fn lock(&mut self) {
        self.vault_keys.clear();
        self.recovery_key = None;
        self.integrity_key = None;
        self.master_key = Zeroizing::new(Vec::new());
    }
}

#[derive(Clone, Debug)]
pub struct OpenedVaultSummary {
    pub id: String,
    pub name: String,
    pub item_count: usize,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug)]
pub struct OpenedItem {
    pub id: String,
    pub vault_id: String,
    pub content: serde_json::Value,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug)]
pub struct OpenedAttachment {
    pub id: String,
    pub item_id: String,
    pub vault_id: String,
    pub bytes: Zeroizing<Vec<u8>>,
}

#[derive(Clone, Debug)]
pub struct OpenedVersion {
    pub id: String,
    pub item_id: String,
    pub vault_id: String,
    pub content: serde_json::Value,
}

pub struct OpenedVault {
    pub file: VaultFile,
    pub session: Session,
    pub vaults: Vec<OpenedVaultSummary>,
    pub items: Vec<OpenedItem>,
    pub attachments: Vec<OpenedAttachment>,
    pub versions: Vec<OpenedVersion>,
    pub warnings: Vec<String>,
    pub integrity: IntegrityState,
    pub read_only: bool,
}

#[derive(Clone, Debug)]
pub struct VerifyReport {
    pub vaults: usize,
    pub items: usize,
    pub attachments: usize,
    pub versions: usize,
    pub signed_records: usize,
    pub integrity: IntegrityState,
}

/// Ouvre un fichier avec le mot de passe maître.
pub fn open(file: &VaultFile, password: &str) -> Result<OpenedVault, CoreError> {
    let master_key = derive_master_key(password, &file.kdf)?;
    open_with_master_key(file, &master_key)
}

/// Ouvre un fichier avec une clé maîtresse déjà dérivée.
pub fn open_with_master_key(file: &VaultFile, master_key: &[u8]) -> Result<OpenedVault, CoreError> {
    if master_key.len() != crypto::KEY_BYTES {
        return Err(CoreError::Crypto("clé maîtresse invalide".into()));
    }
    let mut session = Session::new(master_key);
    let mut warnings = Vec::new();
    let mut opened_vaults = Vec::new();
    let mut open_vault_ids = std::collections::HashSet::new();

    for record in &file.vaults {
        let vault_key =
            match open_bytes(&record.key, master_key, &crypto::vault_key_aad(&record.id)) {
                Ok(key) if key.len() == crypto::KEY_BYTES => key,
                _ => {
                    warnings.push("Un coffre n’a pas pu être déverrouillé.".into());
                    continue;
                }
            };
        open_vault_ids.insert(record.id.clone());

        let name = match open_bytes(
            &record.name,
            &vault_key,
            &crypto::vault_meta_aad(&record.id),
        )
        .and_then(|bytes| {
            serde_json::from_slice::<serde_json::Value>(&bytes)
                .map_err(|_| CoreError::InvalidFormat("nom de coffre illisible".into()))
        }) {
            Ok(value) => value
                .get("name")
                .and_then(serde_json::Value::as_str)
                .filter(|value| !value.trim().is_empty())
                .unwrap_or("Coffre sans nom")
                .to_string(),
            Err(_) => {
                warnings.push("Le nom d’un coffre n’a pas pu être déchiffré.".into());
                "Coffre sans nom".to_string()
            }
        };

        opened_vaults.push(OpenedVaultSummary {
            id: record.id.clone(),
            name,
            item_count: 0,
            created_at: record.created_at.clone(),
            updated_at: record.updated_at.clone(),
        });
        session.vault_keys.insert(record.id.clone(), vault_key);
    }

    if open_vault_ids.is_empty() {
        return Err(CoreError::WrongPassword);
    }

    if let Some(recovery) = &file.recovery {
        match open_bytes(&recovery.guard, master_key, crypto::recovery_guard_aad()) {
            Ok(key) if key.len() == crypto::KEY_BYTES => {
                session.recovery_key = Some(key);
            }
            _ => warnings.push(
                "La clé de récupération n’a pas pu être maintenue ; régénérez la phrase.".into(),
            ),
        }
    }

    let integrity = verify_integrity(file, master_key, &mut session, &mut warnings)?;

    let mut items = Vec::new();
    let mut item_keys: HashMap<String, Zeroizing<Vec<u8>>> = HashMap::new();
    for record in &file.items {
        if !open_vault_ids.contains(&record.vault_id) {
            warnings.push("Un élément appartient à un coffre inaccessible.".into());
            continue;
        }
        let vault_key = session
            .vault_key(&record.vault_id)
            .ok_or_else(|| CoreError::InvalidFormat("clé de coffre absente".into()))?;
        let item_key = match open_bytes(
            &record.key,
            vault_key,
            &crypto::item_key_aad(&record.vault_id, &record.id),
        ) {
            Ok(key) if key.len() == crypto::KEY_BYTES => key,
            _ => {
                warnings.push("Un élément n’a pas pu être déverrouillé.".into());
                continue;
            }
        };
        let content = match open_bytes(
            &record.content,
            &item_key,
            &crypto::item_content_aad(&record.vault_id, &record.id),
        )
        .and_then(|bytes| {
            serde_json::from_slice::<serde_json::Value>(&bytes)
                .map_err(|_| CoreError::InvalidFormat("contenu d’élément illisible".into()))
        }) {
            Ok(content) if content.is_object() => content,
            _ => {
                warnings.push("Un élément n’a pas pu être déchiffré et a été ignoré.".into());
                continue;
            }
        };
        item_keys.insert(record.id.clone(), item_key);
        items.push(OpenedItem {
            id: record.id.clone(),
            vault_id: record.vault_id.clone(),
            content,
            created_at: record.created_at.clone(),
            updated_at: record.updated_at.clone(),
        });
    }

    for item in &items {
        if item
            .content
            .get("deletedAt")
            .and_then(serde_json::Value::as_str)
            .is_some()
        {
            continue;
        }
        if let Some(vault) = opened_vaults
            .iter_mut()
            .find(|vault| vault.id == item.vault_id)
        {
            vault.item_count += 1;
        }
    }

    let mut attachments = Vec::new();
    for record in &file.attachments {
        if !open_vault_ids.contains(&record.vault_id) {
            warnings.push("Une pièce jointe appartient à un coffre inaccessible.".into());
            continue;
        }
        let Some(item_key) = item_keys.get(&record.item_id) else {
            warnings.push("Une pièce jointe n’a pas pu être déchiffrée.".into());
            continue;
        };
        let bytes = match open_bytes(
            &record.data,
            item_key,
            &crypto::item_attachment_aad(&record.vault_id, &record.item_id, &record.id),
        ) {
            Ok(bytes) => bytes,
            Err(_) => {
                warnings.push("Une pièce jointe n’a pas pu être déchiffrée.".into());
                continue;
            }
        };
        attachments.push(OpenedAttachment {
            id: record.id.clone(),
            item_id: record.item_id.clone(),
            vault_id: record.vault_id.clone(),
            bytes,
        });
    }

    let mut versions = Vec::new();
    for record in &file.versions {
        if !open_vault_ids.contains(&record.vault_id) {
            warnings.push("Une version appartient à un coffre inaccessible.".into());
            continue;
        }
        let Some(item_key) = item_keys.get(&record.item_id) else {
            warnings.push("Une version n’a pas pu être déchiffrée.".into());
            continue;
        };
        let content = match open_bytes(
            &record.content,
            item_key,
            &crypto::item_version_aad(&record.vault_id, &record.item_id, &record.id),
        )
        .and_then(|bytes| {
            serde_json::from_slice::<serde_json::Value>(&bytes)
                .map_err(|_| CoreError::InvalidFormat("version illisible".into()))
        }) {
            Ok(content) => content,
            Err(_) => {
                warnings.push("Une version n’a pas pu être déchiffrée.".into());
                continue;
            }
        };
        versions.push(OpenedVersion {
            id: record.id.clone(),
            item_id: record.item_id.clone(),
            vault_id: record.vault_id.clone(),
            content,
        });
    }
    let read_only = integrity == IntegrityState::Invalid;
    Ok(OpenedVault {
        file: file.clone(),
        session,
        vaults: opened_vaults,
        items,
        attachments,
        versions,
        warnings,
        integrity,
        read_only,
    })
}

fn verify_integrity(
    file: &VaultFile,
    master_key: &[u8],
    session: &mut Session,
    warnings: &mut Vec<String>,
) -> Result<IntegrityState, CoreError> {
    if file.version != 4 {
        return Ok(IntegrityState::Unsigned);
    }
    let Some(integrity) = &file.integrity else {
        warnings.push(
            "La signature du fichier de version 4 est absente. Le coffre est ouvert en lecture seule."
                .into(),
        );
        return Ok(IntegrityState::Invalid);
    };
    let key = match open_bytes(&integrity.key, master_key, crypto::integrity_key_aad()) {
        Ok(key) if key.len() == crypto::KEY_BYTES => key,
        _ => {
            warnings.push(
                "Le fichier de coffre a été modifié hors de Coffre (clé d’intégrité illisible)."
                    .into(),
            );
            return Ok(IntegrityState::Invalid);
        }
    };
    let valid = verify_file_mac(file, &key)?;
    session.integrity_key = Some(key);
    if valid {
        Ok(IntegrityState::Valid)
    } else {
        warnings.push(
            "Le fichier de coffre a été modifié hors de Coffre (MAC global invalide). Il est ouvert en lecture seule."
                .into(),
        );
        Ok(IntegrityState::Invalid)
    }
}

pub fn verify_file_mac(file: &VaultFile, integrity_key: &[u8]) -> Result<bool, CoreError> {
    let Some(integrity) = &file.integrity else {
        return Ok(false);
    };
    let manifest = Manifest::compute(file)?;
    let bytes = canonical_json(&manifest.to_json());
    let expected = hmac_sha256(integrity_key, bytes.as_bytes())?;
    let actual = from_base64(&integrity.mac)?;
    Ok(constant_time_eq(&expected, &actual))
}

fn item_key_for(
    file: &VaultFile,
    session: &Session,
    vault_id: &str,
    item_id: &str,
) -> Option<Zeroizing<Vec<u8>>> {
    let vault_key = session.vault_key(vault_id)?;
    let record = file
        .items
        .iter()
        .find(|record| record.id == item_id && record.vault_id == vault_id)?;
    let key = open_bytes(
        &record.key,
        vault_key,
        &crypto::item_key_aad(vault_id, item_id),
    )
    .ok()?;
    if key.len() == crypto::KEY_BYTES {
        Some(key)
    } else {
        None
    }
}

pub fn verify(file: &VaultFile, session: &Session) -> Result<VerifyReport, CoreError> {
    let mut vaults = 0;
    let mut items = 0;
    let mut attachments = 0;
    let mut versions = 0;
    for record in &file.vaults {
        let Some(vault_key) = session.vault_key(&record.id) else {
            continue;
        };
        if open_bytes(
            &record.key,
            session.master_key(),
            &crypto::vault_key_aad(&record.id),
        )
        .is_ok()
            && vault_key.len() == crypto::KEY_BYTES
        {
            vaults += 1;
        }
    }
    for record in &file.items {
        let Some(vault_key) = session.vault_key(&record.vault_id) else {
            continue;
        };
        if let Ok(item_key) = open_bytes(
            &record.key,
            vault_key,
            &crypto::item_key_aad(&record.vault_id, &record.id),
        ) && open_bytes(
            &record.content,
            &item_key,
            &crypto::item_content_aad(&record.vault_id, &record.id),
        )
        .is_ok()
        {
            items += 1;
        }
    }
    for record in &file.attachments {
        if let Some(item_key) = item_key_for(file, session, &record.vault_id, &record.item_id)
            && open_bytes(
                &record.data,
                &item_key,
                &crypto::item_attachment_aad(&record.vault_id, &record.item_id, &record.id),
            )
            .is_ok()
        {
            attachments += 1;
        }
    }
    for record in &file.versions {
        if let Some(item_key) = item_key_for(file, session, &record.vault_id, &record.item_id)
            && open_bytes(
                &record.content,
                &item_key,
                &crypto::item_version_aad(&record.vault_id, &record.item_id, &record.id),
            )
            .is_ok()
        {
            versions += 1;
        }
    }
    let signed_records = if file.version == 4 {
        Manifest::compute(file)?.records.len()
    } else {
        0
    };
    let integrity = match (&file.integrity, session.integrity_key()) {
        (Some(_), Some(key)) if verify_file_mac(file, key)? => IntegrityState::Valid,
        (Some(_), _) => IntegrityState::Invalid,
        (None, _) => IntegrityState::Unsigned,
    };
    Ok(VerifyReport {
        vaults,
        items,
        attachments,
        versions,
        signed_records,
        integrity,
    })
}
