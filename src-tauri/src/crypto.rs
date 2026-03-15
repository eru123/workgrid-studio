use crate::files::ensure_app_dirs;
use crate::{AppError, AppResult};
use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use base64::{engine::general_purpose::STANDARD as b64, Engine};
use rand::RngCore;
use std::collections::HashMap;
use std::fs;

/// Retrieve or create the 32-byte AES-256-GCM master key used for vault and
/// password encryption.
///
/// Reliability note:
///   On some systems the OS credential store can behave inconsistently across
///   processes. To keep secrets decryptable, WorkGrid Studio now uses the local
///   `~/.workgrid-studio/data/secret.key` file as the source of truth and mirrors
///   the same key to the OS store on a best-effort basis.
pub fn get_or_create_secret_key() -> AppResult<[u8; 32]> {
    const SERVICE: &str = "workgrid-studio";
    const ACCOUNT: &str = "vault-key";

    if let Some(key) = read_secret_key_from_file()? {
        let _ = store_key_in_keyring(SERVICE, ACCOUNT, &key);
        return Ok(key);
    }

    if let Ok(entry) = keyring::Entry::new(SERVICE, ACCOUNT) {
        if let Ok(encoded) = entry.get_password() {
            let bytes = b64
                .decode(&encoded)
                .map_err(|e| format!("Keychain key decode error: {e}"))?;
            if bytes.len() == 32 {
                let key: [u8; 32] = bytes
                    .try_into()
                    .map_err(|_| "Keychain key has invalid length".to_string())?;
                write_secret_key_to_file(&key)?;
                return Ok(key);
            }
        }
    }

    let key = get_or_create_key_from_file()?;
    let _ = store_key_in_keyring(SERVICE, ACCOUNT, &key);
    Ok(key)
}

fn secret_key_path() -> AppResult<std::path::PathBuf> {
    let base = ensure_app_dirs()?;
    Ok(base.join("data").join("secret.key"))
}

fn read_secret_key_from_file() -> AppResult<Option<[u8; 32]>> {
    let key_path = secret_key_path()?;

    if key_path.exists() {
        let contents =
            fs::read(&key_path).map_err(|e| format!("Failed to read secret.key: {e}"))?;
        if contents.len() == 32 {
            let key: [u8; 32] = contents
                .try_into()
                .map_err(|_| "secret.key has invalid length".to_string())?;
            return Ok(Some(key));
        }
    }

    Ok(None)
}

fn write_secret_key_to_file(key: &[u8; 32]) -> AppResult<()> {
    let key_path = secret_key_path()?;
    fs::write(&key_path, key).map_err(|e| format!("Failed to write secret.key: {e}"))?;
    Ok(())
}

fn store_key_in_keyring(service: &str, account: &str, key: &[u8; 32]) -> AppResult<()> {
    let entry = keyring::Entry::new(service, account)
        .map_err(|e| format!("Keychain entry init failed: {e}"))?;
    let encoded = b64.encode(key);
    entry
        .set_password(&encoded)
        .map_err(|e| format!("Failed to store vault key in OS keychain: {e}"))?;
    Ok(())
}

/// File-based key store for `get_or_create_secret_key()`.
pub fn get_or_create_key_from_file() -> AppResult<[u8; 32]> {
    if let Some(key) = read_secret_key_from_file()? {
        return Ok(key);
    }

    let mut key = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut key);
    write_secret_key_to_file(&key)?;
    Ok(key)
}

// Vault uses the same randomly-generated per-installation key as encrypt_password /
// decrypt_password (get_or_create_secret_key). The old username-derived key
// (get_vault_key) has been removed because it was trivially reversible by anyone
// with access to the vault file. Existing vault entries encrypted with the old key
// will fail to decrypt (the caller receives an error) and the user will need to
// re-enter their secrets once after upgrading.

