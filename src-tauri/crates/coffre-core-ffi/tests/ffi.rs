use coffre_core_ffi::{core_create_item, core_merge_vaults, core_open_vault, core_verify_vault};
use serde_json::json;

const PASSWORD: &str = "phrase de passe de test solide";

fn fixture() -> String {
    let path = format!(
        "{}/../../../src/lib/__fixtures__/v4.coffre.json",
        env!("CARGO_MANIFEST_DIR")
    );
    std::fs::read_to_string(path).expect("fixture")
}

#[test]
fn facade_json_ouvre_verifie_cree_et_fusionne() {
    let file = fixture();
    let opened = core_open_vault(file.clone(), PASSWORD.into()).expect("ouverture");
    let opened: serde_json::Value = serde_json::from_str(&opened).expect("json");
    assert_eq!(opened["items"].as_array().unwrap().len(), 2);

    let verified = core_verify_vault(file.clone(), PASSWORD.into()).expect("vérification");
    let verified: serde_json::Value = serde_json::from_str(&verified).expect("json");
    assert_eq!(verified["integrity"], "valid");
    assert_eq!(verified["attachments"], 1);

    let content = json!({
        "type": "login",
        "title": "Depuis UniFFI",
        "favorite": false,
        "notes": "",
        "tags": [],
        "customFields": [],
        "attachments": [],
        "deletedAt": null,
        "expiresAt": "",
        "username": "ffi",
        "password": "s3cret-ffi",
        "urls": ["https://ffi.example"],
        "totp": "",
    });
    let created = core_create_item(
        file.clone(),
        PASSWORD.into(),
        "v_2c51b62488ac166a669145533a6406cf".into(),
        content.to_string(),
        "w_ffi".into(),
        "2026-11-08T23:00:00.000Z".into(),
    )
    .expect("création");
    let created: serde_json::Value = serde_json::from_str(&created).expect("json");
    assert_eq!(created["revision"], 8);

    let merged = core_merge_vaults(file.clone(), vec![created.to_string()]).expect("fusion");
    let merged: serde_json::Value = serde_json::from_str(&merged).expect("json");
    assert_eq!(merged["file"]["items"].as_array().unwrap().len(), 3);
}
