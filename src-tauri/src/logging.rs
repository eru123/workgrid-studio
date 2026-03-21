// ─── Centralized Logging Engine ───────────────────────────────────────────────
//
// Architecture:
//   Caller → log_send() → tokio mpsc channel → LogWriter task
//                                                  ├─ in-memory ring buffer (last 500)
//                                                  ├─ batched NDJSON file writes (500ms / 100 entries)
//                                                  ├─ Tauri event emit ("log:entries")
//                                                  └─ log rotation (size + age)
//
// Callers never block on I/O. log_send() posts to a channel and returns immediately.

use crate::files::{app_data_dir, app_preferences_path};
use crate::{AppError, AppResult};
use chrono::Local;
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::fs::{self, OpenOptions};
use std::io::Write as IoWrite;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime};
use tauri::{AppHandle, Emitter};
use tokio::sync::mpsc;
use tokio::time::interval;

// ─── Constants ────────────────────────────────────────────────────────────────

const RING_BUFFER_SIZE: usize = 500;
const BATCH_MAX_ENTRIES: usize = 100;
const BATCH_FLUSH_MS: u64 = 500;

const DEFAULT_MAX_LOG_SIZE_MB: u64 = 10;
const MIN_LOG_SIZE_MB: u64 = 1;
const MAX_LOG_SIZE_MB: u64 = 250;
const DEFAULT_MAX_LOG_AGE_DAYS: u64 = 14;
const MIN_LOG_AGE_DAYS: u64 = 1;
const MAX_LOG_AGE_DAYS: u64 = 365;

pub const MYSQL_LOG_FILE: &str = "mysql.log.ndjson";
pub const ERROR_LOG_FILE: &str = "error.log.ndjson";
pub const SSH_LOG_FILE: &str = "ssh.log.ndjson";

// ─── Log Entry ────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogEntry {
    pub ts: String,
    pub level: LogLevel,
    pub source: String,
    pub profile_id: Option<String>,
    pub message: String,
    pub detail: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum LogLevel {
    Debug,
    Info,
    Warn,
    Error,
}

// ─── Log State (managed by Tauri) ────────────────────────────────────────────

#[derive(Clone)]
pub struct LogState {
    pub sender: mpsc::UnboundedSender<LogEntry>,
    pub ring_buffer: Arc<Mutex<VecDeque<LogEntry>>>,
}

impl LogState {
    /// Initialise the log engine and spawn the writer task.
    /// Must be called once during Tauri setup, after the AppHandle is available.
    pub fn new(app: AppHandle) -> Self {
        let (tx, rx) = mpsc::unbounded_channel::<LogEntry>();
        let ring_buffer: Arc<Mutex<VecDeque<LogEntry>>> =
            Arc::new(Mutex::new(VecDeque::with_capacity(RING_BUFFER_SIZE)));
        let ring_clone = Arc::clone(&ring_buffer);

        tauri::async_runtime::spawn(log_writer_task(rx, ring_clone, app));

        LogState { sender: tx, ring_buffer }
    }
}

// ─── Public Logging API ───────────────────────────────────────────────────────

/// Post a log entry to the channel. Non-blocking — returns immediately.
pub fn log_send(state: &LogState, entry: LogEntry) {
    let _ = state.sender.send(entry);
}

pub fn log_info(state: &LogState, source: &str, profile_id: Option<&str>, message: &str) {
    log_send(state, LogEntry {
        ts: timestamp(),
        level: LogLevel::Info,
        source: source.to_string(),
        profile_id: profile_id.map(|s| s.to_string()),
        message: message.to_string(),
        detail: None,
    });
}

pub fn log_warn(state: &LogState, source: &str, profile_id: Option<&str>, message: &str) {
    log_send(state, LogEntry {
        ts: timestamp(),
        level: LogLevel::Warn,
        source: source.to_string(),
        profile_id: profile_id.map(|s| s.to_string()),
        message: message.to_string(),
        detail: None,
    });
}

pub fn log_error(
    state: &LogState,
    source: &str,
    profile_id: Option<&str>,
    message: &str,
    detail: Option<&str>,
) {
    log_send(state, LogEntry {
        ts: timestamp(),
        level: LogLevel::Error,
        source: source.to_string(),
        profile_id: profile_id.map(|s| s.to_string()),
        message: message.to_string(),
        detail: detail.map(|s| s.to_string()),
    });
}

pub fn log_query(state: &LogState, profile_id: &str, query: &str, rows: Option<usize>) {
    let message = match rows {
        Some(n) => format!("QUERY ({n} rows): {query}"),
        None    => format!("QUERY: {query}"),
    };
    log_send(state, LogEntry {
        ts: timestamp(),
        level: LogLevel::Info,
        source: "query".to_string(),
        profile_id: Some(profile_id.to_string()),
        message,
        detail: None,
    });
}

