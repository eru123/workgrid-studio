use crate::db::{ColumnInfo, ConnectParams, ProcessInfo, QueryResultSet};
use crate::logging::{log_info, log_query, log_query_result, LogState};
use crate::{AppError, AppResult, DbState};
use serde_json::Value as JsonValue;
use std::time::Instant;
use tauri::State;
use tiberius::{AuthMethod, Client, ColumnData, Config, EncryptionLevel, Row};
use tokio::net::TcpStream;
use tokio_util::compat::TokioAsyncWriteCompatExt;

type MssqlClient = Client<tokio_util::compat::Compat<TcpStream>>;

fn escape_sql_str(value: &str) -> String {
    value.replace('\'', "''")
}

fn json_string(value: impl ToString) -> JsonValue {
    JsonValue::String(value.to_string())
}

fn column_data_to_json(value: ColumnData<'_>) -> JsonValue {
    match value {
        ColumnData::U8(value) => value.map(|v| JsonValue::Number(v.into())).unwrap_or(JsonValue::Null),
        ColumnData::I16(value) => value.map(|v| JsonValue::Number(v.into())).unwrap_or(JsonValue::Null),
        ColumnData::I32(value) => value.map(|v| JsonValue::Number(v.into())).unwrap_or(JsonValue::Null),
        ColumnData::I64(value) => value.map(|v| JsonValue::Number(v.into())).unwrap_or(JsonValue::Null),
        ColumnData::F32(value) => value
            .and_then(|v| serde_json::Number::from_f64(v as f64))
            .map(JsonValue::Number)
            .unwrap_or(JsonValue::Null),
        ColumnData::F64(value) => value
            .and_then(|v| serde_json::Number::from_f64(v))
            .map(JsonValue::Number)
            .unwrap_or(JsonValue::Null),
        ColumnData::Bit(value) => value
            .map(|v| JsonValue::Number((if v { 1 } else { 0 }).into()))
            .unwrap_or(JsonValue::Null),
        ColumnData::String(value) => value.map(json_string).unwrap_or(JsonValue::Null),
        ColumnData::Guid(value) => value.map(json_string).unwrap_or(JsonValue::Null),
        ColumnData::Binary(value) => value
            .map(|bytes| JsonValue::String(format!("[binary {} bytes]", bytes.len())))
            .unwrap_or(JsonValue::Null),
        ColumnData::Numeric(value) => value.map(json_string).unwrap_or(JsonValue::Null),
        ColumnData::Xml(value) => value.map(json_string).unwrap_or(JsonValue::Null),
        ColumnData::DateTime(value) => value
            .map(|v| JsonValue::String(format!("{:?}", v)))
            .unwrap_or(JsonValue::Null),
        ColumnData::SmallDateTime(value) => value
            .map(|v| JsonValue::String(format!("{:?}", v)))
            .unwrap_or(JsonValue::Null),
        _ => JsonValue::Null,
    }
}

fn row_to_result_set(rows: Vec<Row>) -> QueryResultSet {
    let columns = rows
        .first()
        .map(|row| row.columns().iter().map(|column| column.name().to_string()).collect::<Vec<_>>())
        .unwrap_or_default();
    let converted_rows = rows
        .into_iter()
        .map(|row| row.into_iter().map(column_data_to_json).collect::<Vec<_>>())
        .collect::<Vec<_>>();

    QueryResultSet {
        columns,
        affected_rows: converted_rows.len() as u64,
        rows: converted_rows,
        info: "Query completed".to_string(),
    }
}

fn parse_connection_params(serialized: &str) -> AppResult<ConnectParams> {
    serde_json::from_str(serialized)
        .map_err(|e| AppError::serialization(format!("Invalid stored SQL Server connection data: {}", e)))
}

async fn get_params(state: &State<'_, DbState>, profile_id: &str) -> AppResult<ConnectParams> {
    let serialized = {
        let pools = state.mssql_pools.lock().map_err(|e| e.to_string())?;
        pools.get(profile_id).cloned().ok_or_else(|| AppError::from("Not connected. Please connect first."))?
    };
    parse_connection_params(&serialized)
}

