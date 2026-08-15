// SSH server registry + Test Connection.
//
// Server records reference vault identities (no secrets here); the registry
// is persisted with the same AES-256-GCM whole-file envelope as the vault.
// Test Connection resolves the identity, then builds the connection path:
//   direct TCP | ProxyJump chain (direct-tcpip channels) | ProxyCommand
// authenticates (publickey then password), and reports latency, auth method
// and host-key fingerprint.

use std::pin::Pin;
use std::sync::Arc;
use std::time::{Duration, Instant};

use russh::client;
use russh::keys::{PrivateKey, PrivateKeyWithHashAlg};
use tokio::io::{AsyncRead, AsyncWrite, ReadBuf};
use tokio::sync::RwLock;

use crate::models::{SshServerDto, SshServerInput, SshServerRecord, SshTestResult};
use crate::services::credentials::CredentialService;
use crate::services::crypto::{decrypt_password, encrypt_password};
use crate::services::files::data_file_path;
use crate::ssh::SshClientHandler;
use crate::{AppError, AppResult};

const SERVERS_FILE: &str = "ssh_servers.json";

// ---------------------------------------------------------------- - service

#[derive(Debug, Default)]
pub struct SshServerService {
    servers: RwLock<Vec<SshServerRecord>>,
}

impl SshServerService {
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
        let servers: Vec<SshServerRecord> =
            serde_json::from_str(&json).map_err(|e| AppError::io(e.to_string()))?;
        *self.servers.write().await = servers;
        Ok(())
    }

    async fn persist(&self) -> AppResult<()> {
        let servers = self.servers.read().await;
        let json = serde_json::to_string_pretty(&*servers)?;
        let sealed = encrypt_password(&json)?;
        let path = data_file_path(SERVERS_FILE)?;
        atomic_write(path, sealed.into_bytes())
    }

    pub async fn list(&self) -> AppResult<Vec<SshServerDto>> {
        Ok(self.servers.read().await.clone())
    }

    pub async fn upsert(&self, input: SshServerInput) -> AppResult<SshServerDto> {
        if input.name.trim().is_empty() {
            return Err(AppError::validation("server name is required"));
        }
        if input.host.trim().is_empty() {
            return Err(AppError::validation("host is required"));
        }
        let now = chrono::Utc::now().to_rfc3339();
        let mut servers = self.servers.write().await;

        if let Some(id) = input.id.as_deref().filter(|id| !id.is_empty()) {
            let existing = servers
                .iter_mut()
                .find(|s| s.id == id)
                .ok_or_else(|| AppError::validation("server not found"))?;
            existing.name = input.name.trim().to_string();
            existing.host = input.host.trim().to_string();
            existing.port = input.port;
            existing.identity_id = input.identity_id;
            existing.user = input.user;
            existing.private_key_path = input.private_key_path;
            existing.proxy_jump = input.proxy_jump;
            existing.proxy_command = input.proxy_command;
            existing.connect_timeout_secs = input.connect_timeout_secs;
            existing.keepalive_interval_secs = input.keepalive_interval_secs;
            existing.keepalive_count = input.keepalive_count;
            existing.compression = input.compression;
            existing.strict_host_key = input.strict_host_key;
            existing.extra_options = input.extra_options;
            existing.notes = input.notes;
            existing.updated_at = Some(now);
            let out = existing.clone();
            drop(servers);
            self.persist().await?;
            return Ok(out);
        }

        let record = SshServerRecord {
            id: uuid::Uuid::new_v4().to_string(),
            name: input.name.trim().to_string(),
            host: input.host.trim().to_string(),
            port: input.port,
            identity_id: input.identity_id,
            user: input.user,
            private_key_path: input.private_key_path,
            proxy_jump: input.proxy_jump,
            proxy_command: input.proxy_command,
            connect_timeout_secs: input.connect_timeout_secs,
            keepalive_interval_secs: input.keepalive_interval_secs,
            keepalive_count: input.keepalive_count,
            compression: input.compression,
            strict_host_key: input.strict_host_key,
            extra_options: input.extra_options,
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

    pub async fn get(&self, id: &str) -> AppResult<SshServerRecord> {
        self.servers
            .read()
            .await
            .iter()
            .find(|s| s.id == id)
            .cloned()
            .ok_or_else(|| AppError::validation("server not found"))
    }
}

fn atomic_write(path: std::path::PathBuf, bytes: Vec<u8>) -> AppResult<()> {
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, bytes)?;
    std::fs::rename(&tmp, path)?;
    Ok(())
}

