import { useState, useEffect, useMemo } from "react";
import { dbGetDatabasesInfo, dbGetTablesInfo, dbGetVariables, dbSetVariable, dbGetStatus, dbGetProcesses, dbKillProcess, DatabaseInfo, TableInfo, VariableInfo, StatusInfo, ProcessInfo } from "@/lib/db";
import { useLayoutStore } from "@/state/layoutStore";
import { cn } from "@/lib/utils/cn";
import {
    Database,
    Loader2,
    AlertCircle,
    X,
    Settings2,
    Filter,
    Zap,
    Play,
    Copy,
    BarChart2,
    Key,
    Table2,
} from "lucide-react";

type SubTab = "databases" | "tables" | "variables" | "status" | "processes" | "commands";

interface Props {
    tabId: string;
    profileId: string;
    profileName: string;
    database?: string;
}

function formatBytes(bytes: number): string {
    if (bytes === 0) return "0 B";
    const units = ["B", "KiB", "MiB", "GiB", "TiB"];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

export function DatabaseView({ tabId, profileId, profileName, database }: Props) {
    const updateTab = useLayoutStore((s) => s.updateTab);
    const [activeTab, setActiveTab] = useState<SubTab>(database ? "tables" : "databases");
    const [dbInfos, setDbInfos] = useState<DatabaseInfo[]>([]);
    const [tableInfos, setTableInfos] = useState<TableInfo[]>([]);
    const [variables, setVariables] = useState<VariableInfo[]>([]);
    const [statusInfos, setStatusInfos] = useState<StatusInfo[]>([]);
    const [processInfos, setProcessInfos] = useState<ProcessInfo[]>([]);
    const [loadingDbs, setLoadingDbs] = useState(false);
    const [loadingTables, setLoadingTables] = useState(false);
    const [loadingVars, setLoadingVars] = useState(false);
    const [loadingStatus, setLoadingStatus] = useState(false);
    const [loadingProcesses, setLoadingProcesses] = useState(false);
    const [errorDbs, setErrorDbs] = useState<string | null>(null);
    const [errorTables, setErrorTables] = useState<string | null>(null);
    const [errorVars, setErrorVars] = useState<string | null>(null);
    const [errorStatus, setErrorStatus] = useState<string | null>(null);
    const [errorProcesses, setErrorProcesses] = useState<string | null>(null);

    // Fetch databases
    useEffect(() => {
        if (activeTab === "databases" && !database) {
            setLoadingDbs(true);
            setErrorDbs(null);
            dbGetDatabasesInfo(profileId)
                .then(setDbInfos)
                .catch((e) => setErrorDbs(String(e)))
                .finally(() => setLoadingDbs(false));
        }
    }, [profileId, database, activeTab]);

    // Switch tabs dynamically if database prop changes
    useEffect(() => {
        if (database && activeTab === "databases") setActiveTab("tables");
        if (!database && activeTab === "tables") setActiveTab("databases");
    }, [database]);

    // Fetch tables
    useEffect(() => {
        if (activeTab === "tables" && database) {
            setLoadingTables(true);
            setErrorTables(null);
            dbGetTablesInfo(profileId, database)
                .then(setTableInfos)
                .catch((e) => setErrorTables(String(e)))
                .finally(() => setLoadingTables(false));
        }
    }, [profileId, database, activeTab]);

    const fetchVariables = () => {
        setLoadingVars(true);
        setErrorVars(null);
        dbGetVariables(profileId)
            .then(setVariables)
            .catch((e) => setErrorVars(String(e)))
            .finally(() => setLoadingVars(false));
    };

    // Fetch variables
    useEffect(() => {
        if (activeTab === "variables" && variables.length === 0) {
            fetchVariables();
        }
    }, [profileId, activeTab, variables.length]);

    const fetchStatus = () => {
        setLoadingStatus(true);
        setErrorStatus(null);
        dbGetStatus(profileId)
            .then(setStatusInfos)
            .catch((e) => setErrorStatus(String(e)))
            .finally(() => setLoadingStatus(false));
    };

    // Fetch status (shared by status and commands tabs)
    useEffect(() => {
        if ((activeTab === "status" || activeTab === "commands") && statusInfos.length === 0) {
            fetchStatus();
        }
    }, [profileId, activeTab, statusInfos.length]);

    const fetchProcesses = () => {
        setLoadingProcesses(true);
        setErrorProcesses(null);
        dbGetProcesses(profileId)
            .then(setProcessInfos)
            .catch((e) => setErrorProcesses(String(e)))
            .finally(() => setLoadingProcesses(false));
    };

    // Fetch processes
    useEffect(() => {
        if (activeTab === "processes" && processInfos.length === 0) {
            fetchProcesses();
        }
    }, [profileId, activeTab, processInfos.length]);

    // Handle global refresh shortcuts (F5 / Ctrl + R)
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === "F5" || (e.ctrlKey && e.key.toLowerCase() === "r")) {
                e.preventDefault();

                // Fetch the active tab's data
                if (activeTab === "databases") {
                    setLoadingDbs(true);
                    dbGetDatabasesInfo(profileId).then(setDbInfos).finally(() => setLoadingDbs(false));
                } else if (activeTab === "tables" && database) {
                    setLoadingTables(true);
                    dbGetTablesInfo(profileId, database).then(setTableInfos).finally(() => setLoadingTables(false));
                } else if (activeTab === "variables") {
                    fetchVariables();
                } else if (activeTab === "status" || activeTab === "commands") {
                    fetchStatus();
                } else if (activeTab === "processes") {
                    fetchProcesses();
                }
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [profileId, database, activeTab]);

    const handleSelectDatabase = (dbName: string) => {
        updateTab(tabId, {
            title: `Database: ${dbName}`,
            meta: { profileId, profileName, database: dbName },
        });
    };

    const numCommands = useMemo(() => statusInfos.filter(s => s.name.startsWith("Com_")).length, [statusInfos]);

    const subTabs: { id: SubTab; label: string; icon?: React.ReactNode }[] = [];
    if (!database) {
        subTabs.push(
            { id: "databases", label: `Databases (${dbInfos.length || "…"})` },
            { id: "variables", label: `Variables (${variables.length || "…"})`, icon: <Settings2 className="w-3 h-3" /> },
            { id: "status", label: `Status (${statusInfos.length || "…"})`, icon: <Zap className="w-3 h-3 text-fuchsia-500" /> },
            { id: "processes", label: `Processes (${processInfos.length || "…"})`, icon: <Play className="w-3 h-3 text-blue-500 fill-blue-500" /> },
            { id: "commands", label: `Command-Statistics (${numCommands || "…"})`, icon: <BarChart2 className="w-3 h-3 text-cyan-500" /> }
        );
    }

    return (
        <div className="w-full h-full flex flex-col bg-background relative">
            {/* Header breadcrumb & Tabs */}
            <div className="h-9 border-b flex items-center shrink-0 bg-muted/20">
                {database && (
                    <div className="flex items-center px-4 h-full gap-2 shrink-0">
                        <Database className="w-3 h-3 text-yellow-500/80" />
                        <span className="text-xs font-medium">Database: {database}</span>
                        <span className="text-xs text-muted-foreground ml-1 px-1">›</span>
                        <Table2 className="w-3 h-3 text-blue-400" />
                        <span className="text-xs font-medium text-foreground">Tables ({tableInfos.length || "…"})</span>
                    </div>
                )}

                {/* Sub-tab bar integrated */}
                {subTabs.length > 0 && (
                    <div className="flex items-center h-full px-2 gap-1 overflow-x-auto">
                        {subTabs.map((tab) => (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id)}
                                className={cn(
                                    "px-3 h-full text-xs transition-colors flex items-center gap-1.5",
                                    activeTab === tab.id
                                        ? "font-semibold text-foreground border-b-2 border-primary"
                                        : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                                )}
                            >
                                {tab.icon}
                                {tab.label}
                            </button>
                        ))}
                    </div>
                )}
            </div>

            {/* Content */}
            <div className="flex-1 overflow-hidden flex flex-col">
                {activeTab === "databases" && !database && (
                    <DatabasesTable
                        dbInfos={dbInfos}
                        loading={loadingDbs}
                        error={errorDbs}
                        highlightDb={database}
                        onSelectDatabase={handleSelectDatabase}
                    />
                )}

                {activeTab === "tables" && database && (
                    <TablesTable
                        tableInfos={tableInfos}
                        loading={loadingTables}
                        error={errorTables}
                    />
                )}

                {activeTab === "variables" && (
                    <VariablesTable
                        profileId={profileId}
                        variables={variables}
                        loading={loadingVars}
                        error={errorVars}
                        onReload={fetchVariables}
                    />
                )}

                {activeTab === "status" && (
                    <StatusTable
                        statusInfos={statusInfos}
                        loading={loadingStatus}
                        error={errorStatus}
                    />
                )}

                {activeTab === "processes" && (
                    <ProcessesTable
                        profileId={profileId}
                        processes={processInfos}
                        loading={loadingProcesses}
                        error={errorProcesses}
                        onReload={fetchProcesses}
                    />
                )}

                {activeTab === "commands" && (
                    <CommandStatisticsTable
                        statusInfos={statusInfos}
                        loading={loadingStatus}
                        error={errorStatus}
                        onReload={fetchStatus}
                    />
                )}
            </div>
        </div>
    );
}

