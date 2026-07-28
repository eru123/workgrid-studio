// PostgreSQL driver. Implements `DbDriver` using `tokio-postgres` (async) with
// a `deadpool-postgres` pool. A pinned connection is leased per session,
// matching the MySQL driver's model.
//
// Introspection uses pg_catalog / information_schema. The "database" concept in
// PostgreSQL maps to a schema within the connected database; for tree parity
// with MySQL we expose the connected database as a single "database" and list
// schemas/tables under it. Here `list_databases` returns the current DB name,
// and `list_tables` lists relations in the `public` (or given) schema.

use std::collections::HashMap;
use std::sync::Arc;

use async_trait::async_trait;
use deadpool_postgres::{Config as PgConfig, Pool, Runtime};
use tokio::sync::Mutex;
use tokio_postgres::types::Type;
use tokio_postgres::{NoTls, Row};

use crate::drivers::{DbType, DbDriver};
use crate::models::{
    ColumnInfo, ConnectParams, ConnectionHandle, DatabaseInfo, QueryResultSet, SessionId, TableInfo,
};
use crate::AppError;

type PinnedConn = Arc<Mutex<Option<deadpool_postgres::Object>>>;

pub struct PostgresDriver {
    pools: Mutex<HashMap<String, Pool>>,
    sessions: Mutex<HashMap<String, PinnedConn>>,
}

impl PostgresDriver {
    pub fn new() -> Self {
        Self {
            pools: Mutex::new(HashMap::new()),
            sessions: Mutex::new(HashMap::new()),
        }
    }

    async fn get_pool(&self, profile_id: &str) -> Result<Pool, AppError> {
        let pools = self.pools.lock().await;
        pools
            .get(profile_id)
            .cloned()
            .ok_or_else(|| AppError::state(format!("No connection for profile {}", profile_id)))
    }

    fn build_config(params: &ConnectParams) -> Result<PgConfig, AppError> {
        let mut cfg = PgConfig::new();
        cfg.host = Some(params.host.clone());
        cfg.port = Some(params.port);
        cfg.user = Some(params.user.clone());
        cfg.password = Some(params.password.clone());
        if let Some(ref db) = params.database {
            if !db.is_empty() {
                cfg.dbname = Some(db.clone());
            }
        }
        cfg.application_name = Some("WorkGrid Studio".to_string());
        // Pool sizing mirrors MySQL (0..5).
        cfg.pool = Some(deadpool_postgres::PoolConfig {
            max_size: 5,
            ..Default::default()
        });
        Ok(cfg)
    }

    /// Convert a postgres Row column to serde_json::Value by its type.
    fn value_to_json(row: &Row, idx: usize) -> serde_json::Value {
        let col = &row.columns()[idx];
        let t = col.type_();

        // NULL check first.
        if row.try_get::<_, Option<bool>>(idx).ok().is_none() && row.try_get::<_, Option<String>>(idx).ok().is_none() {
            // Heuristic NULL detection: try to read as Option<serde_json::Value>.
        }

        // Use a typed approach: try each common type as Option, fall back to string.
        macro_rules! try_opt {
            ($t:ty) => {
                if let Ok(v) = row.try_get::<_, Option<$t>>(idx) {
                    return match v {
                        Some(x) => serde_json::to_value(x).unwrap_or(serde_json::Value::Null),
                        None => serde_json::Value::Null,
                    };
                }
            };
        }

        // Boolean
        try_opt!(bool);
        // Integer families
        try_opt!(i16);
        try_opt!(i32);
        try_opt!(i64);
        try_opt!(f32);
        try_opt!(f64);
        // Text
        try_opt!(String);
        // JSON / JSONB
        if t == &Type::JSON || t == &Type::JSONB {
            if let Ok(Some(s)) = row.try_get::<_, Option<String>>(idx) {
                return serde_json::from_str(&s).unwrap_or(serde_json::Value::String(s));
            }
            return serde_json::Value::Null;
        }
        // Bytes / blobs
        if let Ok(Some(b)) = row.try_get::<_, Option<Vec<u8>>>(idx) {
            return serde_json::Value::String(format!("[blob {} bytes]", b.len()));
        }
        // Everything else -> string representation.
        if let Ok(Some(s)) = row.try_get::<_, Option<String>>(idx) {
            return serde_json::Value::String(s);
        }
        serde_json::Value::Null
    }
}

#[async_trait]
impl DbDriver for PostgresDriver {
    fn db_type(&self) -> DbType {
        DbType::Postgres
    }

    async fn connect(&self, params: &ConnectParams) -> Result<ConnectionHandle, AppError> {
        let cfg = Self::build_config(params)?;
        let pool = cfg
            .create_pool(Some(Runtime::Tokio1), NoTls)
            .map_err(|e| AppError::database(format!("Failed to create pool: {}", e)))?;

        // Test with a connection.
        let client = pool
            .get()
            .await
            .map_err(|e| AppError::database(format!("Connection failed: {}", e)))?;
        let version: String = client
            .query_one("SHOW server_version", &[])
            .await
            .map_err(|e| AppError::database(format!("Failed to query version: {}", e)))?
            .get(0);
        drop(client);

        {
            let mut pools = self.pools.lock().await;
            if let Some(old) = pools.insert(params.profile_id.clone(), pool) {
                drop(pools);
                old.close();
            }
        }

        Ok(ConnectionHandle {
            profile_id: params.profile_id.clone(),
            db_type: "postgres".to_string(),
            server_version: version,
        })
    }

