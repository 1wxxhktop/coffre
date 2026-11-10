//! Surveillance des événements de session du système.
//!
//! Le module traduit le verrouillage de session et la mise en veille en un
//! unique événement `coffre://system-lock`, consommé par `VaultProvider`. Il ne
//! transporte aucune donnée du coffre : la charge utile se limite au type
//! d’événement (`lock` ou `sleep`).

use tauri::{AppHandle, Emitter};

/// Événement écouté par la WebView pour verrouiller le coffre.
pub const SYSTEM_LOCK_EVENT: &str = "coffre://system-lock";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SystemLockKind {
    /// Verrouillage explicite de la session.
    Lock,
    /// Mise en veille de la machine.
    Sleep,
}

impl SystemLockKind {
    pub fn as_str(self) -> &'static str {
        match self {
            SystemLockKind::Lock => "lock",
            SystemLockKind::Sleep => "sleep",
        }
    }

    /// Charge utile volontairement minimale : aucun nom d’élément, aucun
    /// secret, aucune donnée d’environnement.
    pub fn payload(self) -> serde_json::Value {
        serde_json::json!({ "kind": self.as_str() })
    }
}

fn emit(app: &AppHandle, kind: SystemLockKind) {
    let _ = app.emit(SYSTEM_LOCK_EVENT, kind.payload());
}

/// Traduit une notification distribuée macOS en événement de verrouillage.
#[cfg(any(target_os = "macos", test))]
pub fn macos_notification_kind(name: &str) -> Option<SystemLockKind> {
    match name {
        "com.apple.screenIsLocked" => Some(SystemLockKind::Lock),
        "NSWorkspaceWillSleepNotification" => Some(SystemLockKind::Sleep),
        _ => None,
    }
}

/// Traduit un message de fenêtre Windows en événement de verrouillage.
#[cfg(any(target_os = "windows", test))]
pub fn windows_message_kind(message: u32, wparam: usize) -> Option<SystemLockKind> {
    // WM_WTSSESSION_CHANGE / WTS_SESSION_LOCK.
    if message == 0x02B1 && wparam == 0x7 {
        return Some(SystemLockKind::Lock);
    }
    // WM_POWERBROADCAST / PBT_APMSUSPEND.
    if message == 0x0218 && wparam == 0x4 {
        return Some(SystemLockKind::Sleep);
    }
    None
}

/// Traduit un signal logind en événement de verrouillage.
///
/// `PrepareForSleep(true)` annonce la mise en veille ; `Session.Lock` annonce
/// le verrouillage de la session.
#[cfg(any(target_os = "linux", test))]
pub fn logind_signal_kind(
    interface: &str,
    member: &str,
    sleeping: Option<bool>,
) -> Option<SystemLockKind> {
    match (interface, member, sleeping) {
        ("org.freedesktop.login1.Manager", "PrepareForSleep", Some(true)) => {
            Some(SystemLockKind::Sleep)
        }
        ("org.freedesktop.login1.Session", "Lock", _) => Some(SystemLockKind::Lock),
        _ => None,
    }
}

/// Démarre la surveillance de session de la plateforme courante.
pub fn start(app: AppHandle) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        macos::start(app)
    }
    #[cfg(target_os = "windows")]
    {
        windows_impl::start(app)
    }
    #[cfg(target_os = "linux")]
    {
        linux::start(app)
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        let _ = app;
        Err("La surveillance de session n’est pas disponible sur cette plateforme.".into())
    }
}

#[cfg(target_os = "macos")]
mod macos {
    use std::ffi::c_void;
    use std::ptr::NonNull;
    use std::sync::OnceLock;

    use block2::RcBlock;
    use objc2_app_kit::{NSWorkspace, NSWorkspaceWillSleepNotification};
    use objc2_core_foundation::{
        CFDictionary, CFNotificationCenter, CFNotificationName, CFNotificationSuspensionBehavior,
        CFString,
    };
    use objc2_foundation::NSNotification;
    use tauri::AppHandle;

    use super::{emit, macos_notification_kind};

    static APP_HANDLE: OnceLock<AppHandle> = OnceLock::new();
    static SCREEN_LOCK_OBSERVER: u8 = 0;

    extern "C-unwind" fn screen_locked(
        _center: *mut CFNotificationCenter,
        _observer: *mut c_void,
        _name: *const CFNotificationName,
        _object: *const c_void,
        _user_info: *const CFDictionary,
    ) {
        if let Some(app) = APP_HANDLE.get()
            && let Some(kind) = macos_notification_kind("com.apple.screenIsLocked")
        {
            emit(app, kind);
        }
    }

