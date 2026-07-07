// SSH tunneling via russh. Ported from legacy ssh.rs.
//
// - TOFU host-key verification (trust-on-first-use) against known_hosts.json
// - Password + public-key authentication
// - direct-tcpip tunnel (normal) OR docker exec tunnel (Docker mode)
// - Cancellation via AtomicBool + task abort on shutdown

use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Instant;

use russh::client;
use russh::keys::{HashAlg, PrivateKey, PrivateKeyWithHashAlg};
use tokio::net::TcpListener;

use crate::models::ConnectParams;
use crate::services::files::app_data_dir;
use crate::{AppError, AppResult};

/// Handle to a running SSH tunnel. Dropping this does not stop the tunnel —
/// call `shutdown()` to tear it down.
pub struct TunnelHandle {
    pub local_port: u16,
    pub shutdown: Arc<AtomicBool>,
    pub task: Option<tokio::task::JoinHandle<()>>,
}

impl TunnelHandle {
    /// Stop the tunnel: set the shutdown flag and abort the task.
    pub async fn shutdown(self) {
        self.shutdown.store(true, Ordering::Relaxed);
        if let Some(task) = self.task {
            task.abort();
        }
    }
}

//  ------ known_hosts (TOFU storage)

pub fn known_hosts_path() -> AppResult<PathBuf> {
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
    let json = serde_json::to_string_pretty(hosts)?;
    fs::write(&path, json)?;
    Ok(())
}

//  ------ russh client handler (TOFU)

struct SshClientHandler {
    ssh_host: String,
    ssh_port: u16,
    strict: bool,
}

impl client::Handler for SshClientHandler {
    type Error = AppError;

    async fn check_server_key(
        &mut self,
        server_public_key: &russh::keys::ssh_key::PublicKey,
    ) -> Result<bool, Self::Error> {
        let fingerprint = server_public_key.fingerprint(HashAlg::Sha256).to_string();
        let host_id = format!("[{}]:{}", self.ssh_host, self.ssh_port);

        let mut known = load_known_hosts();

        match known.get(&host_id) {
            Some(stored) if stored == &fingerprint => {
                // Key matches — trust.
                Ok(true)
            }
            Some(stored) if !stored.starts_with("SHA256:") => {
                // Legacy hex-format entry — migrate to SHA256 automatically.
                known.insert(host_id, fingerprint);
                let _ = save_known_hosts(&known);
                Ok(true)
            }
            Some(stored) => {
                // Key changed — potential MITM.
                let msg = format!(
                    "SSH host key CHANGED for {}! Stored: {}... — Live: {}... \
                    If you rotated the server key, remove the entry from \
                    ~/.workgrid-studio/known_hosts.json and reconnect.",
                    host_id,
                    &stored[..std::cmp::min(23, stored.len())],
                    &fingerprint[..std::cmp::min(23, fingerprint.len())]
                );
                if self.strict {
                    Err(AppError::ssh(msg))
                } else {
                    // Non-strict: proceed despite mismatch.
                    known.insert(host_id, fingerprint);
                    let _ = save_known_hosts(&known);
                    Ok(true)
                }
            }
            None => {
                // First time seeing this host — trust and store (TOFU).
                known.insert(host_id, fingerprint);
                let _ = save_known_hosts(&known);
                Ok(true)
            }
        }
    }
}

//  ------ tunnel establishment

fn trimmed_option(value: Option<&String>) -> Option<&str> {
    value.map(|e| e.trim()).filter(|e| !e.is_empty())
}

/// Build the docker exec proxy command. Uses bash's /dev/tcp so no nc/socat
/// is needed inside the container.
fn docker_proxy_cmd(container: &str, target_port: u16) -> String {
    format!(
        "docker exec -i {} bash -c 'exec 3<>/dev/tcp/127.0.0.1/{}; cat <&3 & cat >&3; wait'",
        container, target_port
    )
}

