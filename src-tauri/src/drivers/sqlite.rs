// SQLite driver. Implements `DbDriver` using `rusqlite` (bundled C build).
//
// SQLite is synchronous. `rusqlite::Connection` is NOT `Send` (it holds a
// RefCell), so we cannot move it into `spawn_blocking`. Instead we keep one
// `Connection` per profile/session inside a `Mutex<Option<Connection>>` and
// run rusqlite calls inline while holding the guard. The Mutex already
// serializes access, which is correct for SQLite's single-writer model.
//
// Connection target:
//   - file_path set  -> open that file (creates if missing; ":memory:" for
//     an in-memory DB).
//   - file_path empty -> fall back to `host` as a file path, else in-memory.

use std::collections::HashMap;
use std::sync::Arc;

use async_trait::async_trait;
use rusqlite::{Connection, Row};
use tokio::sync::Mutex;

use crate::drivers::{DbType, DbDriver};
use crate::models::{
    ColumnInfo, ConnectParams, ConnectionHandle, DatabaseInfo, QueryResultSet, SessionId, TableInfo,
};
use crate::AppError;

/// A live SQLite connection guarded so it can be shared across async commands.
type ConnSlot = Arc<Mutex<Option<Connection>>>;

pub struct SqliteDriver {
    /// One open connection per connected profile.
    conns: Mutex<HashMap<String, ConnSlot>>,
    /// Pinned connections per session id.
    sessions: Mutex<HashMap<String, ConnSlot>>,
}

impl SqliteDriver {
    pub fn new() -> Self {
        Self {
            conns: Mutex::new(HashMap::new()),
            sessions: Mutex::new(HashMap::new()),
        }
    }

    /// Resolve the SQLite target path from connect params.
    fn resolve_path(params: &ConnectParams) -> String {
        if let Some(ref fp) = params.file_path {
            if !fp.is_empty() {
                return fp.clone();
            }
        }
        if !params.host.is_empty() {
            return params.host.clone();
        }
        ":memory:".to_string()
    }

    /// Open a SQLite connection (blocking).
    fn open(path: &str) -> Result<Connection, AppError> {
        Connection::open(path)
            .map_err(|e| AppError::database(format!("Failed to open SQLite database '{}': {}", path, e)))
    }

    /// Convert a rusqlite ValueRef into serde_json::Value.
    fn value_to_json(row: &Row, idx: usize) -> serde_json::Value {
        use rusqlite::types::ValueRef;
        match row.get_ref(idx) {
            Ok(ValueRef::Null) => serde_json::Value::Null,
            Ok(ValueRef::Integer(i)) => serde_json::Number::from_i128(i as i128)
                .map(serde_json::Value::Number)
                .unwrap_or(serde_json::Value::String(i.to_string())),
            Ok(ValueRef::Real(f)) => serde_json::Number::from_f64(f)
                .map(serde_json::Value::Number)
                .unwrap_or(serde_json::Value::String(f.to_string())),
            Ok(ValueRef::Text(b)) => match String::from_utf8(b.to_vec()) {
                Ok(s) => serde_json::Value::String(s),
                Err(_) => serde_json::Value::String(format!("[binary {} bytes]", b.len())),
            },
            Ok(ValueRef::Blob(b)) => serde_json::Value::String(format!("[blob {} bytes]", b.len())),
            Err(e) => serde_json::Value::String(format!("[error: {}]", e)),
        }
    }
}

#[async_trait]
impl DbDriver for SqliteDriver {
    fn db_type(&self) -> DbType {
        DbType::Sqlite
    }

