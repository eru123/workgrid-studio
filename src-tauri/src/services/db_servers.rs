// Database server registry + connection resolution.
//
// Four connection types share one record shape:
//   tcp       → dial host:port directly
//   docker    → container on the LOCAL docker daemon; the address is
//               resolved at connect time (`docker port`, falling back to the
//               container's bridge IP via `docker inspect`)
//   ssh       → direct-tcpip tunnel through a registered SSH server
//   sshDocker → `docker exec` proxy inside a container on a remote host,
//               reached through a registered SSH server
//
// The registry persists with the same AES-256-GCM whole-file envelope as the
// other registries; the DB password never lands on disk in plaintext.

use std::time::Instant;

use tokio::sync::RwLock;

use crate::models::{
    ConnectParams, ConnectionHandle, DbConnectionType, DbServerDto, DbServerInput,
    DbServerRecord, DbServerTestResult, DockerContainerDto,
};
use crate::services::credentials::CredentialService;
use crate::services::crypto::{decrypt_password, encrypt_password};
use crate::services::files::data_file_path;
use crate::services::ssh_servers::{self, SshServerService};
use crate::ssh::{establish_registry_tunnel, TunnelHandle, TunnelTarget};
use crate::{drivers::create_driver, drivers::DbType, AppError, AppResult};

const SERVERS_FILE: &str = "db_servers.json";

// ---------------------------------------------------------------- - service

#[derive(Debug, Default)]
pub struct DbServerService {
    servers: RwLock<Vec<DbServerRecord>>,
}

impl DbServerService {
    pub async fn new() -> AppResult<Self> {
        let service = Self::default();
        service.load().await?;
        Ok(service)
    }

    async fn load(&self) -> AppResult<()> {
        let path = data_file_path(SERVERS_FILE)?;
        if !path.exists() {
            return Ok(());
        }
        let bytes = std::fs::read(&path)?;
        let json = match String::from_utf8(bytes) {
            Ok(text) if text.starts_with("wkgrd:") => decrypt_password(&text)?,
            Ok(text) => text, // legacy plaintext tolerated
            Err(e) => return Err(AppError::io(e.to_string())),
        };
        let servers: Vec<DbServerRecord> =
            serde_json::from_str(&json).map_err(|e| AppError::io(e.to_string()))?;
        *self.servers.write().await = servers;
        Ok(())
    }

    async fn persist(&self) -> AppResult<()> {
        let servers = self.servers.read().await;
        let json = serde_json::to_string_pretty(&*servers)?;
        let sealed = encrypt_password(&json)?;
        let path = data_file_path(SERVERS_FILE)?;
        let tmp = path.with_extension("tmp");
        std::fs::write(&tmp, sealed.into_bytes())?;
        std::fs::rename(&tmp, path)?;
        Ok(())
    }

    pub async fn list(&self) -> AppResult<Vec<DbServerDto>> {
        Ok(self.servers.read().await.clone())
    }

    pub async fn upsert(&self, input: DbServerInput) -> AppResult<DbServerDto> {
        validate_input(&input)?;
        let now = chrono::Utc::now().to_rfc3339();
        let mut servers = self.servers.write().await;

        if let Some(id) = input.id.as_deref().filter(|id| !id.is_empty()) {
            let existing = servers
                .iter_mut()
                .find(|s| s.id == id)
                .ok_or_else(|| AppError::validation("server not found"))?;
            existing.name = input.name.trim().to_string();
            existing.connection_type = input.connection_type;
            existing.db_type = input.db_type.trim().to_lowercase();
            existing.host = input.host;
            existing.port = input.port;
            existing.database = input.database;
            existing.user = input.user;
            existing.password = input.password;
            existing.ssl = input.ssl;
            existing.docker_container = input.docker_container;
            existing.ssh_server_id = input.ssh_server_id;
            existing.notes = input.notes;
            existing.updated_at = Some(now);
            let out = existing.clone();
            drop(servers);
            self.persist().await?;
            return Ok(out);
        }

        let record = DbServerRecord {
            id: uuid::Uuid::new_v4().to_string(),
            name: input.name.trim().to_string(),
            connection_type: input.connection_type,
            db_type: input.db_type.trim().to_lowercase(),
            host: input.host,
            port: input.port,
            database: input.database,
            user: input.user,
            password: input.password,
            ssl: input.ssl,
            docker_container: input.docker_container,
            ssh_server_id: input.ssh_server_id,
            notes: input.notes,
            created_at: Some(now.clone()),
            updated_at: Some(now),
        };
        servers.push(record.clone());
        drop(servers);
        self.persist().await?;
        Ok(record)
    }

