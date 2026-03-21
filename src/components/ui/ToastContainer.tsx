import { useEffect } from "react";
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

export function ToastContainer() {
  const toasts = useAppStore((s) => s.toasts);
  const dismissToast = useAppStore((s) => s.dismissToast);

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
          onDismiss={() => dismissToast(toast.id)}
        />
      ))}
    </div>
  );
}

function ToastItem({
  title,
  description,
  variant = "default",
  action,
  persistent,
  onDismiss,
}: {
  id: string;
  title: string;
  description?: string;
  variant?: ToastVariant;
  action?: { label: string; onClick: () => void };
  persistent?: boolean;
  onDismiss: () => void;
}) {
  const cfg = SEVERITY_CONFIG[variant] ?? SEVERITY_CONFIG.default;
  const { Icon, iconClass, containerClass, descClass, actionClass, closeClass, autoDismissMs } = cfg;

  useEffect(() => {
    if (persistent || autoDismissMs === null) return;
    const timer = setTimeout(onDismiss, autoDismissMs);
    return () => clearTimeout(timer);
  }, [persistent, autoDismissMs, onDismiss]);

  return (
    <div
      className={cn(
        "pointer-events-auto flex w-full items-start gap-3 rounded-md border p-3 shadow-lg transition-all animate-in slide-in-from-right-4 fade-in duration-200",
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
