use crate::db::{ColumnInfo, ConnectParams, QueryResultSet};
use crate::logging::{log_info, log_query, log_query_result, LogState};
use crate::{AppError, AppResult, DbState};
use rusqlite::{types::ValueRef, Connection as SqliteConnection};
use serde_json::Value as JsonValue;
use std::sync::{Arc, Mutex};
use tauri::State;

fn escape_sql_str(value: &str) -> String {
    value.replace('\'', "''")
}

fn value_ref_to_json(value: ValueRef<'_>) -> JsonValue {
    match value {
        ValueRef::Null => JsonValue::Null,
        ValueRef::Integer(value) => JsonValue::Number(value.into()),
        ValueRef::Real(value) => serde_json::Number::from_f64(value)
            .map(JsonValue::Number)
            .unwrap_or(JsonValue::Null),
        ValueRef::Text(value) => JsonValue::String(String::from_utf8_lossy(value).into_owned()),
        ValueRef::Blob(value) => JsonValue::String(format!("[binary {} bytes]", value.len())),
    }
}

async fn with_connection<T, F>(
    state: &State<'_, DbState>,
    profile_id: &str,
    f: F,
) -> AppResult<T>
where
    T: Send + 'static,
    F: FnOnce(&SqliteConnection) -> AppResult<T> + Send + 'static,
{
    let connection = {
        let pools = state.sqlite_pools.lock().map_err(|e| e.to_string())?;
        pools
            .get(profile_id)
            .cloned()
            .ok_or_else(|| AppError::from("Not connected. Please connect first."))?
    };

    tauri::async_runtime::spawn_blocking(move || {
        let guard = connection
            .lock()
            .map_err(|e| AppError::state(format!("SQLite lock error: {}", e)))?;
        f(&guard)
    })
    .await
    .map_err(|e| AppError::external(format!("SQLite task join error: {}", e)))?
}

#[tauri::command]
pub async fn sqlite_connect(
    state: State<'_, DbState>,
    log_state: tauri::State<'_, LogState>,
    params: ConnectParams,
) -> AppResult<String> {
    let file_path = params
        .file_path
        .as_deref()
        .filter(|value| !value.is_empty())
        .ok_or_else(|| AppError::validation("SQLite file path is required."))?
        .to_string();
    let profile_id = params.profile_id.clone();
    let opened_path = file_path.clone();
    let connection = tauri::async_runtime::spawn_blocking(move || -> AppResult<SqliteConnection> {
        let connection = SqliteConnection::open(&opened_path)
            .map_err(|e| AppError::database(format!("SQLite open failed: {}", e)))?;
        connection
            .query_row("SELECT 1", [], |_| Ok(()))
            .map_err(|e| AppError::database(format!("SQLite test query failed: {}", e)))?;
        Ok(connection)
    })
    .await
    .map_err(|e| AppError::external(format!("SQLite task join error: {}", e)))??;

    let mut pools = state.sqlite_pools.lock().map_err(|e| e.to_string())?;
    pools.insert(profile_id.clone(), Arc::new(Mutex::new(connection)));
    log_info(
        &log_state,
        "sqlite",
        Some(&profile_id),
        &format!("Connected to SQLite file {}.", file_path),
    );
    Ok(format!("Connected to SQLite file {}.", file_path))
}

#[tauri::command]
pub async fn sqlite_disconnect(
    state: State<'_, DbState>,
    log_state: tauri::State<'_, LogState>,
    profile_id: String,
) -> AppResult<String> {
    let removed = {
        let mut pools = state.sqlite_pools.lock().map_err(|e| e.to_string())?;
        pools.remove(&profile_id)
    };

    if removed.is_some() {
        log_info(&log_state, "sqlite", Some(&profile_id), "Disconnected");
    }
    Ok("Disconnected".to_string())
}

#[tauri::command]
pub async fn sqlite_list_databases(
    state: State<'_, DbState>,
    log_state: tauri::State<'_, LogState>,
    profile_id: String,
) -> AppResult<Vec<String>> {
    let rows = with_connection(&state, &profile_id, |conn| {
        let mut stmt = conn
            .prepare("PRAGMA database_list")
            .map_err(|e| AppError::database(format!("SQLite query failed: {}", e)))?;
        let mut entries = Vec::new();
        let mut mapped = stmt
            .query([])
            .map_err(|e| AppError::database(format!("SQLite query failed: {}", e)))?;
        while let Some(row) = mapped
            .next()
            .map_err(|e| AppError::database(format!("SQLite query failed: {}", e)))?
        {
            let name: String = row
                .get(1)
                .map_err(|e| AppError::database(format!("SQLite row read failed: {}", e)))?;
            entries.push(name);
        }
        Ok(entries)
    })
    .await?;
    let query = "PRAGMA database_list";
    log_query_result(&log_state, &profile_id, query, rows.len());
    Ok(rows)
}

