// AppState — the service container. Registered with Tauri via `.manage()`,
// resolved by commands via `State<T>`.

use crate::services::connection::ConnectionManager;

/// The application state. Holds all backend services.
/// Modeled after VS Code's service registry: each service is a singleton,
/// instantiated once at startup and injected into commands.
pub struct AppState {
    /// The database connection manager — the central DB service.
    pub connections: ConnectionManager,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            connections: ConnectionManager::new(),
        }
    }
}

impl Default for AppState {
    fn default() -> Self {
        Self::new()
    }
}
