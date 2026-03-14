import { useEffect } from "react";
import { useAppStore } from "@/state/appStore";
import { cn } from "@/lib/utils/cn";
import { X, AlertCircle, Info } from "lucide-react";

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
                    variant={toast.variant}
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
    onDismiss,
}: {
    id: string;
    title: string;
    description?: string;
    variant?: "default" | "destructive";
    onDismiss: () => void;
}) {
    const isDestructive = variant === "destructive";

    // Auto-dismiss
    useEffect(() => {
        const timer = setTimeout(() => {
            onDismiss();
        }, isDestructive ? 8000 : 5000);

        return () => clearTimeout(timer);
    }, [isDestructive, onDismiss]);

    return (
        <div
            className={cn(
                "pointer-events-auto flex w-full items-start gap-3 rounded-md border p-4 shadow-lg transition-all animate-in slide-in-from-right-4 fade-in duration-300",
                isDestructive
                    ? "border-red-900/50 bg-red-950/80 text-red-200"
                    : "border-border bg-popover text-foreground",
            )}
        >
            {/* Icon */}
            <div className="shrink-0 mt-0.5">
                {isDestructive ? (
                    <AlertCircle className="h-4 w-4 text-red-500" />
                ) : (
                    <Info className="h-4 w-4 text-blue-500" />
                )}
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0">
                <h3 className="text-sm font-semibold">{title}</h3>
                {description && (
                    <p
                        className={cn(
                            "mt-1 text-xs break-words",
                            isDestructive ? "text-red-300/80" : "text-muted-foreground",
                        )}
                    >
                        {description}
                    </p>
                )}
            </div>

            {/* Close Button */}
            <button
                onClick={(e) => {
                    e.stopPropagation();
                    onDismiss();
                }}
                className={cn(
                    "shrink-0 rounded-md p-1 opacity-70 transition-opacity hover:opacity-100",
                    isDestructive ? "hover:bg-red-900/50" : "hover:bg-accent",
                )}
                aria-label="Close"
            >
                <X className="h-3 w-3" />
            </button>
        </div>
    );
}
