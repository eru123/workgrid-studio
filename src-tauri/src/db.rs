use crate::crypto::{decrypt_password, encrypt_password};
use crate::logging::{log_error, log_info, log_mysql_verbose, log_query, log_query_result, LogState};
use crate::ssh::{establish_ssh_tunnel, shutdown_tunnel};
use crate::{AppError, AppResult, DbState};
use mysql_async::prelude::*;
use mysql_async::{Opts, OptsBuilder, Pool, PoolConstraints, PoolOpts, TxOpts};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, State};

// ─── DB Types ───────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ConnectParams {
    pub profile_id: String,
    pub host: String,
    pub port: u16,
    pub user: String,
    pub password: String,
    pub database: Option<String>,
    pub file_path: Option<String>,
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
    // Docker container tunneling (requires SSH)
    #[serde(default)]
    pub use_docker: bool,
    pub docker_container: Option<String>,
    #[serde(default)]
    pub connection_verbose_logging: bool,
}

pub fn default_true() -> bool {
    true
}

#[derive(Debug, Serialize, Clone)]
pub struct ColumnInfo {
    pub name: String,
    pub col_type: String,
    pub nullable: bool,
    pub key: String,
    pub default_val: Option<String>,
    pub extra: String,
}

#[derive(Debug, Serialize, Clone)]
pub struct DatabaseInfo {
    pub name: String,
    pub size_bytes: i64,
    pub tables: i64,
    pub views: i64,
    pub default_collation: String,
    pub last_modified: Option<String>,
}

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

