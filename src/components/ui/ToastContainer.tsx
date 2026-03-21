import { useEffect, useRef, useState } from "react";
import { useAppStore } from "@/state/appStore";
import { cn } from "@/lib/utils/cn";
import { X, AlertCircle, Info, CheckCircle2, AlertTriangle } from "lucide-react";

// ─── Toast severity config ─────────────────────────────────────────────────────

const SEVERITY_CONFIG = {
  default: {
    containerClass: "border-border bg-popover text-foreground",
    descClass:      "text-muted-foreground",
    actionClass:    "bg-primary/10 hover:bg-primary/20 text-primary",
    closeClass:     "hover:bg-accent",
    Icon:           Info,
    iconClass:      "text-blue-500",
    autoDismissMs:  5000,
  },
  success: {
    containerClass: "border-green-800/50 bg-green-950/80 text-green-100",
    descClass:      "text-green-300/80",
    actionClass:    "bg-green-800/50 hover:bg-green-800 text-green-200",
    closeClass:     "hover:bg-green-900/50",
    Icon:           CheckCircle2,
    iconClass:      "text-green-400",
    autoDismissMs:  3000,
  },
  warning: {
    containerClass: "border-yellow-800/50 bg-yellow-950/80 text-yellow-100",
    descClass:      "text-yellow-300/80",
    actionClass:    "bg-yellow-800/50 hover:bg-yellow-800 text-yellow-200",
    closeClass:     "hover:bg-yellow-900/50",
    Icon:           AlertTriangle,
    iconClass:      "text-yellow-400",
    autoDismissMs:  8000,
  },
  destructive: {
    containerClass: "border-red-900/50 bg-red-950/80 text-red-200",
    descClass:      "text-red-300/80",
    actionClass:    "bg-red-800/50 hover:bg-red-800 text-red-200",
    closeClass:     "hover:bg-red-900/50",
    Icon:           AlertCircle,
    iconClass:      "text-red-500",
    autoDismissMs:  null, // persistent by default
  },
} as const;

type ToastVariant = keyof typeof SEVERITY_CONFIG;

// ─── Per-toast timer state (local Map for O(1) add/remove) ────────────────────

type TimerEntry = { timer: ReturnType<typeof setTimeout> | null };

export function ToastContainer() {
  const toasts = useAppStore((s) => s.toasts);
  const dismissToast = useAppStore((s) => s.dismissToast);
  // Shared Map tracking active timer per toast id — avoids prop drilling & O(1) lookups
  const timerMapRef = useRef<Map<string, TimerEntry>>(new Map());

  return (
    <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 pointer-events-none w-80 max-w-[calc(100vw-2rem)]">
      {toasts.map((toast) => (
        <ToastItem
          key={toast.id}
          id={toast.id}
          title={toast.title}
          description={toast.description}
          variant={(toast.variant ?? "default") as ToastVariant}
          action={toast.action}
          persistent={toast.persistent}
          timerMapRef={timerMapRef}
          onDismiss={() => dismissToast(toast.id)}
        />
      ))}
    </div>
  );
}

function ToastItem({
  id,
  title,
  description,
  variant = "default",
  action,
  persistent,
  timerMapRef,
  onDismiss,
}: {
  id: string;
  title: string;
  description?: string;
  variant?: ToastVariant;
  action?: { label: string; onClick: () => void };
  persistent?: boolean;
  timerMapRef: React.RefObject<Map<string, TimerEntry>>;
  onDismiss: () => void;
}) {
  const cfg = SEVERITY_CONFIG[variant] ?? SEVERITY_CONFIG.default;
  const { Icon, iconClass, containerClass, descClass, actionClass, closeClass, autoDismissMs } = cfg;

  // 1.3.2 — rAF-deferred mount for smooth entrance (prevents flash-of-invisible)
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  // 1.3.3 + 1.3.4 — Auto-dismiss timer tracked in shared Map; pauses on hover
  useEffect(() => {
    if (persistent || autoDismissMs === null) return;

    const entry: TimerEntry = { timer: null };
    timerMapRef.current.set(id, entry);
    entry.timer = setTimeout(onDismiss, autoDismissMs);

    return () => {
      if (entry.timer !== null) clearTimeout(entry.timer);
      timerMapRef.current.delete(id);
    };
  }, [id, persistent, autoDismissMs, onDismiss, timerMapRef]);

  function handleMouseEnter() {
    const entry = timerMapRef.current.get(id);
    if (!entry || entry.timer === null) return;
    clearTimeout(entry.timer);
    entry.timer = null;
  }

  function handleMouseLeave() {
    if (persistent || autoDismissMs === null) return;
    const entry = timerMapRef.current.get(id);
    if (!entry) return;
    entry.timer = setTimeout(onDismiss, autoDismissMs);
  }

  return (
    <div
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className={cn(
        "pointer-events-auto flex w-full items-start gap-3 rounded-md border p-3 shadow-lg",
        "transition-all duration-200 animate-in slide-in-from-right-4 fade-in",
        mounted ? "opacity-100" : "opacity-0",
        containerClass,
      )}
    >
      <div className="shrink-0 mt-0.5">
        <Icon className={cn("h-4 w-4", iconClass)} />
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold leading-snug">{title}</p>
        {description && (
          <p className={cn("mt-0.5 text-xs break-words leading-snug", descClass)}>
            {description}
          </p>
        )}
        {action && (
          <button
            onClick={() => { action.onClick(); onDismiss(); }}
            className={cn("mt-1.5 text-xs font-medium rounded px-2 py-0.5 transition-colors", actionClass)}
          >
            {action.label}
          </button>
        )}
      </div>

      <button
        onClick={(e) => { e.stopPropagation(); onDismiss(); }}
        className={cn("shrink-0 rounded p-0.5 opacity-60 transition-opacity hover:opacity-100", closeClass)}
        aria-label="Close"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}
