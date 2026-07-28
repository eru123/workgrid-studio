// SQL Server (MSSQL) driver. Implements `DbDriver` using `tiberius` (async,
// Tokio runtime). A `tiberius::Client` is held per session, mirroring the
// other drivers' session model.
//
// Introspection uses INFORMATION_SCHEMA / sys catalogs. The "database" target
// maps to a SQL Server database name (selected via `USE` on connect / per
// query).

use std::collections::HashMap;
use std::sync::Arc;

use async_trait::async_trait;
use futures_util::TryStreamExt;
use tiberius::{Client, ColumnData, Config, AuthMethod, EncryptionLevel, QueryItem};
use tokio::net::TcpStream;
use tokio::sync::Mutex;
use tokio_util::compat::TokioAsyncWriteCompatExt;

use crate::drivers::{DbType, DbDriver};
use crate::models::{
    ColumnInfo, ConnectParams, ConnectionHandle, DatabaseInfo, QueryResultSet, SessionId, TableInfo,
};
use crate::AppError;

/// Convert a tiberius DATETIME/SMALLDATETIME to an ISO string.
/// DATETIME floors at 1900-01-01; `seconds_fragments` is 1/300s since midnight.
/// SMALLDATETIME floors at 1900-01-01; `seconds_fragments` is minutes since midnight.
fn tiberius_dt_to_string(days: i32, seconds_fragments: u32, is_small: bool) -> String {
    let base = match chrono::NaiveDate::from_ymd_opt(1900, 1, 1) {
        Some(d) => d,
        None => return String::new(),
    };
    let date = base + chrono::Duration::days(days as i64);
    let total_seconds = if is_small {
        (seconds_fragments as i64) * 60
    } else {
        (seconds_fragments as i64 + 150) / 300 // round to nearest second
    };
    let secs = total_seconds.rem_euclid(86400);
    let time = chrono::NaiveTime::from_num_seconds_from_midnight_opt(secs as u32, 0)
        .unwrap_or_else(|| chrono::NaiveTime::from_hms_opt(0, 0, 0).unwrap());
    chrono::NaiveDateTime::new(date, time).to_string()
}

type PinnedConn = Arc<Mutex<Option<Client<tokio_util::compat::Compat<TcpStream>>>>>;

pub struct MssqlDriver {
    /// One client per connected profile (tiberius holds the connection).
    clients: Mutex<HashMap<String, Client<tokio_util::compat::Compat<TcpStream>>>>,
    sessions: Mutex<HashMap<String, PinnedConn>>,
}

impl MssqlDriver {
    pub fn new() -> Self {
        Self {
            clients: Mutex::new(HashMap::new()),
            sessions: Mutex::new(HashMap::new()),
        }
    }

    fn build_config(params: &ConnectParams) -> Result<Config, AppError> {
        let mut config = Config::new();
        config.host(params.host.clone());
        config.port(params.port);
        config.database(params.database.clone().unwrap_or_default());
        // SQL auth (user/password).
        config.authentication(AuthMethod::sql_server(params.user.clone(), params.password.clone()));

        // Encryption: on when enabled, but allow untrusted certs in dev.
        if params.ssl {
            config.encryption(EncryptionLevel::Required);
            config.trust_cert(); // accept self-signed for parity with MySQL's reject_unauthorized=false default
        } else {
            config.encryption(EncryptionLevel::NotSupported);
        }
        Ok(config)
    }

    async fn connect_raw(params: &ConnectParams) -> Result<Client<tokio_util::compat::Compat<TcpStream>>, AppError> {
        let config = Self::build_config(params)?;
        let tcp = TcpStream::connect((params.host.clone(), params.port))
            .await
            .map_err(|e| AppError::database(format!("TCP connect failed: {}", e)))?;
        Client::connect(config, tcp.compat_write())
            .await
            .map_err(|e| AppError::database(format!("MSSQL connect failed: {}", e)))
    }

