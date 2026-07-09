// Command barrel. All Tauri commands are registered here and re-exported for
// the `generate_handler!` macro in lib.rs.

pub mod connection;
pub mod crypto;
pub mod credentials;
pub mod query;
pub mod schema;
pub mod tree;

// Re-export all commands for the handler macro.
pub use connection::{db_cancel_connect, db_connect, db_disconnect, db_list_profiles, db_ping};
pub use credentials::{
    credentials_copy_node, credentials_create_folder, credentials_delete_node, credentials_get_entry,
    credentials_get_tree, credentials_move_node, credentials_rename_node, credentials_upsert_entry,
};
pub use crypto::{decrypt_password, encrypt_password};
pub use query::{db_begin_session, db_end_session, db_execute, db_query};
pub use schema::{
    db_get_databases_info, db_get_tables_info, db_list_columns, db_list_databases, db_list_tables,
};
pub use tree::{tree_get_children, tree_get_roots};
