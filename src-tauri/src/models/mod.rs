// Serde data models. All structs use camelCase to match the TypeScript
// interfaces exactly (serde defaults to snake_case which would not match).

use serde::{Deserialize, Serialize};

//  ------ Query results (universal across drivers)

#[derive(Debug, Clone, Serialize)]
pub struct QueryResultSet {
    #[serde(rename = "columns")]
    pub columns: Vec<String>,
    #[serde(rename = "rows")]
    pub rows: Vec<Vec<serde_json::Value>>,
    #[serde(rename = "affectedRows")]
    pub affected_rows: u64,
    #[serde(rename = "info")]
    pub info: String,
}

//  ------ Schema introspection

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ColumnInfo {
    pub name: String,
    pub col_type: String,
    pub nullable: bool,
    pub key: String,
    pub default_val: Option<String>,
    pub extra: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TableInfo {
    pub name: String,
    pub rows: Option<i64>,
    pub size_bytes: Option<i64>,
    pub created: Option<String>,
    pub updated: Option<String>,
    pub engine: Option<String>,
    pub comment: Option<String>,
    #[serde(rename = "type_")]
    pub type_: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseInfo {
    pub name: String,
    pub size_bytes: i64,
    pub tables: i64,
    pub views: i64,
    pub default_collation: String,
    pub last_modified: Option<String>,
}

//  ------ Tree (matches TreeNode in BackendAdapter.ts)

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TreeBadge {
    pub text: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tooltip: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TreeNode {
    pub id: String,
    pub label: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tooltip: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub badges: Option<Vec<TreeBadge>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub collapsible: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data: Option<serde_json::Value>,
}

//  ------ Connection params (matches the legacy ConnectParams, camelCase)

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectParams {
    pub profile_id: String,
    pub host: String,
    pub port: u16,
    pub user: String,
    #[serde(default)]
    pub password: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub database: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub file_path: Option<String>,
    #[serde(default)]
    pub ssl: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ssl_ca_file: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ssl_cert_file: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ssl_key_file: Option<String>,
    #[serde(default)]
    pub ssl_reject_unauthorized: bool,
    #[serde(default)]
    pub db_type: String,
    #[serde(default)]
    pub ssh: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ssh_host: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ssh_port: Option<u16>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ssh_user: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ssh_password: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ssh_key_file: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ssh_passphrase: Option<String>,
    #[serde(default)]
    pub ssh_strict_key_checking: bool,
    #[serde(default)]
    pub ssh_keep_alive_interval: u32,
    #[serde(default = "default_true")]
    pub ssh_compression: bool,
    #[serde(default)]
    pub use_docker: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub docker_container: Option<String>,
    #[serde(default)]
    pub connection_verbose_logging: bool,
}

fn default_true() -> bool {
    true
}

//  ------ Connection / session handles

/// Opaque handle to a connected database (a pool + profile metadata).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionHandle {
    pub profile_id: String,
    pub db_type: String,
    pub server_version: String,
}

/// Opaque session id (a pinned connection for cross-command affinity).
pub type SessionId = String;

//  ------ Credentials store (SSH identities)

// The vault stores SSH identities (user + private key path + passphrase)
// consumed later by the SSH server / tunnel connections. `Unknown` only
// appears when loading files written by the old generic-credential schema.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CredentialKind {
    Ssh,
    Unknown,
}

// Wire format is lowercase ("ssh" | "unknown"); Display and FromStr keep
// that contract so kinds round-trip through persistence and DTOs unchanged.
impl std::fmt::Display for CredentialKind {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let s = match self {
            CredentialKind::Ssh => "ssh",
            CredentialKind::Unknown => "unknown",
        };
        write!(f, "{s}")
    }
}

