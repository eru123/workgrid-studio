use crate::{AppError, AppResult};
use std::fs;
use std::path::PathBuf;

pub const APP_PREFERENCES_FILE: &str = "preferences.json";

pub fn app_data_dir() -> AppResult<PathBuf> {
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .map_err(|_| "Cannot determine home directory".to_string())?;
    Ok(PathBuf::from(home).join(".workgrid-studio"))
}

pub fn ensure_app_dirs() -> AppResult<PathBuf> {
    let base = app_data_dir()?;
    for sub in &["cache", "logs", "data"] {
        let p = base.join(sub);
        if !p.exists() {
            fs::create_dir_all(&p)
                .map_err(|e| format!("Failed to create {}: {}", p.display(), e))?;
        }
    }
    Ok(base)
}

pub fn data_file_path(filename: &str) -> AppResult<PathBuf> {
    Ok(ensure_app_dirs()?.join("data").join(filename))
}

pub fn app_preferences_path() -> AppResult<PathBuf> {
    data_file_path(APP_PREFERENCES_FILE)
}

#[tauri::command]
pub fn app_read_file(filename: String) -> AppResult<String> {
    let base = app_data_dir()?;
    let path = base.join("data").join(&filename);
    if !path.exists() {
        return Ok(String::new());
    }
    fs::read_to_string(&path).map_err(|e| AppError::io(format!("Read error: {}", e)))
}

#[tauri::command]
pub fn app_write_file(filename: String, contents: String) -> AppResult<()> {
    let base = ensure_app_dirs()?;
    let path = base.join("data").join(&filename);
    if let Some(parent) = path.parent() {
        if !parent.exists() {
            fs::create_dir_all(parent).map_err(|e| AppError::io(format!("Write error: {}", e)))?;
        }
    }
    fs::write(&path, contents).map_err(|e| AppError::io(format!("Write error: {}", e)))
}

#[tauri::command]
pub fn app_delete_file(filename: String) -> AppResult<()> {
    let base = app_data_dir()?;
    let path = base.join("data").join(&filename);
    if path.exists() {
        fs::remove_file(&path).map_err(|e| format!("Delete error: {}", e))?;
    }
    Ok(())
}

#[tauri::command]
pub fn app_get_data_dir() -> AppResult<String> {
    let base = ensure_app_dirs()?;
    Ok(base.to_string_lossy().to_string())
}

#[tauri::command]
pub fn app_delete_all_data() -> AppResult<()> {
    let base = app_data_dir()?;

    if base.exists() {
        fs::remove_dir_all(&base)
            .map_err(|e| AppError::io(format!("Failed to remove app data directory: {}", e)))?;
    }

    if let Ok(entry) = keyring::Entry::new("workgrid-studio", "vault-key") {
        match entry.delete_credential() {
            Ok(_) | Err(keyring::Error::NoEntry) => {}
            Err(e) => {
                return Err(AppError::crypto(format!(
                    "Failed to clear the mirrored OS keychain entry: {}",
                    e
                )));
            }
        }
    }

    ensure_app_dirs()?;
    Ok(())
}
