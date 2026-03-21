use mysql_async::Pool;
use rusqlite::Connection as SqliteConnection;
use std::collections::HashMap;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use std::sync::Mutex;
use tauri::Manager;

pub mod ai;
pub mod crypto;
pub mod db;
pub mod error;
pub mod files;
pub mod logging;
pub mod mssql;
pub mod pg;
pub mod sqlite;
pub mod ssh;

pub use error::{AppError, AppResult};

pub struct TunnelHandle {
    pub local_port: u16,
    pub shutdown: Arc<AtomicBool>,
    /// Tokio task running the tunnel bridge loop. Aborted on disconnect.
    pub task: Option<tokio::task::JoinHandle<()>>,
}

pub struct DbState {
    pub pools: Mutex<HashMap<String, Pool>>,
    pub pg_pools: Mutex<HashMap<String, deadpool_postgres::Pool>>,
    pub sqlite_pools: Mutex<HashMap<String, Arc<Mutex<SqliteConnection>>>>,
    pub mssql_pools: Mutex<HashMap<String, String>>,
    pub tunnels: Mutex<HashMap<String, TunnelHandle>>,
    /// Per-profile cancellation flags. Set to `true` by `db_cancel_connect`
    /// while `db_connect` is in flight; checked at each major phase boundary.
    pub cancel_tokens: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

impl DbState {
    pub fn new() -> Self {
        Self {
            pools: Mutex::new(HashMap::new()),
            pg_pools: Mutex::new(HashMap::new()),
            sqlite_pools: Mutex::new(HashMap::new()),
            mssql_pools: Mutex::new(HashMap::new()),
            tunnels: Mutex::new(HashMap::new()),
            cancel_tokens: Mutex::new(HashMap::new()),
        }
    }
}

impl Default for DbState {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let _ = files::ensure_app_dirs();

    tauri::Builder::default()
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_updater::Builder::default().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(DbState::new())
        // LogState is initialised inside setup() so we have the AppHandle
        .setup(|app| {
            let log_state = logging::LogState::new(app.handle().clone());
            app.manage(log_state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            files::app_read_file,
            files::app_write_file,
            files::app_delete_file,
            files::app_get_data_dir,
            files::app_delete_all_data,
            logging::get_log_buffer,
            logging::read_profile_log,
            logging::clear_profile_log,
            logging::clear_all_logs,
            db::db_connect,
            db::db_cancel_connect,
            db::db_disconnect,
            db::db_list_databases,
            db::db_list_tables,
            db::db_list_columns,
            db::db_get_databases_info,
            db::db_get_tables_info,
            db::db_get_variables,
            db::db_set_variable,
            db::db_get_status,
            db::db_get_processes,
            db::db_kill_process,
            db::db_execute_query,
            db::db_get_collations,
            db::db_query,
            db::db_update_row,
            db::db_get_foreign_keys,
            db::db_get_indexes,
            db::db_list_triggers,
            db::db_get_trigger_ddl,
            db::db_drop_trigger,
            db::db_create_trigger,
            db::db_list_routines,
            db::db_get_routine_ddl,
            db::db_drop_routine,
            db::db_create_or_replace_routine,
            db::db_list_views,
            db::db_get_view_ddl,
            db::db_drop_view,
            db::db_create_or_replace_view,
            db::db_list_events,
            db::db_get_event_ddl,
            db::db_drop_event,
            db::db_create_event,
            db::db_list_users,
            db::db_get_user_grants,
            db::db_create_user,
            db::db_drop_user,
            db::db_grant,
            db::db_revoke,
            db::db_flush_privileges,
            crypto::vault_set,
            crypto::vault_get,
            crypto::vault_delete,
            ai::ai_generate_query,
            ai::get_ai_logs,
            ai::clear_ai_logs,
            db::db_get_schema_ddl,
            crypto::encrypt_password,
            crypto::decrypt_password,
            db::db_ping,
            db::db_import_sql,
            db::db_import_csv,
            db::db_export_table_csv,
            db::db_export_table_json,
            db::db_export_table_inserts,
            db::db_export_sql_dump,
            pg::pg_connect,
            pg::pg_disconnect,
            pg::pg_list_databases,
            pg::pg_list_tables,
            pg::pg_list_columns,
            pg::pg_get_databases_info,
            pg::pg_get_tables_info,
            pg::pg_execute_query,
            pg::pg_query,
            pg::pg_get_processes,
            pg::pg_kill_process,
            sqlite::sqlite_connect,
            sqlite::sqlite_disconnect,
            sqlite::sqlite_list_databases,
            sqlite::sqlite_list_tables,
            sqlite::sqlite_list_columns,
            sqlite::sqlite_execute_query,
            sqlite::sqlite_query,
            mssql::mssql_connect,
            mssql::mssql_disconnect,
            mssql::mssql_list_databases,
            mssql::mssql_list_tables,
            mssql::mssql_list_columns,
            mssql::mssql_execute_query,
            mssql::mssql_query,
            mssql::mssql_get_processes,
            mssql::mssql_kill_process,
            ssh::forget_host_key
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