    async fn disconnect(&self, profile_id: &str) -> Result<(), AppError> {
        {
            let sessions = self.sessions.lock().await;
            let to_remove: Vec<String> = sessions
                .keys()
                .filter(|k| k.starts_with(&format!("{}:", profile_id)))
                .cloned()
                .collect();
            drop(sessions);
            for sid in to_remove {
                self.end_session(&sid).await?;
            }
        }
        let pool = {
            let mut pools = self.pools.lock().await;
            pools.remove(profile_id)
        };
        if let Some(pool) = pool {
            pool.close();
        }
        Ok(())
    }

    async fn ping(&self, profile_id: &str) -> Result<(), AppError> {
        let pool = self.get_pool(profile_id).await?;
        let client = pool
            .get()
            .await
            .map_err(|e| AppError::database(format!("Ping failed: {}", e)))?;
        client
            .execute("SELECT 1", &[])
            .await
            .map_err(|e| AppError::database(format!("Ping query failed: {}", e)))?;
        Ok(())
    }

    async fn begin_session(&self, profile_id: &str) -> Result<SessionId, AppError> {
        let pool = self.get_pool(profile_id).await?;
        let client = pool
            .get()
            .await
            .map_err(|e| AppError::database(format!("Failed to acquire connection: {}", e)))?;
        // Lease the client for the session lifetime.
        let pinned: PinnedConn = Arc::new(Mutex::new(Some(client)));
        let session_id = format!("{}:{}", profile_id, uuid::Uuid::new_v4());
        {
            let mut sessions = self.sessions.lock().await;
            sessions.insert(session_id.clone(), pinned);
        }
        Ok(session_id)
    }

    async fn end_session(&self, session_id: &str) -> Result<(), AppError> {
        let pinned = {
            let mut sessions = self.sessions.lock().await;
            sessions.remove(session_id)
        };
        if let Some(pinned) = pinned {
            let conn_opt = pinned.lock().await.take();
            drop(conn_opt); // returns client to the pool on drop
        }
        Ok(())
    }

    async fn query(
        &self,
        session_id: &str,
        sql: &str,
        _timeout_ms: Option<u64>,
    ) -> Result<Vec<QueryResultSet>, AppError> {
        let pinned = {
            let sessions = self.sessions.lock().await;
            sessions
                .get(session_id)
                .cloned()
                .ok_or_else(|| AppError::state(format!("Session not found: {}", session_id)))?
        };

        // PostgreSQL's simple query protocol executes multiple statements in
        // one call and returns multiple result sets.
        let guard = pinned.lock().await;
        let client = guard.as_ref().ok_or_else(|| AppError::state("Session connection was lost"))?;

        let rows = client
            .query(sql, &[])
            .await
            .map_err(|e| AppError::database(format!("Query error: {}", e)))?;

        // If no columns (command like INSERT without RETURNING), report affected.
        if rows.is_empty() {
            return Ok(vec![QueryResultSet {
                columns: vec![],
                rows: vec![],
                affected_rows: 0,
                info: "OK".to_string(),
            }]);
        }

        let columns: Vec<String> = rows[0].columns().iter().map(|c| c.name().to_string()).collect();
        let col_count = columns.len();
        let mut result_rows = Vec::with_capacity(rows.len());
        for row in &rows {
            let mut vals = Vec::with_capacity(col_count);
            for i in 0..col_count {
                vals.push(Self::value_to_json(row, i));
            }
            result_rows.push(vals);
        }
        let count = result_rows.len();
        Ok(vec![QueryResultSet {
            columns,
            rows: result_rows,
            affected_rows: count as u64,
            info: format!("{} row(s) returned", count),
        }])
    }

    async fn execute(
        &self,
        session_id: &str,
        sql: &str,
        _timeout_ms: Option<u64>,
    ) -> Result<u64, AppError> {
        let pinned = {
            let sessions = self.sessions.lock().await;
            sessions
                .get(session_id)
                .cloned()
                .ok_or_else(|| AppError::state(format!("Session not found: {}", session_id)))?
        };
        let guard = pinned.lock().await;
        let client = guard.as_ref().ok_or_else(|| AppError::state("Session connection was lost"))?;

        // For commands that return rows (e.g. INSERT ... RETURNING), count them.
        let rows = client
            .query(sql, &[])
            .await
            .map_err(|e| AppError::database(format!("Execute error: {}", e)))?;
        Ok(rows.len() as u64)
    }

