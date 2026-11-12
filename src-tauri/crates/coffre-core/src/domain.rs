//! Correspondance de domaines pour le remplissage et les extensions natives.
//!
//! La règle reprend exactement `loginAllowsHost` côté TypeScript et lit la même
//! liste de suffixes publics (`src/lib/public-suffixes.json`). Elle ne renvoie
//! jamais de secret.

use std::collections::HashSet;
use std::net::IpAddr;
use std::sync::OnceLock;

use url::Url;

const PUBLIC_SUFFIXES_JSON: &str = include_str!("../../../../src/lib/public-suffixes.json");

fn public_suffixes() -> &'static HashSet<String> {
    static SUFFIXES: OnceLock<HashSet<String>> = OnceLock::new();
    SUFFIXES.get_or_init(|| serde_json::from_str(PUBLIC_SUFFIXES_JSON).unwrap_or_default())
}

fn normalize_host(host: &str) -> String {
    host.trim_start_matches('[')
        .trim_end_matches(']')
        .trim_end_matches('.')
        .to_ascii_lowercase()
}

pub(crate) fn is_ip_address(host: &str) -> bool {
    host.parse::<IpAddr>().is_ok()
}

pub(crate) fn is_public_suffix(host: &str) -> bool {
    public_suffixes().contains(host)
}

/// Domaine enregistrable (eTLD+1), ou `None` pour une IP, `localhost`, un hôte
/// d’une seule étiquette ou un suffixe public.
pub fn registrable_domain(host: &str) -> Option<String> {
    let value = normalize_host(host);
    if value.is_empty() || is_ip_address(&value) || value == "localhost" || !value.contains('.') {
        return None;
    }
    let labels: Vec<&str> = value.split('.').collect();
    for index in 0..labels.len() {
        if public_suffixes().contains(&labels[index..].join(".")) {
            if index == 0 {
                return None;
            }
            return Some(labels[index - 1..].join("."));
        }
    }
    Some(labels[labels.len() - 2..].join("."))
}

fn looks_like_scheme(value: &str) -> bool {
    let Some(colon) = value.find(':') else {
        return false;
    };
    let prefix = &value[..colon];
    !prefix.is_empty()
        && prefix
            .chars()
            .next()
            .is_some_and(|character| character.is_ascii_alphabetic())
        && prefix.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '+' | '-' | '.')
        })
}

fn is_host_port(value: &str) -> bool {
    let Some((host, rest)) = value.split_once(':') else {
        return false;
    };
    let port = rest.split('/').next().unwrap_or_default();
    !host.is_empty() && !port.is_empty() && port.bytes().all(|byte| byte.is_ascii_digit())
}

/// Analyse un hôte ou une URL de service. Un hôte sans schéma est supposé
/// HTTPS ; `hôte:port` est accepté, les autres schémas sont refusés.
fn parse_web_url(value: &str) -> Option<Url> {
    let raw = value.trim();
    if raw.is_empty() {
        return None;
    }
    let candidate = if raw.contains("://") || raw.starts_with("http:") || raw.starts_with("https:")
    {
        raw.to_string()
    } else if is_host_port(raw) {
        format!("https://{raw}")
    } else if looks_like_scheme(raw) {
        return None;
    } else {
        format!("https://{raw}")
    };
    let url = Url::parse(&candidate).ok()?;
    if url.scheme() != "http" && url.scheme() != "https" {
        return None;
    }
    url.host_str()?;
    Some(url)
}

fn host_matches(item_host: &str, page_host: &str) -> bool {
    let item = normalize_host(item_host);
    let page = normalize_host(page_host);
    if item.is_empty() || page.is_empty() {
        return false;
    }
    if item == page {
        return true;
    }
    if is_ip_address(&item) || is_ip_address(&page) {
        return false;
    }
    if is_public_suffix(&item) || is_public_suffix(&page) {
        return false;
    }
    // Correspondance exacte, avec la seule exception `www.` : un sous-domaine
    // contrôlé par un tiers ne doit pas recevoir le secret du domaine parent.
    item == format!("www.{page}") || page == format!("www.{item}")
}

/// Vrai si l’URL de l’élément autorise le remplissage pour ce service.
///
/// Les ports explicites sont comparés, un élément HTTPS exige une page HTTPS,
/// et deux hôtes ne correspondent que dans le même domaine enregistrable.
pub fn login_allows_host(item_url: &str, service: &str) -> bool {
    let Some(item) = parse_web_url(item_url) else {
        return false;
    };
    let Some(page) = parse_web_url(service) else {
        return false;
    };
    if item.scheme() == "https" && page.scheme() == "http" {
        return false;
    }
    if item.port().is_some() && item.port() != page.port() {
        return false;
    }
    let (Some(item_host), Some(page_host)) = (item.host_str(), page.host_str()) else {
        return false;
    };
    host_matches(item_host, page_host)
}

/// Extrait l’hôte normalisé d’une URL de connexion, pour les résumés.
pub fn host_from_url(value: &str) -> Option<String> {
    parse_web_url(value).map(|url| normalize_host(url.host_str().unwrap_or_default()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn calcule_les_domaines_enregistrables() {
        assert_eq!(
            registrable_domain("login.example.com").as_deref(),
            Some("example.com")
        );
        assert_eq!(
            registrable_domain("example.co.uk").as_deref(),
            Some("example.co.uk")
        );
        assert_eq!(
            registrable_domain("evil.github.io").as_deref(),
            Some("evil.github.io")
        );
        assert_eq!(registrable_domain("github.io"), None);
        assert_eq!(registrable_domain("localhost"), None);
        assert_eq!(registrable_domain("127.0.0.1"), None);
    }

    #[test]
    fn refuse_les_schemas_et_ports_inattendus() {
        assert!(!login_allows_host(
            "https://example.com",
            "http://example.com"
        ));
        assert!(login_allows_host(
            "http://example.com",
            "https://example.com"
        ));
        assert!(!login_allows_host(
            "https://example.com:8443",
            "https://example.com"
        ));
        assert!(login_allows_host(
            "https://example.com",
            "https://example.com:8443"
        ));
        assert!(!login_allows_host(
            "https://example.com",
            "javascript:alert(1)"
        ));
        assert!(!login_allows_host(
            "https://example.com",
            "https://login.example.com"
        ));
        assert!(login_allows_host(
            "https://example.com",
            "https://www.example.com"
        ));
    }
}