    /// Convert a ColumnData value to serde_json::Value.
    fn col_to_json(cd: &ColumnData) -> serde_json::Value {
        match cd {
            ColumnData::U8(Some(n)) => serde_json::json!(n),
            ColumnData::I16(Some(n)) => serde_json::json!(n),
            ColumnData::I32(Some(n)) => serde_json::json!(n),
            ColumnData::I64(Some(n)) => serde_json::json!(n),
            ColumnData::F32(Some(f)) => serde_json::json!(f),
            ColumnData::F64(Some(f)) => serde_json::json!(f),
            ColumnData::Bit(Some(b)) => serde_json::Value::Bool(*b),
            ColumnData::String(Some(s)) => serde_json::Value::String(s.to_string()),
            ColumnData::Guid(Some(g)) => serde_json::Value::String(g.to_string()),
            ColumnData::Binary(Some(b)) => {
                serde_json::Value::String(format!("[blob {} bytes]", b.len()))
            }
            ColumnData::Numeric(Some(n)) => serde_json::Value::String(n.to_string()),
            ColumnData::Xml(Some(x)) => serde_json::Value::String(x.to_string()),
            ColumnData::DateTime(Some(d)) => {
                serde_json::Value::String(tiberius_dt_to_string(d.days(), d.seconds_fragments(), false))
            }
            ColumnData::SmallDateTime(Some(d)) => {
                serde_json::Value::String(tiberius_dt_to_string(d.days() as i32, d.seconds_fragments() as u32, true))
            }
            _ => serde_json::Value::Null,
        }
    }

    /// Convert a ColumnData value to an owned String (NULL -> None).
    fn col_to_str(cd: &ColumnData) -> Option<String> {
        match cd {
            ColumnData::U8(Some(n)) => Some(n.to_string()),
            ColumnData::I16(Some(n)) => Some(n.to_string()),
            ColumnData::I32(Some(n)) => Some(n.to_string()),
            ColumnData::I64(Some(n)) => Some(n.to_string()),
            ColumnData::F32(Some(f)) => Some(f.to_string()),
            ColumnData::F64(Some(f)) => Some(f.to_string()),
            ColumnData::Bit(Some(b)) => Some(b.to_string()),
            ColumnData::String(Some(s)) => Some(s.to_string()),
            ColumnData::Guid(Some(g)) => Some(g.to_string()),
            ColumnData::Numeric(Some(n)) => Some(n.to_string()),
            ColumnData::Xml(Some(x)) => Some(x.to_string()),
            ColumnData::DateTime(Some(d)) => {
                Some(tiberius_dt_to_string(d.days(), d.seconds_fragments(), false))
            }
            ColumnData::SmallDateTime(Some(d)) => {
                Some(tiberius_dt_to_string(d.days() as i32, d.seconds_fragments() as u32, true))
            }
            _ => None,
        }
    }

    /// Read a column by index as a String (NULL -> None), via cells().
    fn cell_str(row: &tiberius::Row, i: usize) -> Option<String> {
        row.cells().nth(i).and_then(|(_, cd)| Self::col_to_str(cd))
    }

    /// Read a typed column via FromStr (NULL or parse failure -> None).
    fn cell_parse<T: std::str::FromStr>(row: &tiberius::Row, i: usize) -> Option<T> {
        Self::cell_str(row, i).and_then(|s| s.parse::<T>().ok())
    }

    /// Convert a tiberius row to a Vec of serde_json::Value.
    fn row_to_json(row: &tiberius::Row) -> Vec<serde_json::Value> {
        row.cells().map(|(_, cd)| Self::col_to_json(cd)).collect()
    }
}

#[async_trait]
impl DbDriver for MssqlDriver {
    fn db_type(&self) -> DbType {
        DbType::Mssql
    }

