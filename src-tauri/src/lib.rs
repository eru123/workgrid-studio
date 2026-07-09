// WorkGrid Studio backend entry point.
//
// Architecture (VS Code-style service registry):
//   - AppState holds singleton services (ConnectionManager).
//   - Drivers implement the DbDriver trait (MySQL working; PG/SQLite/MSSQL stubs).
//   - Commands are thin handlers that resolve services via State<T> and delegate.
//
// Modules:
//   - error:     structured AppError {kind, message}
//   - models:    serde data structs (camelCase, matching TS interfaces)
//   - sql:       split_sql_statements + timeout helpers
//   - drivers:   DbDriver trait + MySQL/PG/SQLite/MSSQL impls
//   - services:  ConnectionManager (sessions), crypto, files
//   - ssh:       russh tunnel + TOFU host keys
//   - commands:  Tauri #[command] handlers
//   - state:     AppState service container

pub mod commands;
pub mod drivers;
pub mod error;
pub mod models;
pub mod services;
pub mod sql;
pub mod ssh;
pub mod state;

pub use error::{AppError, AppResult};
pub use services::connection::ConnectionManager;
pub use state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(AppState::new())
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
            commands::credentials::credentials_copy_node,
            commands::credentials::credentials_rename_node,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
