use std::collections::HashMap;
use std::fs;
use std::net::{TcpListener, TcpStream};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use ssh2::Session;
use crate::{AppError, AppResult};
use crate::TunnelHandle;
use crate::files::app_data_dir;
use crate::logging::{log_info, log_error};
use crate::db::ConnectParams;

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

/// Trust-On-First-Use host key verification.
///
/// - First connection to a host: fingerprint is stored in `~/.workgrid-studio/known_hosts.json`
///   and the connection proceeds.
/// - Subsequent connections: stored fingerprint is compared against the live key.
///   If `strict` is true the function returns an error on mismatch (MITM protection).
///   If `strict` is false a warning is logged but the connection is allowed
///   (useful during development with self-signed or rotated keys).
pub fn verify_host_key_tofu(
    pid: &str,
    ssh_host: &str,
    ssh_port: u16,
    sess: &Session,
    strict: bool,
) -> AppResult<()> {
    let (key_bytes, _key_type) = sess
        .host_key()
        .ok_or_else(|| "SSH server did not provide a host key".to_string())?;

    // Use a hex fingerprint so it is human-readable in the JSON file
    let fingerprint: String = key_bytes.iter().map(|b| format!("{:02x}", b)).collect::<Vec<_>>().join(":");
    let host_id = format!("[{}]:{}", ssh_host, ssh_port);

    let mut known = load_known_hosts();

    match known.get(&host_id) {
        Some(stored) if stored == &fingerprint => {
            // Key matches — all good
            log_info(pid, &format!("SSH host key verified for {}", host_id));
            Ok(())
        }
        Some(stored) => {
            // Key has changed — potential MITM
            let msg = format!(
                "SSH host key CHANGED for {}! \
                Stored fingerprint: {}... — Live fingerprint: {}... \
                If you rotated the server key, remove the entry from \
                ~/.workgrid-studio/known_hosts.json and reconnect.",
                host_id,
                &stored[..std::cmp::min(23, stored.len())],
                &fingerprint[..std::cmp::min(23, fingerprint.len())]
            );
            log_error(pid, &msg);
            if strict {
                Err(AppError::ssh(msg))
            } else {
                log_info(pid, "Strict key checking is OFF — proceeding despite mismatch (not recommended).");
                Ok(())
            }
        }
        None => {
            // First connection — TOFU: store and proceed
            log_info(
                pid,
                &format!(
                    "SSH: Trusting new host key for {} (fingerprint: {}...) and storing in known_hosts.",
                    host_id,
                    &fingerprint[..std::cmp::min(23, fingerprint.len())]
                ),
            );
            known.insert(host_id, fingerprint);
            save_known_hosts(&known)?;
            Ok(())
        }
    }
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
    }
    Ok(())
}

