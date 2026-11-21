//! Remplissage Android : cache mémoire des connexions.
//!
//! Le coffre est déverrouillé dans la WebView. L’interface publie alors les
//! connexions utilisables (titre, identifiant, mot de passe, adresses) dans ce
//! cache, et le service Android `AutofillService` le lit par JNI.
//!
//! Rien n’est écrit sur le disque : le cache vit uniquement dans la mémoire du
//! processus. Le verrouillage le vide, et une durée de validité native évite
//! qu’il survive au délai de verrouillage automatique lorsque la WebView est
//! en arrière-plan et que ses minuteurs sont ralentis par Android.
//!
//! Les mots de passe ne sont jamais journalisés. Seules les URL des éléments
//! dont l’hôte correspond exactement (ou avec `www.`) à la page affichée sont
//! proposées, avec la même règle que l’extension et le pont natif
//! (`coffre_core::login_allows_host`).

use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
#[cfg(target_os = "android")]
use zeroize::Zeroizing;
use zeroize::{Zeroize, ZeroizeOnDrop};

#[cfg(any(target_os = "android", test))]
use coffre_core::login_allows_host;

/// Plafond de sécurité : un coffre très volumineux ne doit pas remplir la
/// mémoire du processus avec une seconde copie complète.
const MAX_ENTRIES: usize = 5_000;
/// Nombre de propositions affichées par le système pour un champ.
#[cfg(any(target_os = "android", test))]
const MAX_MATCHES: usize = 8;
const MAX_FIELD_CHARS: usize = 4_096;
const MAX_URLS: usize = 16;
const MAX_URL_CHARS: usize = 2_048;
/// Une durée de validité native ne dépasse pas un jour, même si l’interface
/// se trompe.
const MAX_TTL_SECONDS: u64 = 86_400;

/// Connexion mise à disposition du service Android.
///
/// `Debug` est volontairement absent : une trace ne doit jamais contenir le
/// mot de passe. Les chaînes sont effacées lorsqu’elles sont libérées.
#[derive(Clone, Deserialize, Serialize, Zeroize, ZeroizeOnDrop)]
#[serde(rename_all = "camelCase")]
pub struct AutofillEntry {
    pub id: String,
    pub title: String,
    pub username: String,
    pub password: String,
    pub urls: Vec<String>,
}

struct Cache {
    // Les entrées ne sont lues que par le service Android et les tests.
    #[cfg_attr(not(any(target_os = "android", test)), allow(dead_code))]
    entries: Vec<AutofillEntry>,
    expires_at: Option<Instant>,
}

static CACHE: Mutex<Option<Cache>> = Mutex::new(None);

fn limit_chars(value: &mut String, max: usize) {
    if value.chars().count() > max {
        let truncated: String = value.chars().take(max).collect();
        value.zeroize();
        *value = truncated;
    }
}

fn sanitize(mut entry: AutofillEntry) -> Option<AutofillEntry> {
    limit_chars(&mut entry.id, 256);
    limit_chars(&mut entry.title, MAX_FIELD_CHARS);
    limit_chars(&mut entry.username, MAX_FIELD_CHARS);
    limit_chars(&mut entry.password, MAX_FIELD_CHARS);
    entry.urls.retain(|url| !url.trim().is_empty());
    entry.urls.truncate(MAX_URLS);
    for url in &mut entry.urls {
        limit_chars(url, MAX_URL_CHARS);
    }
    // Une entrée sans mot de passe remplirait un champ vide : elle n’a pas sa
    // place dans le cache de remplissage.
    if entry.password.is_empty() || entry.urls.is_empty() {
        return None;
    }
    Some(entry)
}

fn expiry(ttl_seconds: u64, now: Instant) -> Option<Instant> {
    let ttl = ttl_seconds.min(MAX_TTL_SECONDS);
    (ttl > 0).then(|| now + Duration::from_secs(ttl))
}

