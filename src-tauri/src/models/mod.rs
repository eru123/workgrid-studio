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
