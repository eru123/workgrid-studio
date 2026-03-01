import { useState, useCallback } from "react";
import { useSchemaStore } from "@/state/schemaStore";
import { useProfilesStore } from "@/state/profilesStore";
import { useLayoutStore } from "@/state/layoutStore";
import { dbListDatabases, dbListTables, dbListColumns } from "@/lib/db";
import { cn } from "@/lib/utils/cn";
import {
    Database,
    Table2,
    Key,
    Link2,
    Hash,
    ChevronRight,
    ChevronDown,
    PlugZap,
    Loader2,
    AlertCircle,
    HardDrive,
} from "lucide-react";

type ExpandedSet = Record<string, boolean>;

export function ExplorerTree() {
    const connectedProfiles = useSchemaStore((s) => s.connectedProfiles);
    const profiles = useProfilesStore((s) => s.profiles);
    const [expanded, setExpanded] = useState<ExpandedSet>({});

    const connectedList = profiles.filter((p) => p.connectionStatus === "connected");

    const toggle = useCallback((key: string) => {
        setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));
    }, []);

    if (connectedList.length === 0) {
        return (
            <div className="p-3 text-center">
                <PlugZap className="w-8 h-8 text-muted-foreground/20 mx-auto mb-2" />
                <p className="text-xs text-muted-foreground mb-1">No connections</p>
                <p className="text-[10px] text-muted-foreground/60">
                    Connect to a database to browse its schema.
                </p>
            </div>
        );
    }

    return (
        <div className="select-none text-[12px]">
            {connectedList.map((profile) => {
                const meta = connectedProfiles[profile.id];
                return (
                    <ProfileNode
                        key={profile.id}
                        profileId={profile.id}
                        name={meta?.name ?? profile.name}
                        color={meta?.color ?? profile.color}
                        expanded={expanded}
                        toggle={toggle}
                    />
                );
            })}
        </div>
    );
}

// ─── Profile Node (root) → lazy loads databases ─────────────────────

function ProfileNode({
    profileId,
    name,
    color,
    expanded,
    toggle,
}: {
    profileId: string;
    name: string;
    color: string;
    expanded: ExpandedSet;
    toggle: (key: string) => void;
}) {
    const databases = useSchemaStore((s) => s.databases[profileId]);
    const loading = useSchemaStore((s) => s.loadingDatabases[profileId]);
    const error = useSchemaStore((s) => s.errors[`dbs-${profileId}`]);
    const { setDatabases, setLoading, setError, clearError } = useSchemaStore();
    const openTab = useLayoutStore((s) => s.openTab);

    const nodeKey = `profile-${profileId}`;
    const isOpen = expanded[nodeKey] ?? true;

    const handleExpand = async () => {
        const wasOpen = isOpen;
        toggle(nodeKey);

        // Lazy load: fetch databases on first expand
        if (!wasOpen || (!databases && !loading)) {
            if (!databases) {
                setLoading(profileId, "databases", true);
                clearError(`dbs-${profileId}`);
                try {
                    const dbs = await dbListDatabases(profileId);
                    setDatabases(profileId, dbs);
                } catch (e) {
                    setError(`dbs-${profileId}`, String(e));
                } finally {
                    setLoading(profileId, "databases", false);
                }
            }
        }
    };

    const handleLabelClick = () => {
        openTab({
            title: name,
            type: "database-view",
            meta: {
                profileId,
                profileName: name,
            },
        });
    };

    const handleDoubleClick = () => {
        handleExpand();
    };

    return (
        <>
            <TreeRow
                depth={0}
                isOpen={isOpen}
                onChevronClick={handleExpand}
                onLabelClick={handleLabelClick}
                onDoubleClick={handleDoubleClick}
                icon={<Database className="w-3.5 h-3.5" style={{ color }} />}
                label={name}
                badge={databases ? String(databases.length) : undefined}
                bold
            />

            {isOpen && (
                <>
                    {loading && (
                        <TreeRow depth={1} icon={<Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />} label="Loading databases..." muted />
                    )}
                    {error && (
                        <TreeRow depth={1} icon={<AlertCircle className="w-3 h-3 text-red-400" />} label={error} muted />
                    )}
                    {databases?.map((db) => (
                        <DatabaseNode
                            key={db}
                            profileId={profileId}
                            profileName={name}
                            database={db}
                            expanded={expanded}
                            toggle={toggle}
                        />
                    ))}
                </>
            )}
        </>
    );
}

