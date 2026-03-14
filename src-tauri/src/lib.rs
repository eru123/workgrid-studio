use std::sync::Mutex;
use std::sync::Arc;
use std::sync::atomic::AtomicBool;
use std::sync::mpsc;
use std::collections::HashMap;
use mysql_async::Pool;

pub mod db;
pub mod ssh;
pub mod crypto;
pub mod ai;
pub mod files;
pub mod logging;

pub struct TunnelHandle {
    pub local_port: u16,
    pub shutdown: Arc<AtomicBool>,
    /// Join handle for the forwarding thread. Taken (set to `None`) on disconnect
    /// so the thread can be explicitly joined rather than leaked.
    pub thread: Option<std::thread::JoinHandle<()>>,
    /// Receives a single `()` message when the forwarding loop exits.
    /// Used to implement a bounded join timeout: `recv_timeout(5 s)` blocks
    /// only until the thread signals completion rather than indefinitely.
    pub done_rx: mpsc::Receiver<()>,
}

pub struct DbState {
    pub pools: Mutex<HashMap<String, Pool>>,
    pub tunnels: Mutex<HashMap<String, TunnelHandle>>, // profile_id -> tunnel handle
}

impl DbState {
    pub fn new() -> Self {
        Self {
            pools: Mutex::new(HashMap::new()),
            tunnels: Mutex::new(HashMap::new()),
        }
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
        .invoke_handler(tauri::generate_handler![
            files::app_read_file,
            files::app_write_file,
            files::app_delete_file,
            files::app_get_data_dir,
            logging::read_profile_log,
            logging::clear_profile_log,
            db::db_connect,
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
            ssh::forget_host_key
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
