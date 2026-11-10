//! Primitives cryptographiques du format Coffre.
//!
//! Les paramètres, les AAD et l’encodage sont identiques au code TypeScript :
//! Argon2id, AES-256-GCM (nonce 12 octets, tag 128 bits), base64 standard.

use aes_gcm::{
    Aes256Gcm, Nonce,
    aead::{Aead, KeyInit, Payload},
};
use argon2::{Algorithm, Argon2, Params, Version};
use base64::{Engine as _, engine::general_purpose::STANDARD};
use hmac::{Hmac, KeyInit as MacKeyInit, Mac};
use sha2::{Digest, Sha256};
use zeroize::{Zeroize, Zeroizing};

use crate::{CoreError, KdfParams};

pub const NONCE_BYTES: usize = 12;
pub const KEY_BYTES: usize = 32;
pub const MIN_MEMORY_KIB: u32 = 8_192;
pub const MAX_MEMORY_KIB: u32 = 262_144;
pub const MIN_ITERATIONS: u32 = 1;
pub const MAX_ITERATIONS: u32 = 6;
pub const MIN_PARALLELISM: u32 = 1;
pub const MAX_PARALLELISM: u32 = 8;

pub fn random_bytes(length: usize) -> Result<Vec<u8>, CoreError> {
    let mut bytes = vec![0u8; length];
    getrandom::fill(&mut bytes)
        .map_err(|_| CoreError::Crypto("source aléatoire indisponible".into()))?;
    Ok(bytes)
}

/// Identifiant aléatoire au même format que `randomId` côté TypeScript.
pub fn random_id(prefix: &str) -> Result<String, CoreError> {
    let bytes = random_bytes(16)?;
    let hex: String = bytes.iter().map(|byte| format!("{byte:02x}")).collect();
    Ok(if prefix.is_empty() {
        hex
    } else {
        format!("{prefix}_{hex}")
    })
}

pub fn to_base64(bytes: &[u8]) -> String {
    STANDARD.encode(bytes)
}

pub fn from_base64(value: &str) -> Result<Vec<u8>, CoreError> {
    STANDARD
        .decode(value)
        .map_err(|_| CoreError::InvalidFormat("base64 invalide".into()))
}

pub fn validate_kdf(params: &KdfParams) -> Result<(), CoreError> {
    if params.algorithm != "argon2id" || params.key_length != KEY_BYTES {
        return Err(CoreError::InvalidFormat("paramètres KDF invalides".into()));
    }
    if !(MIN_MEMORY_KIB..=MAX_MEMORY_KIB).contains(&params.memory_kib)
        || !(MIN_ITERATIONS..=MAX_ITERATIONS).contains(&params.iterations)
        || !(MIN_PARALLELISM..=MAX_PARALLELISM).contains(&params.parallelism)
    {
        return Err(CoreError::InvalidFormat(
            "paramètres KDF hors limites de sécurité".into(),
        ));
    }
    Ok(())
}

pub fn derive_master_key(
    password: &str,
    params: &KdfParams,
) -> Result<Zeroizing<Vec<u8>>, CoreError> {
    validate_kdf(params)?;
    let salt = from_base64(&params.salt)?;
    let argon_params = Params::new(
        params.memory_kib,
        params.iterations,
        params.parallelism,
        Some(KEY_BYTES),
    )
    .map_err(|_| CoreError::InvalidFormat("paramètres Argon2id invalides".into()))?;
    let argon = Argon2::new(Algorithm::Argon2id, Version::V0x13, argon_params);
    let mut key = Zeroizing::new(vec![0u8; KEY_BYTES]);
    argon
        .hash_password_into(password.as_bytes(), &salt, key.as_mut_slice())
        .map_err(|_| CoreError::Crypto("dérivation Argon2id impossible".into()))?;
    Ok(key)
}

fn cipher(key: &[u8]) -> Result<Aes256Gcm, CoreError> {
    if key.len() != KEY_BYTES {
        return Err(CoreError::Crypto("clé AES invalide".into()));
    }
    Aes256Gcm::new_from_slice(key).map_err(|_| CoreError::Crypto("clé AES invalide".into()))
}

