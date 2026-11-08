//! CLI locale de lecture d’un fichier `.coffre`.
//!
//! Le mot de passe est lu sur le terminal (ou sur stdin avec
//! `--password-stdin`), jamais passé en argument. Les secrets sont écrits sur
//! stdout uniquement lorsque l’utilisateur le demande explicitement.

use clap::{Parser, Subcommand, ValueEnum};
use coffre_core::{OpenedItem, OpenedVault, VaultFile, open};
use hmac::{Hmac, Mac};
use sha1::Sha1;
use sha2::{Sha256, Sha512};
use std::io::Write;
use std::process::{Command as ProcessCommand, ExitCode};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Parser)]
#[command(
    name = "coffre-cli",
    version,
    about = "Lecture locale d’un coffre Coffre"
)]
struct Cli {
    /// Fichier `.coffre`.
    file: String,
    /// Lit le mot de passe sur stdin plutôt que sur le terminal.
    #[arg(long)]
    password_stdin: bool,
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Liste les éléments actifs sans afficher de secret.
    List,
    /// Affiche un champ d’un élément.
    Get {
        /// Titre, identifiant, nom d’utilisateur ou URL.
        query: String,
        #[arg(long, value_enum, default_value = "password")]
        field: Field,
    },
    /// Affiche le code TOTP courant d’un élément.
    Totp { query: String },
    /// Exécute une commande avec des secrets dans son environnement.
    Run {
        /// NOM=RECHERCHE ou NOM=RECHERCHE::CHAMP (password, username, notes).
        #[arg(long = "env", value_name = "NOM=RECHERCHE[::CHAMP]", required = true)]
        env: Vec<String>,
        /// Commande et arguments, après `--`.
        #[arg(last = true, required = true)]
        command: Vec<String>,
    },
}

#[derive(Clone, Copy, ValueEnum)]
enum Field {
    Password,
    Username,
    Notes,
    Json,
}

#[derive(Clone, Copy)]
enum Algorithm {
    Sha1,
    Sha256,
    Sha512,
}

fn base32_decode(value: &str) -> Result<Vec<u8>, String> {
    let alphabet = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    let mut buffer = 0u32;
    let mut bits = 0u8;
    let mut output = Vec::new();
    for raw in value.bytes() {
        if raw == b'=' || raw == b' ' || raw == b'-' {
            continue;
        }
        let byte = raw.to_ascii_uppercase();
        let Some(value) = alphabet.iter().position(|candidate| *candidate == byte) else {
            return Err("secret TOTP base32 invalide".into());
        };
        buffer = (buffer << 5) | value as u32;
        bits += 5;
        if bits >= 8 {
            bits -= 8;
            output.push((buffer >> bits) as u8);
        }
    }
    if output.is_empty() {
        return Err("secret TOTP vide".into());
    }
    Ok(output)
}

fn parse_totp(uri: &str) -> Result<(Vec<u8>, Algorithm, u32, u32), String> {
    let Some(rest) = uri.strip_prefix("otpauth://totp/") else {
        return Err("URI TOTP invalide".into());
    };
    let query = rest
        .split_once('?')
        .map(|(_, query)| query)
        .ok_or_else(|| "URI TOTP sans paramètres".to_string())?;
    let mut secret = None;
    let mut algorithm = Algorithm::Sha1;
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
                    "SHA1" => Algorithm::Sha1,
                    "SHA256" => Algorithm::Sha256,
                    "SHA512" => Algorithm::Sha512,
                    _ => return Err("algorithme TOTP non pris en charge".into()),
                }
            }
            "period" => {
                period = value
                    .parse()
                    .map_err(|_| "période TOTP invalide".to_string())?
            }
            "digits" => {
                digits = value
                    .parse()
                    .map_err(|_| "nombre de chiffres TOTP invalide".to_string())?
            }
            _ => {}
        }
    }
    if !(1..=10).contains(&digits) || !(1..=300).contains(&period) {
        return Err("paramètres TOTP hors limites".into());
    }
    let secret = secret.ok_or_else(|| "secret TOTP absent".to_string())?;
    Ok((secret, algorithm, period, digits))
}

