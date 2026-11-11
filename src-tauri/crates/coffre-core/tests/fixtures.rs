use coffre_core::{CoreError, IntegrityState, Manifest, VaultFile, open, sign};

const PASSWORD: &str = "phrase de passe de test solide";

fn fixture(name: &str) -> VaultFile {
    let path = format!(
        "{}/../../../src/lib/__fixtures__/{name}",
        env!("CARGO_MANIFEST_DIR")
    );
    let text = std::fs::read_to_string(path).expect("fixture lisible");
    VaultFile::parse(&text).expect("fixture valide")
}

fn password(item: &coffre_core::OpenedItem) -> Option<&str> {
    item.content
        .get("password")
        .and_then(|value| value.as_str())
}

#[test]
fn ouvre_les_fichiers_v1_a_v4() {
    let v1 = open(&fixture("v1.coffre.json"), PASSWORD).expect("v1");
    assert_eq!(v1.vaults[0].name, "Ancien format");
    assert_eq!(v1.items.len(), 2);
    assert_eq!(v1.vaults[0].item_count, 2);
    assert_eq!(v1.integrity, IntegrityState::Unsigned);
    assert!(v1.items.iter().any(|item| {
        item.content.get("title").and_then(|value| value.as_str()) == Some("GitHub")
            && password(item) == Some("s3cret!")
    }));

    let v2 = open(&fixture("v2.coffre.json"), PASSWORD).expect("v2");
    assert_eq!(v2.items.len(), 2);
    assert_eq!(v2.versions.len(), 2);
    assert_eq!(v2.vaults[0].item_count, 1);
    assert!(v2.items.iter().any(|item| {
        item.content.get("title").and_then(|value| value.as_str()) == Some("GitHub")
            && password(item) == Some("s3cret-v3!")
    }));

    let v3 = open(&fixture("v3.coffre.json"), PASSWORD).expect("v3");
    assert_eq!(v3.items.len(), 1);
    assert!(v3.session.has_recovery_key());

    let v4 = open(&fixture("v4.coffre.json"), PASSWORD).expect("v4");
    assert_eq!(v4.items.len(), 2);
    assert_eq!(v4.versions.len(), 1);
    assert_eq!(v4.attachments.len(), 1);
    assert_eq!(v4.integrity, IntegrityState::Valid);
    assert!(!v4.read_only);
    assert_eq!(v4.file.revision, Some(7));
    assert!(v4.items.iter().any(|item| {
        item.content.get("title").and_then(|value| value.as_str()) == Some("GitHub")
            && password(item) == Some("s3cret-v2!")
    }));
}

#[test]
fn ouvre_un_fichier_avec_historique_du_generateur() {
    let path = format!(
        "{}/../../../src/lib/__fixtures__/v4-generator.coffre.json",
        env!("CARGO_MANIFEST_DIR")
    );
    let text = std::fs::read_to_string(path).expect("fixture lisible");
    let value: serde_json::Value = serde_json::from_str(&text).expect("JSON valide");
    assert!(
        value
            .get("generatorHistory")
            .and_then(|entry| entry.as_array())
            .is_some_and(|entries| entries.len() == 1),
        "historique du générateur présent"
    );
    assert!(!text.contains("généré-pour-le-test-42!"));

    let file = VaultFile::parse(&text).expect("fixture valide");
    let opened = open(&file, PASSWORD).expect("ouverture du fichier générateur");
    assert_eq!(opened.integrity, IntegrityState::Valid);
    assert_eq!(opened.vaults[0].name, "Historique générateur");
}

#[test]
fn manifeste_croise_les_sidecars_avec_typescript() {
    let root = format!("{}/../../../test-vectors", env!("CARGO_MANIFEST_DIR"));
    let text = std::fs::read_to_string(format!("{root}/manifest-v2-sidecars.file.json"))
        .expect("fichier vecteur");
    let expected = std::fs::read_to_string(format!("{root}/manifest-v2-sidecars.manifest.json"))
        .expect("manifeste attendu");
    let expected_v1 = std::fs::read_to_string(format!("{root}/manifest-v1-sidecars.manifest.json"))
        .expect("manifeste v1 attendu");
    let expected_v3 = std::fs::read_to_string(format!("{root}/manifest-v3-sidecars.manifest.json"))
        .expect("manifeste v3 attendu");
    let file = VaultFile::parse(&text).expect("vecteur valide");
    let manifest = Manifest::compute_version(&file, 2).expect("manifeste v2");
    assert_eq!(
        coffre_core::canonical_json(&manifest.to_json()),
        expected.trim()
    );
    let legacy = Manifest::compute_version(&file, 1).expect("manifeste v1");
    assert_eq!(
        coffre_core::canonical_json(&legacy.to_json()),
        expected_v1.trim()
    );
    let current = Manifest::compute_version(&file, 3).expect("manifeste v3");
    assert_eq!(
        coffre_core::canonical_json(&current.to_json()),
        expected_v3.trim()
    );
}

