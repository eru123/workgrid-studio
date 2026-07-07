// MySQL/MariaDB driver. Implements `DbDriver` using `mysql_async` (rustls).
//
// Patterns ported from the legacy db.rs:
//   - Pool construction (OptsBuilder, SslOpts, PoolConstraints(0,5), mTLS)
//   - split_sql_statements + per-statement query
//   - mysql_async::Value → serde_json::Value exhaustive conversion
//   - information_schema introspection SQL (SHOW DATABASES, SHOW TABLES, etc.)
//
// New vs legacy: sessions (pinned connections) for cross-command affinity.

use std::collections::HashMap;
use std::sync::Arc;

use async_trait::async_trait;
use mysql_async::prelude::*;
use mysql_async::{
    Opts, OptsBuilder, Pool, PoolConstraints, PoolOpts, SslOpts, ClientIdentity, Value,
};
use tokio::sync::Mutex;

use crate::drivers::{DbType, DbDriver};
use crate::models::{
    ColumnInfo, ConnectParams, ConnectionHandle, DatabaseInfo, QueryResultSet, SessionId, TableInfo,
};
use crate::sql::split_sql_statements;
use crate::AppError;

/// A live MySQL connection leased from the pool, held for the duration of a
/// session. Wrapped in a Mutex so the session can be shared across commands
/// (Tauri commands are concurrent).
type PinnedConn = Arc<Mutex<Option<mysql_async::Conn>>>;

pub struct MysqlDriver {
    /// One pool per connected profile.
    pools: Mutex<HashMap<String, Pool>>,
    /// Pinned connections per session id.
    sessions: Mutex<HashMap<String, PinnedConn>>,
}

impl MysqlDriver {
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

    /// Build the mysql_async pool from connect params (SSL, mTLS, pool constraints).
    fn build_pool(params: &ConnectParams) -> Result<Pool, AppError> {
        let mut builder = OptsBuilder::default()
            .ip_or_hostname(params.host.clone())
            .tcp_port(params.port)
            .user(Some(params.user.clone()))
            .pass(Some(params.password.clone()));

        if let Some(ref db) = params.database {
            if !db.is_empty() {
                builder = builder.db_name(Some(db.clone()));
            }
        }

        if params.ssl {
            let mut ssl_opts = SslOpts::default();
            if !params.ssl_reject_unauthorized {
                ssl_opts = ssl_opts.with_danger_accept_invalid_certs(true);
            }
            if let Some(ref ca) = params.ssl_ca_file {
                if !ca.is_empty() {
                    let path = std::path::PathBuf::from(ca);
                    if !path.exists() {
                        return Err(AppError::validation(format!(
                            "SSL CA file not found: {}",
                            ca
                        )));
                    }
                    ssl_opts = ssl_opts.with_root_certs(vec![path.into()]);
                }
            }
            let cert = params.ssl_cert_file.as_ref().filter(|s| !s.is_empty());
            let key = params.ssl_key_file.as_ref().filter(|s| !s.is_empty());
            if let (Some(cert_path), Some(key_path)) = (cert, key) {
                let identity = ClientIdentity::new(
                    std::path::PathBuf::from(cert_path).into(),
                    std::path::PathBuf::from(key_path).into(),
                );
                ssl_opts = ssl_opts.with_client_identity(Some(identity));
            } else if cert.is_some() || key.is_some() {
                return Err(AppError::validation(
                    "SSL client cert and key must both be provided for mTLS",
                ));
            }
            builder = builder.ssl_opts(Some(ssl_opts));
        }

        let pool_opts = PoolOpts::new().with_constraints(PoolConstraints::new(0, 5).unwrap());
        builder = builder.pool_opts(Some(pool_opts));

        let opts: Opts = builder.into();
        Ok(Pool::new(opts))
    }

