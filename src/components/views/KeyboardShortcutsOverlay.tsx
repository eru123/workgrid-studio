import { useEffect } from "react";
import { X } from "lucide-react";

interface ShortcutEntry {
    keys: string[];
    description: string;
}

interface ShortcutGroup {
    category: string;
    shortcuts: ShortcutEntry[];
}

const SHORTCUT_GROUPS: ShortcutGroup[] = [
    {
        category: "Global",
        shortcuts: [
            { keys: ["Ctrl", "N"], description: "New SQL Query tab" },
            { keys: ["Ctrl", "B"], description: "Toggle primary sidebar" },
            { keys: ["Ctrl", "`"], description: "Toggle bottom panel" },
            { keys: ["Ctrl", "Shift", "T"], description: "Restore last closed tab" },
            { keys: ["Ctrl", "Shift", "?"], description: "Show this keyboard shortcuts overlay" },
        ],
    },
    {
        category: "Query Editor",
        shortcuts: [
            { keys: ["Ctrl", "Enter"], description: "Run query" },
            { keys: ["F5"], description: "Run query" },
            { keys: ["Ctrl", "Shift", "Enter"], description: "Run selected text as query" },
            { keys: ["Ctrl", "S"], description: "Save query to file" },
        ],
    },
    {
        category: "Explorer",
        shortcuts: [
            { keys: ["Right-click"], description: "Open context menu for server / database / table" },
        ],
    },
    {
        category: "Data Grid",
        shortcuts: [
            { keys: ["↑", "↓", "←", "→"], description: "Navigate between cells" },
            { keys: ["Tab"], description: "Move to next cell" },
            { keys: ["Shift", "Tab"], description: "Move to previous cell" },
        ],
    },
    {
        category: "Table Designer",
        shortcuts: [
            { keys: ["Right-click"], description: "Open column context menu" },
        ],
    },
];

interface Props {
    onClose: () => void;
}

export function KeyboardShortcutsOverlay({ onClose }: Props) {
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose();
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, [onClose]);

    return (
        <div
            className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm"
            onClick={onClose}
        >
            <div
                className="relative bg-popover border border-border rounded-xl shadow-2xl w-full max-w-xl mx-4 max-h-[80vh] flex flex-col overflow-hidden"
                onClick={(e) => e.stopPropagation()}
                role="dialog"
                aria-modal="true"
                aria-label="Keyboard Shortcuts"
            >
                {/* Header */}
                <div className="flex items-center justify-between px-5 py-4 border-b shrink-0">
                    <h2 className="font-semibold text-sm">Keyboard Shortcuts</h2>
                    <button
                        onClick={onClose}
                        className="rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                        aria-label="Close"
                    >
                        <X className="w-4 h-4" />
                    </button>
                </div>

                {/* Shortcut list */}
                <div className="overflow-y-auto p-5 flex flex-col gap-6">
                    {SHORTCUT_GROUPS.map((group) => (
                        <div key={group.category}>
                            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                                {group.category}
                            </p>
                            <div className="flex flex-col gap-1">
                                {group.shortcuts.map((shortcut, i) => (
                                    <div
                                        key={i}
                                        className="flex items-center justify-between gap-4 py-1.5 px-2 rounded hover:bg-accent/40 transition-colors"
                                    >
                                        <span className="text-xs text-foreground/80">{shortcut.description}</span>
                                        <span className="flex items-center gap-1 shrink-0">
                                            {shortcut.keys.map((key, ki) => (
                                                <kbd
                                                    key={ki}
                                                    className="inline-flex items-center justify-center rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[11px] leading-none min-w-[22px]"
                                                >
                                                    {key}
                                                </kbd>
                                            ))}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>

                {/* Footer */}
                <div className="px-5 py-3 border-t text-[11px] text-muted-foreground/60 shrink-0">
                    Press <kbd className="inline-flex items-center justify-center rounded border border-border bg-muted px-1 font-mono text-[10px]">Esc</kbd> to close
                </div>
            </div>
        </div>
    );
}
