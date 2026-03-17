use crate::db::ConnectParams;
use crate::files::app_data_dir;
use crate::logging::{log_info, log_ssh_error, log_ssh_info, log_ssh_verbose};
use crate::TunnelHandle;
use crate::{AppError, AppResult};
use ssh2::Session;
use std::collections::HashMap;
use std::fs;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream, ToSocketAddrs};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::Arc;
use std::time::{Duration, Instant};

// ─── OpenSSH key conversion helpers ────────────────────────────────
//
// libssh2 on some platforms (notably Windows) fails to parse
// "-----BEGIN OPENSSH PRIVATE KEY-----" format keys, returning the
// generic [Session(-1)] unknown error.  The helpers below parse the
// binary OpenSSH key container without any extra crates and re-encode
// Ed25519 keys as unencrypted PKCS#8 PEM, which libssh2 handles reliably
// across all platforms.  RSA/ECDSA keys in OpenSSH format fall through
// to an SSH-agent fallback.

/// Parse an **unencrypted** Ed25519 OpenSSH private key and return the
/// 32-byte private seed.  Returns `None` for encrypted keys, non-Ed25519
/// keys, or malformed data (all of which are handled by the caller).
fn parse_ed25519_seed_from_openssh(pem_content: &str) -> Option<[u8; 32]> {
    use base64::Engine;

    // Strip PEM armour and decode.
    let b64: String = pem_content
        .lines()
        .filter(|l| !l.starts_with("-----"))
        .collect();
    let data = base64::engine::general_purpose::STANDARD
        .decode(b64.trim())
        .ok()?;

    // A tiny cursor helper operating on the decoded bytes.
    struct Cur<'a>(&'a [u8], usize);
    impl<'a> Cur<'a> {
        fn u32(&mut self) -> Option<u32> {
            if self.1 + 4 > self.0.len() {
                return None;
            }
            let v = u32::from_be_bytes(self.0[self.1..self.1 + 4].try_into().ok()?);
            self.1 += 4;
            Some(v)
        }
        fn string(&mut self) -> Option<&'a [u8]> {
            let n = self.u32()? as usize;
            if self.1 + n > self.0.len() {
                return None;
            }
            let s = &self.0[self.1..self.1 + n];
            self.1 += n;
            Some(s)
        }
    }

    // Validate magic header "openssh-key-v1\0".
    let magic = b"openssh-key-v1\0";
    if data.len() < magic.len() || &data[..magic.len()] != magic {
        return None;
    }
    let mut c = Cur(&data, magic.len());

    // cipher must be "none" — refuse to handle encrypted keys.
    if c.string()? != b"none" {
        return None;
    }
    c.string()?; // kdf name
    c.string()?; // kdf options
    c.u32()?;    // number of keys
    c.string()?; // public key block

    // Private key block.
    let priv_block = c.string()?;
    let mut p = Cur(priv_block, 0);
    p.u32()?; // checkint1
    p.u32()?; // checkint2
    if p.string()? != b"ssh-ed25519" {
        return None; // not Ed25519
    }
    p.string()?; // public key (32 bytes, skip)

    // Private key field = seed[32] || pubkey[32].
    let priv_field = p.string()?;
    if priv_field.len() < 32 {
        return None;
    }
    let mut seed = [0u8; 32];
    seed.copy_from_slice(&priv_field[..32]);
    Some(seed)
}