// ─── Databases Table ────────────────────────────────────────────────

function DatabasesTable({
    dbInfos,
    loading,
    error,
    highlightDb,
    onSelectDatabase,
}: {
    dbInfos: DatabaseInfo[];
    loading: boolean;
    error: string | null;
    highlightDb?: string;
    onSelectDatabase: (dbName: string) => void;
}) {
    if (loading) {
        return (
            <div className="p-8 flex items-center justify-center gap-2 text-muted-foreground text-xs">
                <Loader2 className="w-4 h-4 animate-spin" />
                Loading database information…
            </div>
        );
    }

    if (error) {
        return (
            <div className="p-8 flex items-center justify-center gap-2 text-red-400 text-xs">
                <AlertCircle className="w-4 h-4" />
                {error}
            </div>
        );
    }

    return (
        <div className="flex-1 overflow-auto">
            <table className="w-full text-xs">
                <thead>
                    <tr className="border-b bg-background text-muted-foreground sticky top-0 z-10">
                        <th className="text-left px-3 py-1.5 font-semibold whitespace-nowrap">Database</th>
                        <th className="text-right px-3 py-1.5 font-semibold whitespace-nowrap">Size</th>
                        <th className="text-right px-3 py-1.5 font-semibold whitespace-nowrap">Tables</th>
                        <th className="text-right px-3 py-1.5 font-semibold whitespace-nowrap">Views</th>
                        <th className="text-left px-3 py-1.5 font-semibold whitespace-nowrap">Last Modified</th>
                        <th className="text-left px-3 py-1.5 font-semibold whitespace-nowrap">Default Collation</th>
                    </tr>
                </thead>
                <tbody>
                    {dbInfos.map((db) => (
                        <tr
                            key={db.name}
                            className={cn(
                                "border-b border-border/30 hover:bg-accent/40 transition-colors cursor-pointer",
                                db.name === highlightDb && "bg-primary/10 font-medium"
                            )}
                            onDoubleClick={() => onSelectDatabase(db.name)}
                        >
                            <td className="px-3 py-1.5 flex items-center gap-1.5">
                                <Database
                                    className={cn(
                                        "w-3 h-3 shrink-0",
                                        db.name === highlightDb ? "text-yellow-400" : "text-yellow-500/60"
                                    )}
                                />
                                <span className={db.name === highlightDb ? "text-foreground" : ""}>
                                    {db.name}
                                </span>
                            </td>
                            <td className="text-right px-3 py-1.5 text-muted-foreground font-mono">
                                {formatBytes(db.size_bytes)}
                            </td>
                            <td className="text-right px-3 py-1.5 text-muted-foreground font-mono">
                                {db.tables}
                            </td>
                            <td className="text-right px-3 py-1.5 text-muted-foreground font-mono">
                                {db.views}
                            </td>
                            <td className="px-3 py-1.5 text-muted-foreground font-mono">
                                {db.last_modified ?? "—"}
                            </td>
                            <td className="px-3 py-1.5 text-muted-foreground">
                                {db.default_collation}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

// ─── Tables Table ───────────────────────────────────────────────────

function TablesTable({
    tableInfos,
    loading,
    error,
}: {
    tableInfos: TableInfo[];
    loading: boolean;
    error: string | null;
}) {
    if (loading) {
        return (
            <div className="flex-1 flex items-center justify-center">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
        );
    }
    if (error) {
        return (
            <div className="flex-1 flex items-center justify-center flex-col gap-2 text-red-500">
                <AlertCircle className="w-8 h-8" />
                <p className="text-sm font-medium">Failed to load tables</p>
                <p className="text-xs max-w-md text-center opacity-80">{error}</p>
            </div>
        );
    }

    // Default sorting
    const sorted = [...tableInfos].sort((a, b) => a.name.localeCompare(b.name));

    return (
        <div className="flex-1 overflow-auto">
            <table className="w-full text-left border-collapse text-xs select-none">
                <thead className="sticky top-0 bg-muted/80 backdrop-blur-sm z-10 shadow-sm">
                    <tr>
                        <th className="px-3 py-1.5 font-medium text-muted-foreground border-b first:border-l-0">Name</th>
                        <th className="px-3 py-1.5 font-medium text-muted-foreground border-b border-l min-w-[60px]">Rows</th>
                        <th className="px-3 py-1.5 font-medium text-muted-foreground border-b border-l min-w-[80px]">Size</th>
                        <th className="px-3 py-1.5 font-medium text-muted-foreground border-b border-l min-w-[140px]">Created</th>
                        <th className="px-3 py-1.5 font-medium text-muted-foreground border-b border-l min-w-[140px]">Updated</th>
                        <th className="px-3 py-1.5 font-medium text-muted-foreground border-b border-l">Engine</th>
                        <th className="px-3 py-1.5 font-medium text-muted-foreground border-b border-l">Comment</th>
                        <th className="px-3 py-1.5 font-medium text-muted-foreground border-b border-l">Type</th>
                    </tr>
                </thead>
                <tbody className="divide-y">
                    {sorted.map((t) => (
                        <tr
                            key={t.name}
                            className="hover:bg-accent/50 group whitespace-nowrap"
                        >
                            <td className="px-3 py-1.5 flex items-center gap-2">
                                <Table2 className="w-3.5 h-3.5 shrink-0 text-blue-400 group-hover:text-blue-500 transition-colors" />
                                {t.name}
                            </td>
                            <td className="px-3 py-1.5 border-l tabular-nums">
                                {t.rows != null ? t.rows.toLocaleString() : "—"}
                            </td>
                            <td className="px-3 py-1.5 border-l tabular-nums text-muted-foreground">
                                {t.size_bytes != null ? formatBytes(t.size_bytes) : "—"}
                            </td>
                            <td className="px-3 py-1.5 border-l text-muted-foreground tabular-nums">
                                {t.created || "—"}
                            </td>
                            <td className="px-3 py-1.5 border-l text-muted-foreground tabular-nums">
                                {t.updated || "—"}
                            </td>
                            <td className="px-3 py-1.5 border-l">
                                {t.engine || "—"}
                            </td>
                            <td className="px-3 py-1.5 border-l text-muted-foreground truncate max-w-[200px]" title={t.comment || ""}>
                                {t.comment || ""}
                            </td>
                            <td className="px-3 py-1.5 border-l text-muted-foreground">
                                {t.type_ || "Table"}
                            </td>
                        </tr>
                    ))}
                    {sorted.length === 0 && (
                        <tr>
                            <td colSpan={8} className="px-3 py-8 text-center text-muted-foreground bg-muted/5">
                                No tables found in this database.
                            </td>
                        </tr>
                    )}
                </tbody>
            </table>
        </div>
    );
}

// ─── Variables Table ────────────────────────────────────────────────

// Heuristics for common MySQL read-only variables
function isLikelyReadOnly(name: string): boolean {
    const known = new Set([
        "caching_sha2_password_digest_rounds",
        "caching_sha2_password_private_key_path",
        "caching_sha2_password_public_key_path",
        "character_sets_dir",
        "core_file",
        "datadir",
        "basedir",
        "innodb_version",
        "large_files_support",
        "large_pages",
        "license",
        "log_error",
        "lower_case_file_system",
        "port",
        "protocol_version",
        "relay_log_space_limit",
        "secure_file_priv",
        "server_uuid",
        "skip_networking",
        "skip_show_database",
        "socket",
        "system_time_zone",
        "tmpdir",
        "version",
        "version_comment",
        "version_compile_machine",
        "version_compile_os",
        "version_compile_zlib",
    ]);
    if (known.has(name)) return true;

    // Common read-only suffixes in MySQL
    if (
        name.endsWith("_dir") ||
        name.endsWith("_path") ||
        name.endsWith("_file") ||
        name.endsWith("_port") ||
        name.endsWith("_socket") ||
        name.endsWith("_version")
    ) {
        return true;
    }

    return false;
}

function VariablesTable({
    profileId,
    variables,
    loading,
    error,
    onReload,
}: {
    profileId: string;
    variables: VariableInfo[];
    loading: boolean;
    error: string | null;
    onReload: () => void;
}) {
    const [filter, setFilter] = useState("");
    const [editingVar, setEditingVar] = useState<VariableInfo | null>(null);
    const [editScope, setEditScope] = useState<"SESSION" | "GLOBAL">("SESSION");
    const [editValue, setEditValue] = useState("");
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);

    // Track read-only status dynamically. If an edit fails with 1238, it's read only.
    const [dynamicReadOnly, setDynamicReadOnly] = useState<Set<string>>(new Set());
    const [dynamicGlobalOnly, setDynamicGlobalOnly] = useState<Set<string>>(new Set());
    const [dynamicSessionOnly, setDynamicSessionOnly] = useState<Set<string>>(new Set());

    const isReadOnly = (name: string) => dynamicReadOnly.has(name) || isLikelyReadOnly(name);

    const isGlobalOnly = (v: VariableInfo) => {
        if (dynamicGlobalOnly.has(v.name)) return true;
        if (v.scope === "GLOBAL") return true;
        return false;
    };

    const isSessionOnly = (v: VariableInfo) => {
        if (dynamicSessionOnly.has(v.name)) return true;
        if (v.scope === "SESSION") return true;
        return false;
    };

    const handleSave = async () => {
        if (!editingVar) return;
        setSaving(true);
        setSaveError(null);
        try {
            await dbSetVariable(profileId, editScope, editingVar.name, editValue);
            setEditingVar(null);
            onReload();
        } catch (e) {
            const errStr = String(e);
            if (errStr.includes("read only variable") || errStr.includes("1238")) {
                setDynamicReadOnly((prev) => new Set(prev).add(editingVar.name));
                setSaveError("Variable is read-only. Switched to View mode.");
            } else if (errStr.includes("1229") || errStr.includes("GLOBAL variable")) {
                setDynamicGlobalOnly((prev) => new Set(prev).add(editingVar.name));
                setEditScope("GLOBAL");
                setEditValue(editingVar.global_value);
                setSaveError("Variable is GLOBAL only. Switched to Global scope.");
            } else if (errStr.includes("1228") || errStr.includes("SESSION variable")) {
                setDynamicSessionOnly((prev) => new Set(prev).add(editingVar.name));
                setEditScope("SESSION");
                setEditValue(editingVar.session_value);
                setSaveError("Variable is SESSION only. Switched to Session scope.");
            } else {
                setSaveError(errStr);
            }
        } finally {
            setSaving(false);
        }
    };

    const filtered = useMemo(() => {
        if (!filter.trim()) return variables;

        try {
            const re = new RegExp(filter, "i");
            return variables.filter(
                (v) => re.test(v.name) || re.test(v.session_value) || re.test(v.global_value)
            );
        } catch {
            return variables;
        }
    }, [variables, filter]);

    if (loading) {
        return (
            <div className="p-8 flex items-center justify-center gap-2 text-muted-foreground text-xs">
                <Loader2 className="w-4 h-4 animate-spin" />
                Loading variables…
            </div>
        );
    }

    if (error) {
        return (
            <div className="p-8 flex items-center justify-center gap-2 text-red-400 text-xs">
                <AlertCircle className="w-4 h-4" />
                {error}
            </div>
        );
    }

    return (
        <>
            {/* Table */}
            <div className="flex-1 overflow-auto">
                <table className="w-full text-xs">
                    <thead>
                        <tr className="border-b bg-background text-muted-foreground sticky top-0 z-10">
                            <th className="text-left px-3 py-1.5 font-semibold whitespace-nowrap w-[35%]">Variable</th>
                            <th className="text-left px-3 py-1.5 font-semibold whitespace-nowrap w-[32%]">Session</th>
                            <th className="text-left px-3 py-1.5 font-semibold whitespace-nowrap w-[33%]">Global</th>
                        </tr>
                    </thead>
                    <tbody>
                        {filtered.map((v) => {
                            const differs = v.session_value !== v.global_value &&
                                v.session_value !== "" && v.global_value !== "";
                            return (
                                <tr
                                    key={v.name}
                                    className="border-b border-border/20 hover:bg-accent/30 transition-colors cursor-pointer"
                                    onDoubleClick={() => {
                                        setEditingVar(v);
                                        if (isGlobalOnly(v)) {
                                            setEditScope("GLOBAL");
                                            setEditValue(v.global_value);
                                        } else {
                                            setEditScope("SESSION");
                                            setEditValue(v.session_value);
                                        }
                                        setSaveError(null);
                                    }}
                                >
                                    <td className="px-3 py-1.5 font-mono text-foreground/90 flex items-center gap-1.5 min-w-0">
                                        <Settings2 className="w-3 h-3 text-muted-foreground/30 shrink-0" />
                                        <span className="truncate">{v.name}</span>
                                        <div className="flex gap-1 shrink-0">
                                            {isReadOnly(v.name) && (
                                                <span className="px-1 py-0.5 rounded-[2px] bg-red-500/10 text-[9px] text-red-400 border border-red-500/20 font-sans tracking-tight">
                                                    READONLY
                                                </span>
                                            )}
                                            {isGlobalOnly(v) && (
                                                <span className="px-1 py-0.5 rounded-[2px] bg-blue-500/10 text-[9px] text-blue-400 border border-blue-500/20 font-sans tracking-tight">
                                                    GLOBAL
                                                </span>
                                            )}
                                            {isSessionOnly(v) && (
                                                <span className="px-1 py-0.5 rounded-[2px] bg-purple-500/10 text-[9px] text-purple-400 border border-purple-500/20 font-sans tracking-tight">
                                                    SESSION
                                                </span>
                                            )}
                                        </div>
                                    </td>
                                    <td className={cn(
                                        "px-3 py-1.5 font-mono break-all",
                                        differs ? "text-blue-400" : "text-muted-foreground"
                                    )}>
                                        {v.session_value || <span className="text-muted-foreground/30">—</span>}
                                    </td>
                                    <td className={cn(
                                        "px-3 py-1.5 font-mono break-all",
                                        differs ? "text-blue-400" : "text-muted-foreground"
                                    )}>
                                        {v.global_value || <span className="text-muted-foreground/30">—</span>}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            {/* Filter bar */}
            <div className="h-8 border-t flex items-center px-3 gap-2 shrink-0 bg-muted/10">
                <X
                    className={cn(
                        "w-3.5 h-3.5 cursor-pointer transition-colors",
                        filter ? "text-foreground hover:text-red-400" : "text-muted-foreground/30"
                    )}
                    onClick={() => setFilter("")}
                />
                <span className="text-[11px] text-muted-foreground whitespace-nowrap">Filter:</span>

                <div className="flex-1 flex items-center bg-background border border-border/50 max-w-sm rounded-[2px] focus-within:border-primary/50 transition-colors h-[22px] overflow-hidden">
                    <div className="flex items-center gap-1.5 px-2 py-1 bg-muted/30 border-r border-border/50 h-full shrink-0">
                        <Filter className="w-3 h-3 text-cyan-500/80" />
                        <span className="text-[10px] text-muted-foreground whitespace-nowrap">Regular expression</span>
                    </div>
                    <input
                        type="text"
                        value={filter}
                        onChange={(e) => setFilter(e.target.value)}
                        className="flex-1 h-full px-2 bg-transparent text-[11px] text-foreground outline-none font-mono"
                    />
                </div>

                <span className="ml-auto text-[10px] text-muted-foreground/50 font-mono">
                    {filtered.length}/{variables.length}
                </span>
            </div>

            {editingVar && (
                <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/50 backdrop-blur-[1px]">
                    <div className="bg-popover border shadow-2xl rounded-md w-[450px] flex flex-col overflow-hidden">
                        {/* Header */}
                        <div className="h-9 px-3 border-b flex items-center justify-between bg-muted/30">
                            <span className="text-xs font-semibold flex items-center gap-2">
                                <Settings2 className="w-3.5 h-3.5 text-primary" />
                                {isReadOnly(editingVar.name) ? "View server variable" : "Edit server variable"}
                            </span>
                            <X
                                className="w-4 h-4 cursor-pointer text-muted-foreground hover:text-foreground"
                                onClick={() => !saving && setEditingVar(null)}
                            />
                        </div>

                        {/* Body */}
                        <div className="p-4 flex flex-col gap-4 text-xs">
                            <div className="flex items-center gap-2">
                                <span className="font-mono text-foreground font-semibold">
                                    {editingVar.name}
                                </span>
                                <div className="flex gap-1 shrink-0">
                                    {isReadOnly(editingVar.name) && (
                                        <span className="px-1 py-0.5 rounded-[2px] bg-red-500/10 text-[9px] text-red-400 border border-red-500/20 font-sans tracking-tight">
                                            READONLY
                                        </span>
                                    )}
                                    {isGlobalOnly(editingVar) && (
                                        <span className="px-1 py-0.5 rounded-[2px] bg-blue-500/10 text-[9px] text-blue-400 border border-blue-500/20 font-sans tracking-tight">
                                            GLOBAL
                                        </span>
                                    )}
                                    {isSessionOnly(editingVar) && (
                                        <span className="px-1 py-0.5 rounded-[2px] bg-purple-500/10 text-[9px] text-purple-400 border border-purple-500/20 font-sans tracking-tight">
                                            SESSION
                                        </span>
                                    )}
                                </div>
                            </div>

                            <div className="flex flex-col gap-1.5">
                                <span className="text-muted-foreground">Value:</span>
                                {isReadOnly(editingVar.name) ? (
                                    <div className="w-full border border-border/50 bg-muted/10 p-2 font-mono rounded-[2px] text-foreground/80 break-all select-text max-h-[150px] overflow-auto">
                                        {editValue || <span className="text-muted-foreground/30">—</span>}
                                    </div>
                                ) : (
                                    <input
                                        type="text"
                                        value={editValue}
                                        onChange={(e) => setEditValue(e.target.value)}
                                        className="h-8 w-full border bg-background px-2 font-mono outline-none focus:border-primary/50 transition-colors rounded-[2px]"
                                        disabled={saving}
                                        autoFocus
                                    />
                                )}
                            </div>

                            <div className="flex flex-col gap-1.5">
                                <span className="text-muted-foreground">Scope:</span>
                                <div className="flex bg-muted/30 py-1.5 px-1.5 rounded border gap-1">
                                    {!isGlobalOnly(editingVar) && (
                                        <button
                                            className={cn(
                                                "flex-1 py-1 rounded-[2px] transition-colors text-xs font-medium",
                                                editScope === "SESSION" ? "bg-background border shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground border border-transparent"
                                            )}
                                            onClick={() => {
                                                setEditScope("SESSION");
                                                setEditValue(editingVar.session_value);
                                                setSaveError(null);
                                            }}
                                            disabled={saving}
                                        >
                                            This session
                                        </button>
                                    )}
                                    {!isSessionOnly(editingVar) && (
                                        <button
                                            className={cn(
                                                "flex-1 py-1 rounded-[2px] transition-colors text-xs font-medium",
                                                editScope === "GLOBAL" ? "bg-background border shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground border border-transparent"
                                            )}
                                            onClick={() => {
                                                setEditScope("GLOBAL");
                                                setEditValue(editingVar.global_value);
                                                setSaveError(null);
                                            }}
                                            disabled={saving}
                                        >
                                            Global
                                        </button>
                                    )}
                                </div>
                            </div>


                            {saveError && (
                                <div className={cn(
                                    "p-2 border rounded text-[11px] font-mono break-all",
                                    saveError.includes("read-only") || saveError.includes("read only")
                                        ? "bg-yellow-500/10 border-yellow-500/20 text-yellow-600 dark:text-yellow-400"
                                        : "bg-red-500/10 border-red-500/20 text-red-500"
                                )}>
                                    {saveError}
                                </div>
                            )}
                        </div>

                        {/* Footer */}
                        <div className="p-3 border-t bg-muted/10 flex justify-end gap-2">
                            {isReadOnly(editingVar.name) ? (
                                <button
                                    onClick={() => setEditingVar(null)}
                                    className="px-4 py-1.5 bg-primary text-primary-foreground rounded-[2px] text-xs font-medium hover:bg-primary/90 transition-colors"
                                >
                                    Close
                                </button>
                            ) : (
                                <>
                                    <button
                                        onClick={() => setEditingVar(null)}
                                        className="px-4 py-1.5 border bg-background rounded-[2px] text-xs text-foreground hover:bg-muted/50 transition-colors"
                                        disabled={saving}
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        onClick={handleSave}
                                        disabled={saving}
                                        className="px-4 py-1.5 bg-primary text-primary-foreground rounded-[2px] text-xs font-medium hover:bg-primary/90 transition-colors flex items-center gap-2"
                                    >
                                        {saving && <Loader2 className="w-3 h-3 animate-spin" />}
                                        OK
                                    </button>
                                </>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}

// ─── Status Table ────────────────────────────────────────────────

function StatusTable({
    statusInfos,
    loading,
    error,
}: {
    statusInfos: StatusInfo[];
    loading: boolean;
    error: string | null;
}) {
    if (loading) {
        return (
            <div className="p-8 flex items-center justify-center gap-2 text-muted-foreground text-xs">
                <Loader2 className="w-4 h-4 animate-spin" />
                Loading status…
            </div>
        );
    }

    if (error) {
        return (
            <div className="p-8 flex items-center justify-center gap-2 text-red-400 text-xs">
                <AlertCircle className="w-4 h-4" />
                {error}
            </div>
        );
    }

    const uptimeStr = statusInfos.find((s) => s.name === "Uptime")?.value;
    const uptimeSecs = uptimeStr ? parseInt(uptimeStr, 10) : 0;
    const uptimeHours = uptimeSecs / 3600;

    return (
        <div className="flex-1 overflow-auto">
            <table className="w-full text-xs">
                <thead>
                    <tr className="border-b bg-background text-muted-foreground sticky top-0 z-10 shadow-sm">
                        <th className="text-left px-3 py-1.5 font-semibold whitespace-nowrap">Variable</th>
                        <th className="text-right px-3 py-1.5 font-semibold whitespace-nowrap">Value</th>
                        <th className="text-right px-3 py-1.5 font-semibold whitespace-nowrap">Avg per hour</th>
                        <th className="text-right px-3 py-1.5 font-semibold whitespace-nowrap">Avg per second</th>
                    </tr>
                </thead>
                <tbody>
                    {statusInfos.map((s) => {
                        const numVal = parseFloat(s.value);
                        const isNumeric = !isNaN(numVal) && String(numVal) === s.value;

                        let perHour = "0.0";
                        let perSec = "0.0";

                        if (isNumeric && uptimeSecs > 0) {
                            perHour = uptimeHours > 0 ? (numVal / uptimeHours).toFixed(1) : "0.0";
                            perSec = (numVal / uptimeSecs).toFixed(1);
                        }

                        // Bytes formatting for UI (simulating the HeidiSQL shot approx)
                        const bytesKeys = ["Bytes_received", "Bytes_sent"];
                        let displayVal = s.value;
                        if (bytesKeys.includes(s.name) && isNumeric) {
                            displayVal = formatBytes(numVal);
                            if (uptimeSecs > 0) {
                                perHour = formatBytes(numVal / uptimeHours);
                                perSec = formatBytes(numVal / uptimeSecs);
                            }
                        }

                        return (
                            <tr
                                key={s.name}
                                className="border-b border-border/20 hover:bg-accent/30 transition-colors"
                            >
                                <td className="px-3 py-1.5 font-mono text-foreground/90 flex items-center gap-1.5">
                                    <Zap className="w-3 h-3 text-yellow-500 shrink-0" />
                                    <span className="truncate">{s.name}</span>
                                </td>
                                <td className="px-3 py-1.5 font-mono text-foreground/80 break-all text-right">
                                    {displayVal}
                                </td>
                                <td className="px-3 py-1.5 font-mono text-muted-foreground text-right w-[120px]">
                                    {isNumeric || bytesKeys.includes(s.name) ? perHour : "—"}
                                </td>
                                <td className="px-3 py-1.5 font-mono text-muted-foreground text-right w-[120px]">
                                    {isNumeric || bytesKeys.includes(s.name) ? perSec : "—"}
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}

// ─── Processes Table ─────────────────────────────────────────────

function ProcessesTable({
    profileId,
    processes,
    loading,
    error,
    onReload,
}: {
    profileId: string;
    processes: ProcessInfo[];
    loading: boolean;
    error: string | null;
    onReload: () => void;
}) {
    const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
    const [contextMenu, setContextMenu] = useState<{ x: number; y: number; processId: number; cell?: { name: string; value: string } } | null>(null);
    const [hoveredProcess, setHoveredProcess] = useState<{ p: ProcessInfo; x: number; y: number } | null>(null);

    // Hide context menu on click anywhere
    useEffect(() => {
        const handleClick = () => setContextMenu(null);
        window.addEventListener("click", handleClick);
        return () => window.removeEventListener("click", handleClick);
    }, []);

    const handleKill = async (processId: number) => {
        if (confirm(`Are you sure you want to kill process ID ${processId}?`)) {
            try {
                await dbKillProcess(profileId, processId);
                onReload();
            } catch (e) {
                alert(`Failed to kill process: ${e}`);
            }
        }
    };

    if (loading) {
        return (
            <div className="p-8 flex items-center justify-center gap-2 text-muted-foreground text-xs">
                <Loader2 className="w-4 h-4 animate-spin" />
                Loading processes…
            </div>
        );
    }

    if (error) {
        return (
            <div className="p-8 flex items-center justify-center gap-2 text-red-400 text-xs">
                <AlertCircle className="w-4 h-4" />
                {error}
            </div>
        );
    }

    return (
        <div className="flex-1 flex flex-col overflow-hidden relative">
            <div className="flex-1 overflow-auto">
                <table className="w-full text-xs">
                    <thead>
                        <tr className="border-b bg-background text-muted-foreground sticky top-0 z-10 shadow-sm text-left">
                            <th className="px-3 py-1.5 font-semibold whitespace-nowrap w-[60px]">id</th>
                            <th className="px-3 py-1.5 font-semibold whitespace-nowrap w-[150px]">User</th>
                            <th className="px-3 py-1.5 font-semibold whitespace-nowrap w-[150px]">Host</th>
                            <th className="px-3 py-1.5 font-semibold whitespace-nowrap w-[120px]">DB</th>
                            <th className="px-3 py-1.5 font-semibold whitespace-nowrap w-[100px]">Command</th>
                            <th className="px-3 py-1.5 font-semibold whitespace-nowrap w-[80px]">Time</th>
                            <th className="px-3 py-1.5 font-semibold whitespace-nowrap w-[120px]">State</th>
                            <th className="px-3 py-1.5 font-semibold whitespace-nowrap">Info</th>
                        </tr>
                    </thead>
                    <tbody>
                        {processes.map((p) => {
                            const isSelected = selectedRows.has(p.id);
                            return (
                                <tr
                                    key={p.id}
                                    className={cn(
                                        "border-b border-border/20 transition-colors cursor-pointer select-none group",
                                        isSelected ? "bg-accent/50" : "hover:bg-accent/30"
                                    )}
                                    onClick={(e) => {
                                        if (e.ctrlKey || e.metaKey) {
                                            const newSet = new Set(selectedRows);
                                            if (newSet.has(p.id)) newSet.delete(p.id);
                                            else newSet.add(p.id);
                                            setSelectedRows(newSet);
                                        } else {
                                            setSelectedRows(new Set([p.id]));
                                        }
                                    }}
                                    onContextMenu={(e) => {
                                        e.preventDefault();
                                        if (!selectedRows.has(p.id)) {
                                            setSelectedRows(new Set([p.id]));
                                        }

                                        let cellName = "";
                                        let cellValue = "";
                                        const td = (e.target as HTMLElement).closest('td');
                                        if (td && td.parentElement) {
                                            const index = Array.from(td.parentElement.children).indexOf(td);
                                            const cols = ["id", "User", "Host", "DB", "Command", "Time", "State", "Info"];
                                            cellName = cols[index] || "";
                                            cellValue = td.textContent || "";
                                        }

                                        setContextMenu({
                                            x: e.clientX,
                                            y: e.clientY,
                                            processId: p.id,
                                            cell: cellName ? { name: cellName, value: cellValue } : undefined
                                        });
                                    }}
                                    onMouseEnter={(e) => setHoveredProcess({ p, x: e.clientX, y: e.clientY })}
                                    onMouseMove={(e) => setHoveredProcess({ p, x: e.clientX, y: e.clientY })}
                                    onMouseLeave={() => setHoveredProcess(null)}
                                >
                                    <td className="px-3 py-1.5 font-mono text-muted-foreground/80 flex items-center gap-1.5">
                                        <div className="w-2.5 h-2.5 rounded-full border-2 border-primary/50 shrink-0"></div>
                                        {p.id}
                                    </td>
                                    <td className="px-3 py-1.5 font-mono text-foreground/90 truncate max-w-[150px]">{p.user}</td>
                                    <td className="px-3 py-1.5 font-mono text-foreground/90 truncate max-w-[150px]">{p.host}</td>
                                    <td className="px-3 py-1.5 font-mono text-foreground/90 truncate max-w-[120px]">{p.db}</td>
                                    <td className="px-3 py-1.5 font-mono text-foreground/90 truncate max-w-[100px]">{p.command}</td>
                                    <td className="px-3 py-1.5 font-mono text-foreground/90 truncate max-w-[80px]">{p.time}</td>
                                    <td className="px-3 py-1.5 font-mono text-foreground/90 truncate max-w-[120px]">{p.state}</td>
                                    <td className="px-3 py-1.5 font-mono text-foreground/90 truncate max-w-[dyn] break-all">
                                        {p.info}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            {/* Context Menu */}
            {contextMenu && (
                <div
                    className="fixed z-50 bg-background border shadow-md rounded-[2px] py-1 text-xs min-w-[200px] w-max"
                    style={{ top: contextMenu.y, left: contextMenu.x }}
                >
                    {contextMenu.cell && (
                        <>
                            <button
                                className="w-full text-left px-4 py-1.5 hover:bg-accent/50 text-foreground flex items-center gap-2"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    navigator.clipboard.writeText(contextMenu.cell!.value);
                                    setContextMenu(null);
                                }}
                            >
                                <Copy className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                                <span>Copy cell value: <span className="font-semibold text-primary">{contextMenu.cell.name}</span></span>
                                <span className="ml-auto text-muted-foreground text-[10px] font-mono pl-4">Ctrl+C</span>
                            </button>
                            <div className="h-px bg-border/50 my-1 mx-2"></div>
                        </>
                    )}
                    <button
                        className="w-full text-left px-4 py-1.5 hover:bg-accent/50 text-red-500 font-medium flex items-center gap-2"
                        onClick={(e) => {
                            e.stopPropagation();
                            setContextMenu(null);
                            handleKill(contextMenu.processId);
                        }}
                    >
                        Kill Process(es)...
                        <span className="ml-auto text-muted-foreground text-[10px] font-mono">Del</span>
                    </button>
                    <div className="h-px bg-border/50 my-1 mx-2"></div>
                    <button
                        className="w-full text-left px-4 py-1.5 hover:bg-accent/50 text-foreground flex items-center gap-2"
                        onClick={(e) => {
                            e.stopPropagation();
                            setContextMenu(null);
                            onReload();
                        }}
                    >
                        Refresh
                        <span className="ml-auto text-muted-foreground text-[10px] font-mono">F5</span>
                    </button>
                </div>
            )}

            {/* Hover Popover */}
            {hoveredProcess && !contextMenu && (
                <div
                    className="fixed z-40 bg-background/95 backdrop-blur-sm border shadow-lg rounded-md p-3 text-xs w-[400px] pointer-events-none"
                    style={{
                        top: Math.min(hoveredProcess.y + 15, window.innerHeight - 250),
                        left: Math.min(hoveredProcess.x + 15, window.innerWidth - 420),
                    }}
                >
                    <div className="font-semibold text-foreground border-b pb-2 mb-2 flex items-center justify-between">
                        <span>Process ID: {hoveredProcess.p.id}</span>
                        <span className="text-muted-foreground bg-muted/50 px-1.5 py-0.5 rounded text-[10px]">
                            {hoveredProcess.p.state || "Unknown State"}
                        </span>
                    </div>
                    <div className="grid grid-cols-[80px_1fr] gap-x-2 gap-y-1.5 font-mono">
                        <span className="text-muted-foreground">User:</span>
                        <span className="text-foreground/90 break-all">{hoveredProcess.p.user || "—"}</span>

                        <span className="text-muted-foreground">Host:</span>
                        <span className="text-foreground/90 break-all">{hoveredProcess.p.host || "—"}</span>

                        <span className="text-muted-foreground">DB:</span>
                        <span className="text-foreground/90 break-all">{hoveredProcess.p.db || "—"}</span>

                        <span className="text-muted-foreground">Command:</span>
                        <span className="text-foreground/90 break-all">{hoveredProcess.p.command || "—"}</span>

                        <span className="text-muted-foreground">Time:</span>
                        <span className="text-foreground/90 break-all">
                            {hoveredProcess.p.time !== null ? `${hoveredProcess.p.time}s` : "—"}
                        </span>

                        <span className="text-muted-foreground">Info:</span>
                        <span className="text-foreground/90 break-all whitespace-pre-wrap">
                            {hoveredProcess.p.info || "—"}
                        </span>
                    </div>
                </div>
            )}
        </div>
    );
}

// ─── Command Statistics Table ──────────────────────────────────────

function CommandStatisticsTable({
    statusInfos,
    loading,
    error,
    onReload,
}: {
    statusInfos: StatusInfo[];
    loading: boolean;
    error: string | null;
    onReload: () => void;
}) {
    const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
    const [contextMenu, setContextMenu] = useState<{ x: number; y: number; cell?: { name: string; value: string } } | null>(null);

    // Hide context menu on click anywhere
    useEffect(() => {
        const handleClick = () => setContextMenu(null);
        window.addEventListener("click", handleClick);
        return () => window.removeEventListener("click", handleClick);
    }, []);

    if (loading) {
        return (
            <div className="p-8 flex items-center justify-center gap-2 text-muted-foreground text-xs">
                <Loader2 className="w-4 h-4 animate-spin" />
                Loading command statistics…
            </div>
        );
    }

    if (error) {
        return (
            <div className="p-8 flex items-center justify-center gap-2 text-red-400 text-xs">
                <AlertCircle className="w-4 h-4" />
                {error}
            </div>
        );
    }

    const uptimeVar = statusInfos.find((s) => s.name === "Uptime");
    const uptimeSecs = uptimeVar ? parseFloat(uptimeVar.value) : 0;
    const uptimeHours = uptimeSecs / 3600;

    const commands = statusInfos
        .filter((s) => s.name.startsWith("Com_"))
        .map((s) => {
            const count = parseFloat(s.value) || 0;
            return {
                name: s.name.substring(4).replace(/_/g, " ").toLowerCase(),
                count,
            };
        })
        .sort((a, b) => b.count - a.count);

    const totalCount = commands.reduce((sum, c) => sum + c.count, 0);

    return (
        <div className="flex-1 overflow-auto relative bg-background">
            <table className="w-full text-xs box-border">
                <thead>
                    <tr className="border-b bg-background text-muted-foreground sticky top-0 z-10 shadow-sm">
                        <th className="text-left px-3 py-1.5 font-semibold whitespace-nowrap">Command-type</th>
                        <th className="text-right px-3 py-1.5 font-semibold whitespace-nowrap">Total count</th>
                        <th className="text-right px-3 py-1.5 font-semibold whitespace-nowrap">Average per hour</th>
                        <th className="text-right px-3 py-1.5 font-semibold whitespace-nowrap">Average per second</th>
                        <th className="text-left px-3 py-1.5 font-semibold whitespace-nowrap">Percentage</th>
                    </tr>
                </thead>
                <tbody>
                    {commands.map((c) => {
                        let perHour = "0.0";
                        let perSec = "0.0";
                        if (uptimeSecs > 0) {
                            perHour = uptimeHours > 0 ? (c.count / uptimeHours).toFixed(1) : "0.0";
                            perSec = (c.count / uptimeSecs).toFixed(1);
                        }

                        const percentage = totalCount > 0 ? (c.count / totalCount) * 100 : 0;
                        const pctFormatted = percentage > 0.05 ? percentage.toFixed(1) + " %" : "0.0 %";

                        const isSelected = selectedRows.has(c.name);

                        return (
                            <tr
                                key={c.name}
                                className={cn(
                                    "border-b border-border/20 transition-colors cursor-pointer select-none group",
                                    isSelected ? "bg-accent/50" : "hover:bg-accent/30"
                                )}
                                onClick={(e) => {
                                    if (e.ctrlKey || e.metaKey) {
                                        const newSet = new Set(selectedRows);
                                        if (newSet.has(c.name)) newSet.delete(c.name);
                                        else newSet.add(c.name);
                                        setSelectedRows(newSet);
                                    } else {
                                        setSelectedRows(new Set([c.name]));
                                    }
                                }}
                                onContextMenu={(e) => {
                                    e.preventDefault();
                                    if (!selectedRows.has(c.name)) {
                                        setSelectedRows(new Set([c.name]));
                                    }

                                    let cellName = "";
                                    let cellValue = "";
                                    const td = (e.target as HTMLElement).closest('td');
                                    if (td && td.parentElement) {
                                        const index = Array.from(td.parentElement.children).indexOf(td);
                                        const cols = ["Command-type", "Total count", "Average per hour", "Average per second", "Percentage"];
                                        cellName = cols[index] || "";
                                        cellValue = td.textContent || "";
                                    }

                                    setContextMenu({
                                        x: e.clientX,
                                        y: e.clientY,
                                        cell: cellName ? { name: cellName, value: cellValue } : undefined
                                    });
                                }}
                            >
                                <td className="px-3 py-1.5 font-mono text-foreground/90 flex items-center gap-1.5 min-w-[200px]">
                                    <Key className="w-3 h-3 text-yellow-500 shrink-0" />
                                    <span className="truncate">{c.name}</span>
                                </td>
                                <td className="px-3 py-1.5 font-mono text-foreground/80 text-right w-[120px]">
                                    {c.count.toLocaleString()}
                                </td>
                                <td className="px-3 py-1.5 font-mono text-muted-foreground text-right w-[120px]">
                                    {perHour}
                                </td>
                                <td className="px-3 py-1.5 font-mono text-muted-foreground text-right w-[120px]">
                                    {perSec}
                                </td>
                                <td className="px-3 py-1.5 font-mono text-foreground/80 w-[250px]">
                                    <div className="flex items-center gap-2 h-full">
                                        <div className="w-[45px] text-right shrink-0">{pctFormatted}</div>
                                        {percentage > 0 && (
                                            <div className="flex-1 h-3.5 bg-accent/20 border border-border/50 relative overflow-hidden rounded-[1px]">
                                                <div
                                                    className="absolute top-0 left-0 bottom-0 bg-muted-foreground/30"
                                                    style={{ width: `${Math.min(100, percentage)}%` }}
                                                />
                                            </div>
                                        )}
                                    </div>
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>

            {/* Context Menu */}
            {contextMenu && (
                <div
                    className="fixed z-50 bg-background border shadow-md rounded-[2px] py-1 text-xs min-w-[200px] w-max"
                    style={{ top: contextMenu.y, left: contextMenu.x }}
                >
                    {contextMenu.cell && (
                        <>
                            <button
                                className="w-full text-left px-4 py-1.5 hover:bg-accent/50 text-foreground flex items-center gap-2"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    navigator.clipboard.writeText(contextMenu.cell!.value);
                                    setContextMenu(null);
                                }}
                            >
                                <Copy className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                                <span>Copy cell value: <span className="font-semibold text-primary">{contextMenu.cell.name}</span></span>
                                <span className="ml-auto text-muted-foreground text-[10px] font-mono pl-4">Ctrl+C</span>
                            </button>
                            <div className="h-px bg-border/50 my-1 mx-2"></div>
                        </>
                    )}
                    <button
                        className="w-full text-left px-4 py-1.5 hover:bg-accent/50 text-foreground flex items-center gap-2"
                        onClick={(e) => {
                            e.stopPropagation();
                            setContextMenu(null);
                            onReload();
                        }}
                    >
                        Refresh
                        <span className="ml-auto text-muted-foreground text-[10px] font-mono pl-4">F5 or Ctrl + R</span>
                    </button>
                </div>
            )}
        </div>
    );
}

