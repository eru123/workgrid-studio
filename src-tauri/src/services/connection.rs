// ConnectionManager — the central database service. Holds one driver per
// connected profile and routes all DB operations to the right driver.
//
// This is the "VS Code service" equivalent: a singleton registered in AppState,
// resolved by commands via `State<ConnectionManager>`. It owns:
//   - drivers: one Box<dyn DbDriver> per connected profile (each holds its pool)
//   - tunnels: SSH tunnel handles per profile (for teardown)
//   - cancel_tokens: per-profile cancellation flags for connect-in-progress
//
// Uses tokio::sync::RwLock (fixes the legacy std::sync::Mutex-in-async foot-gun).

use std::collections::HashMap;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;

use tokio::sync::RwLock;

use crate::drivers::{create_driver, DbType, DbDriver};
use crate::models::{ConnectParams, ConnectionHandle, SessionId};
use crate::ssh::TunnelHandle;
use crate::{AppError, AppResult};

pub struct ConnectionManager {
    /// One driver per connected profile. The driver owns its connection pool.
    drivers: RwLock<HashMap<String, Box<dyn DbDriver>>>,
    /// SSH tunnel handles per profile (for teardown on disconnect).
    tunnels: RwLock<HashMap<String, TunnelHandle>>,
    /// Per-profile cancellation flags, set during connect to allow abort.
    cancel_tokens: RwLock<HashMap<String, Arc<AtomicBool>>>,
}

impl ConnectionManager {
    pub fn new() -> Self {
        Self {
            drivers: RwLock::new(HashMap::new()),
            tunnels: RwLock::new(HashMap::new()),
            cancel_tokens: RwLock::new(HashMap::new()),
        }
    }

    /// Connect to a database. Establishes SSH tunnel if requested, creates the
    /// driver, connects, and stores the driver keyed by profile_id.
    pub async fn connect(&self, params: &ConnectParams) -> AppResult<ConnectionHandle> {
        let profile_id = params.profile_id.clone();

        // Set up cancellation token.
        let cancel = Arc::new(AtomicBool::new(false));
        {
            let mut tokens = self.cancel_tokens.write().await;
            tokens.insert(profile_id.clone(), cancel.clone());
        }

        // Tear down any existing connection/tunnel for this profile first.
        self.disconnect_internal(&profile_id).await;

        // Build effective params (with SSH tunnel rewriting host/port if needed).
        let effective_params = if params.ssh {
            let tunnel = crate::ssh::establish_ssh_tunnel(&profile_id, params).await?;
            let local_port = tunnel.local_port;
            {
                let mut tunnels = self.tunnels.write().await;
                tunnels.insert(profile_id.clone(), tunnel);
            }
            let mut p = params.clone();
            p.host = "127.0.0.1".to_string();
            p.port = local_port;
            p
        } else {
            params.clone()
        };

        // Create the driver and connect.
        let db_type = DbType::from_str(&params.db_type);
        let driver = create_driver(db_type);
        let handle = driver.connect(&effective_params).await?;

        // Store the driver.
        {
            let mut drivers = self.drivers.write().await;
            drivers.insert(profile_id.clone(), driver);
        }

        // Clear cancellation token.
        {
            let mut tokens = self.cancel_tokens.write().await;
            tokens.remove(&profile_id);
        }

        Ok(handle)
    }

    /// Disconnect a profile: end sessions, drop the driver (and its pool), tear
    /// down the SSH tunnel.
    pub async fn disconnect(&self, profile_id: &str) -> AppResult<()> {
        self.disconnect_internal(profile_id).await;
        Ok(())
    }

    async fn disconnect_internal(&self, profile_id: &str) {
        // Drop the driver (ends sessions + drops pool internally).
        let driver_opt = {
            let mut drivers = self.drivers.write().await;
            drivers.remove(profile_id)
        };
        if let Some(driver) = driver_opt {
            let _ = driver.disconnect(profile_id).await;
        }

        // Tear down SSH tunnel.
        let tunnel_opt = {
            let mut tunnels = self.tunnels.write().await;
            tunnels.remove(profile_id)
        };
        if let Some(tunnel) = tunnel_opt {
            tunnel.shutdown().await;
        }
    }

    /// Check if a cancellation was requested for this profile.
    pub async fn is_cancelled(&self, profile_id: &str) -> bool {
        let tokens = self.cancel_tokens.read().await;
        tokens
            .get(profile_id)
            .map(|t| t.load(std::sync::atomic::Ordering::Relaxed))
            .unwrap_or(false)
    }

    /// Request cancellation of an in-progress connect for a profile.
    pub async fn cancel_connect(&self, profile_id: &str) {
        let tokens = self.cancel_tokens.read().await;
        if let Some(t) = tokens.get(profile_id) {
            t.store(true, std::sync::atomic::Ordering::Relaxed);
        }
    }

    /// List currently-connected profile ids.
    pub async fn list_profiles(&self) -> Vec<String> {
        let drivers = self.drivers.read().await;
        drivers.keys().cloned().collect()
    }

    /// Get the driver for a profile. Returns a reference to the boxed driver.
    /// (We can't return a direct borrow across the RwLock guard in async, so
    /// callers use `with_driver` instead.)
    pub async fn with_driver<F, R>(&self, profile_id: &str, f: F) -> AppResult<R>
    where
        F: for<'a> FnOnce(&'a dyn DbDriver) -> R + Send,
        R: Send,
    {
        let drivers = self.drivers.read().await;
        let driver = drivers
            .get(profile_id)
            .ok_or_else(|| AppError::state(format!("No connection for profile {}", profile_id)))?;
        Ok(f(driver.as_ref()))
    }

    /// Begin a session on the profile's driver. Holds a read lock for the
    /// duration of the driver call (acceptable: sessions are short, and read
    /// locks don't block other readers).
    pub async fn begin_session(&self, profile_id: &str) -> AppResult<SessionId> {
        let drivers = self.drivers.read().await;
        let driver = drivers
            .get(profile_id)
            .ok_or_else(|| AppError::state(format!("No connection for profile {}", profile_id)))?;
        driver.begin_session(profile_id).await
    }

    /// End a session.
    pub async fn end_session(&self, session_id: &str) -> AppResult<()> {
        // Sessions are stored inside the driver; find which driver owns this
        // session by profile_id prefix.
        let profile_id = session_id.split(':').next().unwrap_or("");
        let drivers = self.drivers.read().await;
        if let Some(driver) = drivers.get(profile_id) {
            driver.end_session(session_id).await
        } else {
            // Driver already gone; session is implicitly ended.
            Ok(())
        }
    }

    /// Get a reference to the driver for a profile, holding the read lock.
    /// Callers must not await while holding the returned guard in a way that
    /// deadlocks. For most operations, use the dedicated methods above.
    pub async fn get_driver(&self, _profile_id: &str) -> AppResult<tokio::sync::RwLockReadGuard<'_, HashMap<String, Box<dyn DbDriver>>>> {
        Ok(self.drivers.read().await)
    }
}