// ---------------------------------------------------------- - test connection

/// Authentication material resolved from a vault identity + server overrides.
#[derive(Clone)]
struct AuthMaterial {
    user: String,
    private_key: Option<PrivateKey>,
    password: Option<String>,
}

/// One ProxyJump hop: `user@host:port` (user/port optional).
struct Hop {
    user: Option<String>,
    host: String,
    port: u16,
}

fn parse_hops(spec: &str) -> AppResult<Vec<Hop>> {
    let mut hops = vec![];
    for raw in spec.split(',') {
        let raw = raw.trim();
        if raw.is_empty() {
            continue;
        }
        // Split user@ before the host; IPv6 brackets keep their colons.
        let (user, hostport) = match raw.split_once('@') {
            Some((u, h)) => (Some(u.trim().to_string()), h),
            None => (None, raw),
        };
        // Trailing :port (only if after the last ']' for IPv6 literals).
        let (host, port) = match hostport.rsplit_once(':') {
            Some((h, p)) if !h.contains(']') || hostport.starts_with('[') => match p.parse::<u16>() {
                Ok(port) => (h.to_string(), port),
                Err(_) => (hostport.to_string(), 22),
            },
            _ => (hostport.to_string(), 22),
        };
        if host.is_empty() {
            return Err(AppError::validation(format!("invalid ProxyJump hop: {raw}")));
        }
        hops.push(Hop { user, host, port });
    }
    if hops.is_empty() {
        return Err(AppError::validation("ProxyJump is set but has no hops"));
    }
    Ok(hops)
}

async fn resolve_auth(input: &SshServerInput, vault: &CredentialService) -> AppResult<AuthMaterial> {
    if let Some(identity_id) = input.identity_id.as_deref().filter(|id| !id.is_empty()) {
        let entry = vault.full_entry(identity_id).await?;
        let user = input
            .user
            .clone()
            .filter(|u| !u.trim().is_empty())
            .or_else(|| entry.fields.user.clone().filter(|u| !u.trim().is_empty()))
            .ok_or_else(|| {
                AppError::validation(
                    "identity has no user — set one in the identity or override it here",
                )
            })?;
        let private_key = match entry.fields.private_key.as_deref().filter(|k| !k.is_empty()) {
            Some(contents) => Some(
                russh::keys::decode_secret_key(contents, entry.fields.passphrase.as_deref())
                    .map_err(|e| AppError::ssh(format!("identity key could not be parsed: {e}")))?,
            ),
            None => None,
        };
        let password = entry.fields.password.clone().filter(|p| !p.is_empty());
        return Ok(AuthMaterial { user, private_key, password });
    }
    if let Some(key_path) = input.private_key_path.as_deref().filter(|p| !p.trim().is_empty()) {
        let user = input
            .user
            .clone()
            .filter(|u| !u.trim().is_empty())
            .ok_or_else(|| AppError::validation("user is required with a private key path"))?;
        let expanded = expand_tilde(key_path.trim());
        let key = russh::keys::load_secret_key(&expanded, None)
            .map_err(|e| AppError::ssh(format!("could not load private key {key_path}: {e}")))?;
        return Ok(AuthMaterial { user, private_key: Some(key), password: None });
    }
    Err(AppError::validation(
        "no authentication configured — pick a vault identity or set a private key path",
    ))
}

