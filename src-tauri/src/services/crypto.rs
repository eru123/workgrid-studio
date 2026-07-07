// AES-256-GCM credential encryption. Ported from legacy crypto.rs.
//
// Wire format (unchanged for profile compatibility): `wkgrd:` prefix + base64
// of [12-byte nonce || ciphertext]. Empty input round-trips to empty string.
// Non-`wkgrd:`-prefixed strings pass through unchanged on decrypt (legacy
// plaintext tolerated).

use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use base64::{engine::general_purpose::STANDARD as b64, Engine};
use rand::RngCore;

use crate::services::files::{ensure_app_dirs, secret_key_path};
use crate::{AppError, AppResult};

const SERVICE: &str = "workgrid-studio";
const ACCOUNT: &str = "vault-key";

fn fill_random(bytes: &mut [u8]) {
    let mut rng = rand::thread_rng();
    rng.fill_bytes(bytes);
}

/// Get or create the 32-byte master key. File-first (`~/.workgrid-studio/data/secret.key`),
/// OS keyring as a best-effort mirror.
pub fn get_or_create_secret_key() -> AppResult<[u8; 32]> {
    if let Some(key) = read_secret_key_from_file()? {
        let _ = store_key_in_keyring(SERVICE, ACCOUNT, &key);
        return Ok(key);
    }

    if let Ok(entry) = keyring::Entry::new(SERVICE, ACCOUNT) {
        if let Ok(encoded) = entry.get_password() {
            if let Ok(bytes) = b64.decode(&encoded) {
                if bytes.len() == 32 {
                    let key: [u8; 32] = bytes
                        .try_into()
                        .map_err(|_| "Keychain key has invalid length".to_string())?;
                    write_secret_key_to_file(&key)?;
                    return Ok(key);
                }
            }
        }
    }

    let key = get_or_create_key_from_file()?;
    let _ = store_key_in_keyring(SERVICE, ACCOUNT, &key);
    Ok(key)
}

fn read_secret_key_from_file() -> AppResult<Option<[u8; 32]>> {
    let path = secret_key_path()?;
    if !path.exists() {
        return Ok(None);
    }
    let bytes = std::fs::read(&path)?;
    if bytes.len() != 32 {
        return Ok(None);
    }
    let key: [u8; 32] = bytes
        .try_into()
        .map_err(|_| "Secret key file has invalid length".to_string())?;
    Ok(Some(key))
}

fn write_secret_key_to_file(key: &[u8; 32]) -> AppResult<()> {
    let _ = ensure_app_dirs()?;
    let path = secret_key_path()?;
    std::fs::write(&path, key)?;
    Ok(())
}

fn get_or_create_key_from_file() -> AppResult<[u8; 32]> {
    if let Some(key) = read_secret_key_from_file()? {
        return Ok(key);
    }
    let mut key = [0u8; 32];
    fill_random(&mut key);
    write_secret_key_to_file(&key)?;
    Ok(key)
}

fn store_key_in_keyring(service: &str, account: &str, key: &[u8; 32]) -> AppResult<()> {
    let entry = keyring::Entry::new(service, account)?;
    let encoded = b64.encode(key);
    entry.set_password(&encoded)?;
    Ok(())
}

/// Encrypt a password. Returns `wkgrd:<base64(nonce||ciphertext)>`.
/// Empty input returns empty string (no encryption performed).
pub fn encrypt_password(password: &str) -> AppResult<String> {
    if password.is_empty() {
        return Ok(String::new());
    }

    let key = get_or_create_secret_key()?;
    let cipher = Aes256Gcm::new(&key.into());

    let mut nonce_bytes = [0u8; 12];
    fill_random(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher
        .encrypt(nonce, password.as_bytes())
        .map_err(|e| AppError::crypto(format!("Encryption failed: {}", e)))?;

    let mut payload = Vec::with_capacity(12 + ciphertext.len());
    payload.extend_from_slice(&nonce_bytes);
    payload.extend_from_slice(&ciphertext);
    Ok(format!("wkgrd:{}", b64.encode(&payload)))
}

/// Decrypt a `wkgrd:`-prefixed string. Non-prefixed strings pass through
/// unchanged (legacy plaintext tolerated). Empty input returns empty string.
pub fn decrypt_password(encrypted: &str) -> AppResult<String> {
    if encrypted.is_empty() {
        return Ok(String::new());
    }
    if !encrypted.starts_with("wkgrd:") {
        return Ok(encrypted.to_string());
    }

    let base64_payload = &encrypted[6..];
    let payload = b64
        .decode(base64_payload)
        .map_err(|_| AppError::crypto("Stored secret has an invalid encrypted format. Re-enter it and save the profile again."))?;

    if payload.len() < 12 {
        return Err(AppError::crypto(
            "Stored secret is truncated or corrupted. Re-enter it and save the profile again.",
        ));
    }

    let (nonce_bytes, ciphertext) = payload.split_at(12);
    let key = get_or_create_secret_key()?;
    let cipher = Aes256Gcm::new(&key.into());
    let nonce = Nonce::from_slice(nonce_bytes);

    let plaintext = cipher
        .decrypt(nonce, ciphertext)
        .map_err(|_| AppError::crypto("Stored secret could not be decrypted with the current installation key. Re-enter it and save the profile again."))?;

    String::from_utf8(plaintext).map_err(|_| {
        AppError::crypto("Stored secret could not be decoded as UTF-8 after decryption.")
    })
}