fn publish_at(entries: Vec<AutofillEntry>, ttl_seconds: u64, now: Instant) {
    let mut entries: Vec<AutofillEntry> = entries
        .into_iter()
        .filter_map(sanitize)
        .take(MAX_ENTRIES)
        .collect();
    // Réduire avant de stocker : les entrées au-delà du plafond sont libérées
    // et effacées par `ZeroizeOnDrop`.
    entries.shrink_to_fit();
    let next = Cache {
        entries,
        expires_at: expiry(ttl_seconds, now),
    };
    if let Ok(mut cache) = CACHE.lock() {
        *cache = Some(next);
    }
}

/// Remplace le cache par les connexions fournies par l’interface.
pub fn publish(entries: Vec<AutofillEntry>, ttl_seconds: u64) {
    publish_at(entries, ttl_seconds, Instant::now());
}

/// Prolonge la validité du cache sans renvoyer les secrets.
///
/// Un cache déjà expiré n’est jamais ressuscité : le battement de la WebView
/// peut arriver après l’échéance si Android a suspendu ses minuteurs. Le
/// booléen indique si le cache est encore utilisable ; l’interface republie
/// les entrées lorsqu’il ne l’est plus.
pub fn touch(ttl_seconds: u64) -> bool {
    let now = Instant::now();
    if let Ok(mut cache) = CACHE.lock() {
        match cache.as_mut() {
            Some(current) if !cache_is_expired(current, now) => {
                current.expires_at = expiry(ttl_seconds, now);
                return true;
            }
            Some(_) => {
                *cache = None;
            }
            None => {}
        }
    }
    false
}

/// Vide immédiatement le cache (verrouillage, désactivation du réglage).
pub fn clear() {
    if let Ok(mut cache) = CACHE.lock() {
        *cache = None;
    }
}

fn cache_is_expired(cache: &Cache, now: Instant) -> bool {
    cache.expires_at.is_some_and(|expires_at| now >= expires_at)
}

/// Vrai si le coffre est déverrouillé et que le cache n’a pas expiré.
#[cfg(any(target_os = "android", test))]
pub fn unlocked() -> bool {
    let now = Instant::now();
    match CACHE.lock() {
        Ok(mut cache) => {
            if cache
                .as_ref()
                .is_some_and(|value| cache_is_expired(value, now))
            {
                *cache = None;
            }
            cache.is_some()
        }
        Err(_) => false,
    }
}

#[cfg(any(target_os = "android", test))]
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MatchPayload {
    unlocked: bool,
    items: Vec<AutofillEntry>,
}

/// Charge utile JSON lue par le service Android.
///
/// `service` est le domaine fourni par Android, ou `schéma://domaine` lorsque
/// le schéma est disponible (Android 9+). Une valeur vide ne propose rien : le
/// service ne doit pas exposer la liste complète des connexions à une
/// application qui ne présente pas de formulaire web identifiable.
#[cfg(any(target_os = "android", test))]
pub fn match_payload(service: &str) -> String {
    let now = Instant::now();
    let mut guard = match CACHE.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };
    if guard
        .as_ref()
        .is_some_and(|cache| cache_is_expired(cache, now))
    {
        *guard = None;
    }
    let Some(cache) = guard.as_ref() else {
        return r#"{"unlocked":false,"items":[]}"#.to_string();
    };
    let service = service.trim();
    let items: Vec<AutofillEntry> = if service.is_empty() {
        Vec::new()
    } else {
        cache
            .entries
            .iter()
            .filter(|entry| entry.urls.iter().any(|url| login_allows_host(url, service)))
            .take(MAX_MATCHES)
            .cloned()
            .collect()
    };
    serde_json::to_string(&MatchPayload {
        unlocked: true,
        items,
    })
    .unwrap_or_else(|_| r#"{"unlocked":true,"items":[]}"#.to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutofillStatus {
    pub supported: bool,
    pub service_enabled: bool,
    pub unlocked: bool,
}

/// Lit un booléen dans `CoffreApplication` par JNI.
#[cfg(target_os = "android")]
fn application_bool(method: &str) -> bool {
    let context = ndk_context::android_context();
    let Ok(vm) = (unsafe { jni::JavaVM::from_raw(context.vm().cast()) }) else {
        return false;
    };
    let Ok(mut env) = vm.attach_current_thread() else {
        return false;
    };
    let application = unsafe { jni::objects::JObject::from_raw(context.context().cast()) };
    env.call_method(&application, method, "()Z", &[])
        .ok()
        .and_then(|value| value.z().ok())
        .unwrap_or(false)
}

