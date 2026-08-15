// WorkGrid Studio backend entry point.
//
// Architecture (VS Code-style service registry):
//   - Services are singletons (ConnectionManager, CredentialService),
//     each registered with `.manage()` so commands resolve them via State<T>.
//   - Drivers implement the DbDriver trait (MySQL working; PG/SQLite/MSSQL stubs).
//   - Commands are thin handlers that resolve services via State<T> and delegate.
//
// Modules:
//   - error:     structured AppError {kind, message}
//   - models:    serde data structs (camelCase, matching TS interfaces)
//   - sql:       split_sql_statements + timeout helpers
//   - drivers:   DbDriver trait + MySQL/PG/SQLite/MSSQL impls
//   - services:  ConnectionManager (sessions), credentials vault, crypto, files
//   - ssh:       russh tunnel + TOFU host keys
//   - commands:  Tauri #[command] handlers

pub mod commands;
pub mod drivers;
pub mod error;
pub mod models;
pub mod services;
pub mod sql;
pub mod ssh;

pub use error::{AppError, AppResult};
pub use services::connection::ConnectionManager;
pub use services::credentials::CredentialService;
pub use services::ssh_servers::SshServerService;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Load the persisted vault (or start empty when no file exists yet).
    // A corrupt file falls back to an empty vault rather than aborting
    // startup; the error is logged so the failure is visible.
    let credentials = tauri::async_runtime::block_on(CredentialService::new()).unwrap_or_else(|e| {
        eprintln!("workgrid: failed to load credentials vault: {e}; starting with an empty vault");
        CredentialService::default()
    });
    let ssh_servers = tauri::async_runtime::block_on(SshServerService::new()).unwrap_or_else(|e| {
        eprintln!("workgrid: failed to load SSH server registry: {e}; starting empty");
        SshServerService::default()
    });

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(ConnectionManager::new())
        .manage(credentials)
        .manage(ssh_servers)
        .invoke_handler(tauri::generate_handler![
            // Connection lifecycle
            commands::connection::db_connect,
            commands::connection::db_disconnect,
            commands::connection::db_cancel_connect,
            commands::connection::db_list_profiles,
            commands::connection::db_ping,
            // Sessions + queries
            commands::query::db_begin_session,
            commands::query::db_end_session,
            commands::query::db_query,
            commands::query::db_execute,
            // Schema introspection
            commands::schema::db_list_databases,
            commands::schema::db_list_tables,
            commands::schema::db_list_columns,
            commands::schema::db_get_tables_info,
            commands::schema::db_get_databases_info,
            // Explorer tree (maps schema → TreeNode)
            commands::tree::tree_get_roots,
            commands::tree::tree_get_children,
            // Credential crypto
            commands::crypto::encrypt_password,
            commands::crypto::decrypt_password,
            // Credentials vault
            commands::credentials::credentials_get_tree,
            commands::credentials::credentials_get_entry,
            commands::credentials::credentials_upsert_entry,
            commands::credentials::credentials_create_folder,
            commands::credentials::credentials_delete_node,
            commands::credentials::credentials_move_node,
            commands::credentials::credentials_reorder_node,
            commands::credentials::credentials_copy_node,
            commands::credentials::credentials_rename_node,
            commands::credentials::credentials_set_expanded,
            // SSH servers
            commands::ssh_servers::ssh_servers_list,
            commands::ssh_servers::ssh_upsert_server,
            commands::ssh_servers::ssh_delete_server,
            commands::ssh_servers::ssh_test_connection,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