    /// Convert a mysql_async::Value to a serde_json::Value. Ported from legacy
    /// db.rs; added Bool and Decimal arms for newer mysql_async versions.
    fn value_to_json(val: &Value) -> serde_json::Value {
        match val {
            Value::NULL => serde_json::Value::Null,
            Value::Bytes(b) => match String::from_utf8(b.clone()) {
                Ok(s) => serde_json::Value::String(s),
                Err(_) => serde_json::Value::String(format!("[binary {} bytes]", b.len())),
            },
            Value::Int(n) => serde_json::Value::Number(serde_json::Number::from(*n)),
            Value::UInt(n) => serde_json::Value::Number(serde_json::Number::from(*n)),
            Value::Float(f) => serde_json::Number::from_f64(*f as f64)
                .map(serde_json::Value::Number)
                .unwrap_or_else(|| serde_json::Value::String(f.to_string())),
            Value::Double(f) => serde_json::Number::from_f64(*f)
                .map(serde_json::Value::Number)
                .unwrap_or_else(|| serde_json::Value::String(f.to_string())),
            Value::Date(y, m, d, h, mi, s, _us) => serde_json::Value::String(format!(
                "{:04}-{:02}-{:02} {:02}:{:02}:{:02}",
                y, m, d, h, mi, s
            )),
            Value::Time(neg, d, h, mi, s, _us) => {
                let sign = if *neg { "-" } else { "" };
                let total_hours = *d * 24 + u32::from(*h);
                serde_json::Value::String(format!("{}{:02}:{:02}:{:02}", sign, total_hours, mi, s))
            }
        }
    }
}

#[async_trait]
impl DbDriver for MysqlDriver {
    fn db_type(&self) -> DbType {
        DbType::Mysql
    }

    async fn connect(&self, params: &ConnectParams) -> Result<ConnectionHandle, AppError> {
        let pool = Self::build_pool(params)?;

        // Test the connection with SELECT 1.
        let mut conn = pool.get_conn().await.map_err(|e| {
            AppError::database(format!("Connection failed: {}", e))
        })?;
        let version: String = conn
            .query_first("SELECT VERSION()")
            .await
            .map_err(|e| AppError::database(format!("Failed to query server version: {}", e)))?
            .unwrap_or_else(|| "unknown".to_string());
        drop(conn);

        // Store the pool.
        {
            let mut pools = self.pools.lock().await;
            // If reconnecting, disconnect the old pool first.
            if let Some(old) = pools.insert(params.profile_id.clone(), pool.clone()) {
                drop(pools);
                let _ = old.disconnect().await;
            }
        }

        Ok(ConnectionHandle {
            profile_id: params.profile_id.clone(),
            db_type: "mysql".to_string(),
            server_version: version,
        })
    }

    async fn disconnect(&self, profile_id: &str) -> Result<(), AppError> {
        // End all sessions for this profile.
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
        // Drop the pool.
        let pool = {
            let mut pools = self.pools.lock().await;
            pools.remove(profile_id)
        };
        if let Some(pool) = pool {
            let _ = pool.disconnect().await;
        }
        Ok(())
    }

    async fn ping(&self, profile_id: &str) -> Result<(), AppError> {
        let pool = self.get_pool(profile_id).await?;
        let mut conn = pool.get_conn().await.map_err(|e| {
            AppError::database(format!("Ping failed: {}", e))
        })?;
        conn.query_drop("SELECT 1").await.map_err(|e| {
            AppError::database(format!("Ping query failed: {}", e))
        })?;
        Ok(())
    }

    async fn begin_session(&self, profile_id: &str) -> Result<SessionId, AppError> {
        let pool = self.get_pool(profile_id).await?;
        let conn = pool.get_conn().await.map_err(|e| {
            AppError::database(format!("Failed to acquire connection for session: {}", e))
        })?;
        let session_id = format!("{}:{}", profile_id, uuid::Uuid::new_v4());
        let pinned = Arc::new(Mutex::new(Some(conn)));
        let mut sessions = self.sessions.lock().await;
        sessions.insert(session_id.clone(), pinned);
        Ok(session_id)
    }

    async fn end_session(&self, session_id: &str) -> Result<(), AppError> {
        let pinned = {
            let mut sessions = self.sessions.lock().await;
            sessions.remove(session_id)
        };
        if let Some(pinned) = pinned {
            let conn_opt = pinned.lock().await.take();
            // Dropping the conn returns it to the pool automatically.
            drop(conn_opt);
        }
        Ok(())
    }

