// ─── Notification Engine Types ────────────────────────────────────────────────

export type NotificationSeverity = "debug" | "info" | "success" | "warning" | "error";

export type NotificationSource =
  | "query"
  | "connection"
  | "ssh"
  | "import"
  | "export"
  | "ai"
  | "system"
  | "ipc"
  | string; // allow custom sources

export interface NotificationAction {
  label: string;
  onClick: () => void;
}

export interface NotifyOptions {
  /** Severity determines routing (toast vs output panel) — see routing table in notify.ts */
  severity: NotificationSeverity;
  /** Short human-readable title */
  title: string;
  /** Optional longer explanation */
  detail?: string;
  /** Source subsystem — used for output panel filtering */
  source?: NotificationSource;
  /** Profile this notification is associated with (for log correlation) */
  profileId?: string;
  /** One or more action buttons shown on the toast */
  actions?: NotificationAction[];
  /**
   * Override toast behaviour.
   * - `undefined` (default): use severity routing table
   * - `true`: always show toast
   * - `false`: suppress toast even for errors
   */
  toast?: boolean;
  /**
   * Override auto-dismiss. Errors default to persistent (manual dismiss).
   * Pass false to auto-dismiss an error toast.
   */
  persistent?: boolean;
}

// ─── Routing table ────────────────────────────────────────────────────────────
//
// | Severity | Toast shown       | Output panel | Status bar |
// |----------|-------------------|--------------|------------|
// | debug    | never             | verbose only | no         |
// | info     | never             | yes          | no         |
// | success  | yes (auto 3s)     | yes          | yes        |
// | warning  | yes (auto 8s)     | yes          | yes        |
// | error    | yes (persistent)  | yes          | yes        |
