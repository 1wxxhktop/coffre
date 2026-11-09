use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use coffre_core::{StoredPasskey, assert_passkey, verify_assertion};
use serde_json::Value;

fn vector() -> Value {
    let path = format!(
        "{}/../../../test-vectors/passkeys.json",
        env!("CARGO_MANIFEST_DIR")
    );
    serde_json::from_str(&std::fs::read_to_string(path).expect("vecteur lisible"))
        .expect("vecteur valide")
}

fn decode(value: &Value, field: &str) -> Vec<u8> {
    URL_SAFE_NO_PAD
        .decode(value[field].as_str().expect(field))
        .expect("base64url")
}

#[test]
fn verifie_les_signatures_typescript_et_rust() {
    let vector = vector();
    let private_key = vector["privateKey"].as_str().expect("privateKey");
    for side in ["tsAssertion", "rustAssertion"] {
        let assertion = &vector[side];
        verify_assertion(
            private_key,
            &decode(assertion, "authenticatorData"),
            &decode(assertion, "clientDataJSON"),
            &decode(assertion, "signature"),
        )
        .unwrap_or_else(|error| panic!("{side} invalide : {error}"));
    }
}

#[test]
fn signe_une_assertion_avec_la_meme_cle() {
    let vector = vector();
    let item = StoredPasskey {
        kind: "passkey".into(),
        rp_id: vector["rpId"].as_str().unwrap().into(),
        user_handle: vector["userHandle"].as_str().unwrap().into(),
        credential_id: vector["credentialId"].as_str().unwrap().into(),
        private_key: vector["privateKey"].as_str().unwrap().into(),
        sign_count: vector["signCount"].as_u64().unwrap_or(0) as u32,
    };
    let assertion = assert_passkey(
        &item,
        vector["rpId"].as_str().unwrap(),
        vector["origin"].as_str().unwrap(),
        vector["challenge"].as_str().unwrap(),
    )
    .expect("assertion");
    verify_assertion(
        &item.private_key,
        &URL_SAFE_NO_PAD
            .decode(&assertion.authenticator_data)
            .unwrap(),
        &URL_SAFE_NO_PAD.decode(&assertion.client_data_json).unwrap(),
        &URL_SAFE_NO_PAD.decode(&assertion.signature).unwrap(),
    )
    .expect("signature Rust valide");
}