/// Encode a 32-byte Ed25519 seed as an unencrypted PKCS#8 PEM
/// (`-----BEGIN PRIVATE KEY-----`) that libssh2 handles on all platforms.
fn ed25519_seed_to_pkcs8_pem(seed: &[u8; 32]) -> String {
    use base64::Engine;
    // RFC 8410 §7  OneAsymmetricKey v0 for Ed25519
    // SEQUENCE { INTEGER 0; SEQUENCE { OID 1.3.101.112 }; OCTET STRING { OCTET STRING { <32 bytes> } } }
    let mut der: Vec<u8> = vec![
        0x30, 0x2e, // SEQUENCE (46 bytes)
        0x02, 0x01, 0x00, // INTEGER 0
        0x30, 0x05, // SEQUENCE (5 bytes)
        0x06, 0x03, 0x2b, 0x65, 0x70, // OID 1.3.101.112
        0x04, 0x22, // OCTET STRING (34 bytes)
        0x04, 0x20, // OCTET STRING (32 bytes)
    ];
    der.extend_from_slice(seed);

    let b64 = base64::engine::general_purpose::STANDARD.encode(&der);
    let mut pem = String::from("-----BEGIN PRIVATE KEY-----\n");
    for chunk in b64.as_bytes().chunks(64) {
        pem.push_str(std::str::from_utf8(chunk).unwrap());
        pem.push('\n');
    }
    pem.push_str("-----END PRIVATE KEY-----\n");
    pem
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

/// Return a non-sensitive summary for an optional sensitive value.
/// This is safe to log because it never includes the underlying data,
/// only whether it is present or not.
///
/// Intentionally avoids calling `trimmed_option` so that sensitive values
/// never flow through that function's taint path into log calls.
fn summarize_sensitive_option(value: Option<&String>) -> &'static str {
    if value.map_or(false, |s| !s.trim().is_empty()) {
        "<provided>"
    } else {
        "<unset>"
    }
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
    } else if params.ssh_password.as_ref().map_or(false, |s| !s.trim().is_empty()) {
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
            summarize_sensitive_option(params.ssh_password.as_ref()),
            summarize_sensitive_option(params.ssh_passphrase.as_ref()),
        ),
    );

    // Connect to SSH server with a 30-second timeout so a slow or
    // unreachable host does not block the caller indefinitely.
    let tcp_started = Instant::now();
    let ssh_addr = (ssh_host, ssh_port)
        .to_socket_addrs()
        .map_err(|e| {
            let message = format!(
                "Failed to resolve SSH host {}:{}: {}",
                ssh_host, ssh_port, e
            );
            log_ssh_error(pid, &message);
            AppError::ssh(message)
        })?
        .next()
        .ok_or_else(|| {
            let message = format!(
                "No address found for SSH host {}:{}",
                ssh_host, ssh_port
            );
            log_ssh_error(pid, &message);
            AppError::ssh(message)
        })?;

    let tcp = TcpStream::connect_timeout(&ssh_addr, Duration::from_secs(30)).map_err(|error| {
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

        // Use trimmed_sensitive_option so an empty passphrase field is treated
        // as None rather than Some(""), which causes libssh2 to reject valid
        // keys. This helper is only for sensitive data and must never be used
        // for logging.
        let passphrase = trimmed_sensitive_option(params.ssh_passphrase.as_ref());

        let key_content = fs::read_to_string(key_file).ok();
        let is_openssh_format = key_content
            .as_deref()
            .map(|c| c.contains("BEGIN OPENSSH PRIVATE KEY"))
            .unwrap_or(false);

        // ── Strategy for OpenSSH-format keys ──────────────────────────────
        // libssh2 on some platforms (Windows in particular) cannot parse
        // "BEGIN OPENSSH PRIVATE KEY" and returns the generic [Session(-1)]
        // unknown error.  We work around this with a three-step fallback:
        //
        //  1. For unencrypted Ed25519 keys: parse the seed manually and
        //     re-encode as PKCS#8 PEM, then authenticate via in-memory API.
        //  2. Standard file-based auth — works when libssh2 can parse the key
        //     (RSA/ECDSA on builds with OpenSSL >= 1.1.1, or old PEM format).
        //  3. SSH agent — covers encrypted OpenSSH keys and key types we
        //     cannot convert, provided the key is loaded in the agent.
        let mut authed = false;

        if is_openssh_format {
            log_ssh_info(pid, "Detected OpenSSH private key format; using compatibility path.");

            // Step 1 — PKCS#8 conversion for unencrypted Ed25519.
            // Write to a uniquely-named temp file, auth, then delete immediately.
            if passphrase.is_none() {
                if let Some(content) = &key_content {
                    if let Some(seed) = parse_ed25519_seed_from_openssh(content) {
                        log_ssh_verbose(
                            pid,
                            verbose,
                            "Ed25519 OpenSSH key parsed; attempting PKCS#8 conversion auth.",
                        );
                        let pkcs8_pem = ed25519_seed_to_pkcs8_pem(&seed);
                        let tmp_path = std::env::temp_dir()
                            .join(format!("wgs-key-{}.pem", uuid::Uuid::new_v4()));
                        if fs::write(&tmp_path, pkcs8_pem.as_bytes()).is_ok() {
                            let auth_ok = sess
                                .userauth_pubkey_file(ssh_user, None, &tmp_path, None)
                                .is_ok()
                                && sess.authenticated();
                            let _ = fs::remove_file(&tmp_path); // always clean up
                            if auth_ok {
                                authed = true;
                                log_ssh_info(
                                    pid,
                                    "SSH authentication succeeded via Ed25519 PKCS#8 conversion.",
                                );
                            }
                        }
                    }
                }
            }
        }

        // Step 2 — standard file-based auth.
        if !authed {
            if let Err(file_err) = sess.userauth_pubkey_file(ssh_user, None, key_file, passphrase)
            {
                // Step 3 — SSH agent fallback (covers encrypted OpenSSH keys,
                // RSA/ECDSA OpenSSH keys, and any other format libssh2 rejects).
                if is_openssh_format {
                    log_ssh_info(
                        pid,
                        "File-based key auth failed; trying SSH agent as fallback.",
                    );
                    if sess.userauth_agent(ssh_user).is_ok() && sess.authenticated() {
                        authed = true;
                        log_ssh_info(pid, "SSH agent authentication succeeded.");
                    }
                }

                if !authed {
                    let base = format!("SSH key authentication failed: {}", file_err);
                    let hint = if is_openssh_format {
                        " (OpenSSH key format is not supported by this build of libssh2. \
                        Convert the key to classic PEM with: \
                        ssh-keygen -p -m PEM -f <keyfile>)"
                    } else {
                        ""
                    };
                    let message = format!("{}{}", base, hint);
                    log_ssh_error(pid, &message);
                    return Err(AppError::ssh(message));
                }
            } else {
                authed = true;
            }
        }

        if !authed {
            let message = "SSH key authentication failed.".to_string();
            log_ssh_error(pid, &message);
            return Err(AppError::ssh(message));
        }
    } else if let Some(password) = trimmed_sensitive_option(params.ssh_password.as_ref()) {
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
