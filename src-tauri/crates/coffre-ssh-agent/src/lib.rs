//! Noyau de l’agent SSH de Coffre.
//!
//! Le crate ne gère ni le déverrouillage du coffre ni l’interface
//! d’approbation : il reçoit des identités déjà déchiffrées et un callback
//! d’approbation, puis sert le protocole `SSH_AUTH_SOCK`. Chaque demande de
//! signature passe obligatoirement par ce callback avant d’utiliser la clé.
//!
//! Aucune clé privée, aucun tampon de signature et aucune donnée à signer ne
//! sont journalisés.

use ed25519_dalek::Signer as _;
use rsa::RsaPrivateKey;
use rsa::pkcs1v15::SigningKey as RsaSigningKey;
use rsa::signature::SignatureEncoding;
use rsa::traits::PublicKeyParts;
use sha2::{Sha256, Sha512};
use ssh_key::private::{KeypairData, RsaKeypair};
use ssh_key::{HashAlg, PrivateKey, PublicKey};
use std::fmt;
use std::io::{self, Read, Write};
use std::sync::Arc;
use zeroize::Zeroizing;

/// Taille maximale d’un message agent, en octets.
pub const MAX_MESSAGE_SIZE: usize = 256 * 1024;

const SSH_AGENT_FAILURE: u8 = 5;
const SSH_AGENTC_REQUEST_IDENTITIES: u8 = 11;
const SSH_AGENT_IDENTITIES_ANSWER: u8 = 12;
const SSH_AGENTC_SIGN_REQUEST: u8 = 13;
const SSH_AGENT_SIGN_RESPONSE: u8 = 14;
/// Demande une signature RSA PKCS#1 v1.5 avec SHA-256.
pub const SSH_AGENT_RSA_SHA2_256: u32 = 2;
/// Demande une signature RSA PKCS#1 v1.5 avec SHA-512.
pub const SSH_AGENT_RSA_SHA2_512: u32 = 4;

/// Erreur publique du noyau, sans secret ni contenu de clé.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum SshAgentError {
    InvalidKey(String),
    EncryptedKey,
    UnsupportedKey(String),
    MismatchedPublicKey,
    InvalidMessage(String),
}

impl fmt::Display for SshAgentError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidKey(message) => write!(formatter, "clé SSH invalide : {message}"),
            Self::EncryptedKey => write!(
                formatter,
                "les clés SSH chiffrées ne sont pas prises en charge"
            ),
            Self::UnsupportedKey(algorithm) => {
                write!(formatter, "algorithme SSH non pris en charge : {algorithm}")
            }
            Self::MismatchedPublicKey => {
                write!(
                    formatter,
                    "la clé publique ne correspond pas à la clé privée"
                )
            }
            Self::InvalidMessage(message) => {
                write!(formatter, "message agent invalide : {message}")
            }
        }
    }
}

impl std::error::Error for SshAgentError {}

/// Demande d’approbation présentée à l’utilisateur avant une signature.
#[derive(Clone, Debug)]
pub struct ApprovalRequest {
    /// Commentaire de l’élément, sans secret.
    pub comment: String,
    /// Empreinte SHA-256 de la clé publique.
    pub fingerprint: String,
    /// Algorithme de la clé.
    pub algorithm: String,
    /// Données exactes qui seront signées.
    pub data: Zeroizing<Vec<u8>>,
}

/// Callback d’approbation. Il doit être bloquant et rendre une décision
/// explicite pour chaque signature.
pub trait Approval: Send + Sync {
    fn approve(&self, request: &ApprovalRequest) -> bool;
}

impl<F> Approval for F
where
    F: for<'a> Fn(&'a ApprovalRequest) -> bool + Send + Sync,
{
    fn approve(&self, request: &ApprovalRequest) -> bool {
        self(request)
    }
}

enum KeyMaterial {
    Ed25519(ed25519_dalek::SigningKey),
    Rsa(RsaPrivateKey),
}

impl fmt::Debug for KeyMaterial {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("KeyMaterial(…)")
    }
}

/// Identité SSH déchiffrée, prête à signer.
pub struct Identity {
    comment: String,
    public_key: PublicKey,
    material: KeyMaterial,
}

