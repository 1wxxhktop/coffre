use coffre_core::login_allows_host;
use serde::Deserialize;

#[derive(Deserialize)]
struct Vectors {
    cases: Vec<Case>,
}

#[derive(Deserialize)]
struct Case {
    #[serde(rename = "itemUrl")]
    item_url: String,
    service: String,
    allowed: bool,
    note: String,
}

fn vectors() -> Vectors {
    let path = format!(
        "{}/../../../test-vectors/domain-matching.json",
        env!("CARGO_MANIFEST_DIR")
    );
    serde_json::from_str(&std::fs::read_to_string(path).expect("vecteurs lisibles"))
        .expect("vecteurs valides")
}

#[test]
fn correspond_aux_vecteurs_typescript() {
    let vectors = vectors();
    assert!(vectors.cases.len() >= 40);
    for case in vectors.cases {
        assert_eq!(
            login_allows_host(&case.item_url, &case.service),
            case.allowed,
            "{} ↔ {} : {}",
            case.item_url,
            case.service,
            case.note
        );
    }
}
