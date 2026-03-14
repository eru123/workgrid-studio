use std::collections::HashMap;
use std::fs;
use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use base64::{engine::general_purpose::STANDARD as b64, Engine};
use rand::RngCore;
use crate::files::ensure_app_dirs;

/// Retrieve or create the 32-byte AES-256-GCM master key used for vault and
/// password encryption.
///
/// Key storage priority:
///   1. OS credential store (Windows Credential Manager / macOS Keychain /
///      Linux Secret Service) via the `keyring` crate.
///   2. Legacy `~/.workgrid-studio/data/secret.key` flat file — migrated to
///      the OS store on first access, then deleted.
///   3. Flat-file fallback when the OS store is unavailable (e.g., headless CI,
///      Linux without a running secret-service daemon).
pub fn get_or_create_secret_key() -> Result<[u8; 32], String> {
    const SERVICE: &str = "workgrid-studio";
    const ACCOUNT: &str = "vault-key";

    let entry = match keyring::Entry::new(SERVICE, ACCOUNT) {
        Ok(e) => e,
        Err(e) => {
            eprintln!("[workgrid-studio] Keychain entry init failed ({e}), falling back to file-based key");
            return get_or_create_key_from_file();
        }
    };

    match entry.get_password() {
        Ok(encoded) => {
            // Key already stored in OS keychain.
            let bytes = b64.decode(&encoded)
                .map_err(|e| format!("Keychain key decode error: {e}"))?;
            if bytes.len() != 32 {
                return Err("Keychain vault key has unexpected length; \
                            delete the 'workgrid-studio / vault-key' keychain entry and restart".to_string());
            }
            let mut key = [0u8; 32];
            key.copy_from_slice(&bytes);
            Ok(key)
        }
        Err(keyring::Error::NoEntry) => {
            // Nothing in the keychain yet — check for a legacy flat file to migrate.
            let base = ensure_app_dirs()?;
            let key_path = base.join("data").join("secret.key");

            let key: [u8; 32] = if key_path.exists() {
                // Migrate: read key from file, will store it in the keychain below.
                let contents = fs::read(&key_path)
                    .map_err(|e| format!("Failed to read secret.key during migration: {e}"))?;
                if contents.len() != 32 {
                    return Err("secret.key has unexpected length; delete it and restart".to_string());
                }
                let mut k = [0u8; 32];
                k.copy_from_slice(&contents);
                k
            } else {
                // Fresh install — generate a new key.
                let mut k = [0u8; 32];
                rand::thread_rng().fill_bytes(&mut k);
                k
            };

            // Persist to OS keychain.
            let encoded = b64.encode(key);
            entry.set_password(&encoded)
                .map_err(|e| format!("Failed to store vault key in OS keychain: {e}"))?;

            // Remove the legacy file now that the keychain holds the key.
            if key_path.exists() {
                let _ = fs::remove_file(&key_path);
            }

            Ok(key)
        }
        Err(e) => {
            // Keychain present but inaccessible (locked, permission denied, no daemon, etc.).
            eprintln!("[workgrid-studio] OS keychain unavailable ({e}), falling back to file-based key");
            get_or_create_key_from_file()
        }
    }
}

/// File-based fallback for `get_or_create_secret_key()`.
/// Used when the OS credential store is unavailable (headless environments,
/// Linux systems without a running secret-service daemon, etc.).
pub fn get_or_create_key_from_file() -> Result<[u8; 32], String> {
    let base = ensure_app_dirs()?;
    let key_path = base.join("data").join("secret.key");

    if key_path.exists() {
        let contents = fs::read(&key_path)
            .map_err(|e| format!("Failed to read secret.key: {e}"))?;
        if contents.len() == 32 {
            let mut key = [0u8; 32];
            key.copy_from_slice(&contents);
            return Ok(key);
        }
    }

    let mut key = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut key);
    fs::write(&key_path, &key)
        .map_err(|e| format!("Failed to write secret.key: {e}"))?;

    Ok(key)
}

// Vault uses the same randomly-generated per-installation key as encrypt_password /
// decrypt_password (get_or_create_secret_key). The old username-derived key
// (get_vault_key) has been removed because it was trivially reversible by anyone
// with access to the vault file. Existing vault entries encrypted with the old key
// will fail to decrypt (the caller receives an error) and the user will need to
// re-enter their secrets once after upgrading.

#[tauri::command]
pub fn vault_set(key: String, secret: String) -> Result<(), String> {
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

    let ciphertext = cipher.encrypt(nonce, secret.as_bytes())
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
pub fn vault_get(key: String) -> Result<String, String> {
    let base = ensure_app_dirs()?;
    let vault_path = base.join(".vault");

    if !vault_path.exists() {
        return Err("No vault found".to_string());
    }

    let content = fs::read_to_string(&vault_path).map_err(|e| e.to_string())?;
    let vault: HashMap<String, String> = serde_json::from_str(&content).map_err(|e| e.to_string())?;

    let encrypted_b64 = vault.get(&key).ok_or("Key not found in vault")?;
    let combined = b64.decode(encrypted_b64).map_err(|_| "Invalid base64 payload")?;

    if combined.len() < 12 {
        return Err("Payload too short".to_string());
    }

    let nonce = Nonce::from_slice(&combined[0..12]);
    let ciphertext = &combined[12..];

    let cipher_key = get_or_create_secret_key()?;
    let cipher = Aes256Gcm::new(&cipher_key.into());

    let plaintext = cipher.decrypt(nonce, ciphertext)
        .map_err(|_| "Decryption failed — the vault entry may have been encrypted with an older key. Please re-enter your secret.".to_string())?;

    String::from_utf8(plaintext).map_err(|_| "Invalid UTF-8 in secret".to_string())
}

#[tauri::command]
pub fn vault_delete(key: String) -> Result<(), String> {
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
pub fn encrypt_password(password: String) -> Result<String, String> {
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
        Err(e) => Err(format!("Encryption failed: {}", e)),
    }
}

#[tauri::command]
pub fn decrypt_password(encrypted: String) -> Result<String, String> {
    if encrypted.is_empty() {
        return Ok(String::new());
    }

    if !encrypted.starts_with("wkgrd:") {
        return Ok(encrypted);
    }

    let base64_payload = &encrypted[6..];
    let payload = match b64.decode(base64_payload) {
        Ok(p) => p,
        Err(_) => return Ok(encrypted),
    };

    if payload.len() < 12 {
        return Ok(encrypted);
    }

    let nonce_bytes = &payload[..12];
    let ciphertext = &payload[12..];

    let key = get_or_create_secret_key()?;
    let cipher = Aes256Gcm::new(&key.into());
    let nonce = Nonce::from_slice(nonce_bytes);

    match cipher.decrypt(nonce, ciphertext) {
        Ok(plaintext) => String::from_utf8(plaintext).or_else(|_| Ok(encrypted.clone())),
        Err(_) => Ok(encrypted),
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
        let key = format!("test-key-{}", std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos());
        let secret = "super-secret-value".to_string();

        vault_set(key.clone(), secret.clone()).expect("vault_set failed");
        let retrieved = vault_get(key.clone()).expect("vault_get failed");
        assert_eq!(retrieved, secret);

        vault_delete(key.clone()).expect("vault_delete failed");
        let result = vault_get(key);
        assert!(result.is_err(), "expected error after delete");
    }
}

