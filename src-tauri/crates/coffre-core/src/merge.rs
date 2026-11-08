//! Fusion déterministe de fichiers `.coffre` v4 (L3), sans déchiffrement.
//!
//! La fusion est commutative et idempotente : horloges `{ rev, writer }`,
//! départage par empreinte des ciphertexts, tombstones et unions plafonnées.

use std::collections::{BTreeMap, BTreeSet};
use std::fmt;

use serde::Serialize;

use crate::format::{
    AttachmentRecord, Clock, KdfParams, RecoveryEnvelope, Tombstone, VaultFile, VersionRecord,
};

const MAX_ITEM_VERSIONS: usize = 20;
const MAX_STORED_VERSIONS: usize = 2_000;
const MAX_TOMBSTONES: usize = 50_000;
const MAX_VAULTS: usize = 50;
const MAX_ITEMS: usize = 20_000;
const MAX_ATTACHMENTS: usize = 20_000;

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum MergeErrorCode {
    Format,
    Version,
    FileId,
    EpochMismatch,
    KdfMismatch,
    Limits,
    NoVault,
}

#[derive(Clone, Debug)]
pub struct MergeError {
    pub code: MergeErrorCode,
    pub message: String,
    pub epochs: Vec<u64>,
}

impl fmt::Display for MergeError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for MergeError {}

fn error(code: MergeErrorCode, message: &str) -> MergeError {
    MergeError {
        code,
        message: message.into(),
        epochs: Vec::new(),
    }
}

#[derive(Clone, Debug, Serialize)]
pub struct MergeConflict {
    pub kind: String,
    pub id: String,
    pub reason: String,
    pub losing: serde_json::Value,
}

#[derive(Debug)]
pub struct MergeResult {
    pub file: VaultFile,
    pub conflicts: Vec<MergeConflict>,
    pub warnings: Vec<String>,
}

fn clock(record: &Option<Clock>) -> Result<&Clock, MergeError> {
    record
        .as_ref()
        .ok_or_else(|| error(MergeErrorCode::Format, "horloge de version absente"))
}

fn compare_clock(left: &Clock, right: &Clock) -> std::cmp::Ordering {
    left.rev
        .cmp(&right.rev)
        .then_with(|| left.writer.cmp(&right.writer))
}

fn item_fingerprint(record: &crate::format::ItemRecord) -> String {
    format!(
        "{}:{}:{}:{}:{}:{}",
        record.vault_id,
        record.key.n,
        record.key.c,
        record.content.n,
        record.content.c,
        record.updated_at
    )
}

fn vault_fingerprint(record: &crate::format::VaultRecord) -> String {
    format!(
        "{}:{}:{}:{}:{}",
        record.key.n, record.key.c, record.name.n, record.name.c, record.updated_at
    )
}

fn version_fingerprint(record: &VersionRecord) -> String {
    format!(
        "{}:{}:{}:{}:{}",
        record.item_id, record.vault_id, record.content.n, record.content.c, record.created_at
    )
}

fn attachment_fingerprint(record: &AttachmentRecord) -> String {
    format!(
        "{}:{}:{}:{}:{}",
        record.item_id, record.vault_id, record.data.n, record.data.c, record.created_at
    )
}

fn choose_record<T, F, G>(
    records: &[T],
    clock_of: F,
    fingerprint: G,
) -> Result<(T, Option<T>), MergeError>
where
    T: Clone,
    F: Fn(&T) -> &Option<Clock>,
    G: Fn(&T) -> String,
{
    let mut selected = 0usize;
    for index in 1..records.len() {
        let order = compare_clock(
            clock(clock_of(&records[index]))?,
            clock(clock_of(&records[selected]))?,
        );
        if order == std::cmp::Ordering::Greater
            || (order == std::cmp::Ordering::Equal
                && fingerprint(&records[index]) > fingerprint(&records[selected]))
        {
            selected = index;
        }
    }

    let top_rev = clock(clock_of(&records[selected]))?.rev;
    let mut losing: Option<usize> = None;
    for (index, record) in records.iter().enumerate() {
        if index == selected || clock(clock_of(record))?.rev != top_rev {
            continue;
        }
        if fingerprint(record) == fingerprint(&records[selected]) {
            continue;
        }
        losing = match losing {
            None => Some(index),
            Some(current) => {
                let order = compare_clock(
                    clock(clock_of(record))?,
                    clock(clock_of(&records[current]))?,
                );
                if order == std::cmp::Ordering::Greater
                    || (order == std::cmp::Ordering::Equal
                        && fingerprint(record) > fingerprint(&records[current]))
                {
                    Some(index)
                } else {
                    Some(current)
                }
            }
        };
    }

    Ok((
        records[selected].clone(),
        losing.map(|index| records[index].clone()),
    ))
}