    async fn query(
        &self,
        session_id: &str,
        sql: &str,
        timeout_ms: Option<u64>,
    ) -> Result<Vec<QueryResultSet>, AppError> {
        let pinned = {
            let sessions = self.sessions.lock().await;
            sessions
                .get(session_id)
                .cloned()
                .ok_or_else(|| AppError::state(format!("Session not found: {}", session_id)))?
        };

        let statements = split_sql_statements(sql);
        let mut results = Vec::new();

        for stmt in &statements {
            // Hold the session lock for the duration of this statement.
            let mut session_guard = pinned.lock().await;
            let conn = session_guard
                .as_mut()
                .ok_or_else(|| AppError::state("Session connection was lost"))?;

            // Run the query with a timeout. The future borrows conn, which is
            // fine because the timeout polls it within this scope.
            let rows_result = {
                let fut = conn.query::<mysql_async::Row, _>(stmt.as_str());
                tokio::time::timeout(
                    std::time::Duration::from_millis(
                        crate::sql::normalized_query_timeout_ms(timeout_ms),
                    ),
                    fut,
                )
                .await
            };

            let rows = match rows_result {
                Ok(Ok(rows)) => rows,
                Ok(Err(e)) => return Err(AppError::database(format!("Query error [{}]: {}", stmt, e))),
                Err(_) => {
                    return Err(AppError::database(format!(
                        "Query timed out [{}]",
                        stmt,
                    )));
                }
            };

            // conn is still borrowed from session_guard for affected_rows.
            let conn = session_guard
                .as_mut()
                .ok_or_else(|| AppError::state("Session connection was lost"))?;

            if rows.is_empty() {
                let affected = conn.affected_rows();
                results.push(QueryResultSet {
                    columns: vec![],
                    rows: vec![],
                    affected_rows: affected,
                    info: format!("{} row(s) affected", affected),
                });
            } else {
                let columns: Vec<String> = rows[0]
                    .columns_ref()
                    .iter()
                    .map(|c| c.name_str().to_string())
                    .collect();

                let mut result_rows = Vec::with_capacity(rows.len());
                for row in &rows {
                    let mut vals = Vec::with_capacity(columns.len());
                    for i in 0..columns.len() {
                        let raw: &Value = &row[i];
                        vals.push(Self::value_to_json(raw));
                    }
                    result_rows.push(vals);
                }

                let count = result_rows.len();
                results.push(QueryResultSet {
                    columns,
                    rows: result_rows,
                    affected_rows: count as u64,
                    info: format!("{} row(s) returned", count),
                });
            }
        }

        Ok(results)
    }

    async fn execute(
        &self,
        session_id: &str,
        sql: &str,
        timeout_ms: Option<u64>,
    ) -> Result<u64, AppError> {
        let pinned = {
            let sessions = self.sessions.lock().await;
            sessions
                .get(session_id)
                .cloned()
                .ok_or_else(|| AppError::state(format!("Session not found: {}", session_id)))?
        };

        let statements = split_sql_statements(sql);
        let mut total_affected: u64 = 0;

        for stmt in &statements {
            let mut session_guard = pinned.lock().await;
            let conn = session_guard
                .as_mut()
                .ok_or_else(|| AppError::state("Session connection was lost"))?;

            let fut = conn.query_drop(stmt.as_str());
            let result = tokio::time::timeout(
                std::time::Duration::from_millis(
                    crate::sql::normalized_query_timeout_ms(timeout_ms),
                ),
                fut,
            )
            .await;

            match result {
                Ok(Ok(())) => {
                    total_affected += conn.affected_rows();
                }
                Ok(Err(e)) => {
                    return Err(AppError::database(format!("Execute error [{}]: {}", stmt, e)));
                }
                Err(_) => {
                    return Err(AppError::database(format!("Execute timed out [{}]", stmt)));
                }
            }
        }

        Ok(total_affected)
    }

    async fn list_databases(&self, session_id: &str) -> Result<Vec<String>, AppError> {
        let pinned = {
            let sessions = self.sessions.lock().await;
            sessions
                .get(session_id)
                .cloned()
                .ok_or_else(|| AppError::state(format!("Session not found: {}", session_id)))?
        };

        let mut guard = pinned.lock().await;
        let conn = guard.as_mut().ok_or_else(|| AppError::state("Session connection was lost"))?;
        let rows: Vec<String> = conn.query("SHOW DATABASES").await?;
        Ok(rows)
    }

    async fn list_tables(
        &self,
        session_id: &str,
        database: &str,
    ) -> Result<Vec<String>, AppError> {
        let pinned = {
            let sessions = self.sessions.lock().await;
            sessions
                .get(session_id)
                .cloned()
                .ok_or_else(|| AppError::state(format!("Session not found: {}", session_id)))?
        };

        let sql = format!("SHOW TABLES FROM `{}`", database);
        let mut guard = pinned.lock().await;
        let conn = guard.as_mut().ok_or_else(|| AppError::state("Session connection was lost"))?;
        let rows: Vec<String> = conn.query(sql).await?;
        Ok(rows)
    }