    async fn connect(&self, params: &ConnectParams) -> Result<ConnectionHandle, AppError> {
        let path = Self::resolve_path(params);
        let conn = Self::open(&path)?;

        let version: String = conn
            .query_row("SELECT sqlite_version()", [], |r| r.get::<_, String>(0))
            .map_err(|e| AppError::database(format!("Failed to query version: {}", e)))?;

        let slot: ConnSlot = Arc::new(Mutex::new(Some(conn)));
        {
            let mut conns = self.conns.lock().await;
            conns.insert(params.profile_id.clone(), slot);
        }

        Ok(ConnectionHandle {
            profile_id: params.profile_id.clone(),
            db_type: "sqlite".to_string(),
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
        let slot = {
            let mut conns = self.conns.lock().await;
            conns.remove(profile_id)
        };
        if let Some(slot) = slot {
            let mut guard = slot.lock().await;
            *guard = None; // close the connection
        }
        Ok(())
    }

    async fn ping(&self, profile_id: &str) -> Result<(), AppError> {
        let slot = {
            let conns = self.conns.lock().await;
            conns
                .get(profile_id)
                .cloned()
                .ok_or_else(|| AppError::state(format!("No connection for profile {}", profile_id)))?
        };
        let guard = slot.lock().await;
        let conn = guard.as_ref().ok_or_else(|| AppError::state("Connection was closed"))?;
        conn.query_row("SELECT 1", [], |_| Ok(()))
            .map_err(|e| AppError::database(format!("Ping failed: {}", e)))?;
        Ok(())
    }

    async fn begin_session(&self, profile_id: &str) -> Result<SessionId, AppError> {
        let slot = {
            let conns = self.conns.lock().await;
            conns
                .get(profile_id)
                .cloned()
                .ok_or_else(|| AppError::state(format!("No connection for profile {}", profile_id)))?
        };
        let session_id = format!("{}:{}", profile_id, uuid::Uuid::new_v4());
        {
            let mut sessions = self.sessions.lock().await;
            sessions.insert(session_id.clone(), slot);
        }
        Ok(session_id)
    }

    async fn end_session(&self, session_id: &str) -> Result<(), AppError> {
        let mut sessions = self.sessions.lock().await;
        sessions.remove(session_id);
        Ok(())
    }

    async fn query(
        &self,
        session_id: &str,
        sql: &str,
        _timeout_ms: Option<u64>,
    ) -> Result<Vec<QueryResultSet>, AppError> {
        let slot = {
            let sessions = self.sessions.lock().await;
            sessions
                .get(session_id)
                .cloned()
                .ok_or_else(|| AppError::state(format!("Session not found: {}", session_id)))?
        };

        // SQLite executes one statement at a time; split to match the
        // multi-statement contract used by MySQL.
        let statements = crate::sql::split_sql_statements(sql);

        let guard = slot.lock().await;
        let conn = guard.as_ref().ok_or_else(|| AppError::state("Connection was lost"))?;

        let mut results = Vec::new();
        for stmt in &statements {
            let mut prepared = conn
                .prepare(stmt)
                .map_err(|e| AppError::database(format!("Query error [{}]: {}", stmt, e)))?;
            let columns: Vec<String> = prepared.column_names().iter().map(|c| c.to_string()).collect();
            let col_count = columns.len();

            let rows = prepared
                .query_map([], |row| {
                    let mut vals = Vec::with_capacity(col_count);
                    for i in 0..col_count {
                        vals.push(SqliteDriver::value_to_json(row, i));
                    }
                    Ok(vals)
                })
                .map_err(|e| AppError::database(format!("Query error [{}]: {}", stmt, e)))?;

            let mut result_rows = Vec::new();
            for r in rows {
                result_rows.push(r.map_err(|e| AppError::database(format!("Row error: {}", e)))?);
            }

            let count = result_rows.len();
            results.push(QueryResultSet {
                columns,
                rows: result_rows,
                affected_rows: count as u64,
                info: format!("{} row(s) returned", count),
            });
        }

        Ok(results)
    }

    async fn execute(
        &self,
        session_id: &str,
        sql: &str,
        _timeout_ms: Option<u64>,
    ) -> Result<u64, AppError> {
        let slot = {
            let sessions = self.sessions.lock().await;
            sessions
                .get(session_id)
                .cloned()
                .ok_or_else(|| AppError::state(format!("Session not found: {}", session_id)))?
        };

        let statements = crate::sql::split_sql_statements(sql);

        let guard = slot.lock().await;
        let conn = guard.as_ref().ok_or_else(|| AppError::state("Connection was lost"))?;

        let mut total_affected: u64 = 0;
        for stmt in &statements {
            conn.execute_batch(stmt)
                .map_err(|e| AppError::database(format!("Execute error [{}]: {}", stmt, e)))?;
            total_affected += conn.changes();
        }

        Ok(total_affected)
    }

    async fn list_databases(&self, _session_id: &str) -> Result<Vec<String>, AppError> {
        // SQLite has a single attached database per connection.
        Ok(vec!["main".to_string()])
    }

    async fn list_tables(&self, session_id: &str, _database: &str) -> Result<Vec<String>, AppError> {
        let slot = {
            let sessions = self.sessions.lock().await;
            sessions
                .get(session_id)
                .cloned()
                .ok_or_else(|| AppError::state(format!("Session not found: {}", session_id)))?
        };
        let guard = slot.lock().await;
        let conn = guard.as_ref().ok_or_else(|| AppError::state("Connection was lost"))?;

        let mut stmt = conn
            .prepare("SELECT name FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY name")
            .map_err(|e| AppError::database(format!("list_tables error: {}", e)))?;
        let rows = stmt
            .query_map([], |r| r.get::<_, String>(0))
            .map_err(|e| AppError::database(format!("list_tables error: {}", e)))?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r.map_err(|e| AppError::database(format!("row error: {}", e)))?);
        }
        Ok(out)
    }

