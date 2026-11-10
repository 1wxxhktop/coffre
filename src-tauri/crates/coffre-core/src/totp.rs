//! TOTP RFC 6238, partagé par le CLI et la révélation AutoFill.
//!
//! Le secret reste dans un `Zeroizing` et n’est jamais journalisé.

use hmac::{Hmac, KeyInit, Mac};
use sha1::Sha1;
use sha2::{Sha256, Sha512};
use zeroize::Zeroizing;

use crate::CoreError;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TotpAlgorithm {
    Sha1,
    Sha256,
    Sha512,
}

#[derive(Debug)]
pub struct TotpConfig {
    secret: Zeroizing<Vec<u8>>,
    algorithm: TotpAlgorithm,
    period: u32,
    digits: u32,
}

fn base32_decode(value: &str) -> Result<Vec<u8>, CoreError> {
    const ALPHABET: &[u8; 32] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    let mut buffer = 0u32;
    let mut bits = 0u8;
    let mut output = Vec::new();
    for raw in value.bytes() {
        if raw == b'=' || raw == b' ' || raw == b'-' {
            continue;
        }
        let byte = raw.to_ascii_uppercase();
        let Some(index) = ALPHABET.iter().position(|candidate| *candidate == byte) else {
            return Err(CoreError::InvalidFormat(
                "secret TOTP base32 invalide".into(),
            ));
        };
        buffer = (buffer << 5) | index as u32;
        bits += 5;
        if bits >= 8 {
            bits -= 8;
            output.push((buffer >> bits) as u8);
        }
    }
    if output.is_empty() {
        return Err(CoreError::InvalidFormat("secret TOTP vide".into()));
    }
    Ok(output)
}

/// Lit une URI `otpauth://totp/…`.
pub fn parse_totp_uri(uri: &str) -> Result<TotpConfig, CoreError> {
    let Some(rest) = uri.strip_prefix("otpauth://totp/") else {
        return Err(CoreError::InvalidFormat("URI TOTP invalide".into()));
    };
    let query = rest
        .split_once('?')
        .map(|(_, query)| query)
        .ok_or_else(|| CoreError::InvalidFormat("URI TOTP sans paramètres".into()))?;
    let mut secret = None;
    let mut algorithm = TotpAlgorithm::Sha1;
    let mut period = 30u32;
    let mut digits = 6u32;
    for pair in query.split('&') {
        let Some((key, value)) = pair.split_once('=') else {
            continue;
        };
        match key.to_ascii_lowercase().as_str() {
            "secret" => secret = Some(base32_decode(value)?),
            "algorithm" => {
                algorithm = match value.to_ascii_uppercase().as_str() {
                    "SHA1" => TotpAlgorithm::Sha1,
                    "SHA256" => TotpAlgorithm::Sha256,
                    "SHA512" => TotpAlgorithm::Sha512,
                    _ => {
                        return Err(CoreError::InvalidFormat(
                            "algorithme TOTP non pris en charge".into(),
                        ));
                    }
                }
            }
            "period" => {
                period = value
                    .parse()
                    .map_err(|_| CoreError::InvalidFormat("période TOTP invalide".into()))?
            }
            "digits" => {
                digits = value.parse().map_err(|_| {
                    CoreError::InvalidFormat("nombre de chiffres TOTP invalide".into())
                })?
            }
            _ => {}
        }
    }
    if !(1..=10).contains(&digits) || !(1..=300).contains(&period) {
        return Err(CoreError::InvalidFormat(
            "paramètres TOTP hors limites".into(),
        ));
    }
    let secret = secret.ok_or_else(|| CoreError::InvalidFormat("secret TOTP absent".into()))?;
    Ok(TotpConfig {
        secret: Zeroizing::new(secret),
        algorithm,
        period,
        digits,
    })
}

impl TotpConfig {
    /// Code TOTP pour un horodatage Unix en secondes.
    pub fn code_at(&self, unix_time: u64) -> Result<String, CoreError> {
        let counter = unix_time / u64::from(self.period);
        let message = counter.to_be_bytes();
        let digest = match self.algorithm {
            TotpAlgorithm::Sha1 => {
                let mut mac = <Hmac<Sha1> as KeyInit>::new_from_slice(&self.secret)
                    .map_err(|_| CoreError::Crypto("clé TOTP invalide".into()))?;
                mac.update(&message);
                mac.finalize().into_bytes().to_vec()
            }
            TotpAlgorithm::Sha256 => {
                let mut mac = <Hmac<Sha256> as KeyInit>::new_from_slice(&self.secret)
                    .map_err(|_| CoreError::Crypto("clé TOTP invalide".into()))?;
                mac.update(&message);
                mac.finalize().into_bytes().to_vec()
            }
            TotpAlgorithm::Sha512 => {
                let mut mac = <Hmac<Sha512> as KeyInit>::new_from_slice(&self.secret)
                    .map_err(|_| CoreError::Crypto("clé TOTP invalide".into()))?;
                mac.update(&message);
                mac.finalize().into_bytes().to_vec()
            }
        };
        let offset = (digest[digest.len() - 1] & 0x0f) as usize;
        let binary = u32::from_be_bytes([
            digest[offset],
            digest[offset + 1],
            digest[offset + 2],
            digest[offset + 3],
        ]) & 0x7fff_ffff;
        let modulo = 10u64.pow(self.digits);
        Ok(format!(
            "{:0width$}",
            u64::from(binary) % modulo,
            width = self.digits as usize
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decode_base32_et_totp_rfc() {
        let config =
            parse_totp_uri("otpauth://totp/Test?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&digits=8")
                .unwrap();
        assert_eq!(config.code_at(59).unwrap(), "94287082");
    }

    #[test]
    fn refuse_les_parametres_hors_limites() {
        assert!(parse_totp_uri("otpauth://totp/T?secret=JBSWY3DPEHPK3PXP&digits=0").is_err());
        assert!(parse_totp_uri("otpauth://totp/T?secret=JBSWY3DPEHPK3PXP&period=0").is_err());
        assert!(parse_totp_uri("https://example.com").is_err());
    }
}
