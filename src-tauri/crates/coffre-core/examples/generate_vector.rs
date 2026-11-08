//! Génère le vecteur v4 relu par le test TypeScript.
//!
//! `cargo run -p coffre-core --example generate_vector > test-vectors/rust-v4.coffre.json`
//! utilise des clés et des nonces fixes : ce fichier est un vecteur de test,
//! jamais un fichier de production.

use coffre_core::{
    AttachmentRecord, Clock, Integrity, ItemRecord, KdfParams, Manifest, SealedValue, VaultFile,
    VaultRecord, VersionRecord, canonical_json, derive_master_key, hmac_sha256,
    seal_bytes_with_nonce, to_base64,
};
use serde_json::json;

const PASSWORD: &str = "phrase de passe de test solide";
const WRITER: &str = "w_rust_vector";
const NOW: &str = "2026-11-08T20:00:00.000Z";

fn sealed(plaintext: &[u8], key: &[u8], aad: &str, nonce: [u8; 12]) -> SealedValue {
    seal_bytes_with_nonce(plaintext, key, aad, &nonce).expect("chiffrement du vecteur")
}

fn main() {
    let kdf = KdfParams {
        algorithm: "argon2id".into(),
        salt: to_base64(&(0u8..16).collect::<Vec<_>>()),
        memory_kib: 8_192,
        iterations: 1,
        parallelism: 1,
        key_length: 32,
    };
    let master = derive_master_key(PASSWORD, &kdf).expect("clé maître");
    let vault_key = [0x11u8; 32];
    let item_key = [0x22u8; 32];
    let integrity_key = [0x33u8; 32];

    let vault_id = "v_rust_vector";
    let item_id = "i_rust_vector";
    let version_id = "ver_rust_vector";
    let attachment_id = "att_rust_vector";

    let vault_record = VaultRecord {
        id: vault_id.into(),
        key: sealed(
            &vault_key,
            &master,
            &coffre_core::vault_key_aad(vault_id),
            [1; 12],
        ),
        name: sealed(
            br#"{"name":"Vecteur Rust"}"#,
            &vault_key,
            &coffre_core::vault_meta_aad(vault_id),
            [2; 12],
        ),
        created_at: NOW.into(),
        updated_at: NOW.into(),
        clock: Some(Clock {
            rev: 1,
            writer: WRITER.into(),
        }),
    };

    let login = |password: &str| {
        json!({
            "type": "login",
            "title": "Rust Vector",
            "favorite": false,
            "notes": "",
            "tags": [],
            "customFields": [],
            "attachments": [{
                "id": attachment_id,
                "name": "rust.txt",
                "mime": "text/plain",
                "size": 15,
                "createdAt": NOW,
            }],
            "deletedAt": null,
            "expiresAt": "",
            "username": "ada",
            "password": password,
            "urls": ["https://rust.example"],
            "totp": "",
        })
    };
    let item_content = login("s3cret-rust!");
    let item_record = ItemRecord {
        id: item_id.into(),
        vault_id: vault_id.into(),
        key: sealed(
            &item_key,
            &vault_key,
            &coffre_core::item_key_aad(vault_id, item_id),
            [3; 12],
        ),
        content: sealed(
            serde_json::to_string(&item_content)
                .expect("contenu")
                .as_bytes(),
            &item_key,
            &coffre_core::item_content_aad(vault_id, item_id),
            [4; 12],
        ),
        created_at: NOW.into(),
        updated_at: NOW.into(),
        clock: Some(Clock {
            rev: 1,
            writer: WRITER.into(),
        }),
    };

    let version_record = VersionRecord {
        id: version_id.into(),
        item_id: item_id.into(),
        vault_id: vault_id.into(),
        content: sealed(
            serde_json::to_string(&login("old-rust"))
                .expect("version")
                .as_bytes(),
            &item_key,
            &coffre_core::item_version_aad(vault_id, item_id, version_id),
            [5; 12],
        ),
        created_at: NOW.into(),
    };
    let attachment_record = AttachmentRecord {
        id: attachment_id.into(),
        item_id: item_id.into(),
        vault_id: vault_id.into(),
        data: sealed(
            b"rust-attachment",
            &item_key,
            &coffre_core::item_attachment_aad(vault_id, item_id, attachment_id),
            [6; 12],
        ),
        created_at: NOW.into(),
    };

    let mut file = VaultFile {
        format: "coffre".into(),
        version: 4,
        id: "vf_rust_vector".into(),
        created_at: NOW.into(),
        updated_at: NOW.into(),
        kdf,
        vaults: vec![vault_record],
        items: vec![item_record],
        attachments: vec![attachment_record],
        versions: vec![version_record],
        recovery: None,
        prf: None,
        writer: Some(WRITER.into()),
        revision: Some(1),
        key_epoch: Some(1),
        tombstones: Some(Vec::new()),
        integrity: None,
    };
    let manifest = Manifest::compute(&file).expect("manifeste");
    let mac = hmac_sha256(
        &integrity_key,
        canonical_json(&manifest.to_json()).as_bytes(),
    )
    .expect("MAC");
    file.integrity = Some(Integrity {
        mac: to_base64(&mac),
        key: sealed(
            &integrity_key,
            &master,
            coffre_core::integrity_key_aad(),
            [7; 12],
        ),
    });

    println!(
        "{}",
        serde_json::to_string_pretty(&file).expect("sérialisation")
    );
}