    async fn list_columns(
        &self,
        session_id: &str,
        database: &str,
        table: &str,
    ) -> Result<Vec<ColumnInfo>, AppError> {
        let pinned = {
            let sessions = self.sessions.lock().await;
            sessions
                .get(session_id)
                .cloned()
                .ok_or_else(|| AppError::state(format!("Session not found: {}", session_id)))?
        };

        let sql = format!("SHOW COLUMNS FROM `{}`.`{}`", database, table);
        let mut guard = pinned.lock().await;
        let conn = guard.as_mut().ok_or_else(|| AppError::state("Session connection was lost"))?;

        // SHOW COLUMNS returns: Field, Type, Null, Key, Default, Extra
        let rows: Vec<(String, String, String, String, Option<String>, String)> =
            conn.query(sql).await?;

        let columns = rows
            .into_iter()
            .map(|(name, col_type, null, key, default_val, extra)| ColumnInfo {
                name,
                col_type,
                nullable: null == "YES",
                key,
                default_val,
                extra,
            })
            .collect();
        Ok(columns)
    }

    async fn get_tables_info(
        &self,
        session_id: &str,
        database: &str,
    ) -> Result<Vec<TableInfo>, AppError> {
        let pinned = {
            let sessions = self.sessions.lock().await;
            sessions
                .get(session_id)
                .cloned()
                .ok_or_else(|| AppError::state(format!("Session not found: {}", session_id)))?
        };

        let query = r#"
            SELECT
                TABLE_NAME,
                TABLE_ROWS,
                (DATA_LENGTH + INDEX_LENGTH) AS size_bytes,
                DATE_FORMAT(CREATE_TIME, '%Y-%m-%d %H:%i:%s') AS CREATE_TIME,
                DATE_FORMAT(UPDATE_TIME, '%Y-%m-%d %H:%i:%s') AS UPDATE_TIME,
                ENGINE,
                TABLE_COMMENT,
                TABLE_TYPE
            FROM information_schema.TABLES
            WHERE TABLE_SCHEMA = :db
            ORDER BY TABLE_NAME
        "#;

        let mut guard = pinned.lock().await;
        let conn = guard.as_mut().ok_or_else(|| AppError::state("Session connection was lost"))?;

        let rows: Vec<(
            String,
            Option<i64>,
            Option<i64>,
            Option<String>,
            Option<String>,
            Option<String>,
            Option<String>,
            String,
        )> = conn
            .exec(query, params! { "db" => database })
            .await?;

        let tables = rows
            .into_iter()
            .map(
                |(name, rows, size_bytes, created, updated, engine, comment, type_)| TableInfo {
                    name,
                    rows,
                    size_bytes,
                    created,
                    updated,
                    engine,
                    comment,
                    type_,
                },
            )
            .collect();
        Ok(tables)
    }

    async fn get_databases_info(&self, session_id: &str) -> Result<Vec<DatabaseInfo>, AppError> {
        let pinned = {
            let sessions = self.sessions.lock().await;
            sessions
                .get(session_id)
                .cloned()
                .ok_or_else(|| AppError::state(format!("Session not found: {}", session_id)))?
        };

        let query = r#"
            SELECT
                s.SCHEMA_NAME,
                COALESCE(SUM(t.DATA_LENGTH + t.INDEX_LENGTH), 0) AS size_bytes,
                COALESCE(SUM(CASE WHEN t.TABLE_TYPE = 'BASE TABLE' THEN 1 ELSE 0 END), 0) AS tables_count,
                COALESCE(SUM(CASE WHEN t.TABLE_TYPE = 'VIEW' THEN 1 ELSE 0 END), 0) AS views_count,
                s.DEFAULT_COLLATION_NAME,
                DATE_FORMAT(MAX(t.UPDATE_TIME), '%Y-%m-%d %H:%i:%s') AS last_modified
            FROM information_schema.SCHEMATA s
            LEFT JOIN information_schema.TABLES t ON t.TABLE_SCHEMA = s.SCHEMA_NAME
            GROUP BY s.SCHEMA_NAME, s.DEFAULT_COLLATION_NAME
            ORDER BY s.SCHEMA_NAME
        "#;

        let mut guard = pinned.lock().await;
        let conn = guard.as_mut().ok_or_else(|| AppError::state("Session connection was lost"))?;

        let rows: Vec<(String, i64, i64, i64, String, Option<String>)> = conn.query(query).await?;

        let dbs = rows
            .into_iter()
            .map(|(name, size_bytes, tables, views, default_collation, last_modified)| DatabaseInfo {
                name,
                size_bytes,
                tables,
                views,
                default_collation,
                last_modified,
            })
            .collect();
        Ok(dbs)
    }
}