async fn open_client(state: &State<'_, DbState>, profile_id: &str) -> AppResult<MssqlClient> {
    let params = get_params(state, profile_id).await?;
    let mut config = Config::new();
    config.host(&params.host);
    config.port(params.port);
    config.authentication(AuthMethod::sql_server(params.user.clone(), params.password.clone()));
    if let Some(database) = params.database.as_deref().filter(|value| !value.is_empty()) {
        config.database(database);
    }
    config.encryption(if params.ssl {
        EncryptionLevel::Required
    } else {
        EncryptionLevel::NotSupported
    });
    if params.ssl && !params.ssl_reject_unauthorized {
        config.trust_cert();
    }

    let tcp = TcpStream::connect(config.get_addr())
        .await
        .map_err(|e| AppError::database(format!("SQL Server connection failed: {}", e)))?;
    tcp.set_nodelay(true)
        .map_err(|e| AppError::database(format!("SQL Server socket configuration failed: {}", e)))?;

    Client::connect(config, tcp.compat_write())
        .await
        .map_err(|e| AppError::database(format!("SQL Server connection failed: {}", e)))
}

fn row_string(row: &Row, index: usize) -> String {
    row.try_get::<&str, _>(index)
        .ok()
        .flatten()
        .unwrap_or_default()
        .to_string()
}

fn row_opt_string(row: &Row, index: usize) -> Option<String> {
    row.try_get::<&str, _>(index)
        .ok()
        .flatten()
        .map(|value| value.to_string())
}

fn row_i64(row: &Row, index: usize) -> Option<i64> {
    row.try_get::<i64, _>(index).ok().flatten()
}

#[tauri::command]
pub async fn mssql_connect(
    state: State<'_, DbState>,
    log_state: tauri::State<'_, LogState>,
    params: ConnectParams,
) -> AppResult<String> {
    let started = Instant::now();
    let profile_id = params.profile_id.clone();
    let serialized = serde_json::to_string(&params)?;
    {
        let mut pools = state.mssql_pools.lock().map_err(|e| e.to_string())?;
        pools.insert(profile_id.clone(), serialized);
    }

    let _ = open_client(&state, &profile_id).await?;
    log_info(
        &log_state,
        "mssql",
        Some(&profile_id),
        &format!(
            "Connected to {}@{}:{} in {} ms",
            params.user,
            params.host,
            params.port,
            started.elapsed().as_millis()
        ),
    );
    Ok(format!(
        "Connected to {}@{}:{} in {} ms",
        params.user,
        params.host,
        params.port,
        started.elapsed().as_millis()
    ))
}

#[tauri::command]
pub async fn mssql_disconnect(
    state: State<'_, DbState>,
    log_state: tauri::State<'_, LogState>,
    profile_id: String,
) -> AppResult<String> {
    let removed = {
        let mut pools = state.mssql_pools.lock().map_err(|e| e.to_string())?;
        pools.remove(&profile_id)
    };
    if removed.is_some() {
        log_info(&log_state, "mssql", Some(&profile_id), "Disconnected");
    }
    Ok("Disconnected".to_string())
}

#[tauri::command]
pub async fn mssql_list_databases(
    state: State<'_, DbState>,
    log_state: tauri::State<'_, LogState>,
    profile_id: String,
) -> AppResult<Vec<String>> {
    let mut client = open_client(&state, &profile_id).await?;
    let query = "SELECT name FROM sys.databases WHERE state_desc = 'ONLINE' ORDER BY name";
    let rows = client
        .query(query, &[])
        .await
        .map_err(|e| AppError::database(format!("SQL Server query failed: {}", e)))?
        .into_first_result()
        .await
        .map_err(|e| AppError::database(format!("SQL Server query failed: {}", e)))?;
    log_query_result(&log_state, &profile_id, query, rows.len());
    Ok(rows.into_iter().map(|row| row_string(&row, 0)).collect())
}

#[tauri::command]
pub async fn mssql_list_tables(
    state: State<'_, DbState>,
    log_state: tauri::State<'_, LogState>,
    profile_id: String,
    database: String,
) -> AppResult<Vec<String>> {
    let mut client = open_client(&state, &profile_id).await?;
    let query = "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_CATALOG = @P1 AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME";
    let rows = client
        .query(query, &[&database])
        .await
        .map_err(|e| AppError::database(format!("SQL Server query failed: {}", e)))?
        .into_first_result()
        .await
        .map_err(|e| AppError::database(format!("SQL Server query failed: {}", e)))?;
    log_query_result(&log_state, &profile_id, query, rows.len());
    Ok(rows.into_iter().map(|row| row_string(&row, 0)).collect())
}