fn totp_code(
    secret: &[u8],
    algorithm: Algorithm,
    period: u32,
    digits: u32,
    unix_time: u64,
) -> Result<String, String> {
    let counter = unix_time / u64::from(period);
    let message = counter.to_be_bytes();
    let digest = match algorithm {
        Algorithm::Sha1 => {
            let mut mac = <Hmac<Sha1> as Mac>::new_from_slice(secret)
                .map_err(|_| "clé TOTP invalide".to_string())?;
            mac.update(&message);
            mac.finalize().into_bytes().to_vec()
        }
        Algorithm::Sha256 => {
            let mut mac = <Hmac<Sha256> as Mac>::new_from_slice(secret)
                .map_err(|_| "clé TOTP invalide".to_string())?;
            mac.update(&message);
            mac.finalize().into_bytes().to_vec()
        }
        Algorithm::Sha512 => {
            let mut mac = <Hmac<Sha512> as Mac>::new_from_slice(secret)
                .map_err(|_| "clé TOTP invalide".to_string())?;
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
    let modulo = 10u32.pow(digits);
    Ok(format!(
        "{:0width$}",
        binary % modulo,
        width = digits as usize
    ))
}

fn searchable(item: &OpenedItem) -> String {
    let content = &item.content;
    [
        item.id.as_str(),
        content.get("title").and_then(|v| v.as_str()).unwrap_or(""),
        content
            .get("username")
            .and_then(|v| v.as_str())
            .unwrap_or(""),
        content
            .get("urls")
            .and_then(|v| v.as_array())
            .map(|urls| {
                urls.iter()
                    .filter_map(|url| url.as_str())
                    .collect::<Vec<_>>()
                    .join(" ")
            })
            .unwrap_or_default()
            .as_str(),
    ]
    .join(" ")
    .to_lowercase()
}

fn find_item<'a>(items: &'a [OpenedItem], query: &str) -> Option<&'a OpenedItem> {
    let needle = query.trim().to_lowercase();
    items
        .iter()
        .filter(|item| {
            item.content
                .get("deletedAt")
                .and_then(|value| value.as_str())
                .is_none()
        })
        .find(|item| item.id == query)
        .or_else(|| items.iter().find(|item| searchable(item).contains(&needle)))
}

fn parse_env_assignment(raw: &str) -> Result<(String, String, Field), String> {
    let (name, expression) = raw
        .split_once('=')
        .ok_or_else(|| format!("variable d’environnement invalide : {raw}"))?;
    let mut characters = name.chars();
    let valid = characters
        .next()
        .is_some_and(|first| first.is_ascii_alphabetic() || first == '_')
        && characters.all(|character| character.is_ascii_alphanumeric() || character == '_');
    if !valid {
        return Err(format!("nom de variable invalide : {name}"));
    }
    let (query, field) = match expression.rsplit_once("::") {
        Some((query, field)) => (query, field),
        None => (expression, "password"),
    };
    let query = query.trim();
    if query.is_empty() {
        return Err(format!("recherche vide pour {name}"));
    }
    let field = match field.to_ascii_lowercase().as_str() {
        "password" => Field::Password,
        "username" => Field::Username,
        "notes" => Field::Notes,
        _ => return Err(format!("champ inconnu pour {name} : {field}")),
    };
    Ok((name.to_string(), query.to_string(), field))
}

fn field_value(item: &OpenedItem, field: Field) -> String {
    let key = match field {
        Field::Password => "password",
        Field::Username => "username",
        Field::Notes => "notes",
        Field::Json => return String::new(),
    };
    item.content
        .get(key)
        .and_then(|value| value.as_str())
        .unwrap_or("")
        .to_string()
}

fn read_password(stdin: bool) -> Result<String, String> {
    if stdin {
        let mut line = String::new();
        std::io::stdin()
            .read_line(&mut line)
            .map_err(|_| "lecture du mot de passe impossible".to_string())?;
        Ok(line.trim_end_matches(['\r', '\n']).to_string())
    } else {
        rpassword::prompt_password("Mot de passe maître : ")
            .map_err(|_| "lecture du mot de passe impossible".to_string())
    }
}