/// `~/…` / `~` → `$HOME/…` (Windows `%USERPROFILE%` tolerated via HOME).
fn expand_tilde(path: &str) -> String {
    if path == "~" {
        return std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
    }
    if let Some(rest) = path.strip_prefix("~/") {
        if let Ok(home) = std::env::var("HOME") {
            return format!("{home}/{rest}");
        }
    }
    path.to_string()
}

/// Authenticate a connected session: publickey first, then password.
/// Returns the method that succeeded.
async fn authenticate(session: &mut client::Handle<SshClientHandler>, auth: &AuthMaterial) -> AppResult<String> {
    if let Some(key) = auth.private_key.as_ref() {
        let key = PrivateKeyWithHashAlg::new(Arc::new(key.clone()), None);
        let result = session
            .authenticate_publickey(&auth.user, key)
            .await
            .map_err(|e| AppError::ssh(format!("publickey auth error: {e}")))?;
        if result.success() {
            return Ok("publickey".to_string());
        }
    }
    if let Some(password) = auth.password.as_deref() {
        let result = session
            .authenticate_password(&auth.user, password)
            .await
            .map_err(|e| AppError::ssh(format!("password auth error: {e}")))?;
        if result.success() {
            return Ok("password".to_string());
        }
    }
    Err(AppError::ssh(
        "authentication rejected by the server (tried publickey, then password)",
    ))
}

fn client_config(input: &SshServerInput) -> Arc<client::Config> {
    Arc::new(client::Config {
        inactivity_timeout: Some(Duration::from_secs(input.connect_timeout_secs.unwrap_or(30))),
        keepalive_interval: input
            .keepalive_interval_secs
            .map(Duration::from_secs),
        keepalive_max: input.keepalive_count.unwrap_or(3) as usize,
        ..Default::default()
    })
}

fn is_strict(input: &SshServerInput) -> bool {
    matches!(input.strict_host_key.as_deref(), Some("yes") | Some("true"))
}

/// A duplex stream over a spawned ProxyCommand's stdin/stdout.
struct ChildStream {
    child: tokio::process::Child,
}