/// Enregistre le cache puis renvoie `Ok`. Sur desktop, la commande n’est pas
/// utilisée : l’interface ne l’appelle que sur Android.
#[tauri::command]
pub fn android_autofill_publish(
    entries: Vec<AutofillEntry>,
    ttl_seconds: u64,
) -> Result<(), String> {
    publish(entries, ttl_seconds);
    Ok(())
}

/// Prolonge la validité du cache (passage en arrière-plan, battement visible).
#[tauri::command]
pub fn android_autofill_touch(ttl_seconds: u64) -> bool {
    touch(ttl_seconds)
}

/// Vide le cache au verrouillage ou à la désactivation du remplissage.
#[tauri::command]
pub fn android_autofill_clear() {
    clear();
}

/// État du service pour l’écran de réglages.
#[tauri::command]
pub fn android_autofill_status() -> AutofillStatus {
    #[cfg(target_os = "android")]
    {
        let supported = application_bool("isAutofillSupported");
        AutofillStatus {
            supported,
            service_enabled: supported && application_bool("isAutofillServiceEnabled"),
            unlocked: unlocked(),
        }
    }
    #[cfg(not(target_os = "android"))]
    {
        AutofillStatus {
            supported: false,
            service_enabled: false,
            unlocked: false,
        }
    }
}

/// Ouvre l’écran Android de sélection du service de remplissage.
#[tauri::command]
pub fn android_autofill_open_settings() -> Result<bool, String> {
    #[cfg(target_os = "android")]
    {
        Ok(application_bool("openAutofillSettings"))
    }
    #[cfg(not(target_os = "android"))]
    {
        Err("unsupported".into())
    }
}

