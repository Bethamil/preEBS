//! Tauri commands over the same SQLite database the CLI uses.
//! The webview never talks to a server; every call goes through `preebs-core`.

use std::path::Path;
use std::sync::Mutex;

use preebs_core::{
    to_pretty_json, write_new_file, Hours, MigrateReport, PreEbs, UserConfig, WeekCustomProject,
    WeekDocument, WeekRowInput, WeekSummary, WeekView,
};
use serde::Serialize;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{Emitter, Manager, State};

struct AppState {
    db: Mutex<PreEbs>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AppInfo {
    path: String,
    revision: u64,
}

fn err_string(error: preebs_core::Error) -> String {
    format!("{}: {error}", error.code())
}

fn with_app<T>(
    state: &State<'_, AppState>,
    f: impl FnOnce(&mut PreEbs) -> preebs_core::Result<T>,
) -> Result<T, String> {
    let mut db = state
        .db
        .lock()
        .map_err(|_| "io: database lock poisoned".to_string())?;
    f(&mut db).map_err(err_string)
}

#[tauri::command]
fn app_info(state: State<'_, AppState>) -> Result<AppInfo, String> {
    with_app(&state, |app| {
        let revision = app.revision()?;
        Ok(AppInfo {
            path: app.path().display().to_string(),
            revision,
        })
    })
}

#[tauri::command]
fn revision(state: State<'_, AppState>) -> Result<u64, String> {
    with_app(&state, |app| app.revision())
}

#[tauri::command]
fn get_config(state: State<'_, AppState>) -> Result<UserConfig, String> {
    with_app(&state, |app| app.config())
}

#[tauri::command]
fn save_config(state: State<'_, AppState>, config: UserConfig) -> Result<UserConfig, String> {
    with_app(&state, |app| app.save_config(config, false))
}

#[tauri::command]
fn set_settings(
    state: State<'_, AppState>,
    max_hours: Option<[Hours; 5]>,
    default_hour_type_name: Option<String>,
) -> Result<UserConfig, String> {
    with_app(&state, |app| {
        app.set_settings(max_hours, default_hour_type_name.as_deref(), false)
    })
}

#[tauri::command]
fn week_view(state: State<'_, AppState>, date: String) -> Result<WeekView, String> {
    with_app(&state, |app| app.week_view(&date))
}

#[tauri::command]
fn save_week(
    state: State<'_, AppState>,
    date: String,
    rows: Vec<WeekRowInput>,
    custom_projects: Vec<WeekCustomProject>,
) -> Result<WeekDocument, String> {
    with_app(&state, |app| {
        app.save_week(&date, &rows, &custom_projects, false)
    })
}

#[tauri::command]
fn list_weeks(state: State<'_, AppState>, query: String) -> Result<Vec<WeekSummary>, String> {
    with_app(&state, |app| app.list_weeks(&query))
}

#[tauri::command]
fn delete_week(state: State<'_, AppState>, date: String) -> Result<(), String> {
    with_app(&state, |app| app.delete_week(&date, false))
}

#[tauri::command]
fn copy_previous_week(state: State<'_, AppState>, date: String) -> Result<WeekDocument, String> {
    with_app(&state, |app| app.copy_previous_week(&date, false))
}

#[tauri::command]
fn add_custom_project(
    state: State<'_, AppState>,
    date: String,
    name: String,
) -> Result<WeekDocument, String> {
    with_app(&state, |app| {
        app.add_custom_project(&date, &name, None, false)
    })
}

#[tauri::command]
fn remove_custom_project(
    state: State<'_, AppState>,
    date: String,
    token: String,
) -> Result<WeekDocument, String> {
    with_app(&state, |app| {
        app.remove_custom_project(&date, &token, false)
    })
}

#[tauri::command]
fn export_week_text(state: State<'_, AppState>, date: String) -> Result<String, String> {
    with_app(&state, |app| {
        let document = app.export_week(&date)?;
        to_pretty_json(&document)
    })
}

#[tauri::command]
fn export_config_text(state: State<'_, AppState>) -> Result<String, String> {
    with_app(&state, |app| {
        let document = app.export_config()?;
        to_pretty_json(&document)
    })
}

#[tauri::command]
fn import_config_text(state: State<'_, AppState>, text: String) -> Result<UserConfig, String> {
    let value: serde_json::Value =
        serde_json::from_str(&text).map_err(|error| format!("validation: {error}"))?;
    with_app(&state, |app| app.import_config_value(&value, false))
}

#[tauri::command]
fn write_export_file(path: String, contents: String) -> Result<(), String> {
    write_new_file(Path::new(&path), &contents).map_err(err_string)
}

#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(Path::new(&path)).map_err(|error| format!("io: {error}"))
}

