//! Génère un second vecteur : lecture du fichier Rust, création d’un élément,
//! puis écriture v4 signée. Relu par le test TypeScript.

use coffre_core::{VaultFile, create_item, open, sign};
use serde_json::json;

const PASSWORD: &str = "phrase de passe de test solide";

fn main() {
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../../test-vectors/rust-v4.coffre.json"
    );
    let text = std::fs::read_to_string(path).expect("vecteur Rust");
    let file = VaultFile::parse(&text).expect("parse");
    let mut opened = open(&file, PASSWORD).expect("ouverture");
    let vault_id = opened.vaults[0].id.clone();
    let content = json!({
        "type": "login",
        "title": "Élément créé par Rust",
        "favorite": false,
        "notes": "",
        "tags": [],
        "customFields": [],
        "attachments": [],
        "deletedAt": null,
        "expiresAt": "",
        "username": "rust-mutation",
        "password": "s3cret-mutation",
        "urls": ["https://mutation.example"],
        "totp": "",
    });
    create_item(
        &mut opened.file,
        &opened.session,
        &vault_id,
        content,
        "2026-11-08T21:20:00.000Z",
    )
    .expect("création");
    let signed = sign(
        opened.file,
        &mut opened.session,
        Some(&file),
        "w_rust_mutation",
        "2026-11-08T21:21:00.000Z",
    )
    .expect("signature");
    println!("{}", serde_json::to_string_pretty(&signed).expect("json"));
}
