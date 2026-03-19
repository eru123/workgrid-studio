use async_trait::async_trait;
use crate::db::ConnectParams;
use crate::files::app_data_dir;
use crate::logging::{log_info, log_ssh_error, log_ssh_info, log_ssh_verbose};
use crate::{AppError, AppResult, TunnelHandle};
use russh::client;
use russh_keys::{HashAlg, PrivateKey};
use std::collections::HashMap;
use std::fs;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Instant;
use tokio::net::TcpListener;

fn trimmed_option(value: Option<&String>) -> Option<&str> {
    value
        .map(|entry| entry.trim())
        .filter(|entry| !entry.is_empty())
}

/// Like `trimmed_option`, but intended only for sensitive values (passwords,
/// passphrases, tokens, etc.). The result of this function must never be
/// logged or otherwise exposed; it is only for internal use such as
/// authentication calls.
fn trimmed_sensitive_option(value: Option<&String>) -> Option<&str> {
    value
        .map(|entry| entry.trim())
        .filter(|entry| !entry.is_empty())
}

pub fn known_hosts_path() -> AppResult<std::path::PathBuf> {
    Ok(app_data_dir()?.join("known_hosts.json"))
}

pub fn load_known_hosts() -> HashMap<String, String> {
    known_hosts_path()
        .ok()
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

pub fn save_known_hosts(hosts: &HashMap<String, String>) -> AppResult<()> {
    let path = known_hosts_path()?;
    let json = serde_json::to_string_pretty(hosts).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| AppError::io(e.to_string()))
}

/// Remove a stored host key from `known_hosts.json` so the next connection
/// performs a fresh TOFU exchange.  A no-op if the host was never stored.
#[tauri::command]
pub fn forget_host_key(profile_id: String, ssh_host: String, ssh_port: u16) -> AppResult<()> {
    let host_id = format!("[{}]:{}", ssh_host, ssh_port);
    let mut known = load_known_hosts();
    if known.remove(&host_id).is_some() {
        save_known_hosts(&known)?;
        log_info(&profile_id, &format!("Forgotten host key for {}", host_id));
        log_ssh_info(&profile_id, &format!("Forgotten host key for {}", host_id));
    }
    Ok(())
}

// ─── russh client handler (TOFU host key verification) ─────────────────────

struct SshClientHandler {
    pid: String,
    ssh_host: String,
    ssh_port: u16,
    strict: bool,
    verbose: bool,
}

#[async_trait]
impl client::Handler for SshClientHandler {
    type Error = AppError;

    async fn check_server_key(
        &mut self,
        server_public_key: &russh_keys::PublicKey,
    ) -> Result<bool, Self::Error> {
        let fingerprint = server_public_key.fingerprint(HashAlg::Sha256).to_string();
        let host_id = format!("[{}]:{}", self.ssh_host, self.ssh_port);

        log_ssh_verbose(
            &self.pid,
            self.verbose,
            &format!(
                "SSH host key presented by {}: fingerprint={}",
                host_id, fingerprint
            ),
        );

        let mut known = load_known_hosts();

        match known.get(&host_id) {
            Some(stored) if stored == &fingerprint => {
                log_ssh_info(&self.pid, &format!("SSH host key verified for {}", host_id));
                Ok(true)
            }
            Some(stored) if !stored.starts_with("SHA256:") => {
                // Legacy entry from the old ssh2-based implementation used a hex
                // format.  Treat as not-yet-seen and re-do TOFU automatically.
                log_ssh_info(
                    &self.pid,
                    &format!(
                        "SSH: Migrating legacy host key entry for {} to SHA256 format.",
                        host_id
                    ),
                );
                known.insert(host_id, fingerprint);
                let _ = save_known_hosts(&known);
                Ok(true)
            }
            Some(stored) => {
                let msg = format!(
                    "SSH host key CHANGED for {}! \
                    Stored: {}... — Live: {}... \
                    If you rotated the server key, remove the entry from \
                    ~/.workgrid-studio/known_hosts.json and reconnect.",
                    host_id,
                    &stored[..std::cmp::min(23, stored.len())],
                    &fingerprint[..std::cmp::min(23, fingerprint.len())]
                );
                log_ssh_error(&self.pid, &msg);
                if self.strict {
                    Err(AppError::ssh(msg))
                } else {
                    log_ssh_info(
                        &self.pid,
                        "Strict key checking is OFF — proceeding despite mismatch.",
                    );
                    Ok(true)
                }
            }
            None => {
                log_ssh_info(
                    &self.pid,
                    &format!(
                        "SSH: Trusting new host key for {} ({}) and storing in known_hosts.",
                        host_id,
                        &fingerprint[..std::cmp::min(30, fingerprint.len())]
                    ),
                );
                known.insert(host_id, fingerprint);
                let _ = save_known_hosts(&known);
                Ok(true)
            }
        }
    }
}

