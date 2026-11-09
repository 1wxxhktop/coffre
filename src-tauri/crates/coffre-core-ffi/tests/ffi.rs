use coffre_core::VaultFile;
use coffre_core::derive_master_key;
use coffre_core_ffi::{
    core_create_item, core_credential_identities, core_logins_for_service, core_merge_vaults,
    core_open_vault, core_open_vault_with_key, core_passkey_assert, core_passkey_create,
    core_reveal_login, core_verify_vault,
};
use serde_json::json;

const PASSWORD: &str = "phrase de passe de test solide";

fn fixture() -> String {
    let path = format!(
        "{}/../../../src/lib/__fixtures__/v4.coffre.json",
        env!("CARGO_MANIFEST_DIR")
    );
    std::fs::read_to_string(path).expect("fixture")
}

fn master_key(file_json: &str) -> Vec<u8> {
    let file = VaultFile::parse(file_json).expect("fichier");
    derive_master_key(PASSWORD, &file.kdf)
        .expect("clé")
        .to_vec()
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

#[test]
fn autofill_et_passkeys_sans_secret_dans_les_metadonnees() {
    let file = fixture();
    let key = master_key(&file);

    let summary: serde_json::Value = serde_json::from_str(
        &core_open_vault_with_key(file.clone(), key.clone()).expect("ouverture"),
    )
    .expect("json");
    assert_eq!(summary["readOnly"], false);
    assert!(!summary["vaults"].as_array().unwrap().is_empty());
    let vault_id = summary["vaults"][0]["id"].as_str().unwrap().to_string();

    let logins: serde_json::Value = serde_json::from_str(
        &core_logins_for_service(file.clone(), key.clone(), "github.com".into())
            .expect("connexions"),
    )
    .expect("json");
    let login = &logins[0];
    assert_eq!(login["username"], "studio26");
    assert_eq!(login["title"], "GitHub");
    let metadata = serde_json::to_string(&logins).unwrap();
    assert!(!metadata.contains("s3cret-v2!"));
    assert!(!metadata.contains("\"password\""));
    assert!(!metadata.contains("\"totp\""));

    let item_id = login["id"].as_str().unwrap().to_string();
    let revealed: serde_json::Value = serde_json::from_str(
        &core_reveal_login(file.clone(), key.clone(), item_id).expect("révélation"),
    )
    .expect("json");
    assert_eq!(revealed["password"], "s3cret-v2!");
    assert!(revealed["totpCode"].is_null());

    let identities: serde_json::Value = serde_json::from_str(
        &core_credential_identities(file.clone(), key.clone()).expect("identités"),
    )
    .expect("json");
    assert!(identities.as_array().unwrap().iter().any(|identity| {
        identity["username"] == "studio26" && identity["service"] == "github.com"
    }));
    assert!(!identities.to_string().contains("s3cret-v2!"));

    let created: serde_json::Value = serde_json::from_str(
        &core_passkey_create(
            file.clone(),
            key.clone(),
            vault_id.clone(),
            "example.com".into(),
            "https://login.example.com".into(),
            "Y2hhbGxlbmdl".into(),
            "vector@example.com".into(),
            Some("dXNlcg".into()),
        )
        .expect("création passkey"),
    )
    .expect("json");
    let content = json!({
        "type": "passkey",
        "title": "Vecteur FFI",
        "favorite": false,
        "notes": "",
        "tags": [],
        "customFields": [],
        "attachments": [],
        "deletedAt": null,
        "expiresAt": "",
        "rpId": "example.com",
        "userHandle": created["userHandle"],
        "userName": "vector@example.com",
        "credentialId": created["credentialId"],
        "privateKey": created["privateKey"],
        "publicKeyCose": created["publicKeyCose"],
        "signCount": 0,
    });
    let signed = core_create_item(
        file,
        PASSWORD.into(),
        vault_id,
        content.to_string(),
        "w_ffi".into(),
        "2026-11-09T12:00:00.000Z".into(),
    )
    .expect("élément passkey");
    let signed_file = VaultFile::parse(&signed).expect("fichier signé");
    let passkey_id = signed_file
        .items
        .iter()
        .find_map(|item| {
            let content = coffre_core::open(&signed_file, PASSWORD)
                .ok()?
                .items
                .into_iter()
                .find(|opened| opened.id == item.id)
                .map(|opened| opened.content)?;
            (content["type"] == "passkey").then(|| item.id.clone())
        })
        .expect("élément passkey retrouvé");
    let assertion: serde_json::Value = serde_json::from_str(
        &core_passkey_assert(
            signed,
            key,
            passkey_id,
            "example.com".into(),
            "https://login.example.com".into(),
            "Y2hhbGxlbmdl".into(),
        )
        .expect("assertion"),
    )
    .expect("json");
    assert_eq!(assertion["credentialId"], created["credentialId"]);
    assert!(!assertion["signature"].as_str().unwrap().is_empty());
}

#[test]
fn refuse_de_remplir_un_fichier_en_lecture_seule() {
    let mut file: serde_json::Value = serde_json::from_str(&fixture()).unwrap();
    file["integrity"]["mac"] = json!("AAAA");
    let file = file.to_string();
    let key = master_key(&fixture());
    assert!(core_logins_for_service(file, key, "github.com".into()).is_err());
}
