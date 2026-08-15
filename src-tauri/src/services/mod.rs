// Service layer. Each service is a singleton registered with Tauri's
// `.manage()` and resolved by commands via `State<T>`.

pub mod connection;
pub mod crypto;
pub mod credentials;
pub mod files;
