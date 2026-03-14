import { AlertTriangle } from "lucide-react";

interface Props {
    title: string;
    message: string;
    confirmLabel?: string;
    danger?: boolean;
    onCancel: () => void;
    onConfirm: () => void;
}

export function ConfirmModal({ title, message, confirmLabel = "Confirm", danger, onCancel, onConfirm }: Props) {
    return (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="bg-popover border rounded-lg shadow-2xl w-[420px] max-w-[90vw] p-0 overflow-hidden">
                {/* Header */}
                <div className="flex items-center gap-2.5 px-4 pt-4 pb-2">
                    {danger && <AlertTriangle className="w-5 h-5 text-red-500 shrink-0" />}
                    <h3 className="text-sm font-semibold text-foreground">{title}</h3>
                </div>

                {/* Message */}
                <div className="px-4 pb-4 text-xs text-muted-foreground whitespace-pre-line leading-relaxed">
                    {message}
                </div>

                {/* Footer */}
                <div className="flex justify-end gap-2 px-4 py-3 border-t bg-muted/20">
                    <button
                        className="px-3 py-1.5 text-xs rounded border hover:bg-accent transition-colors"
                        onClick={onCancel}
                    >
                        Cancel
                    </button>
                    <button
                        className={`px-3 py-1.5 text-xs rounded text-white transition-colors ${danger
                                ? "bg-red-600 hover:bg-red-700"
                                : "bg-primary hover:bg-primary/90"
                            }`}
                        onClick={onConfirm}
                    >
                        {confirmLabel}
                    </button>
                </div>
            </div>
        </div>
    );
}