    pub fn start(app: AppHandle) -> Result<(), String> {
        APP_HANDLE
            .set(app)
            .map_err(|_| "La surveillance de session est déjà démarrée.".to_string())?;

        let distributed = CFNotificationCenter::distributed_center()
            .ok_or_else(|| "Centre de notifications macOS indisponible.".to_string())?;
        let screen_lock_name: &'static CFString =
            Box::leak(Box::new(CFString::from_str("com.apple.screenIsLocked")));
        unsafe {
            distributed.add_observer(
                std::ptr::addr_of!(SCREEN_LOCK_OBSERVER).cast::<c_void>(),
                Some(screen_locked),
                Some(screen_lock_name),
                std::ptr::null(),
                CFNotificationSuspensionBehavior::DeliverImmediately,
            );
        }

        // La mise en veille passe par NSWorkspace ; le bloc doit rester vivant
        // pendant toute la durée de vie de l’application.
        let center = NSWorkspace::sharedWorkspace().notificationCenter();
        let app = APP_HANDLE
            .get()
            .ok_or_else(|| "Surveillance de session non initialisée.".to_string())?
            .clone();
        let block = RcBlock::new(move |_notification: NonNull<NSNotification>| {
            if let Some(kind) = macos_notification_kind("NSWorkspaceWillSleepNotification") {
                emit(&app, kind);
            }
        });
        let observer = unsafe {
            center.addObserverForName_object_queue_usingBlock(
                Some(NSWorkspaceWillSleepNotification),
                None,
                None,
                &block,
            )
        };
        std::mem::forget(observer);
        Ok(())
    }
}

#[cfg(target_os = "windows")]
mod windows_impl {
    use std::sync::OnceLock;
    use std::sync::atomic::{AtomicIsize, Ordering};

    use tauri::{AppHandle, Manager};
    use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
    use windows::Win32::System::RemoteDesktop::{
        NOTIFY_FOR_THIS_SESSION, WTSRegisterSessionNotification,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        CallWindowProcW, GWLP_WNDPROC, SetWindowLongPtrW, WNDPROC,
    };

    use super::{emit, windows_message_kind};

    static APP_HANDLE: OnceLock<AppHandle> = OnceLock::new();
    static PREVIOUS_WNDPROC: AtomicIsize = AtomicIsize::new(0);

    unsafe extern "system" fn session_window_proc(
        hwnd: HWND,
        message: u32,
        wparam: WPARAM,
        lparam: LPARAM,
    ) -> LRESULT {
        if let Some(kind) = windows_message_kind(message, wparam.0)
            && let Some(app) = APP_HANDLE.get()
        {
            emit(app, kind);
        }

        let previous = PREVIOUS_WNDPROC.load(Ordering::Relaxed);
        if previous == 0 {
            return LRESULT(0);
        }
        // La procédure précédente est conservée telle quelle pour laisser
        // Tauri, WebView2 et Windows traiter le message normalement.
        let previous: WNDPROC = unsafe { std::mem::transmute(previous) };
        unsafe { CallWindowProcW(previous, hwnd, message, wparam, lparam) }
    }

    pub fn start(app: AppHandle) -> Result<(), String> {
        APP_HANDLE
            .set(app.clone())
            .map_err(|_| "La surveillance de session est déjà démarrée.".to_string())?;
        let window = app
            .get_webview_window("main")
            .ok_or_else(|| "Fenêtre principale introuvable.".to_string())?;
        // Tauri fournit un HWND d’une autre version du crate `windows` que celle
        // de Coffre : même pointeur brut, converti dans le type attendu.
        let hwnd = HWND(window.hwnd().map_err(|error| error.to_string())?.0);

        unsafe {
            WTSRegisterSessionNotification(hwnd, NOTIFY_FOR_THIS_SESSION)
                .map_err(|error| error.to_string())?;
            let previous =
                SetWindowLongPtrW(hwnd, GWLP_WNDPROC, session_window_proc as usize as isize);
            if previous == 0 {
                return Err("Impossible d’installer la surveillance de session.".into());
            }
            PREVIOUS_WNDPROC.store(previous, Ordering::Relaxed);
        }
        Ok(())
    }
}

#[cfg(target_os = "linux")]
mod linux {
    use tauri::AppHandle;
    use zbus::MatchRule;
    use zbus::blocking::{Connection, MessageIterator, Proxy};
    use zbus::message::Type;
    use zbus::zvariant::OwnedObjectPath;

    use super::{emit, logind_signal_kind};

    pub fn start(app: AppHandle) -> Result<(), String> {
        let sleep_app = app.clone();
        std::thread::Builder::new()
            .name("coffre-session-sleep".into())
            .spawn(move || {
                let connection = match Connection::system() {
                    Ok(connection) => connection,
                    Err(error) => {
                        eprintln!("Surveillance de la veille indisponible : {error}");
                        return;
                    }
                };
                if let Err(error) = watch_sleep(&connection, sleep_app) {
                    eprintln!("Surveillance de la veille indisponible : {error}");
                }
            })
            .map_err(|error| error.to_string())?;

        std::thread::Builder::new()
            .name("coffre-session-lock".into())
            .spawn(move || {
                let connection = match Connection::system() {
                    Ok(connection) => connection,
                    Err(error) => {
                        eprintln!("Surveillance du verrouillage de session indisponible : {error}");
                        return;
                    }
                };
                let session_path = current_session_path(&connection);
                if let Err(error) = watch_lock(&connection, app, session_path.as_ref()) {
                    eprintln!("Surveillance du verrouillage de session indisponible : {error}");
                }
            })
            .map_err(|error| error.to_string())?;
        Ok(())
    }