fn unique_by_id<T, F, G>(records: Vec<T>, id_of: F, fingerprint: G) -> (Vec<T>, Vec<(String, T)>)
where
    T: Clone,
    F: Fn(&T) -> String,
    G: Fn(&T) -> String,
{
    let mut by_id: BTreeMap<String, T> = BTreeMap::new();
    let mut conflicts = Vec::new();
    for record in records {
        let id = id_of(&record);
        match by_id.get(&id) {
            None => {
                by_id.insert(id, record);
            }
            Some(existing) => {
                if fingerprint(existing) == fingerprint(&record) {
                    continue;
                }
                if fingerprint(&record) > fingerprint(existing) {
                    conflicts.push((id.clone(), existing.clone()));
                    by_id.insert(id, record);
                } else {
                    conflicts.push((id, record));
                }
            }
        }
    }
    (by_id.into_values().collect(), conflicts)
}

fn merge_tombstones(files: &[&VaultFile]) -> BTreeMap<String, Tombstone> {
    let mut merged: BTreeMap<String, Tombstone> = BTreeMap::new();
    for file in files {
        for tombstone in file.tombstones.clone().unwrap_or_default() {
            let key = format!("{}:{}", tombstone.kind, tombstone.id);
            let replace = merged
                .get(&key)
                .map(|existing| existing.deleted_at < tombstone.deleted_at)
                .unwrap_or(true);
            if replace {
                merged.insert(key, tombstone);
            }
        }
    }
    merged
}

fn tombstone_wins(tombstone: &Tombstone, updated_at: &str) -> bool {
    tombstone.deleted_at.as_str() >= updated_at
}

fn child_survives(deleted_at: Option<&str>, created_at: &str) -> bool {
    deleted_at
        .map(|deleted| created_at > deleted)
        .unwrap_or(true)
}

fn same_kdf(left: &KdfParams, right: &KdfParams) -> bool {
    left.algorithm == right.algorithm
        && left.salt == right.salt
        && left.memory_kib == right.memory_kib
        && left.iterations == right.iterations
        && left.parallelism == right.parallelism
        && left.key_length == right.key_length
}

fn validate(local: &VaultFile, remotes: &[VaultFile]) -> Result<(), MergeError> {
    let files: Vec<&VaultFile> = std::iter::once(local).chain(remotes).collect();
    for file in &files {
        if file.format != "coffre" {
            return Err(error(
                MergeErrorCode::Format,
                "Un fichier à fusionner n’est pas un coffre.",
            ));
        }
        if file.version != 4 {
            return Err(error(
                MergeErrorCode::Version,
                "La synchronisation exige des fichiers v4.",
            ));
        }
        if file.id != local.id {
            return Err(error(
                MergeErrorCode::FileId,
                "Les fichiers n’appartiennent pas au même coffre.",
            ));
        }
        if file.key_epoch.is_none() || file.revision.is_none() || file.writer.is_none() {
            return Err(error(
                MergeErrorCode::Format,
                "Époque, révision ou écrivain absent.",
            ));
        }
        for vault in &file.vaults {
            clock(&vault.clock)?;
        }
        for item in &file.items {
            clock(&item.clock)?;
        }
    }

    let mut epochs: Vec<u64> = files.iter().filter_map(|file| file.key_epoch).collect();
    epochs.sort_unstable();
    epochs.dedup();
    if epochs.len() > 1 {
        return Err(MergeError {
            code: MergeErrorCode::EpochMismatch,
            message: "Les fichiers n’utilisent pas la même époque de clés.".into(),
            epochs,
        });
    }
    for file in files.iter().skip(1) {
        if !same_kdf(&file.kdf, &local.kdf) {
            return Err(error(
                MergeErrorCode::KdfMismatch,
                "Les paramètres KDF diffèrent entre les fichiers.",
            ));
        }
    }
    Ok(())
}