// ─── Database Node → single-click opens tab, expand loads tables ────

function DatabaseNode({
    profileId,
    profileName,
    database,
    expanded,
    toggle,
}: {
    profileId: string;
    profileName: string;
    database: string;
    expanded: ExpandedSet;
    toggle: (key: string) => void;
}) {
    const cacheKey = `${profileId}::${database}`;
    const tables = useSchemaStore((s) => s.tables[cacheKey]);
    const loading = useSchemaStore((s) => s.loadingTables[cacheKey]);
    const error = useSchemaStore((s) => s.errors[`tbl-${cacheKey}`]);
    const { setTables, setLoading, setError, clearError } = useSchemaStore();
    const openTab = useLayoutStore((s) => s.openTab);

    const nodeKey = `db-${cacheKey}`;
    const isOpen = expanded[nodeKey] ?? false;

    // Expand/collapse + lazy load tables
    const handleExpand = async () => {
        const wasOpen = isOpen;
        toggle(nodeKey);

        if (!wasOpen && !tables && !loading) {
            setLoading(cacheKey, "tables", true);
            clearError(`tbl-${cacheKey}`);
            try {
                const tbls = await dbListTables(profileId, database);
                setTables(profileId, database, tbls);
            } catch (e) {
                setError(`tbl-${cacheKey}`, String(e));
            } finally {
                setLoading(cacheKey, "tables", false);
            }
        }
    };

    // Single click on label → open database tab
    const handleLabelClick = () => {
        openTab({
            title: `Database: ${database}`,
            type: "database-view",
            meta: {
                profileId,
                profileName,
                database,
            },
        });
    };

    // Double click on label → expand
    const handleDoubleClick = () => {
        handleExpand();
    };

    return (
        <>
            <TreeRow
                depth={1}
                isOpen={isOpen}
                onChevronClick={handleExpand}
                onLabelClick={handleLabelClick}
                onDoubleClick={handleDoubleClick}
                icon={<HardDrive className="w-3.5 h-3.5 text-yellow-500/80" />}
                label={database}
                badge={tables ? String(tables.length) : undefined}
            />

            {isOpen && (
                <>
                    {loading && (
                        <TreeRow depth={2} icon={<Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />} label="Loading tables..." muted />
                    )}
                    {error && (
                        <TreeRow depth={2} icon={<AlertCircle className="w-3 h-3 text-red-400" />} label={error} muted />
                    )}
                    {tables?.map((table) => (
                        <TableNode
                            key={table}
                            profileId={profileId}
                            database={database}
                            table={table}
                            expanded={expanded}
                            toggle={toggle}
                        />
                    ))}
                </>
            )}
        </>
    );
}

// ─── Table Node → lazy loads columns ────────────────────────────────

