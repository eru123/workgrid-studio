// Connection lifecycle commands.

use tauri::State;

use crate::models::{ConnectParams, ConnectionHandle};
use crate::services::connection::ConnectionManager;
use crate::AppResult;

/// Connect to a database. Creates the driver, establishes SSH tunnel if
/// requested, tests the connection, and stores it. Returns the connection
/// handle (with server version).
#[tauri::command]
pub async fn db_connect(
    cm: State<'_, ConnectionManager>,
    params: ConnectParams,
) -> AppResult<ConnectionHandle> {
    cm.connect(&params).await
}

/// Disconnect from a database. Ends sessions, drops the pool, tears down SSH.
#[tauri::command]
pub async fn db_disconnect(
    cm: State<'_, ConnectionManager>,
    profile_id: String,
) -> AppResult<()> {
    cm.disconnect(&profile_id).await
}

/// Request cancellation of an in-progress connect.
#[tauri::command]
pub async fn db_cancel_connect(
    cm: State<'_, ConnectionManager>,
    profile_id: String,
) -> AppResult<()> {
    cm.cancel_connect(&profile_id).await;
    Ok(())
}

/// List currently-connected profile ids.
#[tauri::command]
pub async fn db_list_profiles(cm: State<'_, ConnectionManager>) -> AppResult<Vec<String>> {
    Ok(cm.list_profiles().await)
}

/// Ping a connection (check it's alive).
#[tauri::command]
pub async fn db_ping(
    cm: State<'_, ConnectionManager>,
    profile_id: String,
) -> AppResult<()> {
    let drivers = cm.get_driver(&profile_id).await?;
    let driver = drivers
        .get(&profile_id)
        .ok_or_else(|| crate::AppError::state(format!("No connection for profile {}", profile_id)))?;
    driver.ping(&profile_id).await
}
