use crate::db::{ColumnInfo, ConnectParams, DatabaseInfo, ProcessInfo, QueryResultSet, TableInfo};
use crate::logging::{log_info, log_query, log_query_result, LogState};
use crate::{AppError, AppResult, DbState};
use deadpool_postgres::{Config, ManagerConfig, RecyclingMethod, Runtime};
use serde_json::Value as JsonValue;
use std::time::Instant;
use tauri::State;
use tokio_postgres::{NoTls, SimpleQueryMessage};

fn escape_sql_str(value: &str) -> String {
    value.replace('\'', "''")
}

fn simple_value_to_json(value: Option<&str>) -> JsonValue {
    match value {
        None => JsonValue::Null,
        Some(text) => {
            if let Ok(value) = text.parse::<i64>() {
                JsonValue::Number(value.into())
            } else if let Ok(value) = text.parse::<f64>() {
                JsonValue::Number(
                    serde_json::Number::from_f64(value)
                        .unwrap_or_else(|| serde_json::Number::from(0)),
                )
            } else if matches!(text, "t" | "true") {
                JsonValue::Bool(true)
            } else if matches!(text, "f" | "false") {
                JsonValue::Bool(false)
            } else {
                JsonValue::String(text.to_string())
            }
        }
    }
}

fn simple_query_to_result_sets(messages: Vec<SimpleQueryMessage>) -> Vec<QueryResultSet> {
    let mut results = Vec::new();
    let mut columns: Vec<String> = Vec::new();
    let mut rows: Vec<Vec<JsonValue>> = Vec::new();

    for message in messages {
        match message {
            SimpleQueryMessage::RowDescription(description) => {
                columns = description
                    .iter()
                    .map(|column| column.name().to_string())
                    .collect();
            }
            SimpleQueryMessage::Row(row) => {
                if columns.is_empty() {
                    columns = row
                        .columns()
                        .iter()
                        .map(|column| column.name().to_string())
                        .collect();
                }
                rows.push(
                    (0..row.len())
                        .map(|idx| simple_value_to_json(row.get(idx)))
                        .collect(),
                );
            }
            SimpleQueryMessage::CommandComplete(count) => {
                results.push(QueryResultSet {
                    columns: columns.clone(),
                    rows: rows.clone(),
                    affected_rows: count,
                    info: if rows.is_empty() {
                        format!("{} row(s) affected", count)
                    } else {
                        format!("{} row(s)", rows.len())
                    },
                });
                columns.clear();
                rows.clear();
            }
            _ => {}
        }
    }

    if !columns.is_empty() || !rows.is_empty() {
        results.push(QueryResultSet {
            columns,
            rows,
            affected_rows: 0,
            info: "0 row(s) affected".to_string(),
        });
    }

    results
}

async fn get_client(
    state: &State<'_, DbState>,
    profile_id: &str,
) -> AppResult<deadpool_postgres::Client> {
    let pool = {
        let pools = state.pg_pools.lock().map_err(|e| e.to_string())?;
        pools
            .get(profile_id)
            .cloned()
            .ok_or_else(|| AppError::from("Not connected. Please connect first."))?
    };

    pool.get()
        .await
        .map_err(|e| AppError::database(format!("PostgreSQL connection error: {}", e)))
}

fn split_database_info_row(row: &tokio_postgres::Row) -> DatabaseInfo {
    let size_bytes = row.get::<usize, i64>(1);
    let tables = row.get::<usize, i64>(2);
    let views = row.get::<usize, i64>(3);
    DatabaseInfo {
        name: row.get::<usize, String>(0),
        size_bytes,
        tables,
        views,
        default_collation: row.get::<usize, String>(4),
        last_modified: row.get::<usize, Option<String>>(5),
    }
}

fn split_table_info_row(row: &tokio_postgres::Row) -> TableInfo {
    TableInfo {
        name: row.get::<usize, String>(0),
        rows: row.get::<usize, Option<i64>>(1),
        size_bytes: row.get::<usize, Option<i64>>(2),
        created: row.get::<usize, Option<String>>(3),
        updated: row.get::<usize, Option<String>>(4),
        engine: row.get::<usize, Option<String>>(5),
        comment: row.get::<usize, Option<String>>(6),
        type_: row.get::<usize, String>(7),
    }
}

fn split_process_row(row: &tokio_postgres::Row) -> ProcessInfo {
    ProcessInfo {
        id: row.get::<usize, i64>(0).max(0) as u64,
        user: row.get::<usize, Option<String>>(1),
        host: row.get::<usize, Option<String>>(2),
        db: row.get::<usize, Option<String>>(3),
        command: row.get::<usize, Option<String>>(4),
        time: row.get::<usize, Option<i64>>(5),
        state: row.get::<usize, Option<String>>(6),
        info: row.get::<usize, Option<String>>(7),
    }
}