function TableNode({
    profileId,
    database,
    table,
    expanded,
    toggle,
}: {
    profileId: string;
    database: string;
    table: string;
    expanded: ExpandedSet;
    toggle: (key: string) => void;
}) {
    const cacheKey = `${profileId}::${database}::${table}`;
    const columns = useSchemaStore((s) => s.columns[cacheKey]);
    const loading = useSchemaStore((s) => s.loadingColumns[cacheKey]);
    const error = useSchemaStore((s) => s.errors[`col-${cacheKey}`]);
    const { setColumns, setLoading, setError, clearError } = useSchemaStore();

    const nodeKey = `tbl-${cacheKey}`;
    const isOpen = expanded[nodeKey] ?? false;

    const handleToggle = async () => {
        const wasOpen = isOpen;
        toggle(nodeKey);

        if (!wasOpen && !columns && !loading) {
            setLoading(cacheKey, "columns", true);
            clearError(`col-${cacheKey}`);
            try {
                const cols = await dbListColumns(profileId, database, table);
                setColumns(profileId, database, table, cols);
            } catch (e) {
                setError(`col-${cacheKey}`, String(e));
            } finally {
                setLoading(cacheKey, "columns", false);
            }
        }
    };

    return (
        <>
            <TreeRow
                depth={2}
                isOpen={isOpen}
                onChevronClick={handleToggle}
                onLabelClick={handleToggle}
                icon={<Table2 className="w-3.5 h-3.5 text-blue-400/80" />}
                label={table}
                badge={columns ? String(columns.length) : undefined}
            />

            {isOpen && (
                <>
                    {loading && (
                        <TreeRow depth={3} icon={<Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />} label="Loading columns..." muted />
                    )}
                    {error && (
                        <TreeRow depth={3} icon={<AlertCircle className="w-3 h-3 text-red-400" />} label={error} muted />
                    )}
                    {columns?.map((col) => (
                        <TreeRow
                            key={col.name}
                            depth={3}
                            icon={
                                col.key === "PRI" ? (
                                    <Key className="w-3 h-3 text-yellow-400" />
                                ) : col.key === "MUL" ? (
                                    <Link2 className="w-3 h-3 text-cyan-400" />
                                ) : col.key === "UNI" ? (
                                    <Key className="w-3 h-3 text-orange-400" />
                                ) : (
                                    <Hash className="w-3 h-3 text-muted-foreground/40" />
                                )
                            }
                            label={col.name}
                            suffix={
                                <span className="text-[10px] text-muted-foreground/50 ml-1 font-mono truncate">
                                    {col.col_type}
                                    {col.nullable ? "" : " NOT NULL"}
                                    {col.extra ? ` ${col.extra}` : ""}
                                </span>
                            }
                        />
                    ))}
                </>
            )}
        </>
    );
}

// ─── Generic tree row ───────────────────────────────────────────────

function TreeRow({
    depth,
    isOpen,
    onChevronClick,
    onLabelClick,
    onDoubleClick,
    icon,
    label,
    badge,
    suffix,
    bold,
    muted,
}: {
    depth: number;
    isOpen?: boolean;
    onChevronClick?: () => void;
    onLabelClick?: () => void;
    onDoubleClick?: () => void;
    icon: React.ReactNode;
    label: string;
    badge?: string;
    suffix?: React.ReactNode;
    bold?: boolean;
    muted?: boolean;
}) {
    const isFolder = isOpen !== undefined;

    return (
        <div
            className={cn(
                "flex items-center h-[22px] cursor-pointer hover:bg-accent/50 transition-colors",
                bold && "font-medium",
                muted && "opacity-60"
            )}
            style={{ paddingLeft: `${depth * 14 + 6}px` }}
            onDoubleClick={onDoubleClick}
        >
            {/* Chevron — has its own click handler */}
            {isFolder ? (
                <span
                    className="w-4 h-4 flex items-center justify-center shrink-0 text-muted-foreground/60 hover:text-foreground"
                    onClick={(e) => {
                        e.stopPropagation();
                        onChevronClick?.();
                    }}
                >
                    {isOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                </span>
            ) : (
                <span className="w-4 h-4 shrink-0" />
            )}

            {/* Icon + label — has its own click handler */}
            <span
                className="flex items-center flex-1 min-w-0"
                onClick={(e) => {
                    e.stopPropagation();
                    onLabelClick?.();
                }}
            >
                <span className="w-4 h-4 flex items-center justify-center shrink-0 mr-1">
                    {icon}
                </span>

                <span className="truncate">{label}</span>

                {suffix}
            </span>

            {badge && (
                <span className="ml-auto mr-1 text-[9px] text-muted-foreground/40 font-mono shrink-0">
                    {badge}
                </span>
            )}
        </div>
    );
}