    pub async fn delete(&self, id: &str) -> AppResult<()> {
        let mut servers = self.servers.write().await;
        let before = servers.len();
        servers.retain(|s| s.id != id);
        if servers.len() == before {
            return Err(AppError::validation("server not found"));
        }
        drop(servers);
        self.persist().await
    }

    pub async fn get(&self, id: &str) -> AppResult<DbServerRecord> {
        self.servers
            .read()
            .await
            .iter()
            .find(|s| s.id == id)
            .cloned()
            .ok_or_else(|| AppError::validation("server not found"))
    }
}

// ------------------------------------------------------------- - validation

fn require(value: Option<&String>, field: &str, kind: &str) -> AppResult<String> {
    value
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
        .ok_or_else(|| AppError::validation(format!("{field} is required for {kind} servers")))
}

fn validate_input(input: &DbServerInput) -> AppResult<()> {
    if input.name.trim().is_empty() {
        return Err(AppError::validation("server name is required"));
    }
    if DbConnectionType::parse(&input.connection_type.to_string()).is_none() {
        return Err(AppError::validation(format!(
            "unknown connection type: {}",
            input.connection_type
        )));
    }
    match input.connection_type {
        DbConnectionType::Tcp => {
            require(input.host.as_ref(), "host", "tcp")?;
        }
        DbConnectionType::Docker => {
            require(input.docker_container.as_ref(), "container", "docker")?;
        }
        DbConnectionType::Ssh => {
            require(input.ssh_server_id.as_ref(), "an SSH server", "ssh")?;
        }
        DbConnectionType::SshDocker => {
            require(input.ssh_server_id.as_ref(), "an SSH server", "ssh + docker")?;
            require(input.docker_container.as_ref(), "container", "ssh + docker")?;
        }
    }
    Ok(())
}

/// Sensible default DB port when the record leaves it unset.
pub fn default_port(db_type: &str) -> u16 {
    match DbType::from_str(db_type) {
        DbType::Mysql => 3306,
        DbType::Postgres => 5432,
        DbType::Mssql => 1433,
        DbType::Sqlite => 0,
    }
}

// ---------------------------------------------------- - connection resolution

/// Everything the ConnectionManager needs to dial one database server.
pub struct ResolvedConnection {
    pub params: ConnectParams,
    pub tunnel: Option<TunnelHandle>,
    /// Human-readable path (docker lookups, ssh hops) for test results.
    pub path: Vec<String>,
}

/// Turn an (possibly unsaved) input into a pseudo-record so tests resolve
/// exactly like saved servers.
fn coalesce(input: &DbServerInput) -> DbServerRecord {
    DbServerRecord {
        id: input.id.clone().unwrap_or_default(),
        name: input.name.trim().to_string(),
        connection_type: input.connection_type,
        db_type: input.db_type.trim().to_lowercase(),
        host: input.host.clone(),
        port: input.port,
        database: input.database.clone(),
        user: input.user.clone(),
        password: input.password.clone(),
        ssl: input.ssl,
        docker_container: input.docker_container.clone(),
        ssh_server_id: input.ssh_server_id.clone(),
        notes: input.notes.clone(),
        created_at: None,
        updated_at: None,
    }
}

