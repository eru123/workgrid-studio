use crate::db::ConnectParams;
use crate::files::app_data_dir;
use crate::logging::{log_info, log_ssh_error, log_ssh_info, log_ssh_verbose};
use crate::TunnelHandle;
use crate::{AppError, AppResult};
use ssh2::Session;
use std::collections::HashMap;
use std::fs;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::Arc;
use std::time::{Duration, Instant};

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

fn trimmed_option(value: Option<&String>) -> Option<&str> {
    value
        .map(|entry| entry.trim())
        .filter(|entry| !entry.is_empty())
}

fn preview_value(value: &str, verbose: bool) -> String {
    if verbose {
        value.to_string()
    } else {
        "<redacted>".to_string()
    }
}

fn preview_option(value: Option<&str>, verbose: bool) -> String {
    match value {
        Some(value) if !value.is_empty() => preview_value(value, verbose),
        _ => "<unset>".to_string(),
    }
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
    verbose: bool,
) -> AppResult<()> {
    let (key_bytes, key_type) = sess
        .host_key()
        .ok_or_else(|| "SSH server did not provide a host key".to_string())?;

    // Use a hex fingerprint so it is human-readable in the JSON file
    let fingerprint: String = key_bytes
        .iter()
        .map(|b| format!("{:02x}", b))
        .collect::<Vec<_>>()
        .join(":");
    let host_id = format!("[{}]:{}", ssh_host, ssh_port);
    log_ssh_verbose(
        pid,
        verbose,
        &format!(
            "SSH host key presented by {}: algorithm={:?}, fingerprint={}",
            host_id, key_type, fingerprint
        ),
    );

    let mut known = load_known_hosts();

    match known.get(&host_id) {
        Some(stored) if stored == &fingerprint => {
            // Key matches — all good
            log_ssh_info(pid, &format!("SSH host key verified for {}", host_id));
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
            log_ssh_error(pid, &msg);
            log_ssh_verbose(
                pid,
                verbose,
                &format!(
                    "SSH host key mismatch details for {}: stored={}, live={}",
                    host_id, stored, fingerprint
                ),
            );
            if strict {
                Err(AppError::ssh(msg))
            } else {
                log_ssh_info(
                    pid,
                    "Strict key checking is OFF — proceeding despite mismatch (not recommended).",
                );
                Ok(())
            }
        }
        None => {
            // First connection — TOFU: store and proceed
            log_ssh_info(
                pid,
                &format!(
                    "SSH: Trusting new host key for {} (fingerprint: {}...) and storing in known_hosts.",
                    host_id,
                    &fingerprint[..std::cmp::min(23, fingerprint.len())]
                ),
            );
            known.insert(host_id, fingerprint);
            save_known_hosts(&known)?;
            if let Ok(path) = known_hosts_path() {
                log_ssh_verbose(
                    pid,
                    verbose,
                    &format!("Stored SSH host key in {}", path.display()),
                );
            }
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
        log_ssh_info(&profile_id, &format!("Forgotten host key for {}", host_id));
    }
    Ok(())
}

pub fn establish_ssh_tunnel(pid: &str, params: &ConnectParams) -> AppResult<TunnelHandle> {
    let started = Instant::now();
    let verbose = params.connection_verbose_logging;
    let ssh_host = trimmed_option(params.ssh_host.as_ref())
        .ok_or_else(|| AppError::ssh("SSH host not provided"))?;
    let ssh_port = params.ssh_port.unwrap_or(22);
    let ssh_user = trimmed_option(params.ssh_user.as_ref())
        .ok_or_else(|| AppError::ssh("SSH user not provided"))?;
    let target_host = params.host.clone();
    let target_port = params.port;
    let auth_method = if trimmed_option(params.ssh_key_file.as_ref()).is_some() {
        "public-key"
    } else if trimmed_option(params.ssh_password.as_ref()).is_some() {
        "password"
    } else {
        "none"
    };

    log_ssh_info(
        pid,
        &format!(
            "Opening SSH tunnel: {}@{}:{} -> {}:{}",
            ssh_user, ssh_host, ssh_port, target_host, target_port
        ),
    );
    log_ssh_verbose(
        pid,
        verbose,
        &format!(
            "SSH options: strict_key_checking={}, compression={}, keep_alive_interval={}s, auth_method={}, key_file={}, password={}, passphrase={}",
            params.ssh_strict_key_checking,
            params.ssh_compression,
            params.ssh_keep_alive_interval,
            auth_method,
            preview_option(trimmed_option(params.ssh_key_file.as_ref()), verbose),
            if trimmed_option(params.ssh_password.as_ref()).is_some() {
                "<provided>"
            } else {
                "<unset>"
            },
            if trimmed_option(params.ssh_passphrase.as_ref()).is_some() {
                "<provided>"
            } else {
                "<unset>"
            },
        ),
    );

    // Connect to SSH server
    let tcp_started = Instant::now();
    let tcp = TcpStream::connect(format!("{}:{}", ssh_host, ssh_port)).map_err(|error| {
        let message = format!(
            "Failed to connect to SSH host {}:{}: {}",
            ssh_host, ssh_port, error
        );
        log_ssh_error(pid, &message);
        AppError::ssh(message)
    })?;
    log_ssh_info(
        pid,
        &format!(
            "SSH TCP socket connected to {}:{} in {} ms",
            ssh_host,
            ssh_port,
            tcp_started.elapsed().as_millis()
        ),
    );

    let mut sess = Session::new().map_err(|error| {
        let message = format!("Failed to create SSH session: {}", error);
        log_ssh_error(pid, &message);
        AppError::ssh(message)
    })?;
    sess.set_tcp_stream(tcp);
    let handshake_started = Instant::now();
    sess.handshake().map_err(|error| {
        let message = format!(
            "SSH handshake failed with {}:{}: {}",
            ssh_host, ssh_port, error
        );
        log_ssh_error(pid, &message);
        AppError::ssh(message)
    })?;
    log_ssh_info(
        pid,
        &format!(
            "SSH handshake completed with {}:{} in {} ms",
            ssh_host,
            ssh_port,
            handshake_started.elapsed().as_millis()
        ),
    );

    // Host key TOFU verification — always runs; strict mode aborts on mismatch
    verify_host_key_tofu(
        pid,
        ssh_host,
        ssh_port,
        &sess,
        params.ssh_strict_key_checking,
        verbose,
    )?;

    // Advanced settings
    if params.ssh_compression {
        sess.set_compress(true);
        log_ssh_verbose(pid, verbose, "SSH compression enabled.");
    } else {
        log_ssh_verbose(pid, verbose, "SSH compression disabled.");
    }
    if params.ssh_keep_alive_interval > 0 {
        sess.set_keepalive(true, params.ssh_keep_alive_interval);
        log_ssh_verbose(
            pid,
            verbose,
            &format!(
                "SSH keep-alive enabled every {} seconds.",
                params.ssh_keep_alive_interval
            ),
        );
    } else {
        log_ssh_verbose(pid, verbose, "SSH keep-alive disabled.");
    }

    // Authenticate
    let auth_started = Instant::now();
    if let Some(key_path) = trimmed_option(params.ssh_key_file.as_ref()) {
        let key_file = std::path::Path::new(key_path);
        sess.userauth_pubkey_file(ssh_user, None, key_file, params.ssh_passphrase.as_deref())
            .map_err(|error| {
                let message = format!("SSH key authentication failed: {}", error);
                log_ssh_error(pid, &message);
                AppError::ssh(message)
            })?;
    } else if let Some(password) = trimmed_option(params.ssh_password.as_ref()) {
        sess.userauth_password(ssh_user, password)
            .map_err(|error| {
                let message = format!("SSH password authentication failed: {}", error);
                log_ssh_error(pid, &message);
                AppError::ssh(message)
            })?;
    } else {
        let message = "No SSH authentication method provided".to_string();
        log_ssh_error(pid, &message);
        return Err(AppError::ssh(message));
    }

    if !sess.authenticated() {
        let message = "SSH authentication failed".to_string();
        log_ssh_error(pid, &message);
        return Err(AppError::ssh(message));
    }
    log_ssh_info(
        pid,
        &format!(
            "SSH authentication succeeded using {} in {} ms",
            auth_method,
            auth_started.elapsed().as_millis()
        ),
    );

    // Start local listener for port forwarding
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|error| {
        let message = format!("Failed to bind local port for SSH tunnel: {}", error);
        log_ssh_error(pid, &message);
        AppError::ssh(message)
    })?;
    let local_port = listener
        .local_addr()
        .map_err(|error| {
            let message = format!("Failed to determine local port for SSH tunnel: {}", error);
            log_ssh_error(pid, &message);
            AppError::ssh(message)
        })?
        .port();
    log_ssh_info(
        pid,
        &format!(
            "SSH local tunnel bound to 127.0.0.1:{} -> {}:{}",
            local_port, target_host, target_port
        ),
    );
    log_ssh_verbose(
        pid,
        verbose,
        &format!(
            "SSH tunnel setup completed in {} ms",
            started.elapsed().as_millis()
        ),
    );

    let pid_clone = pid.to_string();

    let shutdown = Arc::new(AtomicBool::new(false));
    let shutdown_clone = shutdown.clone();
    let verbose_clone = verbose;

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
                    let peer = local_stream
                        .peer_addr()
                        .map(|addr| addr.to_string())
                        .unwrap_or_else(|_| "<unknown>".to_string());
                    log_ssh_verbose(
                        &pid_clone,
                        verbose_clone,
                        &format!(
                            "Accepted local tunnel client from {} on 127.0.0.1:{}",
                            peer, local_port
                        ),
                    );
                    // Open the SSH channel in blocking mode for reliability.
                    sess.set_blocking(true);
                    match sess.channel_direct_tcpip(&target_host, target_port, None) {
                        Ok(mut channel) => {
                            log_ssh_verbose(
                                &pid_clone,
                                verbose_clone,
                                &format!(
                                    "Opened SSH remote channel to {}:{} for local client {}",
                                    target_host, target_port, peer
                                ),
                            );

                            // Switch both sides to non-blocking so a single thread can
                            // poll both directions without racing on the libssh2 session.
                            // (libssh2 is NOT thread-safe; the previous two-thread approach
                            // caused "packet out of order" by concurrently touching the
                            // same session structure from two threads.)
                            sess.set_blocking(false);
                            if let Err(e) = local_stream.set_nonblocking(true) {
                                log_ssh_error(
                                    &pid_clone,
                                    &format!(
                                        "Failed to set local stream non-blocking for {}: {}",
                                        peer, e
                                    ),
                                );
                                let _ = channel.close();
                                sess.set_blocking(true);
                                continue;
                            }

                            let mut local = local_stream;
                            let mut buf = [0u8; 16384];

                            // Single-thread bidirectional copy loop.
                            'copy: loop {
                                if shutdown_clone.load(Ordering::Relaxed) {
                                    break 'copy;
                                }

                                let mut progress = false;

                                // Remote → Local
                                match channel.read(&mut buf) {
                                    Ok(0) => break 'copy,
                                    Ok(n) => {
                                        if local.write_all(&buf[..n]).is_err() {
                                            break 'copy;
                                        }
                                        progress = true;
                                    }
                                    Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {}
                                    Err(_) => break 'copy,
                                }

                                // Local → Remote
                                match local.read(&mut buf) {
                                    Ok(0) => break 'copy,
                                    Ok(n) => {
                                        let data = &buf[..n];
                                        let mut written = 0;
                                        while written < n {
                                            match channel.write(&data[written..]) {
                                                Ok(m) => written += m,
                                                Err(ref e)
                                                    if e.kind()
                                                        == std::io::ErrorKind::WouldBlock =>
                                                {
                                                    std::thread::sleep(Duration::from_millis(1));
                                                }
                                                Err(_) => break 'copy,
                                            }
                                        }
                                        progress = true;
                                    }
                                    Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {}
                                    Err(_) => break 'copy,
                                }

                                if !progress {
                                    std::thread::sleep(Duration::from_millis(1));
                                }
                            }

                            let _ = channel.close();
                            // Reset to blocking so the next channel_direct_tcpip succeeds.
                            sess.set_blocking(true);

                            log_ssh_verbose(
                                &pid_clone,
                                verbose_clone,
                                &format!(
                                    "SSH remote channel to {}:{} closed for local client {}",
                                    target_host, target_port, peer
                                ),
                            );
                        }
                        Err(e) => {
                            log_ssh_error(
                                &pid_clone,
                                &format!(
                                    "SSH tunnel failed to open remote channel to {}:{}: {}",
                                    target_host, target_port, e
                                ),
                            );
                        }
                    }
                }
                Err(e) => {
                    log_ssh_error(
                        &pid_clone,
                        &format!("SSH tunnel bridge accept error: {}", e),
                    );
                }
            }
        }
        log_ssh_verbose(
            &pid_clone,
            verbose_clone,
            &format!("SSH tunnel loop exiting for local port {}", local_port),
        );
        let _ = done_tx.send(());
    });

    Ok(TunnelHandle {
        local_port,
        shutdown,
        thread: Some(join_handle),
        done_rx,
    })
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
    match handle
        .done_rx
        .recv_timeout(std::time::Duration::from_secs(5))
    {
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
