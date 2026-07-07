// App data directory management. Ported from legacy files.rs.

use std::fs;
use std::path::PathBuf;

use crate::AppResult;

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

pub fn secret_key_path() -> AppResult<PathBuf> {
    data_file_path("secret.key")
}