/// Resolve a saved record into driver-ready params (+ live tunnel if any).
pub async fn resolve_connection(
    server: &DbServerRecord,
    ssh: &SshServerService,
    vault: &CredentialService,
) -> AppResult<ResolvedConnection> {
    validate_input(&DbServerInput::from(server))?;
    let mut path: Vec<String> = vec![];
    let db_port = server
        .port
        .or(Some(default_port(&server.db_type)))
        .filter(|p| *p > 0)
        .ok_or_else(|| AppError::validation("port is required"))?;

    let base_params = |host: String, port: u16| ConnectParams {
        profile_id: if server.id.is_empty() {
            format!("srv-{}", uuid::Uuid::new_v4())
        } else {
            format!("srv-{}", server.id)
        },
        host,
        port,
        user: server.user.clone().unwrap_or_default(),
        password: server.password.clone().unwrap_or_default(),
        database: server.database.clone(),
        file_path: None,
        ssl: server.ssl.unwrap_or(false),
        ssl_ca_file: None,
        ssl_cert_file: None,
        ssl_key_file: None,
        ssl_reject_unauthorized: true,
        db_type: server.db_type.clone(),
        ssh: false,
        ssh_host: None,
        ssh_port: None,
        ssh_user: None,
        ssh_password: None,
        ssh_key_file: None,
        ssh_passphrase: None,
        ssh_strict_key_checking: false,
        ssh_keep_alive_interval: 0,
        ssh_compression: false,
        use_docker: false,
        docker_container: None,
        connection_verbose_logging: false,
    };

    match server.connection_type {
        DbConnectionType::Tcp => {
            let host = server.host.clone().unwrap_or_default();
            path.push(format!("direct tcp → {host}:{db_port}"));
            Ok(ResolvedConnection {
                params: base_params(host, db_port),
                tunnel: None,
                path,
            })
        }
        DbConnectionType::Docker => {
            let container = server.docker_container.clone().unwrap_or_default();
            let ((host, port), via) =
                resolve_local_docker_target(&container, db_port).await?;
            path.push(format!("docker: {via}"));
            Ok(ResolvedConnection {
                params: base_params(host, port),
                tunnel: None,
                path,
            })
        }
        DbConnectionType::Ssh | DbConnectionType::SshDocker => {
            let ssh_id = server.ssh_server_id.clone().unwrap_or_default();
            let ssh_record = ssh.get(&ssh_id).await?;
            let ssh_input = crate::models::SshServerInput::from(&ssh_record);
            path.extend(ssh_servers_ssh_label(&ssh_record, &ssh_input));
            let target = if server.connection_type == DbConnectionType::SshDocker {
                let container = server.docker_container.clone().unwrap_or_default();
                path.push(format!(
                    "docker exec proxy in {container} → 127.0.0.1:{db_port}"
                ));
                TunnelTarget::Docker { container, port: db_port }
            } else {
                // DB host as seen from the SSH host; 127.0.0.1 = same box.
                let host = server
                    .host
                    .clone()
                    .filter(|h| !h.trim().is_empty())
                    .unwrap_or_else(|| "127.0.0.1".to_string());
                path.push(format!("forward → {host}:{db_port}"));
                TunnelTarget::Direct { host, port: db_port }
            };
            let tunnel = establish_registry_tunnel(&ssh_input, vault, target).await?;
            let local = format!("127.0.0.1:{}", tunnel.local_port);
            path.push(format!("local tunnel {local}"));
            Ok(ResolvedConnection {
                params: base_params("127.0.0.1".to_string(), tunnel.local_port),
                tunnel: Some(tunnel),
                path,
            })
        }
    }
}

/// The ssh hops description shared with ssh test results (jump chain label).
fn ssh_servers_ssh_label(
    record: &crate::models::SshServerRecord,
    input: &crate::models::SshServerInput,
) -> Vec<String> {
    let mut out = vec![format!(
        "ssh {}:{} (user via identity)",
        record.host,
        input.port.unwrap_or(22)
    )];
    if let Some(jump) = input.proxy_jump.as_deref().filter(|j| !j.trim().is_empty()) {
        out.push(format!("proxy-jump: {jump}"));
    }
    if let Some(cmd) = input.proxy_command.as_deref().filter(|c| !c.trim().is_empty()) {
        out.push(format!("proxy-command: {cmd}"));
    }
    out
}

// ------------------------------------------------------------- - local docker

/// Run a local docker CLI command and capture stdout.
async fn run_docker(args: &[&str]) -> AppResult<String> {
    let output = tokio::process::Command::new("docker")
        .args(args)
        .output()
        .await
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                AppError::io(
                    "docker CLI not found on PATH — install docker, or use a TCP/SSH \
                     connection type instead"
                        .to_string(),
                )
            } else {
                AppError::io(format!("could not run docker: {e}"))
            }
        })?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(AppError::io(format!("docker {} failed: {}", args.join(" "), stderr)));
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

