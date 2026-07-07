// Schema introspection commands. Each takes a sessionId (pinned connection).

use tauri::State;

use crate::models::{ColumnInfo, DatabaseInfo, TableInfo};
use crate::services::connection::ConnectionManager;
use crate::AppResult;

fn profile_of(session_id: &str) -> &str {
    session_id.split(':').next().unwrap_or("")
}

#[tauri::command]
pub async fn db_list_databases(
    cm: State<'_, ConnectionManager>,
    session_id: String,
) -> AppResult<Vec<String>> {
    let pid = profile_of(&session_id);
    let drivers = cm.get_driver(pid).await?;
    let driver = drivers
        .get(pid)
        .ok_or_else(|| crate::AppError::state(format!("No connection for session {}", session_id)))?;
    driver.list_databases(&session_id).await
}

#[tauri::command]
pub async fn db_list_tables(
    cm: State<'_, ConnectionManager>,
    session_id: String,
    database: String,
) -> AppResult<Vec<String>> {
    let pid = profile_of(&session_id);
    let drivers = cm.get_driver(pid).await?;
    let driver = drivers
        .get(pid)
        .ok_or_else(|| crate::AppError::state(format!("No connection for session {}", session_id)))?;
    driver.list_tables(&session_id, &database).await
}

#[tauri::command]
pub async fn db_list_columns(
    cm: State<'_, ConnectionManager>,
    session_id: String,
    database: String,
    table: String,
) -> AppResult<Vec<ColumnInfo>> {
    let pid = profile_of(&session_id);
    let drivers = cm.get_driver(pid).await?;
    let driver = drivers
        .get(pid)
        .ok_or_else(|| crate::AppError::state(format!("No connection for session {}", session_id)))?;
    driver.list_columns(&session_id, &database, &table).await
}

#[tauri::command]
pub async fn db_get_tables_info(
    cm: State<'_, ConnectionManager>,
    session_id: String,
    database: String,
) -> AppResult<Vec<TableInfo>> {
    let pid = profile_of(&session_id);
    let drivers = cm.get_driver(pid).await?;
    let driver = drivers
        .get(pid)
        .ok_or_else(|| crate::AppError::state(format!("No connection for session {}", session_id)))?;
    driver.get_tables_info(&session_id, &database).await
}

#[tauri::command]
pub async fn db_get_databases_info(
    cm: State<'_, ConnectionManager>,
    session_id: String,
) -> AppResult<Vec<DatabaseInfo>> {
    let pid = profile_of(&session_id);
    let drivers = cm.get_driver(pid).await?;
    let driver = drivers
        .get(pid)
        .ok_or_else(|| crate::AppError::state(format!("No connection for session {}", session_id)))?;
    driver.get_databases_info(&session_id).await
}