impl AsyncRead for ChildStream {
    fn poll_read(
        mut self: Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> std::task::Poll<std::io::Result<()>> {
        Pin::new(self.child.stdout.as_mut().expect("piped stdout"))
            .poll_read(cx, buf)
    }
}

impl AsyncWrite for ChildStream {
    fn poll_write(
        mut self: Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
        buf: &[u8],
    ) -> std::task::Poll<std::io::Result<usize>> {
        Pin::new(self.child.stdin.as_mut().expect("piped stdin")).poll_write(cx, buf)
    }
    fn poll_flush(mut self: Pin<&mut Self>, cx: &mut std::task::Context<'_>) -> std::task::Poll<std::io::Result<()>> {
        Pin::new(self.child.stdin.as_mut().expect("piped stdin")).poll_flush(cx)
    }
    fn poll_shutdown(mut self: Pin<&mut Self>, cx: &mut std::task::Context<'_>) -> std::task::Poll<std::io::Result<()>> {
        Pin::new(self.child.stdin.as_mut().expect("piped stdin")).poll_shutdown(cx)
    }
}

impl Drop for ChildStream {
    fn drop(&mut self) {
        let _ = self.child.start_kill();
    }
}

/// Full Test Connection run against the (possibly unsaved) form input.
pub async fn test_connection(
    input: &SshServerInput,
    vault: &CredentialService,
) -> AppResult<SshTestResult> {
    let started = Instant::now();
    let mut hops: Vec<String> = vec![];

    let auth = resolve_auth(input, vault).await?;
    let config = client_config(input);
    let connect_timeout = Duration::from_secs(input.connect_timeout_secs.unwrap_or(15));

    let final_host = input.host.trim().to_string();
    let final_port = input.port.unwrap_or(22);

    // ---- build the transport to the final host --------------------------------
    // Three transports: a plain TCP socket, a ProxyCommand child process
    // (stdin/stdout), or a direct-tcpip channel tunnelled through a jump
    // session. All implement AsyncRead + AsyncWrite for connect_stream.
    enum Transport {
        Tcp(tokio::net::TcpStream),
        Child(ChildStream),
        Channel(russh::ChannelStream<russh::client::Msg>),
    }
    impl AsyncRead for Transport {
        fn poll_read(self: Pin<&mut Self>, cx: &mut std::task::Context<'_>, buf: &mut ReadBuf<'_>) -> std::task::Poll<std::io::Result<()>> {
            match self.get_mut() {
                Transport::Tcp(s) => Pin::new(s).poll_read(cx, buf),
                Transport::Child(c) => Pin::new(c).poll_read(cx, buf),
                Transport::Channel(c) => Pin::new(c).poll_read(cx, buf),
            }
        }
    }
    impl AsyncWrite for Transport {
        fn poll_write(self: Pin<&mut Self>, cx: &mut std::task::Context<'_>, buf: &[u8]) -> std::task::Poll<std::io::Result<usize>> {
            match self.get_mut() {
                Transport::Tcp(s) => Pin::new(s).poll_write(cx, buf),
                Transport::Child(c) => Pin::new(c).poll_write(cx, buf),
                Transport::Channel(c) => Pin::new(c).poll_write(cx, buf),
            }
        }
        fn poll_flush(self: Pin<&mut Self>, cx: &mut std::task::Context<'_>) -> std::task::Poll<std::io::Result<()>> {
            match self.get_mut() {
                Transport::Tcp(s) => Pin::new(s).poll_flush(cx),
                Transport::Child(c) => Pin::new(c).poll_flush(cx),
                Transport::Channel(c) => Pin::new(c).poll_flush(cx),
            }
        }
        fn poll_shutdown(self: Pin<&mut Self>, cx: &mut std::task::Context<'_>) -> std::task::Poll<std::io::Result<()>> {
            match self.get_mut() {
                Transport::Tcp(s) => Pin::new(s).poll_shutdown(cx),
                Transport::Child(c) => Pin::new(c).poll_shutdown(cx),
                Transport::Channel(c) => Pin::new(c).poll_shutdown(cx),
            }
        }
    }

    let mut active: Option<client::Handle<SshClientHandler>> = None;

    // ProxyJump chain: each hop session tunnels the next connection through
    // a direct-tcpip channel. All hops authenticate with the same resolved
    // identity (per-hop user overrides allowed).
    if let Some(spec) = input.proxy_jump.as_deref().filter(|s| !s.trim().is_empty()) {
        let hop_list = parse_hops(spec)?;
        for (i, hop) in hop_list.iter().enumerate() {
            hops.push(format!(
                "jump {n}: {host}:{port} (user {user})",
                n = i + 1,
                host = hop.host,
                port = hop.port,
                user = hop.user.as_deref().unwrap_or("<identity>")
            ));
            let next: (String, u16) = if i + 1 < hop_list.len() {
                (hop_list[i + 1].host.clone(), hop_list[i + 1].port)
            } else {
                (final_host.clone(), final_port)
            };

            let stream: Transport = match active.take() {
                Some(session) => {
                    let channel = session
                        .channel_open_direct_tcpip(&next.0, next.1 as u32, "127.0.0.1", 0)
                        .await
                        .map_err(|e| {
                            AppError::ssh(format!(
                                "jump {n} ({host}:{port}) refused forwarding to {nh}:{np}: {e}",
                                n = i + 1,
                                host = hop.host,
                                port = hop.port,
                                nh = next.0,
                                np = next.1
                            ))
                        })?;
                    Transport::Channel(channel.into_stream())
                }
                None => Transport::Tcp(
                    tokio::time::timeout(
                        connect_timeout,
                        tokio::net::TcpStream::connect((hop.host.as_str(), hop.port)),
                    )
                    .await
                    .map_err(|_| {
                        AppError::ssh(format!(
                            "jump {n} ({host}:{port}) timed out after {t}s",
                            n = i + 1,
                            host = hop.host,
                            port = hop.port,
                            t = connect_timeout.as_secs()
                        ))
                    })?
                    .map_err(|e| {
                        AppError::ssh(format!(
                            "jump {n} ({host}:{port}) unreachable: {e}",
                            n = i + 1,
                            host = hop.host,
                            port = hop.port
                        ))
                    })?,
                ),
            };

            let hop_auth = AuthMaterial {
                user: hop.user.clone().unwrap_or_else(|| auth.user.clone()),
                ..auth.clone()
            };
            let handler = SshClientHandler::new(hop.host.clone(), hop.port, is_strict(input));
            let mut session = client::connect_stream(config.clone(), stream, handler)
                .await
                .map_err(|e| {
                    AppError::ssh(format!(
                        "jump {n} ({host}:{port}) SSH handshake failed: {e}",
                        n = i + 1,
                        host = hop.host,
                        port = hop.port
                    ))
                })?;
            authenticate(&mut session, &hop_auth).await?;
            active = Some(session);
        }
    }

    // Final transport to the target host.
    let final_transport: Transport = if let Some(session) = active.take() {
        let channel = session
            .channel_open_direct_tcpip(&final_host, final_port as u32, "127.0.0.1", 0)
            .await
            .map_err(|e| {
                AppError::ssh(format!("last jump refused forwarding to {final_host}:{final_port}: {e}"))
            })?;
        let _ = session
            .disconnect(russh::Disconnect::ByApplication, "workgrid test complete", "")
            .await;
        Transport::Channel(channel.into_stream())
    } else if let Some(cmd) = input.proxy_command.as_deref().filter(|c| !c.trim().is_empty()) {
        let substituted = cmd.replace("%h", &final_host).replace("%p", &final_port.to_string());
        hops.push(format!("proxy-command: {substituted}"));
        let mut child = tokio::process::Command::new("sh")
            .arg("-c")
            .arg(&substituted)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .kill_on_drop(true)
            .spawn()
            .map_err(|e| AppError::ssh(format!("could not run ProxyCommand: {e}")))?;
        // Give a failing command a moment to die so spawn errors surface here.
        tokio::time::sleep(Duration::from_millis(150)).await;
        if let Some(status) = child.try_wait().map_err(|e| AppError::io(e.to_string()))? {
            return Err(AppError::ssh(format!("ProxyCommand exited immediately with {status}")));
        }
        Transport::Child(ChildStream { child })
    } else {
        hops.push(format!("direct tcp → {final_host}:{final_port}"));
        Transport::Tcp(
            tokio::time::timeout(
                connect_timeout,
                tokio::net::TcpStream::connect((final_host.as_str(), final_port)),
            )
            .await
            .map_err(|_| {
                AppError::ssh(format!(
                    "{final_host}:{final_port} timed out after {t}s",
                    t = connect_timeout.as_secs()
                ))
            })?
            .map_err(|e| AppError::ssh(format!("{final_host}:{final_port} unreachable: {e}")))?,
        )
    };

    // ---- handshake + auth with the final host ----------------------------------
    let handler = SshClientHandler::new(final_host.clone(), final_port, is_strict(input));
    let fingerprint_slot = handler.fingerprint_out.clone();
    let mut session = client::connect_stream(config, final_transport, handler)
        .await
        .map_err(|e| {
            AppError::ssh(format!("SSH handshake with {}:{} failed: {e}", input.host.trim(), final_port))
        })?;
    let auth_used = authenticate(&mut session, &auth).await?;
    let latency = started.elapsed().as_millis() as u64;
    let fingerprint = fingerprint_slot.lock().unwrap().clone();

    let _ = session
        .disconnect(russh::Disconnect::ByApplication, "workgrid test complete", "")
        .await;

    Ok(SshTestResult {
        ok: true,
        message: format!(
            "Connected to {}:{} as {} in {} ms",
            input.host.trim(),
            final_port,
            auth.user,
            latency
        ),
        latency_ms: Some(latency),
        auth_used: Some(auth_used),
        host_fingerprint: fingerprint,
        hops,
    })
}

// --------------------------------------------------------------- - tests

#[cfg(test)]
mod tests {
    use super::*;