#[test]
fn manifeste_3_couvre_les_cles_publiques_d_urgence() {
    let root = format!("{}/../../../test-vectors", env!("CARGO_MANIFEST_DIR"));
    let text = std::fs::read_to_string(format!("{root}/manifest-v2-sidecars.file.json"))
        .expect("fichier vecteur");
    let mut file = VaultFile::parse(&text).expect("vecteur valide");

    let emergency_ciphertext = |manifest: &Manifest| {
        manifest
            .records
            .iter()
            .find(|record| record.kind == "emergency")
            .expect("enregistrement d’urgence")
            .ciphertext
            .clone()
    };

    let v2_before = emergency_ciphertext(&Manifest::compute_version(&file, 2).unwrap());
    let v3_before = emergency_ciphertext(&Manifest::compute_version(&file, 3).unwrap());

    let emergency = file.emergency.as_mut().expect("urgence présente");
    emergency["contact"]["encryptionPublicKey"] = serde_json::json!("autre-cle-publique");

    let v2_after = emergency_ciphertext(&Manifest::compute_version(&file, 2).unwrap());
    let v3_after = emergency_ciphertext(&Manifest::compute_version(&file, 3).unwrap());

    // Le manifeste 2 ne couvrait que l’empreinte et le ciphertext : le swap de
    // clé restait invisible. Le manifeste 3 le détecte.
    assert_eq!(v2_before, v2_after);
    assert_ne!(v3_before, v3_after);
}

#[test]
fn couvre_les_sidecars_dans_le_manifeste_v2() {
    let file = fixture("v4-generator.coffre.json");
    let v1 = Manifest::compute_version(&file, 1).expect("manifeste 1");
    let v2 = Manifest::compute_version(&file, 2).expect("manifeste 2");
    assert_eq!(v1.manifest, 1);
    assert_eq!(v2.manifest, 2);
    assert!(
        !v1.records
            .iter()
            .any(|record| record.kind == "generator-history")
    );
    assert!(
        v2.records
            .iter()
            .any(|record| record.kind == "generator-history")
    );
}

#[test]
fn signe_et_verifie_le_manifeste_v2_avec_historique() {
    let base = fixture("v4-generator.coffre.json");
    let mut opened = open(&base, PASSWORD).expect("ouverture");
    let signed = sign(
        opened.file,
        &mut opened.session,
        Some(&base),
        "w_manifest_v2",
        "2026-11-09T15:00:00.000Z",
    )
    .expect("signature v2");
    assert_eq!(signed.generator_history.len(), 1);

    let reopened = open(&signed, PASSWORD).expect("réouverture v2");
    assert_eq!(reopened.integrity, IntegrityState::Valid);

    let mut tampered = signed;
    tampered.generator_history[0]["data"]["c"] = serde_json::json!("AAAA");
    let invalid = open(&tampered, PASSWORD).expect("ouverture altérée");
    assert_eq!(invalid.integrity, IntegrityState::Invalid);
    assert!(invalid.read_only);
}

#[test]
fn refuse_un_mauvais_mot_de_passe() {
    let file = fixture("v4.coffre.json");
    assert!(matches!(
        open(&file, "mauvais mot de passe"),
        Err(CoreError::WrongPassword)
    ));
}

#[test]
fn detecte_un_mac_global_invalide() {
    let mut file = fixture("v4.coffre.json");
    file.items[0].content.c = "AAAA".into();
    let opened = open(&file, PASSWORD).expect("ouverture en lecture seule");
    assert_eq!(opened.integrity, IntegrityState::Invalid);
    assert!(opened.read_only);
}

#[test]
fn verifie_le_rapport_de_contenu() {
    let file = fixture("v4.coffre.json");
    let opened = open(&file, PASSWORD).expect("v4");
    let report = coffre_core::verify(&file, &opened.session).expect("vérification");
    assert_eq!(report.vaults, 1);
    assert_eq!(report.items, 2);
    assert_eq!(report.attachments, 1);
    assert_eq!(report.versions, 1);
    assert!(report.signed_records > 0);
    assert_eq!(report.integrity, IntegrityState::Valid);
}

#[test]
fn ouvre_le_vecteur_genere_par_rust() {
    let path = format!(
        "{}/../../../test-vectors/rust-v4.coffre.json",
        env!("CARGO_MANIFEST_DIR")
    );
    let text = std::fs::read_to_string(path).expect("vecteur Rust lisible");
    let file = VaultFile::parse(&text).expect("vecteur Rust valide");
    let opened = open(&file, PASSWORD).expect("ouverture du vecteur Rust");
    assert_eq!(opened.integrity, IntegrityState::Valid);
    assert_eq!(opened.vaults[0].name, "Vecteur Rust");
    assert_eq!(opened.items.len(), 1);
    assert_eq!(password(&opened.items[0]), Some("s3cret-rust!"));
    assert_eq!(opened.attachments.len(), 1);
    assert_eq!(&opened.attachments[0].bytes[..], b"rust-attachment");
    assert_eq!(opened.versions.len(), 1);
    assert_eq!(
        opened.versions[0]
            .content
            .get("password")
            .and_then(|value| value.as_str()),
        Some("old-rust")
    );
}