impl fmt::Debug for Identity {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("Identity")
            .field("comment", &self.comment)
            .field("fingerprint", &self.fingerprint())
            .finish_non_exhaustive()
    }
}

impl Identity {
    /// Construit une identité depuis une clé privée OpenSSH non chiffrée.
    pub fn from_openssh(private_key: &str, comment: &str) -> Result<Self, SshAgentError> {
        if private_key.contains("sk-ssh-ed25519") || private_key.contains("sk-ecdsa-") {
            return Err(SshAgentError::UnsupportedKey(
                "clé FIDO2 (sk-ssh-*), signature matérielle non prise en charge".into(),
            ));
        }
        let key = PrivateKey::from_openssh(private_key)
            .map_err(|error| SshAgentError::InvalidKey(error.to_string()))?;
        if key.is_encrypted() {
            return Err(SshAgentError::EncryptedKey);
        }
        let material = match key.key_data() {
            KeypairData::Ed25519(keypair) => {
                KeyMaterial::Ed25519(ed25519_dalek::SigningKey::from(&keypair.private))
            }
            KeypairData::Rsa(keypair) => KeyMaterial::Rsa(rsa_private_key(keypair)?),
            other => {
                return Err(SshAgentError::UnsupportedKey(
                    other
                        .algorithm()
                        .map(|algorithm| algorithm.to_string())
                        .unwrap_or_else(|_| "inconnu".into()),
                ));
            }
        };
        let comment = if comment.trim().is_empty() {
            key.comment().to_string()
        } else {
            comment.trim().to_string()
        };
        Ok(Self {
            comment,
            public_key: key.public_key().clone(),
            material,
        })
    }

    /// Construit une identité depuis le contenu déchiffré d’un élément
    /// `ssh-key` du coffre.
    pub fn from_item(content: &serde_json::Value) -> Result<Self, SshAgentError> {
        if content.get("type").and_then(|value| value.as_str()) != Some("ssh-key") {
            return Err(SshAgentError::InvalidKey(
                "l’élément n’est pas de type ssh-key".into(),
            ));
        }
        if content
            .get("deletedAt")
            .and_then(|value| value.as_str())
            .is_some()
        {
            return Err(SshAgentError::InvalidKey("élément supprimé".into()));
        }
        let private_key = content
            .get("privateKey")
            .and_then(|value| value.as_str())
            .unwrap_or("");
        let comment = content
            .get("comment")
            .and_then(|value| value.as_str())
            .unwrap_or("");
        let identity = Self::from_openssh(private_key, comment)?;

        if let Some(public_key) = content
            .get("publicKey")
            .and_then(|value| value.as_str())
            .filter(|value| !value.trim().is_empty())
        {
            let expected = PublicKey::from_openssh(public_key)
                .map_err(|error| SshAgentError::InvalidKey(error.to_string()))?;
            if expected.key_data() != identity.public_key.key_data() {
                return Err(SshAgentError::MismatchedPublicKey);
            }
        }
        Ok(identity)
    }

    /// Commentaire affiché par `ssh-add -l`.
    pub fn comment(&self) -> &str {
        &self.comment
    }

    /// Empreinte SHA-256 au format OpenSSH.
    pub fn fingerprint(&self) -> String {
        self.public_key.fingerprint(HashAlg::Sha256).to_string()
    }

    /// Blob de clé publique au format filaire SSH.
    pub fn public_key_blob(&self) -> Result<Vec<u8>, SshAgentError> {
        self.public_key
            .to_bytes()
            .map_err(|error| SshAgentError::InvalidKey(error.to_string()))
    }

    /// Algorithme de la clé publique.
    pub fn algorithm(&self) -> String {
        match &self.material {
            KeyMaterial::Ed25519(_) => "ssh-ed25519".to_string(),
            KeyMaterial::Rsa(_) => "ssh-rsa".to_string(),
        }
    }

