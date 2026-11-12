//! Saisie automatique dans l’application de bureau active (F9).
//!
//! La séquence est compatible avec la syntaxe KeePass de base :
//! `{USERNAME}`, `{PASSWORD}`, `{TOTP}`, `{TAB}`, `{ENTER}`, `{SPACE}`,
//! `{BACKSPACE}`, `{ESC}`, `{DELAY 500}` et `{{` / `}}`.
//!
//! La fenêtre active est vérifiée avant chaque jeton ; si le focus change,
//! la séquence est interrompue. Aucun secret n’est journalisé.

use active_win_pos_rs::get_active_window;
use enigo::{Direction, Enigo, Key, Keyboard, Settings};
use serde::Serialize;
use std::time::Duration;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActiveWindowInfo {
    pub title: String,
    pub app_name: String,
    pub process_path: String,
    pub window_id: String,
    pub process_id: u64,
}

fn current_window() -> Result<ActiveWindowInfo, String> {
    let window =
        get_active_window().map_err(|_| "Impossible d’identifier la fenêtre active".to_string())?;
    Ok(ActiveWindowInfo {
        title: window.title,
        app_name: window.app_name,
        process_path: window.process_path.to_string_lossy().to_string(),
        window_id: window.window_id,
        process_id: window.process_id,
    })
}

#[tauri::command]
pub fn autotype_active_window() -> Result<ActiveWindowInfo, String> {
    current_window()
}

fn same_window(expected: &ActiveWindowInfo, current: &ActiveWindowInfo) -> bool {
    expected.window_id == current.window_id && expected.process_id == current.process_id
}

fn is_coffre_window(window: &ActiveWindowInfo) -> bool {
    let haystack = format!(
        "{} {} {}",
        window.title, window.app_name, window.process_path
    )
    .to_lowercase();
    haystack.contains("coffre")
}

fn ensure_focus(expected: &ActiveWindowInfo) -> Result<(), String> {
    let current = current_window()?;
    if same_window(expected, &current) {
        Ok(())
    } else {
        Err("Le focus a changé : saisie automatique annulée".into())
    }
}

enum Token {
    Text(String),
    Key(Key),
    Delay(u64),
}

fn expand_token(name: &str, username: &str, password: &str, totp: &str) -> Result<Token, String> {
    let upper = name.trim().to_ascii_uppercase();
    if let Some(delay) = upper.strip_prefix("DELAY ") {
        let millis = delay
            .trim()
            .parse::<u64>()
            .map_err(|_| format!("Délai invalide : {name}"))?;
        if millis > 60_000 {
            return Err("Délai supérieur à 60 secondes".into());
        }
        return Ok(Token::Delay(millis));
    }
    match upper.as_str() {
        "USERNAME" => Ok(Token::Text(username.to_string())),
        "PASSWORD" => Ok(Token::Text(password.to_string())),
        "TOTP" => Ok(Token::Text(totp.to_string())),
        "TAB" => Ok(Token::Key(Key::Tab)),
        "ENTER" | "RETURN" => Ok(Token::Key(Key::Return)),
        "SPACE" => Ok(Token::Key(Key::Space)),
        "BACKSPACE" => Ok(Token::Key(Key::Backspace)),
        "DELETE" => Ok(Token::Key(Key::Delete)),
        "ESC" | "ESCAPE" => Ok(Token::Key(Key::Escape)),
        _ => Err(format!("Jeton de saisie inconnu : {{{name}}}")),
    }
}

fn parse_sequence(
    sequence: &str,
    username: &str,
    password: &str,
    totp: &str,
) -> Result<Vec<Token>, String> {
    let mut tokens = Vec::new();
    let mut text = String::new();
    let mut characters = sequence.chars().peekable();
    while let Some(character) = characters.next() {
        match character {
            '{' if characters.peek() == Some(&'{') => {
                characters.next();
                text.push('{');
            }
            '}' if characters.peek() == Some(&'}') => {
                characters.next();
                text.push('}');
            }
            '{' => {
                if !text.is_empty() {
                    tokens.push(Token::Text(std::mem::take(&mut text)));
                }
                let mut name = String::new();
                let mut closed = false;
                for inner in characters.by_ref() {
                    if inner == '}' {
                        closed = true;
                        break;
                    }
                    name.push(inner);
                }
                if !closed {
                    return Err("Jeton de saisie non terminé".into());
                }
                tokens.push(expand_token(&name, username, password, totp)?);
            }
            other => text.push(other),
        }
    }
    if !text.is_empty() {
        tokens.push(Token::Text(text));
    }
    Ok(tokens)
}