/// Parse one `docker port` output line (`0.0.0.0:32768`, `:::32768`,
/// `192.168.1.5:3306`, `[::1]:3306`) into a dialable host:port.
fn parse_published(line: &str) -> Option<(String, u16)> {
    let line = line.trim();
    if line.is_empty() {
        return None;
    }
    // IPv6 bracket form.
    if let Some(rest) = line.strip_prefix('[') {
        let (host, tail) = rest.split_once(']')?;
        let port = tail.trim_start_matches(':').parse().ok()?;
        return Some((host.to_string(), port));
    }
    if let Some(rest) = line.strip_prefix(":::") {
        // IPv6 wildcard — dial localhost instead.
        return Some(("127.0.0.1".to_string(), rest.parse().ok()?));
    }
    let (host, port) = line.rsplit_once(':')?;
    let port: u16 = port.parse().ok()?;
    let host = if host == "0.0.0.0" { "127.0.0.1".to_string() } else { host.to_string() };
    Some((host, port))
}

/// Resolve a local container to a dialable address: published port first,
/// then the container's bridge IP at the internal port.
async fn resolve_local_docker_target(container: &str, internal_port: u16) -> AppResult<((String, u16), String)> {
    // 1. Published port (works on every daemon incl. rootless / VM based).
    if let Ok(out) = run_docker(&["port", container, &format!("{internal_port}/tcp")]).await {
        if let Some((host, port)) = out.lines().find_map(parse_published) {
            return Ok((
                (host.clone(), port),
                format!("published port 127.0.0.1-style {host}:{port} for {container}"),
            ));
        }
    }
    // 2. Container IP on the docker bridge (Linux, unpublished containers).
    let ip = run_docker(&[
        "inspect",
        "-f",
        "{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}",
        container,
    ])
    .await?
    .trim()
    .to_string();
    if ip.is_empty() {
        return Err(AppError::io(format!(
            "container {container} has no IP on any docker network and port \
             {internal_port} is not published — publish it (-p) or check the container"
        )));
    }
    Ok((
        (ip.clone(), internal_port),
        format!("bridge ip {ip}:{internal_port} for {container}"),
    ))
}

/// `docker ps` on the local daemon.
pub async fn list_local_containers() -> AppResult<Vec<DockerContainerDto>> {
    let out = run_docker(&["ps", "--format", "{{.Names}}\t{{.Image}}"]).await?;
    ssh_servers::parse_container_lines(&out)
}

// -------------------------------------------------------------- - test/connect

/// Test a (possibly unsaved) server: resolve, dial, report — then tear down.
pub async fn test_db_server(
    input: &DbServerInput,
    ssh: &SshServerService,
    vault: &CredentialService,
) -> AppResult<DbServerTestResult> {
    let started = Instant::now();
    let record = coalesce(input);
    let resolved = resolve_connection(&record, ssh, vault).await?;
    let db_type = DbType::from_str(&record.db_type);
    let driver = create_driver(db_type);
    let connect_result = driver.connect(&resolved.params).await;

    // Always tear the tunnel down — the driver pool dies with drop, but the
    // tunnel task needs an explicit shutdown.
    let handle = match connect_result {
        Ok(handle) => handle,
        Err(e) => {
            if let Some(tunnel) = resolved.tunnel {
                tunnel.shutdown().await;
            }
            return Err(e);
        }
    };
    if let Some(tunnel) = resolved.tunnel {
        tunnel.shutdown().await;
    }
    let latency = started.elapsed().as_millis() as u64;

    Ok(DbServerTestResult {
        ok: true,
        message: format!(
            "Connected to {} ({}) in {} ms",
            record.name,
            resolved.params.host,
            latency
        ),
        latency_ms: Some(latency),
        resolved_address: Some(format!("{}:{}", resolved.params.host, resolved.params.port)),
        server_version: handle.server_version.clone().non_empty(),
        path: resolved.path,
    })
}

/// Connect through the manager, attaching the resolved tunnel for teardown.
pub async fn connect_db_server(
    manager: &crate::services::connection::ConnectionManager,
    server: &DbServerRecord,
    ssh: &SshServerService,
    vault: &CredentialService,
) -> AppResult<ConnectionHandle> {
    let resolved = resolve_connection(server, ssh, vault).await?;
    manager.connect_resolved(&resolved.params, resolved.tunnel).await
}

// Helper: Option<String> → Option<String> keeping non-empty only.
trait NonEmpty {
    fn non_empty(self) -> Option<String>;
}
impl NonEmpty for String {
    fn non_empty(self) -> Option<String> {
        if self.trim().is_empty() { None } else { Some(self) }
    }
}

// ------------------------------------------------------------------- - tests

#[cfg(test)]
mod tests {
    use super::*;

