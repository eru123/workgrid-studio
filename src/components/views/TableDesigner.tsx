import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { dbGetCollations, dbExecuteQuery, dbListTables } from "@/lib/db";
import {
    Plus, Trash2, ArrowUp, ArrowDown, Table2, Settings, Zap, Link2,
    CheckCircle, Circle, Code, Loader2
} from "lucide-react";
import { cn } from "@/lib/utils/cn";

// ═══════════════════════════════════════════════════════════════════════
//  Types
// ═══════════════════════════════════════════════════════════════════════

const MYSQL_DATA_TYPES = [
    // Numeric
    "TINYINT", "SMALLINT", "MEDIUMINT", "INT", "BIGINT",
    "DECIMAL", "FLOAT", "DOUBLE", "BIT",
    // String
    "CHAR", "VARCHAR", "TINYTEXT", "TEXT", "MEDIUMTEXT", "LONGTEXT",
    "BINARY", "VARBINARY", "TINYBLOB", "BLOB", "MEDIUMBLOB", "LONGBLOB",
    "ENUM", "SET",
    // Date/Time
    "DATE", "DATETIME", "TIMESTAMP", "TIME", "YEAR",
    // Spatial
    "GEOMETRY", "POINT", "LINESTRING", "POLYGON",
    // JSON
    "JSON",
];

const ENGINES = ["<Server default>", "InnoDB", "MyISAM", "MEMORY", "CSV", "ARCHIVE", "BLACKHOLE", "MRG_MYISAM", "PERFORMANCE_SCHEMA"];
const ROW_FORMATS = ["DEFAULT", "DYNAMIC", "FIXED", "COMPRESSED", "REDUNDANT", "COMPACT"];
const INSERT_METHODS = ["", "NO", "FIRST", "LAST"];
const VIRTUALITY_OPTIONS = ["", "VIRTUAL", "STORED"];
const ON_UPDATE_DELETE = ["RESTRICT", "CASCADE", "SET NULL", "NO ACTION", "SET DEFAULT"];
const INDEX_TYPES = ["PRIMARY", "UNIQUE", "INDEX", "FULLTEXT", "SPATIAL"];
const INDEX_ALGORITHMS = ["", "BTREE", "HASH"];

interface ColumnDef {
    id: string;
    name: string;
    datatype: string;
    length: string;
    unsigned: boolean;
    allowNull: boolean;
    zerofill: boolean;
    defaultVal: string;
    comment: string;
    collation: string;
    expression: string;
    virtuality: string;
}

interface IndexDef {
    id: string;
    name: string;
    type: string; // PRIMARY, UNIQUE, INDEX, FULLTEXT, SPATIAL
    columns: string[];
    algorithm: string;
    comment: string;
}

interface ForeignKeyDef {
    id: string;
    name: string;
    columns: string[];
    refTable: string;
    refColumns: string[];
    onUpdate: string;
    onDelete: string;
}

interface CheckConstraintDef {
    id: string;
    name: string;
    expression: string;
}

interface TableOptions {
    engine: string;
    collation: string;
    autoIncrement: string;
    avgRowLength: string;
    maxRows: string;
    checksum: boolean;
    rowFormat: string;
    insertMethod: string;
    comment: string;
}

type SubTab = "basic" | "options" | "indexes" | "foreign-keys" | "check-constraints" | "partitions" | "create-code";

// ═══════════════════════════════════════════════════════════════════════
//  Helper
// ═══════════════════════════════════════════════════════════════════════

function uid() { return crypto.randomUUID().slice(0, 8); }

function newColumn(): ColumnDef {
    return {
        id: uid(),
        name: "",
        datatype: "INT",
        length: "",
        unsigned: false,
        allowNull: true,
        zerofill: false,
        defaultVal: "",
        comment: "",
        collation: "",
        expression: "",
        virtuality: "",
    };
}

function newIndex(): IndexDef {
    return { id: uid(), name: "", type: "INDEX", columns: [], algorithm: "", comment: "" };
}

function newForeignKey(): ForeignKeyDef {
    return { id: uid(), name: "", columns: [], refTable: "", refColumns: [], onUpdate: "RESTRICT", onDelete: "RESTRICT" };
}

function newCheckConstraint(): CheckConstraintDef {
    return { id: uid(), name: "", expression: "" };
}

// ═══════════════════════════════════════════════════════════════════════
//  Main Component
// ═══════════════════════════════════════════════════════════════════════

interface Props {
    profileId: string;
    database: string;
    /** If provided, load existing table for editing */
    tableName?: string;
}

