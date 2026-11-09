//! Requêtes de remplissage pour les extensions natives.
//!
//! Les résumés et les identités ne contiennent que des métadonnées. Le mot de
//! passe et le code TOTP ne sortent que par `reveal_login`, pour l’élément
//! explicitement demandé.

use std::collections::HashSet;

use serde::Serialize;
use zeroize::Zeroizing;

use crate::domain::{host_from_url, login_allows_host};
use crate::{CoreError, OpenedItem, OpenedVault, parse_totp_uri};

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoginSummary {
    pub id: String,
    pub vault_id: String,
    pub title: String,
    pub username: String,
    pub host: String,
    pub has_totp: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CredentialIdentity {
    pub item_id: String,
    pub username: String,
    pub service: String,
}

#[derive(Debug)]
pub struct RevealedLogin {
    pub id: String,
    pub username: String,
    pub password: Zeroizing<String>,
    pub totp_code: Option<String>,
    pub urls: Vec<String>,
}

fn field<'a>(item: &'a OpenedItem, name: &str) -> Option<&'a str> {
    item.content.get(name).and_then(serde_json::Value::as_str)
}

fn urls(item: &OpenedItem) -> Vec<String> {
    item.content
        .get("urls")
        .and_then(serde_json::Value::as_array)
        .map(|values| {
            values
                .iter()
                .filter_map(serde_json::Value::as_str)
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default()
}

fn active_login(item: &OpenedItem) -> bool {
    field(item, "type") == Some("login")
        && item
            .content
            .get("deletedAt")
            .and_then(serde_json::Value::as_str)
            .is_none()
}

fn ensure_readable(opened: &OpenedVault) -> Result<(), CoreError> {
    if opened.read_only {
        return Err(CoreError::InvalidFormat(
            "Coffre en lecture seule : vérifiez l’intégrité dans l’application.".into(),
        ));
    }
    Ok(())
}

/// Connexions actives dont une URL autorise ce service. Aucun secret.
pub fn logins_for_service(
    opened: &OpenedVault,
    service: &str,
) -> Result<Vec<LoginSummary>, CoreError> {
    ensure_readable(opened)?;
    let mut result = Vec::new();
    for item in opened.items.iter().filter(|item| active_login(item)) {
        let urls = urls(item);
        let Some(host) = urls
            .iter()
            .find(|url| login_allows_host(url, service))
            .and_then(|url| host_from_url(url))
        else {
            continue;
        };
        result.push(LoginSummary {
            id: item.id.clone(),
            vault_id: item.vault_id.clone(),
            title: field(item, "title").unwrap_or("Sans titre").to_string(),
            username: field(item, "username").unwrap_or_default().to_string(),
            host,
            has_totp: field(item, "totp").is_some_and(|value| !value.is_empty()),
        });
    }
    result.sort_by(|left, right| {
        left.title
            .to_lowercase()
            .cmp(&right.title.to_lowercase())
            .then_with(|| left.username.cmp(&right.username))
    });
    Ok(result)
}

/// Mot de passe et code TOTP du seul élément demandé.
pub fn reveal_login(
    opened: &OpenedVault,
    item_id: &str,
    now_unix: u64,
) -> Result<RevealedLogin, CoreError> {
    ensure_readable(opened)?;
    let item = opened
        .items
        .iter()
        .find(|item| item.id == item_id && active_login(item))
        .ok_or_else(|| CoreError::InvalidFormat("connexion introuvable".into()))?;
    let totp_code = field(item, "totp")
        .filter(|value| !value.is_empty())
        .and_then(|uri| parse_totp_uri(uri).ok())
        .and_then(|config| config.code_at(now_unix).ok());
    Ok(RevealedLogin {
        id: item.id.clone(),
        username: field(item, "username").unwrap_or_default().to_string(),
        password: Zeroizing::new(field(item, "password").unwrap_or_default().to_string()),
        totp_code,
        urls: urls(item),
    })
}

/// Identités `(élément, utilisateur, domaine)` à publier dans le magasin du
/// système. Aucun mot de passe ni code TOTP.
pub fn credential_identities(opened: &OpenedVault) -> Result<Vec<CredentialIdentity>, CoreError> {
    ensure_readable(opened)?;
    let mut seen = HashSet::new();
    let mut result = Vec::new();
    for item in opened.items.iter().filter(|item| active_login(item)) {
        let username = field(item, "username").unwrap_or_default().to_string();
        for service in urls(item).iter().filter_map(|url| host_from_url(url)) {
            if seen.insert((item.id.clone(), username.clone(), service.clone())) {
                result.push(CredentialIdentity {
                    item_id: item.id.clone(),
                    username: username.clone(),
                    service,
                });
            }
        }
    }
    result.sort_by(|left, right| {
        left.service
            .cmp(&right.service)
            .then_with(|| left.username.cmp(&right.username))
    });
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn garde_les_connexions_actives() {
        assert!(active_login(&OpenedItem {
            id: "i1".into(),
            vault_id: "v1".into(),
            content: serde_json::json!({
                "type": "login",
                "deletedAt": null,
                "username": "u",
                "password": "secret",
                "urls": ["https://example.com"]
            }),
            created_at: String::new(),
            updated_at: String::new(),
        }));
    }
}
