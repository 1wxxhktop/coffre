use coffre_core::{
    IntegrityState, VaultFile, create_item, merge, open, remove_item, sign, update_item,
};
use serde_json::json;

const PASSWORD: &str = "phrase de passe de test solide";

fn fixture() -> VaultFile {
    let path = format!(
        "{}/../../../src/lib/__fixtures__/v4.coffre.json",
        env!("CARGO_MANIFEST_DIR")
    );
    VaultFile::parse(&std::fs::read_to_string(path).expect("fixture")).expect("parse")
}

fn login(password: &str) -> serde_json::Value {
    json!({
        "type": "login",
        "title": "Fusion",
        "favorite": false,
        "notes": "",
        "tags": [],
        "customFields": [],
        "attachments": [],
        "deletedAt": null,
        "expiresAt": "",
        "username": "fusion",
        "password": password,
        "urls": ["https://fusion.example"],
        "totp": "",
    })
}

#[test]
fn fusionne_deux_elements_crees_separement() {
    let base = fixture();
    let base_opened = open(&base, PASSWORD).expect("base");
    let vault_id = base_opened.vaults[0].id.clone();

    let mut local_opened = open(&base, PASSWORD).expect("local");
    let local_id = create_item(
        &mut local_opened.file,
        &local_opened.session,
        &vault_id,
        login("local"),
        "2026-11-08T22:00:00.000Z",
    )
    .expect("élément local");
    let local = sign(
        local_opened.file,
        &mut local_opened.session,
        Some(&base),
        "w_local",
        "2026-11-08T22:01:00.000Z",
    )
    .expect("signature locale");

    let mut remote_opened = open(&base, PASSWORD).expect("remote");
    let remote_id = create_item(
        &mut remote_opened.file,
        &remote_opened.session,
        &vault_id,
        login("remote"),
        "2026-11-08T22:02:00.000Z",
    )
    .expect("élément distant");
    let remote = sign(
        remote_opened.file,
        &mut remote_opened.session,
        Some(&base),
        "w_remote",
        "2026-11-08T22:03:00.000Z",
    )
    .expect("signature distante");

    let result = merge(&local, std::slice::from_ref(&remote)).expect("fusion");
    assert!(result.conflicts.is_empty());
    assert_eq!(result.file.items.len(), 4);
    let merged_json = serde_json::to_string(&result.file).unwrap();
    let merged = sign(
        result.file,
        &mut local_opened.session,
        Some(&local),
        "w_local",
        "2026-11-08T22:04:00.000Z",
    )
    .expect("signature fusion");
    let opened = open(&merged, PASSWORD).expect("ouverture fusion");
    assert_eq!(opened.integrity, IntegrityState::Valid);
    assert!(opened.items.iter().any(|item| item.id == local_id));
    assert!(opened.items.iter().any(|item| item.id == remote_id));

    let reverse = merge(&remote, &[local]).expect("fusion inverse");
    assert_eq!(merged_json, serde_json::to_string(&reverse.file).unwrap());
}

#[test]
fn signale_un_conflit_et_garde_le_gagnant_deterministe() {
    let base = fixture();
    let mut left_opened = open(&base, PASSWORD).expect("gauche");
    let item_id = left_opened.items[0].id.clone();
    let mut left_content = left_opened.items[0].content.clone();
    left_content["title"] = json!("Titre gauche");
    update_item(
        &mut left_opened.file,
        &left_opened.session,
        &item_id,
        left_content,
        "2026-11-08T22:10:00.000Z",
    )
    .expect("modification gauche");
    let left = sign(
        left_opened.file,
        &mut left_opened.session,
        Some(&base),
        "w_same",
        "2026-11-08T22:11:00.000Z",
    )
    .expect("signature gauche");

    let mut right_opened = open(&base, PASSWORD).expect("droite");
    let mut right_content = right_opened.items[0].content.clone();
    right_content["title"] = json!("Titre droit");
    update_item(
        &mut right_opened.file,
        &right_opened.session,
        &item_id,
        right_content,
        "2026-11-08T22:12:00.000Z",
    )
    .expect("modification droite");
    let right = sign(
        right_opened.file,
        &mut right_opened.session,
        Some(&base),
        "w_same",
        "2026-11-08T22:13:00.000Z",
    )
    .expect("signature droite");

    let result = merge(&left, &[right]).expect("fusion conflit");
    assert_eq!(result.conflicts.len(), 1);
    assert_eq!(result.conflicts[0].kind, "item");
    assert_eq!(result.conflicts[0].reason, "concurrent-edit");
    assert_eq!(result.conflicts[0].id, item_id);
    assert_eq!(result.file.items.len(), 2);
}

#[test]
fn une_tombstone_recente_supprime_l_element() {
    let base = fixture();
    let mut opened = open(&base, PASSWORD).expect("base");
    let item_id = opened.items[0].id.clone();
    remove_item(&mut opened.file, &item_id).expect("suppression");
    let deleted = sign(
        opened.file,
        &mut opened.session,
        Some(&base),
        "w_delete",
        "2026-11-08T22:20:00.000Z",
    )
    .expect("signature suppression");

    let result = merge(&deleted, &[base]).expect("fusion suppression");
    assert!(result.file.items.iter().all(|item| item.id != item_id));
    assert!(
        result
            .file
            .tombstones
            .as_ref()
            .unwrap()
            .iter()
            .any(|tombstone| tombstone.kind == "item" && tombstone.id == item_id)
    );
}

#[test]
fn refuse_des_epoques_differentes() {
    let base = fixture();
    let mut opened = open(&base, PASSWORD).expect("base");
    let rotated = coffre_core::rotate_password(
        &opened.file,
        &mut opened.session,
        "nouveau mot de passe de test",
        &base.kdf,
        "2026-11-08T22:30:00.000Z",
    )
    .expect("rotation");
    let error = merge(&base, &[rotated]).expect_err("époque différente");
    assert_eq!(error.code, coffre_core::MergeErrorCode::EpochMismatch);
    assert_eq!(error.epochs, vec![1, 2]);
}