    /// Signe des données après validation par l’appelant.
    pub fn sign(&self, data: &[u8], flags: u32) -> Result<Vec<u8>, SshAgentError> {
        match &self.material {
            KeyMaterial::Ed25519(key) => {
                let signature = key.sign(data);
                Ok(encode_signature("ssh-ed25519", &signature.to_bytes()))
            }
            KeyMaterial::Rsa(key) => {
                if flags & SSH_AGENT_RSA_SHA2_512 != 0 {
                    let signing_key = RsaSigningKey::<Sha512>::new(key.clone());
                    Ok(encode_signature(
                        "rsa-sha2-512",
                        &signing_key.sign(data).to_vec(),
                    ))
                } else {
                    let signing_key = RsaSigningKey::<Sha256>::new(key.clone());
                    Ok(encode_signature(
                        "rsa-sha2-256",
                        &signing_key.sign(data).to_vec(),
                    ))
                }
            }
        }
    }
}

fn rsa_private_key(keypair: &RsaKeypair) -> Result<RsaPrivateKey, SshAgentError> {
    let number = |value: &ssh_key::Mpint| -> Result<rsa::BigUint, SshAgentError> {
        let bytes = value
            .as_positive_bytes()
            .ok_or_else(|| SshAgentError::InvalidKey("entier RSA négatif".into()))?;
        Ok(rsa::BigUint::from_bytes_be(bytes))
    };
    let key = RsaPrivateKey::from_components(
        number(&keypair.public.n)?,
        number(&keypair.public.e)?,
        number(&keypair.private.d)?,
        vec![number(&keypair.private.p)?, number(&keypair.private.q)?],
    )
    .map_err(|error| SshAgentError::InvalidKey(error.to_string()))?;
    key.validate()
        .map_err(|error| SshAgentError::InvalidKey(error.to_string()))?;
    if key.size() < 256 {
        return Err(SshAgentError::InvalidKey(
            "les clés RSA doivent faire au moins 2048 bits".into(),
        ));
    }
    Ok(key)
}

fn encode_signature(algorithm: &str, signature: &[u8]) -> Vec<u8> {
    let mut output = Vec::with_capacity(4 + algorithm.len() + 4 + signature.len());
    put_string(&mut output, algorithm.as_bytes());
    put_string(&mut output, signature);
    output
}

/// Traite un message agent et renvoie la réponse encodée.
pub fn handle_request(message: &[u8], identities: &[Identity], approval: &dyn Approval) -> Vec<u8> {
    match handle_request_inner(message, identities, approval) {
        Ok(response) => response,
        Err(_) => vec![SSH_AGENT_FAILURE],
    }
}

fn handle_request_inner(
    message: &[u8],
    identities: &[Identity],
    approval: &dyn Approval,
) -> Result<Vec<u8>, SshAgentError> {
    let mut reader = Reader::new(message);
    match reader.read_u8()? {
        SSH_AGENTC_REQUEST_IDENTITIES => {
            reader.finish()?;
            let mut output = vec![SSH_AGENT_IDENTITIES_ANSWER];
            put_u32(&mut output, identities.len() as u32);
            for identity in identities {
                put_string(&mut output, &identity.public_key_blob()?);
                put_string(&mut output, identity.comment.as_bytes());
            }
            Ok(output)
        }
        SSH_AGENTC_SIGN_REQUEST => {
            let key_blob = reader.read_string()?;
            let data = reader.read_string()?;
            let flags = reader.read_u32()?;
            reader.finish()?;
            let identity = identities
                .iter()
                .find(|identity| {
                    identity
                        .public_key_blob()
                        .map(|blob| blob == key_blob)
                        .unwrap_or(false)
                })
                .ok_or_else(|| SshAgentError::InvalidMessage("clé inconnue".into()))?;
            let request = ApprovalRequest {
                comment: identity.comment.clone(),
                fingerprint: identity.fingerprint(),
                algorithm: identity.algorithm(),
                data: Zeroizing::new(data.to_vec()),
            };
            if !approval.approve(&request) {
                return Ok(vec![SSH_AGENT_FAILURE]);
            }
            let signature = identity.sign(&request.data, flags)?;
            let mut output = vec![SSH_AGENT_SIGN_RESPONSE];
            put_string(&mut output, &signature);
            Ok(output)
        }
        other => Err(SshAgentError::InvalidMessage(format!(
            "type de message inconnu : {other}"
        ))),
    }
}