    async fn connect(&self, params: &ConnectParams) -> Result<ConnectionHandle, AppError> {
        let mut client = Self::connect_raw(params).await?;

        // Server version.
        let version_row = client
            .query("SELECT @@VERSION", &[])
            .await
            .map_err(|e| AppError::database(format!("Version query failed: {}", e)))?
            .into_row()
            .await
            .map_err(|e| AppError::database(format!("Version read failed: {}", e)))?;
        let version = version_row
            .as_ref()
            .and_then(|r| Self::cell_str(r, 0))
            .unwrap_or_else(|| "unknown".to_string());

        {
            let mut clients = self.clients.lock().await;
            clients.insert(params.profile_id.clone(), client);
        }

        Ok(ConnectionHandle {
            profile_id: params.profile_id.clone(),
            db_type: "mssql".to_string(),
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
        let mut clients = self.clients.lock().await;
        clients.remove(profile_id);
        Ok(())
    }

    async fn ping(&self, profile_id: &str) -> Result<(), AppError> {
        let mut clients = self.clients.lock().await;
        let client = clients
            .get_mut(profile_id)
            .ok_or_else(|| AppError::state(format!("No connection for profile {}", profile_id)))?;
        client
            .execute("SELECT 1", &[])
            .await
            .map_err(|e| AppError::database(format!("Ping failed: {}", e)))?;
        Ok(())
    }

    async fn begin_session(&self, profile_id: &str) -> Result<SessionId, AppError> {
        // Move the profile's client into the session slot.
        let client = {
            let mut clients = self.clients.lock().await;
            clients
                .remove(profile_id)
                .ok_or_else(|| AppError::state(format!("No connection for profile {}", profile_id)))?
        };
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
            let client_opt = pinned.lock().await.take();
            // Return the client to the profile's pool for reuse.
            if let Some(client) = client_opt {
                let profile_id = session_id.split(':').next().unwrap_or("");
                let mut clients = self.clients.lock().await;
                clients.insert(profile_id.to_string(), client);
            }
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
        let mut guard = pinned.lock().await;
        let client = guard.as_mut().ok_or_else(|| AppError::state("Session connection was lost"))?;

        // tiberius executes batches; multiple result sets come as a stream.
        let mut stream = client
            .query(sql, &[])
            .await
            .map_err(|e| AppError::database(format!("Query error: {}", e)))?;

        let mut results = Vec::new();
        // Process the first result set. tiberius yields QueryItem::Metadata
        // (column info) then QueryItem::Row (data rows).
        let mut columns = Vec::new();
        let mut result_rows = Vec::new();
        while let Some(item) = stream.try_next().await.map_err(|e| AppError::database(format!("Row error: {}", e)))? {
            match item {
                QueryItem::Metadata(meta) => {
                    if columns.is_empty() {
                        columns = meta.columns().iter().map(|c| c.name().to_string()).collect();
                    }
                }
                QueryItem::Row(row) => {
                    if columns.is_empty() {
                        columns = row.columns().iter().map(|c| c.name().to_string()).collect();
                    }
                    result_rows.push(Self::row_to_json(&row));
                }
            }
        }
        let count = result_rows.len();
        results.push(QueryResultSet {
            columns,
            rows: result_rows,
            affected_rows: count as u64,
            info: format!("{} row(s) returned", count),
        });

        Ok(results)
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
        let mut guard = pinned.lock().await;
        let client = guard.as_mut().ok_or_else(|| AppError::state("Session connection was lost"))?;

        client
            .execute(sql, &[])
            .await
            .map_err(|e| AppError::database(format!("Execute error: {}", e)))?;
        Ok(0)
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
        let client = guard.as_mut().ok_or_else(|| AppError::state("Session connection was lost"))?;

        let mut rows = client
            .query("SELECT name FROM sys.databases WHERE database_id > 4 ORDER BY name", &[])
            .await
            .map_err(|e| AppError::database(format!("list_databases error: {}", e)))?;

        let mut out = Vec::new();
        while let Some(item) = rows.try_next().await.map_err(|e| AppError::database(format!("row error: {}", e)))? {
            let row = match item {
                QueryItem::Row(r) => r,
                _ => continue,
            };
            if let Some(name) = Self::cell_str(&row, 0) {
                out.push(name);
            }
        }
        Ok(out)
    }

    async fn list_tables(&self, session_id: &str, database: &str) -> Result<Vec<String>, AppError> {
        let pinned = {
            let sessions = self.sessions.lock().await;
            sessions
                .get(session_id)
                .cloned()
                .ok_or_else(|| AppError::state(format!("Session not found: {}", session_id)))?
        };
        let mut guard = pinned.lock().await;
        let client = guard.as_mut().ok_or_else(|| AppError::state("Session connection was lost"))?;

        let sql = format!(
            "USE [{}]; SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES \
             WHERE TABLE_TYPE IN ('BASE TABLE','VIEW') ORDER BY TABLE_NAME",
            database.replace(']', "]]")
        );
        let mut rows = client
            .query(sql, &[])
            .await
            .map_err(|e| AppError::database(format!("list_tables error: {}", e)))?;

        let mut out = Vec::new();
        while let Some(item) = rows.try_next().await.map_err(|e| AppError::database(format!("row error: {}", e)))? {
            let row = match item {
                QueryItem::Row(r) => r,
                _ => continue,
            };
            if let Some(name) = Self::cell_str(&row, 0) {
                out.push(name);
            }
        }
        Ok(out)
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
        let mut guard = pinned.lock().await;
        let client = guard.as_mut().ok_or_else(|| AppError::state("Session connection was lost"))?;

        let sql = format!(
            "USE [{}]; \
             SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT \
             FROM INFORMATION_SCHEMA.COLUMNS \
             WHERE TABLE_NAME = @P1 ORDER BY ORDINAL_POSITION",
            database.replace(']', "]]")
        );
        let mut rows = client
            .query(sql, &[&table])
            .await
            .map_err(|e| AppError::database(format!("list_columns error: {}", e)))?;

        let mut out = Vec::new();
        while let Some(item) = rows.try_next().await.map_err(|e| AppError::database(format!("row error: {}", e)))? {
            let row = match item {
                QueryItem::Row(r) => r,
                _ => continue,
            };
            out.push(ColumnInfo {
                name: Self::cell_str(&row, 0).unwrap_or_default(),
                col_type: Self::cell_str(&row, 1).unwrap_or_default(),
                nullable: Self::cell_str(&row, 2).as_deref() == Some("YES"),
                key: String::new(),
                default_val: Self::cell_str(&row, 3),
                extra: String::new(),
            });
        }
        Ok(out)
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
        let mut guard = pinned.lock().await;
        let client = guard.as_mut().ok_or_else(|| AppError::state("Session connection was lost"))?;

        let sql = format!(
            "USE [{}]; \
             SELECT t.name, CASE WHEN t.type = 'V' THEN 'view' ELSE 'table' END AS ttype, \
                    SUM(p.rows) AS row_count \
             FROM sys.tables t \
             LEFT JOIN sys.partitions p ON p.object_id = t.object_id AND p.index_id IN (0,1) \
             GROUP BY t.name, t.type \
             UNION ALL \
             SELECT v.name, 'view', 0 FROM sys.views v \
             ORDER BY t.name",
            database.replace(']', "]]")
        );
        let mut rows = client
            .query(sql, &[])
            .await
            .map_err(|e| AppError::database(format!("get_tables_info error: {}", e)))?;

        let mut out = Vec::new();
        while let Some(item) = rows.try_next().await.map_err(|e| AppError::database(format!("row error: {}", e)))? {
            let row = match item {
                QueryItem::Row(r) => r,
                _ => continue,
            };
            out.push(TableInfo {
                name: Self::cell_str(&row, 0).unwrap_or_default(),
                rows: Self::cell_parse::<i64>(&row, 2),
                size_bytes: None,
                created: None,
                updated: None,
                engine: None,
                comment: None,
                type_: Self::cell_str(&row, 1).unwrap_or_else(|| "table".to_string()),
            });
        }
        Ok(out)
    }

    async fn get_databases_info(&self, session_id: &str) -> Result<Vec<DatabaseInfo>, AppError> {
        let pinned = {
            let sessions = self.sessions.lock().await;
            sessions
                .get(session_id)
                .cloned()
                .ok_or_else(|| AppError::state(format!("Session not found: {}", session_id)))?
        };
        let mut guard = pinned.lock().await;
        let client = guard.as_mut().ok_or_else(|| AppError::state("Session connection was lost"))?;

        let mut rows = client
            .query(
                "SELECT name, COALESCE(SUM(size * 8 * 1024), 0) AS size_bytes \
                 FROM sys.databases d \
                 LEFT JOIN sys.master_files f ON f.database_id = d.database_id \
                 WHERE d.database_id > 4 GROUP BY name ORDER BY name",
                &[],
            )
            .await
            .map_err(|e| AppError::database(format!("get_databases_info error: {}", e)))?;

        let mut out = Vec::new();
        while let Some(item) = rows.try_next().await.map_err(|e| AppError::database(format!("row error: {}", e)))? {
            let row = match item {
                QueryItem::Row(r) => r,
                _ => continue,
            };
            out.push(DatabaseInfo {
                name: Self::cell_str(&row, 0).unwrap_or_default(),
                size_bytes: Self::cell_parse::<i64>(&row, 1).unwrap_or(0),
                tables: 0,
                views: 0,
                default_collation: String::new(),
                last_modified: None,
            });
        }
        Ok(out)
    }
}
