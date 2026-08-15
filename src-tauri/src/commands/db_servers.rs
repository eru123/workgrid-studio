// Database server management commands: registry CRUD, connection testing,
// connect-via-registry, and docker container listing (local + over SSH).

use tauri::State;

use crate::models::{
    ConnectionHandle, DbServerDto, DbServerInput, DbServerTestResult, DockerContainerDto,
    SshServerInput,
};
use crate::services::connection::ConnectionManager;
use crate::services::credentials::CredentialService;
use crate::services::db_servers::{self, DbServerService};
use crate::services::ssh_servers::{self, SshServerService};
use crate::AppResult;

#[tauri::command]
pub async fn db_servers_list(store: State<'_, DbServerService>) -> AppResult<Vec<DbServerDto>> {
    store.list().await
}

#[tauri::command]
pub async fn db_upsert_server(
    store: State<'_, DbServerService>,
    input: DbServerInput,
) -> AppResult<DbServerDto> {
    store.upsert(input).await
}

#[tauri::command]
pub async fn db_delete_server(store: State<'_, DbServerService>, id: String) -> AppResult<()> {
    store.delete(&id).await
}

/// Test a (possibly unsaved) server form: resolve the address, dial, report.
#[tauri::command]
pub async fn db_server_test(
    input: DbServerInput,
    ssh: State<'_, SshServerService>,
    vault: State<'_, CredentialService>,
) -> AppResult<DbServerTestResult> {
    db_servers::test_db_server(&input, &ssh, &vault).await
}

/// Connect a saved server through the ConnectionManager; the profile id is
/// `srv-<id>` so reconnecting replaces the old driver/tunnel cleanly.
#[tauri::command]
pub async fn db_connect_server(
    id: String,
    manager: State<'_, ConnectionManager>,
    store: State<'_, DbServerService>,
    ssh: State<'_, SshServerService>,
    vault: State<'_, CredentialService>,
) -> AppResult<ConnectionHandle> {
    let record = store.get(&id).await?;
    db_servers::connect_db_server(&manager, &record, &ssh, &vault).await
}

/// `docker ps` on the local daemon (Docker Internal Host picker).
#[tauri::command]
pub async fn docker_list_containers() -> AppResult<Vec<DockerContainerDto>> {
    db_servers::list_local_containers().await
}

/// `docker ps` on a remote host over a registered SSH server
/// (SSH + Docker picker).
#[tauri::command]
pub async fn ssh_docker_list_containers(
    ssh_server_id: String,
    ssh: State<'_, SshServerService>,
    vault: State<'_, CredentialService>,
) -> AppResult<Vec<DockerContainerDto>> {
    let record = ssh.get(&ssh_server_id).await?;
    ssh_servers::list_remote_containers(&SshServerInput::from(&record), &vault).await
}