#[tauri::command]
pub async fn pg_connect(
    state: State<'_, DbState>,
    log_state: tauri::State<'_, LogState>,
    params: ConnectParams,
) -> AppResult<String> {
    let started = Instant::now();
    let mut cfg = Config::new();
    cfg.host = Some(params.host.clone());
    cfg.port = Some(params.port);
    cfg.user = Some(params.user.clone());
    cfg.password = Some(params.password.clone());
    if let Some(database) = params.database.as_deref().filter(|value| !value.is_empty()) {
        cfg.dbname = Some(database.to_string());
    }
    cfg.manager = Some(ManagerConfig {
        recycling_method: RecyclingMethod::Fast,
    });

    let pool = cfg
        .create_pool(Some(Runtime::Tokio1), NoTls)
        .map_err(|e| AppError::database(format!("Failed to create PostgreSQL pool: {}", e)))?;

    let client = pool
        .get()
        .await
        .map_err(|e| AppError::database(format!("PostgreSQL connection error: {}", e)))?;
    client
        .simple_query("SELECT 1")
        .await
        .map_err(|e| AppError::database(format!("PostgreSQL test query failed: {}", e)))?;

    let mut pools = state.pg_pools.lock().map_err(|e| e.to_string())?;
    pools.insert(params.profile_id.clone(), pool);
    log_info(
        &log_state,
        "pg",
        Some(&params.profile_id),
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
pub async fn pg_disconnect(
    state: State<'_, DbState>,
    log_state: tauri::State<'_, LogState>,
    profile_id: String,
) -> AppResult<String> {
    let pool = {
        let mut pools = state.pg_pools.lock().map_err(|e| e.to_string())?;
        pools.remove(&profile_id)
    };
    if pool.is_some() {
        log_info(&log_state, "pg", Some(&profile_id), "Disconnected");
    }
    Ok("Disconnected".to_string())
}

#[tauri::command]
pub async fn pg_list_databases(
    state: State<'_, DbState>,
    log_state: tauri::State<'_, LogState>,
    profile_id: String,
) -> AppResult<Vec<String>> {
    let client = get_client(&state, &profile_id).await?;
    let query = "SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname";
    let rows = client
        .query(query, &[])
        .await
        .map_err(|e| AppError::database(format!("PostgreSQL query failed: {}", e)))?;
    log_query_result(&log_state, &profile_id, query, rows.len());
    Ok(rows
        .into_iter()
        .map(|row| row.get::<usize, String>(0))
        .collect())
}

#[tauri::command]
pub async fn pg_list_tables(
    state: State<'_, DbState>,
    log_state: tauri::State<'_, LogState>,
    profile_id: String,
    database: String,
) -> AppResult<Vec<String>> {
    let client = get_client(&state, &profile_id).await?;
    let query = format!(
        "SELECT table_name FROM information_schema.tables WHERE table_catalog = '{}' AND table_type = 'BASE TABLE' ORDER BY table_name",
        escape_sql_str(&database)
    );
    let rows = client
        .query(&query, &[])
        .await
        .map_err(|e| AppError::database(format!("PostgreSQL query failed: {}", e)))?;
    log_query_result(&log_state, &profile_id, &query, rows.len());
    Ok(rows
        .into_iter()
        .map(|row| row.get::<usize, String>(0))
        .collect())
}

#[tauri::command]
pub async fn pg_list_columns(
    state: State<'_, DbState>,
    log_state: tauri::State<'_, LogState>,
    profile_id: String,
    database: String,
    table: String,
) -> AppResult<Vec<ColumnInfo>> {
    let client = get_client(&state, &profile_id).await?;
    let query = format!(
        "SELECT column_name, data_type, is_nullable, COALESCE(column_default, ''), CASE WHEN is_identity = 'YES' THEN 'identity' ELSE '' END, '' FROM information_schema.columns WHERE table_catalog = '{}' AND table_name = '{}' ORDER BY ordinal_position",
        escape_sql_str(&database),
        escape_sql_str(&table)
    );
    let rows = client
        .query(&query, &[])
        .await
        .map_err(|e| AppError::database(format!("PostgreSQL query failed: {}", e)))?;
    log_query_result(&log_state, &profile_id, &query, rows.len());
    Ok(rows
        .into_iter()
        .map(|row| ColumnInfo {
            name: row.get::<usize, String>(0),
            col_type: row.get::<usize, String>(1),
            nullable: row.get::<usize, String>(2).eq_ignore_ascii_case("yes"),
            key: String::new(),
            default_val: {
                let value: String = row.get(3);
                if value.is_empty() {
                    None
                } else {
                    Some(value)
                }
            },
            extra: row.get::<usize, String>(4),
        })
        .collect())
}

#[tauri::command]
pub async fn pg_get_databases_info(
    state: State<'_, DbState>,
    log_state: tauri::State<'_, LogState>,
    profile_id: String,
) -> AppResult<Vec<DatabaseInfo>> {
    let client = get_client(&state, &profile_id).await?;
    let query = r#"
        SELECT
            d.datname,
            COALESCE(pg_database_size(d.datname), 0)::bigint,
            COALESCE((SELECT count(*) FROM information_schema.tables t WHERE t.table_catalog = d.datname AND t.table_type = 'BASE TABLE'), 0)::bigint,
            COALESCE((SELECT count(*) FROM information_schema.views v WHERE v.table_catalog = d.datname), 0)::bigint,
            d.datcollate,
            NULL::text
        FROM pg_database d
        WHERE d.datistemplate = false
        ORDER BY d.datname
    "#;
    let rows = client
        .query(query, &[])
        .await
        .map_err(|e| AppError::database(format!("PostgreSQL query failed: {}", e)))?;
    log_query_result(&log_state, &profile_id, query, rows.len());
    Ok(rows
        .into_iter()
        .map(|row| split_database_info_row(&row))
        .collect())
}

#[tauri::command]
pub async fn pg_get_tables_info(
    state: State<'_, DbState>,
    log_state: tauri::State<'_, LogState>,
    profile_id: String,
    database: String,
) -> AppResult<Vec<TableInfo>> {
    let client = get_client(&state, &profile_id).await?;
    let query = format!(
        "SELECT c.relname, NULL::bigint, COALESCE(pg_total_relation_size(c.oid), 0)::bigint, NULL::text, NULL::text, CASE c.relkind WHEN 'v' THEN 'view' WHEN 'm' THEN 'materialized view' ELSE 'PostgreSQL' END, obj_description(c.oid, 'pg_class'), CASE c.relkind WHEN 'v' THEN 'VIEW' ELSE 'BASE TABLE' END FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = '{}' AND c.relkind IN ('r', 'v', 'm') ORDER BY c.relname",
        escape_sql_str(&database)
    );
    let rows = client
        .query(&query, &[])
        .await
        .map_err(|e| AppError::database(format!("PostgreSQL query failed: {}", e)))?;
    log_query_result(&log_state, &profile_id, &query, rows.len());
    Ok(rows
        .into_iter()
        .map(|row| split_table_info_row(&row))
        .collect())
}

#[tauri::command]
pub async fn pg_execute_query(
    state: State<'_, DbState>,
    log_state: tauri::State<'_, LogState>,
    profile_id: String,
    query: String,
) -> AppResult<()> {
    let client = get_client(&state, &profile_id).await?;
    log_query(&log_state, &profile_id, &query, None);
    client
        .simple_query(&query)
        .await
        .map_err(|e| AppError::database(format!("PostgreSQL query failed: {}", e)))?;
    Ok(())
}

#[tauri::command]
pub async fn pg_query(
    state: State<'_, DbState>,
    log_state: tauri::State<'_, LogState>,
    profile_id: String,
    query: String,
) -> AppResult<Vec<QueryResultSet>> {
    let client = get_client(&state, &profile_id).await?;
    let messages = client
        .simple_query(&query)
        .await
        .map_err(|e| AppError::database(format!("PostgreSQL query failed: {}", e)))?;
    log_query(&log_state, &profile_id, &query, None);
    Ok(simple_query_to_result_sets(messages))
}

#[tauri::command]
pub async fn pg_get_processes(
    state: State<'_, DbState>,
    log_state: tauri::State<'_, LogState>,
    profile_id: String,
) -> AppResult<Vec<ProcessInfo>> {
    let client = get_client(&state, &profile_id).await?;
    let query = r#"
        SELECT
            pid::bigint,
            usename,
            client_addr::text,
            datname,
            state,
            query,
            EXTRACT(EPOCH FROM COALESCE(now() - query_start, interval '0 second'))::bigint
        FROM pg_stat_activity
        WHERE pid <> pg_backend_pid()
        ORDER BY query_start DESC NULLS LAST
    "#;
    let rows = client
        .query(query, &[])
        .await
        .map_err(|e| AppError::database(format!("PostgreSQL query failed: {}", e)))?;
    log_query_result(&log_state, &profile_id, query, rows.len());
    Ok(rows
        .into_iter()
        .map(|row| split_process_row(&row))
        .collect())
}

#[tauri::command]
pub async fn pg_kill_process(
    state: State<'_, DbState>,
    log_state: tauri::State<'_, LogState>,
    profile_id: String,
    process_id: u64,
) -> AppResult<()> {
    let client = get_client(&state, &profile_id).await?;
    let query = format!("SELECT pg_terminate_backend({})", process_id);
    log_query(&log_state, &profile_id, &query, None);
    client
        .simple_query(&query)
        .await
        .map_err(|e| AppError::database(format!("PostgreSQL terminate failed: {}", e)))?;
    Ok(())
}