/// Sert une connexion agent jusqu’à sa fermeture.
pub fn handle_connection<S: Read + Write>(
    mut stream: S,
    identities: &[Identity],
    approval: &dyn Approval,
) -> io::Result<()> {
    while let Some(message) = read_frame(&mut stream)? {
        let response = handle_request(&message, identities, approval);
        write_frame(&mut stream, &response)?;
    }
    Ok(())
}

fn read_frame(reader: &mut impl Read) -> io::Result<Option<Vec<u8>>> {
    let mut header = [0u8; 4];
    match reader.read_exact(&mut header) {
        Ok(()) => {}
        Err(error) if error.kind() == io::ErrorKind::UnexpectedEof => return Ok(None),
        Err(error) => return Err(error),
    }
    let length = u32::from_be_bytes(header) as usize;
    if length == 0 || length > MAX_MESSAGE_SIZE {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "taille de message agent invalide",
        ));
    }
    let mut message = vec![0u8; length];
    reader.read_exact(&mut message)?;
    Ok(Some(message))
}

fn write_frame(writer: &mut impl Write, message: &[u8]) -> io::Result<()> {
    let length = u32::try_from(message.len())
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "message trop long"))?;
    writer.write_all(&length.to_be_bytes())?;
    writer.write_all(message)?;
    writer.flush()
}

fn put_u32(output: &mut Vec<u8>, value: u32) {
    output.extend_from_slice(&value.to_be_bytes());
}

fn put_string(output: &mut Vec<u8>, value: &[u8]) {
    put_u32(output, value.len() as u32);
    output.extend_from_slice(value);
}

struct Reader<'a> {
    data: &'a [u8],
    offset: usize,
}

impl<'a> Reader<'a> {
    fn new(data: &'a [u8]) -> Self {
        Self { data, offset: 0 }
    }

    fn read_u8(&mut self) -> Result<u8, SshAgentError> {
        let value = *self
            .data
            .get(self.offset)
            .ok_or_else(|| SshAgentError::InvalidMessage("message tronqué".into()))?;
        self.offset += 1;
        Ok(value)
    }

    fn read_u32(&mut self) -> Result<u32, SshAgentError> {
        let end = self.offset + 4;
        let bytes = self
            .data
            .get(self.offset..end)
            .ok_or_else(|| SshAgentError::InvalidMessage("message tronqué".into()))?;
        self.offset = end;
        Ok(u32::from_be_bytes(bytes.try_into().expect("quatre octets")))
    }

    fn read_string(&mut self) -> Result<&'a [u8], SshAgentError> {
        let length = self.read_u32()? as usize;
        let end = self
            .offset
            .checked_add(length)
            .ok_or_else(|| SshAgentError::InvalidMessage("longueur invalide".into()))?;
        let value = self
            .data
            .get(self.offset..end)
            .ok_or_else(|| SshAgentError::InvalidMessage("message tronqué".into()))?;
        self.offset = end;
        Ok(value)
    }

    fn finish(&self) -> Result<(), SshAgentError> {
        if self.offset == self.data.len() {
            Ok(())
        } else {
            Err(SshAgentError::InvalidMessage(
                "octets excédentaires dans le message".into(),
            ))
        }
    }
}

/// Crée le socket de l’agent avec des permissions restrictives.
#[cfg(unix)]
pub fn bind_socket(path: &std::path::Path) -> io::Result<std::os::unix::net::UnixListener> {
    use std::os::unix::fs::{FileTypeExt, PermissionsExt};

    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
        std::fs::set_permissions(parent, std::fs::Permissions::from_mode(0o700))?;
    }
    if let Ok(metadata) = std::fs::symlink_metadata(path) {
        if !metadata.file_type().is_socket() {
            return Err(io::Error::new(
                io::ErrorKind::AlreadyExists,
                "le chemin de l’agent existe et n’est pas un socket",
            ));
        }
        std::fs::remove_file(path)?;
    }
    let listener = std::os::unix::net::UnixListener::bind(path)?;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))?;
    Ok(listener)
}