    static HOME_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
    struct TempHome(std::path::PathBuf, #[allow(dead_code)] Option<std::sync::MutexGuard<'static, ()>>);
    impl TempHome {
        fn new() -> Self {
            let guard = HOME_LOCK.lock().unwrap_or_else(|p| p.into_inner());
            let dir = std::env::temp_dir().join(format!("workgrid-dbserver-test-{}", uuid::Uuid::new_v4()));
            std::fs::create_dir_all(&dir).unwrap();
            std::env::set_var("HOME", &dir);
            Self(dir, Some(guard))
        }
    }
    impl Drop for TempHome {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[tokio::test]
    async fn db_server_registry_round_trip_encrypted() {
        let _home = TempHome::new();
        let service = DbServerService::default();
        let created = service
            .upsert(DbServerInput {
                id: None,
                name: "prod mysql".into(),
                connection_type: DbConnectionType::Ssh,
                db_type: "mysql".into(),
                host: Some("db.internal".into()),
                port: Some(3306),
                database: Some("app".into()),
                user: Some("root".into()),
                password: Some("s3cret".into()),
                ssl: Some(false),
                docker_container: None,
                ssh_server_id: Some("ssh-1".into()),
                notes: Some("behind bastion".into()),
            })
            .await
            .unwrap();
        assert!(!created.id.is_empty());

        let reloaded = DbServerService::new().await.unwrap();
        let list = reloaded.list().await.unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].name, "prod mysql");
        assert_eq!(list[0].connection_type, DbConnectionType::Ssh);
        assert_eq!(list[0].password.as_deref(), Some("s3cret"));

        // Encrypted at rest.
        let bytes = std::fs::read(data_file_path(SERVERS_FILE).unwrap()).unwrap();
        let text = String::from_utf8(bytes).unwrap();
        assert!(text.starts_with("wkgrd:"));
        assert!(!text.contains("s3cret"));
        assert!(!text.contains("prod mysql"));

        // Update + delete.
        let mut input = DbServerInput::from(&list[0]);
        input.connection_type = DbConnectionType::Docker;
        input.docker_container = Some("mysql-8".into());
        input.ssh_server_id = None;
        let updated = reloaded.upsert(input).await.unwrap();
        assert_eq!(updated.connection_type, DbConnectionType::Docker);
        reloaded.delete(&updated.id).await.unwrap();
        assert!(reloaded.list().await.unwrap().is_empty());
    }

    #[test]
    fn validates_each_connection_type() {
        let base = DbServerInput {
            id: None,
            name: "x".into(),
            connection_type: DbConnectionType::Tcp,
            db_type: "mysql".into(),
            host: None,
            port: None,
            database: None,
            user: None,
            password: None,
            ssl: None,
            docker_container: None,
            ssh_server_id: None,
            notes: None,
        };
        assert!(validate_input(&base).is_err(), "tcp needs a host");
        assert!(validate_input(&DbServerInput { host: Some("h".into()), ..base.clone() }).is_ok());

        let docker = DbServerInput { connection_type: DbConnectionType::Docker, ..base.clone() };
        assert!(validate_input(&docker).is_err(), "docker needs a container");
        assert!(validate_input(&DbServerInput {
            connection_type: DbConnectionType::Docker,
            docker_container: Some("c".into()),
            ..base.clone()
        })
        .is_ok());

        let ssh = DbServerInput { connection_type: DbConnectionType::Ssh, ..base.clone() };
        assert!(validate_input(&ssh).is_err(), "ssh needs a server id");
        assert!(validate_input(&DbServerInput {
            connection_type: DbConnectionType::SshDocker,
            ssh_server_id: Some("s".into()),
            docker_container: Some("c".into()),
            ..base
        })
        .is_ok());
    }

    #[test]
    fn parses_docker_published_ports() {
        assert_eq!(parse_published("0.0.0.0:32768"), Some(("127.0.0.1".into(), 32768)));
        assert_eq!(parse_published(":::32768"), Some(("127.0.0.1".into(), 32768)));
        assert_eq!(parse_published("192.168.1.5:3306"), Some(("192.168.1.5".into(), 3306)));
        assert_eq!(parse_published("[::1]:3306"), Some(("::1".into(), 3306)));
        assert_eq!(parse_published(""), None);
        assert_eq!(parse_published("garbage"), None);
    }

    #[test]
    fn default_ports_by_db_type() {
        assert_eq!(default_port("mysql"), 3306);
        assert_eq!(default_port("postgres"), 5432);
        assert_eq!(default_port("mssql"), 1433);
    }
}