impl std::str::FromStr for CredentialKind {
    type Err = ();
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        Ok(match s.to_ascii_lowercase().as_str() {
            "ssh" => CredentialKind::Ssh,
            _ => CredentialKind::Unknown,
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CredentialFields {
    /// SSH user the identity logs in as.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub user: Option<String>,
    /// SSH user password (password authentication). Secret: sealed at rest.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub password: Option<String>,
    /// Private key file contents. Secret: sealed at rest.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub private_key: Option<String>,
    /// Where the key was loaded from (provenance only; the contents live in
    /// `private_key`). Not a secret.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub private_key_path: Option<String>,
    /// Passphrase protecting the private key. Secret: sealed at rest.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub passphrase: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum CredentialNode {
    Folder {
        id: String,
        parent_id: Option<String>,
        name: String,
        description: Option<String>,
        #[serde(default)]
        expanded: bool,
        #[serde(default)]
        children: Vec<CredentialNode>,
    },
    Entry {
        id: String,
        parent_id: Option<String>,
        kind: CredentialKind,
        name: String,
        fields: CredentialFields,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        description: Option<String>,
        created_at: Option<String>,
        updated_at: Option<String>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CredentialNodeDto {
    pub id: String,
    #[serde(rename = "type")]
    pub node_type: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default)]
    pub kind: Option<String>,
    #[serde(default)]
    pub children: Option<Vec<CredentialNodeDto>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CredentialEntryDto {
    pub id: String,
    pub parent_id: Option<String>,
    pub kind: String,
    pub name: String,
    pub fields: CredentialFields,
    pub description: Option<String>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CredentialEntryInput {
    /// Existing entry id to update in place. None/null creates a new entry.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    pub parent_id: Option<String>,
    pub kind: String,
    pub name: String,
    pub fields: CredentialFields,
    pub description: Option<String>,
}

//  ------ SSH servers

/// A saved SSH server definition. Authentication delegates to a vault
/// identity (SSHIdentity entry); the record itself holds no secrets, so the
/// whole connection setup is reproducible from vault + server record.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshServerRecord {
    pub id: String,
    pub name: String,
    pub host: String,
    #[serde(default)]
    pub port: Option<u16>,
    /// Vault identity used for user/key/password material.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub identity_id: Option<String>,
    /// Overrides the identity's user for this server (and its jumps).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub user: Option<String>,
    /// Direct private-key path bypassing the vault (legacy setups).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub private_key_path: Option<String>,
    /// ProxyJump chain — comma-separated `host` / `user@host` / `host:port`
    /// / `user@host:port` hops, applied in order.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub proxy_jump: Option<String>,
    /// Raw ProxyCommand; `%h` and `%p` are substituted before execution.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub proxy_command: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub connect_timeout_secs: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub keepalive_interval_secs: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub keepalive_count: Option<u32>,
    /// Stored for completeness; russh does not negotiate compression.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub compression: Option<bool>,
    /// "accept-new" (TOFU, default) | "yes" (strict) | "no" (accept any).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub strict_host_key: Option<String>,
    /// Arbitrary extra OpenSSH options (name → value), stored verbatim so
    /// complicated setups keep every parameter in one place.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub extra_options: Option<serde_json::Map<String, serde_json::Value>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub created_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<String>,
}

pub type SshServerDto = SshServerRecord;

/// Create/update payload. `id: None` creates; a supplied id updates in place.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshServerInput {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    pub name: String,
    pub host: String,
    #[serde(default)]
    pub port: Option<u16>,
    #[serde(default)]
    pub identity_id: Option<String>,
    #[serde(default)]
    pub user: Option<String>,
    #[serde(default)]
    pub private_key_path: Option<String>,
    #[serde(default)]
    pub proxy_jump: Option<String>,
    #[serde(default)]
    pub proxy_command: Option<String>,
    #[serde(default)]
    pub connect_timeout_secs: Option<u64>,
    #[serde(default)]
    pub keepalive_interval_secs: Option<u64>,
    #[serde(default)]
    pub keepalive_count: Option<u32>,
    #[serde(default)]
    pub compression: Option<bool>,
    #[serde(default)]
    pub strict_host_key: Option<String>,
    #[serde(default)]
    pub extra_options: Option<serde_json::Map<String, serde_json::Value>>,
    #[serde(default)]
    pub notes: Option<String>,
}

impl From<&SshServerRecord> for SshServerInput {
    fn from(r: &SshServerRecord) -> Self {
        Self {
            id: Some(r.id.clone()),
            name: r.name.clone(),
            host: r.host.clone(),
            port: r.port,
            identity_id: r.identity_id.clone(),
            user: r.user.clone(),
            private_key_path: r.private_key_path.clone(),
            proxy_jump: r.proxy_jump.clone(),
            proxy_command: r.proxy_command.clone(),
            connect_timeout_secs: r.connect_timeout_secs,
            keepalive_interval_secs: r.keepalive_interval_secs,
            keepalive_count: r.keepalive_count,
            compression: r.compression,
            strict_host_key: r.strict_host_key.clone(),
            extra_options: r.extra_options.clone(),
            notes: r.notes.clone(),
        }
    }
}

/// Outcome of a Test Connection run.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshTestResult {
    pub ok: bool,
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub latency_ms: Option<u64>,
    /// Which authentication method succeeded ("publickey" | "password").
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auth_used: Option<String>,
    /// SHA256 fingerprint of the server host key.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub host_fingerprint: Option<String>,
    /// Human-readable description of the connection path taken.
    #[serde(default)]
    pub hops: Vec<String>,
}

//  ------ Database servers

/// How a database server is reached.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub enum DbConnectionType {
    /// Direct TCP to host:port.
    #[default]
    #[serde(rename = "tcp")]
    Tcp,
    /// Container on the local Docker daemon; address resolved via
    /// `docker port` / `docker inspect` at connect time.
    #[serde(rename = "docker")]
    Docker,
    /// Database reachable from a registered SSH server (direct-tcpip tunnel).
    #[serde(rename = "ssh")]
    Ssh,
    /// Container on a remote Docker daemon, reached by `docker exec` over a
    /// registered SSH server.
    #[serde(rename = "sshDocker")]
    SshDocker,
}

impl std::fmt::Display for DbConnectionType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let s = match self {
            DbConnectionType::Tcp => "tcp",
            DbConnectionType::Docker => "docker",
            DbConnectionType::Ssh => "ssh",
            DbConnectionType::SshDocker => "sshDocker",
        };
        f.write_str(s)
    }
}

