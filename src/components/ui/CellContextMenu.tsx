import { Copy, Rows3, Columns3, Braces, FileText, Table2 } from "lucide-react";

interface CellContextMenuProps {
    x: number;
    y: number;
    onCopyCell: () => void;
    onCopyRow: () => void;
    onCopyRowJson?: () => void;
    onCopyRowCsv?: () => void;
    onCopyRowSqlInsert?: () => void;
    onCopyColumn: () => void;
    onClose: () => void;
}

export function CellContextMenu({
    x,
    y,
    onCopyCell,
    onCopyRow,
    onCopyRowJson,
    onCopyRowCsv,
    onCopyRowSqlInsert,
    onCopyColumn,
    onClose,
}: CellContextMenuProps) {
    return (
        <div
            style={{ position: "fixed", top: y, left: x, zIndex: 200 }}
            className="min-w-[200px] bg-popover text-popover-foreground border rounded-md shadow-xl p-1 text-xs"
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
                Copy Row (TSV)
            </button>
            {(onCopyRowJson || onCopyRowCsv || onCopyRowSqlInsert) && (
                <div className="my-1 h-px bg-border" />
            )}
            {onCopyRowJson && (
                <button
                    className="w-full text-left px-2 py-1.5 hover:bg-accent rounded flex items-center gap-2"
                    onClick={() => { onCopyRowJson(); onClose(); }}
                >
                    <Braces className="w-3.5 h-3.5 text-muted-foreground" />
                    Copy Row as JSON
                </button>
            )}
            {onCopyRowCsv && (
                <button
                    className="w-full text-left px-2 py-1.5 hover:bg-accent rounded flex items-center gap-2"
                    onClick={() => { onCopyRowCsv(); onClose(); }}
                >
                    <FileText className="w-3.5 h-3.5 text-muted-foreground" />
                    Copy Row as CSV
                </button>
            )}
            {onCopyRowSqlInsert && (
                <button
                    className="w-full text-left px-2 py-1.5 hover:bg-accent rounded flex items-center gap-2"
                    onClick={() => { onCopyRowSqlInsert(); onClose(); }}
                >
                    <Table2 className="w-3.5 h-3.5 text-muted-foreground" />
                    Copy Row as SQL INSERT
                </button>
            )}
            <div className="my-1 h-px bg-border" />
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
