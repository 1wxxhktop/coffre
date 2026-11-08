//! Création d’alias via SimpleLogin ou addy.io (F7, opt-in).
//!
//! Les requêtes ne partent que sur action explicite de l’utilisateur. La clé
//! API n’est pas stockée par ce module ; elle est utilisée pour la requête en
//! cours puis oubliée. Les URL des services sont fixes.

use std::time::Duration;

use serde_json::json;

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn alias_create(
    service: String,
    api_key: String,
    description: String,
    domain: Option<String>,
) -> Result<String, String> {
    let api_key = api_key.trim();
    if api_key.is_empty() {
        return Err("Clé API manquante".into());
    }
    let client = client()?;
    let response = match service.as_str() {
        "simplelogin" => client
            .post("https://app.simplelogin.io/api/alias/random/new")
            .header("Authentication", api_key)
            .json(&json!({ "hostname": description }))
            .send()
            .await
            .map_err(|error| error.to_string())?,
        "addy" => {
            let mut body = json!({ "description": description });
            if let Some(domain) = domain.filter(|value| !value.trim().is_empty()) {
                body["domain"] = json!(domain.trim());
            }
            client
                .post("https://app.addy.io/api/v1/aliases")
                .header("Authorization", format!("Bearer {api_key}"))
                .header("Accept", "application/json")
                .json(&body)
                .send()
                .await
                .map_err(|error| error.to_string())?
        }
        _ => return Err("Service d’alias inconnu".into()),
    };
    if !response.status().is_success() {
        return Err(format!(
            "Le service d’alias a répondu avec le statut {}",
            response.status()
        ));
    }
    let text = response.text().await.map_err(|error| error.to_string())?;
    if text.len() > 100_000 {
        return Err("Réponse du service d’alias trop volumineuse".into());
    }
    let value: serde_json::Value =
        serde_json::from_str(&text).map_err(|_| "Réponse du service illisible".to_string())?;
    let alias = if service == "simplelogin" {
        value.get("alias").and_then(|value| value.as_str())
    } else {
        value
            .get("data")
            .and_then(|data| data.get("email"))
            .and_then(|value| value.as_str())
    };
    alias
        .filter(|alias| alias.contains('@') && alias.len() <= 320)
        .map(|alias| alias.to_string())
        .ok_or_else(|| "Le service n’a pas renvoyé d’alias valide".into())
}
