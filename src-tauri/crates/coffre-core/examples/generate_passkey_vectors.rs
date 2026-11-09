//! Génère les vecteurs croisés de passkeys à partir d’un fichier JSON
//! contenant la clé privée de test et les données d’une assertion TypeScript.
//!
//! Usage : cargo run -p coffre-core --example generate_passkey_vectors -- entree.json > sortie.json

use coffre_core::{StoredPasskey, assert_passkey, create_passkey};
use serde_json::Value;

fn main() {
    let path = std::env::args()
        .nth(1)
        .expect("chemin du JSON d’entrée attendu");
    let text = std::fs::read_to_string(path).expect("fichier lisible");
    let mut input: Value = serde_json::from_str(&text).expect("JSON valide");
    let rp_id = input["rpId"].as_str().expect("rpId");
    let origin = input["origin"].as_str().expect("origin");
    let challenge = input["challenge"].as_str().expect("challenge");
    let user_handle = input["userHandle"].as_str().expect("userHandle");
    let private_key = input["privateKey"].as_str().expect("privateKey");
    let credential_id = input["credentialId"].as_str().expect("credentialId");
    let item = StoredPasskey {
        kind: "passkey".into(),
        rp_id: rp_id.to_string(),
        user_handle: user_handle.to_string(),
        credential_id: credential_id.to_string(),
        private_key: private_key.to_string(),
        sign_count: 0,
    };
    let assertion = assert_passkey(&item, rp_id, origin, challenge).expect("assertion Rust");
    let created =
        create_passkey(rp_id, origin, challenge, Some(user_handle)).expect("création Rust");
    input["rustAssertion"] = serde_json::json!({
        "clientDataJSON": assertion.client_data_json,
        "authenticatorData": assertion.authenticator_data,
        "signature": assertion.signature,
    });
    input["rustCreate"] = serde_json::json!({
        "credentialId": created.credential_id,
        "userHandle": created.user_handle,
        "privateKey": created.private_key,
        "publicKeyCose": created.public_key_cose,
        "clientDataJSON": created.client_data_json,
        "authenticatorData": created.authenticator_data,
        "attestationObject": created.attestation_object,
        "signCount": created.sign_count,
    });
    println!("{}", serde_json::to_string_pretty(&input).expect("JSON"));
}