/// Establish an SSH tunnel and return a handle. The tunnel binds a local
/// ephemeral port on 127.0.0.1 and forwards connections to the target
/// host:port (or via docker exec if use_docker is set).
pub async fn establish_ssh_tunnel(
    profile_id: &str,
    params: &ConnectParams,
) -> AppResult<TunnelHandle> {
    let _started = Instant::now();
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

    // Connect to the SSH server.
    let config = Arc::new(client::Config {
        inactivity_timeout: Some(std::time::Duration::from_secs(30)),
        ..Default::default()
    });
    let handler = SshClientHandler {
        ssh_host: ssh_host.clone(),
        ssh_port,
        strict: params.ssh_strict_key_checking,
    };

    let mut session = client::connect(config, (ssh_host.as_str(), ssh_port), handler)
        .await
        .map_err(|e| AppError::ssh(format!("SSH connect failed: {}", e)))?;

    // Authenticate.
    if let Some(key_path) = trimmed_option(params.ssh_key_file.as_ref()) {
        let passphrase = trimmed_option(params.ssh_passphrase.as_ref());
        let key: PrivateKey = russh::keys::load_secret_key(key_path, passphrase)
            .map_err(|e| AppError::ssh(format!("SSH key load error: {}", e)))?;
        let key_with_hash = PrivateKeyWithHashAlg::new(Arc::new(key), None);
        let result = session
            .authenticate_publickey(&ssh_user, key_with_hash)
            .await
            .map_err(|e| AppError::ssh(format!("SSH auth error: {}", e)))?;
        if !result.success() {
            return Err(AppError::ssh(
                "SSH key authentication was rejected by the server",
            ));
        }
    } else if let Some(password) = trimmed_option(params.ssh_password.as_ref()) {
        let result = session
            .authenticate_password(&ssh_user, password)
            .await
            .map_err(|e| AppError::ssh(format!("SSH auth error: {}", e)))?;
        if !result.success() {
            return Err(AppError::ssh(
                "SSH password authentication was rejected by the server",
            ));
        }
    } else {
        return Err(AppError::ssh(
            "No SSH authentication method provided (set a key file or password)",
        ));
    }

    // Bind local listener on an ephemeral port.
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| AppError::ssh(format!("Failed to bind local tunnel port: {}", e)))?;
    let local_port = listener
        .local_addr()
        .map_err(|e| AppError::ssh(format!("Failed to get local port: {}", e)))?
        .port();

    // Determine tunnel mode.
    let docker_cmd: Option<String> = if params.use_docker {
        let container = trimmed_option(params.docker_container.as_ref())
            .ok_or_else(|| AppError::ssh("Docker mode enabled but no container name provided"))?;
        Some(docker_proxy_cmd(container, target_port))
    } else {
        None
    };

    let shutdown = Arc::new(AtomicBool::new(false));
    let shutdown_clone = shutdown.clone();
    let target_host_clone = target_host.clone();

    let task = tokio::spawn(async move {
        loop {
            if shutdown_clone.load(Ordering::Relaxed) {
                break;
            }

            let (mut local_stream, _peer) = match listener.accept().await {
                Ok(s) => s,
                Err(_) => break,
            };
            if shutdown_clone.load(Ordering::Relaxed) {
                break;
            }

            // Open the appropriate channel.
            let channel = if let Some(ref cmd) = docker_cmd {
                let ch = match session.channel_open_session().await {
                    Ok(ch) => ch,
                    Err(_) => continue,
                };
                if ch.exec(true, cmd.as_str()).await.is_err() {
                    continue;
                }
                ch
            } else {
                match session
                    .channel_open_direct_tcpip(
                        target_host_clone.as_str(),
                        target_port as u32,
                        "127.0.0.1",
                        0u32,
                    )
                    .await
                {
                    Ok(ch) => ch,
                    Err(_) => continue,
                }
            };

            let mut ssh_stream = channel.into_stream();
            tokio::spawn(async move {
                let _ = tokio::io::copy_bidirectional(&mut local_stream, &mut ssh_stream).await;
            });
        }
    });

    let _ = (profile_id, verbose); // verbose logging stubbed for now

    Ok(TunnelHandle {
        local_port,
        shutdown,
        task: Some(task),
    })
}