// ─── Tunnel ─────────────────────────────────────────────────────────────────

pub async fn establish_ssh_tunnel(pid: &str, params: &ConnectParams) -> AppResult<TunnelHandle> {
    let started = Instant::now();
    let verbose = params.connection_verbose_logging;

    let ssh_host = trimmed_option(params.ssh_host.as_ref())
        .ok_or_else(|| AppError::ssh("SSH host not provided"))?
        .to_string();
    let ssh_port = params.ssh_port.unwrap_or(22);
    let ssh_user = trimmed_option(params.ssh_user.as_ref())
        .ok_or_else(|| AppError::ssh("SSH user not provided"))?
        .to_string();
    let target_host = params.host.clone();
    let target_port = params.port;

    log_ssh_info(
        pid,
        &format!(
            "Opening SSH tunnel: {}@{}:{} -> {}:{}",
            ssh_user, ssh_host, ssh_port, target_host, target_port
        ),
    );

    // ── Connect ──────────────────────────────────────────────────────────────
    let config = Arc::new(client::Config {
        inactivity_timeout: Some(std::time::Duration::from_secs(30)),
        ..Default::default()
    });
    let handler = SshClientHandler {
        pid: pid.to_string(),
        ssh_host: ssh_host.clone(),
        ssh_port,
        strict: params.ssh_strict_key_checking,
        verbose,
    };

    let mut session = client::connect(config, (ssh_host.as_str(), ssh_port), handler)
        .await
        .map_err(|e| {
            let msg = format!("SSH connection failed to {}:{}: {}", ssh_host, ssh_port, e);
            log_ssh_error(pid, &msg);
            AppError::ssh(msg)
        })?;

    log_ssh_info(pid, &format!("SSH handshake completed with {}:{}", ssh_host, ssh_port));

    // ── Authenticate ─────────────────────────────────────────────────────────
    let auth_started = Instant::now();

    if let Some(key_path) = trimmed_option(params.ssh_key_file.as_ref()) {
        let passphrase = trimmed_sensitive_option(params.ssh_passphrase.as_ref());
        log_ssh_verbose(pid, verbose, &format!("Loading SSH key from {}", key_path));

        let key: PrivateKey = russh_keys::load_secret_key(key_path, passphrase)
            .map_err(|e| {
                let msg = format!("Failed to load SSH key '{}': {}", key_path, e);
                log_ssh_error(pid, &msg);
                AppError::ssh(msg)
            })?;

        let key_with_hash =
            russh_keys::key::PrivateKeyWithHashAlg::new(Arc::new(key), None)
                .map_err(|e| AppError::ssh(format!("SSH key error: {}", e)))?;

        let authenticated = session
            .authenticate_publickey(&ssh_user, key_with_hash)
            .await
            .map_err(|e| {
                let msg = format!("SSH key authentication failed: {}", e);
                log_ssh_error(pid, &msg);
                AppError::ssh(msg)
            })?;

        if !authenticated {
            let msg = "SSH key authentication was rejected by the server".to_string();
            log_ssh_error(pid, &msg);
            return Err(AppError::ssh(msg));
        }

        log_ssh_info(
            pid,
            &format!(
                "SSH key authentication succeeded in {} ms",
                auth_started.elapsed().as_millis()
            ),
        );
    } else if let Some(password) = trimmed_sensitive_option(params.ssh_password.as_ref()) {
        let authenticated = session
            .authenticate_password(&ssh_user, password)
            .await
            .map_err(|e| {
                let msg = format!("SSH password authentication failed: {}", e);
                log_ssh_error(pid, &msg);
                AppError::ssh(msg)
            })?;

        if !authenticated {
            let msg = "SSH password authentication was rejected by the server".to_string();
            log_ssh_error(pid, &msg);
            return Err(AppError::ssh(msg));
        }

        log_ssh_info(pid, "SSH password authentication succeeded.");
    } else {
        let msg = "No SSH authentication method provided (set a key file or password)".to_string();
        log_ssh_error(pid, &msg);
        return Err(AppError::ssh(msg));
    }

    // ── Bind local listener ───────────────────────────────────────────────────
    let listener = TcpListener::bind("127.0.0.1:0").await.map_err(|e| {
        let msg = format!("Failed to bind local SSH tunnel port: {}", e);
        log_ssh_error(pid, &msg);
        AppError::ssh(msg)
    })?;
    let local_port = listener
        .local_addr()
        .map_err(|e| AppError::ssh(format!("Failed to get local port: {}", e)))?
        .port();

    log_ssh_info(
        pid,
        &format!(
            "SSH local tunnel bound to 127.0.0.1:{} -> {}:{} (setup: {} ms)",
            local_port,
            target_host,
            target_port,
            started.elapsed().as_millis()
        ),
    );

    // ── Tunnel bridge task ───────────────────────────────────────────────────
    let shutdown = Arc::new(AtomicBool::new(false));
    let shutdown_clone = shutdown.clone();
    let pid_clone = pid.to_string();

    let task = tokio::spawn(async move {
        loop {
            if shutdown_clone.load(Ordering::Relaxed) {
                break;
            }

            let (mut local_stream, peer) = match listener.accept().await {
                Ok(s) => s,
                Err(_) => break,
            };

            if shutdown_clone.load(Ordering::Relaxed) {
                break;
            }

            log_ssh_verbose(
                &pid_clone,
                verbose,
                &format!("Accepted tunnel client from {}", peer),
            );

            let channel = match session
                .channel_open_direct_tcpip(
                    target_host.as_str(),
                    target_port as u32,
                    "127.0.0.1",
                    0u32,
                )
                .await
            {
                Ok(ch) => ch,
                Err(e) => {
                    log_ssh_error(
                        &pid_clone,
                        &format!(
                            "SSH tunnel: failed to open remote channel to {}:{}: {}",
                            target_host, target_port, e
                        ),
                    );
                    continue;
                }
            };

            let mut ssh_stream = channel.into_stream();
            let pid_inner = pid_clone.clone();

            tokio::spawn(async move {
                match tokio::io::copy_bidirectional(&mut local_stream, &mut ssh_stream).await {
                    Ok((a, b)) => {
                        log_ssh_verbose(
                            &pid_inner,
                            verbose,
                            &format!("Tunnel connection closed (→{} ←{} bytes)", a, b),
                        );
                    }
                    Err(e) => {
                        log_ssh_verbose(
                            &pid_inner,
                            verbose,
                            &format!("Tunnel connection ended: {}", e),
                        );
                    }
                }
            });
        }

        log_ssh_verbose(&pid_clone, verbose, "SSH tunnel loop exiting.");
    });

    Ok(TunnelHandle {
        local_port,
        shutdown,
        task: Some(task),
    })
}

/// Gracefully shut down a tunnel: set the shutdown flag and abort the task.
pub fn shutdown_tunnel(mut handle: TunnelHandle) {
    handle.shutdown.store(true, Ordering::Relaxed);
    if let Some(task) = handle.task.take() {
        task.abort();
    }
}