#[tauri::command]
pub async fn sqlite_list_tables(
    state: State<'_, DbState>,
    log_state: tauri::State<'_, LogState>,
    profile_id: String,
    database: String,
) -> AppResult<Vec<String>> {
    let query = if database.is_empty() {
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name".to_string()
    } else {
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name".to_string()
    };
    let query_for_exec = query.clone();
    let rows = with_connection(&state, &profile_id, move |conn| {
        let mut stmt = conn
            .prepare(&query_for_exec)
            .map_err(|e| AppError::database(format!("SQLite query failed: {}", e)))?;
        let rows = stmt
            .query_map([], |row| row.get::<usize, String>(0))
            .map_err(|e| AppError::database(format!("SQLite query failed: {}", e)))?;
        let mut values = Vec::new();
        for row in rows {
            values.push(row.map_err(|e| AppError::database(format!("SQLite row read failed: {}", e)))?);
        }
        Ok(values)
    })
    .await?;
    log_query_result(&log_state, &profile_id, &query, rows.len());
    Ok(rows)
}

#[tauri::command]
pub async fn sqlite_list_columns(
    state: State<'_, DbState>,
    log_state: tauri::State<'_, LogState>,
    profile_id: String,
    database: String,
    table: String,
) -> AppResult<Vec<ColumnInfo>> {
    let query = format!("PRAGMA table_info('{}')", escape_sql_str(&table));
    let query_for_exec = query.clone();
    let rows = with_connection(&state, &profile_id, move |conn| {
        let mut stmt = conn
            .prepare(&query_for_exec)
            .map_err(|e| AppError::database(format!("SQLite query failed: {}", e)))?;
        let rows = stmt
            .query_map([], |row| {
                let notnull: i64 = row.get(3)?;
                let pk: i64 = row.get(5)?;
                let default_val: Option<String> = row.get(4)?;
                Ok(ColumnInfo {
                    name: row.get::<usize, String>(1)?,
                    col_type: row.get::<usize, String>(2)?,
                    nullable: notnull == 0,
                    key: if pk > 0 { "PRI".to_string() } else { String::new() },
                    default_val,
                    extra: if pk > 0 { "pk".to_string() } else { String::new() },
                })
            })
            .map_err(|e| AppError::database(format!("SQLite query failed: {}", e)))?;
        let mut values = Vec::new();
        for row in rows {
            values.push(row.map_err(|e| AppError::database(format!("SQLite row read failed: {}", e)))?);
        }
        Ok(values)
    })
    .await?;
    let _ = database;
    log_query_result(&log_state, &profile_id, &query, rows.len());
    Ok(rows)
}

#[tauri::command]
pub async fn sqlite_execute_query(
    state: State<'_, DbState>,
    log_state: tauri::State<'_, LogState>,
    profile_id: String,
    query: String,
) -> AppResult<()> {
    let query_for_exec = query.clone();
    with_connection(&state, &profile_id, move |conn| {
        conn.execute_batch(&query_for_exec)
            .map_err(|e| AppError::database(format!("SQLite query failed: {}", e)))?;
        Ok(())
    })
    .await?;
    log_query(&log_state, &profile_id, &query, None);
    Ok(())
}

#[tauri::command]
pub async fn sqlite_query(
    state: State<'_, DbState>,
    log_state: tauri::State<'_, LogState>,
    profile_id: String,
    query: String,
) -> AppResult<Vec<QueryResultSet>> {
    let query_for_exec = query.clone();
    let result = with_connection(&state, &profile_id, move |conn| {
        let mut statement = conn
            .prepare(&query_for_exec)
            .map_err(|e| AppError::database(format!("SQLite query failed: {}", e)))?;
        let columns = statement
            .column_names()
            .into_iter()
            .map(|name| name.to_string())
            .collect::<Vec<_>>();
        let mut rows = Vec::new();
        let mut mapped = statement
            .query([])
            .map_err(|e| AppError::database(format!("SQLite query failed: {}", e)))?;
        while let Some(row) = mapped
            .next()
            .map_err(|e| AppError::database(format!("SQLite query failed: {}", e)))?
        {
            let mut values = Vec::with_capacity(columns.len());
            for idx in 0..columns.len() {
                let value = row
                    .get_ref(idx)
                    .map_err(|e| AppError::database(format!("SQLite row read failed: {}", e)))?;
                values.push(value_ref_to_json(value));
            }
            rows.push(values);
        }

        Ok(vec![QueryResultSet {
            columns,
            rows,
            affected_rows: 0,
            info: "Query completed".to_string(),
        }])
    })
    .await?;
    log_query(&log_state, &profile_id, &query, None);
    log_query_result(&log_state, &profile_id, &query, result.first().map(|set| set.rows.len()).unwrap_or(0));
    Ok(result)
}
