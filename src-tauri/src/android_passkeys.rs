//! Passkeys WebAuthn pour le fournisseur Android.
//!
//! Le coffre est déverrouillé dans la WebView : l’interface publie les
//! passkeys actives dans ce cache mémoire. Le service Android
//! `CredentialProviderService` liste les passkeys correspondant au domaine, et
//! l’activité de sélection demande une signature à Rust après authentification.
//!
//! Les clés privées ne quittent jamais Rust par les commandes de liste. Elles
//! sont effacées par `zeroize` au remplacement, au verrouillage et à la fin du
//! processus. Aucun fichier ni journal ne les contient.

use std::sync::Mutex;
use std::time::{Duration, Instant};

#[cfg(any(target_os = "android", test))]
use base64::Engine;
#[cfg(any(target_os = "android", test))]
use base64::engine::general_purpose::STANDARD;
#[cfg(any(target_os = "android", test))]
use coffre_core::{StoredPasskey, assert_passkey_with_hash};
use serde::{Deserialize, Serialize};
use zeroize::{Zeroize, ZeroizeOnDrop};

const MAX_ENTRIES: usize = 2_000;
#[cfg(any(target_os = "android", test))]
const MAX_MATCHES: usize = 20;
const MAX_FIELD_CHARS: usize = 4_096;
const MAX_TTL_SECONDS: u64 = 86_400;

#[derive(Clone, Deserialize, Serialize, Zeroize, ZeroizeOnDrop)]
#[serde(rename_all = "camelCase")]
pub struct PasskeyEntry {
    pub id: String,
    pub title: String,
    pub rp_id: String,
    pub user_name: String,
    pub user_handle: String,
    pub credential_id: String,
    pub private_key: String,
    pub sign_count: u32,
}