    fn current_session_path(connection: &Connection) -> Option<OwnedObjectPath> {
        let proxy = Proxy::new(
            connection,
            "org.freedesktop.login1",
            "/org/freedesktop/login1",
            "org.freedesktop.login1.Manager",
        )
        .ok()?;
        proxy.call("GetSessionByPID", &(std::process::id())).ok()
    }

    fn watch_sleep(connection: &Connection, app: AppHandle) -> Result<(), String> {
        let rule = MatchRule::builder()
            .msg_type(Type::Signal)
            .interface("org.freedesktop.login1.Manager")
            .map_err(|error| error.to_string())?
            .member("PrepareForSleep")
            .map_err(|error| error.to_string())?
            .build();
        let iterator = MessageIterator::for_match_rule(rule, connection, Some(16))
            .map_err(|e| e.to_string())?;
        for message in iterator {
            let message = message.map_err(|error| error.to_string())?;
            let sleeping: Option<bool> = message
                .body()
                .deserialize::<(bool,)>()
                .ok()
                .map(|(sleeping,)| sleeping);
            if let Some(kind) = logind_signal_kind(
                "org.freedesktop.login1.Manager",
                "PrepareForSleep",
                sleeping,
            ) {
                emit(&app, kind);
            }
        }
        Ok(())
    }

    fn watch_lock(
        connection: &Connection,
        app: AppHandle,
        session_path: Option<&OwnedObjectPath>,
    ) -> Result<(), String> {
        let mut builder = MatchRule::builder()
            .msg_type(Type::Signal)
            .interface("org.freedesktop.login1.Session")
            .map_err(|error| error.to_string())?
            .member("Lock")
            .map_err(|error| error.to_string())?;
        if let Some(path) = session_path {
            builder = builder
                .path(path.as_str())
                .map_err(|error| error.to_string())?;
        }
        let iterator = MessageIterator::for_match_rule(builder.build(), connection, Some(16))
            .map_err(|error| error.to_string())?;
        for message in iterator {
            message.map_err(|error| error.to_string())?;
            if let Some(kind) = logind_signal_kind("org.freedesktop.login1.Session", "Lock", None) {
                emit(&app, kind);
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn traduit_les_notifications_macos() {
        assert_eq!(
            macos_notification_kind("com.apple.screenIsLocked"),
            Some(SystemLockKind::Lock)
        );
        assert_eq!(
            macos_notification_kind("NSWorkspaceWillSleepNotification"),
            Some(SystemLockKind::Sleep)
        );
        assert_eq!(macos_notification_kind("com.apple.screenIsUnlocked"), None);
    }

    #[test]
    fn traduit_les_messages_windows() {
        assert_eq!(
            windows_message_kind(0x02B1, 0x7),
            Some(SystemLockKind::Lock)
        );
        assert_eq!(
            windows_message_kind(0x0218, 0x4),
            Some(SystemLockKind::Sleep)
        );
        assert_eq!(windows_message_kind(0x02B1, 0x8), None);
        assert_eq!(windows_message_kind(0x0218, 0x5), None);
        assert_eq!(windows_message_kind(0x0001, 0x0), None);
    }

    #[test]
    fn traduit_les_signaux_logind() {
        assert_eq!(
            logind_signal_kind(
                "org.freedesktop.login1.Manager",
                "PrepareForSleep",
                Some(true)
            ),
            Some(SystemLockKind::Sleep)
        );
        assert_eq!(
            logind_signal_kind(
                "org.freedesktop.login1.Manager",
                "PrepareForSleep",
                Some(false)
            ),
            None
        );
        assert_eq!(
            logind_signal_kind("org.freedesktop.login1.Session", "Lock", None),
            Some(SystemLockKind::Lock)
        );
        assert_eq!(
            logind_signal_kind("org.freedesktop.login1.Session", "Unlock", None),
            None
        );
    }

    #[test]
    fn la_charge_utile_ne_contient_aucune_donnee_du_coffre() {
        assert_eq!(
            SystemLockKind::Lock.payload(),
            serde_json::json!({ "kind": "lock" })
        );
        assert_eq!(
            SystemLockKind::Sleep.payload(),
            serde_json::json!({ "kind": "sleep" })
        );
        assert_eq!(SYSTEM_LOCK_EVENT, "coffre://system-lock");
    }
}
