// Query execution commands. Session-scoped: callers first `db_begin_session`,
/// then pass the returned `sessionId` to `db_query`/`db_execute`, then
/// `db_end_session` when done (e.g. on tab close).

use tauri::State;

use crate::models::{QueryResultSet, SessionId};
use crate::services::connection::ConnectionManager;
use crate::AppResult;

/// Begin a session (pinned connection) on a profile. Returns a session id to
/// pass to subsequent query/execute calls.
#[tauri::command]
pub async fn db_begin_session(
    cm: State<'_, ConnectionManager>,
    profile_id: String,
) -> AppResult<SessionId> {
    cm.begin_session(&profile_id).await
}

/// End a session (return the pinned connection to the pool).
#[tauri::command]
pub async fn db_end_session(
    cm: State<'_, ConnectionManager>,
    session_id: String,
) -> AppResult<()> {
    cm.end_session(&session_id).await
}

/// Execute SQL that may return rows. Supports multiple statements (split by
/// `;` respecting quotes); returns one QueryResultSet per statement.
#[tauri::command]
pub async fn db_query(
    cm: State<'_, ConnectionManager>,
    session_id: String,
    sql: String,
    timeout_ms: Option<u64>,
) -> AppResult<Vec<QueryResultSet>> {
    let profile_id = session_id.split(':').next().unwrap_or("");
    let drivers = cm.get_driver(profile_id).await?;
    let driver = drivers
        .get(profile_id)
        .ok_or_else(|| crate::AppError::state(format!("No connection for session {}", session_id)))?;
    driver.query(&session_id, &sql, timeout_ms).await
}

/// Execute SQL that does not return rows (DDL, INSERT, UPDATE, DELETE).
/// Returns the number of affected rows.
#[tauri::command]
pub async fn db_execute(
    cm: State<'_, ConnectionManager>,
    session_id: String,
    sql: String,
    timeout_ms: Option<u64>,
) -> AppResult<u64> {
    let profile_id = session_id.split(':').next().unwrap_or("");
    let drivers = cm.get_driver(profile_id).await?;
    let driver = drivers
        .get(profile_id)
        .ok_or_else(|| crate::AppError::state(format!("No connection for session {}", session_id)))?;
    driver.execute(&session_id, &sql, timeout_ms).await
}
