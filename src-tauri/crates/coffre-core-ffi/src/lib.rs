//! Façade JSON pour les liaisons UniFFI (Swift/Kotlin) et les tests.
//!
//! Chaque appel est volontairement sans état et reçoit le fichier chiffré :
//! les extensions mobiles peuvent dériver la clé à chaque opération sans
//! conserver de session Rust entre deux appels.

use coffre_core::{
    self as core, IntegrityState, KdfParams, MergeConflict, VaultFile, VerifyReport,
};
use serde::Serialize;
use thiserror::Error;

uniffi::setup_scaffolding!();

#[derive(Debug, Error, uniffi::Error)]
pub enum FfiError {
    #[error("{message}")]
    Message { message: String },
}

fn ffi_error(error: impl std::fmt::Display) -> FfiError {
    FfiError::Message {
        message: error.to_string(),
    }
}

type FfiResult<T> = Result<T, FfiError>;

#[derive(Serialize)]
struct VaultDto {
    id: String,
    name: String,
    item_count: usize,
    created_at: String,
    updated_at: String,
}

#[derive(Serialize)]
struct ItemDto {
    id: String,
    vault_id: String,
    content: serde_json::Value,
    created_at: String,
    updated_at: String,
}

#[derive(Serialize)]
struct AttachmentDto {
    id: String,
    item_id: String,
    vault_id: String,
    bytes_base64: String,
}

#[derive(Serialize)]
struct VersionDto {
    id: String,
    item_id: String,
    vault_id: String,
    content: serde_json::Value,
}

#[derive(Serialize)]
struct OpenedDto {
    vaults: Vec<VaultDto>,
    items: Vec<ItemDto>,
    attachments: Vec<AttachmentDto>,
    versions: Vec<VersionDto>,
    integrity: String,
    read_only: bool,
    warnings: Vec<String>,
}

#[derive(Serialize)]
struct VerifyDto {
    vaults: usize,
    items: usize,
    attachments: usize,
    versions: usize,
    signed_records: usize,
    integrity: String,
}

#[derive(Serialize)]
struct MergeDto {
    file: VaultFile,
    conflicts: Vec<MergeConflict>,
    warnings: Vec<String>,
}

fn integrity_name(state: IntegrityState) -> String {
    state.as_str().to_string()
}

fn opened_dto(opened: core::OpenedVault) -> OpenedDto {
    OpenedDto {
        vaults: opened
            .vaults
            .into_iter()
            .map(|vault| VaultDto {
                id: vault.id,
                name: vault.name,
                item_count: vault.item_count,
                created_at: vault.created_at,
                updated_at: vault.updated_at,
            })
            .collect(),
        items: opened
            .items
            .into_iter()
            .map(|item| ItemDto {
                id: item.id,
                vault_id: item.vault_id,
                content: item.content,
                created_at: item.created_at,
                updated_at: item.updated_at,
            })
            .collect(),
        attachments: opened
            .attachments
            .into_iter()
            .map(|attachment| AttachmentDto {
                id: attachment.id,
                item_id: attachment.item_id,
                vault_id: attachment.vault_id,
                bytes_base64: core::to_base64(&attachment.bytes),
            })
            .collect(),
        versions: opened
            .versions
            .into_iter()
            .map(|version| VersionDto {
                id: version.id,
                item_id: version.item_id,
                vault_id: version.vault_id,
                content: version.content,
            })
            .collect(),
        integrity: integrity_name(opened.integrity),
        read_only: opened.read_only,
        warnings: opened.warnings,
    }
}

fn verify_dto(report: VerifyReport) -> VerifyDto {
    VerifyDto {
        vaults: report.vaults,
        items: report.items,
        attachments: report.attachments,
        versions: report.versions,
        signed_records: report.signed_records,
        integrity: integrity_name(report.integrity),
    }
}

fn parse_file(value: &str) -> FfiResult<VaultFile> {
    VaultFile::parse(value).map_err(ffi_error)
}

fn json<T: Serialize>(value: &T) -> FfiResult<String> {
    serde_json::to_string(value).map_err(ffi_error)
}

