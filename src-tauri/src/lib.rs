use tauri::State;
use std::env;
use std::path::PathBuf;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::sync::Mutex;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::collections::HashMap;
use std::net::{TcpStream, TcpListener};
use ssh2::Session;

pub struct TunnelHandle {
    pub local_port: u16,
    pub shutdown: Arc<AtomicBool>,
    /// Join handle for the forwarding thread. Taken (set to `None`) on disconnect
    /// so the thread can be explicitly joined rather than leaked.
    pub thread: Option<std::thread::JoinHandle<()>>,
    /// Receives a single `()` message when the forwarding loop exits.
    /// Used to implement a bounded join timeout: `recv_timeout(5 s)` blocks
    /// only until the thread signals completion rather than indefinitely.
    pub done_rx: mpsc::Receiver<()>,
}

use mysql_async::prelude::*;
use mysql_async::{Opts, OptsBuilder, Pool, PoolOpts, PoolConstraints, TxOpts};
use serde::{Deserialize, Serialize};

// Crypto & HTTP imports
use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use base64::{engine::general_purpose::STANDARD as b64, Engine};
use rand::RngCore;
use reqwest::Client;

// ─── App Data Dir ───────────────────────────────────────────────────

fn app_data_dir() -> Result<PathBuf, String> {
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .map_err(|_| "Cannot determine home directory".to_string())?;
    Ok(PathBuf::from(home).join(".workgrid-studio"))
}

fn ensure_app_dirs() -> Result<PathBuf, String> {
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

// ─── Logging ────────────────────────────────────────────────────────

fn log_dir_for(profile_id: &str) -> Result<PathBuf, String> {
    let base = app_data_dir()?;
    let dir = base.join("logs").join(profile_id);
    if !dir.exists() {
        fs::create_dir_all(&dir)
            .map_err(|e| format!("Failed to create log dir: {}", e))?;
    }
    Ok(dir)
}

fn timestamp() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    let secs = now.as_secs();
    // Simple UTC timestamp: YYYY-MM-DD HH:MM:SS
    let days = secs / 86400;
    let time_secs = secs % 86400;
    let hours = time_secs / 3600;
    let minutes = (time_secs % 3600) / 60;
    let seconds = time_secs % 60;

    // Approximate date calculation
    let mut y = 1970i64;
    let mut remaining = days as i64;
    loop {
        let days_in_year = if y % 4 == 0 && (y % 100 != 0 || y % 400 == 0) { 366 } else { 365 };
        if remaining < days_in_year { break; }
        remaining -= days_in_year;
        y += 1;
    }
    let leap = y % 4 == 0 && (y % 100 != 0 || y % 400 == 0);
    let months_days = [31, if leap { 29 } else { 28 }, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    let mut m = 0usize;
    for &md in &months_days {
        if remaining < md { break; }
        remaining -= md;
        m += 1;
    }
    format!("{:04}-{:02}-{:02} {:02}:{:02}:{:02}", y, m + 1, remaining + 1, hours, minutes, seconds)
}

fn append_log(profile_id: &str, filename: &str, message: &str) {
    if let Ok(dir) = log_dir_for(profile_id) {
        let path = dir.join(filename);
        if let Ok(mut file) = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)
        {
            let _ = writeln!(file, "[{}] {}", timestamp(), message);
        }
    }
}

fn log_query(profile_id: &str, query: &str) {
    append_log(profile_id, "mysql.log.txt", &format!("QUERY: {}", query));
}

fn log_query_result(profile_id: &str, query: &str, count: usize) {
    append_log(profile_id, "mysql.log.txt", &format!("QUERY: {} → {} rows", query, count));
}

fn log_info(profile_id: &str, message: &str) {
    append_log(profile_id, "mysql.log.txt", &format!("INFO: {}", message));
}

fn log_error(profile_id: &str, message: &str) {
    append_log(profile_id, "error.log.txt", &format!("ERROR: {}", message));
    // Also log errors to mysql.log for full timeline
    append_log(profile_id, "mysql.log.txt", &format!("ERROR: {}", message));
}

// ─── Log Reading Commands ───────────────────────────────────────────

#[tauri::command]
fn read_profile_log(profile_id: String, log_type: String) -> Result<String, String> {
    let filename = match log_type.as_str() {
        "query" | "mysql" => "mysql.log.txt",
        "error" => "error.log.txt",
        _ => return Err("Unknown log type. Use 'mysql' or 'error'.".to_string()),
    };
    let dir = log_dir_for(&profile_id)?;
    let path = dir.join(filename);
    if !path.exists() {
        return Ok(String::new());
    }
    fs::read_to_string(&path).map_err(|e| format!("Read error: {}", e))
}

#[tauri::command]
fn clear_profile_log(profile_id: String, log_type: String) -> Result<(), String> {
    let filename = match log_type.as_str() {
        "query" | "mysql" => "mysql.log.txt",
        "error" => "error.log.txt",
        "all" => {
            let dir = log_dir_for(&profile_id)?;
            for f in &["mysql.log.txt", "error.log.txt"] {
                let p = dir.join(f);
                if p.exists() {
                    let _ = fs::remove_file(&p);
                }
            }
            return Ok(());
        }
        _ => return Err("Unknown log type. Use 'mysql', 'error', or 'all'.".to_string()),
    };
    let dir = log_dir_for(&profile_id)?;
    let path = dir.join(filename);
    if path.exists() {
        fs::remove_file(&path).map_err(|e| format!("Delete error: {}", e))?;
    }
    Ok(())
}

// ─── Generic File Storage Commands ──────────────────────────────────

#[tauri::command]
fn app_read_file(filename: String) -> Result<String, String> {
    let base = app_data_dir()?;
    let path = base.join("data").join(&filename);
    if !path.exists() {
        return Ok(String::new());
    }
    fs::read_to_string(&path).map_err(|e| format!("Read error: {}", e))
}

#[tauri::command]
fn app_write_file(filename: String, contents: String) -> Result<(), String> {
    let base = ensure_app_dirs()?;
    let path = base.join("data").join(&filename);
    fs::write(&path, contents).map_err(|e| format!("Write error: {}", e))
}

#[tauri::command]
fn app_delete_file(filename: String) -> Result<(), String> {
    let base = app_data_dir()?;
    let path = base.join("data").join(&filename);
    if path.exists() {
        fs::remove_file(&path).map_err(|e| format!("Delete error: {}", e))?;
    }
    Ok(())
}

#[tauri::command]
fn app_get_data_dir() -> Result<String, String> {
    let base = ensure_app_dirs()?;
    Ok(base.to_string_lossy().to_string())
}

// ─── DB Types ───────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ConnectParams {
    pub profile_id: String,
    pub host: String,
    pub port: u16,
    pub user: String,
    pub password: String,
    pub database: Option<String>,
    pub ssl: bool,
    pub ssl_ca_file: Option<String>,
    pub ssl_cert_file: Option<String>,
    pub ssl_key_file: Option<String>,
    #[serde(default)]
    pub ssl_reject_unauthorized: bool,
    #[serde(default)]
    pub db_type: String,
    // SSH Tunneling
    #[serde(default)]
    pub ssh: bool,
    pub ssh_host: Option<String>,
    pub ssh_port: Option<u16>,
    pub ssh_user: Option<String>,
    pub ssh_password: Option<String>,
    pub ssh_key_file: Option<String>,
    pub ssh_passphrase: Option<String>,
    #[serde(default)]
    pub ssh_strict_key_checking: bool,
    #[serde(default)]
    pub ssh_keep_alive_interval: u32,
    #[serde(default = "default_true")]
    pub ssh_compression: bool,
}

