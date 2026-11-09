//! Icône de barre de menus et actions rapides.
//!
//! Le menu ne contient que des actions fixes : aucun nom de coffre, d’élément
//! ou d’utilisateur n’y est affiché, verrouillé ou non.

use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, Runtime};

pub const TRAY_ID: &str = "main-tray";
pub const EVENT_QUICK_SEARCH: &str = "coffre:quick-search";
pub const EVENT_GENERATOR: &str = "coffre:tray-generator";
pub const EVENT_LOCK: &str = "coffre:tray-lock";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Language {
    Fr,
    En,
}

impl Language {
    fn from_str(value: &str) -> Self {
        if value.eq_ignore_ascii_case("en") {
            Language::En
        } else {
            Language::Fr
        }
    }

    fn labels(self) -> Labels {
        match self {
            Language::Fr => Labels {
                open: "Ouvrir Coffre",
                search: "Recherche rapide",
                generator: "Générateur de mot de passe",
                lock: "Verrouiller Coffre",
                quit: "Quitter Coffre",
                tooltip: "Coffre",
            },
            Language::En => Labels {
                open: "Open Coffre",
                search: "Quick search",
                generator: "Password generator",
                lock: "Lock Coffre",
                quit: "Quit Coffre",
                tooltip: "Coffre",
            },
        }
    }
}

struct Labels {
    open: &'static str,
    search: &'static str,
    generator: &'static str,
    lock: &'static str,
    quit: &'static str,
    tooltip: &'static str,
}

pub struct TrayState {
    language: Mutex<Language>,
    keep_on_close: AtomicBool,
}

impl Default for TrayState {
    fn default() -> Self {
        Self {
            language: Mutex::new(Language::Fr),
            keep_on_close: AtomicBool::new(true),
        }
    }
}

impl TrayState {
    fn language(&self) -> Language {
        *self
            .language
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

fn labels(language: Language) -> Labels {
    language.labels()
}

fn build_menu<R: Runtime>(app: &AppHandle<R>, language: Language) -> tauri::Result<Menu<R>> {
    let labels = labels(language);
    let open = MenuItem::with_id(app, "open", labels.open, true, None::<&str>)?;
    let search = MenuItem::with_id(app, "search", labels.search, true, None::<&str>)?;
    let generator = MenuItem::with_id(app, "generator", labels.generator, true, None::<&str>)?;
    let lock = MenuItem::with_id(app, "lock", labels.lock, true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", labels.quit, true, None::<&str>)?;
    Menu::with_items(app, &[&open, &search, &generator, &lock, &separator, &quit])
}

fn show_main_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn handle_menu_event<R: Runtime>(app: &AppHandle<R>, id: &str) {
    match id {
        "open" => show_main_window(app),
        "search" => {
            show_main_window(app);
            let _ = app.emit(EVENT_QUICK_SEARCH, ());
        }
        "generator" => {
            show_main_window(app);
            let _ = app.emit(EVENT_GENERATOR, ());
        }
        "lock" => {
            let _ = app.emit(EVENT_LOCK, ());
        }
        "quit" => app.exit(0),
        _ => {}
    }
}

/// Crée l’icône de barre de menus. Le libellé est reconstruit si la langue
/// change, sans jamais exposer de contenu du coffre.
pub fn init<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let language = app
        .try_state::<TrayState>()
        .map(|state| state.language())
        .unwrap_or(Language::Fr);
    let labels = labels(language);
    let menu = build_menu(app, language).map_err(|error| error.to_string())?;
    let icon = app
        .default_window_icon()
        .cloned()
        .ok_or_else(|| "Icône de l’application indisponible.".to_string())?;

    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon)
        .tooltip(labels.tooltip)
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| handle_menu_event(app, event.id().as_ref()));
    if cfg!(target_os = "macos") {
        builder = builder.icon_as_template(true);
    }
    builder
        .build(app)
        .map(|_| ())
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn tray_set_language(
    app: AppHandle,
    state: tauri::State<'_, TrayState>,
    language: String,
) -> Result<(), String> {
    let next = Language::from_str(&language);
    {
        let mut current = state
            .language
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if *current == next {
            return Ok(());
        }
        *current = next;
    }
    let menu = build_menu(&app, next).map_err(|error| error.to_string())?;
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        tray.set_menu(Some(menu))
            .map_err(|error| error.to_string())?;
        tray.set_tooltip(Some(labels(next).tooltip))
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn tray_set_keep_on_close(
    state: tauri::State<'_, TrayState>,
    keep: bool,
) -> Result<(), String> {
    state.keep_on_close.store(keep, Ordering::Relaxed);
    Ok(())
}

pub fn keeps_window_on_close<R: Runtime>(app: &AppHandle<R>) -> bool {
    app.try_state::<TrayState>()
        .map(|state| state.keep_on_close.load(Ordering::Relaxed))
        .unwrap_or(true)
}