impl DbConnectionType {
    /// Case-insensitive parse, tolerating "ssh_docker"/"ssh-docker" aliases.
    pub fn parse(value: &str) -> Option<Self> {
        match value.trim().to_ascii_lowercase().as_str() {
            "tcp" | "direct" => Some(DbConnectionType::Tcp),
            "docker" | "docker-local" => Some(DbConnectionType::Docker),
            "ssh" => Some(DbConnectionType::Ssh),
            "sshdocker" | "ssh_docker" | "ssh-docker" | "docker-ssh" => {
                Some(DbConnectionType::SshDocker)
            }
            _ => None,
        }
    }
}

/// A saved database server. The record stores the connection recipe per
/// connection type; the DB password is stored only inside the encrypted
/// registry file (same AES-256-GCM envelope as the rest of the data dir).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DbServerRecord {
    pub id: String,
    pub name: String,
    pub connection_type: DbConnectionType,
    /// mysql | postgres | sqlite | mssql (DbType string).
    pub db_type: String,
    /// TCP: DB host. SSH: DB host as reachable from the SSH host
    /// (defaults to 127.0.0.1). Unused for docker types.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub host: Option<String>,
    /// DB port. For docker types this is the container-internal port.
    #[serde(default)]
    pub port: Option<u16>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub database: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub user: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub password: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ssl: Option<bool>,
    /// docker / sshDocker: container name or id.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub docker_container: Option<String>,
    /// ssh / sshDocker: registered SSH server (SshServerRecord id).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ssh_server_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub created_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<String>,
}

pub type DbServerDto = DbServerRecord;

/// Create/update payload. `id: None` creates; a supplied id updates in place.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DbServerInput {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    pub name: String,
    #[serde(default)]
    pub connection_type: DbConnectionType,
    #[serde(default)]
    pub db_type: String,
    #[serde(default)]
    pub host: Option<String>,
    #[serde(default)]
    pub port: Option<u16>,
    #[serde(default)]
    pub database: Option<String>,
    #[serde(default)]
    pub user: Option<String>,
    #[serde(default)]
    pub password: Option<String>,
    #[serde(default)]
    pub ssl: Option<bool>,
    #[serde(default)]
    pub docker_container: Option<String>,
    #[serde(default)]
    pub ssh_server_id: Option<String>,
    #[serde(default)]
    pub notes: Option<String>,
}

impl From<&DbServerRecord> for DbServerInput {
    fn from(r: &DbServerRecord) -> Self {
        Self {
            id: Some(r.id.clone()),
            name: r.name.clone(),
            connection_type: r.connection_type,
            db_type: r.db_type.clone(),
            host: r.host.clone(),
            port: r.port,
            database: r.database.clone(),
            user: r.user.clone(),
            password: r.password.clone(),
            ssl: r.ssl,
            docker_container: r.docker_container.clone(),
            ssh_server_id: r.ssh_server_id.clone(),
            notes: r.notes.clone(),
        }
    }
}

/// Outcome of a database server test / connect.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DbServerTestResult {
    pub ok: bool,
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub latency_ms: Option<u64>,
    /// The address the driver actually dialed (post tunnel/docker resolution).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resolved_address: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub server_version: Option<String>,
    /// Human-readable connection path (jumps, docker lookups, tunnels).
    #[serde(default)]
    pub path: Vec<String>,
}

/// A container entry as listed by `docker ps` (local or remote).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DockerContainerDto {
    pub name: String,
    pub image: String,
}
