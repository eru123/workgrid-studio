// Credential encryption commands. Frontend calls these before persisting
// passwords to profiles.json.

use crate::services::crypto;
use crate::AppResult;

/// Encrypt a password. Returns `wkgrd:<base64>`.
#[tauri::command]
pub fn encrypt_password(password: String) -> AppResult<String> {
    crypto::encrypt_password(&password)
}

/// Decrypt a `wkgrd:`-prefixed string. Non-prefixed strings pass through.
#[tauri::command]
pub fn decrypt_password(encrypted: String) -> AppResult<String> {
    crypto::decrypt_password(&encrypted)
}