    // Redirect HOME for the whole test so persistence lands in a sandbox.
    static HOME_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
    struct TempHome(std::path::PathBuf, #[allow(dead_code)] Option<std::sync::MutexGuard<'static, ()>>);
    impl TempHome {
        fn new() -> Self {
            let guard = HOME_LOCK.lock().unwrap_or_else(|p| p.into_inner());
            let dir = std::env::temp_dir().join(format!("workgrid-ssh-test-{}", uuid::Uuid::new_v4()));
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
    async fn server_registry_round_trip_encrypted() {
        let _home = TempHome::new();
        let service = SshServerService::default();
        let mut extra = serde_json::Map::new();
        extra.insert("ServerAliveInterval".to_string(), serde_json::json!("15"));
        extra.insert("ForwardAgent".to_string(), serde_json::json!("yes"));
        let created = service
            .upsert(SshServerInput {
                id: None,
                name: "bastion".into(),
                host: "10.0.0.5".into(),
                port: Some(2222),
                identity_id: Some("ident-1".into()),
                user: Some("deploy".into()),
                private_key_path: None,
                proxy_jump: Some("jump.example.com,root@10.0.0.9:2200".into()),
                proxy_command: Some("ssh -W %h:%p gate".into()),
                connect_timeout_secs: Some(9),
                keepalive_interval_secs: Some(15),
                keepalive_count: Some(4),
                compression: Some(true),
                strict_host_key: Some("accept-new".into()),
                extra_options: Some(extra),
                notes: Some("prod bastion".into()),
            })
            .await
            .unwrap();
        assert!(created.id.len() > 0);

        // Restart: the registry reloads, encrypted at rest.
        let reloaded = SshServerService::new().await.unwrap();
        let list = reloaded.list().await.unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].name, "bastion");
        assert_eq!(list[0].proxy_jump.as_deref(), Some("jump.example.com,root@10.0.0.9:2200"));
        assert_eq!(list[0].port, Some(2222));

        let bytes = std::fs::read(data_file_path(SERVERS_FILE).unwrap()).unwrap();
        let text = String::from_utf8(bytes).unwrap();
        assert!(text.starts_with("wkgrd:"));
        assert!(!text.contains("bastion"));
        assert!(!text.contains("10.0.0.5"));

        // Update in place + delete.
        let mut input = SshServerInput::from(&list[0]);
        input.host = "10.0.0.6".into();
        let updated = reloaded.upsert(input).await.unwrap();
        assert_eq!(updated.host, "10.0.0.6");
        assert_eq!(reloaded.list().await.unwrap().len(), 1);
        reloaded.delete(&updated.id).await.unwrap();
        assert!(reloaded.list().await.unwrap().is_empty());
    }

    #[test]
    fn parses_jump_hops() {
        let hops = parse_hops("a.example.com, root@10.0.0.9:2200, [::1]:2222").unwrap();
        assert_eq!(hops.len(), 3);
        assert_eq!((hops[0].user.as_deref(), hops[0].host.as_str(), hops[0].port), (None, "a.example.com", 22));
        assert_eq!((hops[1].user.as_deref(), hops[1].host.as_str(), hops[1].port), (Some("root"), "10.0.0.9", 2200));
        assert_eq!(hops[2].port, 2222);
        assert!(parse_hops("  ").is_err());
    }
}