#[tauri::command]
pub fn autotype_run(
    sequence: String,
    username: String,
    password: String,
    totp: String,
    expected_window_id: String,
    expected_process_id: u64,
) -> Result<usize, String> {
    if sequence.len() > 4_000 {
        return Err("Séquence de saisie trop longue".into());
    }
    if username.len() > 4_096 || password.len() > 4_096 || totp.len() > 4_096 {
        return Err("Valeur de saisie trop longue".into());
    }
    // La WebView ne doit pas pouvoir injecter des frappes dans Coffre lui-même.
    let active = current_window()?;
    if is_coffre_window(&active) {
        return Err("La saisie automatique est refusée dans Coffre".into());
    }
    let expected = ActiveWindowInfo {
        title: String::new(),
        app_name: String::new(),
        process_path: String::new(),
        window_id: expected_window_id,
        process_id: expected_process_id,
    };
    ensure_focus(&expected)?;
    let password = zeroize::Zeroizing::new(password);
    let totp = zeroize::Zeroizing::new(totp);
    let tokens = parse_sequence(&sequence, &username, &password, &totp)?;
    let mut enigo = Enigo::new(&Settings::default()).map_err(|error| {
        format!(
            "Saisie automatique indisponible : autorisez Coffre dans Accessibilité (macOS) ou vérifiez les permissions du système. {error}"
        )
    })?;
    let mut typed = 0usize;
    for token in tokens {
        ensure_focus(&expected)?;
        match token {
            Token::Text(value) => {
                if value.is_empty() {
                    continue;
                }
                // Vérifier le focus entre chaque caractère réduit la fenêtre
                // pendant laquelle une bascule de fenêtre pourrait détourner
                // une partie du secret.
                for character in value.chars() {
                    ensure_focus(&expected)?;
                    enigo
                        .text(&character.to_string())
                        .map_err(|error| format!("Saisie impossible : {error}"))?;
                    typed += 1;
                }
            }
            Token::Key(key) => {
                enigo
                    .key(key, Direction::Click)
                    .map_err(|error| format!("Touche impossible : {error}"))?;
                typed += 1;
            }
            Token::Delay(millis) => {
                std::thread::sleep(Duration::from_millis(millis));
                ensure_focus(&expected)?;
            }
        }
    }
    Ok(typed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn analyse_une_sequence_keepass() {
        let tokens = parse_sequence(
            "{USERNAME}{TAB}{PASSWORD}{ENTER}",
            "ada",
            "secret",
            "123456",
        )
        .unwrap();
        assert_eq!(tokens.len(), 4);
        let tokens = parse_sequence("{DELAY 500}{TOTP}", "ada", "secret", "123456").unwrap();
        assert_eq!(tokens.len(), 2);
    }

    #[test]
    fn refuse_la_fenetre_coffre() {
        let window = ActiveWindowInfo {
            title: "Coffre".into(),
            app_name: "Coffre".into(),
            process_path: "/Applications/Coffre.app".into(),
            window_id: "1".into(),
            process_id: 1,
        };
        assert!(is_coffre_window(&window));
        let other = ActiveWindowInfo {
            title: "Terminal".into(),
            app_name: "Terminal".into(),
            process_path: "/Applications/Utilities/Terminal.app".into(),
            window_id: "2".into(),
            process_id: 2,
        };
        assert!(!is_coffre_window(&other));
    }

    #[test]
    fn refuse_un_jeton_inconnu() {
        assert!(parse_sequence("{INCONNU}", "", "", "").is_err());
    }

    #[test]
    fn accepte_les_accolades_litterales() {
        let tokens = parse_sequence("{{ok}}", "", "", "").unwrap();
        match &tokens[0] {
            Token::Text(value) => assert_eq!(value, "{ok}"),
            _ => panic!("texte attendu"),
        }
    }
}