pub fn establish_ssh_tunnel(pid: &str, params: &ConnectParams) -> AppResult<TunnelHandle> {
    let ssh_host = params.ssh_host.as_ref().ok_or("SSH host not provided")?;
    let ssh_port = params.ssh_port.unwrap_or(22);
    let ssh_user = params.ssh_user.as_ref().ok_or("SSH user not provided")?;

    // Connect to SSH server
    let tcp = TcpStream::connect(format!("{}:{}", ssh_host, ssh_port))
        .map_err(|e| format!("Failed to connect to SSH host: {}", e))?;

    let mut sess = Session::new().map_err(|e| format!("Failed to create SSH session: {}", e))?;
    sess.set_tcp_stream(tcp);
    sess.handshake().map_err(|e| format!("SSH handshake failed: {}", e))?;

    // Host key TOFU verification — always runs; strict mode aborts on mismatch
    verify_host_key_tofu(pid, ssh_host, ssh_port, &sess, params.ssh_strict_key_checking)?;

    // Advanced settings
    if params.ssh_compression {
        sess.set_compress(true);
    }
    if params.ssh_keep_alive_interval > 0 {
        sess.set_keepalive(true, params.ssh_keep_alive_interval);
    }

    // Authenticate
    if let Some(key_path) = &params.ssh_key_file {
        let key_file = std::path::Path::new(key_path);
        sess.userauth_pubkey_file(
            ssh_user,
            None,
            key_file,
            params.ssh_passphrase.as_deref(),
        ).map_err(|e| format!("SSH key authentication failed: {}", e))?;
    } else if let Some(password) = &params.ssh_password {
        sess.userauth_password(ssh_user, password)
            .map_err(|e| format!("SSH password authentication failed: {}", e))?;
    } else {
        return Err(AppError::ssh("No SSH authentication method provided"));
    }

    if !sess.authenticated() {
        return Err(AppError::ssh("SSH authentication failed"));
    }

    // Start local listener for port forwarding
    let listener = TcpListener::bind("127.0.0.1:0")
        .map_err(|e| format!("Failed to bind local port for SSH tunnel: {}", e))?;
    let local_port = listener.local_addr().unwrap().port();

    let target_host = params.host.clone();
    let target_port = params.port;
    let pid_clone = pid.to_string();

    let shutdown = Arc::new(AtomicBool::new(false));
    let shutdown_clone = shutdown.clone();

    // Channel used to implement a bounded join timeout: the thread sends a
    // single message just before returning, allowing `shutdown_tunnel` to
    // wait at most 5 seconds instead of blocking indefinitely on `join()`.
    let (done_tx, done_rx) = mpsc::channel::<()>();

    // Spawn the tunnel bridge thread and retain the JoinHandle so it can be
    // explicitly joined on disconnect, preventing thread accumulation on rapid
    // connect/reconnect cycles.
    let join_handle = std::thread::spawn(move || {
        for stream in listener.incoming() {
            if shutdown_clone.load(Ordering::Relaxed) {
                break;
            }
            match stream {
                Ok(local_stream) => {
                    match sess.channel_direct_tcpip(&target_host, target_port, None) {
                        Ok(channel) => {
                            let mut channel_read = channel.stream(0);
                            let mut channel_write = channel.clone();
                            let mut local_read = local_stream.try_clone().unwrap();
                            let mut local_write = local_stream;

                            std::thread::spawn(move || {
                                let _ = std::io::copy(&mut local_read, &mut channel_write);
                            });
                            let _ = std::io::copy(&mut channel_read, &mut local_write);
                        }
                        Err(e) => {
                            log_error(&pid_clone, &format!("SSH tunnel failed to open channel: {}", e));
                        }
                    }
                }
                Err(e) => {
                    log_error(&pid_clone, &format!("SSH tunnel bridge accept error: {}", e));
                }
            }
        }
        // Notify shutdown_tunnel() that the loop has fully exited.
        let _ = done_tx.send(());
    });

    Ok(TunnelHandle { local_port, shutdown, thread: Some(join_handle), done_rx })
}

/// Gracefully shut down a tunnel handle:
///   1. Set the shutdown flag so the forwarding loop will exit on its next iteration.
///   2. Connect a dummy TCP stream to unblock `listener.incoming()` immediately.
///   3. Wait up to 5 seconds for the thread to signal via `done_rx` that it has exited.
///   4. Join the thread (non-blocking at this point since the loop has exited or timed out).
///
/// In debug builds, logs a warning if the thread does not exit within the timeout.
pub fn shutdown_tunnel(mut handle: TunnelHandle) {
    handle.shutdown.store(true, Ordering::Relaxed);
    // Unblock the blocking `listener.incoming()` call with a throwaway connection.
    let _ = TcpStream::connect(format!("127.0.0.1:{}", handle.local_port));
    // Wait up to 5 s for the forwarding loop to signal completion.
    let mut should_join = false;
    match handle.done_rx.recv_timeout(std::time::Duration::from_secs(5)) {
        Ok(_) | Err(mpsc::RecvTimeoutError::Disconnected) => {
            should_join = true;
        }
        Err(mpsc::RecvTimeoutError::Timeout) => {
            #[cfg(debug_assertions)]
            eprintln!("[workgrid-studio] [debug] WARNING: SSH tunnel thread did not exit within 5 s — abandoning");
        }
    }

    if should_join {
        if let Some(t) = handle.thread.take() {
            let _ = t.join();
        }
    }
}
