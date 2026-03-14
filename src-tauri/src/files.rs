use std::path::PathBuf;
use std::fs;

pub fn app_data_dir() -> Result<PathBuf, String> {
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .map_err(|_| "Cannot determine home directory".to_string())?;
    Ok(PathBuf::from(home).join(".workgrid-studio"))
}

pub fn ensure_app_dirs() -> Result<PathBuf, String> {
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

#[tauri::command]
pub fn app_read_file(filename: String) -> Result<String, String> {
    let base = app_data_dir()?;
    let path = base.join("data").join(&filename);
    if !path.exists() {
        return Ok(String::new());
    }
    fs::read_to_string(&path).map_err(|e| format!("Read error: {}", e))
}

#[tauri::command]
pub fn app_write_file(filename: String, contents: String) -> Result<(), String> {
    let base = ensure_app_dirs()?;
    let path = base.join("data").join(&filename);
    fs::write(&path, contents).map_err(|e| format!("Write error: {}", e))
}

#[tauri::command]
pub fn app_delete_file(filename: String) -> Result<(), String> {
    let base = app_data_dir()?;
    let path = base.join("data").join(&filename);
    if path.exists() {
        fs::remove_file(&path).map_err(|e| format!("Delete error: {}", e))?;
    }
    Ok(())
}

#[tauri::command]
pub fn app_get_data_dir() -> Result<String, String> {
    let base = ensure_app_dirs()?;
    Ok(base.to_string_lossy().to_string())
}
