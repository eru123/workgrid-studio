import { Copy, Rows3, Columns3 } from "lucide-react";

interface CellContextMenuProps {
    x: number;
    y: number;
    onCopyCell: () => void;
    onCopyRow: () => void;
    onCopyColumn: () => void;
    onClose: () => void;
}

export function CellContextMenu({
    x,
    y,
    onCopyCell,
    onCopyRow,
    onCopyColumn,
    onClose,
}: CellContextMenuProps) {
    return (
        <div
            style={{ position: "fixed", top: y, left: x, zIndex: 200 }}
            className="min-w-[170px] bg-popover text-popover-foreground border rounded-md shadow-xl p-1 text-xs"
            onClick={(e) => e.stopPropagation()}
            onContextMenu={(e) => e.preventDefault()}
        >
            <button
                className="w-full text-left px-2 py-1.5 hover:bg-accent rounded flex items-center gap-2"
                onClick={() => { onCopyCell(); onClose(); }}
            >
                <Copy className="w-3.5 h-3.5 text-muted-foreground" />
                Copy Cell
                <span className="ml-auto text-muted-foreground/50 tabular-nums">Ctrl+C</span>
            </button>
            <button
                className="w-full text-left px-2 py-1.5 hover:bg-accent rounded flex items-center gap-2"
                onClick={() => { onCopyRow(); onClose(); }}
            >
                <Rows3 className="w-3.5 h-3.5 text-muted-foreground" />
                Copy Row
            </button>
            <button
                className="w-full text-left px-2 py-1.5 hover:bg-accent rounded flex items-center gap-2"
                onClick={() => { onCopyColumn(); onClose(); }}
            >
                <Columns3 className="w-3.5 h-3.5 text-muted-foreground" />
                Copy Column
            </button>
        </div>
    );
}