#[tauri::command]
pub fn vault_set(key: String, secret: String) -> AppResult<()> {
    let base = ensure_app_dirs()?;
    let vault_path = base.join(".vault");

    let mut vault: HashMap<String, String> = if vault_path.exists() {
        let content = fs::read_to_string(&vault_path).unwrap_or_default();
        serde_json::from_str(&content).unwrap_or_default()
    } else {
        HashMap::new()
    };

    // Encrypt with the per-installation random key (same key used for passwords)
    let cipher_key = get_or_create_secret_key()?;
    let cipher = Aes256Gcm::new(&cipher_key.into());
    let mut nonce_bytes = [0u8; 12];
    rand::thread_rng().fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher
        .encrypt(nonce, secret.as_bytes())
        .map_err(|_| "Encryption failed".to_string())?;

    let mut combined = nonce_bytes.to_vec();
    combined.extend(ciphertext);
    let encrypted_b64 = b64.encode(combined);

    vault.insert(key, encrypted_b64);

    let serialized = serde_json::to_string(&vault).map_err(|e| e.to_string())?;
    fs::write(vault_path, serialized).map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn vault_get(key: String) -> AppResult<String> {
    let base = ensure_app_dirs()?;
    let vault_path = base.join(".vault");

    if !vault_path.exists() {
        return Err(AppError::crypto("No vault found"));
    }

    let content = fs::read_to_string(&vault_path).map_err(|e| e.to_string())?;
    let vault: HashMap<String, String> =
        serde_json::from_str(&content).map_err(|e| e.to_string())?;

    let encrypted_b64 = vault.get(&key).ok_or("Key not found in vault")?;
    let combined = b64
        .decode(encrypted_b64)
        .map_err(|_| "Invalid base64 payload")?;

    if combined.len() < 12 {
        return Err(AppError::crypto("Payload too short"));
    }

    let nonce = Nonce::from_slice(&combined[0..12]);
    let ciphertext = &combined[12..];

    let cipher_key = get_or_create_secret_key()?;
    let cipher = Aes256Gcm::new(&cipher_key.into());

    let plaintext = cipher.decrypt(nonce, ciphertext)
        .map_err(|_| "Decryption failed — the vault entry may have been encrypted with an older key. Please re-enter your secret.".to_string())?;

    Ok(String::from_utf8(plaintext).map_err(|_| "Invalid UTF-8 in secret".to_string())?)
}

#[tauri::command]
pub fn vault_delete(key: String) -> AppResult<()> {
    let base = ensure_app_dirs()?;
    let vault_path = base.join(".vault");

    if vault_path.exists() {
        let content = fs::read_to_string(&vault_path).unwrap_or_default();
        let mut vault: HashMap<String, String> = serde_json::from_str(&content).unwrap_or_default();
        vault.remove(&key);
        let serialized = serde_json::to_string(&vault).unwrap_or_default();
        fs::write(vault_path, serialized).map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[tauri::command]
pub fn encrypt_password(password: String) -> AppResult<String> {
    if password.is_empty() {
        return Ok(String::new());
    }

    let key = get_or_create_secret_key()?;
    let cipher = Aes256Gcm::new(&key.into());

    let mut nonce_bytes = [0u8; 12];
    rand::thread_rng().fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);

    match cipher.encrypt(nonce, password.as_bytes()) {
        Ok(ciphertext) => {
            let mut payload = Vec::with_capacity(12 + ciphertext.len());
            payload.extend_from_slice(&nonce_bytes);
            payload.extend_from_slice(&ciphertext);
            Ok(format!("wkgrd:{}", b64.encode(payload)))
        }
        Err(e) => Err(AppError::crypto(format!("Encryption failed: {}", e))),
    }
}

#[tauri::command]
pub fn decrypt_password(encrypted: String) -> AppResult<String> {
    if encrypted.is_empty() {
        return Ok(String::new());
    }

    if !encrypted.starts_with("wkgrd:") {
        return Ok(encrypted);
    }

    let base64_payload = &encrypted[6..];
    let payload = match b64.decode(base64_payload) {
        Ok(p) => p,
        Err(_) => {
            return Err(AppError::crypto(
                "Stored secret has an invalid encrypted format. Re-enter it and save the profile again.",
            ))
        }
    };

    if payload.len() < 12 {
        return Err(AppError::crypto(
            "Stored secret is truncated or corrupted. Re-enter it and save the profile again.",
        ));
    }

    let nonce_bytes = &payload[..12];
    let ciphertext = &payload[12..];

    let key = get_or_create_secret_key()?;
    let cipher = Aes256Gcm::new(&key.into());
    let nonce = Nonce::from_slice(nonce_bytes);

    match cipher.decrypt(nonce, ciphertext) {
        Ok(plaintext) => String::from_utf8(plaintext).map_err(|_| {
            AppError::crypto("Stored secret could not be decoded as UTF-8 after decryption.")
        }),
        Err(_) => Err(AppError::crypto(
            "Stored secret could not be decrypted with the current installation key. Re-enter it and save the profile again.",
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encrypt_decrypt_round_trip() {
        let password = "test-password-value".to_string();
        let encrypted = encrypt_password(password.clone()).expect("encrypt failed");
        assert!(encrypted.starts_with("wkgrd:"), "expected wkgrd: prefix");
        let decrypted = decrypt_password(encrypted).expect("decrypt failed");
        assert_eq!(decrypted, password);
    }

    #[test]
    fn encrypt_empty_returns_empty() {
        let encrypted = encrypt_password(String::new()).expect("encrypt empty failed");
        assert_eq!(encrypted, "");
    }

    #[test]
    fn decrypt_plain_passthrough() {
        // A non-wkgrd: string should be returned as-is
        let plain = "not-encrypted".to_string();
        let result = decrypt_password(plain.clone()).expect("decrypt plain failed");
        assert_eq!(result, plain);
    }

    #[test]
    fn vault_set_get_delete_round_trip() {
        let key = format!(
            "test-key-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        );
        let secret = "super-secret-value".to_string();

        vault_set(key.clone(), secret.clone()).expect("vault_set failed");
        let retrieved = vault_get(key.clone()).expect("vault_get failed");
        assert_eq!(retrieved, secret);

        vault_delete(key.clone()).expect("vault_delete failed");
        let result = vault_get(key);
        assert!(result.is_err(), "expected error after delete");
    }
}