fn select_recovery(
    files: &[&VaultFile],
    live_vault_ids: &BTreeSet<String>,
) -> (Option<RecoveryEnvelope>, Option<String>) {
    let mut candidates: Vec<(u64, String, String, RecoveryEnvelope)> = Vec::new();
    let mut any_recovery = false;
    for file in files {
        let Some(recovery) = &file.recovery else {
            continue;
        };
        any_recovery = true;
        let wrapped: BTreeSet<String> = recovery
            .wraps
            .iter()
            .map(|wrap| wrap.vault_id.clone())
            .collect();
        if &wrapped != live_vault_ids {
            continue;
        }
        let json = serde_json::to_string(recovery).unwrap_or_default();
        candidates.push((
            file.revision.unwrap_or(0),
            recovery.created_at.clone(),
            json,
            recovery.clone(),
        ));
    }
    candidates.sort_by(|a, b| {
        b.0.cmp(&a.0)
            .then_with(|| b.1.cmp(&a.1))
            .then_with(|| b.2.cmp(&a.2))
    });
    if let Some((_, _, _, recovery)) = candidates.into_iter().next() {
        return (Some(recovery), None);
    }
    if any_recovery {
        return (
            None,
            Some(
                "L’enveloppe de récupération n’a pas pu être fusionnée : elle ne couvre pas tous les coffres. Régénérez la phrase.".into(),
            ),
        );
    }
    (None, None)
}