#[test]
fn cree_modifie_supprime_et_signe_un_element() {
    let original = fixture("v4.coffre.json");
    let mut opened = open(&original, PASSWORD).expect("v4");
    let content = serde_json::json!({
        "type": "login",
        "title": "Créé par Rust",
        "favorite": false,
        "notes": "",
        "tags": [],
        "customFields": [],
        "attachments": [],
        "deletedAt": null,
        "expiresAt": "",
        "username": "rust",
        "password": "s3cret-rust",
        "urls": ["https://rust.example"],
        "totp": "",
    });
    let new_id = coffre_core::create_item(
        &mut opened.file,
        &opened.session,
        &opened.vaults[0].id,
        content.clone(),
        "2026-11-08T21:00:00.000Z",
    )
    .expect("création");

    let mut updated = content;
    updated["title"] = serde_json::json!("Créé puis modifié par Rust");
    coffre_core::update_item(
        &mut opened.file,
        &opened.session,
        &new_id,
        updated,
        "2026-11-08T21:01:00.000Z",
    )
    .expect("modification");

    let signed = coffre_core::sign(
        opened.file.clone(),
        &mut opened.session,
        Some(&original),
        "w_test_rust",
        "2026-11-08T21:02:00.000Z",
    )
    .expect("signature");
    assert!(signed.revision.unwrap_or(0) > 7);
    let reopened = open(&signed, PASSWORD).expect("réouverture");
    assert_eq!(reopened.integrity, IntegrityState::Valid);
    assert_eq!(reopened.items.len(), 3);
    assert!(reopened.items.iter().any(|item| {
        item.id == new_id
            && item.content.get("title").and_then(|value| value.as_str())
                == Some("Créé puis modifié par Rust")
    }));

    let mut deletion_file = signed.clone();
    let mut deletion_session = open(&signed, PASSWORD).expect("session").session;
    coffre_core::remove_item(&mut deletion_file, &new_id).expect("suppression");
    let deleted = coffre_core::sign(
        deletion_file,
        &mut deletion_session,
        Some(&signed),
        "w_test_rust",
        "2026-11-08T21:03:00.000Z",
    )
    .expect("signature suppression");
    assert!(
        deleted
            .tombstones
            .as_ref()
            .unwrap()
            .iter()
            .any(|tombstone| tombstone.kind == "item" && tombstone.id == new_id)
    );
    let reopened = open(&deleted, PASSWORD).expect("après suppression");
    assert!(reopened.items.iter().all(|item| item.id != new_id));
}

#[test]
fn change_le_mot_de_passe_et_reenveloppe_les_cles() {
    let original = fixture("v4.coffre.json");
    let mut opened = open(&original, PASSWORD).expect("v4");
    let new_password = "nouveau mot de passe de test solide";
    let rotated = coffre_core::rotate_password(
        &opened.file,
        &mut opened.session,
        new_password,
        &opened.file.kdf,
        "2026-11-08T21:10:00.000Z",
    )
    .expect("rotation");
    assert_eq!(rotated.key_epoch, Some(2));
    let signed = coffre_core::sign(
        rotated,
        &mut opened.session,
        Some(&original),
        "w_test_rust",
        "2026-11-08T21:11:00.000Z",
    )
    .expect("signature rotation");
    let reopened = open(&signed, new_password).expect("nouveau mot de passe");
    assert_eq!(reopened.integrity, IntegrityState::Valid);
    assert!(matches!(
        open(&signed, PASSWORD),
        Err(CoreError::WrongPassword)
    ));
}

#[test]
fn preserve_une_enveloppe_prf_lors_d_une_ecriture() {
    let mut file = fixture("v4.coffre.json");
    let prf = serde_json::json!({
        "version": 1,
        "credentialId": "cred_test",
        "salt": "AAECAwQFBgcICQoLDA0ODw==",
        "createdAt": "2026-11-08T00:00:00.000Z",
        "wrap": { "n": "AAECAwQFBgcICQoL", "c": "AAAA" }
    });
    file.prf = Some(prf.clone());
    let mut opened = open(&file, PASSWORD).expect("ouverture");
    coffre_core::create_item(
        &mut opened.file,
        &opened.session,
        &opened.vaults[0].id,
        serde_json::json!({"type":"note","title":"Note","favorite":false,"notes":"","tags":[],"customFields":[],"attachments":[],"deletedAt":null,"expiresAt":""}),
        "2026-11-08T23:30:00.000Z",
    )
    .expect("création");
    let signed = coffre_core::sign(
        opened.file,
        &mut opened.session,
        Some(&file),
        "w_prf",
        "2026-11-08T23:31:00.000Z",
    )
    .expect("signature");
    assert_eq!(signed.prf, Some(prf));
}
