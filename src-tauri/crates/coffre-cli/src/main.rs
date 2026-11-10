//! CLI locale de lecture d’un fichier `.coffre`.
//!
//! Le mot de passe est lu sur le terminal (ou sur stdin avec
//! `--password-stdin`), jamais passé en argument. Les secrets sont écrits sur
//! stdout uniquement lorsque l’utilisateur le demande explicitement.

use clap::{Parser, Subcommand, ValueEnum};
use coffre_core::{OpenedItem, OpenedVault, VaultFile, open};
use hmac::{Hmac, KeyInit, Mac};
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
        #[arg(long = "env", value_name = "NOM=RECHERCHE[::CHAMP]")]
        env: Vec<String>,
        /// Fichier .env contenant des références coffre://coffre/element/champ.
        #[arg(long = "env-file", value_name = "FICHIER")]
        env_file: Vec<std::path::PathBuf>,
        /// Commande et arguments, après `--`.
        #[arg(last = true, required = true)]
        command: Vec<String>,
    },
    /// Signe un fichier avec une clé SSH du coffre (format SSHSIG).
    SshSign {
        /// Titre, commentaire ou empreinte de la clé.
        query: String,
        /// Fichier à signer.
        file: String,
        /// Espace de noms SSHSIG (git par défaut).
        #[arg(long, default_value = "git")]
        namespace: String,
    },
    /// Génère une configuration SSH par hôte pour les clés du coffre.
    SshConfig {
        /// Socket de l’agent SSH Coffre.
        #[arg(long)]
        agent: String,
    },
    /// Assistant d’identifiants Git (git credential-coffre).
    GitCredential {
        #[arg(value_enum)]
        action: GitAction,
        /// Approuve explicitement la divulgation du secret pour `get`.
        #[arg(long)]
        approve: bool,
    },
}

#[derive(Clone, Copy, ValueEnum)]
enum GitAction {
    Get,
    Store,
    Erase,
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
            let mut mac = <Hmac<Sha1> as KeyInit>::new_from_slice(secret)
                .map_err(|_| "clé TOTP invalide".to_string())?;
            mac.update(&message);
            mac.finalize().into_bytes().to_vec()
        }
        Algorithm::Sha256 => {
            let mut mac = <Hmac<Sha256> as KeyInit>::new_from_slice(secret)
                .map_err(|_| "clé TOTP invalide".to_string())?;
            mac.update(&message);
            mac.finalize().into_bytes().to_vec()
        }
        Algorithm::Sha512 => {
            let mut mac = <Hmac<Sha512> as KeyInit>::new_from_slice(secret)
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

fn item_matches_query(item: &OpenedItem, query: &str) -> bool {
    item.id == query || searchable(item).contains(&query.trim().to_lowercase())
}

fn find_item<'a>(items: &'a [OpenedItem], query: &str) -> Option<&'a OpenedItem> {
    items
        .iter()
        .filter(|item| {
            item.content
                .get("deletedAt")
                .and_then(|value| value.as_str())
                .is_none()
        })
        .find(|item| item_matches_query(item, query))
}

fn validate_env_name(name: &str) -> Result<(), String> {
    let mut characters = name.chars();
    let valid = characters
        .next()
        .is_some_and(|first| first.is_ascii_alphabetic() || first == '_')
        && characters.all(|character| character.is_ascii_alphanumeric() || character == '_');
    if valid {
        Ok(())
    } else {
        Err(format!("nom de variable invalide : {name}"))
    }
}

fn hex_digit(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

/// Décode les séquences `%XX`. Le travail se fait sur les octets : découper
/// la chaîne (`&value[i..j]`) paniquerait au milieu d’un caractère multi-octet,
/// par exemple pour `%aé`.
fn percent_decode(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut output = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%'
            && index + 2 < bytes.len()
            && let (Some(high), Some(low)) =
                (hex_digit(bytes[index + 1]), hex_digit(bytes[index + 2]))
        {
            output.push(high << 4 | low);
            index += 3;
            continue;
        }
        output.push(bytes[index]);
        index += 1;
    }
    String::from_utf8_lossy(&output).to_string()
}

fn url_host(value: &str) -> Option<String> {
    let rest = value
        .split_once("://")
        .map(|(_, rest)| rest)
        .unwrap_or(value);
    let authority = rest.split('/').next().unwrap_or(rest);
    let host = authority.rsplit('@').next().unwrap_or(authority);
    let host = host.split(':').next().unwrap_or(host).to_lowercase();
    if host.is_empty() { None } else { Some(host) }
}

fn host_matches(left: &str, right: &str) -> bool {
    left == right || left.ends_with(&format!(".{right}")) || right.ends_with(&format!(".{left}"))
}