/// Lit le cache depuis le service Android. Le nom JNI correspond à l’objet
/// Kotlin `CoffreAutofillBridge` (voir `CoffreAutofillBridge.kt`).
#[cfg(target_os = "android")]
#[unsafe(no_mangle)]
pub extern "system" fn Java_app_coffre_desktop_CoffreAutofillBridge_nativeMatch(
    mut env: jni::JNIEnv<'_>,
    _this: jni::objects::JObject<'_>,
    service: jni::objects::JString<'_>,
) -> jni::sys::jstring {
    let service = env
        .get_string(&service)
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_default();
    let payload = Zeroizing::new(match_payload(&service));
    match env.new_string(payload.as_str()) {
        Ok(value) => value.into_raw(),
        Err(_) => {
            let _ = env.exception_clear();
            std::ptr::null_mut()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::MutexGuard;

    static TEST_LOCK: Mutex<()> = Mutex::new(());

    fn guard() -> MutexGuard<'static, ()> {
        let guard = TEST_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        clear();
        guard
    }

    /// Valeur de test dérivée du libellé et du processus : jamais un secret
    /// réel, et aucune constante qui ressemble à un mot de passe.
    fn test_password(label: &str) -> String {
        let mut value = String::with_capacity(label.len() + 8);
        value.push_str(label);
        value.push('-');
        value.push_str(&std::process::id().to_string());
        value
    }

    fn entry(title: &str, username: &str, urls: &[&str]) -> AutofillEntry {
        AutofillEntry {
            id: title.to_lowercase(),
            title: title.into(),
            username: username.into(),
            password: test_password(title),
            urls: urls.iter().map(|url| (*url).into()).collect(),
        }
    }

    #[test]
    fn propose_uniquement_le_domaine_correspondant() {
        let _guard = guard();
        publish(
            vec![
                entry("Exemple", "alice", &["https://example.com/login"]),
                entry("Autre", "bob", &["https://autre.example/login"]),
            ],
            0,
        );
        let payload = match_payload("example.com");
        let value: serde_json::Value = serde_json::from_str(&payload).unwrap();
        assert_eq!(value["unlocked"], true);
        assert_eq!(value["items"].as_array().unwrap().len(), 1);
        assert_eq!(value["items"][0]["username"], "alice");
        assert_eq!(value["items"][0]["password"], test_password("Exemple"));
        assert!(!payload.contains(&test_password("Autre")));
    }

    #[test]
    fn refuse_une_page_http_pour_un_element_https() {
        let _guard = guard();
        publish(vec![entry("Exemple", "alice", &["https://example.com"])], 0);
        assert!(match_payload("https://example.com").contains(&test_password("Exemple")));
        assert!(!match_payload("http://example.com").contains(&test_password("Exemple")));
    }

    #[test]
    fn accepte_www_mais_pas_un_sous_domaine_tiers() {
        let _guard = guard();
        publish(
            vec![
                entry("Sans www", "alice", &["https://example.com"]),
                entry("Sous-domaine", "bob", &["https://login.example.com"]),
            ],
            0,
        );
        let payload = match_payload("www.example.com");
        let value: serde_json::Value = serde_json::from_str(&payload).unwrap();
        assert_eq!(value["items"].as_array().unwrap().len(), 1);
        assert_eq!(value["items"][0]["title"], "Sans www");
        assert!(match_payload("login.example.com").contains(&test_password("Sous-domaine")));
        assert!(!match_payload("evil.example").contains(&test_password("Sans www")));
    }

    #[test]
    fn ne_propose_rien_sans_domaine_ni_sans_mot_de_passe() {
        let _guard = guard();
        let mut sans_mot_de_passe = entry("Sans mot de passe", "alice", &["https://example.com"]);
        sans_mot_de_passe.password.clear();
        let sans_adresse = entry("Sans adresse", "bob", &[]);
        publish(vec![sans_mot_de_passe, sans_adresse], 0);
        let payload = match_payload("");
        let value: serde_json::Value = serde_json::from_str(&payload).unwrap();
        assert_eq!(value["unlocked"], true);
        assert_eq!(value["items"].as_array().unwrap().len(), 0);
        assert!(!payload.contains(&test_password("Sans mot de passe")));
    }

    #[test]
    fn vide_et_expire_le_cache() {
        let _guard = guard();
        let old = Instant::now() - Duration::from_secs(10);
        publish_at(
            vec![entry("Exemple", "alice", &["https://example.com"])],
            5,
            old,
        );
        let payload = match_payload("example.com");
        let value: serde_json::Value = serde_json::from_str(&payload).unwrap();
        assert_eq!(value["unlocked"], false);
        assert!(!unlocked());

        publish(vec![entry("Exemple", "alice", &["https://example.com"])], 0);
        assert!(unlocked());
        clear();
        assert!(!unlocked());
    }

    #[test]
    fn prolonge_la_validite_sans_renvoyer_les_secrets() {
        let _guard = guard();
        publish(vec![entry("Exemple", "alice", &["https://example.com"])], 1);
        assert!(touch(60));
        let payload = match_payload("example.com");
        assert!(payload.contains(&test_password("Exemple")));
    }

    #[test]
    fn ne_ressuscite_pas_un_cache_expire() {
        let _guard = guard();
        let old = Instant::now() - Duration::from_secs(10);
        publish_at(
            vec![entry("Exemple", "alice", &["https://example.com"])],
            5,
            old,
        );
        assert!(!touch(60));
        let payload = match_payload("example.com");
        let value: serde_json::Value = serde_json::from_str(&payload).unwrap();
        assert_eq!(value["unlocked"], false);
        assert!(!payload.contains(&test_password("Exemple")));
    }

    #[test]
    fn plafonne_les_entrees_et_les_champs() {
        let _guard = guard();
        let seed = std::process::id().to_string();
        let long = seed.repeat((MAX_FIELD_CHARS / seed.len()) + 2);
        let mut sample = entry("Long", &long, &[&long]);
        sample.password = long.clone();
        publish(vec![sample], 0);
        let payload = match_payload("example.com");
        assert!(!payload.contains(&long));

        let many: Vec<AutofillEntry> = (0..(MAX_ENTRIES + 10))
            .map(|index| {
                entry(
                    &format!("Entrée {index}"),
                    "alice",
                    &["https://example.com"],
                )
            })
            .collect();
        publish(many, 0);
        let value: serde_json::Value = serde_json::from_str(&match_payload("example.com")).unwrap();
        assert!(value["items"].as_array().unwrap().len() <= MAX_MATCHES);
    }
}