pub fn merge(local: &VaultFile, remotes: &[VaultFile]) -> Result<MergeResult, MergeError> {
    validate(local, remotes)?;
    let files: Vec<&VaultFile> = std::iter::once(local).chain(remotes).collect();
    let mut conflicts: Vec<MergeConflict> = Vec::new();

    let tombstone_map = merge_tombstones(&files);

    let mut vault_groups: BTreeMap<String, Vec<crate::format::VaultRecord>> = BTreeMap::new();
    for file in &files {
        for vault in &file.vaults {
            vault_groups
                .entry(vault.id.clone())
                .or_default()
                .push(vault.clone());
        }
    }
    let mut vaults = Vec::new();
    for records in vault_groups.values() {
        let (selected, conflict) =
            choose_record(records, |record| &record.clock, vault_fingerprint)?;
        if tombstone_map.contains_key(&format!("vault:{}", selected.id)) {
            continue;
        }
        if let Some(losing) = conflict {
            conflicts.push(MergeConflict {
                kind: "vault".into(),
                id: selected.id.clone(),
                reason: "concurrent-edit".into(),
                losing: serde_json::to_value(losing).unwrap_or_default(),
            });
        }
        vaults.push(selected);
    }
    if vaults.is_empty() {
        return Err(error(
            MergeErrorCode::NoVault,
            "La fusion supprimerait tous les coffres.",
        ));
    }
    let live_vault_ids: BTreeSet<String> = vaults.iter().map(|vault| vault.id.clone()).collect();

    let mut item_groups: BTreeMap<String, Vec<crate::format::ItemRecord>> = BTreeMap::new();
    for file in &files {
        for item in &file.items {
            item_groups
                .entry(item.id.clone())
                .or_default()
                .push(item.clone());
        }
    }
    let mut items = Vec::new();
    for records in item_groups.values() {
        let (selected, conflict) =
            choose_record(records, |record| &record.clock, item_fingerprint)?;
        if !live_vault_ids.contains(&selected.vault_id) {
            continue;
        }
        if let Some(tombstone) = tombstone_map.get(&format!("item:{}", selected.id))
            && tombstone_wins(tombstone, &selected.updated_at)
        {
            continue;
        }
        if let Some(losing) = conflict {
            conflicts.push(MergeConflict {
                kind: "item".into(),
                id: selected.id.clone(),
                reason: "concurrent-edit".into(),
                losing: serde_json::to_value(losing).unwrap_or_default(),
            });
        }
        items.push(selected);
    }

    let mut item_deletions: BTreeMap<String, String> = BTreeMap::new();
    for tombstone in tombstone_map.values() {
        if tombstone.kind == "item" {
            item_deletions.insert(tombstone.id.clone(), tombstone.deleted_at.clone());
        }
    }

    let version_records: Vec<VersionRecord> = files
        .iter()
        .flat_map(|file| file.versions.iter().cloned())
        .collect();
    let (version_union, version_conflicts) = unique_by_id(
        version_records,
        |record| record.id.clone(),
        version_fingerprint,
    );
    for (id, losing) in version_conflicts {
        conflicts.push(MergeConflict {
            kind: "version".into(),
            id,
            reason: "duplicate-id".into(),
            losing: serde_json::to_value(losing).unwrap_or_default(),
        });
    }
    let live_items: BTreeMap<String, &crate::format::ItemRecord> =
        items.iter().map(|item| (item.id.clone(), item)).collect();
    let mut versions_by_item: BTreeMap<String, Vec<VersionRecord>> = BTreeMap::new();
    for version in version_union {
        let Some(item) = live_items.get(&version.item_id) else {
            continue;
        };
        if item.vault_id != version.vault_id {
            continue;
        }
        if !child_survives(
            item_deletions.get(&version.item_id).map(String::as_str),
            &version.created_at,
        ) {
            continue;
        }
        versions_by_item
            .entry(version.item_id.clone())
            .or_default()
            .push(version);
    }
    let mut versions = Vec::new();
    for list in versions_by_item.values_mut() {
        list.sort_by(|a, b| {
            b.created_at
                .cmp(&a.created_at)
                .then_with(|| a.id.cmp(&b.id))
        });
        versions.extend(list.iter().take(MAX_ITEM_VERSIONS).cloned());
    }
    if versions.len() > MAX_STORED_VERSIONS {
        versions.sort_by(|a, b| {
            b.created_at
                .cmp(&a.created_at)
                .then_with(|| a.id.cmp(&b.id))
        });
        versions.truncate(MAX_STORED_VERSIONS);
    }
    versions.sort_by(|a, b| {
        a.item_id
            .cmp(&b.item_id)
            .then_with(|| b.created_at.cmp(&a.created_at))
            .then_with(|| a.id.cmp(&b.id))
    });

    let attachment_records: Vec<AttachmentRecord> = files
        .iter()
        .flat_map(|file| file.attachments.iter().cloned())
        .collect();
    let (attachment_union, attachment_conflicts) = unique_by_id(
        attachment_records,
        |record| record.id.clone(),
        attachment_fingerprint,
    );
    for (id, losing) in attachment_conflicts {
        conflicts.push(MergeConflict {
            kind: "attachment".into(),
            id,
            reason: "duplicate-id".into(),
            losing: serde_json::to_value(losing).unwrap_or_default(),
        });
    }
    let mut attachments: Vec<AttachmentRecord> = attachment_union
        .into_iter()
        .filter(|attachment| {
            live_items
                .get(&attachment.item_id)
                .map(|item| item.vault_id == attachment.vault_id)
                .unwrap_or(false)
                && child_survives(
                    item_deletions.get(&attachment.item_id).map(String::as_str),
                    &attachment.created_at,
                )
        })
        .collect();
    attachments.sort_by(|a, b| a.id.cmp(&b.id));

    let mut tombstones: Vec<Tombstone> = tombstone_map.into_values().collect();
    tombstones.sort_by(|a, b| {
        b.deleted_at
            .cmp(&a.deleted_at)
            .then_with(|| a.kind.cmp(&b.kind))
            .then_with(|| a.id.cmp(&b.id))
    });
    tombstones.truncate(MAX_TOMBSTONES);
    tombstones.sort_by(|a, b| a.kind.cmp(&b.kind).then_with(|| a.id.cmp(&b.id)));

    let (recovery, warning) = select_recovery(&files, &live_vault_ids);
    let mut warnings = Vec::new();
    if let Some(warning) = warning {
        warnings.push(warning);
    }

    if vaults.len() > MAX_VAULTS || items.len() > MAX_ITEMS || attachments.len() > MAX_ATTACHMENTS {
        return Err(error(
            MergeErrorCode::Limits,
            "La fusion dépasse les plafonds du format.",
        ));
    }

    vaults.sort_by(|a, b| a.id.cmp(&b.id));
    items.sort_by(|a, b| a.id.cmp(&b.id));
    conflicts.sort_by(|a, b| a.kind.cmp(&b.kind).then_with(|| a.id.cmp(&b.id)));

    let revision = files
        .iter()
        .filter_map(|file| file.revision)
        .max()
        .unwrap_or(0);
    let writer = files
        .iter()
        .filter_map(|file| file.writer.clone())
        .max()
        .unwrap_or_default();
    let created_at = files
        .iter()
        .map(|file| file.created_at.clone())
        .min()
        .unwrap_or_default();
    let updated_at = files
        .iter()
        .map(|file| file.updated_at.clone())
        .max()
        .unwrap_or_default();
    let key_epoch = local
        .key_epoch
        .ok_or_else(|| error(MergeErrorCode::Format, "époque locale absente"))?;

    let merged = VaultFile {
        format: "coffre".into(),
        version: 4,
        id: local.id.clone(),
        created_at,
        updated_at,
        kdf: local.kdf.clone(),
        vaults,
        items,
        attachments,
        versions,
        recovery,
        writer: Some(writer),
        revision: Some(revision),
        key_epoch: Some(key_epoch),
        tombstones: Some(tombstones),
        integrity: None,
    };
    Ok(MergeResult {
        file: merged,
        conflicts,
        warnings,
    })
}
