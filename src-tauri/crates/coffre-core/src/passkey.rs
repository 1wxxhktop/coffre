//! Passkeys WebAuthn ES256, partagées par l’application et les extensions
//! natives.
//!
//! Les mêmes validations que `src/lib/passkeys.ts` sont appliquées : RP ID
//! lié à l’origine sécurisée, challenge base64url, clé privée PKCS#8 et
//! signature DER. Aucun secret n’est journalisé.

use base64::Engine;
use base64::engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD};
use p256::ecdsa::signature::{Signer, Verifier};
use p256::ecdsa::{Signature, SigningKey, VerifyingKey};
use p256::pkcs8::{DecodePrivateKey, EncodePrivateKey};
use serde::Deserialize;
use url::Url;
use zeroize::Zeroizing;

use crate::domain::{is_ip_address, is_public_suffix};
use crate::{CoreError, sha256};

const AAGUID: [u8; 16] = [
    0xc0, 0xff, 0xee, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01,
];

#[derive(Debug)]
pub struct CreatedPasskey {
    pub credential_id: String,
    pub user_handle: String,
    pub private_key: String,
    pub public_key_cose: String,
    pub client_data_json: String,
    pub authenticator_data: String,
    pub attestation_object: String,
    pub sign_count: u32,
}

#[derive(Debug)]
pub struct PasskeyAssertion {
    pub credential_id: String,
    pub user_handle: String,
    pub client_data_json: String,
    pub authenticator_data: String,
    pub signature: String,
    pub sign_count: u32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredPasskey {
    #[serde(rename = "type")]
    pub kind: String,
    pub rp_id: String,
    pub user_handle: String,
    pub credential_id: String,
    pub private_key: String,
    #[serde(default)]
    pub sign_count: u32,
}

fn to_base64url(bytes: &[u8]) -> String {
    URL_SAFE_NO_PAD.encode(bytes)
}

fn from_base64url(value: &str) -> Result<Vec<u8>, CoreError> {
    if value.is_empty()
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err(CoreError::InvalidFormat("base64url invalide".into()));
    }
    URL_SAFE_NO_PAD
        .decode(value)
        .map_err(|_| CoreError::InvalidFormat("base64url invalide".into()))
}

fn random_bytes(length: usize) -> Result<Vec<u8>, CoreError> {
    let mut bytes = vec![0u8; length];
    getrandom::fill(&mut bytes)
        .map_err(|_| CoreError::Crypto("générateur aléatoire indisponible".into()))?;
    Ok(bytes)
}

fn secure_origin(origin: &str) -> Result<Url, CoreError> {
    let url = Url::parse(origin)
        .map_err(|_| CoreError::InvalidFormat("origine WebAuthn invalide".into()))?;
    let local = matches!(url.host_str(), Some("localhost") | Some("127.0.0.1"));
    if url.scheme() != "https" && !(url.scheme() == "http" && local) {
        return Err(CoreError::InvalidFormat(
            "WebAuthn exige une origine sécurisée (HTTPS ou localhost).".into(),
        ));
    }
    Ok(url)
}

/// Vérifie que `rp_id` est l’hôte de l’origine ou un parent enregistrable.
pub fn validate_rp_id(rp_id: &str, origin: &str) -> Result<String, CoreError> {
    let value = rp_id.trim().to_lowercase();
    if value.is_empty() || value.len() > 253 || value.contains('/') {
        return Err(CoreError::InvalidFormat("RP ID invalide".into()));
    }
    if is_ip_address(&value) || is_public_suffix(&value) {
        return Err(CoreError::InvalidFormat("RP ID non autorisé".into()));
    }
    if value != "localhost" && !value.contains('.') {
        return Err(CoreError::InvalidFormat("RP ID non autorisé".into()));
    }
    let url = secure_origin(origin)?;
    let host = url
        .host_str()
        .ok_or_else(|| CoreError::InvalidFormat("origine WebAuthn invalide".into()))?
        .trim_end_matches('.')
        .to_lowercase();
    if value == host || host.ends_with(&format!(".{value}")) {
        Ok(value)
    } else {
        Err(CoreError::InvalidFormat(
            "RP ID non autorisé pour cette origine".into(),
        ))
    }
}

fn validate_challenge(challenge: &str) -> Result<(), CoreError> {
    from_base64url(challenge).map(|_| ())
}

fn client_data_json(kind: &str, challenge: &str, origin: &str) -> Result<Vec<u8>, CoreError> {
    let challenge = serde_json::to_string(challenge)
        .map_err(|_| CoreError::InvalidFormat("challenge WebAuthn invalide".into()))?;
    let origin = serde_json::to_string(origin)
        .map_err(|_| CoreError::InvalidFormat("origine WebAuthn invalide".into()))?;
    Ok(format!(
        "{{\"type\":\"{kind}\",\"challenge\":{challenge},\"origin\":{origin},\"crossOrigin\":false}}"
    )
    .into_bytes())
}

