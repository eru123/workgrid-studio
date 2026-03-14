use tauri::State;
use mysql_async::prelude::*;
use mysql_async::{Opts, OptsBuilder, Pool, PoolOpts, PoolConstraints, TxOpts};
use serde::{Deserialize, Serialize};
use crate::{AppError, AppResult, DbState};
use crate::ssh::{establish_ssh_tunnel, shutdown_tunnel};
use crate::crypto::{encrypt_password, decrypt_password};
use crate::logging::{log_query, log_query_result, log_info, log_error};

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

pub fn default_true() -> bool { true }

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

/// Structured result returned by `db_import_csv`.
#[derive(Serialize)]
pub struct ImportResult {
    /// Total rows parsed from the CSV file.
    pub rows_attempted: usize,
    /// Rows actually committed to the database (equals `rows_attempted` on success).
    pub rows_committed: usize,
}

// ─── Helpers ────────────────────────────────────────────────────────

pub fn get_pool(state: &State<'_, DbState>, profile_id: &str) -> AppResult<Pool> {
    let pools = state.pools.lock().map_err(|e| format!("Lock error: {}", e))?;
    Ok(
        pools
            .get(profile_id)
            .cloned()
            .ok_or_else(|| {
                let msg = "Not connected. Please connect first.".to_string();
                log_error(profile_id, &msg);
                msg
            })?,
    )
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

// ─── DB Commands ────────────────────────────────────────────────────

#[tauri::command]
pub async fn db_connect(
    state: State<'_, DbState>,
    params: ConnectParams,
) -> AppResult<String> {
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
        return Err(AppError::validation(msg));
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
                    return Err(AppError::validation(msg));
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
                    return Err(AppError::validation(msg));
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
                    return Err(AppError::validation(msg));
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
            return Err(AppError::validation(msg));
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
            return Err(AppError::database(msg));
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
pub async fn db_disconnect(
    state: State<'_, DbState>,
    profile_id: String,
) -> AppResult<String> {
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
pub async fn db_ping(
    state: State<'_, DbState>,
    profile_id: String,
) -> AppResult<u128> {
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
    profile_id: String,
) -> AppResult<Vec<String>> {
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
            Err(AppError::database(msg))
        }
    }
}

#[tauri::command]
pub async fn db_list_tables(
    state: State<'_, DbState>,
    profile_id: String,
    database: String,
) -> AppResult<Vec<String>> {
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
            Err(AppError::database(msg))
        }
    }
}

#[tauri::command]
pub async fn db_list_columns(
    state: State<'_, DbState>,
    profile_id: String,
    database: String,
    table: String,
) -> AppResult<Vec<ColumnInfo>> {
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
            Err(AppError::database(msg))
        }
    }
}

#[tauri::command]
pub async fn db_get_databases_info(
    state: State<'_, DbState>,
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
            Err(AppError::database(msg))
        }
    }
}

#[tauri::command]
pub async fn db_get_tables_info(
    state: State<'_, DbState>,
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
            Err(AppError::database(msg))
        }
    }
}

#[tauri::command]
pub async fn db_get_variables(
    state: State<'_, DbState>,
    profile_id: String,
) -> AppResult<Vec<VariableInfo>> {
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
pub async fn db_set_variable(
    state: State<'_, DbState>,
    profile_id: String,
    scope: String,
    name: String,
    value: String,
) -> AppResult<()> {
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
        return Err(AppError::validation(msg));
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
pub async fn db_get_status(
    state: State<'_, DbState>,
    profile_id: String,
) -> AppResult<Vec<StatusInfo>> {
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
pub async fn db_get_processes(
    state: State<'_, DbState>,
    profile_id: String,
) -> AppResult<Vec<ProcessInfo>> {
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
pub async fn db_kill_process(
    state: State<'_, DbState>,
    profile_id: String,
    process_id: u64,
) -> AppResult<()> {
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
pub async fn db_execute_query(
    state: State<'_, DbState>,
    profile_id: String,
    query: String,
) -> AppResult<()> {
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

#[tauri::command]
pub async fn db_get_collations(
    state: State<'_, DbState>,
    profile_id: String,
) -> AppResult<CollationResponse> {
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

#[tauri::command]
pub async fn db_query(
    state: State<'_, DbState>,
    profile_id: String,
    query: String,
) -> AppResult<Vec<QueryResultSet>> {
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
                return Err(AppError::database(msg));
            }
        }
    }

    Ok(results)
}

// ─── Schema DDL for AI context ───────────────────────────────────────

#[tauri::command]
pub async fn db_get_schema_ddl(
    state: State<'_, DbState>,
    profile_id: String,
    database: String,
) -> AppResult<String> {
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

#[tauri::command]
pub async fn db_import_sql(
    state: State<'_, DbState>,
    profile_id: String,
    database: String,
    file_path: String,
) -> AppResult<String> {
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
            return Err(AppError::database(format!(
                "Execution failed at statement {}: {}",
                executed + 1,
                e
            )));
        }
        executed += 1;
    }

    Ok(format!("Successfully imported {} statements.", total))
}

#[tauri::command]
pub async fn db_import_csv(
    state: State<'_, DbState>,
    profile_id: String,
    database: String,
    table: String,
    file_path: String,
) -> AppResult<ImportResult> {
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
        assert_eq!(split_sql_statements(sql), vec!["SELECT 1", "SELECT 2", "SELECT 3"]);
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