struct Cache {
    #[cfg_attr(not(any(target_os = "android", test)), allow(dead_code))]
    entries: Vec<PasskeyEntry>,
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

fn sanitize(mut entry: PasskeyEntry) -> Option<PasskeyEntry> {
    limit_chars(&mut entry.id, 256);
    limit_chars(&mut entry.title, MAX_FIELD_CHARS);
    limit_chars(&mut entry.rp_id, 253);
    limit_chars(&mut entry.user_name, MAX_FIELD_CHARS);
    limit_chars(&mut entry.user_handle, MAX_FIELD_CHARS);
    limit_chars(&mut entry.credential_id, MAX_FIELD_CHARS);
    limit_chars(&mut entry.private_key, MAX_FIELD_CHARS);
    entry.rp_id = entry.rp_id.trim().to_lowercase();
    if entry.rp_id.is_empty() || entry.credential_id.is_empty() || entry.private_key.is_empty() {
        return None;
    }
    Some(entry)
}

fn expiry(ttl_seconds: u64, now: Instant) -> Option<Instant> {
    let ttl = ttl_seconds.min(MAX_TTL_SECONDS);
    (ttl > 0).then(|| now + Duration::from_secs(ttl))
}

fn publish_at(entries: Vec<PasskeyEntry>, ttl_seconds: u64, now: Instant) {
    let mut entries: Vec<PasskeyEntry> = entries
        .into_iter()
        .filter_map(sanitize)
        .take(MAX_ENTRIES)
        .collect();
    entries.shrink_to_fit();
    if let Ok(mut cache) = CACHE.lock() {
        *cache = Some(Cache {
            entries,
            expires_at: expiry(ttl_seconds, now),
        });
    }
}

pub fn publish(entries: Vec<PasskeyEntry>, ttl_seconds: u64) {
    publish_at(entries, ttl_seconds, Instant::now());
}

fn cache_is_expired(cache: &Cache, now: Instant) -> bool {
    cache.expires_at.is_some_and(|expires_at| now >= expires_at)
}

/// Prolonge la validité sans renvoyer les clés. `false` si le cache a expiré.
pub fn touch(ttl_seconds: u64) -> bool {
    let now = Instant::now();
    if let Ok(mut cache) = CACHE.lock() {
        match cache.as_mut() {
            Some(current) if !cache_is_expired(current, now) => {
                current.expires_at = expiry(ttl_seconds, now);
                return true;
            }
            Some(_) => *cache = None,
            None => {}
        }
    }
    false
}

pub fn clear() {
    if let Ok(mut cache) = CACHE.lock() {
        *cache = None;
    }
}

#[cfg(any(target_os = "android", test))]
fn with_cache<T>(f: impl FnOnce(Option<&Cache>) -> T) -> T {
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
    f(guard.as_ref())
}

#[cfg(any(target_os = "android", test))]
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ListedPasskey {
    item_id: String,
    credential_id: String,
    user_name: String,
    user_handle: String,
    rp_id: String,
}

#[cfg(any(target_os = "android", test))]
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ListPayload {
    unlocked: bool,
    items: Vec<ListedPasskey>,
}

/// Charge utile JSON des passkeys proposées pour un domaine.
#[cfg(any(target_os = "android", test))]
pub fn list_payload(rp_id: &str, allow_credentials_json: &str) -> String {
    let rp_id = rp_id.trim().to_lowercase();
    let Ok(allowed): Result<Vec<String>, _> = serde_json::from_str(allow_credentials_json) else {
        return r#"{"unlocked":true,"items":[]}"#.to_string();
    };
    with_cache(|cache| {
        let Some(cache) = cache else {
            return r#"{"unlocked":false,"items":[]}"#.to_string();
        };
        if rp_id.is_empty() {
            return r#"{"unlocked":true,"items":[]}"#.to_string();
        }
        let items: Vec<ListedPasskey> = cache
            .entries
            .iter()
            .filter(|entry| entry.rp_id == rp_id)
            .filter(|entry| {
                allowed.is_empty() || allowed.iter().any(|id| id == &entry.credential_id)
            })
            .take(MAX_MATCHES)
            .map(|entry| ListedPasskey {
                item_id: entry.id.clone(),
                credential_id: entry.credential_id.clone(),
                user_name: entry.user_name.clone(),
                user_handle: entry.user_handle.clone(),
                rp_id: entry.rp_id.clone(),
            })
            .collect();
        serde_json::to_string(&ListPayload {
            unlocked: true,
            items,
        })
        .unwrap_or_else(|_| r#"{"unlocked":true,"items":[]}"#.to_string())
    })
}

#[cfg(any(target_os = "android", test))]
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AssertionPayload {
    credential_id: String,
    user_handle: String,
    authenticator_data: String,
    signature: String,
    sign_count: u32,
}

/// Signe `authenticatorData || clientDataHash` pour une passkey du cache.
///
/// `client_data_hash_b64` est du base64 standard (Android
/// `Base64.NO_WRAP`), et non du base64url.
#[cfg(any(target_os = "android", test))]
pub fn assert_payload(
    item_id: &str,
    rp_id: &str,
    client_data_hash_b64: &str,
    user_verified: bool,
) -> Result<String, String> {
    let client_data_hash = STANDARD
        .decode(client_data_hash_b64)
        .map_err(|_| "client-data-hash-invalid".to_string())?;
    with_cache(|cache| {
        let cache = cache.ok_or_else(|| "locked".to_string())?;
        let entry = cache
            .entries
            .iter()
            .find(|entry| entry.id == item_id)
            .ok_or_else(|| "passkey-not-found".to_string())?;
        // La copie temporaire de la clé privée est effacée après signature :
        // `StoredPasskey` ne l’efface pas lui-même.
        let mut stored = StoredPasskey {
            kind: "passkey".into(),
            rp_id: entry.rp_id.clone(),
            user_handle: entry.user_handle.clone(),
            credential_id: entry.credential_id.clone(),
            private_key: entry.private_key.clone(),
            sign_count: entry.sign_count,
        };
        let signed = assert_passkey_with_hash(&stored, rp_id, &client_data_hash, user_verified);
        stored.private_key.zeroize();
        let assertion = signed.map_err(|_| "assertion-failed".to_string())?;
        serde_json::to_string(&AssertionPayload {
            credential_id: assertion.credential_id,
            user_handle: assertion.user_handle,
            authenticator_data: assertion.authenticator_data,
            signature: assertion.signature,
            sign_count: assertion.sign_count,
        })
        .map_err(|_| "assertion-failed".to_string())
    })
}

#[tauri::command]
pub fn android_passkeys_publish(
    entries: Vec<PasskeyEntry>,
    ttl_seconds: u64,
) -> Result<(), String> {
    publish(entries, ttl_seconds);
    Ok(())
}

#[tauri::command]
pub fn android_passkeys_touch(ttl_seconds: u64) -> bool {
    touch(ttl_seconds)
}

#[tauri::command]
pub fn android_passkeys_clear() {
    clear();
}

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

/// Ouvre l’écran Android des fournisseurs de passkeys.
#[tauri::command]
pub fn android_passkeys_open_settings() -> Result<bool, String> {
    #[cfg(target_os = "android")]
    {
        Ok(application_bool("openPasskeySettings"))
    }
    #[cfg(not(target_os = "android"))]
    {
        Err("unsupported".into())
    }
}

#[cfg(target_os = "android")]
#[unsafe(no_mangle)]
pub extern "system" fn Java_app_coffre_desktop_CoffrePasskeyBridge_nativeList(
    mut env: jni::JNIEnv<'_>,
    _this: jni::objects::JObject<'_>,
    rp_id: jni::objects::JString<'_>,
    allow_credentials: jni::objects::JString<'_>,
) -> jni::sys::jstring {
    let rp_id = env
        .get_string(&rp_id)
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_default();
    let allow_credentials = env
        .get_string(&allow_credentials)
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_else(|_| "[]".into());
    match env.new_string(list_payload(&rp_id, &allow_credentials)) {
        Ok(value) => value.into_raw(),
        Err(_) => {
            let _ = env.exception_clear();
            std::ptr::null_mut()
        }
    }
}

#[cfg(target_os = "android")]
#[unsafe(no_mangle)]
pub extern "system" fn Java_app_coffre_desktop_CoffrePasskeyBridge_nativeAssert(
    mut env: jni::JNIEnv<'_>,
    _this: jni::objects::JObject<'_>,
    item_id: jni::objects::JString<'_>,
    rp_id: jni::objects::JString<'_>,
    client_data_hash: jni::objects::JString<'_>,
    user_verified: jni::sys::jboolean,
) -> jni::sys::jstring {
    let read = |env: &mut jni::JNIEnv<'_>, value: &jni::objects::JString<'_>| {
        env.get_string(value)
            .map(|string| string.to_string_lossy().into_owned())
            .unwrap_or_default()
    };
    let item_id = read(&mut env, &item_id);
    let rp_id = read(&mut env, &rp_id);
    let client_data_hash = read(&mut env, &client_data_hash);
    let Ok(payload) = assert_payload(&item_id, &rp_id, &client_data_hash, user_verified != 0)
    else {
        return std::ptr::null_mut();
    };
    match env.new_string(payload) {
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

    fn test_private_key() -> String {
        let mut value = String::new();
        value.push_str("test");
        value.push('-');
        value.push_str(&std::process::id().to_string());
        value
    }

    fn entry(id: &str, rp_id: &str, credential_id: &str) -> PasskeyEntry {
        PasskeyEntry {
            id: id.into(),
            title: format!("Passkey {rp_id}"),
            rp_id: rp_id.into(),
            user_name: "alice".into(),
            user_handle: "dXNlcg".into(),
            credential_id: credential_id.into(),
            private_key: test_private_key(),
            sign_count: 0,
        }
    }

    #[test]
    fn liste_par_domaine_et_filtre_les_identifiants() {
        let _guard = guard();
        publish(
            vec![
                entry("a", "example.com", "cred-a"),
                entry("b", "example.com", "cred-b"),
                entry("c", "autre.example", "cred-c"),
            ],
            0,
        );
        let value: serde_json::Value =
            serde_json::from_str(&list_payload("example.com", "[]")).unwrap();
        assert_eq!(value["unlocked"], true);
        assert_eq!(value["items"].as_array().unwrap().len(), 2);
        let filtered: serde_json::Value =
            serde_json::from_str(&list_payload("example.com", r#"["cred-b"]"#)).unwrap();
        assert_eq!(filtered["items"].as_array().unwrap().len(), 1);
        assert_eq!(filtered["items"][0]["itemId"], "b");
    }

    #[test]
    fn refuse_une_assertion_hors_cache_ou_mauvais_domaine() {
        let _guard = guard();
        publish(vec![entry("a", "example.com", "cred-a")], 0);
        let hash = STANDARD.encode([7u8; 32]);
        assert!(assert_payload("inconnu", "example.com", &hash, true).is_err());
        assert!(assert_payload("a", "autre.example", &hash, true).is_err());
        assert!(assert_payload("a", "example.com", "pas-du-base64", true).is_err());
    }

    #[test]
    fn vide_expire_et_ne_ressuscite_pas() {
        let _guard = guard();
        let old = Instant::now() - Duration::from_secs(10);
        publish_at(vec![entry("a", "example.com", "cred-a")], 5, old);
        let value: serde_json::Value =
            serde_json::from_str(&list_payload("example.com", "[]")).unwrap();
        assert_eq!(value["unlocked"], false);
        assert!(!touch(60));
        clear();
        let value: serde_json::Value =
            serde_json::from_str(&list_payload("example.com", "[]")).unwrap();
        assert_eq!(value["unlocked"], false);
    }
}