#[derive(Debug, Serialize, Clone)]
pub struct ForeignKeyInfo {
    pub constraint_name: String,
    pub column_name: String,
    pub referenced_table_name: String,
    pub referenced_column_name: String,
    pub update_rule: Option<String>,
    pub delete_rule: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
pub struct IndexInfo {
    pub name: String,
    pub column_name: Option<String>,
    pub seq_in_index: u64,
    pub non_unique: u64,
    pub index_type: String,
    pub nullable: Option<String>,
    pub comment: Option<String>,
    pub index_comment: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
pub struct TriggerInfo {
    pub name: String,
    pub table_name: String,
    pub timing: String,
    pub event: String,
    pub statement: String,
}

#[derive(Debug, Serialize, Clone)]
pub struct RoutineInfo {
    pub name: String,
    pub routine_type: String,
    pub data_type: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
pub struct ViewInfo {
    pub name: String,
    pub definition: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
pub struct EventInfo {
    pub name: String,
    pub status: Option<String>,
    pub schedule: Option<String>,
    pub event_definition: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
pub struct UserInfo {
    pub user: String,
    pub host: String,
    pub plugin: Option<String>,
    pub account_locked: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
pub struct CollationResponse {
    pub collations: Vec<String>,
    pub default_collation: String,
}

#[derive(Debug, Serialize, Clone)]
pub struct QueryResultSet {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<serde_json::Value>>,
    pub affected_rows: u64,
    pub info: String,
}

/// Structured result returned by import commands.
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    pub kind: String,
    pub items_attempted: usize,
    pub items_committed: usize,
    pub rows_attempted: usize,
    pub rows_committed: usize,
    pub rows_skipped: usize,
    pub elapsed_ms: u128,
    pub errors: Vec<String>,
    pub summary: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ImportProgressEvent {
    pub job_id: String,
    pub kind: String,
    pub phase: String,
    pub items_processed: usize,
    pub items_total: usize,
    pub rows_processed: usize,
    pub rows_total: usize,
    pub percent: f64,
    pub message: String,
}

const DEFAULT_QUERY_TIMEOUT_MS: u64 = 30_000;
const MIN_QUERY_TIMEOUT_MS: u64 = 5_000;
const MAX_QUERY_TIMEOUT_MS: u64 = 300_000;

fn emit_import_progress(app: &AppHandle, event: &ImportProgressEvent) {
    let _ = app.emit("import-progress", event);
}

// ─── Helpers ────────────────────────────────────────────────────────

pub fn get_pool(state: &State<'_, DbState>, profile_id: &str) -> AppResult<Pool> {
    let pools = state.pools.lock().map_err(|e| format!("Lock error: {}", e))?;
    pools.get(profile_id).cloned().ok_or_else(|| {
        AppError::from("Not connected. Please connect first.")
    })
}

pub fn split_sql_statements(sql: &str) -> Vec<String> {
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

fn normalized_query_timeout_ms(timeout_ms: Option<u64>) -> u64 {
    timeout_ms
        .unwrap_or(DEFAULT_QUERY_TIMEOUT_MS)
        .clamp(MIN_QUERY_TIMEOUT_MS, MAX_QUERY_TIMEOUT_MS)
}

fn format_timeout_label(timeout_ms: u64) -> String {
    if timeout_ms.is_multiple_of(1000) {
        format!("{}s", timeout_ms / 1000)
    } else {
        format!("{:.1}s", timeout_ms as f64 / 1000.0)
    }
}

fn mysql_value_to_json(raw: &mysql_async::Value) -> serde_json::Value {
    match raw {
        mysql_async::Value::NULL => serde_json::Value::Null,
        mysql_async::Value::Bytes(b) => match String::from_utf8(b.clone()) {
            Ok(s) => serde_json::Value::String(s),
            Err(_) => serde_json::Value::String(format!("[binary {} bytes]", b.len())),
        },
        mysql_async::Value::Int(n) => serde_json::Value::Number(serde_json::Number::from(*n)),
        mysql_async::Value::UInt(n) => serde_json::Value::Number(serde_json::Number::from(*n)),
        mysql_async::Value::Float(f) => serde_json::Number::from_f64(*f as f64)
            .map(serde_json::Value::Number)
            .unwrap_or_else(|| serde_json::Value::String(f.to_string())),
        mysql_async::Value::Double(f) => serde_json::Number::from_f64(*f)
            .map(serde_json::Value::Number)
            .unwrap_or_else(|| serde_json::Value::String(f.to_string())),
        mysql_async::Value::Date(y, m, d, h, mi, s, _us) => serde_json::Value::String(format!(
            "{:04}-{:02}-{:02} {:02}:{:02}:{:02}",
            y, m, d, h, mi, s
        )),
        mysql_async::Value::Time(neg, d, h, mi, s, _us) => {
            let sign = if *neg { "-" } else { "" };
            let total_hours = *d * 24 + u32::from(*h);
            serde_json::Value::String(format!(
                "{}{:02}:{:02}:{:02}",
                sign, total_hours, mi, s
            ))
        }
    }
}

async fn exec_use_database(
    conn: &mut mysql_async::Conn,
    database: &str,
) -> AppResult<()> {
    if database.trim().is_empty() {
        return Ok(());
    }
    conn.query_drop(format!("USE {}", escape_ident(database)))
        .await
        .map_err(|e| AppError::database(format!("USE database error: {}", e)))
}

async fn fetch_show_create_value(
    conn: &mut mysql_async::Conn,
    query: String,
    value_index: usize,
) -> AppResult<String> {
    let row = conn
        .query_first::<mysql_async::Row, _>(query)
        .await
        .map_err(|e| AppError::database(e.to_string()))?
        .ok_or_else(|| AppError::database("Object not found"))?;
    row.get::<String, usize>(value_index)
        .ok_or_else(|| AppError::database("DDL was unavailable"))
}

fn configured_label(value: bool) -> &'static str {
    if value {
        "enabled"
    } else {
        "disabled"
    }
}

fn option_label(value: Option<&str>) -> &'static str {
    match value {
        Some(value) if !value.trim().is_empty() => "<provided>",
        _ => "<unset>",
    }
}

fn option_path(value: Option<&str>, verbose: bool) -> String {
    match value {
        Some(value) if !value.trim().is_empty() => {
            if verbose {
                value.to_string()
            } else {
                "<provided>".to_string()
            }
        }
        _ => "<unset>".to_string(),
    }
}

fn database_label(database: Option<&str>) -> &str {
    match database {
        Some(value) if !value.trim().is_empty() => value,
        _ => "<none>",
    }
}

fn db_driver_label(db_type: &str) -> &str {
    if db_type.is_empty() {
        "mysql"
    } else {
        db_type
    }
}

fn row_string(row: &mysql_async::Row, idx: usize) -> String {
    row.get::<String, usize>(idx).unwrap_or_default()
}

fn row_opt_string(row: &mysql_async::Row, idx: usize) -> Option<String> {
    row.get::<Option<String>, usize>(idx).flatten()
}

fn row_u64(row: &mysql_async::Row, idx: usize) -> u64 {
    row.get::<u64, usize>(idx).unwrap_or_default()
}

fn first_available_string(row: &mysql_async::Row, indexes: &[usize]) -> String {
    for idx in indexes {
        if let Some(value) = row.get::<String, usize>(*idx) {
            if !value.is_empty() {
                return value;
            }
        }
    }
    String::new()
}

async fn run_query_with_timeout<T, F>(
    log_state: &LogState,
    profile_id: &str,
    label: &str,
    timeout_ms: Option<u64>,
    future: F,
) -> AppResult<T>
where
    F: std::future::Future<Output = Result<T, mysql_async::Error>>,
{
    let effective_timeout_ms = normalized_query_timeout_ms(timeout_ms);

    match tokio::time::timeout(Duration::from_millis(effective_timeout_ms), future).await {
        Ok(result) => result.map_err(|e| {
            let msg = format!("Query error [{}]: {}", label, e);
            log_error(log_state, label, Some(profile_id), &msg, None);
            AppError::database(msg)
        }),
        Err(_) => {
            let msg = format!(
                "Query timed out after {} [{}]",
                format_timeout_label(effective_timeout_ms),
                label,
            );
            log_error(log_state, label, Some(profile_id), &msg, None);
            Err(AppError::database(msg))
        }
    }
}

// ─── DB Commands ────────────────────────────────────────────────────

/// Signal an in-flight `db_connect` for `profile_id` to abort at its next
/// check-point.  Safe to call even if no connection attempt is in progress.
#[tauri::command]
pub async fn db_cancel_connect(
    state: State<'_, DbState>,
    log_state: tauri::State<'_, LogState>,
    profile_id: String,
) -> AppResult<()> {
    if let Ok(tokens) = state.cancel_tokens.lock() {
        if let Some(token) = tokens.get(&profile_id) {
            token.store(true, Ordering::Relaxed);
            log_info(&log_state, "db", Some(&profile_id), "Connection cancellation requested.");
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn db_connect(
    state: State<'_, DbState>,
    log_state: tauri::State<'_, LogState>,
    params: ConnectParams,
) -> AppResult<String> {
    let mut params = params;
    let connect_started = Instant::now();
    let pid = params.profile_id.clone();
    let db_type = params.db_type.as_str();
    let verbose = params.connection_verbose_logging;
    let target = format!("{}@{}:{}", params.user, params.host, params.port);

    log_info(
        &log_state,
        "db",
        Some(&pid),
        &format!(
            "Connection requested: driver={}, target={}, database={}, ssl={}, ssh={}, verbose={}",
            db_driver_label(db_type),
            target,
            database_label(params.database.as_deref()),
            configured_label(params.ssl),
            configured_label(params.ssh),
            configured_label(verbose),
        ),
    );
    log_mysql_verbose(
        &log_state,
        &pid,
        verbose,
        &format!(
            "Connection options: password={}, ssl_verify_server_cert={}, ssl_ca={}, ssl_cert={}, ssl_key={}, ssh_host={}, ssh_port={}, ssh_user={}, ssh_password={}, ssh_key={}, ssh_passphrase={}, ssh_strict_key_checking={}, ssh_keep_alive_interval={}s, ssh_compression={}",
            option_label(Some(params.password.as_str())),
            configured_label(params.ssl_reject_unauthorized),
            option_path(params.ssl_ca_file.as_deref(), verbose),
            option_path(params.ssl_cert_file.as_deref(), verbose),
            option_path(params.ssl_key_file.as_deref(), verbose),
            params.ssh_host.as_deref().unwrap_or("<unset>"),
            params.ssh_port.unwrap_or(22),
            params.ssh_user.as_deref().unwrap_or("<unset>"),
            option_label(params.ssh_password.as_deref()),
            option_path(params.ssh_key_file.as_deref(), verbose),
            option_label(params.ssh_passphrase.as_deref()),
            params.ssh_strict_key_checking,
            params.ssh_keep_alive_interval,
            params.ssh_compression,
        ),
    );

    // Backend safety net: only mysql and mariadb are supported
    if !db_type.is_empty() && db_type != "mysql" && db_type != "mariadb" {
        let msg = format!(
            "Unsupported database type '{}'. Only MySQL and MariaDB are supported in this version.",
            db_type
        );
        log_error(&log_state, "db", Some(&pid), &msg, None);
        return Err(AppError::validation(msg));
    }

    // Register a fresh cancel token for this connection attempt.
    // Any stale token from a previous attempt is overwritten with false.
    let cancel_token = Arc::new(AtomicBool::new(false));
    {
        let mut tokens = state.cancel_tokens.lock().map_err(|e| e.to_string())?;
        tokens.insert(pid.clone(), cancel_token.clone());
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
    log_mysql_verbose(
        &log_state,
        &pid,
        verbose,
        "Database password decrypted for active connection attempt.",
    );

    if params.ssh {
        if let Some(ssh_pass) = conn_params.ssh_password.as_mut() {
            *ssh_pass = decrypt_password(ssh_pass.clone())?;
        }
        if let Some(ssh_passphrase) = conn_params.ssh_passphrase.as_mut() {
            *ssh_passphrase = decrypt_password(ssh_passphrase.clone())?;
        }
        log_mysql_verbose(
            &log_state,
            &pid,
            verbose,
            "SSH secret material decrypted for active connection attempt.",
        );

        // Cancel check: abort before any blocking SSH work begins.
        if cancel_token.load(Ordering::Relaxed) {
            let msg = "Connection cancelled.".to_string();
            log_info(&log_state, "db", Some(&pid), &msg);
            return Err(AppError::ssh(msg));
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
                log_info(&log_state, "db", Some(&pid), "Closing previous SSH tunnel before reconnecting.");
                shutdown_tunnel(old);
            }
            // Debug telemetry: log active tunnel count after cleanup.
            #[cfg(debug_assertions)]
            if let Ok(tunnels) = state.tunnels.lock() {
                eprintln!(
                    "[workgrid-studio] [debug] active SSH tunnel count after reconnect cleanup: {}",
                    tunnels.len()
                );
            }
            if let Ok(tunnels) = state.tunnels.lock() {
                log_mysql_verbose(
                    &log_state,
                    &pid,
                    verbose,
                    &format!(
                        "Active SSH tunnel count after reconnect cleanup: {}",
                        tunnels.len()
                    ),
                );
            }
        }
        let handle = establish_ssh_tunnel(&pid, &conn_params, &log_state).await?;
        log_info(
            &log_state,
            "db",
            Some(&pid),
            &format!(
                "SSH tunnel established: 127.0.0.1:{} -> {}:{}",
                handle.local_port, params.host, params.port
            ),
        );

        // Redirect connection to local port
        conn_params.host = "127.0.0.1".to_string();
        conn_params.port = handle.local_port;
        log_mysql_verbose(
            &log_state,
            &pid,
            verbose,
            &format!(
                "MySQL TCP target redirected through SSH tunnel to {}:{}",
                conn_params.host, conn_params.port
            ),
        );

        let mut tunnels = state.tunnels.lock().map_err(|e| e.to_string())?;
        tunnels.insert(pid.clone(), handle);
    }

    // Cancel check: abort after SSH tunnel is up but before TCP to MySQL.
    // The tunnel will be cleaned up by the disconnect path on the next call.
    if cancel_token.load(Ordering::Relaxed) {
        let msg = "Connection cancelled.".to_string();
        log_info(&log_state, "db", Some(&pid), &msg);
        return Err(AppError::ssh(msg));
    }

    log_info(
        &log_state,
        "db",
        Some(&pid),
        &format!(
            "Connecting to {} ({}) ...",
            target,
            db_driver_label(db_type)
        ),
    );

    let mut builder = OptsBuilder::default()
        .ip_or_hostname(conn_params.host.clone())
        .tcp_port(conn_params.port)
        .user(Some(conn_params.user.clone()))
        .pass(Some(conn_params.password.clone()));
    log_mysql_verbose(
        &log_state,
        &pid,
        verbose,
        &format!(
            "Prepared MySQL TCP target {}:{} with database {}.",
            conn_params.host,
            conn_params.port,
            database_label(conn_params.database.as_deref())
        ),
    );

    if let Some(ref db) = conn_params.database {
        if !db.is_empty() {
            builder = builder.db_name(Some(db.clone()));
        }
    }

    if params.ssl {
        log_info(
            &log_state,
            "db",
            Some(&pid),
            &format!(
                "MySQL TLS is enabled. Server certificate validation is {}.",
                configured_label(params.ssl_reject_unauthorized)
            ),
        );
        log_mysql_verbose(
            &log_state,
            &pid,
            verbose,
            &format!(
                "MySQL TLS asset configuration: ca={}, client_cert={}, client_key={}",
                option_path(params.ssl_ca_file.as_deref(), verbose),
                option_path(params.ssl_cert_file.as_deref(), verbose),
                option_path(params.ssl_key_file.as_deref(), verbose),
            ),
        );
        let mut ssl_opts = mysql_async::SslOpts::default();

        if !params.ssl_reject_unauthorized {
            ssl_opts = ssl_opts.with_danger_accept_invalid_certs(true);
        }

        if let Some(ca) = params.ssl_ca_file {
            if !ca.is_empty() {
                let path = std::path::PathBuf::from(&ca);
                if !path.exists() {
                    let msg = format!("CA Certificate file does not exist at path: {}", ca);
                    log_error(&log_state, "db", Some(&pid), &msg, None);
                    return Err(AppError::validation(msg));
                }
                ssl_opts = ssl_opts.with_root_certs(vec![path.into()]);
                log_mysql_verbose(&log_state, &pid, verbose, "Validated MySQL CA certificate path.");
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
                    log_error(&log_state, "db", Some(&pid), &msg, None);
                    return Err(AppError::validation(msg));
                }
                has_cert = true;
                log_mysql_verbose(&log_state, &pid, verbose, "Validated MySQL client certificate path.");
            }
        }

        if let Some(key) = params.ssl_key_file {
            if !key.is_empty() {
                key_path = std::path::PathBuf::from(&key);
                if !key_path.exists() {
                    let msg = format!("Client Key file does not exist at path: {}", key);
                    log_error(&log_state, "db", Some(&pid), &msg, None);
                    return Err(AppError::validation(msg));
                }
                has_key = true;
                log_mysql_verbose(&log_state, &pid, verbose, "Validated MySQL client key path.");
            }
        }

        if has_cert && has_key {
            let identity = mysql_async::ClientIdentity::new(cert_path.into(), key_path.into());
            ssl_opts = ssl_opts.with_client_identity(Some(identity));
            log_mysql_verbose(
                &log_state,
                &pid,
                verbose,
                "Configured MySQL mutual TLS client identity.",
            );
        } else if has_cert || has_key {
            let msg = "Both Client Certificate and Client Key must be provided for mutual TLS."
                .to_string();
            log_error(&log_state, "db", Some(&pid), &msg, None);
            return Err(AppError::validation(msg));
        }

        builder = builder.ssl_opts(Some(ssl_opts));
    } else {
        log_mysql_verbose(&log_state, &pid, verbose, "MySQL TLS disabled for this connection.");
    }

    let pool_opts = PoolOpts::new().with_constraints(PoolConstraints::new(0, 5).unwrap());
    builder = builder.pool_opts(Some(pool_opts));
    log_mysql_verbose(
        &log_state,
        &pid,
        verbose,
        "Configured MySQL pool constraints: min=0, max=5.",
    );

    let opts: Opts = builder.into();
    let pool = Pool::new(opts);
    let mysql_connect_started = Instant::now();

    // Wrap the async MySQL handshake in a select! so a cancel request during
    // a slow TCP connect or MySQL greeting exchange is handled immediately.
    let cancel_for_select = cancel_token.clone();
    let get_conn_result = tokio::select! {
        r = pool.get_conn() => r,
        _ = async move {
            loop {
                tokio::time::sleep(Duration::from_millis(100)).await;
                if cancel_for_select.load(Ordering::Relaxed) {
                    return;
                }
            }
        } => {
            let msg = "Connection cancelled.".to_string();
            log_info(&log_state, "db", Some(&pid), &msg);
            return Err(AppError::ssh(msg));
        }
    };

    match get_conn_result {
        Ok(conn) => {
            drop(conn);
            log_info(
                &log_state,
                "db",
                Some(&pid),
                &format!(
                    "Connected to {} in {} ms",
                    target,
                    mysql_connect_started.elapsed().as_millis()
                ),
            );
        }
        Err(e) => {
            let msg = format!("Connection failed to {}: {}", target, e);
            log_error(&log_state, "db", Some(&pid), &msg, None);
            return Err(AppError::database(msg));
        }
    }

    let mut pools = state.pools.lock().map_err(|e| {
        let msg = format!("Lock error: {}", e);
        log_error(&log_state, "db", Some(&pid), &msg, None);
        msg
    })?;

    if let Some(old_pool) = pools.remove(&pid) {
        log_mysql_verbose(&log_state, &pid, verbose, "Replacing existing MySQL pool for profile.");
        tauri::async_runtime::spawn(async move {
            let _ = old_pool.disconnect().await;
        });
    }
    pools.insert(pid.clone(), pool);
    log_mysql_verbose(
        &log_state,
        &pid,
        verbose,
        &format!("Active MySQL pool count is now {}.", pools.len()),
    );

    // Clean up the cancel token on successful connection.
    if let Ok(mut tokens) = state.cancel_tokens.lock() {
        tokens.remove(&pid);
    }

    let success_message = format!(
        "Connected to {} in {} ms",
        target,
        connect_started.elapsed().as_millis()
    );
    log_mysql_verbose(&log_state, &pid, verbose, &success_message);
    Ok(success_message)
}

#[tauri::command]
pub async fn db_disconnect(
    state: State<'_, DbState>,
    log_state: tauri::State<'_, LogState>,
    profile_id: String,
) -> AppResult<String> {
    log_info(&log_state, "db", Some(&profile_id), "Disconnecting...");

    // Remove the pool while holding the lock, then drop the lock before awaiting disconnect.
    // Holding a std::sync::Mutex guard across an .await point would block the thread.
    let pool = {
        let mut pools = state.pools.lock().map_err(|e| {
            let msg = format!("Lock error: {}", e);
            log_error(&log_state, "db", Some(&profile_id), &msg, None);
            msg
        })?;
        pools.remove(&profile_id)
    }; // lock released here

    if let Some(pool) = pool {
        log_info(&log_state, "db", Some(&profile_id), "Closing MySQL pool.");
        let _ = pool.disconnect().await;
    }

    // Remove the tunnel handle while holding the lock, then release the lock
    // before joining the thread to avoid holding the mutex during the join.
    let tunnel = {
        let mut tunnels = state.tunnels.lock().map_err(|e| e.to_string())?;
        tunnels.remove(&profile_id)
    };
    if let Some(handle) = tunnel {
        log_info(&log_state, "db", Some(&profile_id), "Shutting down SSH tunnel.");
        shutdown_tunnel(handle);
    }
    // Debug telemetry: log active tunnel count after disconnect.
    #[cfg(debug_assertions)]
    if let Ok(tunnels) = state.tunnels.lock() {
        eprintln!(
            "[workgrid-studio] [debug] active SSH tunnel count after disconnect: {}",
            tunnels.len()
        );
    }

    log_info(&log_state, "db", Some(&profile_id), "Disconnected");
    Ok("Disconnected".to_string())
}

#[tauri::command]
pub async fn db_ping(state: State<'_, DbState>, profile_id: String) -> AppResult<u128> {
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
            Err(AppError::database(msg))
        }
    }
}

#[tauri::command]
pub async fn db_list_databases(
    state: State<'_, DbState>,
    log_state: tauri::State<'_, LogState>,
    profile_id: String,
) -> AppResult<Vec<String>> {
    let pool = get_pool(&state, &profile_id)?;
    let query = "SHOW DATABASES";

    let mut conn = pool.get_conn().await.map_err(|e| {
        let msg = format!("Connection error: {}", e);
        log_error(&log_state, "db", Some(&profile_id), &msg, None);
        msg
    })?;

    match conn.query::<String, _>(query).await {
        Ok(databases) => {
            log_query_result(&log_state, &profile_id, query, databases.len());
            drop(conn);
            Ok(databases)
        }
        Err(e) => {
            let msg = format!("Query error [{}]: {}", query, e);
            log_error(&log_state, "db", Some(&profile_id), &msg, None);
            Err(AppError::database(msg))
        }
    }
}

#[tauri::command]
pub async fn db_list_tables(
    state: State<'_, DbState>,
    log_state: tauri::State<'_, LogState>,
    profile_id: String,
    database: String,
) -> AppResult<Vec<String>> {
    let pool = get_pool(&state, &profile_id)?;
    let query = format!("SHOW TABLES FROM `{}`", database);

    let mut conn = pool.get_conn().await.map_err(|e| {
        let msg = format!("Connection error: {}", e);
        log_error(&log_state, "db", Some(&profile_id), &msg, None);
        msg
    })?;

    match conn.query::<String, _>(&query).await {
        Ok(tables) => {
            log_query_result(&log_state, &profile_id, &query, tables.len());
            drop(conn);
            Ok(tables)
        }
        Err(e) => {
            let msg = format!("Query error [{}]: {}", query, e);
            log_error(&log_state, "db", Some(&profile_id), &msg, None);
            Err(AppError::database(msg))
        }
    }
}

#[tauri::command]
pub async fn db_list_columns(
    state: State<'_, DbState>,
    log_state: tauri::State<'_, LogState>,
    profile_id: String,
    database: String,
    table: String,
) -> AppResult<Vec<ColumnInfo>> {
    let pool = get_pool(&state, &profile_id)?;
    let query = format!("SHOW COLUMNS FROM `{}`.`{}`", database, table);

    let mut conn = pool.get_conn().await.map_err(|e| {
        let msg = format!("Connection error: {}", e);
        log_error(&log_state, "db", Some(&profile_id), &msg, None);
        msg
    })?;

    match conn
        .query::<(String, String, String, String, Option<String>, String), _>(&query)
        .await
    {
        Ok(rows) => {
            log_query_result(&log_state, &profile_id, &query, rows.len());
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
            log_error(&log_state, "db", Some(&profile_id), &msg, None);
            Err(AppError::database(msg))
        }
    }
}

#[tauri::command]
pub async fn db_get_databases_info(
    state: State<'_, DbState>,
    log_state: tauri::State<'_, LogState>,
    profile_id: String,
) -> AppResult<Vec<DatabaseInfo>> {
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
        log_error(&log_state, "db", Some(&profile_id), &msg, None);
        msg
    })?;