#[tauri::command]
pub async fn mssql_list_columns(
    state: State<'_, DbState>,
    log_state: tauri::State<'_, LogState>,
    profile_id: String,
    database: String,
    table: String,
) -> AppResult<Vec<ColumnInfo>> {
    let mut client = open_client(&state, &profile_id).await?;
    let query = "SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT, '' AS extra FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_CATALOG = @P1 AND TABLE_NAME = @P2 ORDER BY ORDINAL_POSITION";
    let rows = client
        .query(query, &[&database, &table])
        .await
        .map_err(|e| AppError::database(format!("SQL Server query failed: {}", e)))?
        .into_first_result()
        .await
        .map_err(|e| AppError::database(format!("SQL Server query failed: {}", e)))?;
    log_query_result(&log_state, &profile_id, query, rows.len());
    Ok(rows
        .into_iter()
        .map(|row| ColumnInfo {
            name: row_string(&row, 0),
            col_type: row_string(&row, 1),
            nullable: row_string(&row, 2).eq_ignore_ascii_case("yes"),
            key: String::new(),
            default_val: row_opt_string(&row, 3),
            extra: row_string(&row, 4),
        })
        .collect())
}

#[tauri::command]
pub async fn mssql_execute_query(
    state: State<'_, DbState>,
    log_state: tauri::State<'_, LogState>,
    profile_id: String,
    query: String,
) -> AppResult<()> {
    let mut client = open_client(&state, &profile_id).await?;
    log_query(&log_state, &profile_id, &query, None);
    client
        .execute(&query, &[])
        .await
        .map_err(|e| AppError::database(format!("SQL Server query failed: {}", e)))?;
    Ok(())
}

#[tauri::command]
pub async fn mssql_query(
    state: State<'_, DbState>,
    log_state: tauri::State<'_, LogState>,
    profile_id: String,
    query: String,
) -> AppResult<Vec<QueryResultSet>> {
    let mut client = open_client(&state, &profile_id).await?;
    let sets = client
        .query(&query, &[])
        .await
        .map_err(|e| AppError::database(format!("SQL Server query failed: {}", e)))?
        .into_results()
        .await
        .map_err(|e| AppError::database(format!("SQL Server query failed: {}", e)))?;
    log_query(&log_state, &profile_id, &query, None);
    Ok(sets.into_iter().map(row_to_result_set).collect())
}

#[tauri::command]
pub async fn mssql_get_processes(
    state: State<'_, DbState>,
    log_state: tauri::State<'_, LogState>,
    profile_id: String,
) -> AppResult<Vec<ProcessInfo>> {
    let mut client = open_client(&state, &profile_id).await?;
    let query = r#"
        SELECT
            s.session_id,
            s.login_name,
            s.host_name,
            DB_NAME(COALESCE(r.database_id, s.database_id)),
            COALESCE(r.command, s.program_name),
            COALESCE(r.total_elapsed_time / 1000, 0),
            s.status,
            NULL
        FROM sys.dm_exec_sessions s
        LEFT JOIN sys.dm_exec_requests r ON r.session_id = s.session_id
        WHERE s.session_id <> @@SPID
        ORDER BY s.session_id
    "#;
    let rows = client
        .query(query, &[])
        .await
        .map_err(|e| AppError::database(format!("SQL Server query failed: {}", e)))?
        .into_first_result()
        .await
        .map_err(|e| AppError::database(format!("SQL Server query failed: {}", e)))?;
    log_query_result(&log_state, &profile_id, query, rows.len());
    Ok(rows
        .into_iter()
        .map(|row| ProcessInfo {
            id: row_i64(&row, 0).unwrap_or_default().max(0) as u64,
            user: row_opt_string(&row, 1),
            host: row_opt_string(&row, 2),
            db: row_opt_string(&row, 3),
            command: row_opt_string(&row, 4),
            time: row_i64(&row, 5),
            state: row_opt_string(&row, 6),
            info: row_opt_string(&row, 7),
        })
        .collect())
}

#[tauri::command]
pub async fn mssql_kill_process(
    state: State<'_, DbState>,
    log_state: tauri::State<'_, LogState>,
    profile_id: String,
    process_id: u64,
) -> AppResult<()> {
    let mut client = open_client(&state, &profile_id).await?;
    let query = format!("KILL {}", process_id);
    log_query(&log_state, &profile_id, &query, None);
    client
        .execute(&query, &[])
        .await
        .map_err(|e| AppError::database(format!("SQL Server kill failed: {}", e)))?;
    Ok(())
}