fn item_matches_host(item: &OpenedItem, host: &str) -> bool {
    item.content
        .get("urls")
        .and_then(|value| value.as_array())
        .is_some_and(|urls| {
            urls.iter().any(|url| {
                url.as_str()
                    .and_then(url_host)
                    .is_some_and(|item_host| host_matches(&item_host, host))
            })
        })
}

fn resolve_coffre_reference(opened: &OpenedVault, raw: &str) -> Result<String, String> {
    let rest = raw
        .strip_prefix("coffre://")
        .ok_or_else(|| "référence coffre:// attendue".to_string())?;
    let mut parts = rest.splitn(3, '/');
    let vault = percent_decode(parts.next().unwrap_or(""));
    let item_query = percent_decode(parts.next().unwrap_or(""));
    let field = percent_decode(parts.next().unwrap_or("password"));
    if vault.is_empty() || item_query.is_empty() {
        return Err("référence coffre:// incomplète (coffre/élément/champ)".into());
    }
    let vault_id = if vault == "*" || vault.is_empty() {
        None
    } else {
        Some(
            opened
                .vaults
                .iter()
                .find(|summary| summary.id == vault || summary.name.eq_ignore_ascii_case(&vault))
                .map(|summary| summary.id.clone())
                .ok_or_else(|| format!("coffre introuvable : {vault}"))?,
        )
    };
    let item = opened
        .items
        .iter()
        .filter(|candidate| vault_id.as_ref().is_none_or(|id| &candidate.vault_id == id))
        .find(|candidate| {
            candidate
                .content
                .get("deletedAt")
                .and_then(|value| value.as_str())
                .is_none()
                && item_matches_query(candidate, &item_query)
        })
        .ok_or_else(|| format!("élément introuvable : {item_query}"))?;
    named_field_value(item, &field)
}

fn named_field_value(item: &OpenedItem, field: &str) -> Result<String, String> {
    let lower = field.to_lowercase();
    if lower == "url" || lower == "urls" || lower == "website" {
        return Ok(item
            .content
            .get("urls")
            .and_then(|value| value.as_array())
            .and_then(|urls| urls.first())
            .and_then(|value| value.as_str())
            .unwrap_or("")
            .to_string());
    }
    if lower == "customfields" {
        return Ok(String::new());
    }
    if let Some(value) = item.content.get(&lower).and_then(|value| value.as_str()) {
        return Ok(value.to_string());
    }
    let custom = item
        .content
        .get("customFields")
        .and_then(|value| value.as_array())
        .and_then(|fields| {
            fields.iter().find(|entry| {
                entry
                    .get("label")
                    .and_then(|value| value.as_str())
                    .is_some_and(|label| label.eq_ignore_ascii_case(field))
            })
        })
        .and_then(|entry| entry.get("value"))
        .and_then(|value| value.as_str())
        .unwrap_or("");
    if custom.is_empty() {
        return Err(format!("champ introuvable : {field}"));
    }
    Ok(custom.to_string())
}

