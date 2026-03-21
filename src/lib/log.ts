import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

// ─── Types ────────────────────────────────────────────────────────────────────

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  ts: string;
  level: LogLevel;
  source: string;
  profileId?: string;
  message: string;
  detail?: string;
}

// ─── Tauri command wrappers ───────────────────────────────────────────────────

/** Fetch the current in-memory ring buffer (last 500 entries). */
export async function getLogBuffer(): Promise<LogEntry[]> {
  return invoke<LogEntry[]>("get_log_buffer");
}

export async function readProfileLog(profileId: string, logType: "mysql" | "ssh" | "error"): Promise<string> {
  return invoke<string>("read_profile_log", { profileId, logType });
}

export async function clearProfileLog(profileId: string, logType: "mysql" | "ssh" | "error" | "all"): Promise<void> {
  return invoke<void>("clear_profile_log", { profileId, logType });
}

export async function clearAllLogs(): Promise<void> {
  return invoke<void>("clear_all_logs");
}

// ─── Event subscription ───────────────────────────────────────────────────────

/**
 * Subscribe to the real-time log stream from the Rust writer task.
 * The callback receives a batch of entries (1–100) every ≤500ms.
 *
 * @returns an unsubscribe function — call it on component unmount.
 *
 * @example
 * const unsub = subscribeToLogStream((entries) => {
 *   entries.forEach(e => addOutputEntry({ level: e.level, message: e.message }));
 * });
 * return () => unsub();
 */
export function subscribeToLogStream(
  onEntries: (entries: LogEntry[]) => void,
): () => void {
  let unlisten: (() => void) | null = null;

  listen<LogEntry[]>("log:entries", (event) => {
    onEntries(event.payload);
  }).then((fn) => {
    unlisten = fn;
  });

  return () => {
    unlisten?.();
  };
}