pub fn log_ssh(state: &LogState, profile_id: &str, level: LogLevel, message: &str) {
    log_send(state, LogEntry {
        ts: timestamp(),
        level,
        source: "ssh".to_string(),
        profile_id: Some(profile_id.to_string()),
        message: message.to_string(),
        detail: None,
    });
}

pub fn log_ssh_info(state: &LogState, profile_id: &str, message: &str) {
    log_info(state, "ssh", Some(profile_id), message);
}

pub fn log_ssh_error(state: &LogState, profile_id: &str, message: &str) {
    log_error(state, "ssh", Some(profile_id), message, None);
}

pub fn log_ssh_verbose(state: &LogState, profile_id: &str, verbose: bool, message: &str) {
    if verbose {
        log_ssh_info(state, profile_id, message);
    }
}

pub fn log_mysql_verbose(state: &LogState, profile_id: &str, verbose: bool, message: &str) {
    if verbose {
        log_info(state, "connection", Some(profile_id), message);
    }
}

pub fn log_query_result(state: &LogState, profile_id: &str, query: &str, count: usize) {
    log_query(state, profile_id, query, Some(count));
}

// ─── Writer Task ──────────────────────────────────────────────────────────────

async fn log_writer_task(
    mut rx: mpsc::UnboundedReceiver<LogEntry>,
    ring_buffer: Arc<Mutex<VecDeque<LogEntry>>>,
    app: AppHandle,
) {
    let mut batch: Vec<LogEntry> = Vec::with_capacity(BATCH_MAX_ENTRIES);
    let mut flush_tick = interval(Duration::from_millis(BATCH_FLUSH_MS));

    loop {
        tokio::select! {
            entry = rx.recv() => {
                match entry {
                    Some(e) => {
                        batch.push(e);
                        if batch.len() >= BATCH_MAX_ENTRIES {
                            flush_batch(&mut batch, &ring_buffer, &app).await;
                        }
                    }
                    None => {
                        if !batch.is_empty() {
                            flush_batch(&mut batch, &ring_buffer, &app).await;
                        }
                        break;
                    }
                }
            }
            _ = flush_tick.tick() => {
                if !batch.is_empty() {
                    flush_batch(&mut batch, &ring_buffer, &app).await;
                }
            }
        }
    }
}

async fn flush_batch(
    batch: &mut Vec<LogEntry>,
    ring_buffer: &Arc<Mutex<VecDeque<LogEntry>>>,
    app: &AppHandle,
) {
    if batch.is_empty() {
        return;
    }
    let entries: Vec<LogEntry> = batch.drain(..).collect();

    // Update ring buffer
    if let Ok(mut ring) = ring_buffer.lock() {
        for entry in &entries {
            if ring.len() >= RING_BUFFER_SIZE {
                ring.pop_front();
            }
            ring.push_back(entry.clone());
        }
    }

    // Stream to frontend
    let _ = app.emit("log:entries", &entries);

    // Persist to disk (blocking but runs inside tokio spawn_blocking to avoid blocking the executor)
    let entries_for_disk = entries.clone();
    tokio::task::spawn_blocking(move || {
        write_entries_to_files(&entries_for_disk);
    });
}

fn write_entries_to_files(entries: &[LogEntry]) {
    for entry in entries {
        let Some(profile_id) = &entry.profile_id else { continue };
        let Ok(dir) = log_dir_for(profile_id) else { continue };

        let filename = match entry.source.as_str() {
            "query" | "connection" => MYSQL_LOG_FILE,
            "ssh"                  => SSH_LOG_FILE,
            _ if entry.level == LogLevel::Error => ERROR_LOG_FILE,
            _                      => MYSQL_LOG_FILE,
        };

        let path = dir.join(filename);
        append_ndjson_entry(&path, entry);

        // Errors always go to error log as well
        if entry.level == LogLevel::Error && filename != ERROR_LOG_FILE {
            append_ndjson_entry(&dir.join(ERROR_LOG_FILE), entry);
        }

        enforce_log_rotation(&path);
    }
}

fn append_ndjson_entry(path: &Path, entry: &LogEntry) {
    let Ok(json) = serde_json::to_string(entry) else { return };
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(file, "{}", json);
    }
}

// ─── Log Rotation ─────────────────────────────────────────────────────────────

fn enforce_log_rotation(path: &Path) {
    let max_bytes = current_max_log_size_bytes();
    let Ok(meta) = fs::metadata(path) else { return };
    if meta.len() <= max_bytes { return }

    let ts = Local::now().format("%Y%m%d-%H%M%S");
    let rotated = path.with_extension(format!("{}.ndjson", ts));
    let _ = fs::rename(path, &rotated);

    if let Some(parent) = path.parent() {
        purge_expired_logs(parent);
    }
}

