//! Structures du fichier `.coffre` et manifeste d’intégrité v4.

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::BTreeMap;

use crate::CoreError;
use crate::crypto::{sha256, to_base64};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KdfParams {
    pub algorithm: String,
    pub salt: String,
    #[serde(rename = "memoryKiB")]
    pub memory_kib: u32,
    pub iterations: u32,
    pub parallelism: u32,
    pub key_length: usize,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Clock {
    pub rev: u64,
    pub writer: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct VaultRecord {
    pub id: String,
    pub key: crate::crypto::SealedValue,
    pub name: crate::crypto::SealedValue,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub clock: Option<Clock>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ItemRecord {
    pub id: String,
    #[serde(rename = "vaultId")]
    pub vault_id: String,
    pub key: crate::crypto::SealedValue,
    pub content: crate::crypto::SealedValue,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub clock: Option<Clock>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AttachmentRecord {
    pub id: String,
    #[serde(rename = "itemId")]
    pub item_id: String,
    #[serde(rename = "vaultId")]
    pub vault_id: String,
    pub data: crate::crypto::SealedValue,
    #[serde(rename = "createdAt")]
    pub created_at: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct VersionRecord {
    pub id: String,
    #[serde(rename = "itemId")]
    pub item_id: String,
    #[serde(rename = "vaultId")]
    pub vault_id: String,
    pub content: crate::crypto::SealedValue,
    #[serde(rename = "createdAt")]
    pub created_at: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryWrap {
    pub vault_id: String,
    pub key: crate::crypto::SealedValue,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryEnvelope {
    pub version: u8,
    pub kdf: KdfParams,
    pub created_at: String,
    pub key: crate::crypto::SealedValue,
    pub guard: crate::crypto::SealedValue,
    pub wraps: Vec<RecoveryWrap>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Tombstone {
    pub kind: String,
    pub id: String,
    pub deleted_at: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Integrity {
    pub mac: String,
    pub key: crate::crypto::SealedValue,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultFile {
    pub format: String,
    pub version: u8,
    pub id: String,
    pub created_at: String,
    pub updated_at: String,
    pub kdf: KdfParams,
    pub vaults: Vec<VaultRecord>,
    #[serde(default)]
    pub items: Vec<ItemRecord>,
    #[serde(default)]
    pub attachments: Vec<AttachmentRecord>,
    #[serde(default)]
    pub versions: Vec<VersionRecord>,
    /// Sidecars chiffrés conservés tels quels : le cœur ne les déchiffre pas,
    /// mais le manifeste couvre leur ciphertext.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub templates: Vec<Value>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub activity: Vec<Value>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub generator_history: Vec<Value>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub alias_keys: Vec<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sharing: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub emergency: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub recovery: Option<RecoveryEnvelope>,
    /// Enveloppe FIDO2/PRF optionnelle, conservée telle quelle par le cœur.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prf: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub writer: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub revision: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub key_epoch: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tombstones: Option<Vec<Tombstone>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub integrity: Option<Integrity>,
}

impl VaultFile {
    pub fn parse(text: &str) -> Result<Self, CoreError> {
        let file: VaultFile = serde_json::from_str(text)
            .map_err(|error| CoreError::InvalidFormat(format!("JSON invalide : {error}")))?;
        if file.format != "coffre" {
            return Err(CoreError::InvalidFormat("format de fichier inconnu".into()));
        }
        if !(1..=4).contains(&file.version) {
            return Err(CoreError::InvalidFormat(
                "version de fichier inconnue".into(),
            ));
        }
        if file.vaults.is_empty() {
            return Err(CoreError::InvalidFormat(
                "aucun coffre dans le fichier".into(),
            ));
        }
        crate::crypto::validate_kdf(&file.kdf)?;
        Ok(file)
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ManifestRecord {
    pub kind: &'static str,
    pub id: String,
    pub vault_id: String,
    pub parent_id: Option<String>,
    pub rev: u64,
    pub writer: String,
    pub ciphertext: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Manifest {
    pub manifest: u8,
    pub file: String,
    pub writer: String,
    pub revision: u64,
    pub key_epoch: u64,
    pub records: Vec<ManifestRecord>,
    pub tombstones: Vec<Tombstone>,
}

fn sealed_digest(sealed: &crate::crypto::SealedValue) -> String {
    to_base64(&sha256(&sealed.digest_input()))
}

fn clock_parts(clock: &Option<Clock>) -> (u64, String) {
    match clock {
        Some(clock) => (clock.rev, clock.writer.clone()),
        None => (0, String::new()),
    }
}

fn value_str<'a>(value: &'a Value, key: &str) -> Result<&'a str, CoreError> {
    value
        .get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| CoreError::InvalidFormat(format!("champ « {key} » absent du sidecar")))
}

fn value_clock(value: &Value) -> (u64, String) {
    match value.get("clock") {
        Some(clock) => (
            clock.get("rev").and_then(Value::as_u64).unwrap_or(0),
            clock
                .get("writer")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string(),
        ),
        None => (0, String::new()),
    }
}

fn value_sealed_digest(value: &Value) -> Result<String, CoreError> {
    let sealed = crate::crypto::SealedValue {
        n: value_str(value, "n")?.to_string(),
        c: value_str(value, "c")?.to_string(),
    };
    Ok(sealed_digest(&sealed))
}

fn text_digest(value: &str) -> String {
    to_base64(&sha256(value.as_bytes()))
}

fn emergency_mode(value: &Value) -> &str {
    value
        .get("mode")
        .and_then(Value::as_str)
        .unwrap_or("immediate")
}

fn emergency_id(value: &Value) -> Result<String, CoreError> {
    if emergency_mode(value) == "shamir" {
        let threshold = value
            .get("threshold")
            .and_then(Value::as_u64)
            .ok_or_else(|| CoreError::InvalidFormat("seuil d’urgence absent".into()))?;
        let total = value
            .get("total")
            .and_then(Value::as_u64)
            .ok_or_else(|| CoreError::InvalidFormat("total d’urgence absent".into()))?;
        let shares = value
            .get("shares")
            .and_then(Value::as_array)
            .ok_or_else(|| CoreError::InvalidFormat("parts d’urgence absentes".into()))?;
        let mut fingerprints = Vec::with_capacity(shares.len());
        for share in shares {
            let contact = share
                .get("contact")
                .ok_or_else(|| CoreError::InvalidFormat("contact d’urgence absent".into()))?;
            fingerprints.push(value_str(contact, "fingerprint")?.to_string());
        }
        Ok(format!(
            "shamir:{threshold}/{total}:{}",
            fingerprints.join(",")
        ))
    } else {
        let contact = value
            .get("contact")
            .ok_or_else(|| CoreError::InvalidFormat("contact d’urgence absent".into()))?;
        Ok(value_str(contact, "fingerprint")?.to_string())
    }
}

fn emergency_digest(value: &Value) -> Result<String, CoreError> {
    if emergency_mode(value) == "shamir" {
        let shares = value
            .get("shares")
            .and_then(Value::as_array)
            .ok_or_else(|| CoreError::InvalidFormat("parts d’urgence absentes".into()))?;
        let mut encs = Vec::with_capacity(shares.len());
        let mut ciphertexts = Vec::with_capacity(shares.len());
        for share in shares {
            let sealed = share
                .get("sealed")
                .ok_or_else(|| CoreError::InvalidFormat("part d’urgence absente".into()))?;
            encs.push(value_str(sealed, "enc")?.to_string());
            ciphertexts.push(value_str(sealed, "ciphertext")?.to_string());
        }
        Ok(text_digest(&format!(
            "{}.{}",
            encs.join("."),
            ciphertexts.join(".")
        )))
    } else {
        let sealed = value
            .get("sealed")
            .ok_or_else(|| CoreError::InvalidFormat("enveloppe d’urgence absente".into()))?;
        Ok(text_digest(&format!(
            "{}.{}",
            value_str(sealed, "enc")?,
            value_str(sealed, "ciphertext")?
        )))
    }
}

impl Manifest {
    pub fn compute(file: &VaultFile) -> Result<Self, CoreError> {
        Self::compute_version(file, 2)
    }

    /// Calcule le manifeste canonique d’une version donnée. La version 1 est
    /// conservée pour vérifier les fichiers signés avant la couverture de
    /// l’historique du générateur.
    pub fn compute_version(file: &VaultFile, manifest_version: u8) -> Result<Self, CoreError> {
        if !(1..=2).contains(&manifest_version) {
            return Err(CoreError::InvalidFormat(
                "version de manifeste inconnue".into(),
            ));
        }
        let revision = file
            .revision
            .ok_or_else(|| CoreError::InvalidFormat("révision absente".into()))?;
        let key_epoch = file
            .key_epoch
            .ok_or_else(|| CoreError::InvalidFormat("époque de clé absente".into()))?;
        if file.version != 4 {
            return Err(CoreError::InvalidFormat(
                "le manifeste exige un fichier v4".into(),
            ));
        }

        let mut records = Vec::new();
        for vault in &file.vaults {
            let (rev, writer) = clock_parts(&vault.clock);
            records.push(ManifestRecord {
                kind: "vault",
                id: vault.id.clone(),
                vault_id: vault.id.clone(),
                parent_id: None,
                rev,
                writer: writer.clone(),
                ciphertext: sealed_digest(&vault.key),
            });
            records.push(ManifestRecord {
                kind: "vault",
                id: format!("{}:name", vault.id),
                vault_id: vault.id.clone(),
                parent_id: None,
                rev,
                writer,
                ciphertext: sealed_digest(&vault.name),
            });
        }

        let item_clocks: BTreeMap<&str, &Clock> = file
            .items
            .iter()
            .filter_map(|item| item.clock.as_ref().map(|clock| (item.id.as_str(), clock)))
            .collect();

        for item in &file.items {
            let (rev, writer) = clock_parts(&item.clock);
            records.push(ManifestRecord {
                kind: "item",
                id: item.id.clone(),
                vault_id: item.vault_id.clone(),
                parent_id: None,
                rev,
                writer: writer.clone(),
                ciphertext: sealed_digest(&item.content),
            });
            records.push(ManifestRecord {
                kind: "item",
                id: format!("{}:key", item.id),
                vault_id: item.vault_id.clone(),
                parent_id: None,
                rev,
                writer,
                ciphertext: sealed_digest(&item.key),
            });
        }

        for attachment in &file.attachments {
            let clock = item_clocks.get(attachment.item_id.as_str());
            let (rev, writer) = match clock {
                Some(clock) => (clock.rev, clock.writer.clone()),
                None => (0, String::new()),
            };
            records.push(ManifestRecord {
                kind: "attachment",
                id: attachment.id.clone(),
                vault_id: attachment.vault_id.clone(),
                parent_id: Some(attachment.item_id.clone()),
                rev,
                writer,
                ciphertext: sealed_digest(&attachment.data),
            });
        }

        for version in &file.versions {
            let clock = item_clocks.get(version.item_id.as_str());
            let (rev, writer) = match clock {
                Some(clock) => (clock.rev, clock.writer.clone()),
                None => (0, String::new()),
            };
            records.push(ManifestRecord {
                kind: "version",
                id: version.id.clone(),
                vault_id: version.vault_id.clone(),
                parent_id: Some(version.item_id.clone()),
                rev,
                writer,
                ciphertext: sealed_digest(&version.content),
            });
        }

        for template in &file.templates {
            let (rev, writer) = value_clock(template);
            let id = value_str(template, "id")?.to_string();
            let key = template
                .get("key")
                .ok_or_else(|| CoreError::InvalidFormat("clé de modèle absente".into()))?;
            let content = template
                .get("content")
                .ok_or_else(|| CoreError::InvalidFormat("contenu de modèle absent".into()))?;
            records.push(ManifestRecord {
                kind: "template",
                id: id.clone(),
                vault_id: String::new(),
                parent_id: None,
                rev,
                writer: writer.clone(),
                ciphertext: value_sealed_digest(key)?,
            });
            records.push(ManifestRecord {
                kind: "template",
                id: format!("{id}:content"),
                vault_id: String::new(),
                parent_id: None,
                rev,
                writer,
                ciphertext: value_sealed_digest(content)?,
            });
        }

        for event in &file.activity {
            let (rev, writer) = value_clock(event);
            let data = event
                .get("data")
                .ok_or_else(|| CoreError::InvalidFormat("données d’activité absentes".into()))?;
            records.push(ManifestRecord {
                kind: "activity",
                id: value_str(event, "id")?.to_string(),
                vault_id: String::new(),
                parent_id: None,
                rev,
                writer,
                ciphertext: value_sealed_digest(data)?,
            });
        }

        for alias in &file.alias_keys {
            let (rev, writer) = value_clock(alias);
            let data = alias
                .get("data")
                .ok_or_else(|| CoreError::InvalidFormat("clé d’alias absente".into()))?;
            records.push(ManifestRecord {
                kind: "alias-key",
                id: value_str(alias, "service")?.to_string(),
                vault_id: String::new(),
                parent_id: None,
                rev,
                writer,
                ciphertext: value_sealed_digest(data)?,
            });
        }

        if let Some(sharing) = &file.sharing {
            let keys = sharing
                .get("privateKeys")
                .ok_or_else(|| CoreError::InvalidFormat("clés de partage absentes".into()))?;
            records.push(ManifestRecord {
                kind: "sharing",
                id: value_str(sharing, "fingerprint")?.to_string(),
                vault_id: String::new(),
                parent_id: None,
                rev: 0,
                writer: String::new(),
                ciphertext: value_sealed_digest(keys)?,
            });
        }

        if let Some(emergency) = &file.emergency {
            records.push(ManifestRecord {
                kind: "emergency",
                id: emergency_id(emergency)?,
                vault_id: String::new(),
                parent_id: None,
                rev: 0,
                writer: String::new(),
                ciphertext: emergency_digest(emergency)?,
            });
        }

        if manifest_version >= 2 {
            for entry in &file.generator_history {
                let (rev, writer) = value_clock(entry);
                let data = entry
                    .get("data")
                    .ok_or_else(|| CoreError::InvalidFormat("entrée générateur absente".into()))?;
                records.push(ManifestRecord {
                    kind: "generator-history",
                    id: value_str(entry, "id")?.to_string(),
                    vault_id: String::new(),
                    parent_id: None,
                    rev,
                    writer,
                    ciphertext: value_sealed_digest(data)?,
                });
            }
        }

        let order = |kind: &str| match kind {
            "vault" => 0,
            "item" => 1,
            "attachment" => 2,
            "version" => 3,
            "template" => 4,
            "activity" => 5,
            "alias-key" => 6,
            "sharing" => 7,
            "emergency" => 8,
            "generator-history" => 9,
            _ => 10,
        };
        records.sort_by(|a, b| {
            order(a.kind)
                .cmp(&order(b.kind))
                .then_with(|| a.id.cmp(&b.id))
        });

        let mut tombstones = file.tombstones.clone().unwrap_or_default();
        tombstones.sort_by(|a, b| a.kind.cmp(&b.kind).then_with(|| a.id.cmp(&b.id)));

        Ok(Manifest {
            manifest: manifest_version,
            file: file.id.clone(),
            writer: file.writer.clone().unwrap_or_default(),
            revision,
            key_epoch,
            records,
            tombstones,
        })
    }

    pub fn to_json(&self) -> Value {
        let records: Vec<Value> = self
            .records
            .iter()
            .map(|record| {
                let mut object = serde_json::Map::new();
                object.insert("type".into(), json!(record.kind));
                object.insert("id".into(), json!(record.id));
                object.insert("vaultId".into(), json!(record.vault_id));
                if let Some(parent_id) = &record.parent_id {
                    object.insert("parentId".into(), json!(parent_id));
                }
                object.insert("rev".into(), json!(record.rev));
                object.insert("writer".into(), json!(record.writer));
                object.insert("ciphertext".into(), json!(record.ciphertext));
                Value::Object(object)
            })
            .collect();
        let tombstones: Vec<Value> = self
            .tombstones
            .iter()
            .map(|tombstone| {
                json!({
                    "kind": tombstone.kind,
                    "id": tombstone.id,
                    "deletedAt": tombstone.deleted_at,
                })
            })
            .collect();
        json!({
            "manifest": self.manifest,
            "file": self.file,
            "writer": self.writer,
            "revision": self.revision,
            "keyEpoch": self.key_epoch,
            "records": records,
            "tombstones": tombstones,
        })
    }
}

/// JSON canonique identique à `canonicalJson` côté TypeScript.
pub fn canonical_json(value: &Value) -> String {
    match value {
        Value::Null => "null".into(),
        Value::Bool(_) | Value::Number(_) | Value::String(_) => {
            serde_json::to_string(value).unwrap_or_default()
        }
        Value::Array(values) => {
            let entries: Vec<String> = values.iter().map(canonical_json).collect();
            format!("[{}]", entries.join(","))
        }
        Value::Object(object) => {
            let mut keys: Vec<&String> = object.keys().collect();
            keys.sort();
            let entries: Vec<String> = keys
                .into_iter()
                .map(|key| {
                    let encoded_key = serde_json::to_string(key).unwrap_or_default();
                    format!("{encoded_key}:{}", canonical_json(&object[key]))
                })
                .collect();
            format!("{{{}}}", entries.join(","))
        }
    }
}