pub fn seal_bytes_with_nonce(
    plaintext: &[u8],
    key: &[u8],
    aad: &str,
    nonce: &[u8; NONCE_BYTES],
) -> Result<SealedValue, CoreError> {
    let cipher = cipher(key)?;
    let encrypted = cipher
        .encrypt(
            &Nonce::from(*nonce),
            Payload {
                msg: plaintext,
                aad: aad.as_bytes(),
            },
        )
        .map_err(|_| CoreError::Crypto("chiffrement AES-GCM impossible".into()))?;
    Ok(SealedValue {
        n: to_base64(nonce),
        c: to_base64(&encrypted),
    })
}

pub fn seal_bytes(plaintext: &[u8], key: &[u8], aad: &str) -> Result<SealedValue, CoreError> {
    let mut nonce = [0u8; NONCE_BYTES];
    getrandom::fill(&mut nonce)
        .map_err(|_| CoreError::Crypto("source aléatoire indisponible".into()))?;
    seal_bytes_with_nonce(plaintext, key, aad, &nonce)
}

pub fn open_bytes(
    sealed: &SealedValue,
    key: &[u8],
    aad: &str,
) -> Result<Zeroizing<Vec<u8>>, CoreError> {
    let cipher = cipher(key)?;
    let nonce = from_base64(&sealed.n)?;
    if nonce.len() != NONCE_BYTES {
        return Err(CoreError::InvalidFormat("nonce AES invalide".into()));
    }
    let nonce = Nonce::try_from(nonce.as_slice())
        .map_err(|_| CoreError::InvalidFormat("nonce AES invalide".into()))?;
    let ciphertext = from_base64(&sealed.c)?;
    let plaintext = cipher
        .decrypt(
            &nonce,
            Payload {
                msg: &ciphertext,
                aad: aad.as_bytes(),
            },
        )
        .map_err(|_| CoreError::Crypto("déchiffrement AES-GCM impossible".into()))?;
    Ok(Zeroizing::new(plaintext))
}

pub fn sha256(bytes: &[u8]) -> Vec<u8> {
    Sha256::digest(bytes).to_vec()
}

pub fn hmac_sha256(key: &[u8], message: &[u8]) -> Result<Vec<u8>, CoreError> {
    let mut mac = <Hmac<Sha256> as MacKeyInit>::new_from_slice(key)
        .map_err(|_| CoreError::Crypto("clé HMAC invalide".into()))?;
    mac.update(message);
    Ok(mac.finalize().into_bytes().to_vec())
}

pub fn constant_time_eq(left: &[u8], right: &[u8]) -> bool {
    if left.len() != right.len() {
        return false;
    }
    let mut difference = 0u8;
    for (a, b) in left.iter().zip(right) {
        difference |= a ^ b;
    }
    difference == 0
}

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct SealedValue {
    pub n: String,
    pub c: String,
}

impl SealedValue {
    pub fn digest_input(&self) -> Vec<u8> {
        format!("{}.{}", self.n, self.c).into_bytes()
    }
}

impl Zeroize for SealedValue {
    fn zeroize(&mut self) {
        self.n.zeroize();
        self.c.zeroize();
    }
}

pub fn vault_key_aad(vault_id: &str) -> String {
    format!("coffre:v1:vault-key:{vault_id}")
}
pub fn vault_meta_aad(vault_id: &str) -> String {
    format!("coffre:v1:vault-meta:{vault_id}")
}
pub fn item_key_aad(vault_id: &str, item_id: &str) -> String {
    format!("coffre:v1:item-key:{vault_id}:{item_id}")
}
pub fn item_content_aad(vault_id: &str, item_id: &str) -> String {
    format!("coffre:v1:item-content:{vault_id}:{item_id}")
}
pub fn item_version_aad(vault_id: &str, item_id: &str, version_id: &str) -> String {
    format!("coffre:v1:item-version:{vault_id}:{item_id}:{version_id}")
}
pub fn item_attachment_aad(vault_id: &str, item_id: &str, attachment_id: &str) -> String {
    format!("coffre:v1:item-attachment:{vault_id}:{item_id}:{attachment_id}")
}
pub fn integrity_key_aad() -> &'static str {
    "coffre:v1:integrity-key"
}
pub fn recovery_guard_aad() -> &'static str {
    "coffre:v1:recovery-guard"
}