    async fn list_columns(
        &self,
        session_id: &str,
        _database: &str,
        table: &str,
    ) -> Result<Vec<ColumnInfo>, AppError> {
        let slot = {
            let sessions = self.sessions.lock().await;
            sessions
                .get(session_id)
                .cloned()
                .ok_or_else(|| AppError::state(format!("Session not found: {}", session_id)))?
        };
        let table = table.replace('\'', "''");
        let guard = slot.lock().await;
        let conn = guard.as_ref().ok_or_else(|| AppError::state("Connection was lost"))?;

        let mut stmt = conn
            .prepare(&format!("PRAGMA table_info('{}')", table))
            .map_err(|e| AppError::database(format!("list_columns error: {}", e)))?;
        let rows = stmt
            .query_map([], |r| {
                Ok((
                    r.get::<_, String>(1)?,             // name
                    r.get::<_, String>(2)?,             // type
                    r.get::<_, i32>(4)?,                // notnull
                    r.get::<_, Option<String>>(5)?,     // dflt_value
                    r.get::<_, i32>(6)?,                 // pk
                ))
            })
            .map_err(|e| AppError::database(format!("list_columns error: {}", e)))?;

        let mut out = Vec::new();
        for row in rows {
            let (name, col_type, notnull, default_val, pk) =
                row.map_err(|e| AppError::database(format!("row error: {}", e)))?;
            out.push(ColumnInfo {
                name,
                col_type,
                nullable: notnull == 0,
                key: if pk != 0 { "PRI".to_string() } else { String::new() },
                default_val,
                extra: String::new(),
            });
        }
        Ok(out)
    }

    async fn get_tables_info(
        &self,
        session_id: &str,
        _database: &str,
    ) -> Result<Vec<TableInfo>, AppError> {
        let slot = {
            let sessions = self.sessions.lock().await;
            sessions
                .get(session_id)
                .cloned()
                .ok_or_else(|| AppError::state(format!("Session not found: {}", session_id)))?
        };
        let guard = slot.lock().await;
        let conn = guard.as_ref().ok_or_else(|| AppError::state("Connection was lost"))?;

        let mut stmt = conn
            .prepare("SELECT name, type FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY name")
            .map_err(|e| AppError::database(format!("get_tables_info error: {}", e)))?;
        let rows = stmt
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
            .map_err(|e| AppError::database(format!("get_tables_info error: {}", e)))?;

        let mut out = Vec::new();
        for row in rows {
            let (name, ttype) = row.map_err(|e| AppError::database(format!("row error: {}", e)))?;
            out.push(TableInfo {
                name,
                rows: None,
                size_bytes: None,
                created: None,
                updated: None,
                engine: None,
                comment: None,
                type_: if ttype == "view" { "view".to_string() } else { "table".to_string() },
            });
        }
        Ok(out)
    }

    async fn get_databases_info(&self, _session_id: &str) -> Result<Vec<DatabaseInfo>, AppError> {
        Ok(vec![DatabaseInfo {
            name: "main".to_string(),
            size_bytes: 0,
            tables: 0,
            views: 0,
            default_collation: String::new(),
            last_modified: None,
        }])
    }
}