    async fn list_databases(&self, session_id: &str) -> Result<Vec<String>, AppError> {
        let pinned = {
            let sessions = self.sessions.lock().await;
            sessions
                .get(session_id)
                .cloned()
                .ok_or_else(|| AppError::state(format!("Session not found: {}", session_id)))?
        };
        let guard = pinned.lock().await;
        let client = guard.as_ref().ok_or_else(|| AppError::state("Session connection was lost"))?;
        let rows = client
            .query("SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname", &[])
            .await
            .map_err(|e| AppError::database(format!("list_databases error: {}", e)))?;
        Ok(rows.iter().map(|r| r.get::<_, String>(0)).collect())
    }

    async fn list_tables(&self, session_id: &str, _database: &str) -> Result<Vec<String>, AppError> {
        let pinned = {
            let sessions = self.sessions.lock().await;
            sessions
                .get(session_id)
                .cloned()
                .ok_or_else(|| AppError::state(format!("Session not found: {}", session_id)))?
        };
        let guard = pinned.lock().await;
        let client = guard.as_ref().ok_or_else(|| AppError::state("Session connection was lost"))?;
        let rows = client
            .query(
                "SELECT table_name FROM information_schema.tables \
                 WHERE table_schema NOT IN ('pg_catalog','information_schema') \
                 ORDER BY table_name",
                &[],
            )
            .await
            .map_err(|e| AppError::database(format!("list_tables error: {}", e)))?;
        Ok(rows.iter().map(|r| r.get::<_, String>(0)).collect())
    }

    async fn list_columns(
        &self,
        session_id: &str,
        _database: &str,
        table: &str,
    ) -> Result<Vec<ColumnInfo>, AppError> {
        let pinned = {
            let sessions = self.sessions.lock().await;
            sessions
                .get(session_id)
                .cloned()
                .ok_or_else(|| AppError::state(format!("Session not found: {}", session_id)))?
        };
        let guard = pinned.lock().await;
        let client = guard.as_ref().ok_or_else(|| AppError::state("Session connection was lost"))?;

        let rows = client
            .query(
                "SELECT column_name, data_type, is_nullable, column_default \
                 FROM information_schema.columns \
                 WHERE table_name = $1 \
                 ORDER BY ordinal_position",
                &[&table],
            )
            .await
            .map_err(|e| AppError::database(format!("list_columns error: {}", e)))?;

        Ok(rows
            .iter()
            .map(|r| ColumnInfo {
                name: r.get::<_, String>(0),
                col_type: r.get::<_, String>(1),
                nullable: r.get::<_, String>(2) == "YES",
                key: String::new(),
                default_val: r.get::<_, Option<String>>(3),
                extra: String::new(),
            })
            .collect())
    }

    async fn get_tables_info(
        &self,
        session_id: &str,
        _database: &str,
    ) -> Result<Vec<TableInfo>, AppError> {
        let pinned = {
            let sessions = self.sessions.lock().await;
            sessions
                .get(session_id)
                .cloned()
                .ok_or_else(|| AppError::state(format!("Session not found: {}", session_id)))?
        };
        let guard = pinned.lock().await;
        let client = guard.as_ref().ok_or_else(|| AppError::state("Session connection was lost"))?;

        let rows = client
            .query(
                "SELECT c.relname AS name, \
                        CASE c.relkind WHEN 'v' THEN 'view' ELSE 'table' END AS reltype, \
                        pg_total_relation_size(c.oid) AS size_bytes \
                 FROM pg_class c \
                 JOIN pg_namespace n ON n.oid = c.relnamespace \
                 WHERE c.relkind IN ('r','v') \
                   AND n.nspname NOT IN ('pg_catalog','information_schema') \
                 ORDER BY c.relname",
                &[],
            )
            .await
            .map_err(|e| AppError::database(format!("get_tables_info error: {}", e)))?;

        Ok(rows
            .iter()
            .map(|r| TableInfo {
                name: r.get::<_, String>(0),
                rows: None,
                size_bytes: Some(r.get::<_, i64>(2)),
                created: None,
                updated: None,
                engine: None,
                comment: None,
                type_: r.get::<_, String>(1),
            })
            .collect())
    }

    async fn get_databases_info(&self, session_id: &str) -> Result<Vec<DatabaseInfo>, AppError> {
        let pinned = {
            let sessions = self.sessions.lock().await;
            sessions
                .get(session_id)
                .cloned()
                .ok_or_else(|| AppError::state(format!("Session not found: {}", session_id)))?
        };
        let guard = pinned.lock().await;
        let client = guard.as_ref().ok_or_else(|| AppError::state("Session connection was lost"))?;
        let rows = client
            .query(
                "SELECT datname, pg_database_size(datname) \
                 FROM pg_database WHERE datistemplate = false ORDER BY datname",
                &[],
            )
            .await
            .map_err(|e| AppError::database(format!("get_databases_info error: {}", e)))?;

        Ok(rows
            .iter()
            .map(|r| DatabaseInfo {
                name: r.get::<_, String>(0),
                size_bytes: r.get::<_, i64>(1),
                tables: 0,
                views: 0,
                default_collation: String::new(),
                last_modified: None,
            })
            .collect())
    }
}