fn cbor_head(major: u8, length: u64, output: &mut Vec<u8>) {
    if length < 24 {
        output.push((major << 5) | length as u8);
    } else if length < 0x100 {
        output.push((major << 5) | 24);
        output.push(length as u8);
    } else if length < 0x10000 {
        output.push((major << 5) | 25);
        output.extend_from_slice(&(length as u16).to_be_bytes());
    } else {
        output.push((major << 5) | 26);
        output.extend_from_slice(&(length as u32).to_be_bytes());
    }
}

fn cbor_uint(value: u64, output: &mut Vec<u8>) {
    cbor_head(0, value, output);
}

fn cbor_int(value: i64, output: &mut Vec<u8>) {
    if value >= 0 {
        cbor_uint(value as u64, output);
    } else {
        cbor_head(1, (-1 - value) as u64, output);
    }
}

fn cbor_bytes(value: &[u8], output: &mut Vec<u8>) {
    cbor_head(2, value.len() as u64, output);
    output.extend_from_slice(value);
}

fn cbor_text(value: &str, output: &mut Vec<u8>) {
    cbor_head(3, value.len() as u64, output);
    output.extend_from_slice(value.as_bytes());
}

fn cbor_map(length: u64, output: &mut Vec<u8>) {
    cbor_head(5, length, output);
}

fn cose_public_key(public_key: &[u8]) -> Result<Vec<u8>, CoreError> {
    if public_key.len() != 65 || public_key[0] != 0x04 {
        return Err(CoreError::Crypto("clé publique P-256 invalide".into()));
    }
    let mut output = Vec::new();
    cbor_map(5, &mut output);
    cbor_uint(1, &mut output);
    cbor_uint(2, &mut output);
    cbor_uint(3, &mut output);
    cbor_int(-7, &mut output);
    cbor_int(-1, &mut output);
    cbor_uint(1, &mut output);
    cbor_int(-2, &mut output);
    cbor_bytes(&public_key[1..33], &mut output);
    cbor_int(-3, &mut output);
    cbor_bytes(&public_key[33..65], &mut output);
    Ok(output)
}

fn attestation_object(auth_data: &[u8]) -> Vec<u8> {
    let mut output = Vec::new();
    cbor_map(3, &mut output);
    cbor_text("fmt", &mut output);
    cbor_text("none", &mut output);
    cbor_text("attStmt", &mut output);
    cbor_map(0, &mut output);
    cbor_text("authData", &mut output);
    cbor_bytes(auth_data, &mut output);
    output
}

/// Crée une paire P-256 et les données d’attestation `none`.
pub fn create_passkey(
    rp_id: &str,
    origin: &str,
    challenge: &str,
    user_handle: Option<&str>,
) -> Result<CreatedPasskey, CoreError> {
    let rp_id = validate_rp_id(rp_id, origin)?;
    validate_challenge(challenge)?;
    let user_handle = match user_handle {
        Some(value) => {
            from_base64url(value)?;
            if value.len() > 500 {
                return Err(CoreError::InvalidFormat(
                    "identifiant utilisateur WebAuthn invalide".into(),
                ));
            }
            value.to_string()
        }
        None => to_base64url(&random_bytes(16)?),
    };
    let credential_id_bytes = random_bytes(32)?;
    let credential_id = to_base64url(&credential_id_bytes);

    let mut secret = Zeroizing::new([0u8; 32]);
    getrandom::fill(&mut secret[..])
        .map_err(|_| CoreError::Crypto("générateur aléatoire indisponible".into()))?;
    let signing_key = SigningKey::from_slice(&secret[..])
        .map_err(|_| CoreError::Crypto("clé P-256 invalide".into()))?;
    let private_der = signing_key
        .to_pkcs8_der()
        .map_err(|_| CoreError::Crypto("export PKCS#8 impossible".into()))?;
    let private_key = STANDARD.encode(private_der.as_bytes());
    let public_key = signing_key.verifying_key().to_sec1_point(false);
    let public_key = public_key.as_bytes();
    let public_key_cose = STANDARD.encode(cose_public_key(public_key)?);

    let rp_hash = sha256(rp_id.as_bytes());
    let mut authenticator_data = Vec::with_capacity(37 + 16 + 2 + credential_id_bytes.len() + 77);
    authenticator_data.extend_from_slice(&rp_hash);
    // UP | AT | BE | BS
    authenticator_data.push(0x59);
    authenticator_data.extend_from_slice(&0u32.to_be_bytes());
    authenticator_data.extend_from_slice(&AAGUID);
    authenticator_data.extend_from_slice(&(credential_id_bytes.len() as u16).to_be_bytes());
    authenticator_data.extend_from_slice(&credential_id_bytes);
    authenticator_data.extend_from_slice(&cose_public_key(public_key)?);

    let client_data = client_data_json("webauthn.create", challenge, origin)?;
    let attestation = attestation_object(&authenticator_data);

    Ok(CreatedPasskey {
        credential_id,
        user_handle,
        private_key,
        public_key_cose,
        client_data_json: to_base64url(&client_data),
        authenticator_data: to_base64url(&authenticator_data),
        attestation_object: to_base64url(&attestation),
        sign_count: 0,
    })
}

