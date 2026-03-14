use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use crate::files::app_data_dir;
use chrono::Local;

pub fn log_dir_for(profile_id: &str) -> Result<PathBuf, String> {
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
pub fn read_profile_log(profile_id: String, log_type: String) -> Result<String, String> {
    let filename = match log_type.as_str() {
        "query" | "mysql" => "mysql.log.txt",
        "error" => "error.log.txt",
        _ => return Err("Unknown log type. Use 'mysql' or 'error'.".to_string()),
    };
    let dir = log_dir_for(&profile_id)?;
    let path = dir.join(filename);
    if !path.exists() {
        return Ok(String::new());
    }
    fs::read_to_string(&path).map_err(|e| format!("Read error: {}", e))
}

#[tauri::command]
pub fn clear_profile_log(profile_id: String, log_type: String) -> Result<(), String> {
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
        _ => return Err("Unknown log type. Use 'mysql', 'error', or 'all'.".to_string()),
    };
    let dir = log_dir_for(&profile_id)?;
    let path = dir.join(filename);
    if path.exists() {
        fs::remove_file(&path).map_err(|e| format!("Delete error: {}", e))?;
    }
    Ok(())
}
