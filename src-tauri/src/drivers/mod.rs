// The database driver service interface. Each backend (MySQL, PG, SQLite,
// MSSQL) implements `DbDriver`. The ConnectionManager holds one driver per
// connected profile and routes commands to it.
//
// Sessions: `begin_session` leases a live connection from the driver's pool and
// returns a `SessionId`. Subsequent `query`/`execute`/introspection calls reuse
// that pinned connection, enabling cross-command transactions, session
// variables, temp tables, and `USE <db>` persistence. `end_session` returns
// the connection to the pool.

pub mod mysql;
pub mod mssql;
pub mod postgres;
pub mod sqlite;

use async_trait::async_trait;
use serde::{Deserialize, Serialize};

use crate::models::{
    ColumnInfo, ConnectParams, ConnectionHandle, DatabaseInfo, QueryResultSet, SessionId, TableInfo,
};
use crate::AppResult;

/// The database type discriminator.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DbType {
    Mysql,
    Postgres,
    Sqlite,
    Mssql,
}

impl DbType {
    pub fn from_str(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "postgres" | "postgresql" | "pg" => DbType::Postgres,
            "sqlite" => DbType::Sqlite,
            "mssql" | "sqlserver" => DbType::Mssql,
            _ => DbType::Mysql, // default
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            DbType::Mysql => "mysql",
            DbType::Postgres => "postgres",
            DbType::Sqlite => "sqlite",
            DbType::Mssql => "mssql",
        }
    }
}

/// The driver service interface. Implementations are stateful (hold a pool
/// internally after `connect`). A driver instance is created per profile at
/// connect time and stored in the ConnectionManager.
#[async_trait]
pub trait DbDriver: Send + Sync {
    /// The database type this driver serves.
    fn db_type(&self) -> DbType;

    // ---- Lifecycle

    /// Establish a connection (create the pool, test with a ping). Returns a
    /// handle describing the connected server. The driver retains the pool
    /// internally, keyed by `params.profile_id`.
    async fn connect(&self, params: &ConnectParams) -> AppResult<ConnectionHandle>;

    /// Disconnect: drop the pool and any session state for this profile.
    async fn disconnect(&self, profile_id: &str) -> AppResult<()>;

    /// Test that the connection is alive.
    async fn ping(&self, profile_id: &str) -> AppResult<()>;

    // ---- Sessions (pinned connections for cross-command affinity)

    /// Lease a connection from the pool and pin it under `session_id`. The
    /// connection is held until `end_session` returns it.
    async fn begin_session(&self, profile_id: &str) -> AppResult<SessionId>;

    /// Return a pinned session's connection to the pool.
    async fn end_session(&self, session_id: &str) -> AppResult<()>;

    // ---- Query

    /// Execute SQL that may return rows. Supports multiple statements (split
    /// by `;` respecting quotes); returns one `QueryResultSet` per statement.
    async fn query(
        &self,
        session_id: &str,
        sql: &str,
        timeout_ms: Option<u64>,
    ) -> AppResult<Vec<QueryResultSet>>;

    /// Execute SQL that does not return rows (DDL, INSERT, UPDATE, DELETE).
    async fn execute(
        &self,
        session_id: &str,
        sql: &str,
        timeout_ms: Option<u64>,
    ) -> AppResult<u64>;

    // ---- Schema introspection

    async fn list_databases(&self, session_id: &str) -> AppResult<Vec<String>>;

    async fn list_tables(&self, session_id: &str, database: &str) -> AppResult<Vec<String>>;

    async fn list_columns(
        &self,
        session_id: &str,
        database: &str,
        table: &str,
    ) -> AppResult<Vec<ColumnInfo>>;

    async fn get_tables_info(
        &self,
        session_id: &str,
        database: &str,
    ) -> AppResult<Vec<TableInfo>>;

    async fn get_databases_info(&self, session_id: &str) -> AppResult<Vec<DatabaseInfo>>;
}

/// Construct a driver for the given database type. The driver is created fresh
/// per profile at connect time (so its internal pool is profile-scoped).
pub fn create_driver(db_type: DbType) -> Box<dyn DbDriver> {
    match db_type {
        DbType::Mysql => Box::new(mysql::MysqlDriver::new()),
        DbType::Postgres => Box::new(postgres::PostgresDriver::new()),
        DbType::Sqlite => Box::new(sqlite::SqliteDriver::new()),
        DbType::Mssql => Box::new(mssql::MssqlDriver::new()),
    }
}
