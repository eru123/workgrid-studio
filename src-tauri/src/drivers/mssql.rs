// SQL Server (MSSQL) driver — stub. To be implemented with tiberius.

use async_trait::async_trait;

use crate::drivers::{DbType, DbDriver};
use crate::models::{
    ColumnInfo, ConnectParams, ConnectionHandle, DatabaseInfo, QueryResultSet, SessionId, TableInfo,
};
use crate::{AppError, AppResult};

pub struct MssqlDriver;

impl MssqlDriver {
    pub fn new() -> Self {
        Self
    }
}

macro_rules! unimpl {
    ($name:literal) => {
        Err(AppError::not_implemented(concat!($name, " is not implemented for SQL Server yet")))
    };
}

#[async_trait]
impl DbDriver for MssqlDriver {
    fn db_type(&self) -> DbType {
        DbType::Mssql
    }

    async fn connect(&self, _params: &ConnectParams) -> AppResult<ConnectionHandle> {
        unimpl!("connect")
    }
    async fn disconnect(&self, _profile_id: &str) -> AppResult<()> {
        unimpl!("disconnect")
    }
    async fn ping(&self, _profile_id: &str) -> AppResult<()> {
        unimpl!("ping")
    }
    async fn begin_session(&self, _profile_id: &str) -> AppResult<SessionId> {
        unimpl!("begin_session")
    }
    async fn end_session(&self, _session_id: &str) -> AppResult<()> {
        unimpl!("end_session")
    }
    async fn query(
        &self,
        _session_id: &str,
        _sql: &str,
        _timeout_ms: Option<u64>,
    ) -> AppResult<Vec<QueryResultSet>> {
        unimpl!("query")
    }
    async fn execute(
        &self,
        _session_id: &str,
        _sql: &str,
        _timeout_ms: Option<u64>,
    ) -> AppResult<u64> {
        unimpl!("execute")
    }
    async fn list_databases(&self, _session_id: &str) -> AppResult<Vec<String>> {
        unimpl!("list_databases")
    }
    async fn list_tables(&self, _session_id: &str, _database: &str) -> AppResult<Vec<String>> {
        unimpl!("list_tables")
    }
    async fn list_columns(
        &self,
        _session_id: &str,
        _database: &str,
        _table: &str,
    ) -> AppResult<Vec<ColumnInfo>> {
        unimpl!("list_columns")
    }
    async fn get_tables_info(
        &self,
        _session_id: &str,
        _database: &str,
    ) -> AppResult<Vec<TableInfo>> {
        unimpl!("get_tables_info")
    }
    async fn get_databases_info(&self, _session_id: &str) -> AppResult<Vec<DatabaseInfo>> {
        unimpl!("get_databases_info")
    }
}
