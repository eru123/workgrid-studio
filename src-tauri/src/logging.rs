use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use serde::Deserialize;
use crate::{AppError, AppResult};
use crate::files::{app_data_dir, app_preferences_path, ensure_app_dirs};
use chrono::Local;

const DEFAULT_MAX_LOG_SIZE_MB: u64 = 10;
const MIN_LOG_SIZE_MB: u64 = 1;
const MAX_LOG_SIZE_MB: u64 = 250;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LoggingPreferences {
    max_log_size_mb: Option<u64>,
}

pub fn log_dir_for(profile_id: &str) -> AppResult<PathBuf> {
    let base = app_data_dir()?;
    let dir = base.join("logs").join(profile_id);
    if !dir.exists() {
        fs::create_dir_all(&dir)
            .map_err(|e| format!("Failed to create log dir: {}", e))?;
    }
    Ok(dir)
}

pub fn timestamp() -> String {
    Local::now().format("%Y-%m-%d %H:%M:%S").to_string()
}

pub fn append_log(profile_id: &str, filename: &str, message: &str) {
    if let Ok(dir) = log_dir_for(profile_id) {
        let path = dir.join(filename);
        if let Ok(mut file) = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)
        {
            let _ = writeln!(file, "[{}] {}", timestamp(), message);
        }
        enforce_log_retention(&path);
    }
}

pub fn log_query(profile_id: &str, query: &str) {
    append_log(profile_id, "mysql.log.txt", &format!("QUERY: {}", query));
}

pub fn log_query_result(profile_id: &str, query: &str, count: usize) {
    append_log(profile_id, "mysql.log.txt", &format!("QUERY: {} → {} rows", query, count));
}

pub fn log_info(profile_id: &str, message: &str) {
    append_log(profile_id, "mysql.log.txt", &format!("INFO: {}", message));
}

pub fn log_error(profile_id: &str, message: &str) {
    append_log(profile_id, "error.log.txt", &format!("ERROR: {}", message));
    // Also log errors to mysql.log for full timeline
    append_log(profile_id, "mysql.log.txt", &format!("ERROR: {}", message));
}

#[tauri::command]
pub fn read_profile_log(profile_id: String, log_type: String) -> AppResult<String> {
    let filename = match log_type.as_str() {
        "query" | "mysql" => "mysql.log.txt",
        "error" => "error.log.txt",
        _ => return Err("Unknown log type. Use 'mysql' or 'error'.".into()),
    };
    let dir = log_dir_for(&profile_id)?;
    let path = dir.join(filename);
    if !path.exists() {
        return Ok(String::new());
    }
    fs::read_to_string(&path)
        .map_err(|e| AppError::io(format!("Read error: {}", e)))
}

#[tauri::command]
pub fn clear_profile_log(profile_id: String, log_type: String) -> AppResult<()> {
    let filename = match log_type.as_str() {
        "query" | "mysql" => "mysql.log.txt",
        "error" => "error.log.txt",
        "all" => {
            let dir = log_dir_for(&profile_id)?;
            for f in &["mysql.log.txt", "error.log.txt"] {
                let p = dir.join(f);
                if p.exists() {
                    let _ = fs::remove_file(&p);
                }
            }
            return Ok(());
        }
        _ => return Err("Unknown log type. Use 'mysql', 'error', or 'all'.".into()),
    };
    let dir = log_dir_for(&profile_id)?;
    let path = dir.join(filename);
    if path.exists() {
        fs::remove_file(&path).map_err(|e| format!("Delete error: {}", e))?;
    }
    Ok(())
}

#[tauri::command]
pub fn clear_all_logs() -> AppResult<()> {
    let base = ensure_app_dirs()?;
    let logs_dir = base.join("logs");

    if logs_dir.exists() {
        fs::remove_dir_all(&logs_dir)
            .map_err(|e| AppError::io(format!("Failed to clear logs directory: {}", e)))?;
    }
    fs::create_dir_all(&logs_dir)
        .map_err(|e| AppError::io(format!("Failed to recreate logs directory: {}", e)))?;

    for filename in ["ai_logs.json", "ai_logs.corrupted.json"] {
        let path = base.join(filename);
        if path.exists() {
            fs::remove_file(&path)
                .map_err(|e| AppError::io(format!("Failed to remove {}: {}", filename, e)))?;
        }
    }

    Ok(())
}

fn current_max_log_size_bytes() -> u64 {
    let default = DEFAULT_MAX_LOG_SIZE_MB * 1024 * 1024;
    let Ok(path) = app_preferences_path() else {
        return default;
    };
    let Ok(raw) = fs::read_to_string(path) else {
        return default;
    };
    let Ok(prefs) = serde_json::from_str::<LoggingPreferences>(&raw) else {
        return default;
    };

    prefs
        .max_log_size_mb
        .unwrap_or(DEFAULT_MAX_LOG_SIZE_MB)
        .clamp(MIN_LOG_SIZE_MB, MAX_LOG_SIZE_MB)
        * 1024
        * 1024
}

fn enforce_log_retention(path: &Path) {
    let max_size = current_max_log_size_bytes();
    let Ok(metadata) = fs::metadata(path) else {
        return;
    };
    if metadata.len() <= max_size {
        return;
    }

    let Ok(contents) = fs::read(path) else {
        return;
    };

    let keep_from = contents.len().saturating_sub(max_size as usize);
    let adjusted_start = contents[keep_from..]
        .iter()
        .position(|byte| *byte == b'\n')
        .map(|index| keep_from + index + 1)
        .unwrap_or(keep_from);

    let _ = fs::write(path, &contents[adjusted_start..]);
}