fn run(cli: Cli) -> Result<ExitCode, String> {
    let text = std::fs::read_to_string(&cli.file)
        .map_err(|_| format!("fichier inaccessible : {}", cli.file))?;
    let file = VaultFile::parse(&text).map_err(|error| error.to_string())?;
    let password = read_password(cli.password_stdin)?;
    let opened: OpenedVault = open(&file, &password).map_err(|error| error.to_string())?;
    let stdout = std::io::stdout();
    let mut output = stdout.lock();
    match cli.command {
        Command::List => {
            for item in opened.items.iter().filter(|item| {
                item.content
                    .get("deletedAt")
                    .and_then(|value| value.as_str())
                    .is_none()
            }) {
                let title = item
                    .content
                    .get("title")
                    .and_then(|value| value.as_str())
                    .unwrap_or("Sans titre");
                let kind = item
                    .content
                    .get("type")
                    .and_then(|value| value.as_str())
                    .unwrap_or("?");
                let username = item
                    .content
                    .get("username")
                    .and_then(|value| value.as_str())
                    .unwrap_or("");
                writeln!(output, "{kind}\t{title}\t{username}")
                    .map_err(|_| "écriture impossible".to_string())?;
            }
        }
        Command::Get { query, field } => {
            let item = find_item(&opened.items, &query)
                .ok_or_else(|| "élément introuvable".to_string())?;
            match field {
                Field::Json => writeln!(
                    output,
                    "{}",
                    serde_json::to_string_pretty(&item.content)
                        .map_err(|_| "sérialisation impossible".to_string())?
                ),
                Field::Password => writeln!(
                    output,
                    "{}",
                    item.content
                        .get("password")
                        .and_then(|value| value.as_str())
                        .unwrap_or("")
                ),
                Field::Username => writeln!(
                    output,
                    "{}",
                    item.content
                        .get("username")
                        .and_then(|value| value.as_str())
                        .unwrap_or("")
                ),
                Field::Notes => writeln!(
                    output,
                    "{}",
                    item.content
                        .get("notes")
                        .and_then(|value| value.as_str())
                        .unwrap_or("")
                ),
            }
            .map_err(|_| "écriture impossible".to_string())?;
        }
        Command::Totp { query } => {
            let item = find_item(&opened.items, &query)
                .ok_or_else(|| "élément introuvable".to_string())?;
            let uri = item
                .content
                .get("totp")
                .and_then(|value| value.as_str())
                .filter(|value| !value.is_empty())
                .ok_or_else(|| "aucun TOTP configuré".to_string())?;
            let (secret, algorithm, period, digits) = parse_totp(uri)?;
            let now = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map_err(|_| "horloge système invalide".to_string())?
                .as_secs();
            writeln!(
                output,
                "{}",
                totp_code(&secret, algorithm, period, digits, now)?
            )
            .map_err(|_| "écriture impossible".to_string())?;
        }
        Command::Run { env, command } => {
            let mut variables = Vec::with_capacity(env.len());
            for raw in &env {
                let (name, query, field) = parse_env_assignment(raw)?;
                let item = find_item(&opened.items, &query)
                    .ok_or_else(|| format!("élément introuvable pour {name}"))?;
                variables.push((name, field_value(item, field)));
            }
            let (program, arguments) = command
                .split_first()
                .ok_or_else(|| "commande vide".to_string())?;
            let status = ProcessCommand::new(program)
                .args(arguments)
                .envs(variables)
                .status()
                .map_err(|error| format!("lancement impossible : {error}"))?;
            return Ok(ExitCode::from(
                status
                    .code()
                    .and_then(|code| u8::try_from(code).ok())
                    .unwrap_or(1),
            ));
        }
    }
    Ok(ExitCode::SUCCESS)
}

fn main() -> ExitCode {
    let cli = Cli::parse();
    match run(cli) {
        Ok(code) => code,
        Err(error) => {
            eprintln!("coffre-cli : {error}");
            ExitCode::FAILURE
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decode_base32_et_totp_rfc() {
        let secret = base32_decode("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ").unwrap();
        assert_eq!(
            totp_code(&secret, Algorithm::Sha1, 30, 8, 59).unwrap(),
            "94287082"
        );
    }

    #[test]
    fn parse_uri_totp() {
        let (secret, _, period, digits) =
            parse_totp("otpauth://totp/Test?secret=JBSWY3DPEHPK3PXP&period=60&digits=6").unwrap();
        assert_eq!(secret, base32_decode("JBSWY3DPEHPK3PXP").unwrap());
        assert_eq!(period, 60);
        assert_eq!(digits, 6);
    }

    #[test]
    fn analyse_les_variables_d_environnement() {
        let (name, query, field) = parse_env_assignment("DB_PASSWORD=prod-db").unwrap();
        assert_eq!(name, "DB_PASSWORD");
        assert_eq!(query, "prod-db");
        assert!(matches!(field, Field::Password));

        let (_, query, field) = parse_env_assignment("SSH_USER=serveur::username").unwrap();
        assert_eq!(query, "serveur");
        assert!(matches!(field, Field::Username));

        assert!(parse_env_assignment("DB_PASSWORD=prod-db::json").is_err());
        assert!(parse_env_assignment("1BAD=prod-db").is_err());
        assert!(parse_env_assignment("SANS_EGAL").is_err());
    }

    #[test]
    fn recherche_par_titre_et_identifiant() {
        let item = OpenedItem {
            id: "i_test".into(),
            vault_id: "v".into(),
            content: serde_json::json!({
                "type": "login",
                "title": "GitHub",
                "username": "ada",
                "urls": ["https://github.com"],
                "deletedAt": null
            }),
            created_at: String::new(),
            updated_at: String::new(),
        };
        let items = vec![item];
        assert_eq!(find_item(&items, "github").unwrap().id, "i_test");
        assert_eq!(find_item(&items, "i_test").unwrap().id, "i_test");
        assert!(find_item(&items, "gitlab").is_none());
    }
}