#[tauri::command]
fn migrate_from(state: State<'_, AppState>, path: String) -> Result<MigrateReport, String> {
    with_app(&state, |app| app.migrate_from(Path::new(&path), false))
}

fn menu_item(
    app: &tauri::App,
    id: &str,
    text: &str,
    accelerator: Option<&str>,
) -> tauri::Result<MenuItem<tauri::Wry>> {
    MenuItem::with_id(app, id, text, true, accelerator)
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let db = PreEbs::open_default().map_err(err_string)?;
            app.manage(AppState { db: Mutex::new(db) });

            let week = menu_item(app, "nav-week", "Uren", Some("CmdOrCtrl+1"))?;
            let weeks = menu_item(app, "nav-weeks", "Weken", Some("CmdOrCtrl+2"))?;
            let config = menu_item(app, "nav-config", "Instellingen", Some("CmdOrCtrl+3"))?;
            let export_view = menu_item(app, "nav-export", "Export", Some("CmdOrCtrl+4"))?;
            let palette = menu_item(app, "palette", "Opdrachtpalet…", Some("CmdOrCtrl+K"))?;
            let prev = menu_item(app, "week-prev", "Vorige week", Some("CmdOrCtrl+Left"))?;
            let next = menu_item(app, "week-next", "Volgende week", Some("CmdOrCtrl+Right"))?;
            let copy = menu_item(
                app,
                "week-copy",
                "Vorige week kopiëren",
                Some("CmdOrCtrl+Shift+C"),
            )?;
            let export_file = menu_item(
                app,
                "export-save",
                "Exporteer week-JSON…",
                Some("CmdOrCtrl+E"),
            )?;
            let theme_system = menu_item(app, "theme-system", "Thema: systeem", None)?;
            let theme_light = menu_item(app, "theme-light", "Thema: licht", None)?;
            let theme_dark = menu_item(app, "theme-dark", "Thema: donker", None)?;
            let sep_file = PredefinedMenuItem::separator(app)?;
            let sep_go = PredefinedMenuItem::separator(app)?;
            let quit = PredefinedMenuItem::quit(app, Some("Stop PreEBS"))?;

            let file_menu =
                Submenu::with_items(app, "Bestand", true, &[&export_file, &sep_file, &quit])?;
            let go_menu = Submenu::with_items(
                app,
                "Ga",
                true,
                &[&week, &weeks, &config, &export_view, &sep_go, &palette],
            )?;
            let week_menu = Submenu::with_items(app, "Week", true, &[&prev, &next, &copy])?;
            let view_menu = Submenu::with_items(
                app,
                "Beeld",
                true,
                &[&theme_system, &theme_light, &theme_dark],
            )?;
            let menu = Menu::with_items(app, &[&file_menu, &go_menu, &week_menu, &view_menu])?;
            app.set_menu(menu)?;
            app.on_menu_event(|app, event| {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.emit("menu", event.id().as_ref().to_string());
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            app_info,
            revision,
            get_config,
            save_config,
            set_settings,
            week_view,
            save_week,
            list_weeks,
            delete_week,
            copy_previous_week,
            add_custom_project,
            remove_custom_project,
            export_week_text,
            export_config_text,
            import_config_text,
            write_export_file,
            read_text_file,
            migrate_from,
        ])
        .run(tauri::generate_context!())
        .expect("PreEBS failed to start");
}