    match conn
        .query::<(String, i64, i64, i64, String, Option<String>), _>(query)
        .await
    {
        Ok(rows) => {
            log_query_result(
                &log_state,
                &profile_id,
                "SELECT databases info FROM information_schema",
                rows.len(),
            );
            let infos: Vec<DatabaseInfo> = rows
                .into_iter()
                .map(
                    |(name, size_bytes, tables, views, collation, last_mod)| DatabaseInfo {
                        name,
                        size_bytes,
                        tables,
                        views,
                        default_collation: collation,
                        last_modified: last_mod,
                    },
                )
                .collect();
            drop(conn);
            Ok(infos)
        }
        Err(e) => {
            let msg = format!("Query error [databases info]: {}", e);
            Err(AppError::database(msg))
        }
    }
}

#[tauri::command]
pub async fn db_get_tables_info(
    state: State<'_, DbState>,
    log_state: tauri::State<'_, LogState>,
    profile_id: String,
    database: String,
) -> AppResult<Vec<TableInfo>> {
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
        log_error(&log_state, "db", Some(&profile_id), &msg, None);
        msg
    })?;

    match conn
        .exec::<(
            String,
            Option<i64>,
            Option<i64>,
            Option<String>,
            Option<String>,
            Option<String>,
            Option<String>,
            String,
        ), _, _>(query, params! { "db" => database.clone() })
        .await
    {
        Ok(rows) => {
            log_query_result(
                &log_state,
                &profile_id,
                &format!(
                    "SELECT tables info FROM information_schema for {}",
                    database
                ),
                rows.len(),
            );
            let infos: Vec<TableInfo> = rows
                .into_iter()
                .map(
                    |(name, rows, size_bytes, created, updated, engine, comment, type_)| {
                        TableInfo {
                            name,
                            rows,
                            size_bytes,
                            created,
                            updated,
                            engine,
                            comment,
                            type_,
                        }
                    },
                )
                .collect();
            drop(conn);
            Ok(infos)
        }
        Err(e) => {
            let msg = format!("Query error [tables info]: {}", e);
            log_error(&log_state, "db", Some(&profile_id), &msg, None);
            Err(AppError::database(msg))
        }
    }
}

#[tauri::command]
pub async fn db_get_variables(
    state: State<'_, DbState>,
    log_state: tauri::State<'_, LogState>,
    profile_id: String,
) -> AppResult<Vec<VariableInfo>> {
    let pool = get_pool(&state, &profile_id)?;

    let mut conn = pool.get_conn().await.map_err(|e| {
        let msg = format!("Connection error: {}", e);
        log_error(&log_state, "db", Some(&profile_id), &msg, None);
        msg
    })?;

    // Try to get scopes from performance_schema
    let mut scope_map = std::collections::HashMap::new();
    if let Ok(scopes) = conn
        .query::<(String, String), _>(
            "SELECT VARIABLE_NAME, VARIABLE_SCOPE FROM performance_schema.variables_info",
        )
        .await
    {
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

    let mut map: std::collections::BTreeMap<String, (String, String)> =
        std::collections::BTreeMap::new();

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
pub async fn db_set_variable(
    state: State<'_, DbState>,
    log_state: tauri::State<'_, LogState>,
    profile_id: String,
    scope: String,
    name: String,
    value: String,
) -> AppResult<()> {
    let pool = get_pool(&state, &profile_id)?;
    let mut conn = pool.get_conn().await.map_err(|e| {
        let msg = format!("Connection error: {}", e);
        log_error(&log_state, "db", Some(&profile_id), &msg, None);
        msg
    })?;

    let scope_str = if scope.eq_ignore_ascii_case("GLOBAL") {
        "GLOBAL"
    } else {
        "SESSION"
    };

    if !name.chars().all(|c| c.is_alphanumeric() || c == '_') {
        let msg = format!("Invalid variable name: {}", name);
        log_error(&log_state, "db", Some(&profile_id), &msg, None);
        return Err(AppError::validation(msg));
    }

    // Escape backslashes and single quotes manually
    let query = format!("SET {} {} = ?", scope_str, name);

    conn.exec_drop(&query, (value,)).await.map_err(|e| {
        let msg = format!("Failed to set variable {}: {}", name, e);
        log_error(&log_state, "db", Some(&profile_id), &msg, None);
        msg
    })?;

    log_query_result(&log_state, &profile_id, &query, 0);

    Ok(())
}

#[tauri::command]
pub async fn db_get_status(
    state: State<'_, DbState>,
    log_state: tauri::State<'_, LogState>,
    profile_id: String,
) -> AppResult<Vec<StatusInfo>> {
    let pool = get_pool(&state, &profile_id)?;
    let mut conn = pool.get_conn().await.map_err(|e| {
        let msg = format!("Connection error: {}", e);
        log_error(&log_state, "db", Some(&profile_id), &msg, None);
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
pub async fn db_get_processes(
    state: State<'_, DbState>,
    log_state: tauri::State<'_, LogState>,
    profile_id: String,
) -> AppResult<Vec<ProcessInfo>> {
    let pool = get_pool(&state, &profile_id)?;
    let mut conn = pool.get_conn().await.map_err(|e| {
        let msg = format!("Connection error: {}", e);
        log_error(&log_state, "db", Some(&profile_id), &msg, None);
        msg
    })?;

    type ProcessListRow = (
        u64,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<i64>,
        Option<String>,
        Option<String>,
    );

    let query = "SELECT ID, USER, HOST, DB, COMMAND, TIME, STATE, INFO FROM information_schema.PROCESSLIST ORDER BY TIME DESC";
    let rows: Vec<ProcessListRow> = conn.query(query).await.map_err(|e| e.to_string())?;

    let infos: Vec<ProcessInfo> = rows
        .into_iter()
        .map(
            |(id, user, host, db, command, time, state, info)| ProcessInfo {
                id,
                user,
                host,
                db,
                command,
                time,
                state,
                info,
            },
        )
        .collect();

    Ok(infos)
}

#[tauri::command]
pub async fn db_kill_process(
    state: State<'_, DbState>,
    log_state: tauri::State<'_, LogState>,
    profile_id: String,
    process_id: u64,
) -> AppResult<()> {
    let pool = get_pool(&state, &profile_id)?;
    let mut conn = pool.get_conn().await.map_err(|e| {
        let msg = format!("Connection error: {}", e);
        log_error(&log_state, "db", Some(&profile_id), &msg, None);
        msg
    })?;

    let query = format!("KILL {}", process_id);
    conn.query_drop(&query).await.map_err(|e| {
        let msg = format!("Failed to kill process {}: {}", process_id, e);
        log_error(&log_state, "db", Some(&profile_id), &msg, None);
        msg
    })?;

    Ok(())
}

#[tauri::command]
pub async fn db_update_row(
    state: State<'_, DbState>,
    log_state: tauri::State<'_, LogState>,
    profile_id: String,
    database: String,
    table: String,
    pk_columns: HashMap<String, String>,
    changes: HashMap<String, String>,
) -> AppResult<()> {
    let pool = get_pool(&state, &profile_id)?;
    let mut conn = pool.get_conn().await.map_err(|e| {
        let msg = format!("Connection error: {}", e);
        log_error(&log_state, "db", Some(&profile_id), &msg, None);
        msg
    })?;

    if pk_columns.is_empty() || changes.is_empty() {
        let msg = "Primary key columns and changes are required for row updates.".to_string();
        log_error(&log_state, "db", Some(&profile_id), &msg, None);
        return Err(AppError::validation(msg));
    }

    let mut set_entries: Vec<(String, String)> = changes.into_iter().collect();
    set_entries.sort_by(|a, b| a.0.cmp(&b.0));
    let mut where_entries: Vec<(String, String)> = pk_columns.into_iter().collect();
    where_entries.sort_by(|a, b| a.0.cmp(&b.0));

    let mut params = Vec::with_capacity(set_entries.len() + where_entries.len());
    let set_clause = set_entries
        .into_iter()
        .map(|(column, value)| {
            params.push(mysql_async::Value::Bytes(value.into_bytes()));
            format!("{} = ?", escape_ident(&column))
        })
        .collect::<Vec<_>>()
        .join(", ");
    let where_clause = where_entries
        .into_iter()
        .map(|(column, value)| {
            params.push(mysql_async::Value::Bytes(value.into_bytes()));
            format!("{} = ?", escape_ident(&column))
        })
        .collect::<Vec<_>>()
        .join(" AND ");

    let query = format!(
        "UPDATE {}.{} SET {} WHERE {}",
        escape_ident(&database),
        escape_ident(&table),
        set_clause,
        where_clause
    );

    conn.exec_drop(&query, mysql_async::Params::Positional(params))
        .await
        .map_err(|e| {
            let msg = format!("Failed to update row in {}.{}: {}", database, table, e);
            log_error(&log_state, "db", Some(&profile_id), &msg, None);
            msg
        })?;

    log_query_result(&log_state, &profile_id, &query, conn.affected_rows() as usize);
    Ok(())
}

#[tauri::command]
pub async fn db_get_foreign_keys(
    state: State<'_, DbState>,
    log_state: tauri::State<'_, LogState>,
    profile_id: String,
    database: String,
    table: String,
) -> AppResult<Vec<ForeignKeyInfo>> {
    let pool = get_pool(&state, &profile_id)?;
    let mut conn = pool.get_conn().await.map_err(|e| {
        let msg = format!("Connection error: {}", e);
        log_error(&log_state, "db", Some(&profile_id), &msg, None);
        msg
    })?;

    let query = r#"
        SELECT
            kcu.CONSTRAINT_NAME,
            kcu.COLUMN_NAME,
            kcu.REFERENCED_TABLE_NAME,
            kcu.REFERENCED_COLUMN_NAME,
            rc.UPDATE_RULE,
            rc.DELETE_RULE
        FROM information_schema.KEY_COLUMN_USAGE kcu
        LEFT JOIN information_schema.REFERENTIAL_CONSTRAINTS rc
          ON rc.CONSTRAINT_SCHEMA = kcu.CONSTRAINT_SCHEMA
         AND rc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
        WHERE kcu.TABLE_SCHEMA = :db
          AND kcu.TABLE_NAME = :table
          AND kcu.REFERENCED_TABLE_NAME IS NOT NULL
        ORDER BY kcu.CONSTRAINT_NAME, kcu.ORDINAL_POSITION
    "#;

    let rows: Vec<(String, String, String, String, Option<String>, Option<String>)> = conn
        .exec(
            query,
            params! {
                "db" => database.clone(),
                "table" => table.clone(),
            },
        )
        .await
        .map_err(|e| {
            let msg = format!("Failed to load foreign keys for {}.{}: {}", database, table, e);
            log_error(&log_state, "db", Some(&profile_id), &msg, None);
            msg
        })?;

    log_query_result(&log_state, &profile_id, query, rows.len());
    Ok(rows
        .into_iter()
        .map(
            |(constraint_name, column_name, referenced_table_name, referenced_column_name, update_rule, delete_rule)| {
                ForeignKeyInfo {
                    constraint_name,
                    column_name,
                    referenced_table_name,
                    referenced_column_name,
                    update_rule,
                    delete_rule,
                }
            },
        )
        .collect())
}

#[tauri::command]
pub async fn db_get_indexes(
    state: State<'_, DbState>,
    log_state: tauri::State<'_, LogState>,
    profile_id: String,
    database: String,
    table: String,
) -> AppResult<Vec<IndexInfo>> {
    let pool = get_pool(&state, &profile_id)?;
    let mut conn = pool.get_conn().await.map_err(|e| {
        let msg = format!("Connection error: {}", e);
        log_error(&log_state, "db", Some(&profile_id), &msg, None);
        msg
    })?;

    let query = format!(
        "SHOW INDEX FROM {}.{}",
        escape_ident(&database),
        escape_ident(&table)
    );

    let rows: Vec<mysql_async::Row> = conn.query(&query).await.map_err(|e| {
        let msg = format!("Failed to load indexes for {}.{}: {}", database, table, e);
        log_error(&log_state, "db", Some(&profile_id), &msg, None);
        msg
    })?;

    log_query_result(&log_state, &profile_id, &query, rows.len());
    Ok(rows
        .into_iter()
        .map(|row| IndexInfo {
            name: row_string(&row, 2),
            column_name: row_opt_string(&row, 4),
            seq_in_index: row_u64(&row, 3),
            non_unique: row_u64(&row, 1),
            index_type: row_string(&row, 10),
            nullable: row_opt_string(&row, 9),
            comment: row_opt_string(&row, 11),
            index_comment: row_opt_string(&row, 12),
        })
        .collect())
}

#[tauri::command]
pub async fn db_list_triggers(
    state: State<'_, DbState>,
    log_state: tauri::State<'_, LogState>,
    profile_id: String,
    database: String,
) -> AppResult<Vec<TriggerInfo>> {
    let pool = get_pool(&state, &profile_id)?;
    let mut conn = pool.get_conn().await.map_err(|e| {
        let msg = format!("Connection error: {}", e);
        log_error(&log_state, "db", Some(&profile_id), &msg, None);
        msg
    })?;

    let query = r#"
        SELECT
            TRIGGER_NAME,
            EVENT_OBJECT_TABLE,
            ACTION_TIMING,
            EVENT_MANIPULATION,
            ACTION_STATEMENT
        FROM information_schema.TRIGGERS
        WHERE TRIGGER_SCHEMA = :db
        ORDER BY TRIGGER_NAME
    "#;

    let rows: Vec<(String, String, String, String, String)> = conn
        .exec(query, params! { "db" => database.clone() })
        .await
        .map_err(|e| {
            let msg = format!("Failed to load triggers for {}: {}", database, e);
            log_error(&log_state, "db", Some(&profile_id), &msg, None);
            msg
        })?;

    log_query_result(&log_state, &profile_id, query, rows.len());
    Ok(rows
        .into_iter()
        .map(|(name, table_name, timing, event, statement)| TriggerInfo {
            name,
            table_name,
            timing,
            event,
            statement,
        })
        .collect())
}

#[tauri::command]
pub async fn db_get_trigger_ddl(
    state: State<'_, DbState>,
    log_state: tauri::State<'_, LogState>,
    profile_id: String,
    database: String,
    trigger_name: String,
) -> AppResult<String> {
    let pool = get_pool(&state, &profile_id)?;
    let mut conn = pool.get_conn().await.map_err(|e| {
        let msg = format!("Connection error: {}", e);
        log_error(&log_state, "db", Some(&profile_id), &msg, None);
        msg
    })?;

    if !database.is_empty() {
        conn.query_drop(format!("USE {}", escape_ident(&database)))
            .await
            .map_err(|e| {
                let msg = format!("Failed to select database {}: {}", database, e);
                log_error(&log_state, "db", Some(&profile_id), &msg, None);
                msg
            })?;
    }

    let query = format!("SHOW CREATE TRIGGER {}", escape_ident(&trigger_name));
    let row = conn.query_first::<mysql_async::Row, _>(&query).await.map_err(|e| {
        let msg = format!("Failed to load trigger DDL for {}: {}", trigger_name, e);
        log_error(&log_state, "db", Some(&profile_id), &msg, None);
        msg
    })?;

    let ddl = row
        .map(|row| first_available_string(&row, &[2, 1]))
        .unwrap_or_default();
    log_query_result(&log_state, &profile_id, &query, usize::from(!ddl.is_empty()));
    Ok(ddl)
}

#[tauri::command]
pub async fn db_drop_trigger(
    state: State<'_, DbState>,
    log_state: tauri::State<'_, LogState>,
    profile_id: String,
    database: String,
    trigger_name: String,
) -> AppResult<()> {
    let pool = get_pool(&state, &profile_id)?;
    let mut conn = pool.get_conn().await.map_err(|e| {
        let msg = format!("Connection error: {}", e);
        log_error(&log_state, "db", Some(&profile_id), &msg, None);
        msg
    })?;

    if !database.is_empty() {
        conn.query_drop(format!("USE {}", escape_ident(&database)))
            .await
            .map_err(|e| {
                let msg = format!("Failed to select database {}: {}", database, e);
                log_error(&log_state, "db", Some(&profile_id), &msg, None);
                msg
            })?;
    }

    let query = format!("DROP TRIGGER IF EXISTS {}", escape_ident(&trigger_name));
    conn.query_drop(&query).await.map_err(|e| {
        let msg = format!("Failed to drop trigger {}: {}", trigger_name, e);
        log_error(&log_state, "db", Some(&profile_id), &msg, None);
        msg
    })?;
    log_query_result(&log_state, &profile_id, &query, 0);
    Ok(())
}

#[tauri::command]
pub async fn db_create_trigger(
    state: State<'_, DbState>,
    log_state: tauri::State<'_, LogState>,
    profile_id: String,
    database: String,
    sql: String,
) -> AppResult<()> {
    let pool = get_pool(&state, &profile_id)?;
    let mut conn = pool.get_conn().await.map_err(|e| {
        let msg = format!("Connection error: {}", e);
        log_error(&log_state, "db", Some(&profile_id), &msg, None);
        msg
    })?;

    if !database.is_empty() {
        conn.query_drop(format!("USE {}", escape_ident(&database)))
            .await
            .map_err(|e| {
                let msg = format!("Failed to select database {}: {}", database, e);
                log_error(&log_state, "db", Some(&profile_id), &msg, None);
                msg
            })?;
    }

    conn.query_drop(&sql).await.map_err(|e| {
        let msg = format!("Failed to create trigger: {}", e);
        log_error(&log_state, "db", Some(&profile_id), &msg, None);
        msg
    })?;
    log_query(&log_state, &profile_id, &sql, None);
    Ok(())
}

#[tauri::command]
pub async fn db_list_routines(
    state: State<'_, DbState>,
    log_state: tauri::State<'_, LogState>,
    profile_id: String,
    database: String,
    routine_type: String,
) -> AppResult<Vec<RoutineInfo>> {
    let pool = get_pool(&state, &profile_id)?;
    let mut conn = pool.get_conn().await.map_err(|e| {
        let msg = format!("Connection error: {}", e);
        log_error(&log_state, "db", Some(&profile_id), &msg, None);
        msg
    })?;

    let query = r#"
        SELECT ROUTINE_NAME, ROUTINE_TYPE, DATA_TYPE
        FROM information_schema.ROUTINES
        WHERE ROUTINE_SCHEMA = :db AND ROUTINE_TYPE = :routine_type
        ORDER BY ROUTINE_NAME
    "#;

    let rows: Vec<(String, String, Option<String>)> = conn
        .exec(
            query,
            params! {
                "db" => database.clone(),
                "routine_type" => routine_type.clone(),
            },
        )
        .await
        .map_err(|e| {
            let msg = format!(
                "Failed to load routines for {} ({}): {}",
                database, routine_type, e
            );
            log_error(&log_state, "db", Some(&profile_id), &msg, None);
            msg
        })?;

    log_query_result(&log_state, &profile_id, query, rows.len());
    Ok(rows
        .into_iter()
        .map(|(name, routine_type, data_type)| RoutineInfo {
            name,
            routine_type,
            data_type,
        })
        .collect())
}

#[tauri::command]
pub async fn db_get_routine_ddl(
    state: State<'_, DbState>,
    log_state: tauri::State<'_, LogState>,
    profile_id: String,
    database: String,
    name: String,
    routine_type: String,
) -> AppResult<String> {
    let pool = get_pool(&state, &profile_id)?;
    let mut conn = pool.get_conn().await.map_err(|e| {
        let msg = format!("Connection error: {}", e);
        log_error(&log_state, "db", Some(&profile_id), &msg, None);
        msg
    })?;

    if !database.is_empty() {
        conn.query_drop(format!("USE {}", escape_ident(&database)))
            .await
            .map_err(|e| {
                let msg = format!("Failed to select database {}: {}", database, e);
                log_error(&log_state, "db", Some(&profile_id), &msg, None);
                msg
            })?;
    }

    let routine_kind = if routine_type.eq_ignore_ascii_case("FUNCTION") {
        "FUNCTION"
    } else {
        "PROCEDURE"
    };
    let query = format!("SHOW CREATE {} {}", routine_kind, escape_ident(&name));
    let row = conn.query_first::<mysql_async::Row, _>(&query).await.map_err(|e| {
        let msg = format!("Failed to load routine DDL for {}: {}", name, e);
        log_error(&log_state, "db", Some(&profile_id), &msg, None);
        msg
    })?;

    let ddl = row
        .map(|row| first_available_string(&row, &[2, 1]))
        .unwrap_or_default();
    log_query_result(&log_state, &profile_id, &query, usize::from(!ddl.is_empty()));
    Ok(ddl)
}

#[tauri::command]
pub async fn db_drop_routine(
    state: State<'_, DbState>,
    log_state: tauri::State<'_, LogState>,
    profile_id: String,
    database: String,
    name: String,
    routine_type: String,
) -> AppResult<()> {
    let pool = get_pool(&state, &profile_id)?;
    let mut conn = pool.get_conn().await.map_err(|e| {
        let msg = format!("Connection error: {}", e);
        log_error(&log_state, "db", Some(&profile_id), &msg, None);
        msg
    })?;

    if !database.is_empty() {
        conn.query_drop(format!("USE {}", escape_ident(&database)))
            .await
            .map_err(|e| {
                let msg = format!("Failed to select database {}: {}", database, e);
                log_error(&log_state, "db", Some(&profile_id), &msg, None);
                msg
            })?;
    }

    let routine_kind = if routine_type.eq_ignore_ascii_case("FUNCTION") {
        "FUNCTION"
    } else {
        "PROCEDURE"
    };
    let query = format!("DROP {} IF EXISTS {}", routine_kind, escape_ident(&name));
    conn.query_drop(&query).await.map_err(|e| {
        let msg = format!("Failed to drop routine {}: {}", name, e);
        log_error(&log_state, "db", Some(&profile_id), &msg, None);
        msg
    })?;
    log_query_result(&log_state, &profile_id, &query, 0);
    Ok(())
}

#[tauri::command]
pub async fn db_create_or_replace_routine(
    state: State<'_, DbState>,
    log_state: tauri::State<'_, LogState>,
    profile_id: String,
    database: String,
    sql: String,
) -> AppResult<()> {
    let pool = get_pool(&state, &profile_id)?;
    let mut conn = pool.get_conn().await.map_err(|e| {
        let msg = format!("Connection error: {}", e);
        log_error(&log_state, "db", Some(&profile_id), &msg, None);
        msg
    })?;

    if !database.is_empty() {
        conn.query_drop(format!("USE {}", escape_ident(&database)))
            .await
            .map_err(|e| {
                let msg = format!("Failed to select database {}: {}", database, e);
                log_error(&log_state, "db", Some(&profile_id), &msg, None);
                msg
            })?;
    }

    conn.query_drop(&sql).await.map_err(|e| {
        let msg = format!("Failed to create or replace routine: {}", e);
        log_error(&log_state, "db", Some(&profile_id), &msg, None);
        msg
    })?;
    log_query(&log_state, &profile_id, &sql, None);
    Ok(())
}

#[tauri::command]
pub async fn db_list_views(
    state: State<'_, DbState>,
    log_state: tauri::State<'_, LogState>,
    profile_id: String,
    database: String,
) -> AppResult<Vec<ViewInfo>> {
    let pool = get_pool(&state, &profile_id)?;
    let mut conn = pool.get_conn().await.map_err(|e| {
        let msg = format!("Connection error: {}", e);
        log_error(&log_state, "db", Some(&profile_id), &msg, None);
        msg
    })?;

    let query = r#"
        SELECT TABLE_NAME, VIEW_DEFINITION
        FROM information_schema.VIEWS
        WHERE TABLE_SCHEMA = :db
        ORDER BY TABLE_NAME
    "#;

    let rows: Vec<(String, Option<String>)> = conn
        .exec(query, params! { "db" => database.clone() })
        .await
        .map_err(|e| {
            let msg = format!("Failed to load views for {}: {}", database, e);
            log_error(&log_state, "db", Some(&profile_id), &msg, None);
            msg
        })?;

    log_query_result(&log_state, &profile_id, query, rows.len());
    Ok(rows
        .into_iter()
        .map(|(name, definition)| ViewInfo { name, definition })
        .collect())
}

#[tauri::command]
pub async fn db_get_view_ddl(
    state: State<'_, DbState>,
    log_state: tauri::State<'_, LogState>,
    profile_id: String,
    database: String,
    view_name: String,
) -> AppResult<String> {
    let pool = get_pool(&state, &profile_id)?;
    let mut conn = pool.get_conn().await.map_err(|e| {
        let msg = format!("Connection error: {}", e);
        log_error(&log_state, "db", Some(&profile_id), &msg, None);
        msg
    })?;

    if !database.is_empty() {
        conn.query_drop(format!("USE {}", escape_ident(&database)))
            .await
            .map_err(|e| {
                let msg = format!("Failed to select database {}: {}", database, e);
                log_error(&log_state, "db", Some(&profile_id), &msg, None);
                msg
            })?;
    }

    let query = format!("SHOW CREATE VIEW {}", escape_ident(&view_name));
    let row = conn.query_first::<mysql_async::Row, _>(&query).await.map_err(|e| {
        let msg = format!("Failed to load view DDL for {}: {}", view_name, e);
        log_error(&log_state, "db", Some(&profile_id), &msg, None);
        msg
    })?;

    let ddl = row
        .map(|row| first_available_string(&row, &[1, 0]))
        .unwrap_or_default();
    log_query_result(&log_state, &profile_id, &query, usize::from(!ddl.is_empty()));
    Ok(ddl)
}

#[tauri::command]
pub async fn db_drop_view(
    state: State<'_, DbState>,
    log_state: tauri::State<'_, LogState>,
    profile_id: String,
    database: String,
    view_name: String,
) -> AppResult<()> {
    let pool = get_pool(&state, &profile_id)?;
    let mut conn = pool.get_conn().await.map_err(|e| {
        let msg = format!("Connection error: {}", e);
        log_error(&log_state, "db", Some(&profile_id), &msg, None);
        msg
    })?;

    if !database.is_empty() {
        conn.query_drop(format!("USE {}", escape_ident(&database)))
            .await
            .map_err(|e| {
                let msg = format!("Failed to select database {}: {}", database, e);
                log_error(&log_state, "db", Some(&profile_id), &msg, None);
                msg
            })?;
    }

    let query = format!("DROP VIEW IF EXISTS {}", escape_ident(&view_name));
    conn.query_drop(&query).await.map_err(|e| {
        let msg = format!("Failed to drop view {}: {}", view_name, e);
        log_error(&log_state, "db", Some(&profile_id), &msg, None);
        msg
    })?;
    log_query_result(&log_state, &profile_id, &query, 0);
    Ok(())
}

#[tauri::command]
pub async fn db_create_or_replace_view(
    state: State<'_, DbState>,
    log_state: tauri::State<'_, LogState>,
    profile_id: String,
    database: String,
    sql: String,
) -> AppResult<()> {
    let pool = get_pool(&state, &profile_id)?;
    let mut conn = pool.get_conn().await.map_err(|e| {
        let msg = format!("Connection error: {}", e);
        log_error(&log_state, "db", Some(&profile_id), &msg, None);
        msg
    })?;

    if !database.is_empty() {
        conn.query_drop(format!("USE {}", escape_ident(&database)))
            .await
            .map_err(|e| {
                let msg = format!("Failed to select database {}: {}", database, e);
                log_error(&log_state, "db", Some(&profile_id), &msg, None);
                msg
            })?;
    }

    conn.query_drop(&sql).await.map_err(|e| {
        let msg = format!("Failed to create or replace view: {}", e);
        log_error(&log_state, "db", Some(&profile_id), &msg, None);
        msg
    })?;
    log_query(&log_state, &profile_id, &sql, None);
    Ok(())
}

#[tauri::command]
pub async fn db_list_events(
    state: State<'_, DbState>,
    log_state: tauri::State<'_, LogState>,
    profile_id: String,
    database: String,
) -> AppResult<Vec<EventInfo>> {
    let pool = get_pool(&state, &profile_id)?;
    let mut conn = pool.get_conn().await.map_err(|e| {
        let msg = format!("Connection error: {}", e);
        log_error(&log_state, "db", Some(&profile_id), &msg, None);
        msg
    })?;

    let query = r#"
        SELECT EVENT_NAME, STATUS, CONCAT(INTERVAL_VALUE, ' ', INTERVAL_FIELD), EVENT_DEFINITION
        FROM information_schema.EVENTS
        WHERE EVENT_SCHEMA = :db
        ORDER BY EVENT_NAME
    "#;

    let rows: Vec<(String, Option<String>, Option<String>, Option<String>)> = conn
        .exec(query, params! { "db" => database.clone() })
        .await
        .map_err(|e| {
            let msg = format!("Failed to load events for {}: {}", database, e);
            log_error(&log_state, "db", Some(&profile_id), &msg, None);
            msg
        })?;

    log_query_result(&log_state, &profile_id, query, rows.len());
    Ok(rows
        .into_iter()
        .map(|(name, status, schedule, event_definition)| EventInfo {
            name,
            status,
            schedule,
            event_definition,
        })
        .collect())
}

#[tauri::command]
pub async fn db_get_event_ddl(
    state: State<'_, DbState>,
    log_state: tauri::State<'_, LogState>,
    profile_id: String,
    database: String,
    event_name: String,
) -> AppResult<String> {
    let pool = get_pool(&state, &profile_id)?;
    let mut conn = pool.get_conn().await.map_err(|e| {
        let msg = format!("Connection error: {}", e);
        log_error(&log_state, "db", Some(&profile_id), &msg, None);
        msg
    })?;

    if !database.is_empty() {
        conn.query_drop(format!("USE {}", escape_ident(&database)))
            .await
            .map_err(|e| {
                let msg = format!("Failed to select database {}: {}", database, e);
                log_error(&log_state, "db", Some(&profile_id), &msg, None);
                msg
            })?;
    }

    let query = format!("SHOW CREATE EVENT {}", escape_ident(&event_name));
    let row = conn.query_first::<mysql_async::Row, _>(&query).await.map_err(|e| {
        let msg = format!("Failed to load event DDL for {}: {}", event_name, e);
        log_error(&log_state, "db", Some(&profile_id), &msg, None);
        msg
    })?;

    let ddl = row
        .map(|row| first_available_string(&row, &[3, 2, 1]))
        .unwrap_or_default();
    log_query_result(&log_state, &profile_id, &query, usize::from(!ddl.is_empty()));
    Ok(ddl)
}

#[tauri::command]
pub async fn db_drop_event(
    state: State<'_, DbState>,
    log_state: tauri::State<'_, LogState>,
    profile_id: String,
    database: String,
    event_name: String,
) -> AppResult<()> {
    let pool = get_pool(&state, &profile_id)?;
    let mut conn = pool.get_conn().await.map_err(|e| {
        let msg = format!("Connection error: {}", e);
        log_error(&log_state, "db", Some(&profile_id), &msg, None);
        msg
    })?;

    if !database.is_empty() {
        conn.query_drop(format!("USE {}", escape_ident(&database)))
            .await
            .map_err(|e| {
                let msg = format!("Failed to select database {}: {}", database, e);
                log_error(&log_state, "db", Some(&profile_id), &msg, None);
                msg
            })?;
    }

    let query = format!("DROP EVENT IF EXISTS {}", escape_ident(&event_name));
    conn.query_drop(&query).await.map_err(|e| {
        let msg = format!("Failed to drop event {}: {}", event_name, e);
        log_error(&log_state, "db", Some(&profile_id), &msg, None);
        msg
    })?;
    log_query_result(&log_state, &profile_id, &query, 0);
    Ok(())
}

#[tauri::command]
pub async fn db_create_event(
    state: State<'_, DbState>,
    log_state: tauri::State<'_, LogState>,
    profile_id: String,
    database: String,
    sql: String,
) -> AppResult<()> {
    let pool = get_pool(&state, &profile_id)?;
    let mut conn = pool.get_conn().await.map_err(|e| {
        let msg = format!("Connection error: {}", e);
        log_error(&log_state, "db", Some(&profile_id), &msg, None);
        msg
    })?;

    if !database.is_empty() {
        conn.query_drop(format!("USE {}", escape_ident(&database)))
            .await
            .map_err(|e| {
                let msg = format!("Failed to select database {}: {}", database, e);
                log_error(&log_state, "db", Some(&profile_id), &msg, None);
                msg
            })?;
    }

    conn.query_drop(&sql).await.map_err(|e| {
        let msg = format!("Failed to create event: {}", e);
        log_error(&log_state, "db", Some(&profile_id), &msg, None);
        msg
    })?;
    log_query(&log_state, &profile_id, &sql, None);
    Ok(())
}

#[tauri::command]
pub async fn db_list_users(
    state: State<'_, DbState>,
    log_state: tauri::State<'_, LogState>,
    profile_id: String,
) -> AppResult<Vec<UserInfo>> {
    let pool = get_pool(&state, &profile_id)?;
    let mut conn = pool.get_conn().await.map_err(|e| {
        let msg = format!("Connection error: {}", e);
        log_error(&log_state, "db", Some(&profile_id), &msg, None);
        msg
    })?;

    let query = "SELECT User, Host, plugin, account_locked FROM mysql.user ORDER BY User, Host";
    let rows: Vec<(String, String, Option<String>, Option<String>)> = conn.query(query).await.map_err(|e| {
        let msg = format!("Failed to load users: {}", e);
        log_error(&log_state, "db", Some(&profile_id), &msg, None);
        msg
    })?;

    log_query_result(&log_state, &profile_id, query, rows.len());
    Ok(rows
        .into_iter()
        .map(|(user, host, plugin, account_locked)| UserInfo {
            user,
            host,
            plugin,
            account_locked,
        })
        .collect())
}

#[tauri::command]
pub async fn db_get_user_grants(
    state: State<'_, DbState>,
    log_state: tauri::State<'_, LogState>,
    profile_id: String,
    user: String,
    host: String,
) -> AppResult<Vec<String>> {
    let pool = get_pool(&state, &profile_id)?;
    let mut conn = pool.get_conn().await.map_err(|e| {
        let msg = format!("Connection error: {}", e);
        log_error(&log_state, "db", Some(&profile_id), &msg, None);
        msg
    })?;

    let query = format!("SHOW GRANTS FOR '{}'@'{}'", escape_sql_str(&user), escape_sql_str(&host));
    let rows: Vec<String> = conn.query(&query).await.map_err(|e| {
        let msg = format!("Failed to load grants for {}@{}: {}", user, host, e);
        log_error(&log_state, "db", Some(&profile_id), &msg, None);
        msg
    })?;

    log_query_result(&log_state, &profile_id, &query, rows.len());
    Ok(rows)
}

#[tauri::command]
pub async fn db_create_user(
    state: State<'_, DbState>,
    log_state: tauri::State<'_, LogState>,
    profile_id: String,
    user: String,
    host: String,
    password: String,
) -> AppResult<()> {
    let pool = get_pool(&state, &profile_id)?;
    let mut conn = pool.get_conn().await.map_err(|e| {
        let msg = format!("Connection error: {}", e);
        log_error(&log_state, "db", Some(&profile_id), &msg, None);
        msg
    })?;

    let query = format!(
        "CREATE USER IF NOT EXISTS '{}'@'{}' IDENTIFIED BY ?",
        escape_sql_str(&user),
        escape_sql_str(&host)
    );
    conn.exec_drop(&query, (password,)).await.map_err(|e| {
        let msg = format!("Failed to create user {}@{}: {}", user, host, e);
        log_error(&log_state, "db", Some(&profile_id), &msg, None);
        msg
    })?;

    log_query(&log_state, &profile_id, &query, None);
    Ok(())
}

#[tauri::command]
pub async fn db_drop_user(
    state: State<'_, DbState>,
    log_state: tauri::State<'_, LogState>,
    profile_id: String,
    user: String,
    host: String,
) -> AppResult<()> {
    let pool = get_pool(&state, &profile_id)?;
    let mut conn = pool.get_conn().await.map_err(|e| {
        let msg = format!("Connection error: {}", e);
        log_error(&log_state, "db", Some(&profile_id), &msg, None);
        msg
    })?;

    let query = format!(
        "DROP USER IF EXISTS '{}'@'{}'",
        escape_sql_str(&user),
        escape_sql_str(&host)
    );
    conn.query_drop(&query).await.map_err(|e| {
        let msg = format!("Failed to drop user {}@{}: {}", user, host, e);
        log_error(&log_state, "db", Some(&profile_id), &msg, None);
        msg
    })?;

    log_query(&log_state, &profile_id, &query, None);
    Ok(())
}

#[tauri::command]
pub async fn db_grant(
    state: State<'_, DbState>,
    log_state: tauri::State<'_, LogState>,
    profile_id: String,
    privileges: String,
    on_what: String,
    user: String,
    host: String,
) -> AppResult<()> {
    let pool = get_pool(&state, &profile_id)?;
    let mut conn = pool.get_conn().await.map_err(|e| {
        let msg = format!("Connection error: {}", e);
        log_error(&log_state, "db", Some(&profile_id), &msg, None);
        msg
    })?;

    let query = format!(
        "GRANT {} ON {} TO '{}'@'{}'",
        privileges,
        on_what,
        escape_sql_str(&user),
        escape_sql_str(&host)
    );
    conn.query_drop(&query).await.map_err(|e| {
        let msg = format!("Failed to grant privileges to {}@{}: {}", user, host, e);
        log_error(&log_state, "db", Some(&profile_id), &msg, None);
        msg
    })?;

    log_query(&log_state, &profile_id, &query, None);
    Ok(())
}

#[tauri::command]
pub async fn db_revoke(
    state: State<'_, DbState>,
    log_state: tauri::State<'_, LogState>,
    profile_id: String,
    privileges: String,
    on_what: String,
    user: String,
    host: String,
) -> AppResult<()> {
    let pool = get_pool(&state, &profile_id)?;
    let mut conn = pool.get_conn().await.map_err(|e| {
        let msg = format!("Connection error: {}", e);
        log_error(&log_state, "db", Some(&profile_id), &msg, None);
        msg
    })?;

    let query = format!(
        "REVOKE {} ON {} FROM '{}'@'{}'",
        privileges,
        on_what,
        escape_sql_str(&user),
        escape_sql_str(&host)
    );
    conn.query_drop(&query).await.map_err(|e| {
        let msg = format!("Failed to revoke privileges from {}@{}: {}", user, host, e);
        log_error(&log_state, "db", Some(&profile_id), &msg, None);
        msg
    })?;

    log_query(&log_state, &profile_id, &query, None);
    Ok(())
}

#[tauri::command]
pub async fn db_flush_privileges(
    state: State<'_, DbState>,
    log_state: tauri::State<'_, LogState>,
    profile_id: String,
) -> AppResult<()> {
    let pool = get_pool(&state, &profile_id)?;
    let mut conn = pool.get_conn().await.map_err(|e| {
        let msg = format!("Connection error: {}", e);
        log_error(&log_state, "db", Some(&profile_id), &msg, None);
        msg
    })?;

    let query = "FLUSH PRIVILEGES";
    conn.query_drop(query).await.map_err(|e| {
        let msg = format!("Failed to flush privileges: {}", e);
        log_error(&log_state, "db", Some(&profile_id), &msg, None);
        msg
    })?;

    log_query(&log_state, &profile_id, query, None);
    Ok(())
}

#[tauri::command]
pub async fn db_execute_query(
    state: State<'_, DbState>,
    log_state: tauri::State<'_, LogState>,
    profile_id: String,
    query: String,
    timeout_ms: Option<u64>,
) -> AppResult<()> {
    let pool = get_pool(&state, &profile_id)?;
    let mut conn = pool.get_conn().await.map_err(|e| {
        let msg = format!("Connection error: {}", e);
        log_error(&log_state, "db", Some(&profile_id), &msg, None);
        msg
    })?;

    log_query(&log_state, &profile_id, &query, None);
    run_query_with_timeout(&log_state, &profile_id, &query, timeout_ms, conn.query_drop(&query)).await?;

    Ok(())
}

#[tauri::command]
pub async fn db_get_collations(
    state: State<'_, DbState>,
    log_state: tauri::State<'_, LogState>,
    profile_id: String,
) -> AppResult<CollationResponse> {
    let pool = get_pool(&state, &profile_id)?;
    let mut conn = pool.get_conn().await.map_err(|e| {
        let msg = format!("Connection error: {}", e);
        log_error(&log_state, "db", Some(&profile_id), &msg, None);
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
    if let Ok(mut rows) = conn
        .query::<mysql_async::Row, _>("SHOW CHARACTER SET WHERE Charset = 'utf8mb4'")
        .await
    {
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

#[tauri::command]
pub async fn db_query(
    state: State<'_, DbState>,
    log_state: tauri::State<'_, LogState>,
    profile_id: String,
    query: String,
    timeout_ms: Option<u64>,
) -> AppResult<Vec<QueryResultSet>> {
    let pool = get_pool(&state, &profile_id)?;
    let mut conn = pool.get_conn().await.map_err(|e| {
        let msg = format!("Connection error: {}", e);
        log_error(&log_state, "db", Some(&profile_id), &msg, None);
        msg
    })?;

    // Split by semicolons while respecting quotes, backticks
    let statements = split_sql_statements(&query);

    let mut results = Vec::new();

    for stmt in &statements {
        log_query(&log_state, &profile_id, stmt, None);

        // Try as a query that returns rows
        match run_query_with_timeout(
            &log_state,
            &profile_id,
            stmt,
            timeout_ms,
            conn.query::<mysql_async::Row, _>(stmt.as_str()),
        )
        .await
        {
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
                                        Err(_) => serde_json::Value::String(format!(
                                            "[binary {} bytes]",
                                            b.len()
                                        )),
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
                                    serde_json::Value::String(format!(
                                        "{:04}-{:02}-{:02} {:02}:{:02}:{:02}",
                                        y, m, d, h, mi, s
                                    ))
                                }
                                mysql_async::Value::Time(neg, d, h, mi, s, _us) => {
                                    let sign = if *neg { "-" } else { "" };
                                    let total_hours = *d * 24 + u32::from(*h);
                                    serde_json::Value::String(format!(
                                        "{}{:02}:{:02}:{:02}",
                                        sign, total_hours, mi, s
                                    ))
                                }
                            };
                            vals.push(val);
                        }
                        result_rows.push(vals);
                    }

                    let count = result_rows.len();
                    log_query_result(&log_state, &profile_id, stmt, count);

                    results.push(QueryResultSet {
                        columns,
                        rows: result_rows,
                        affected_rows: count as u64,
                        info: format!("{} row(s) returned", count),
                    });
                }
            }
            Err(e) => return Err(e),
        }
    }

    Ok(results)
}


#[tauri::command]
pub async fn db_get_schema_ddl(
    state: State<'_, DbState>,
    profile_id: String,
    database: String,
) -> AppResult<String> {
    let pool = get_pool(&state, &profile_id)?;
    let mut conn = pool
        .get_conn()
        .await
        .map_err(|e| format!("Connection error: {}", e))?;

    // Switch to the target database
    conn.query_drop(format!("USE `{}`", database))
        .await
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

#[tauri::command]
pub async fn db_import_sql(
    app: AppHandle,
    state: State<'_, DbState>,
    log_state: tauri::State<'_, LogState>,
    profile_id: String,
    database: String,
    file_path: String,
    job_id: String,
) -> AppResult<ImportResult> {
    let started_at = Instant::now();
    let pool = get_pool(&state, &profile_id)?;
    let mut conn = pool
        .get_conn()
        .await
        .map_err(|e| format!("Connection error: {}", e))?;

    // Switch to target DB if provided
    if !database.is_empty() {
        conn.query_drop(format!("USE `{}`", database.replace("`", "``")))
            .await
            .map_err(|e| format!("USE database error: {}", e))?;
    }

    let sql_content = std::fs::read_to_string(&file_path)
        .map_err(|e| format!("Failed to read SQL file: {}", e))?;

    let stmts = split_sql_statements(&sql_content);
    let total = stmts.len();
    let mut executed = 0;

    emit_import_progress(
        &app,
        &ImportProgressEvent {
            job_id: job_id.clone(),
            kind: "sql".to_string(),
            phase: "started".to_string(),
            items_processed: 0,
            items_total: total,
            rows_processed: 0,
            rows_total: 0,
            percent: 0.0,
            message: format!("Executing {} SQL statement(s)...", total),
        },
    );

    for stmt in stmts {
        if let Err(e) = conn.query_drop(&stmt).await {
            let message = format!("Execution failed at statement {}: {}", executed + 1, e);
            log_error(
                &log_state,
                "db",
                Some(&profile_id),
                &format!("SQL execution error at stmt {}: {}", executed + 1, e),
                None,
            );
            emit_import_progress(
                &app,
                &ImportProgressEvent {
                    job_id: job_id.clone(),
                    kind: "sql".to_string(),
                    phase: "error".to_string(),
                    items_processed: executed,
                    items_total: total,
                    rows_processed: 0,
                    rows_total: 0,
                    percent: if total == 0 {
                        0.0
                    } else {
                        (executed as f64 / total as f64) * 100.0
                    },
                    message: message.clone(),
                },
            );
            return Err(AppError::database(message));
        }
        executed += 1;

        emit_import_progress(
            &app,
            &ImportProgressEvent {
                job_id: job_id.clone(),
                kind: "sql".to_string(),
                phase: "progress".to_string(),
                items_processed: executed,
                items_total: total,
                rows_processed: 0,
                rows_total: 0,
                percent: if total == 0 {
                    100.0
                } else {
                    (executed as f64 / total as f64) * 100.0
                },
                message: format!("Executed {}/{} SQL statement(s).", executed, total),
            },
        );
    }

    let elapsed_ms = started_at.elapsed().as_millis();
    let summary = format!(
        "Imported {} SQL statement(s) in {}ms.",
        executed, elapsed_ms
    );

    emit_import_progress(
        &app,
        &ImportProgressEvent {
            job_id: job_id.clone(),
            kind: "sql".to_string(),
            phase: "completed".to_string(),
            items_processed: executed,
            items_total: total,
            rows_processed: 0,
            rows_total: 0,
            percent: 100.0,
            message: summary.clone(),
        },
    );

    Ok(ImportResult {
        kind: "sql".to_string(),
        items_attempted: total,
        items_committed: executed,
        rows_attempted: 0,
        rows_committed: 0,
        rows_skipped: 0,
        elapsed_ms,
        errors: vec![],
        summary,
    })
}

#[tauri::command]
pub async fn db_import_csv(
    app: AppHandle,
    state: State<'_, DbState>,
    profile_id: String,
    database: String,
    table: String,
    file_path: String,
    job_id: String,
) -> AppResult<ImportResult> {
    let started_at = Instant::now();
    let pool = get_pool(&state, &profile_id)?;
    let mut conn = pool
        .get_conn()
        .await
        .map_err(|e| format!("Connection error: {}", e))?;

    if !database.is_empty() {
        conn.query_drop(format!("USE `{}`", database.replace("`", "``")))
            .await
            .map_err(|e| format!("USE database error: {}", e))?;
    }

    let mut rdr = csv::ReaderBuilder::new()
        .from_path(&file_path)
        .map_err(|e| format!("Failed to read CSV file: {}", e))?;

    let headers = rdr
        .headers()
        .map_err(|e| format!("Failed to read headers: {}", e))?
        .clone();
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
    let mut committed_rows = 0usize;

    emit_import_progress(
        &app,
        &ImportProgressEvent {
            job_id: job_id.clone(),
            kind: "csv".to_string(),
            phase: "started".to_string(),
            items_processed: 0,
            items_total: total_rows,
            rows_processed: 0,
            rows_total: total_rows,
            percent: 0.0,
            message: format!("Importing {} CSV row(s) into {}...", total_rows, table),
        },
    );

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
            let message = format!(
                "Batch insert failed at rows {}-{}: {}",
                chunk_start * batch_size + 1,
                chunk_start * batch_size + chunk.len(),
                e
            );
            emit_import_progress(
                &app,
                &ImportProgressEvent {
                    job_id: job_id.clone(),
                    kind: "csv".to_string(),
                    phase: "error".to_string(),
                    items_processed: committed_rows,
                    items_total: total_rows,
                    rows_processed: committed_rows,
                    rows_total: total_rows,
                    percent: if total_rows == 0 {
                        0.0
                    } else {
                        (committed_rows as f64 / total_rows as f64) * 100.0
                    },
                    message: message.clone(),
                },
            );
            message
        })?;
        committed_rows += chunk.len();

        emit_import_progress(
            &app,
            &ImportProgressEvent {
                job_id: job_id.clone(),
                kind: "csv".to_string(),
                phase: "progress".to_string(),
                items_processed: committed_rows,
                items_total: total_rows,
                rows_processed: committed_rows,
                rows_total: total_rows,
                percent: if total_rows == 0 {
                    100.0
                } else {
                    (committed_rows as f64 / total_rows as f64) * 100.0
                },
                message: format!("Imported {}/{} row(s).", committed_rows, total_rows),
            },
        );
    }

    tx.commit()
        .await
        .map_err(|e| format!("Failed to commit import transaction: {}", e))?;

    let elapsed_ms = started_at.elapsed().as_millis();
    let summary = format!(
        "Imported {} row(s) into {} in {}ms.",
        total_rows, table, elapsed_ms
    );

    emit_import_progress(
        &app,
        &ImportProgressEvent {
            job_id: job_id.clone(),
            kind: "csv".to_string(),
            phase: "completed".to_string(),
            items_processed: total_rows,
            items_total: total_rows,
            rows_processed: total_rows,
            rows_total: total_rows,
            percent: 100.0,
            message: summary.clone(),
        },
    );

    Ok(ImportResult {
        kind: "csv".to_string(),
        items_attempted: total_rows,
        items_committed: total_rows,
        rows_attempted: total_rows,
        rows_committed: total_rows,
        rows_skipped: 0,
        elapsed_ms,
        errors: vec![],
        summary,
    })
}

// ─── Export helpers ──────────────────────────────────────────────────

/// Escape a single value for CSV output (RFC 4180).
fn csv_escape(value: &str) -> String {
    if value.contains(',') || value.contains('"') || value.contains('\n') || value.contains('\r') {
        format!("\"{}\"", value.replace('"', "\"\""))
    } else {
        value.to_string()
    }
}

/// Escape an identifier for MySQL backtick quoting.
fn escape_ident(s: &str) -> String {
    format!("`{}`", s.replace('`', "``"))
}

/// Escape a string literal for SQL (single-quote, backslash).
fn escape_sql_str(s: &str) -> String {
    s.replace('\\', "\\\\").replace('\'', "\\'")
}

/// Convert a mysql_async::Value to a plain display string (no SQL quoting).
fn value_to_display(val: &mysql_async::Value) -> String {
    match val {
        mysql_async::Value::NULL => String::new(),
        mysql_async::Value::Bytes(b) => String::from_utf8_lossy(b).into_owned(),
        mysql_async::Value::Int(n) => n.to_string(),
        mysql_async::Value::UInt(n) => n.to_string(),
        mysql_async::Value::Float(f) => f.to_string(),
        mysql_async::Value::Double(d) => d.to_string(),
        mysql_async::Value::Date(y, m, d, h, mi, s, _) => {
            format!("{:04}-{:02}-{:02} {:02}:{:02}:{:02}", y, m, d, h, mi, s)
        }
        mysql_async::Value::Time(neg, days, h, mi, s, _) => {
            let sign = if *neg { "-" } else { "" };
            let total_h = days * 24 + (*h as u32);
            format!("{}{:02}:{:02}:{:02}", sign, total_h, mi, s)
        }
    }
}

/// Fetch column names from a table using an existing connection.
async fn fetch_col_names(conn: &mut mysql_async::Conn, table: &str) -> AppResult<Vec<String>> {
    let rows: Vec<mysql_async::Row> = conn
        .query(format!("SHOW COLUMNS FROM {}", escape_ident(table)))
        .await
        .map_err(|e| format!("SHOW COLUMNS error: {}", e))?;
    Ok(rows
        .iter()
        .map(|r| r.get::<String, _>(0).unwrap_or_default())
        .collect())
}

// ─── Export commands ─────────────────────────────────────────────────

#[tauri::command]
pub async fn db_export_table_csv(
    state: State<'_, DbState>,
    profile_id: String,
    database: String,
    table: String,
    file_path: String,
) -> AppResult<u64> {
    use std::io::Write;

    let pool = get_pool(&state, &profile_id)?;
    let mut conn = pool
        .get_conn()
        .await
        .map_err(|e| format!("Connection error: {}", e))?;
    conn.query_drop(format!("USE {}", escape_ident(&database)))
        .await
        .map_err(|e| format!("USE error: {}", e))?;

    let col_names = fetch_col_names(&mut conn, &table).await?;

    let rows: Vec<mysql_async::Row> = conn
        .query(format!("SELECT * FROM {}", escape_ident(&table)))
        .await
        .map_err(|e| format!("SELECT error: {}", e))?;

    let mut file =
        std::fs::File::create(&file_path).map_err(|e| format!("Cannot create file: {}", e))?;

    let header = col_names
        .iter()
        .map(|c| csv_escape(c))
        .collect::<Vec<_>>()
        .join(",");
    writeln!(file, "{}", header).map_err(|e| format!("Write error: {}", e))?;

    let row_count = rows.len() as u64;
    for row in &rows {
        let fields: Vec<String> = (0..col_names.len())
            .map(|i| csv_escape(&value_to_display(&row[i])))
            .collect();
        writeln!(file, "{}", fields.join(",")).map_err(|e| format!("Write error: {}", e))?;
    }

    Ok(row_count)
}

#[tauri::command]
pub async fn db_export_table_json(
    state: State<'_, DbState>,
    profile_id: String,
    database: String,
    table: String,
    file_path: String,
) -> AppResult<u64> {
    use std::io::Write;

    let pool = get_pool(&state, &profile_id)?;
    let mut conn = pool
        .get_conn()
        .await
        .map_err(|e| format!("Connection error: {}", e))?;
    conn.query_drop(format!("USE {}", escape_ident(&database)))
        .await
        .map_err(|e| format!("USE error: {}", e))?;

    let col_names = fetch_col_names(&mut conn, &table).await?;

    let rows: Vec<mysql_async::Row> = conn
        .query(format!("SELECT * FROM {}", escape_ident(&table)))
        .await
        .map_err(|e| format!("SELECT error: {}", e))?;

    let row_count = rows.len() as u64;
    let mut objects: Vec<String> = Vec::with_capacity(rows.len());

    for row in &rows {
        let pairs: Vec<String> = col_names
            .iter()
            .enumerate()
            .map(|(i, col)| {
                let json_val = match &row[i] {
                    mysql_async::Value::NULL => "null".to_string(),
                    mysql_async::Value::Int(n) => n.to_string(),
                    mysql_async::Value::UInt(n) => n.to_string(),
                    mysql_async::Value::Float(f) => f.to_string(),
                    mysql_async::Value::Double(d) => d.to_string(),
                    v => {
                        let s = value_to_display(v)
                            .replace('\\', "\\\\")
                            .replace('"', "\\\"")
                            .replace('\n', "\\n")
                            .replace('\r', "\\r");
                        format!("\"{}\"", s)
                    }
                };
                format!("\"{}\":{}", col.replace('"', "\\\""), json_val)
            })
            .collect();
        objects.push(format!("{{{}}}", pairs.join(",")));
    }

    let json = format!("[{}]", objects.join(",\n"));
    let mut file =
        std::fs::File::create(&file_path).map_err(|e| format!("Cannot create file: {}", e))?;
    file.write_all(json.as_bytes())
        .map_err(|e| format!("Write error: {}", e))?;

    Ok(row_count)
}

#[tauri::command]
pub async fn db_export_table_inserts(
    state: State<'_, DbState>,
    profile_id: String,
    database: String,
    table: String,
    file_path: String,
) -> AppResult<u64> {
    use std::io::Write;

    let pool = get_pool(&state, &profile_id)?;
    let mut conn = pool
        .get_conn()
        .await
        .map_err(|e| format!("Connection error: {}", e))?;
    conn.query_drop(format!("USE {}", escape_ident(&database)))
        .await
        .map_err(|e| format!("USE error: {}", e))?;

    let col_names = fetch_col_names(&mut conn, &table).await?;

    let rows: Vec<mysql_async::Row> = conn
        .query(format!("SELECT * FROM {}", escape_ident(&table)))
        .await
        .map_err(|e| format!("SELECT error: {}", e))?;

    let row_count = rows.len() as u64;
    let col_list = col_names
        .iter()
        .map(|c| escape_ident(c))
        .collect::<Vec<_>>()
        .join(", ");
    let prefix = format!("INSERT INTO {} ({}) VALUES", escape_ident(&table), col_list);

    let mut file =
        std::fs::File::create(&file_path).map_err(|e| format!("Cannot create file: {}", e))?;

    writeln!(file, "-- SQL INSERT export for `{}`.`{}`", database, table)
        .map_err(|e| format!("Write error: {}", e))?;
    writeln!(file, "-- Generated by WorkGrid Studio\n")
        .map_err(|e| format!("Write error: {}", e))?;

    for row in &rows {
        let values: Vec<String> = (0..col_names.len())
            .map(|i| match &row[i] {
                mysql_async::Value::NULL => "NULL".to_string(),
                mysql_async::Value::Int(n) => n.to_string(),
                mysql_async::Value::UInt(n) => n.to_string(),
                mysql_async::Value::Float(f) => f.to_string(),
                mysql_async::Value::Double(d) => d.to_string(),
                v => format!("'{}'", escape_sql_str(&value_to_display(v))),
            })
            .collect();
        writeln!(file, "{} ({});", prefix, values.join(", "))
            .map_err(|e| format!("Write error: {}", e))?;
    }

    Ok(row_count)
}

#[tauri::command]
pub async fn db_export_sql_dump(
    state: State<'_, DbState>,
    profile_id: String,
    database: String,
    file_path: String,
) -> AppResult<u64> {
    use std::io::Write;

    // Reuse the existing DDL logic, then write to file
    let ddl = {
        let pool = get_pool(&state, &profile_id)?;
        let mut conn = pool
            .get_conn()
            .await
            .map_err(|e| format!("Connection error: {}", e))?;
        conn.query_drop(format!("USE {}", escape_ident(&database)))
            .await
            .map_err(|e| format!("USE error: {}", e))?;

        let mut parts: Vec<String> = vec![
            format!("-- SQL dump for `{}`", database),
            format!("-- Generated by WorkGrid Studio"),
            format!("-- "),
            format!("SET FOREIGN_KEY_CHECKS=0;"),
            String::new(),
        ];

        let tables: Vec<String> = conn.query("SHOW TABLES").await.unwrap_or_default();
        for table in &tables {
            if let Ok(Some(row)) = conn
                .query_first::<mysql_async::Row, _>(format!(
                    "SHOW CREATE TABLE {}",
                    escape_ident(table)
                ))
                .await
            {
                let create_sql: String = row.get(1).unwrap_or_default();
                parts.push(format!("DROP TABLE IF EXISTS {};", escape_ident(table)));
                parts.push(format!("{};", create_sql));
                parts.push(String::new());
            }
        }

        parts.push("SET FOREIGN_KEY_CHECKS=1;".to_string());
        parts.join("\n")
    };

    let bytes = ddl.as_bytes();
    let mut file =
        std::fs::File::create(&file_path).map_err(|e| format!("Cannot create file: {}", e))?;
    file.write_all(bytes)
        .map_err(|e| format!("Write error: {}", e))?;

    Ok(bytes.len() as u64)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn split_single_statement() {
        let sql = "SELECT 1;";
        assert_eq!(split_sql_statements(sql), vec!["SELECT 1"]);
    }

    #[test]
    fn split_multiple_statements() {
        let sql = "SELECT 1; SELECT 2; SELECT 3;";
        assert_eq!(
            split_sql_statements(sql),
            vec!["SELECT 1", "SELECT 2", "SELECT 3"]
        );
    }

    #[test]
    fn split_semicolon_inside_string() {
        let sql = "INSERT INTO t VALUES ('a;b'); SELECT 1;";
        let result = split_sql_statements(sql);
        assert_eq!(result.len(), 2);
        assert_eq!(result[0], "INSERT INTO t VALUES ('a;b')");
        assert_eq!(result[1], "SELECT 1");
    }

    #[test]
    fn split_semicolon_inside_backtick() {
        let sql = "SELECT `col;name` FROM t;";
        let result = split_sql_statements(sql);
        assert_eq!(result, vec!["SELECT `col;name` FROM t"]);
    }

    #[test]
    fn split_empty_input() {
        assert!(split_sql_statements("").is_empty());
        assert!(split_sql_statements("   ").is_empty());
    }

    #[test]
    fn split_no_trailing_semicolon() {
        let sql = "SELECT 1";
        assert_eq!(split_sql_statements(sql), vec!["SELECT 1"]);
    }
}
