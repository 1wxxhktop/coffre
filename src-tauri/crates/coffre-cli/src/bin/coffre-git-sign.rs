//! Programme de signature compatible `gpg.ssh.program` pour Git.
//!
//! Git l’appelle comme `ssh-keygen -Y sign -n git -f <clé> <fichier>` et attend
//! un fichier `<fichier>.sig` au format SSHSIG. La clé privée vient du coffre
//! Coffre ; le coffre est indiqué par `COFFRE_VAULT` et le mot de passe par
//! `COFFRE_PASSWORD` ou une invite terminal.

use std::process::ExitCode;

use coffre_core::{VaultFile, open};
use ssh_key::LineEnding;

fn argument<'a>(args: &'a [String], name: &str) -> Option<&'a str> {
    args.iter()
        .position(|value| value == name)
        .and_then(|index| args.get(index + 1))
        .map(|value| value.as_str())
}

fn find_key<'a>(
    items: &'a [coffre_core::OpenedItem],
    query: &str,
) -> Option<&'a coffre_core::OpenedItem> {
    let needle = query.trim().to_lowercase();
    items.iter().find(|item| {
        if item.content.get("type").and_then(|value| value.as_str()) != Some("ssh-key") {
            return false;
        }
        let comment = item
            .content
            .get("comment")
            .and_then(|value| value.as_str())
            .unwrap_or("")
            .to_lowercase();
        let fingerprint = item
            .content
            .get("fingerprint")
            .and_then(|value| value.as_str())
            .unwrap_or("")
            .to_lowercase();
        item.id == query || comment == needle || fingerprint == needle
    })
}

fn run() -> Result<(), String> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if !args.iter().any(|value| value == "-Y") || !args.iter().any(|value| value == "sign") {
        return Err("usage : coffre-git-sign -Y sign -n git -f <clé> <fichier>".into());
    }
    let namespace = argument(&args, "-n").unwrap_or("git");
    let query = argument(&args, "-f").ok_or_else(|| "option -f absente".to_string())?;
    let file = args
        .last()
        .filter(|value| !value.starts_with('-'))
        .ok_or_else(|| "fichier à signer absent".to_string())?;
    let vault_path =
        std::env::var("COFFRE_VAULT").map_err(|_| "COFFRE_VAULT n’est pas défini".to_string())?;
    let password = match std::env::var("COFFRE_PASSWORD") {
        Ok(value) if !value.is_empty() => value,
        _ => rpassword::prompt_password("Mot de passe maître Coffre : ")
            .map_err(|_| "lecture du mot de passe impossible".to_string())?,
    };
    let text = std::fs::read_to_string(&vault_path)
        .map_err(|_| format!("coffre inaccessible : {vault_path}"))?;
    let file_model = VaultFile::parse(&text).map_err(|error| error.to_string())?;
    let opened = open(&file_model, &password).map_err(|error| error.to_string())?;
    let item =
        find_key(&opened.items, query).ok_or_else(|| format!("clé SSH introuvable : {query}"))?;
    let private = item
        .content
        .get("privateKey")
        .and_then(|value| value.as_str())
        .ok_or_else(|| "clé privée absente".to_string())?;
    let key = ssh_key::PrivateKey::from_openssh(private)
        .map_err(|error| format!("clé SSH invalide : {error}"))?;
    if key.is_encrypted() {
        return Err("les clés SSH chiffrées ne sont pas prises en charge".into());
    }
    let data = std::fs::read(file).map_err(|_| format!("fichier inaccessible : {file}"))?;
    let signature = key
        .sign(namespace, ssh_key::HashAlg::Sha512, &data)
        .map_err(|error| format!("signature impossible : {error}"))?;
    let pem = signature
        .to_pem(LineEnding::LF)
        .map_err(|error| format!("encodage impossible : {error}"))?;
    std::fs::write(format!("{file}.sig"), pem)
        .map_err(|error| format!("écriture de la signature impossible : {error}"))?;
    Ok(())
}

fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("coffre-git-sign : {error}");
            ExitCode::FAILURE
        }
    }
}