export function TableDesigner({ profileId, database, tableName }: Props) {


    // ── State ──────────────────────────────────────────────────
    const [name, setName] = useState(tableName || "");
    const [tableComment, setTableComment] = useState("");
    const [columns, setColumns] = useState<ColumnDef[]>([]);
    const [indexes, setIndexes] = useState<IndexDef[]>([]);
    const [foreignKeys, setForeignKeys] = useState<ForeignKeyDef[]>([]);
    const [checkConstraints, setCheckConstraints] = useState<CheckConstraintDef[]>([]);
    const [options, setOptions] = useState<TableOptions>({
        engine: "<Server default>",
        collation: "",
        autoIncrement: "",
        avgRowLength: "",
        maxRows: "",
        checksum: false,
        rowFormat: "DEFAULT",
        insertMethod: "",
        comment: "",
    });
    const [activeTab, setActiveTab] = useState<SubTab>("basic");
    const [selectedColumn, setSelectedColumn] = useState<string | null>(null);
    const [selectedIndex, setSelectedIndex] = useState<string | null>(null);
    const [selectedFK, setSelectedFK] = useState<string | null>(null);
    const [selectedCheck, setSelectedCheck] = useState<string | null>(null);

    // ── Resizable split ───────────────────────────────────────
    const [splitPercent, setSplitPercent] = useState(35);
    const containerRef = useRef<HTMLDivElement>(null);
    const draggingRef = useRef(false);

    const handleDragStart = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        draggingRef.current = true;
        const startY = e.clientY;
        const startSplit = splitPercent;

        const onMove = (ev: MouseEvent) => {
            if (!draggingRef.current || !containerRef.current) return;
            const rect = containerRef.current.getBoundingClientRect();
            // subtract the tab bar height (~33px) and bottom toolbar (~37px)
            const availHeight = rect.height;
            const deltaY = ev.clientY - startY;
            const deltaPct = (deltaY / availHeight) * 100;
            const next = Math.min(80, Math.max(10, startSplit + deltaPct));
            setSplitPercent(next);
        };

        const onUp = () => {
            draggingRef.current = false;
            document.removeEventListener("mousemove", onMove);
            document.removeEventListener("mouseup", onUp);
            document.body.style.cursor = "";
            document.body.style.userSelect = "";
        };

        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp);
        document.body.style.cursor = "row-resize";
        document.body.style.userSelect = "none";
    }, [splitPercent]);

    // ── External data ─────────────────────────────────────────
    const [collations, setCollations] = useState<string[]>([]);
    const [tables, setTables] = useState<string[]>([]);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);

    useEffect(() => {
        dbGetCollations(profileId).then(res => {
            setCollations(res.collations);
            if (!options.collation && res.default_collation) {
                setOptions(prev => ({ ...prev, collation: res.default_collation }));
            }
        }).catch(() => { });
        dbListTables(profileId, database).then(setTables).catch(() => { });
    }, [profileId, database]);

    // ── Column CRUD ───────────────────────────────────────────
    const addColumn = useCallback(() => {
        const col = newColumn();
        setColumns(prev => [...prev, col]);
        setSelectedColumn(col.id);
    }, []);

    const removeColumn = useCallback(() => {
        if (!selectedColumn) return;
        setColumns(prev => {
            const idx = prev.findIndex(c => c.id === selectedColumn);
            const next = prev.filter(c => c.id !== selectedColumn);
            setSelectedColumn(next.length > 0 ? next[Math.min(idx, next.length - 1)]?.id || null : null);
            return next;
        });
    }, [selectedColumn]);

    const moveColumn = useCallback((dir: -1 | 1) => {
        if (!selectedColumn) return;
        setColumns(prev => {
            const idx = prev.findIndex(c => c.id === selectedColumn);
            const newIdx = idx + dir;
            if (newIdx < 0 || newIdx >= prev.length) return prev;
            const next = [...prev];
            [next[idx], next[newIdx]] = [next[newIdx], next[idx]];
            return next;
        });
    }, [selectedColumn]);

    const updateColumn = useCallback((id: string, field: keyof ColumnDef, value: any) => {
        setColumns(prev => prev.map(c => c.id === id ? { ...c, [field]: value } : c));
    }, []);

    // ── Index CRUD ────────────────────────────────────────────
    const addIndex = useCallback(() => {
        const idx = newIndex();
        setIndexes(prev => [...prev, idx]);
        setSelectedIndex(idx.id);
    }, []);

    const removeIndex = useCallback(() => {
        if (!selectedIndex) return;
        setIndexes(prev => prev.filter(i => i.id !== selectedIndex));
        setSelectedIndex(null);
    }, [selectedIndex]);

    const updateIndex = useCallback((id: string, field: keyof IndexDef, value: any) => {
        setIndexes(prev => prev.map(i => i.id === id ? { ...i, [field]: value } : i));
    }, []);

    // ── FK CRUD ───────────────────────────────────────────────
    const addFK = useCallback(() => {
        const fk = newForeignKey();
        setForeignKeys(prev => [...prev, fk]);
        setSelectedFK(fk.id);
    }, []);

    const removeFK = useCallback(() => {
        if (!selectedFK) return;
        setForeignKeys(prev => prev.filter(f => f.id !== selectedFK));
        setSelectedFK(null);
    }, [selectedFK]);

    const updateFK = useCallback((id: string, field: keyof ForeignKeyDef, value: any) => {
        setForeignKeys(prev => prev.map(f => f.id === id ? { ...f, [field]: value } : f));
    }, []);

    // ── Check CRUD ────────────────────────────────────────────
    const addCheck = useCallback(() => {
        const ch = newCheckConstraint();
        setCheckConstraints(prev => [...prev, ch]);
        setSelectedCheck(ch.id);
    }, []);

    const removeCheck = useCallback(() => {
        if (!selectedCheck) return;
        setCheckConstraints(prev => prev.filter(c => c.id !== selectedCheck));
        setSelectedCheck(null);
    }, [selectedCheck]);

    const updateCheck = useCallback((id: string, field: keyof CheckConstraintDef, value: any) => {
        setCheckConstraints(prev => prev.map(c => c.id === id ? { ...c, [field]: value } : c));
    }, []);

    // ── SQL Generation ────────────────────────────────────────
    const generateSQL = useMemo(() => {
        if (!name.trim()) return "-- Enter a table name first";

        const lines: string[] = [];
        lines.push(`CREATE TABLE \`${database}\`.\`${name}\` (`);

        // Columns
        const colLines: string[] = [];
        for (const col of columns) {
            if (!col.name.trim()) continue;
            let line = `  \`${col.name}\` ${col.datatype}`;
            if (col.length) line += `(${col.length})`;
            if (col.unsigned) line += " UNSIGNED";
            if (col.zerofill) line += " ZEROFILL";
            if (col.virtuality && col.expression) {
                line += ` AS (${col.expression}) ${col.virtuality}`;
            }
            if (!col.allowNull) line += " NOT NULL";
            if (col.defaultVal) {
                if (col.defaultVal.toUpperCase() === "NULL" || col.defaultVal.toUpperCase() === "CURRENT_TIMESTAMP" || col.defaultVal.startsWith("(")) {
                    line += ` DEFAULT ${col.defaultVal}`;
                } else {
                    line += ` DEFAULT '${col.defaultVal}'`;
                }
            }
            if (col.collation) {
                line += ` COLLATE '${col.collation}'`;
            }
            if (col.comment) line += ` COMMENT '${col.comment.replace(/'/g, "\\'")}'`;
            colLines.push(line);
        }

        // Primary key from indexes
        for (const idx of indexes) {
            if (idx.type === "PRIMARY" && idx.columns.length > 0) {
                colLines.push(`  PRIMARY KEY (${idx.columns.map(c => `\`${c}\``).join(", ")})`);
            } else if (idx.columns.length > 0) {
                const prefix = idx.type === "UNIQUE" ? "UNIQUE " : idx.type === "FULLTEXT" ? "FULLTEXT " : idx.type === "SPATIAL" ? "SPATIAL " : "";
                const alg = idx.algorithm ? ` USING ${idx.algorithm}` : "";
                colLines.push(`  ${prefix}INDEX \`${idx.name}\` (${idx.columns.map(c => `\`${c}\``).join(", ")})${alg}${idx.comment ? ` COMMENT '${idx.comment}'` : ""}`);
            }
        }

        // Foreign keys
        for (const fk of foreignKeys) {
            if (fk.columns.length > 0 && fk.refTable && fk.refColumns.length > 0) {
                colLines.push(`  CONSTRAINT \`${fk.name}\` FOREIGN KEY (${fk.columns.map(c => `\`${c}\``).join(", ")}) REFERENCES \`${fk.refTable}\` (${fk.refColumns.map(c => `\`${c}\``).join(", ")}) ON UPDATE ${fk.onUpdate} ON DELETE ${fk.onDelete}`);
            }
        }

        // Check constraints
        for (const ch of checkConstraints) {
            if (ch.expression) {
                colLines.push(`  ${ch.name ? `CONSTRAINT \`${ch.name}\` ` : ""}CHECK (${ch.expression})`);
            }
        }

        lines.push(colLines.join(",\n"));
        lines.push(`)`)

        // Table options
        const tblOpts: string[] = [];
        if (options.engine && options.engine !== "<Server default>") tblOpts.push(`ENGINE=${options.engine}`);
        if (options.collation) {
            const charset = options.collation.split("_")[0];
            tblOpts.push(`DEFAULT CHARSET=${charset}`, `COLLATE=${options.collation}`);
        }
        if (options.autoIncrement) tblOpts.push(`AUTO_INCREMENT=${options.autoIncrement}`);
        if (options.avgRowLength) tblOpts.push(`AVG_ROW_LENGTH=${options.avgRowLength}`);
        if (options.maxRows) tblOpts.push(`MAX_ROWS=${options.maxRows}`);
        if (options.checksum) tblOpts.push(`CHECKSUM=1`);
        if (options.rowFormat !== "DEFAULT") tblOpts.push(`ROW_FORMAT=${options.rowFormat}`);
        if (options.insertMethod) tblOpts.push(`INSERT_METHOD=${options.insertMethod}`);
        if (tableComment || options.comment) tblOpts.push(`COMMENT='${(tableComment || options.comment).replace(/'/g, "\\'")}'`);

        if (tblOpts.length > 0) {
            lines[lines.length - 1] += " " + tblOpts.join(" ");
        }

        lines[lines.length - 1] += ";";
        return lines.join("\n");
    }, [name, database, columns, indexes, foreignKeys, checkConstraints, options, tableComment]);

    // ── Save handler ──────────────────────────────────────────
    const handleSave = async () => {
        if (!name.trim()) return;
        setSaving(true);
        setError(null);
        setSuccess(null);
        try {
            await dbExecuteQuery(profileId, generateSQL);
            setSuccess(`Table \`${name}\` created successfully!`);
        } catch (e) {
            setError(String(e));
        } finally {
            setSaving(false);
        }
    };

    const handleDiscard = () => {
        setName(tableName || "");
        setTableComment("");
        setColumns([]);
        setSelectedColumn(null);
        setIndexes([]);
        setForeignKeys([]);
        setCheckConstraints([]);
        setOptions({
            engine: "<Server default>",
            collation: "",
            autoIncrement: "",
            avgRowLength: "",
            maxRows: "",
            checksum: false,
            rowFormat: "DEFAULT",
            insertMethod: "",
            comment: "",
        });
        setError(null);
        setSuccess(null);
    };

    // ═══════════════════════════════════════════════════════════
    //  Render sub-tabs
    // ═══════════════════════════════════════════════════════════

    const subTabs: { key: SubTab; label: string; icon: React.ReactNode; badge?: string }[] = [
        { key: "basic", label: "Basic", icon: <Table2 className="w-3.5 h-3.5" /> },
        { key: "options", label: "Options", icon: <Settings className="w-3.5 h-3.5" /> },
        { key: "indexes", label: `Indexes (${indexes.length})`, icon: <Zap className="w-3.5 h-3.5" /> },
        { key: "foreign-keys", label: `Foreign keys (${foreignKeys.length})`, icon: <Link2 className="w-3.5 h-3.5" /> },
        { key: "check-constraints", label: `Check constraints (${checkConstraints.length})`, icon: <CheckCircle className="w-3.5 h-3.5" /> },
        { key: "partitions", label: "Partitions", icon: <Circle className="w-3.5 h-3.5" /> },
        { key: "create-code", label: "CREATE code", icon: <Code className="w-3.5 h-3.5" /> },
    ];

    const colNames = columns.filter(c => c.name.trim()).map(c => c.name);

    return (
        <div ref={containerRef} className="flex flex-col w-full h-full bg-background text-foreground text-xs overflow-hidden">
            {/* ─── Sub-tab bar ─────────────────────────────── */}
            <div className="flex items-center border-b bg-muted/30 px-1 gap-0 overflow-x-auto shrink-0">
                {subTabs.map(t => (
                    <button
                        key={t.key}
                        className={cn(
                            "flex items-center gap-1.5 px-3 py-2 text-xs transition-colors border-b-2 whitespace-nowrap",
                            activeTab === t.key
                                ? "border-primary text-foreground font-medium"
                                : "border-transparent text-muted-foreground hover:text-foreground hover:bg-accent/30"
                        )}
                        onClick={() => setActiveTab(t.key)}
                    >
                        {t.icon}
                        {t.label}
                    </button>
                ))}
            </div>

            {/* ─── Upper area: Sub-tab content ─────────────── */}
            <div className="shrink-0 overflow-auto" style={{ height: `${splitPercent}%` }}>
                {/* ── Basic Tab ─────────────────────── */}
                {activeTab === "basic" && (
                    <div className="px-3 pt-3 pb-2 space-y-2">
                        <div className="flex items-center gap-2">
                            <label className="text-xs text-muted-foreground w-[70px] shrink-0 text-right">Name:</label>
                            <input
                                value={name}
                                onChange={e => setName(e.target.value)}
                                className="flex-1 h-7 rounded bg-secondary/50 border px-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary font-mono"
                                placeholder="Enter table name"
                            />
                        </div>
                        <div className="flex items-start gap-2">
                            <label className="text-xs text-muted-foreground w-[70px] shrink-0 text-right pt-1">Comment:</label>
                            <textarea
                                value={tableComment}
                                onChange={e => setTableComment(e.target.value)}
                                className="flex-1 h-14 rounded bg-secondary/50 border px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-primary font-mono resize-none"
                            />
                        </div>
                    </div>
                )}

                {/* ── Options Tab ───────────────────── */}
                {activeTab === "options" && (
                    <div className="p-3 grid grid-cols-2 gap-x-6 gap-y-2">
                        <OptRow label="Auto increment:"><OptInput value={options.autoIncrement} onChange={v => setOptions(o => ({ ...o, autoIncrement: v }))} /></OptRow>
                        <OptRow label="Default collation:"><OptSelect value={options.collation} onChange={v => setOptions(o => ({ ...o, collation: v }))} options={["", ...collations]} /></OptRow>
                        <OptRow label="Average row length:"><OptInput value={options.avgRowLength} onChange={v => setOptions(o => ({ ...o, avgRowLength: v }))} /></OptRow>
                        <OptRow label="Engine:"><OptSelect value={options.engine} onChange={v => setOptions(o => ({ ...o, engine: v }))} options={ENGINES} /></OptRow>
                        <OptRow label="Maximum row count:"><OptInput value={options.maxRows} onChange={v => setOptions(o => ({ ...o, maxRows: v }))} /></OptRow>
                        <OptRow label="Row format:"><OptSelect value={options.rowFormat} onChange={v => setOptions(o => ({ ...o, rowFormat: v }))} options={ROW_FORMATS} /></OptRow>
                        <OptRow label="Checksum for rows:">
                            <label className="flex items-center gap-1.5 cursor-pointer">
                                <input type="checkbox" checked={options.checksum} onChange={e => setOptions(o => ({ ...o, checksum: e.target.checked }))} />
                            </label>
                        </OptRow>
                        <OptRow label="INSERT method:"><OptSelect value={options.insertMethod} onChange={v => setOptions(o => ({ ...o, insertMethod: v }))} options={INSERT_METHODS} /></OptRow>
                    </div>
                )}

                {/* ── Indexes Tab ───────────────────── */}
                {activeTab === "indexes" && (
                    <div className="flex overflow-hidden" style={{ minHeight: 120 }}>
                        <div className="flex flex-col shrink-0">
                            <div className="flex items-center gap-1 px-3 py-1.5 border-b">
                                <ToolBtn icon={<Plus className="w-3 h-3" />} label="Add" onClick={addIndex} color="text-green-500" />
                                <ToolBtn icon={<Trash2 className="w-3 h-3" />} label="Remove" onClick={removeIndex} color="text-red-500" disabled={!selectedIndex} />
                            </div>
                            <div className="w-[250px] border-r overflow-y-auto flex-1">
                                {indexes.length === 0 && (
                                    <div className="p-3 text-muted-foreground/50 text-center">No indexes defined</div>
                                )}
                                {indexes.map(idx => (
                                    <div
                                        key={idx.id}
                                        className={cn(
                                            "px-3 py-2 cursor-pointer border-b transition-colors",
                                            selectedIndex === idx.id ? "bg-accent/60" : "hover:bg-accent/20"
                                        )}
                                        onClick={() => setSelectedIndex(idx.id)}
                                    >
                                        <div className="font-medium">{idx.name || "(unnamed)"}</div>
                                        <div className="text-muted-foreground/60">{idx.type} · {idx.columns.length} col(s)</div>
                                    </div>
                                ))}
                            </div>
                        </div>
                        <div className="flex-1 p-3 overflow-auto">
                            {selectedIndex ? (() => {
                                const idx = indexes.find(i => i.id === selectedIndex);
                                if (!idx) return null;
                                return (
                                    <div className="space-y-3">
                                        <div className="flex items-center gap-2">
                                            <label className="w-[100px] text-right text-muted-foreground shrink-0">Name:</label>
                                            <input value={idx.name} onChange={e => updateIndex(idx.id, "name", e.target.value)} className="flex-1 h-7 rounded bg-secondary/50 border px-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-primary" />
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <label className="w-[100px] text-right text-muted-foreground shrink-0">Type:</label>
                                            <select value={idx.type} onChange={e => updateIndex(idx.id, "type", e.target.value)} className="h-7 rounded bg-secondary/50 border px-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary">
                                                {INDEX_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                                            </select>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <label className="w-[100px] text-right text-muted-foreground shrink-0">Algorithm:</label>
                                            <select value={idx.algorithm} onChange={e => updateIndex(idx.id, "algorithm", e.target.value)} className="h-7 rounded bg-secondary/50 border px-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary">
                                                {INDEX_ALGORITHMS.map(a => <option key={a} value={a}>{a || "(default)"}</option>)}
                                            </select>
                                        </div>
                                        <div className="flex items-start gap-2">
                                            <label className="w-[100px] text-right text-muted-foreground shrink-0 pt-1">Columns:</label>
                                            <div className="flex-1 space-y-1">
                                                {colNames.map(cn => (
                                                    <label key={cn} className="flex items-center gap-1.5 cursor-pointer">
                                                        <input
                                                            type="checkbox"
                                                            checked={idx.columns.includes(cn)}
                                                            onChange={e => {
                                                                const next = e.target.checked
                                                                    ? [...idx.columns, cn]
                                                                    : idx.columns.filter(c => c !== cn);
                                                                updateIndex(idx.id, "columns", next);
                                                            }}
                                                        />
                                                        <span className="font-mono">{cn}</span>
                                                    </label>
                                                ))}
                                                {colNames.length === 0 && <span className="text-muted-foreground/50">Add columns below first</span>}
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <label className="w-[100px] text-right text-muted-foreground shrink-0">Comment:</label>
                                            <input value={idx.comment} onChange={e => updateIndex(idx.id, "comment", e.target.value)} className="flex-1 h-7 rounded bg-secondary/50 border px-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-primary" />
                                        </div>
                                    </div>
                                );
                            })() : (
                                <div className="text-muted-foreground/50 text-center mt-8">Select an index or add a new one</div>
                            )}
                        </div>
                    </div>
                )}

                {/* ── Foreign Keys Tab ──────────────── */}
                {activeTab === "foreign-keys" && (
                    <div className="flex overflow-hidden" style={{ minHeight: 120 }}>
                        <div className="flex flex-col shrink-0">
                            <div className="flex items-center gap-1 px-3 py-1.5 border-b">
                                <ToolBtn icon={<Plus className="w-3 h-3" />} label="Add" onClick={addFK} color="text-green-500" />
                                <ToolBtn icon={<Trash2 className="w-3 h-3" />} label="Remove" onClick={removeFK} color="text-red-500" disabled={!selectedFK} />
                            </div>
                            <div className="w-[250px] border-r overflow-y-auto flex-1">
                                {foreignKeys.length === 0 && (
                                    <div className="p-3 text-muted-foreground/50 text-center">No foreign keys defined</div>
                                )}
                                {foreignKeys.map(fk => (
                                    <div
                                        key={fk.id}
                                        className={cn(
                                            "px-3 py-2 cursor-pointer border-b transition-colors",
                                            selectedFK === fk.id ? "bg-accent/60" : "hover:bg-accent/20"
                                        )}
                                        onClick={() => setSelectedFK(fk.id)}
                                    >
                                        <div className="font-medium">{fk.name || "(unnamed)"}</div>
                                        <div className="text-muted-foreground/60">{fk.columns.join(", ")} → {fk.refTable || "?"}</div>
                                    </div>
                                ))}
                            </div>
                        </div>
                        <div className="flex-1 p-3 overflow-auto">
                            {selectedFK ? (() => {
                                const fk = foreignKeys.find(f => f.id === selectedFK);
                                if (!fk) return null;
                                return (
                                    <div className="space-y-3">
                                        <div className="flex items-center gap-2">
                                            <label className="w-[110px] text-right text-muted-foreground shrink-0">Key name:</label>
                                            <input value={fk.name} onChange={e => updateFK(fk.id, "name", e.target.value)} className="flex-1 h-7 rounded bg-secondary/50 border px-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-primary" />
                                        </div>
                                        <div className="flex items-start gap-2">
                                            <label className="w-[110px] text-right text-muted-foreground shrink-0 pt-1">Columns:</label>
                                            <div className="flex-1 space-y-1">
                                                {colNames.map(cn => (
                                                    <label key={cn} className="flex items-center gap-1.5 cursor-pointer">
                                                        <input type="checkbox" checked={fk.columns.includes(cn)} onChange={e => {
                                                            const next = e.target.checked ? [...fk.columns, cn] : fk.columns.filter(c => c !== cn);
                                                            updateFK(fk.id, "columns", next);
                                                        }} />
                                                        <span className="font-mono">{cn}</span>
                                                    </label>
                                                ))}
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <label className="w-[110px] text-right text-muted-foreground shrink-0">Reference table:</label>
                                            <select value={fk.refTable} onChange={e => updateFK(fk.id, "refTable", e.target.value)} className="flex-1 h-7 rounded bg-secondary/50 border px-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary">
                                                <option value="">-- select --</option>
                                                {tables.map(t => <option key={t} value={t}>{t}</option>)}
                                            </select>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <label className="w-[110px] text-right text-muted-foreground shrink-0">Foreign col(s):</label>
                                            <input value={fk.refColumns.join(", ")} onChange={e => updateFK(fk.id, "refColumns", e.target.value.split(",").map(s => s.trim()).filter(Boolean))} className="flex-1 h-7 rounded bg-secondary/50 border px-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-primary" placeholder="col1, col2" />
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <label className="w-[110px] text-right text-muted-foreground shrink-0">On UPDATE:</label>
                                            <select value={fk.onUpdate} onChange={e => updateFK(fk.id, "onUpdate", e.target.value)} className="h-7 rounded bg-secondary/50 border px-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary">
                                                {ON_UPDATE_DELETE.map(v => <option key={v} value={v}>{v}</option>)}
                                            </select>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <label className="w-[110px] text-right text-muted-foreground shrink-0">On DELETE:</label>
                                            <select value={fk.onDelete} onChange={e => updateFK(fk.id, "onDelete", e.target.value)} className="h-7 rounded bg-secondary/50 border px-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary">
                                                {ON_UPDATE_DELETE.map(v => <option key={v} value={v}>{v}</option>)}
                                            </select>
                                        </div>
                                    </div>
                                );
                            })() : (
                                <div className="text-muted-foreground/50 text-center mt-8">Select a foreign key or add a new one</div>
                            )}
                        </div>
                    </div>
                )}

                {/* ── Check Constraints Tab ─────────── */}
                {activeTab === "check-constraints" && (
                    <div className="flex overflow-hidden" style={{ minHeight: 120 }}>
                        <div className="flex flex-col shrink-0">
                            <div className="flex items-center gap-1 px-3 py-1.5 border-b">
                                <ToolBtn icon={<Plus className="w-3 h-3" />} label="Add" onClick={addCheck} color="text-green-500" />
                                <ToolBtn icon={<Trash2 className="w-3 h-3" />} label="Remove" onClick={removeCheck} color="text-red-500" disabled={!selectedCheck} />
                            </div>
                            <div className="w-[250px] border-r overflow-y-auto flex-1">
                                {checkConstraints.length === 0 && (
                                    <div className="p-3 text-muted-foreground/50 text-center">No check constraints</div>
                                )}
                                {checkConstraints.map(ch => (
                                    <div
                                        key={ch.id}
                                        className={cn(
                                            "px-3 py-2 cursor-pointer border-b transition-colors",
                                            selectedCheck === ch.id ? "bg-accent/60" : "hover:bg-accent/20"
                                        )}
                                        onClick={() => setSelectedCheck(ch.id)}
                                    >
                                        <div className="font-medium">{ch.name || "(unnamed)"}</div>
                                        <div className="text-muted-foreground/60 truncate">{ch.expression || "..."}</div>
                                    </div>
                                ))}
                            </div>
                        </div>
                        <div className="flex-1 p-3 overflow-auto">
                            {selectedCheck ? (() => {
                                const ch = checkConstraints.find(c => c.id === selectedCheck);
                                if (!ch) return null;
                                return (
                                    <div className="space-y-3">
                                        <div className="flex items-center gap-2">
                                            <label className="w-[100px] text-right text-muted-foreground shrink-0">Name:</label>
                                            <input value={ch.name} onChange={e => updateCheck(ch.id, "name", e.target.value)} className="flex-1 h-7 rounded bg-secondary/50 border px-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-primary" />
                                        </div>
                                        <div className="flex items-start gap-2">
                                            <label className="w-[100px] text-right text-muted-foreground shrink-0 pt-1">Expression:</label>
                                            <textarea value={ch.expression} onChange={e => updateCheck(ch.id, "expression", e.target.value)} className="flex-1 h-24 rounded bg-secondary/50 border px-2 py-1 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-primary resize-none" placeholder="e.g. age > 0" />
                                        </div>
                                    </div>
                                );
                            })() : (
                                <div className="text-muted-foreground/50 text-center mt-8">Select a constraint or add a new one</div>
                            )}
                        </div>
                    </div>
                )}

                {/* ── Partitions Tab ────────────────── */}
                {activeTab === "partitions" && (
                    <div className="flex items-center justify-center p-6 text-muted-foreground/50">
                        <div className="text-center">
                            <Circle className="w-8 h-8 mx-auto mb-2 opacity-30" />
                            <div>Partitions (coming soon)</div>
                        </div>
                    </div>
                )}

                {/* ── CREATE Code Tab ───────────────── */}
                {activeTab === "create-code" && (
                    <div className="overflow-auto p-3">
                        <pre className="text-[11px] bg-secondary/30 border rounded p-3 font-mono whitespace-pre-wrap text-foreground leading-relaxed min-h-[100px] select-text">
                            {generateSQL}
                        </pre>
                    </div>
                )}
            </div>

            {/* ═══ Drag handle ═══════════════════════════════ */}
            <div
                className="shrink-0 border-y border-border cursor-row-resize hover:bg-primary/20 active:bg-primary/30 transition-colors group flex items-center justify-center"
                style={{ height: 5 }}
                onMouseDown={handleDragStart}
            >
                <div className="w-8 h-[2px] rounded bg-muted-foreground/20 group-hover:bg-primary/50 transition-colors" />
            </div>

            {/* ═══ Columns grid — always visible ═══════════════ */}
            <div className="flex flex-col flex-1 overflow-hidden">
                {/* Columns toolbar */}
                <div className="flex items-center gap-1 px-3 py-1.5 border-b shrink-0 bg-muted/20">
                    <span className="text-xs text-muted-foreground mr-1 font-medium">Columns:</span>
                    <ToolBtn icon={<Plus className="w-3 h-3" />} label="Add" onClick={addColumn} color="text-green-500" />
                    <ToolBtn icon={<Trash2 className="w-3 h-3" />} label="Remove" onClick={removeColumn} color="text-red-500" disabled={columns.length === 0} />
                    <ToolBtn icon={<ArrowUp className="w-3 h-3" />} label="Up" onClick={() => moveColumn(-1)} disabled={!selectedColumn} />
                    <ToolBtn icon={<ArrowDown className="w-3 h-3" />} label="Down" onClick={() => moveColumn(1)} disabled={!selectedColumn} />
                </div>

                {/* Columns table */}
                <div className="flex-1 overflow-auto">
                    <table className="w-full text-xs border-collapse min-w-[900px]">
                        <thead>
                            <tr className="bg-muted/50 sticky top-0 z-10">
                                <Th w={30}>#</Th>
                                <Th w={140}>Name</Th>
                                <Th w={120}>Datatype</Th>
                                <Th w={80}>Length/Set</Th>
                                <Th w={65}>Unsigned</Th>
                                <Th w={75}>Allow NULL</Th>
                                <Th w={60}>Zerofill</Th>
                                <Th w={120}>Default</Th>
                                <Th w={130}>Comment</Th>
                                <Th w={130}>Collation</Th>
                                <Th w={120}>Expression</Th>
                                <Th w={80}>Virtuality</Th>
                            </tr>
                        </thead>
                        <tbody>
                            {columns.length === 0 && (
                                <tr>
                                    <td colSpan={12} className="text-center py-6 text-muted-foreground/40">
                                        No columns yet. Click <strong>Add</strong> to create one.
                                    </td>
                                </tr>
                            )}
                            {columns.map((col, i) => (
                                <tr
                                    key={col.id}
                                    className={cn(
                                        "border-b cursor-pointer transition-colors",
                                        selectedColumn === col.id ? "bg-accent/60" : "hover:bg-accent/20"
                                    )}
                                    onClick={() => setSelectedColumn(col.id)}
                                >
                                    <Td className="text-center text-muted-foreground/50">{i + 1}</Td>
                                    <Td><CellInput value={col.name} onChange={v => updateColumn(col.id, "name", v)} placeholder="Column name" /></Td>
                                    <Td>
                                        <CellSelect value={col.datatype} onChange={v => updateColumn(col.id, "datatype", v)} options={MYSQL_DATA_TYPES} />
                                    </Td>
                                    <Td><CellInput value={col.length} onChange={v => updateColumn(col.id, "length", v)} placeholder="" /></Td>
                                    <Td className="text-center"><CellCheckbox checked={col.unsigned} onChange={v => updateColumn(col.id, "unsigned", v)} /></Td>
                                    <Td className="text-center"><CellCheckbox checked={col.allowNull} onChange={v => updateColumn(col.id, "allowNull", v)} /></Td>
                                    <Td className="text-center"><CellCheckbox checked={col.zerofill} onChange={v => updateColumn(col.id, "zerofill", v)} /></Td>
                                    <Td><CellInput value={col.defaultVal} onChange={v => updateColumn(col.id, "defaultVal", v)} placeholder="No default" /></Td>
                                    <Td><CellInput value={col.comment} onChange={v => updateColumn(col.id, "comment", v)} /></Td>
                                    <Td>
                                        <CellSelect
                                            value={col.collation}
                                            onChange={v => updateColumn(col.id, "collation", v)}
                                            options={["", ...collations]}
                                        />
                                    </Td>
                                    <Td><CellInput value={col.expression} onChange={v => updateColumn(col.id, "expression", v)} /></Td>
                                    <Td>
                                        <CellSelect value={col.virtuality} onChange={v => updateColumn(col.id, "virtuality", v)} options={VIRTUALITY_OPTIONS} />
                                    </Td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* ─── Status / Error bar ──────────────────────── */}
            {(error || success) && (
                <div className={cn(
                    "px-3 py-1.5 text-xs border-t shrink-0",
                    error ? "bg-red-500/10 text-red-400" : "bg-green-500/10 text-green-400"
                )}>
                    {error || success}
                </div>
            )}

            {/* ─── Bottom toolbar ─────────────────────────── */}
            <div className="flex items-center gap-2 px-3 py-2 border-t bg-muted/20 shrink-0">
                <button
                    className="px-3 py-1.5 text-xs rounded border hover:bg-accent transition-colors"
                    onClick={handleDiscard}
                >
                    Discard
                </button>
                <button
                    className="px-3 py-1.5 text-xs rounded bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center gap-1.5"
                    onClick={handleSave}
                    disabled={saving || !name.trim()}
                >
                    {saving && <Loader2 className="w-3 h-3 animate-spin" />}
                    {saving ? "Saving..." : "Save"}
                </button>
            </div>
        </div>
    );
}

// ═══════════════════════════════════════════════════════════════════════
//  Reusable sub-components
// ═══════════════════════════════════════════════════════════════════════

function ToolBtn({ icon, label, onClick, color, disabled }: { icon: React.ReactNode; label: string; onClick: () => void; color?: string; disabled?: boolean }) {
    return (
        <button
            className={cn("flex items-center gap-1 px-2 py-1 rounded hover:bg-accent transition-colors text-xs", color, disabled && "opacity-40 pointer-events-none")}
            onClick={onClick}
            disabled={disabled}
        >
            {icon}
            {label}
        </button>
    );
}

function Th({ children, w }: { children: React.ReactNode; w?: number }) {
    return (
        <th
            className="text-left px-1.5 py-1.5 text-[10px] font-medium text-muted-foreground/70 uppercase tracking-wider border-b border-r bg-muted/50 whitespace-nowrap"
            style={w ? { width: w, minWidth: w } : undefined}
        >
            {children}
        </th>
    );
}

function Td({ children, className }: { children: React.ReactNode; className?: string }) {
    return (
        <td className={cn("px-1 py-0 border-r h-[28px]", className)}>
            {children}
        </td>
    );
}

function CellInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
    return (
        <input
            value={value}
            onChange={e => onChange(e.target.value)}
            className="w-full h-[26px] bg-transparent border-0 outline-none text-xs font-mono px-1 focus:bg-secondary/50"
            placeholder={placeholder}
        />
    );
}

function CellSelect({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: string[] }) {
    return (
        <select
            value={value}
            onChange={e => onChange(e.target.value)}
            className="w-full h-[26px] bg-transparent border-0 outline-none text-xs font-mono px-0 focus:bg-secondary/50 cursor-pointer"
        >
            {options.map(opt => (
                <option key={opt} value={opt}>{opt || "(none)"}</option>
            ))}
        </select>
    );
}

function CellCheckbox({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
    return (
        <input
            type="checkbox"
            checked={checked}
            onChange={e => onChange(e.target.checked)}
            className="cursor-pointer"
        />
    );
}

function OptRow({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="flex items-center gap-2">
            <label className="text-xs text-muted-foreground w-[140px] shrink-0 text-right">{label}</label>
            {children}
        </div>
    );
}

function OptInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
    return (
        <input
            value={value}
            onChange={e => onChange(e.target.value)}
            className="flex-1 h-7 rounded bg-secondary/50 border px-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-primary"
        />
    );
}

function OptSelect({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: string[] }) {
    return (
        <select
            value={value}
            onChange={e => onChange(e.target.value)}
            className="flex-1 h-7 rounded bg-secondary/50 border px-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
        >
            {options.map(opt => (
                <option key={opt} value={opt}>{opt || "(none)"}</option>
            ))}
        </select>
    );
}