/// Sert les connexions entrantes. Chaque connexion obtient son propre fil.
#[cfg(unix)]
pub fn serve(
    listener: std::os::unix::net::UnixListener,
    identities: Arc<Vec<Identity>>,
    approval: Arc<dyn Approval>,
) -> io::Result<()> {
    for stream in listener.incoming() {
        let Ok(stream) = stream else { continue };
        let identities = Arc::clone(&identities);
        let approval = Arc::clone(&approval);
        std::thread::spawn(move || {
            let _ = handle_connection(stream, &identities, approval.as_ref());
        });
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use rand_core::OsRng;
    use ssh_key::{Algorithm, LineEnding};

    const RSA_TEST_KEY: &str = r#"-----BEGIN OPENSSH PRIVATE KEY-----
b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAABFwAAAAdzc2gtcn
NhAAAAAwEAAQAAAQEAuX3m1vNE0WGVc06WZWFrKv8jc4j9lYy1WKRx6MDjrq1o9Ydin1gK
50li0XosZi7v8y2UxN7vw13UW/Q3kHnS2egp31T9QGYiLq2xnk3t9wGIA2vreyUdxnt2mH
KJaQURKVhStzUmpGlKttiaTbud3J69fUQ9v1HdTDqRcZ0OE3TGQx82lV7gM2efgc2A48rW
fDxJX59KVsxdaoNvio6qnHpm+a3Q7Wn7T3bcISYpEVOXO+2DZTxog7R/nExjAMeuHm0+kE
ltMFNkxwb1fUgVLXK09/+uCGgAs4bnEuIRPWxK0NVqVJPfBIpg2Oi72VVC2RsH9PJWhTHJ
LWl4wdWZEwAAA8jnC2km5wtpJgAAAAdzc2gtcnNhAAABAQC5febW80TRYZVzTpZlYWsq/y
NziP2VjLVYpHHowOOurWj1h2KfWArnSWLReixmLu/zLZTE3u/DXdRb9DeQedLZ6CnfVP1A
ZiIurbGeTe33AYgDa+t7JR3Ge3aYcolpBREpWFK3NSakaUq22JpNu53cnr19RD2/Ud1MOp
FxnQ4TdMZDHzaVXuAzZ5+BzYDjytZ8PElfn0pWzF1qg2+Kjqqcemb5rdDtaftPdtwhJikR
U5c77YNlPGiDtH+cTGMAx64ebT6QSW0wU2THBvV9SBUtcrT3/64IaACzhucS4hE9bErQ1W
pUk98EimDY6LvZVULZGwf08laFMcktaXjB1ZkTAAAAAwEAAQAAAQAdJk7vep1W9inhS/lQ
h0WrJRsyHdYT+V/KRVVtSVq+aZvz8cmq1tAn1p2D49o0WK32njQh2BL/tbAYn0FYH/zlp5
lk8ls2EpbOlRczlHWP+pqgRwZjfMq4FVDm1iEH8vbmc23UQrMG5VELePCOxKwjLoMCu4Wk
mj3Xq+CNZSwAHHYzkQwZ2NaxWGjoA5R6cizIB/huIIJSHz407FNGDoFFT8j2PdyIp+dgoH
RB2fIikbzAQJB3XomuVqfNVpqnoIwWMRF9Hu/9PqbrzSm/cSxOuA+fLvJeZqUe1OrEgd8f
LCneJa9xBtn9XQgS3LvIS6JBHQPQ+VMbvFpLscCfSBjJAAAAgQC+uHe3W9ydN0YpNK9wi5
LmHSDGZBFyoqApYDXXu+Qq0HCTO5UV1QwV8D7L2yMs1q7KlRCt1+k+aIrl6VOg4kZb2kb2
DdT9bbhKDmm2VL1ZAWrIRtrFh8nQu6obtK9jzSVGAtrIKwmr5uc/Keg7D4KHO4JEYXTHYw
36xdJY1GZtWAAAAIEA5Ul8KTORibrrsp98d0thblPWEpqoBjfpO51mnuOoLtKVEYmQPsDJ
liUSAchULWfYtJj1IeJ1sunRJe4K5T38/H0oIUdtR5mBWZ/VZNlqevLD7MdnXigguhCesp
PrLADHLYhZmSBmVTE6pwhtfI8m3uBTpvEtn7qjpt/mtz68sIUAAACBAM8aN82zm3Yu7ikt
EtvCQRu+MUHte+QIk6HCgqX8/CArzikRZAVMTt017oM9vwSF6cNxDMuZ6vMGeqAM5n2hgO
a0p4fEME8lKMokLxDPvWTwYGzJDWYKKWjzpBUkGNWNGWsTv6ldlP3tFl7Q+72i1cMt9zSF
d7Sm7IoNxtsKBuK3AAAAC3Rlc3RAY29mZnJlAQIDBAUGBw==
-----END OPENSSH PRIVATE KEY-----"#;

    fn key(algorithm: Algorithm) -> Identity {
        let mut key = PrivateKey::random(&mut OsRng, algorithm).expect("clé");
        key.set_comment("test@coffre");
        let pem = key.to_openssh(LineEnding::LF).expect("PEM");
        Identity::from_openssh(&pem, "Clé de test").expect("identité")
    }

    fn request_identities() -> Vec<u8> {
        vec![SSH_AGENTC_REQUEST_IDENTITIES]
    }

    fn request_sign(identity: &Identity, data: &[u8], flags: u32) -> Vec<u8> {
        let mut message = vec![SSH_AGENTC_SIGN_REQUEST];
        put_string(&mut message, &identity.public_key_blob().unwrap());
        put_string(&mut message, data);
        put_u32(&mut message, flags);
        message
    }

    fn signature_from_response(response: &[u8]) -> (&str, Vec<u8>) {
        assert_eq!(response[0], SSH_AGENT_SIGN_RESPONSE);
        let mut reader = Reader::new(&response[1..]);
        let blob = reader.read_string().unwrap();
        let mut blob_reader = Reader::new(blob);
        let algorithm = std::str::from_utf8(blob_reader.read_string().unwrap()).unwrap();
        let signature = blob_reader.read_string().unwrap().to_vec();
        blob_reader.finish().unwrap();
        (algorithm, signature)
    }

    #[test]
    fn liste_les_identites() {
        let identity = key(Algorithm::Ed25519);
        let response = handle_request(
            &request_identities(),
            &[identity],
            &|_: &ApprovalRequest| true,
        );
        assert_eq!(response[0], SSH_AGENT_IDENTITIES_ANSWER);
        let mut reader = Reader::new(&response[1..]);
        assert_eq!(reader.read_u32().unwrap(), 1);
        assert!(!reader.read_string().unwrap().is_empty());
        assert_eq!(reader.read_string().unwrap(), "Clé de test".as_bytes());
        reader.finish().unwrap();
    }

    #[test]
    fn signe_ed25519_apres_approbation() {
        let identity = key(Algorithm::Ed25519);
        let data = b"session de test";
        let response = handle_request(
            &request_sign(&identity, data, 0),
            std::slice::from_ref(&identity),
            &|request: &ApprovalRequest| {
                assert_eq!(request.algorithm, "ssh-ed25519");
                assert!(request.fingerprint.starts_with("SHA256:"));
                request.data.as_slice() == data
            },
        );
        let (algorithm, signature) = signature_from_response(&response);
        assert_eq!(algorithm, "ssh-ed25519");
        let public = identity.public_key.key_data().ed25519().unwrap();
        let verifying = ed25519_dalek::VerifyingKey::from_bytes(&public.0).unwrap();
        let signature = ed25519_dalek::Signature::from_slice(&signature).unwrap();
        rsa::signature::Verifier::verify(&verifying, data, &signature).unwrap();
    }

    #[test]
    fn refuse_sans_approbation() {
        let identity = key(Algorithm::Ed25519);
        let response = handle_request(
            &request_sign(&identity, b"secret", 0),
            std::slice::from_ref(&identity),
            &|_: &ApprovalRequest| false,
        );
        assert_eq!(response, vec![SSH_AGENT_FAILURE]);
    }

    #[test]
    fn refuse_une_cle_inconnue() {
        let identity = key(Algorithm::Ed25519);
        let other = key(Algorithm::Ed25519);
        let response = handle_request(
            &request_sign(&other, b"secret", 0),
            std::slice::from_ref(&identity),
            &|_: &ApprovalRequest| true,
        );
        assert_eq!(response, vec![SSH_AGENT_FAILURE]);
    }

    #[test]
    fn signe_rsa_sha2_256() {
        let identity = Identity::from_openssh(RSA_TEST_KEY, "RSA de test").unwrap();
        let data = b"session RSA";
        let response = handle_request(
            &request_sign(&identity, data, SSH_AGENT_RSA_SHA2_256),
            std::slice::from_ref(&identity),
            &|_: &ApprovalRequest| true,
        );
        let (algorithm, signature) = signature_from_response(&response);
        assert_eq!(algorithm, "rsa-sha2-256");
        let public = identity.public_key.key_data().rsa().unwrap();
        let n = rsa::BigUint::from_bytes_be(public.n.as_positive_bytes().unwrap());
        let e = rsa::BigUint::from_bytes_be(public.e.as_positive_bytes().unwrap());
        let verifying =
            rsa::pkcs1v15::VerifyingKey::<Sha256>::new(rsa::RsaPublicKey::new(n, e).unwrap());
        let signature = rsa::pkcs1v15::Signature::try_from(signature.as_slice()).unwrap();
        rsa::signature::Verifier::verify(&verifying, data, &signature).unwrap();
    }

    #[test]
    fn refuse_une_cle_chiffree() {
        let mut key = PrivateKey::random(&mut OsRng, Algorithm::Ed25519).unwrap();
        key.set_comment("test");
        let encrypted = key.encrypt(&mut OsRng, "phrase de test").unwrap();
        let pem = encrypted.to_openssh(LineEnding::LF).unwrap();
        assert_eq!(
            Identity::from_openssh(&pem, "test").unwrap_err(),
            SshAgentError::EncryptedKey
        );
    }

    #[test]
    fn valide_la_cle_publique_de_l_element() {
        let mut key = PrivateKey::random(&mut OsRng, Algorithm::Ed25519).unwrap();
        key.set_comment("test");
        let private_key = key.to_openssh(LineEnding::LF).unwrap().to_string();
        let public_key = key.public_key().to_openssh().unwrap();
        let content = serde_json::json!({
            "type": "ssh-key",
            "privateKey": private_key,
            "publicKey": public_key,
            "comment": "Serveur",
            "deletedAt": null
        });
        let parsed = Identity::from_item(&content).unwrap();
        assert_eq!(parsed.comment(), "Serveur");
        assert_eq!(
            parsed.fingerprint(),
            key.public_key().fingerprint(HashAlg::Sha256).to_string()
        );
    }

    #[cfg(unix)]
    #[test]
    fn echange_sur_une_paire_de_sockets() {
        use std::os::unix::net::UnixStream;

        let identity = key(Algorithm::Ed25519);
        let identities = vec![identity];
        let (mut client, server) = UnixStream::pair().unwrap();
        let worker = std::thread::spawn(move || {
            handle_connection(server, &identities, &|_: &ApprovalRequest| true).unwrap();
        });
        write_frame(&mut client, &request_identities()).unwrap();
        let response = read_frame(&mut client).unwrap().unwrap();
        assert_eq!(response[0], SSH_AGENT_IDENTITIES_ANSWER);
        drop(client);
        worker.join().unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn socket_avec_permissions_restrictives() {
        use std::os::unix::fs::PermissionsExt;
        let dir = std::env::temp_dir().join(format!(
            "coffre-agent-test-{}-{}",
            std::process::id(),
            rand_core::RngCore::next_u64(&mut OsRng)
        ));
        let path = dir.join("agent.sock");
        let listener = bind_socket(&path).unwrap();
        assert_eq!(
            std::fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            0o600
        );
        assert_eq!(
            std::fs::metadata(&dir).unwrap().permissions().mode() & 0o777,
            0o700
        );
        drop(listener);
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
