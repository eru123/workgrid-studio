// SSH server commands: registry CRUD over `SshServerService` plus Test
// Connection, which resolves auth from the credentials vault.

use tauri::State;

use crate::models::{SshServerDto, SshServerInput, SshTestResult};
use crate::services::credentials::CredentialService;
use crate::services::ssh_servers::{self, SshServerService};
use crate::AppResult;

/// List all saved SSH servers.
#[tauri::command]
pub async fn ssh_servers_list(store: State<'_, SshServerService>) -> AppResult<Vec<SshServerDto>> {
    store.list().await
}

/// Create or update an SSH server. A supplied id updates in place.
#[tauri::command]
pub async fn ssh_upsert_server(
    store: State<'_, SshServerService>,
    input: SshServerInput,
) -> AppResult<SshServerDto> {
    store.upsert(input).await
}

/// Delete a saved server by id.
#[tauri::command]
pub async fn ssh_delete_server(store: State<'_, SshServerService>, id: String) -> AppResult<()> {
    store.delete(&id).await
}

/// Test a server definition (works on unsaved form input). Authentication
/// material is resolved live from the referenced vault identity.
#[tauri::command]
pub async fn ssh_test_connection(
    _store: State<'_, SshServerService>,
    vault: State<'_, CredentialService>,
    input: SshServerInput,
) -> AppResult<SshTestResult> {
    ssh_servers::test_connection(&input, &vault).await
}