fn parse_env_assignment(raw: &str) -> Result<(String, String, Field), String> {
    let (name, expression) = raw
        .split_once('=')
        .ok_or_else(|| format!("variable d’environnement invalide : {raw}"))?;
    validate_env_name(name)?;
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
        Command::SshSign {
            query,
            file,
            namespace,
        } => {
            let item = opened
                .items
                .iter()
                .find(|item| {
                    item.content.get("type").and_then(|value| value.as_str()) == Some("ssh-key")
                        && item_matches_query(item, &query)
                })
                .ok_or_else(|| format!("clé SSH introuvable : {query}"))?;
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
            let data =
                std::fs::read(&file).map_err(|_| format!("fichier inaccessible : {file}"))?;
            let signature = key
                .sign(&namespace, ssh_key::HashAlg::Sha512, &data)
                .map_err(|error| format!("signature impossible : {error}"))?;
            let pem = signature
                .to_pem(ssh_key::LineEnding::LF)
                .map_err(|error| format!("encodage impossible : {error}"))?;
            write!(output, "{pem}").map_err(|_| "écriture impossible".to_string())?;
        }
        Command::SshConfig { agent } => {
            for item in opened.items.iter().filter(|item| {
                item.content.get("type").and_then(|value| value.as_str()) == Some("ssh-key")
            }) {
                let fingerprint = item
                    .content
                    .get("fingerprint")
                    .and_then(|value| value.as_str())
                    .unwrap_or("");
                let comment = item
                    .content
                    .get("comment")
                    .and_then(|value| value.as_str())
                    .unwrap_or("");
                let host = comment
                    .split_whitespace()
                    .next()
                    .filter(|value| !value.is_empty())
                    .unwrap_or("coffre")
                    .replace(['/', '\\', ' ', '\t'], "-");
                writeln!(output, "# Coffre — {comment} ({fingerprint})")
                    .map_err(|_| "écriture impossible".to_string())?;
                writeln!(output, "Host {host}").map_err(|_| "écriture impossible".to_string())?;
                writeln!(output, "  IdentityAgent {agent}")
                    .map_err(|_| "écriture impossible".to_string())?;
                writeln!(output, "  IdentitiesOnly yes")
                    .map_err(|_| "écriture impossible".to_string())?;
                writeln!(output).map_err(|_| "écriture impossible".to_string())?;
            }
        }
        Command::GitCredential { action, approve } => {
            let mut fields = std::collections::HashMap::new();
            let stdin = std::io::stdin();
            let mut line = String::new();
            while stdin
                .read_line(&mut line)
                .map_err(|_| "lecture stdin impossible".to_string())?
                > 0
            {
                let trimmed = line.trim_end_matches(['\r', '\n']);
                if trimmed.is_empty() {
                    break;
                }
                if let Some((key, value)) = trimmed.split_once('=') {
                    fields.insert(key.to_ascii_lowercase(), value.to_string());
                }
                line.clear();
            }
            if !matches!(action, GitAction::Get) {
                return Ok(ExitCode::SUCCESS);
            }
            if !approve {
                return Err(
                    "approbation requise : relancez avec --approve pour divulguer le mot de passe Git"
                        .into(),
                );
            }
            let host = fields
                .get("host")
                .cloned()
                .or_else(|| fields.get("url").and_then(|url| url_host(url)))
                .ok_or_else(|| "hôte Git absent".to_string())?;
            let wanted_user = fields.get("username").map(|value| value.to_lowercase());
            let item = opened
                .items
                .iter()
                .filter(|item| {
                    item.content.get("type").and_then(|value| value.as_str()) == Some("login")
                })
                .find(|item| {
                    item_matches_host(item, &host)
                        && wanted_user.as_ref().is_none_or(|user| {
                            item.content
                                .get("username")
                                .and_then(|value| value.as_str())
                                .unwrap_or("")
                                .to_lowercase()
                                == *user
                        })
                })
                .ok_or_else(|| "aucun identifiant Git pour cet hôte".to_string())?;
            let username = item
                .content
                .get("username")
                .and_then(|value| value.as_str())
                .unwrap_or("");
            let password = item
                .content
                .get("password")
                .and_then(|value| value.as_str())
                .unwrap_or("");
            if password.is_empty() {
                return Err("mot de passe Git vide".into());
            }
            writeln!(output, "username={username}")
                .map_err(|_| "écriture impossible".to_string())?;
            writeln!(output, "password={password}")
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
        Command::Run {
            env,
            env_file,
            command,
        } => {
            let mut variables = Vec::with_capacity(env.len());
            for raw in &env {
                let (name, query, field) = parse_env_assignment(raw)?;
                let item = find_item(&opened.items, &query)
                    .ok_or_else(|| format!("élément introuvable pour {name}"))?;
                variables.push((name, field_value(item, field)));
            }
            for path in &env_file {
                let text = std::fs::read_to_string(path)
                    .map_err(|_| format!("fichier .env inaccessible : {}", path.display()))?;
                for (line_number, line) in text.lines().enumerate() {
                    let trimmed = line.trim();
                    if trimmed.is_empty() || trimmed.starts_with('#') {
                        continue;
                    }
                    let (name, expression) = trimmed.split_once('=').ok_or_else(|| {
                        format!("{}:{} : variable invalide", path.display(), line_number + 1)
                    })?;
                    validate_env_name(name)?;
                    let expression = expression.trim().trim_matches('"').trim_matches('\'');
                    if !expression.starts_with("coffre://") {
                        return Err(format!(
                            "{}:{} : seule une référence coffre:// est acceptée",
                            path.display(),
                            line_number + 1
                        ));
                    }
                    let value = resolve_coffre_reference(&opened, expression)?;
                    variables.push((name.to_string(), value));
                }
            }
            if variables.is_empty() {
                return Err("aucune variable à injecter (--env ou --env-file)".into());
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
    fn decode_pourcent_sans_couper_un_caractere() {
        assert_eq!(percent_decode("a%20b"), "a b");
        assert_eq!(percent_decode("caf%C3%A9"), "café");
        assert_eq!(percent_decode("100%"), "100%");
        assert_eq!(percent_decode("%4"), "%4");
        assert_eq!(percent_decode("%zz"), "%zz");
        // Un « % » suivi d’un caractère multi-octet ne doit pas faire paniquer
        // le découpage de la chaîne au milieu de ce caractère.
        assert_eq!(percent_decode("%aé"), "%aé");
        assert_eq!(percent_decode("%é"), "%é");
        assert_eq!(percent_decode("été%"), "été%");
    }

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
