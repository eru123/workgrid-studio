use mysql_async::Pool;
use tauri::Manager;
use std::collections::HashMap;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use std::sync::Mutex;

pub mod ai;
pub mod crypto;
pub mod db;
pub mod error;
pub mod files;
pub mod logging;
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
    pub tunnels: Mutex<HashMap<String, TunnelHandle>>,
    /// Per-profile cancellation flags. Set to `true` by `db_cancel_connect`
    /// while `db_connect` is in flight; checked at each major phase boundary.
    pub cancel_tokens: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

impl DbState {
    pub fn new() -> Self {
        Self {
            pools: Mutex::new(HashMap::new()),
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
            ssh::forget_host_key
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
