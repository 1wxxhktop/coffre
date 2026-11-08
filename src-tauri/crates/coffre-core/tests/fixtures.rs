use coffre_core::{CoreError, IntegrityState, VaultFile, open};

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
