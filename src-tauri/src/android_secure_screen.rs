//! Protection contre les captures d’écran Android.
//!
//! `FLAG_SECURE` empêche les captures d’écran et les enregistrements de la
//! fenêtre, et masque son contenu dans l’aperçu des applications récentes.
//! Le choix est mémorisé dans les préférences natives pour être appliqué dès
//! la création de l’activité, avant le chargement de la WebView.
//!
//! Le drapeau est une protection contre les captures ordinaires ; il ne
//! protège pas contre un appareil rooté ou un périphérique de capture
//! privilégié.

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

/// Active ou désactive `FLAG_SECURE`, puis renvoie l’état appliqué.
#[tauri::command]
pub fn android_secure_screen_set(enabled: bool) -> Result<bool, String> {
    #[cfg(target_os = "android")]
    {
        let context = ndk_context::android_context();
        let vm = unsafe { jni::JavaVM::from_raw(context.vm().cast()) }
            .map_err(|_| "secure-screen-failed".to_string())?;
        let mut env = vm
            .attach_current_thread()
            .map_err(|_| "secure-screen-failed".to_string())?;
        let application = unsafe { jni::objects::JObject::from_raw(context.context().cast()) };
        let result = env
            .call_method(
                &application,
                "setSecureScreen",
                "(Z)Z",
                &[jni::objects::JValue::Bool(u8::from(enabled))],
            )
            .map_err(|_| "secure-screen-failed".to_string())?;
        result.z().map_err(|_| "secure-screen-failed".to_string())
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = enabled;
        Err("unsupported".into())
    }
}

/// Vrai si les captures d’écran sont actuellement bloquées.
#[tauri::command]
pub fn android_secure_screen_enabled() -> bool {
    #[cfg(target_os = "android")]
    {
        application_bool("isSecureScreenEnabled")
    }
    #[cfg(not(target_os = "android"))]
    {
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn refuse_hors_android() {
        assert!(android_secure_screen_set(true).is_err());
        assert!(!android_secure_screen_enabled());
    }
}
