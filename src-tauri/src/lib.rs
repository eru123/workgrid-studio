use mysql_async::prelude::*;
use mysql_async::{Opts, OptsBuilder, Pool};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::State;

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

// ─── DB State ───────────────────────────────────────────────────────

pub struct DbState {
    pools: Mutex<HashMap<String, Pool>>,
}

impl DbState {
    pub fn new() -> Self {
        Self {
            pools: Mutex::new(HashMap::new()),
        }
    }
}

// ─── DB Commands ────────────────────────────────────────────────────

#[tauri::command]
async fn db_connect(
    state: State<'_, DbState>,
    params: ConnectParams,
) -> Result<String, String> {
    let pid = params.profile_id.clone();
    let target = format!("{}@{}:{}", params.user, params.host, params.port);
    log_info(&pid, &format!("Connecting to {} ...", target));

    let mut builder = OptsBuilder::default()
        .ip_or_hostname(params.host.clone())
        .tcp_port(params.port)
        .user(Some(params.user.clone()))
        .pass(Some(params.password.clone()));

    if let Some(ref db) = params.database {
        if !db.is_empty() {
            builder = builder.db_name(Some(db.clone()));
        }
    }

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

    let mut pools = state.pools.lock().map_err(|e| {
        let msg = format!("Lock error: {}", e);
        log_error(&profile_id, &msg);
        msg
    })?;

    if let Some(pool) = pools.remove(&profile_id) {
        let _ = pool.disconnect();
    }

    log_info(&profile_id, "Disconnected");
    Ok("Disconnected".to_string())
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
    let use_query = format!("USE `{}`", database);
    let query = "SHOW TABLES";

    let mut conn = pool.get_conn().await.map_err(|e| {
        let msg = format!("Connection error: {}", e);
        log_error(&profile_id, &msg);
        msg
    })?;

    conn.query_drop(&use_query).await.map_err(|e| {
        let msg = format!("Query error [{}]: {}", use_query, e);
        log_error(&profile_id, &msg);
        msg
    })?;
    log_query(&profile_id, &use_query);

    match conn.query::<String, _>(query).await {
        Ok(tables) => {
            log_query_result(&profile_id, &format!("SHOW TABLES FROM `{}`", database), tables.len());
            drop(conn);
            Ok(tables)
        }
        Err(e) => {
            let msg = format!("Query error [SHOW TABLES FROM `{}`]: {}", database, e);
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
    let escaped_value = value.replace('\\', "\\\\").replace('\'', "''");
    let query = format!("SET {} {} = '{}'", scope_str, name, escaped_value);

    conn.query_drop(&query).await.map_err(|e| {
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

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let _ = ensure_app_dirs();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(DbState::new())
        .invoke_handler(tauri::generate_handler![
            greet,
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