fn purge_expired_logs(dir: &Path) {
    let max_age = Duration::from_secs(current_max_log_age_days() * 86400);
    let Ok(entries) = fs::read_dir(dir) else { return };
    let now = SystemTime::now();
    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(meta) = entry.metadata() else { continue };
        if !meta.is_file() { continue }
        let Ok(modified) = meta.modified() else { continue };
        let Ok(elapsed) = now.duration_since(modified) else { continue };
        if elapsed > max_age { let _ = fs::remove_file(path); }
    }
}

// ─── Tauri Commands ───────────────────────────────────────────────────────────

/// Returns the in-memory ring buffer — used by the frontend output panel on mount.
#[tauri::command]
pub fn get_log_buffer(
    log_state: tauri::State<'_, LogState>,
) -> AppResult<Vec<LogEntry>> {
    log_state
        .ring_buffer
        .lock()
        .map(|ring| ring.iter().cloned().collect())
        .map_err(|_| AppError::from("Log buffer lock poisoned"))
}

#[tauri::command]
pub fn read_profile_log(profile_id: String, log_type: String) -> AppResult<String> {
    let filename = match log_type.as_str() {
        "query" | "mysql" => MYSQL_LOG_FILE,
        "error"           => ERROR_LOG_FILE,
        "ssh"             => SSH_LOG_FILE,
        _ => return Err("Unknown log type.".into()),
    };
    let dir = log_dir_for(&profile_id)?;
    let path = dir.join(filename);
    if !path.exists() { return Ok(String::new()); }
    fs::read_to_string(&path).map_err(|e| AppError::io(format!("Read error: {}", e)))
}

#[tauri::command]
pub fn clear_profile_log(profile_id: String, log_type: String) -> AppResult<()> {
    let dir = log_dir_for(&profile_id)?;
    match log_type.as_str() {
        "all" => {
            for f in &[MYSQL_LOG_FILE, SSH_LOG_FILE, ERROR_LOG_FILE] {
                let p = dir.join(f);
                if p.exists() { let _ = fs::remove_file(&p); }
            }
        }
        "query" | "mysql" => { let p = dir.join(MYSQL_LOG_FILE); if p.exists() { fs::remove_file(p)?; } }
        "error"           => { let p = dir.join(ERROR_LOG_FILE); if p.exists() { fs::remove_file(p)?; } }
        "ssh"             => { let p = dir.join(SSH_LOG_FILE);   if p.exists() { fs::remove_file(p)?; } }
        _ => return Err("Unknown log type.".into()),
    }
    Ok(())
}

#[tauri::command]
pub fn clear_all_logs(log_state: tauri::State<'_, LogState>) -> AppResult<()> {
    if let Ok(mut ring) = log_state.ring_buffer.lock() { ring.clear(); }

    let base = app_data_dir()?;
    let logs_dir = base.join("logs");
    if logs_dir.exists() {
        fs::remove_dir_all(&logs_dir)
            .map_err(|e| AppError::io(format!("Failed to clear logs: {}", e)))?;
    }
    fs::create_dir_all(&logs_dir)
        .map_err(|e| AppError::io(format!("Failed to recreate logs dir: {}", e)))?;
    for filename in ["ai_logs.json", "ai_logs.corrupted.json"] {
        let p = base.join(filename);
        if p.exists() { let _ = fs::remove_file(p); }
    }
    Ok(())
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

pub fn log_dir_for(profile_id: &str) -> AppResult<PathBuf> {
    let dir = app_data_dir()?.join("logs").join(profile_id);
    if !dir.exists() {
        fs::create_dir_all(&dir)
            .map_err(|e| format!("Failed to create log dir: {}", e))?;
    }
    Ok(dir)
}

pub fn timestamp() -> String {
    Local::now().format("%Y-%m-%d %H:%M:%S").to_string()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LoggingPreferences {
    max_log_size_mb: Option<u64>,
    max_log_age_days: Option<u64>,
}

fn current_max_log_size_bytes() -> u64 {
    read_logging_prefs()
        .map(|p| p.max_log_size_mb.unwrap_or(DEFAULT_MAX_LOG_SIZE_MB))
        .unwrap_or(DEFAULT_MAX_LOG_SIZE_MB)
        .clamp(MIN_LOG_SIZE_MB, MAX_LOG_SIZE_MB) * 1024 * 1024
}

fn current_max_log_age_days() -> u64 {
    read_logging_prefs()
        .map(|p| p.max_log_age_days.unwrap_or(DEFAULT_MAX_LOG_AGE_DAYS))
        .unwrap_or(DEFAULT_MAX_LOG_AGE_DAYS)
        .clamp(MIN_LOG_AGE_DAYS, MAX_LOG_AGE_DAYS)
}

fn read_logging_prefs() -> Option<LoggingPreferences> {
    let path = app_preferences_path().ok()?;
    serde_json::from_str(&fs::read_to_string(path).ok()?).ok()
}