/// Ouvre un fichier et renvoie les métadonnées et contenus déchiffrés en JSON.
#[uniffi::export]
pub fn core_open_vault(file_json: String, password: String) -> FfiResult<String> {
    let file = parse_file(&file_json)?;
    let opened = core::open(&file, &password).map_err(ffi_error)?;
    json(&opened_dto(opened))
}

/// Vérifie le MAC et tous les contenus, sans conserver la session.
#[uniffi::export]
pub fn core_verify_vault(file_json: String, password: String) -> FfiResult<String> {
    let file = parse_file(&file_json)?;
    let opened = core::open(&file, &password).map_err(ffi_error)?;
    let report = core::verify(&file, &opened.session).map_err(ffi_error)?;
    json(&verify_dto(report))
}

/// Crée un élément, signe le fichier v4 et renvoie le JSON complet.
#[uniffi::export]
pub fn core_create_item(
    file_json: String,
    password: String,
    vault_id: String,
    content_json: String,
    writer: String,
    now: String,
) -> FfiResult<String> {
    let original = parse_file(&file_json)?;
    let mut opened = core::open(&original, &password).map_err(ffi_error)?;
    let content: serde_json::Value = serde_json::from_str(&content_json).map_err(ffi_error)?;
    core::create_item(&mut opened.file, &opened.session, &vault_id, content, &now)
        .map_err(ffi_error)?;
    let signed = core::sign(
        opened.file,
        &mut opened.session,
        Some(&original),
        &writer,
        &now,
    )
    .map_err(ffi_error)?;
    json(&signed)
}

/// Remplace le contenu d’un élément et renvoie le fichier signé.
#[uniffi::export]
pub fn core_update_item(
    file_json: String,
    password: String,
    item_id: String,
    content_json: String,
    writer: String,
    now: String,
) -> FfiResult<String> {
    let original = parse_file(&file_json)?;
    let mut opened = core::open(&original, &password).map_err(ffi_error)?;
    let content: serde_json::Value = serde_json::from_str(&content_json).map_err(ffi_error)?;
    core::update_item(&mut opened.file, &opened.session, &item_id, content, &now)
        .map_err(ffi_error)?;
    let signed = core::sign(
        opened.file,
        &mut opened.session,
        Some(&original),
        &writer,
        &now,
    )
    .map_err(ffi_error)?;
    json(&signed)
}

/// Supprime définitivement un élément et renvoie le fichier signé.
#[uniffi::export]
pub fn core_remove_item(
    file_json: String,
    password: String,
    item_id: String,
    writer: String,
    now: String,
) -> FfiResult<String> {
    let original = parse_file(&file_json)?;
    let mut opened = core::open(&original, &password).map_err(ffi_error)?;
    core::remove_item(&mut opened.file, &item_id).map_err(ffi_error)?;
    let signed = core::sign(
        opened.file,
        &mut opened.session,
        Some(&original),
        &writer,
        &now,
    )
    .map_err(ffi_error)?;
    json(&signed)
}

/// Change le mot de passe maître et renvoie le fichier signé.
#[uniffi::export]
pub fn core_rotate_password(
    file_json: String,
    old_password: String,
    new_password: String,
    kdf_json: String,
    writer: String,
    now: String,
) -> FfiResult<String> {
    let original = parse_file(&file_json)?;
    let mut opened = core::open(&original, &old_password).map_err(ffi_error)?;
    let kdf: KdfParams = serde_json::from_str(&kdf_json).map_err(ffi_error)?;
    let rotated =
        core::rotate_password(&opened.file, &mut opened.session, &new_password, &kdf, &now)
            .map_err(ffi_error)?;
    let signed = core::sign(rotated, &mut opened.session, Some(&original), &writer, &now)
        .map_err(ffi_error)?;
    json(&signed)
}

/// Fusionne des fichiers déjà authentifiés et renvoie le fichier sans MAC.
#[uniffi::export]
pub fn core_merge_vaults(local_json: String, remotes_json: Vec<String>) -> FfiResult<String> {
    let local = parse_file(&local_json)?;
    let mut remotes = Vec::with_capacity(remotes_json.len());
    for remote in remotes_json {
        remotes.push(parse_file(&remote)?);
    }
    let result = core::merge(&local, &remotes).map_err(ffi_error)?;
    json(&MergeDto {
        file: result.file,
        conflicts: result.conflicts,
        warnings: result.warnings,
    })
}