fn default_true() -> bool { true }

#[derive(Debug, Serialize, Clone)]
pub struct ColumnInfo {
    pub name: String,
    pub col_type: String,
    pub nullable: bool,
    pub key: String,
    pub default_val: Option<String>,
    pub extra: String,
}

// ─── SSH Known-Hosts (TOFU) ──────────────────────────────────────────

fn known_hosts_path() -> Result<PathBuf, String> {
    Ok(app_data_dir()?.join("known_hosts.json"))
}

fn load_known_hosts() -> HashMap<String, String> {
    known_hosts_path()
        .ok()
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save_known_hosts(hosts: &HashMap<String, String>) -> Result<(), String> {
    let path = known_hosts_path()?;
    let json = serde_json::to_string_pretty(hosts).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| e.to_string())
}

/// Trust-On-First-Use host key verification.
///
/// - First connection to a host: fingerprint is stored in `~/.workgrid-studio/known_hosts.json`
///   and the connection proceeds.
/// - Subsequent connections: stored fingerprint is compared against the live key.
///   If `strict` is true the function returns an error on mismatch (MITM protection).
///   If `strict` is false a warning is logged but the connection is allowed
///   (useful during development with self-signed or rotated keys).
fn verify_host_key_tofu(
    pid: &str,
    ssh_host: &str,
    ssh_port: u16,
    sess: &Session,
    strict: bool,
) -> Result<(), String> {
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
                Err(msg)
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
fn forget_host_key(profile_id: String, ssh_host: String, ssh_port: u16) -> Result<(), String> {
    let host_id = format!("[{}]:{}", ssh_host, ssh_port);
    let mut known = load_known_hosts();
    if known.remove(&host_id).is_some() {
        save_known_hosts(&known)?;
        log_info(&profile_id, &format!("Forgotten host key for {}", host_id));
    }
    Ok(())
}

fn establish_ssh_tunnel(pid: &str, params: &ConnectParams) -> Result<TunnelHandle, String> {
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
        return Err("No SSH authentication method provided".to_string());
    }

    if !sess.authenticated() {
        return Err("SSH authentication failed".to_string());
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
fn shutdown_tunnel(mut handle: TunnelHandle) {
    handle.shutdown.store(true, Ordering::Relaxed);
    // Unblock the blocking `listener.incoming()` call with a throwaway connection.
    let _ = TcpStream::connect(format!("127.0.0.1:{}", handle.local_port));
    // Wait up to 5 s for the forwarding loop to signal completion.
    match handle.done_rx.recv_timeout(std::time::Duration::from_secs(5)) {
        Ok(_) | Err(mpsc::RecvTimeoutError::Disconnected) => {}
        Err(mpsc::RecvTimeoutError::Timeout) => {
            #[cfg(debug_assertions)]
            eprintln!("[workgrid-studio] [debug] WARNING: SSH tunnel thread did not exit within 5 s — abandoning");
        }
    }
    if let Some(t) = handle.thread.take() {
        let _ = t.join();
    }
}

// ─── DB State ───────────────────────────────────────────────────────

pub struct DbState {
    pub pools: Mutex<HashMap<String, Pool>>,
    pub tunnels: Mutex<HashMap<String, TunnelHandle>>, // profile_id -> tunnel handle
}

impl DbState {
    pub fn new() -> Self {
        Self {
            pools: Mutex::new(HashMap::new()),
            tunnels: Mutex::new(HashMap::new()),
        }
    }
}

// ─── DB Commands ────────────────────────────────────────────────────

#[tauri::command]
async fn db_connect(
    state: State<'_, DbState>,
    params: ConnectParams,
) -> Result<String, String> {
    let mut params = params;
    let pid = params.profile_id.clone();
    let db_type = params.db_type.as_str();

    // Backend safety net: only mysql and mariadb are supported
    if !db_type.is_empty() && db_type != "mysql" && db_type != "mariadb" {
        let msg = format!(
            "Unsupported database type '{}'. Only MySQL and MariaDB are supported in this version.",
            db_type
        );
        log_error(&pid, &msg);
        return Err(msg);
    }

    // Encrypt password if not already encrypted
    if !params.password.starts_with("wkgrd:") && !params.password.is_empty() {
        params.password = encrypt_password(params.password.clone())?;
    }
    
    // Encrypt SSH password/passphrase if needed
    if params.ssh {
        if let Some(ssh_pass) = params.ssh_password.as_mut() {
            if !ssh_pass.starts_with("wkgrd:") && !ssh_pass.is_empty() {
                *ssh_pass = encrypt_password(ssh_pass.clone())?;
            }
        }
        if let Some(ssh_passphrase) = params.ssh_passphrase.as_mut() {
            if !ssh_passphrase.starts_with("wkgrd:") && !ssh_passphrase.is_empty() {
                *ssh_passphrase = encrypt_password(ssh_passphrase.clone())?;
            }
        }
    }

    // Decrypt passwords for the actual connection
    let mut conn_params = params.clone();
    conn_params.password = decrypt_password(params.password.clone())?;
    
    if params.ssh {
        if let Some(ssh_pass) = conn_params.ssh_password.as_mut() {
            *ssh_pass = decrypt_password(ssh_pass.clone())?;
        }
        if let Some(ssh_passphrase) = conn_params.ssh_passphrase.as_mut() {
            *ssh_passphrase = decrypt_password(ssh_passphrase.clone())?;
        }
        
        // Establish SSH Tunnel
        {
            // Kill any pre-existing tunnel for this profile (reconnect scenario).
            // Remove from the map first so the lock is released before joining the thread.
            let old_tunnel = {
                let mut tunnels = state.tunnels.lock().map_err(|e| e.to_string())?;
                tunnels.remove(&pid)
            };
            if let Some(old) = old_tunnel {
                shutdown_tunnel(old);
            }
            // Debug telemetry: log active tunnel count after cleanup.
            #[cfg(debug_assertions)]
            if let Ok(tunnels) = state.tunnels.lock() {
                eprintln!("[workgrid-studio] [debug] active SSH tunnel count after reconnect cleanup: {}", tunnels.len());
            }
        }
        let handle = establish_ssh_tunnel(&pid, &conn_params)?;
        log_info(&pid, &format!("SSH Tunnel established: localhost:{}", handle.local_port));
        
        // Redirect connection to local port
        conn_params.host = "127.0.0.1".to_string();
        conn_params.port = handle.local_port;
        
        let mut tunnels = state.tunnels.lock().map_err(|e| e.to_string())?;
        tunnels.insert(pid.clone(), handle);
    }

    let target = format!("{}@{}:{}", params.user, params.host, params.port);
    log_info(&pid, &format!("Connecting to {} ({}) ...", target, if db_type.is_empty() { "mysql" } else { db_type }));

    let mut builder = OptsBuilder::default()
        .ip_or_hostname(conn_params.host.clone())
        .tcp_port(conn_params.port)
        .user(Some(conn_params.user.clone()))
        .pass(Some(conn_params.password.clone()));

    if let Some(ref db) = conn_params.database {
        if !db.is_empty() {
            builder = builder.db_name(Some(db.clone()));
        }
    }

    if params.ssl {
        let mut ssl_opts = mysql_async::SslOpts::default();
        
        if !params.ssl_reject_unauthorized {
            ssl_opts = ssl_opts.with_danger_accept_invalid_certs(true);
        }

        if let Some(ca) = params.ssl_ca_file {
            if !ca.is_empty() {
                let path = std::path::PathBuf::from(&ca);
                if !path.exists() {
                    let msg = format!("CA Certificate file does not exist at path: {}", ca);
                    log_error(&pid, &msg);
                    return Err(msg);
                }
                ssl_opts = ssl_opts.with_root_certs(vec![path.into()]);
            }
        }

        let mut has_cert = false;
        let mut has_key = false;
        let mut cert_path = std::path::PathBuf::new();
        let mut key_path = std::path::PathBuf::new();

        if let Some(cert) = params.ssl_cert_file {
            if !cert.is_empty() {
                cert_path = std::path::PathBuf::from(&cert);
                if !cert_path.exists() {
                    let msg = format!("Client Certificate file does not exist at path: {}", cert);
                    log_error(&pid, &msg);
                    return Err(msg);
                }
                has_cert = true;
            }
        }

        if let Some(key) = params.ssl_key_file {
            if !key.is_empty() {
                key_path = std::path::PathBuf::from(&key);
                if !key_path.exists() {
                    let msg = format!("Client Key file does not exist at path: {}", key);
                    log_error(&pid, &msg);
                    return Err(msg);
                }
                has_key = true;
            }
        }

        if has_cert && has_key {
            let identity = mysql_async::ClientIdentity::new(cert_path.into(), key_path.into());
            ssl_opts = ssl_opts.with_client_identity(Some(identity));
        } else if has_cert || has_key {
            let msg = "Both Client Certificate and Client Key must be provided for mutual TLS.".to_string();
            log_error(&pid, &msg);
            return Err(msg);
        }

        builder = builder.ssl_opts(Some(ssl_opts));
    }

    let pool_opts = PoolOpts::new()
        .with_constraints(PoolConstraints::new(0, 5).unwrap());
    builder = builder.pool_opts(Some(pool_opts));

    let opts: Opts = builder.into();
    let pool = Pool::new(opts);

    match pool.get_conn().await {
        Ok(conn) => {
            drop(conn);
            log_info(&pid, &format!("Connected to {}", target));
        }
        Err(e) => {
            let msg = format!("Connection failed to {}: {}", target, e);
            log_error(&pid, &msg);
            return Err(msg);
        }
    }

    let mut pools = state.pools.lock().map_err(|e| {
        let msg = format!("Lock error: {}", e);
        log_error(&pid, &msg);
        msg
    })?;

    if let Some(old_pool) = pools.remove(&pid) {
        let _ = old_pool.disconnect();
    }
    pools.insert(pid.clone(), pool);

    Ok(format!("Connected to {}", target))
}

#[tauri::command]
async fn db_disconnect(
    state: State<'_, DbState>,
    profile_id: String,
) -> Result<String, String> {
    log_info(&profile_id, "Disconnecting...");

    // Remove the pool while holding the lock, then drop the lock before awaiting disconnect.
    // Holding a std::sync::Mutex guard across an .await point would block the thread.
    let pool = {
        let mut pools = state.pools.lock().map_err(|e| {
            let msg = format!("Lock error: {}", e);
            log_error(&profile_id, &msg);
            msg
        })?;
        pools.remove(&profile_id)
    }; // lock released here

    if let Some(pool) = pool {
        let _ = pool.disconnect().await;
    }

    // Remove the tunnel handle while holding the lock, then release the lock
    // before joining the thread to avoid holding the mutex during the join.
    let tunnel = {
        let mut tunnels = state.tunnels.lock().map_err(|e| e.to_string())?;
        tunnels.remove(&profile_id)
    };
    if let Some(handle) = tunnel {
        shutdown_tunnel(handle);
    }
    // Debug telemetry: log active tunnel count after disconnect.
    #[cfg(debug_assertions)]
    if let Ok(tunnels) = state.tunnels.lock() {
        eprintln!("[workgrid-studio] [debug] active SSH tunnel count after disconnect: {}", tunnels.len());
    }

    log_info(&profile_id, "Disconnected");
    Ok("Disconnected".to_string())
}

#[tauri::command]
async fn db_ping(
    state: State<'_, DbState>,
    profile_id: String,
) -> Result<u128, String> {
    let pool = get_pool(&state, &profile_id)?;
    let start = std::time::Instant::now();

    let mut conn = pool.get_conn().await.map_err(|e| {
        let msg = format!("Ping connection error: {}", e);
        // Don't log as error strictly for pings to avoid spamming the error console
        // log_error(&profile_id, &msg); 
        msg
    })?;

    match conn.query::<u8, _>("SELECT 1").await {
        Ok(_) => {
            drop(conn);
            let elapsed = start.elapsed().as_millis();
            Ok(elapsed)
        }
        Err(e) => {
            let msg = format!("Ping query error: {}", e);
            Err(msg)
        }
    }
}

#[tauri::command]
async fn db_list_databases(
    state: State<'_, DbState>,
    profile_id: String,
) -> Result<Vec<String>, String> {
    let pool = get_pool(&state, &profile_id)?;
    let query = "SHOW DATABASES";

    let mut conn = pool.get_conn().await.map_err(|e| {
        let msg = format!("Connection error: {}", e);
        log_error(&profile_id, &msg);
        msg
    })?;

    match conn.query::<String, _>(query).await {
        Ok(databases) => {
            log_query_result(&profile_id, query, databases.len());
            drop(conn);
            Ok(databases)
        }
        Err(e) => {
            let msg = format!("Query error [{}]: {}", query, e);
            log_error(&profile_id, &msg);
            Err(msg)
        }
    }
}

#[tauri::command]
async fn db_list_tables(
    state: State<'_, DbState>,
    profile_id: String,
    database: String,
) -> Result<Vec<String>, String> {
    let pool = get_pool(&state, &profile_id)?;
    let query = format!("SHOW TABLES FROM `{}`", database);

    let mut conn = pool.get_conn().await.map_err(|e| {
        let msg = format!("Connection error: {}", e);
        log_error(&profile_id, &msg);
        msg
    })?;

    match conn.query::<String, _>(&query).await {
        Ok(tables) => {
            log_query_result(&profile_id, &query, tables.len());
            drop(conn);
            Ok(tables)
        }
        Err(e) => {
            let msg = format!("Query error [{}]: {}", query, e);
            log_error(&profile_id, &msg);
            Err(msg)
        }
    }
}

#[tauri::command]
async fn db_list_columns(
    state: State<'_, DbState>,
    profile_id: String,
    database: String,
    table: String,
) -> Result<Vec<ColumnInfo>, String> {
    let pool = get_pool(&state, &profile_id)?;
    let query = format!("SHOW COLUMNS FROM `{}`.`{}`", database, table);

    let mut conn = pool.get_conn().await.map_err(|e| {
        let msg = format!("Connection error: {}", e);
        log_error(&profile_id, &msg);
        msg
    })?;

    match conn.query::<(String, String, String, String, Option<String>, String), _>(&query).await {
        Ok(rows) => {
            log_query_result(&profile_id, &query, rows.len());
            let columns: Vec<ColumnInfo> = rows
                .into_iter()
                .map(|(field, col_type, null, key, default, extra)| ColumnInfo {
                    name: field,
                    col_type,
                    nullable: null == "YES",
                    key,
                    default_val: default,
                    extra,
                })
                .collect();
            drop(conn);
            Ok(columns)
        }
        Err(e) => {
            let msg = format!("Query error [{}]: {}", query, e);
            log_error(&profile_id, &msg);
            Err(msg)
        }
    }
}

// ─── Helpers ────────────────────────────────────────────────────────

fn get_pool(state: &State<'_, DbState>, profile_id: &str) -> Result<Pool, String> {
    let pools = state.pools.lock().map_err(|e| format!("Lock error: {}", e))?;
    pools
        .get(profile_id)
        .cloned()
        .ok_or_else(|| {
            let msg = "Not connected. Please connect first.".to_string();
            log_error(profile_id, &msg);
            msg
        })
}

// ─── Database Info (HeidiSQL-style) ─────────────────────────────────

#[derive(Debug, Serialize, Clone)]
pub struct DatabaseInfo {
    pub name: String,
    pub size_bytes: i64,
    pub tables: i64,
    pub views: i64,
    pub default_collation: String,
    pub last_modified: Option<String>,
}

#[tauri::command]
async fn db_get_databases_info(
    state: State<'_, DbState>,
    profile_id: String,
) -> Result<Vec<DatabaseInfo>, String> {
    let pool = get_pool(&state, &profile_id)?;
    let query = r#"
        SELECT
            s.SCHEMA_NAME,
            COALESCE(SUM(t.DATA_LENGTH + t.INDEX_LENGTH), 0) AS size_bytes,
            COALESCE(SUM(CASE WHEN t.TABLE_TYPE = 'BASE TABLE' THEN 1 ELSE 0 END), 0) AS tables_count,
            COALESCE(SUM(CASE WHEN t.TABLE_TYPE = 'VIEW' THEN 1 ELSE 0 END), 0) AS views_count,
            s.DEFAULT_COLLATION_NAME,
            DATE_FORMAT(MAX(t.UPDATE_TIME), '%Y-%m-%d %H:%i:%s') AS last_modified
        FROM information_schema.SCHEMATA s
        LEFT JOIN information_schema.TABLES t ON t.TABLE_SCHEMA = s.SCHEMA_NAME
        GROUP BY s.SCHEMA_NAME, s.DEFAULT_COLLATION_NAME
        ORDER BY s.SCHEMA_NAME
    "#;

    let mut conn = pool.get_conn().await.map_err(|e| {
        let msg = format!("Connection error: {}", e);
        log_error(&profile_id, &msg);
        msg
    })?;

    match conn.query::<(String, i64, i64, i64, String, Option<String>), _>(query).await {
        Ok(rows) => {
            log_query_result(&profile_id, "SELECT databases info FROM information_schema", rows.len());
            let infos: Vec<DatabaseInfo> = rows
                .into_iter()
                .map(|(name, size_bytes, tables, views, collation, last_mod)| DatabaseInfo {
                    name,
                    size_bytes,
                    tables,
                    views,
                    default_collation: collation,
                    last_modified: last_mod,
                })
                .collect();
            drop(conn);
            Ok(infos)
        }
        Err(e) => {
            let msg = format!("Query error [databases info]: {}", e);
            Err(msg)
        }
    }
}

// ─── Table Info (HeidiSQL-style) ────────────────────────────────────

#[derive(Debug, Serialize, Clone)]
pub struct TableInfo {
    pub name: String,
    pub rows: Option<i64>,
    pub size_bytes: Option<i64>,
    pub created: Option<String>,
    pub updated: Option<String>,
    pub engine: Option<String>,
    pub comment: Option<String>,
    pub type_: String,
}

#[tauri::command]
async fn db_get_tables_info(
    state: State<'_, DbState>,
    profile_id: String,
    database: String,
) -> Result<Vec<TableInfo>, String> {
    let pool = get_pool(&state, &profile_id)?;
    let query = r#"
        SELECT
            TABLE_NAME,
            TABLE_ROWS,
            (DATA_LENGTH + INDEX_LENGTH) AS size_bytes,
            DATE_FORMAT(CREATE_TIME, '%Y-%m-%d %H:%i:%s') AS CREATE_TIME,
            DATE_FORMAT(UPDATE_TIME, '%Y-%m-%d %H:%i:%s') AS UPDATE_TIME,
            ENGINE,
            TABLE_COMMENT,
            TABLE_TYPE
        FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = :db
        ORDER BY TABLE_NAME
    "#;

    let mut conn = pool.get_conn().await.map_err(|e| {
        let msg = format!("Connection error: {}", e);
        log_error(&profile_id, &msg);
        msg
    })?;

    match conn.exec::<(String, Option<i64>, Option<i64>, Option<String>, Option<String>, Option<String>, Option<String>, String), _, _>(query, params! { "db" => database.clone() }).await {
        Ok(rows) => {
            log_query_result(&profile_id, &format!("SELECT tables info FROM information_schema for {}", database), rows.len());
            let infos: Vec<TableInfo> = rows
                .into_iter()
                .map(|(name, rows, size_bytes, created, updated, engine, comment, type_)| TableInfo {
                    name,
                    rows,
                    size_bytes,
                    created,
                    updated,
                    engine,
                    comment,
                    type_,
                })
                .collect();
            drop(conn);
            Ok(infos)
        }
        Err(e) => {
            let msg = format!("Query error [tables info]: {}", e);
            log_error(&profile_id, &msg);
            Err(msg)
        }
    }
}

// ─── App Entry ──────────────────────────────────────────────────────

#[derive(Debug, Serialize, Clone)]
pub struct VariableInfo {
    pub name: String,
    pub session_value: String,
    pub global_value: String,
    pub scope: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
pub struct StatusInfo {
    pub name: String,
    pub value: String,
}

#[derive(Debug, Serialize, Clone)]
pub struct ProcessInfo {
    pub id: u64,
    pub user: Option<String>,
    pub host: Option<String>,
    pub db: Option<String>,
    pub command: Option<String>,
    pub time: Option<i64>,
    pub state: Option<String>,
    pub info: Option<String>,
}

#[tauri::command]
async fn db_get_variables(
    state: State<'_, DbState>,
    profile_id: String,
) -> Result<Vec<VariableInfo>, String> {
    let pool = get_pool(&state, &profile_id)?;

    let mut conn = pool.get_conn().await.map_err(|e| {
        let msg = format!("Connection error: {}", e);
        log_error(&profile_id, &msg);
        msg
    })?;

    // Try to get scopes from performance_schema
    let mut scope_map = std::collections::HashMap::new();
    if let Ok(scopes) = conn.query::<(String, String), _>("SELECT VARIABLE_NAME, VARIABLE_SCOPE FROM performance_schema.variables_info").await {
        for (name, scope) in scopes {
            scope_map.insert(name.to_lowercase(), scope.to_uppercase());
        }
    }

    // Fetch session variables
    let session_rows: Vec<(String, String)> = conn
        .query("SHOW SESSION VARIABLES")
        .await
        .map_err(|e| e.to_string())?;

    // Fetch global variables
    let global_rows: Vec<(String, String)> = conn
        .query("SHOW GLOBAL VARIABLES")
        .await
        .map_err(|e| e.to_string())?;

    let mut map: std::collections::BTreeMap<String, (String, String)> = std::collections::BTreeMap::new();

    for (name, value) in session_rows {
        map.entry(name).or_insert((String::new(), String::new())).0 = value;
    }

    for (name, value) in global_rows {
        map.entry(name).or_insert((String::new(), String::new())).1 = value;
    }

    let variables: Vec<VariableInfo> = map
        .into_iter()
        .map(|(name, (session_value, global_value))| {
            let scope = scope_map.get(&name.to_lowercase()).cloned();
            VariableInfo {
                name,
                session_value,
                global_value,
                scope,
            }
        })
        .collect();

    Ok(variables)
}

#[tauri::command]
async fn db_set_variable(
    state: State<'_, DbState>,
    profile_id: String,
    scope: String,
    name: String,
    value: String,
) -> Result<(), String> {
    let pool = get_pool(&state, &profile_id)?;
    let mut conn = pool.get_conn().await.map_err(|e| {
        let msg = format!("Connection error: {}", e);
        log_error(&profile_id, &msg);
        msg
    })?;

    let scope_str = if scope.eq_ignore_ascii_case("GLOBAL") {
        "GLOBAL"
    } else {
        "SESSION"
    };

    if !name.chars().all(|c| c.is_alphanumeric() || c == '_') {
        let msg = format!("Invalid variable name: {}", name);
        log_error(&profile_id, &msg);
        return Err(msg);
    }

    // Escape backslashes and single quotes manually
    let query = format!("SET {} {} = ?", scope_str, name);

    conn.exec_drop(&query, (value,)).await.map_err(|e| {
        let msg = format!("Failed to set variable {}: {}", name, e);
        log_error(&profile_id, &msg);
        msg
    })?;

    log_query_result(&profile_id, &query, 0);

    Ok(())
}

#[tauri::command]
async fn db_get_status(
    state: State<'_, DbState>,
    profile_id: String,
) -> Result<Vec<StatusInfo>, String> {
    let pool = get_pool(&state, &profile_id)?;
    let mut conn = pool.get_conn().await.map_err(|e| {
        let msg = format!("Connection error: {}", e);
        log_error(&profile_id, &msg);
        msg
    })?;

    // Fetch global status
    let rows: Vec<(String, String)> = conn
        .query("SHOW GLOBAL STATUS")
        .await
        .map_err(|e| e.to_string())?;

    let status_infos: Vec<StatusInfo> = rows
        .into_iter()
        .map(|(name, value)| StatusInfo { name, value })
        .collect();

    Ok(status_infos)
}

#[tauri::command]
async fn db_get_processes(
    state: State<'_, DbState>,
    profile_id: String,
) -> Result<Vec<ProcessInfo>, String> {
    let pool = get_pool(&state, &profile_id)?;
    let mut conn = pool.get_conn().await.map_err(|e| {
        let msg = format!("Connection error: {}", e);
        log_error(&profile_id, &msg);
        msg
    })?;

    let query = "SELECT ID, USER, HOST, DB, COMMAND, TIME, STATE, INFO FROM information_schema.PROCESSLIST ORDER BY TIME DESC";
    let rows: Vec<(u64, Option<String>, Option<String>, Option<String>, Option<String>, Option<i64>, Option<String>, Option<String>)> = conn
        .query(query)
        .await
        .map_err(|e| e.to_string())?;

    let infos: Vec<ProcessInfo> = rows
        .into_iter()
        .map(|(id, user, host, db, command, time, state, info)| ProcessInfo {
            id, user, host, db, command, time, state, info
        })
        .collect();

    Ok(infos)
}

#[tauri::command]
async fn db_kill_process(
    state: State<'_, DbState>,
    profile_id: String,
    process_id: u64,
) -> Result<(), String> {
    let pool = get_pool(&state, &profile_id)?;
    let mut conn = pool.get_conn().await.map_err(|e| {
        let msg = format!("Connection error: {}", e);
        log_error(&profile_id, &msg);
        msg
    })?;

    let query = format!("KILL {}", process_id);
    conn.query_drop(&query).await.map_err(|e| {
        let msg = format!("Failed to kill process {}: {}", process_id, e);
        log_error(&profile_id, &msg);
        msg
    })?;

    Ok(())
}

#[tauri::command]
async fn db_execute_query(
    state: State<'_, DbState>,
    profile_id: String,
    query: String,
) -> Result<(), String> {
    let pool = get_pool(&state, &profile_id)?;
    let mut conn = pool.get_conn().await.map_err(|e| {
        let msg = format!("Connection error: {}", e);
        log_error(&profile_id, &msg);
        msg
    })?;

    conn.query_drop(&query).await.map_err(|e| {
        let msg = format!("Query error [{}]: {}", query, e);
        log_error(&profile_id, &msg);
        msg
    })?;

    log_query(&profile_id, &query);

    Ok(())
}

#[derive(Debug, Serialize, Clone)]
pub struct CollationResponse {
    pub collations: Vec<String>,
    pub default_collation: String,
}

#[tauri::command]
async fn db_get_collations(
    state: State<'_, DbState>,
    profile_id: String,
) -> Result<CollationResponse, String> {
    let pool = get_pool(&state, &profile_id)?;
    let mut conn = pool.get_conn().await.map_err(|e| {
        let msg = format!("Connection error: {}", e);
        log_error(&profile_id, &msg);
        msg
    })?;

    let mut collations = Vec::new();
    if let Ok(rows) = conn.query::<mysql_async::Row, _>("SHOW COLLATION").await {
        for row in rows {
            if let Some(col) = row.get::<String, usize>(0) {
                collations.push(col);
            }
        }
    }
    
    let mut default_collation = String::from("utf8mb4_general_ci");
    if let Ok(mut rows) = conn.query::<mysql_async::Row, _>("SHOW CHARACTER SET WHERE Charset = 'utf8mb4'").await {
        if let Some(row) = rows.pop() {
            if let Some(col) = row.get::<String, usize>(2) {
                default_collation = col;
            }
        }
    }

    Ok(CollationResponse {
        collations,
        default_collation,
    })
}

#[derive(Debug, Serialize, Clone)]
pub struct QueryResultSet {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<serde_json::Value>>,
    pub affected_rows: u64,
    pub info: String,
}

#[tauri::command]
async fn db_query(
    state: State<'_, DbState>,
    profile_id: String,
    query: String,
) -> Result<Vec<QueryResultSet>, String> {
    let pool = get_pool(&state, &profile_id)?;
    let mut conn = pool.get_conn().await.map_err(|e| {
        let msg = format!("Connection error: {}", e);
        log_error(&profile_id, &msg);
        msg
    })?;

    // Split by semicolons while respecting quotes, backticks
    let statements = split_sql_statements(&query);

    let mut results = Vec::new();

    for stmt in &statements {
        log_query(&profile_id, stmt);

        // Try as a query that returns rows
        match conn.query::<mysql_async::Row, _>(stmt.as_str()).await {
            Ok(rows) => {
                if rows.is_empty() {
                    let affected = conn.affected_rows();
                    // Might be DDL/DML — report affected rows
                    results.push(QueryResultSet {
                        columns: vec![],
                        rows: vec![],
                        affected_rows: affected,
                        info: format!("{} row(s) affected", affected),
                    });
                } else {
                    // Extract column names from first row
                    let columns: Vec<String> = rows[0]
                        .columns_ref()
                        .iter()
                        .map(|c| c.name_str().to_string())
                        .collect();

                    let mut result_rows = Vec::new();
                    for row in &rows {
                        let mut vals = Vec::new();
                        for i in 0..columns.len() {
                            // Access raw mysql_async::Value to avoid panics on NULL
                            let raw: &mysql_async::Value = &row[i];
                            let val: serde_json::Value = match raw {
                                mysql_async::Value::NULL => serde_json::Value::Null,
                                mysql_async::Value::Bytes(b) => {
                                    // Try to interpret as UTF-8 string
                                    match String::from_utf8(b.clone()) {
                                        Ok(s) => serde_json::Value::String(s),
                                        Err(_) => serde_json::Value::String(
                                            format!("[binary {} bytes]", b.len())
                                        ),
                                    }
                                }
                                mysql_async::Value::Int(n) => {
                                    serde_json::Value::Number(serde_json::Number::from(*n))
                                }
                                mysql_async::Value::UInt(n) => {
                                    serde_json::Value::Number(serde_json::Number::from(*n))
                                }
                                mysql_async::Value::Float(f) => {
                                    match serde_json::Number::from_f64(*f as f64) {
                                        Some(n) => serde_json::Value::Number(n),
                                        None => serde_json::Value::String(f.to_string()),
                                    }
                                }
                                mysql_async::Value::Double(f) => {
                                    match serde_json::Number::from_f64(*f) {
                                        Some(n) => serde_json::Value::Number(n),
                                        None => serde_json::Value::String(f.to_string()),
                                    }
                                }
                                mysql_async::Value::Date(y, m, d, h, mi, s, _us) => {
                                    serde_json::Value::String(
                                        format!("{:04}-{:02}-{:02} {:02}:{:02}:{:02}", y, m, d, h, mi, s)
                                    )
                                }
                                mysql_async::Value::Time(neg, d, h, mi, s, _us) => {
                                    let sign = if *neg { "-" } else { "" };
                                    let total_hours = (*d as u32) * 24 + (*h as u32);
                                    serde_json::Value::String(
                                        format!("{}{:02}:{:02}:{:02}", sign, total_hours, mi, s)
                                    )
                                }
                            };
                            vals.push(val);
                        }
                        result_rows.push(vals);
                    }

                    let count = result_rows.len();
                    log_query_result(&profile_id, stmt, count);

                    results.push(QueryResultSet {
                        columns,
                        rows: result_rows,
                        affected_rows: count as u64,
                        info: format!("{} row(s) returned", count),
                    });
                }
            }
            Err(e) => {
                let msg = format!("Query error [{}]: {}", stmt, e);
                log_error(&profile_id, &msg);
                return Err(msg);
            }
        }
    }

    Ok(results)
}

// ─── Schema DDL for AI context ───────────────────────────────────────

#[tauri::command]
async fn db_get_schema_ddl(
    state: State<'_, DbState>,
    profile_id: String,
    database: String,
) -> Result<String, String> {
    let pool = get_pool(&state, &profile_id)?;
    let mut conn = pool.get_conn().await
        .map_err(|e| format!("Connection error: {}", e))?;

    // Switch to the target database
    conn.query_drop(format!("USE `{}`", database)).await
        .map_err(|e| format!("USE error: {}", e))?;

    let mut ddl_parts: Vec<String> = Vec::new();
    ddl_parts.push(format!("-- Schema DDL for database `{}`", database));

    // 1. Tables
    let tables: Vec<String> = conn.query("SHOW TABLES").await.unwrap_or_default();
    for table in &tables {
        let result: Option<(String, String)> = conn
            .query_first(format!("SHOW CREATE TABLE `{}`", table))
            .await
            .unwrap_or(None);
        if let Some((_, create_sql)) = result {
            ddl_parts.push(format!("{};", create_sql));
        }
    }

    // 2. Views (SHOW FULL TABLES WHERE Table_type = 'VIEW')
    let view_rows: Vec<(String, String)> = conn
        .query("SHOW FULL TABLES WHERE Table_type = 'VIEW'")
        .await
        .unwrap_or_default();
    for (view_name, _) in &view_rows {
        let result: Option<(String, String, String, String)> = conn
            .query_first(format!("SHOW CREATE VIEW `{}`", view_name))
            .await
            .unwrap_or(None);
        if let Some((_, create_sql, _, _)) = result {
            ddl_parts.push(format!("{};", create_sql));
        }
    }

    // 3. Procedures
    let proc_rows: Vec<(String, String)> = conn
        .query(format!("SELECT ROUTINE_NAME, ROUTINE_TYPE FROM INFORMATION_SCHEMA.ROUTINES WHERE ROUTINE_SCHEMA = '{}' AND ROUTINE_TYPE = 'PROCEDURE'", database))
        .await
        .unwrap_or_default();
    for (proc_name, _) in &proc_rows {
        let result: Option<(String, String, String, String, String, String)> = conn
            .query_first(format!("SHOW CREATE PROCEDURE `{}`", proc_name))
            .await
            .unwrap_or(None);
        if let Some((_, _, _, create_sql, _, _)) = result {
            ddl_parts.push(format!("{};", create_sql));
        }
    }

    // 4. Functions
    let func_rows: Vec<(String, String)> = conn
        .query(format!("SELECT ROUTINE_NAME, ROUTINE_TYPE FROM INFORMATION_SCHEMA.ROUTINES WHERE ROUTINE_SCHEMA = '{}' AND ROUTINE_TYPE = 'FUNCTION'", database))
        .await
        .unwrap_or_default();
    for (func_name, _) in &func_rows {
        let result: Option<(String, String, String, String, String, String)> = conn
            .query_first(format!("SHOW CREATE FUNCTION `{}`", func_name))
            .await
            .unwrap_or(None);
        if let Some((_, _, _, create_sql, _, _)) = result {
            ddl_parts.push(format!("{};", create_sql));
        }
    }

    Ok(ddl_parts.join("\n\n"))
}

// ─── Vault (Secure Storage) ─────────────────────────────────────────

// Vault uses the same randomly-generated per-installation key as encrypt_password /
// decrypt_password (get_or_create_secret_key). The old username-derived key
// (get_vault_key) has been removed because it was trivially reversible by anyone
// with access to the vault file. Existing vault entries encrypted with the old key
// will fail to decrypt (the caller receives an error) and the user will need to
// re-enter their secrets once after upgrading.

#[tauri::command]
fn vault_set(key: String, secret: String) -> Result<(), String> {
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
fn vault_get(key: String) -> Result<String, String> {
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
fn vault_delete(key: String) -> Result<(), String> {
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

// ─── AI Generation ──────────────────────────────────────────────────

#[derive(Serialize)]
struct AnthropicMessage {
    role: String,
    content: String,
}

#[derive(Serialize)]
struct OpenAIPayload {
    model: String,
    messages: Vec<AnthropicMessage>,
}

#[derive(Deserialize)]
struct OpenAIChoice {
    message: OpenAIResponseMsg,
}

#[derive(Deserialize)]
struct OpenAIResponseMsg {
    content: String,
}

#[derive(Deserialize)]
struct OpenAIResponse {
    choices: Vec<OpenAIChoice>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct AiLogEntry {
    pub id: String,
    pub timestamp: String,
    pub model: String,
    pub uri: String,
    pub payload_preview: String,
    pub response_preview: String,
}

fn append_ai_log(entry: AiLogEntry) {
    if let Ok(base) = ensure_app_dirs() {
        let path = base.join("ai_logs.json");
        let mut logs: Vec<AiLogEntry> = if path.exists() {
            let content = fs::read_to_string(&path).unwrap_or_else(|_| "[]".to_string());
            serde_json::from_str(&content).unwrap_or_default()
        } else {
            Vec::new()
        };
        logs.push(entry);
        
        // Keep only last 100 logs to prevent unbounded growth
        if logs.len() > 100 {
            logs.remove(0);
        }
        
        if let Ok(serialized) = serde_json::to_string(&logs) {
            let _ = fs::write(path, serialized);
        }
    }
}

#[tauri::command]
fn get_ai_logs() -> Result<Vec<AiLogEntry>, String> {
    let base = ensure_app_dirs()?;
    let path = base.join("ai_logs.json");
    if !path.exists() {
         return Ok(Vec::new());
    }
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let mut logs: Vec<AiLogEntry> = serde_json::from_str(&content).map_err(|e| e.to_string())?;
    logs.reverse(); // Newest first
    Ok(logs)
}

#[tauri::command]
fn clear_ai_logs() -> Result<(), String> {
    let base = ensure_app_dirs()?;
    let path = base.join("ai_logs.json");
    if path.exists() {
        fs::remove_file(path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn ai_generate_query(
    provider_type: String, // "openai", "gemini", "deepseek", "other"
    base_url: Option<String>,
    api_key_ref: String,
    model_id: String,
    prompt: String,
    schema_context: String,
    current_query: Option<String>,
) -> Result<String, String> {
    let api_key = vault_get(api_key_ref)?;
    let client = Client::new();
    
    let system_prompt = format!(
        "You are an expert MySQL/MariaDB SQL assistant for Workgrid Studio. \
        Below is the complete DDL (CREATE TABLE, CREATE VIEW, CREATE PROCEDURE, CREATE FUNCTION) \
        for the user's database:\n\n{}\n\n\
        Use this schema to understand indexes, constraints, relationships, and stored routines. \
        Generate the most optimized SQL query for the user's request. \
        If there are multiple approaches with different performance trade-offs, \
        output them as separate queries separated by a comment like -- Alternative: ... \
        Output ONLY raw SQL. Do not wrap it in markdown codeblocks (```sql ... ```). \
        Do not add explanations outside of SQL comments.",
        schema_context
    );
    
    let mut final_system_prompt = system_prompt.clone();
    if let Some(q) = current_query {
        if !q.trim().is_empty() {
            final_system_prompt.push_str(&format!("\n\nThe user's current SQL editor content is:\n```sql\n{}\n```\nUse this context if the user is asking to fix, modify, or extend their existing query.", q));
        }
    }
    
    let user_prompt = prompt;

    match provider_type.as_str() {
        "openai" | "deepseek" | "other" => {
            let url = base_url.unwrap_or_else(|| {
                if provider_type == "deepseek" {
                    "https://api.deepseek.com/chat/completions".to_string()
                } else {
                    "https://api.openai.com/v1/chat/completions".to_string()
                }
            });
            
            let default_model = if provider_type == "deepseek" { "deepseek-chat" } else { "gpt-4o" };
            let actual_model = if model_id.is_empty() { default_model.to_string() } else { model_id };
            
            let payload = OpenAIPayload {
                model: actual_model.clone(),
                messages: vec![
                    AnthropicMessage { role: "system".to_string(), content: final_system_prompt },
                    AnthropicMessage { role: "user".to_string(), content: user_prompt },
                ],
            };
            
            println!("Sending {} completion request to {} (model: {})", provider_type, url, actual_model);
            
            let payload_json = serde_json::to_string(&payload).unwrap_or_default();
            
            let res = client.post(&url)
                .bearer_auth(api_key)
                .json(&payload)
                .send()
                .await;
                
            let timestamp = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
            let entry_id = uuid::Uuid::new_v4().to_string();
            
            match res {
                Ok(response) => {
                    let status = response.status();
                    if !status.is_success() {
                        let text = response.text().await.unwrap_or_default();
                        println!("AI Request Error ({}): {}", status, text);
                        
                        append_ai_log(AiLogEntry {
                            id: entry_id,
                            timestamp,
                            model: actual_model.clone(),
                            uri: url.clone(),
                            payload_preview: payload_json,
                            response_preview: format!("HTTP {} - {}", status, text),
                        });
                        
                        return Err(format!("API Error ({}): {}", status, text));
                    }
                    
                    let raw_text = response.text().await.unwrap_or_default();
                    let parsed: OpenAIResponse = serde_json::from_str(&raw_text)
                        .map_err(|e| format!("Failed to parse response: {}\nRaw: {}", e, raw_text))?;
                        
                    append_ai_log(AiLogEntry {
                        id: entry_id,
                        timestamp,
                        model: actual_model,
                        uri: url,
                        payload_preview: payload_json,
                        response_preview: raw_text,
                    });
                        
                    if let Some(choice) = parsed.choices.first() {
                        let content = choice.message.content.trim().to_string();
                        // Strip markdown codeblocks if AI disobeyed
                let cleaned = content
                    .strip_prefix("```sql").unwrap_or(&content)
                    .strip_prefix("```").unwrap_or(&content)
                    .strip_suffix("```").unwrap_or(&content)
                    .trim()
                    .to_string();
                Ok(cleaned)
            } else {
                Err("No choices returned from AI provider".to_string())
            }
                },
                Err(e) => {
                    append_ai_log(AiLogEntry {
                        id: entry_id,
                        timestamp,
                        model: actual_model,
                        uri: url,
                        payload_preview: payload_json,
                        response_preview: format!("Connection failed: {}", e),
                    });
                    Err(format!("HTTP request failed: {}", e))
                }
            }
        },
        "gemini" => {
            // Very simple Gemini impl via proxy or google generative AI SDK format
            // Here assuming proxy to openai-compatible gemini endpoint
            let url = base_url.unwrap_or_else(|| "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions".to_string());
            
            let payload = OpenAIPayload {
                model: if model_id.is_empty() { "gemini-2.5-flash".to_string() } else { model_id },
                messages: vec![
                    AnthropicMessage { role: "system".to_string(), content: final_system_prompt },
                    AnthropicMessage { role: "user".to_string(), content: user_prompt },
                ],
            };
            
            let res = client.post(&url)
                .bearer_auth(api_key)
                .json(&payload)
                .send()
                .await
                .map_err(|e| format!("HTTP request failed: {}", e))?;
                
            let status = res.status();
            if !status.is_success() {
                let text = res.text().await.unwrap_or_default();
                return Err(format!("API Error ({}): {}", status, text));
            }
            
            let parsed: OpenAIResponse = res.json()
                .await
                .map_err(|e| format!("Failed to parse response: {}", e))?;
                
            if let Some(choice) = parsed.choices.first() {
                let content = choice.message.content.trim().to_string();
                let cleaned = content
                    .strip_prefix("```sql").unwrap_or(&content)
                    .strip_prefix("```").unwrap_or(&content)
                    .strip_suffix("```").unwrap_or(&content)
                    .trim()
                    .to_string();
                Ok(cleaned)
            } else {
                Err("No choices returned from AI provider".to_string())
            }
        },
        _ => Err("Unsupported provider type".to_string())
    }
}

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
fn get_or_create_secret_key() -> Result<[u8; 32], String> {
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
fn get_or_create_key_from_file() -> Result<[u8; 32], String> {
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

#[tauri::command]
fn encrypt_password(password: String) -> Result<String, String> {
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
fn decrypt_password(encrypted: String) -> Result<String, String> {
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

fn split_sql_statements(sql: &str) -> Vec<String> {
    let mut stmts = Vec::new();
    let mut current = String::new();
    let mut in_str_single = false;
    let mut in_str_double = false;
    let mut in_backtick = false;
    let mut chars = sql.chars().peekable();

    while let Some(c) = chars.next() {
        if c == '\\' {
            current.push(c);
            if let Some(next) = chars.next() {
                current.push(next);
            }
            continue;
        }

        match c {
            '\'' if !in_str_double && !in_backtick => in_str_single = !in_str_single,
            '"' if !in_str_single && !in_backtick => in_str_double = !in_str_double,
            '`' if !in_str_single && !in_str_double => in_backtick = !in_backtick,
            ';' if !in_str_single && !in_str_double && !in_backtick => {
                let stmt = current.trim().to_string();
                if !stmt.is_empty() {
                    stmts.push(stmt);
                }
                current.clear();
                continue;
            }
            _ => {}
        }
        current.push(c);
    }

    let stmt = current.trim().to_string();
    if !stmt.is_empty() {
        stmts.push(stmt);
    }

    stmts
}

#[tauri::command]
async fn db_import_sql(
    state: State<'_, DbState>,
    profile_id: String,
    database: String,
    file_path: String,
) -> Result<String, String> {
    let pool = get_pool(&state, &profile_id)?;
    let mut conn = pool.get_conn().await.map_err(|e| format!("Connection error: {}", e))?;

    // Switch to target DB if provided
    if !database.is_empty() {
        conn.query_drop(format!("USE `{}`", database.replace("`", "``")))
            .await
            .map_err(|e| format!("USE database error: {}", e))?;
    }

    let sql_content = std::fs::read_to_string(&file_path)
        .map_err(|e| format!("Failed to read SQL file: {}", e))?;

    // Borrow parse code from split_sql_statements to execute iteratively
    let stmts = split_sql_statements(&sql_content);
    let total = stmts.len();
    let mut executed = 0;

    for stmt in stmts {
        if let Err(e) = conn.query_drop(&stmt).await {
            log_error(&profile_id, &format!("SQL execution error at stmt {}: {}", executed + 1, e));
            return Err(format!("Execution failed at statement {}: {}", executed + 1, e));
        }
        executed += 1;
    }

    Ok(format!("Successfully imported {} statements.", total))
}

/// Structured result returned by `db_import_csv`.
#[derive(Serialize)]
pub struct ImportResult {
    /// Total rows parsed from the CSV file.
    pub rows_attempted: usize,
    /// Rows actually committed to the database (equals `rows_attempted` on success).
    pub rows_committed: usize,
}

#[tauri::command]
async fn db_import_csv(
    state: State<'_, DbState>,
    profile_id: String,
    database: String,
    table: String,
    file_path: String,
) -> Result<ImportResult, String> {
    let pool = get_pool(&state, &profile_id)?;
    let mut conn = pool.get_conn().await.map_err(|e| format!("Connection error: {}", e))?;

    if !database.is_empty() {
        conn.query_drop(format!("USE `{}`", database.replace("`", "``")))
            .await
            .map_err(|e| format!("USE database error: {}", e))?;
    }

    let mut rdr = csv::ReaderBuilder::new()
        .from_path(&file_path)
        .map_err(|e| format!("Failed to read CSV file: {}", e))?;

    let headers = rdr.headers().map_err(|e| format!("Failed to read headers: {}", e))?.clone();
    let cols: Vec<String> = headers
        .iter()
        .map(|h| format!("`{}`", h.replace('`', "``")))
        .collect();
    let safe_table = format!("`{}`", table.replace('`', "``"));

    // Collect all records up-front so we can abort cleanly before opening a
    // transaction if the file itself is malformed.
    let records: Vec<csv::StringRecord> = rdr
        .records()
        .collect::<Result<_, _>>()
        .map_err(|e| format!("Failed to parse CSV: {}", e))?;

    let total_rows = records.len();

    // Wrap every insert in a single transaction so a mid-import failure leaves
    // the table in its original state (no partial imports committed).
    let mut tx = conn
        .start_transaction(TxOpts::default())
        .await
        .map_err(|e| format!("Failed to start transaction: {}", e))?;

    let placeholders = format!("({})", vec!["?"; cols.len()].join(", "));
    let base_query = format!(
        "INSERT INTO {} ({}) VALUES {}",
        safe_table,
        cols.join(", "),
        placeholders
    );
    let stmt = tx
        .prep(&base_query)
        .await
        .map_err(|e| format!("Prepare failed: {}", e))?;

    let batch_size = 500usize;
    for (chunk_start, chunk) in records.chunks(batch_size).enumerate() {
        let batch: Vec<Vec<mysql_async::Value>> = chunk
            .iter()
            .map(|record| {
                record
                    .iter()
                    .map(|v| {
                        if v.is_empty() {
                            mysql_async::Value::NULL
                        } else {
                            mysql_async::Value::Bytes(v.as_bytes().to_vec())
                        }
                    })
                    .collect()
            })
            .collect();

        tx.exec_batch(&stmt, batch).await.map_err(|e| {
            format!(
                "Batch insert failed at rows {}-{}: {}",
                chunk_start * batch_size + 1,
                chunk_start * batch_size + chunk.len(),
                e
            )
        })?;
        // tx is dropped automatically on error, which triggers ROLLBACK
    }

    tx.commit()
        .await
        .map_err(|e| format!("Failed to commit import transaction: {}", e))?;

    Ok(ImportResult {
        rows_attempted: total_rows,
        rows_committed: total_rows,
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let _ = ensure_app_dirs();

    tauri::Builder::default()
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_updater::Builder::default().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(DbState::new())
        .invoke_handler(tauri::generate_handler![
            app_read_file,
            app_write_file,
            app_delete_file,
            app_get_data_dir,
            read_profile_log,
            clear_profile_log,
            db_connect,
            db_disconnect,
            db_list_databases,
            db_list_tables,
            db_list_columns,
            db_get_databases_info,
            db_get_tables_info,
            db_get_variables,
            db_set_variable,
            db_get_status,
            db_get_processes,
            db_kill_process,
            db_execute_query,
            db_get_collations,
            db_query,
            vault_set,
            vault_get,
            vault_delete,
            ai_generate_query,
            get_ai_logs,
            clear_ai_logs,
            db_get_schema_ddl,
            encrypt_password,
            decrypt_password,
            db_ping,
            db_import_sql,
            db_import_csv,
            forget_host_key
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
