import type { NotifyOptions, NotificationSeverity } from "./types";
import { useAppStore } from "@/state/appStore";

// ─── Severity → Toast variant mapping ────────────────────────────────────────

function toastVariant(severity: NotificationSeverity): "default" | "destructive" {
  return severity === "error" || severity === "warning" ? "destructive" : "default";
}

function shouldShowToast(severity: NotificationSeverity, override?: boolean): boolean {
  if (typeof override === "boolean") return override;
  // Routing table defaults
  return severity === "success" || severity === "warning" || severity === "error";
}

function isPersistentByDefault(severity: NotificationSeverity): boolean {
  return severity === "error";
}

function toOutputLevel(severity: NotificationSeverity) {
  if (severity === "success") return "success" as const;
  if (severity === "warning") return "warning" as const;
  if (severity === "error")   return "error"   as const;
  return "info" as const;
}

// ─── Main notify() function ───────────────────────────────────────────────────

/**
 * Fire a notification. Depending on severity and options, this will:
 *  - Add a toast (success / warning / error by default)
 *  - Add an entry to the output panel (all severities except debug)
 *  - Update the status bar text (success / warning / error)
 *
 * @example
 * notify({ severity: "error", title: "Connection failed", detail: err.message, source: "connection" });
 * notify({ severity: "success", title: "Query executed", detail: "42 rows", source: "query" });
 * notify({ severity: "info", title: "Schema refreshed", source: "system" });
 */
export function notify(options: NotifyOptions): void {
  const store = useAppStore.getState();
  const { severity, title, detail, source, profileId, actions, toast: toastOverride, persistent } = options;

  // ── Output panel entry (all except debug unless verbose) ───────────────────
  if (severity !== "debug") {
    store.addOutputEntry({
      level: toOutputLevel(severity),
      message: detail ? `${title}: ${detail}` : title,
      profileId,
      profileName: profileId,
    });
  }

  // ── Toast ──────────────────────────────────────────────────────────────────
  if (shouldShowToast(severity, toastOverride)) {
    store.addToast({
      title,
      description: detail,
      variant: toastVariant(severity),
      persistent: persistent ?? isPersistentByDefault(severity),
      action: actions?.[0]
        ? { label: actions[0].label, onClick: actions[0].onClick }
        : source
          ? {
              label: "Show Output",
              onClick: () => {
                // Open bottom panel — dispatched via the keybinding engine if available
                import("@/lib/keybindings").then(({ executeCommand }) => {
                  const opened = executeCommand("layout.togglePanel");
                  if (!opened) {
                    // Fallback: directly open via store
                    import("@/state/layoutStore").then(({ useLayoutStore }) => {
                      const s = useLayoutStore.getState();
                      if (!s.isBottomPanelVisible) s.togglePanel();
                    });
                  }
                });
              },
            }
          : undefined,
    });
  }
}

// ─── Convenience shorthands ───────────────────────────────────────────────────

export const notifyError   = (title: string, detail?: string, source?: string) =>
  notify({ severity: "error",   title, detail, source });

export const notifyWarning = (title: string, detail?: string, source?: string) =>
  notify({ severity: "warning", title, detail, source });

export const notifySuccess = (title: string, detail?: string, source?: string) =>
  notify({ severity: "success", title, detail, source });

export const notifyInfo    = (title: string, detail?: string, source?: string) =>
  notify({ severity: "info",    title, detail, source });