/// Signe une assertion avec la clé privée d’une passkey stockée.
pub fn assert_passkey(
    item: &StoredPasskey,
    rp_id: &str,
    origin: &str,
    challenge: &str,
) -> Result<PasskeyAssertion, CoreError> {
    if item.kind != "passkey" {
        return Err(CoreError::InvalidFormat("élément passkey attendu".into()));
    }
    let rp_id = validate_rp_id(rp_id, origin)?;
    if item.rp_id.to_lowercase() != rp_id {
        return Err(CoreError::InvalidFormat(
            "cette passkey n’appartient pas à ce domaine".into(),
        ));
    }
    validate_challenge(challenge)?;
    let private_der = STANDARD
        .decode(&item.private_key)
        .map_err(|_| CoreError::InvalidFormat("clé privée PKCS#8 invalide".into()))?;
    let signing_key = SigningKey::from_pkcs8_der(&private_der)
        .map_err(|_| CoreError::InvalidFormat("clé privée PKCS#8 invalide".into()))?;

    let rp_hash = sha256(item.rp_id.to_lowercase().as_bytes());
    let mut authenticator_data = Vec::with_capacity(37);
    authenticator_data.extend_from_slice(&rp_hash);
    authenticator_data.push(0x01);
    authenticator_data.extend_from_slice(&item.sign_count.to_be_bytes());
    let client_data = client_data_json("webauthn.get", challenge, origin)?;
    let client_hash = sha256(&client_data);
    let mut message = authenticator_data.clone();
    message.extend_from_slice(&client_hash);
    let signature: Signature = signing_key.sign(&message);

    Ok(PasskeyAssertion {
        credential_id: item.credential_id.clone(),
        user_handle: item.user_handle.clone(),
        client_data_json: to_base64url(&client_data),
        authenticator_data: to_base64url(&authenticator_data),
        signature: to_base64url(signature.to_der().as_bytes()),
        sign_count: item.sign_count,
    })
}

/// Vérifie une assertion DER sur `authenticatorData || SHA-256(clientData)`.
pub fn verify_assertion(
    public_key_pkcs8: &str,
    authenticator_data: &[u8],
    client_data_json: &[u8],
    signature_der: &[u8],
) -> Result<(), CoreError> {
    let private_der = STANDARD
        .decode(public_key_pkcs8)
        .map_err(|_| CoreError::InvalidFormat("clé privée PKCS#8 invalide".into()))?;
    let signing_key = SigningKey::from_pkcs8_der(&private_der)
        .map_err(|_| CoreError::InvalidFormat("clé privée PKCS#8 invalide".into()))?;
    let verifying_key: &VerifyingKey = signing_key.verifying_key();
    let signature = Signature::from_der(signature_der)
        .map_err(|_| CoreError::InvalidFormat("signature DER invalide".into()))?;
    let client_hash = sha256(client_data_json);
    let mut message = authenticator_data.to_vec();
    message.extend_from_slice(&client_hash);
    verifying_key
        .verify(&message, &signature)
        .map_err(|_| CoreError::Crypto("signature passkey invalide".into()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cree_et_verifie_une_assertion() {
        let created = create_passkey(
            "example.com",
            "https://login.example.com",
            "Y2hhbGxlbmdl",
            Some("dXNlcg"),
        )
        .expect("création");
        let item = StoredPasskey {
            kind: "passkey".into(),
            rp_id: "example.com".into(),
            user_handle: created.user_handle.clone(),
            credential_id: created.credential_id.clone(),
            private_key: created.private_key.clone(),
            sign_count: 0,
        };
        let assertion = assert_passkey(
            &item,
            "example.com",
            "https://login.example.com",
            "Y2hhbGxlbmdl",
        )
        .expect("assertion");
        let authenticator_data = URL_SAFE_NO_PAD
            .decode(&assertion.authenticator_data)
            .unwrap();
        let client_data = URL_SAFE_NO_PAD.decode(&assertion.client_data_json).unwrap();
        let signature = URL_SAFE_NO_PAD.decode(&assertion.signature).unwrap();
        verify_assertion(
            &created.private_key,
            &authenticator_data,
            &client_data,
            &signature,
        )
        .expect("signature valide");
    }

    #[test]
    fn refuse_un_rp_id_non_correspondant() {
        assert!(validate_rp_id("evil.example", "https://example.com").is_err());
        assert!(validate_rp_id("com", "https://example.com").is_err());
        assert!(validate_rp_id("example.com", "http://example.com").is_err());
        assert!(validate_rp_id("example.com", "https://login.example.com").is_ok());
    }
}
