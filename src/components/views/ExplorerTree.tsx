import { useState, useCallback, useEffect, useMemo } from "react";
import { useSchemaStore } from "@/state/schemaStore";
import { CreateDatabaseModal } from "./CreateDatabaseModal";
import { ConfirmModal } from "./ConfirmModal";
import { EditDatabaseModal } from "./EditDatabaseModal";
import { ContextSubmenu } from "./ContextSubmenu";
import { useProfilesStore } from "@/state/profilesStore";
import { useLayoutStore } from "@/state/layoutStore";
import { dbListDatabases, dbListTables, dbListColumns, dbDisconnect, dbExecuteQuery } from "@/lib/db";
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
    FolderPlus,
    Maximize2,
    Minimize2,
    RefreshCw,
    X,
    Trash,
    Pencil,
    CheckSquare,
    Square,
    PlusSquare,
    FileCode2,
} from "lucide-react";
import {
    SiPostgresql,
    SiMysql,
    SiSqlite,
    SiMariadb,
} from "react-icons/si";

const DB_ICONS: Record<string, any> = {
    postgres: SiPostgresql,
    mysql: SiMysql,
    sqlite: SiSqlite,
    mariadb: SiMariadb,
    mssql: Database
};

type ExpandedSet = Record<string, boolean>;

type ContextMenuTarget =
    | { type: "server", profileId: string }
    | { type: "database", profileId: string, databases: string[] };

export function ExplorerTree() {
    const connectedProfiles = useSchemaStore((s) => s.connectedProfiles);
    const profiles = useProfilesStore((s) => s.profiles);
    const [expanded, setExpanded] = useState<ExpandedSet>({});

    const connectedList = profiles.filter((p) => p.connectionStatus === "connected");

    const [contextMenu, setContextMenu] = useState<{ target: ContextMenuTarget, x: number, y: number } | null>(null);
    const [selectedDatabases, setSelectedDatabases] = useState<Set<string>>(new Set());
    const [createDbProfileId, setCreateDbProfileId] = useState<string | null>(null);
    const [dropDbState, setDropDbState] = useState<{ profileId: string, databases: string[] } | null>(null);
    const [editDbState, setEditDbState] = useState<{ profileId: string, database: string } | null>(null);
    const [dbFilter, setDbFilter] = useState("");
    const [tableFilter, setTableFilter] = useState("");

    // Hide context menu on click outside
    useEffect(() => {
        const handleClick = () => setContextMenu(null);
        window.addEventListener("click", handleClick);
        return () => window.removeEventListener("click", handleClick);
    }, []);

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
        <div className="flex flex-col h-full bg-background select-none text-[12px]">
            {/* Filter Bar */}
            <div className="shrink-0 flex items-center h-[26px] border-b bg-muted/20 text-[11px]">
                <div className="flex-1 flex items-center h-full px-2 border-r focus-within:bg-muted/30 transition-colors">
                    <Database className="w-3 h-3 text-muted-foreground mr-1.5 shrink-0" />
                    <input
                        type="text"
                        placeholder="Database filter"
                        value={dbFilter}
                        onChange={(e) => setDbFilter(e.target.value)}
                        className="bg-transparent border-none outline-none w-full text-foreground placeholder:text-muted-foreground/60 h-full"
                    />
                    {dbFilter && (
                        <X
                            className="w-3 h-3 text-muted-foreground cursor-pointer hover:text-foreground shrink-0"
                            onClick={() => setDbFilter("")}
                        />
                    )}
                </div>
                <div className="flex-1 flex items-center h-full px-2 focus-within:bg-muted/30 transition-colors">
                    <Table2 className="w-3 h-3 text-muted-foreground mr-1.5 shrink-0" />
                    <input
                        type="text"
                        placeholder="Table filter"
                        value={tableFilter}
                        onChange={(e) => setTableFilter(e.target.value)}
                        className="bg-transparent border-none outline-none w-full text-foreground placeholder:text-muted-foreground/60 h-full font-mono"
                    />
                    {tableFilter && (
                        <X
                            className="w-3 h-3 text-muted-foreground cursor-pointer hover:text-foreground shrink-0"
                            onClick={() => setTableFilter("")}
                        />
                    )}
                </div>
            </div>

            <div className="flex-1 overflow-y-auto overflow-x-hidden pt-1">
                {connectedList.map((profile) => {
                    const meta = connectedProfiles[profile.id];
                    return (
                        <ProfileNode
                            key={profile.id}
                            profileId={profile.id}
                            name={meta?.name ?? profile.name}
                            color={meta?.color ?? profile.color}
                            type={profile.type}
                            expanded={expanded}
                            toggle={toggle}
                            dbFilter={dbFilter}
                            tableFilter={tableFilter}
                            selectedDatabases={selectedDatabases}
                            onSelectDatabase={(dbCacheKey, multi) => {
                                setSelectedDatabases(prev => {
                                    if (multi) {
                                        const next = new Set(prev);
                                        if (next.has(dbCacheKey)) next.delete(dbCacheKey);
                                        else next.add(dbCacheKey);
                                        return next;
                                    }
                                    return new Set([dbCacheKey]);
                                });
                            }}
                            onContextMenuServer={(e) => {
                                e.preventDefault();
                                setContextMenu({ target: { type: "server", profileId: profile.id }, x: e.clientX, y: e.clientY });
                            }}
                            onContextMenuDatabase={(e, database) => {
                                e.preventDefault();
                                const dbCacheKey = `${profile.id}::${database}`;
                                let currentSelection = selectedDatabases;
                                if (!currentSelection.has(dbCacheKey)) {
                                    currentSelection = new Set([dbCacheKey]);
                                    setSelectedDatabases(currentSelection);
                                }

                                const dbsUnderProfile = Array.from(currentSelection)
                                    .filter(k => k.startsWith(profile.id + "::"))
                                    .map(k => k.split("::")[1]);

                                setContextMenu({ target: { type: "database", profileId: profile.id, databases: dbsUnderProfile }, x: e.clientX, y: e.clientY });
                            }}
                        />
                    );
                })}
            </div>

            {/* Context Menu Dropdown */}
            {contextMenu && (() => {
                const { target } = contextMenu;
                const profileId = target.profileId;
                const profile = profiles.find((p) => p.id === profileId);
                if (!profile) return null;

                const menuStyle = {
                    top: Math.min(contextMenu.y, window.innerHeight - 280),
                    left: Math.min(contextMenu.x, window.innerWidth - 200),
                };

                // ─── Server context menu ─────────────────────
                if (target.type === "server") {
                    const handleDisconnect = async () => {
                        setContextMenu(null);
                        try { await dbDisconnect(profileId); } catch { /* ignore */ }
                        useProfilesStore.getState().setConnectionStatus(profileId, "disconnected");
                        useSchemaStore.getState().removeConnection(profileId);
                    };

                    const handleRefresh = async () => {
                        setContextMenu(null);
                        const schemaStore = useSchemaStore.getState();
                        schemaStore.setLoading(profileId, "databases", true);
                        schemaStore.clearError(`dbs-${profileId}`);
                        try {
                            const dbs = await dbListDatabases(profileId);
                            schemaStore.setDatabases(profileId, dbs);
                            setExpanded(prev => ({ ...prev, [`profile-${profileId}`]: true }));
                        } catch (e) {
                            schemaStore.setError(`dbs-${profileId}`, String(e));
                        } finally {
                            schemaStore.setLoading(profileId, "databases", false);
                        }
                    };

                    const handleCreateDatabase = () => {
                        setContextMenu(null);
                        setCreateDbProfileId(profileId);
                    };

                    const handleExpandAll = async () => {
                        setContextMenu(null);
                        const schemaStore = useSchemaStore.getState();
                        let dbs = schemaStore.databases[profileId];
                        if (!dbs) {
                            schemaStore.setLoading(profileId, "databases", true);
                            schemaStore.clearError(`dbs-${profileId}`);
                            try {
                                dbs = await dbListDatabases(profileId);
                                schemaStore.setDatabases(profileId, dbs);
                            } catch (e) {
                                schemaStore.setError(`dbs-${profileId}`, String(e));
                            } finally {
                                schemaStore.setLoading(profileId, "databases", false);
                            }
                        }
                        if (dbs) {
                            setExpanded(prev => ({ ...prev, [`profile-${profileId}`]: true }));
                            await Promise.all(dbs.map(async (db) => {
                                const cacheKey = `${profileId}::${db}`;
                                if (!schemaStore.tables[cacheKey]) {
                                    schemaStore.setLoading(cacheKey, "tables", true);
                                    schemaStore.clearError(`tbl-${cacheKey}`);
                                    try {
                                        const tbls = await dbListTables(profileId, db);
                                        schemaStore.setTables(profileId, db, tbls);
                                    } catch (e) {
                                        schemaStore.setError(`tbl-${cacheKey}`, String(e));
                                    } finally {
                                        schemaStore.setLoading(cacheKey, "tables", false);
                                    }
                                }
                            }));
                            setExpanded(prev => {
                                const next = { ...prev };
                                dbs.forEach(db => { next[`db-${profileId}::${db}`] = true; });
                                return next;
                            });
                        }
                    };

                    const handleCollapseAll = () => {
                        setContextMenu(null);
                        setExpanded(prev => {
                            const next = { ...prev };
                            Object.keys(next).forEach(k => {
                                if (k.startsWith(`db-${profileId}::`) || k === `profile-${profileId}`) {
                                    next[k] = false;
                                }
                            });
                            return next;
                        });
                    };

                    return (
                        <div className="fixed z-[100] min-w-[180px] bg-popover text-popover-foreground border rounded-md shadow-md p-1 text-xs" style={menuStyle}>
                            <button className="w-full text-left px-2 py-1.5 hover:bg-accent rounded flex items-center gap-2" onClick={handleDisconnect}>
                                <PlugZap className="w-3.5 h-3.5 text-red-500" /> Disconnect
                            </button>
                            <button className="w-full text-left px-2 py-1.5 hover:bg-accent rounded flex items-center gap-2" onClick={handleRefresh}>
                                <RefreshCw className="w-3.5 h-3.5 text-muted-foreground" /> Refresh
                            </button>
                            <div className="h-px bg-border my-1 mx-1" />
                            <button className="w-full text-left px-2 py-1.5 hover:bg-accent rounded flex items-center gap-2" onClick={handleCreateDatabase}>
                                <FolderPlus className="w-3.5 h-3.5 text-muted-foreground" /> Create Database...
                            </button>
                            <div className="h-px bg-border my-1 mx-1" />
                            <button className="w-full text-left px-2 py-1.5 hover:bg-accent rounded flex items-center gap-2" onClick={handleExpandAll}>
                                <Maximize2 className="w-3.5 h-3.5 text-muted-foreground" /> Expand All
                            </button>
                            <button className="w-full text-left px-2 py-1.5 hover:bg-accent rounded flex items-center gap-2" onClick={handleCollapseAll}>
                                <Minimize2 className="w-3.5 h-3.5 text-muted-foreground" /> Collapse All
                            </button>
                        </div>
                    );
                }

                // ─── Database context menu ───────────────────
                if (target.type === "database") {
                    const { databases: targetDbs } = target;
                    const isMulti = targetDbs.length > 1;

                    const handleShowTables = () => {
                        setContextMenu(null);
                        const openTab = useLayoutStore.getState().openTab;
                        openTab({
                            title: `Database: ${targetDbs[0]}`,
                            type: "database-view",
                            meta: { profileId, profileName: profile.name, database: targetDbs[0] },
                        });
                    };

                    const handleEditDatabase = () => {
                        setContextMenu(null);
                        setEditDbState({ profileId, database: targetDbs[0] });
                    };

                    const handleDrop = () => {
                        setContextMenu(null);
                        setDropDbState({ profileId, databases: targetDbs });
                    };

                    const handleExpandAll = async () => {
                        setContextMenu(null);
                        const schemaStore = useSchemaStore.getState();
                        await Promise.all(targetDbs.map(async (db) => {
                            const cacheKey = `${profileId}::${db}`;
                            if (!schemaStore.tables[cacheKey]) {
                                schemaStore.setLoading(cacheKey, "tables", true);
                                schemaStore.clearError(`tbl-${cacheKey}`);
                                try {
                                    const tbls = await dbListTables(profileId, db);
                                    schemaStore.setTables(profileId, db, tbls);
                                } catch (e) {
                                    schemaStore.setError(`tbl-${cacheKey}`, String(e));
                                } finally {
                                    schemaStore.setLoading(cacheKey, "tables", false);
                                }
                            }
                        }));
                        setExpanded(prev => {
                            const next = { ...prev };
                            targetDbs.forEach(db => { next[`db-${profileId}::${db}`] = true; });
                            return next;
                        });
                    };

                    const handleCollapseAll = () => {
                        setContextMenu(null);
                        setExpanded(prev => {
                            const next = { ...prev };
                            targetDbs.forEach(db => { next[`db-${profileId}::${db}`] = false; });
                            return next;
                        });
                    };

                    const handleSelectAll = () => {
                        setContextMenu(null);
                        const allDbs = useSchemaStore.getState().databases[profileId] || [];
                        setSelectedDatabases(new Set(allDbs.map(db => `${profileId}::${db}`)));
                    };

                    const handleDeselectAll = () => {
                        setContextMenu(null);
                        setSelectedDatabases(new Set());
                    };

                    return (
                        <div className="fixed z-[100] min-w-[200px] bg-popover text-popover-foreground border rounded-md shadow-md p-1 text-xs" style={menuStyle}>
                            {isMulti ? (
                                <>
                                    <button className="w-full text-left px-2 py-1.5 hover:bg-accent rounded flex items-center gap-2" onClick={handleSelectAll}>
                                        <CheckSquare className="w-3.5 h-3.5 text-muted-foreground" /> Select All
                                    </button>
                                    <button className="w-full text-left px-2 py-1.5 hover:bg-accent rounded flex items-center gap-2" onClick={handleDeselectAll}>
                                        <Square className="w-3.5 h-3.5 text-muted-foreground" /> Deselect All
                                    </button>
                                    <div className="h-px bg-border my-1 mx-1" />
                                    <button className="w-full text-left px-2 py-1.5 hover:bg-accent rounded flex items-center gap-2 text-red-400" onClick={handleDrop}>
                                        <Trash className="w-3.5 h-3.5" /> Drop ({targetDbs.length} databases)
                                    </button>
                                    <div className="h-px bg-border my-1 mx-1" />
                                    <button className="w-full text-left px-2 py-1.5 hover:bg-accent rounded flex items-center gap-2" onClick={handleExpandAll}>
                                        <Maximize2 className="w-3.5 h-3.5 text-muted-foreground" /> Expand All
                                    </button>
                                    <button className="w-full text-left px-2 py-1.5 hover:bg-accent rounded flex items-center gap-2" onClick={handleCollapseAll}>
                                        <Minimize2 className="w-3.5 h-3.5 text-muted-foreground" /> Collapse All
                                    </button>
                                </>
                            ) : (
                                <>
                                    <button className="w-full text-left px-2 py-1.5 hover:bg-accent rounded flex items-center gap-2" onClick={handleShowTables}>
                                        <Table2 className="w-3.5 h-3.5 text-muted-foreground" /> Show Tables
                                    </button>
                                    <button className="w-full text-left px-2 py-1.5 hover:bg-accent rounded flex items-center gap-2" onClick={handleEditDatabase}>
                                        <Pencil className="w-3.5 h-3.5 text-muted-foreground" /> Edit Database...
                                    </button>
                                    <div className="h-px bg-border my-1 mx-1" />
                                    <ContextSubmenu label="Create" icon={<PlusSquare className="w-3.5 h-3.5 text-muted-foreground" />}>
                                        <button className="w-full text-left px-2 py-1.5 hover:bg-accent rounded flex items-center gap-2" onClick={() => setContextMenu(null)}>
                                            <Table2 className="w-3.5 h-3.5 text-muted-foreground" /> Table
                                        </button>
                                        <button className="w-full text-left px-2 py-1.5 hover:bg-accent rounded flex items-center gap-2" onClick={() => setContextMenu(null)}>
                                            <FileCode2 className="w-3.5 h-3.5 text-muted-foreground" /> View
                                        </button>
                                        <button className="w-full text-left px-2 py-1.5 hover:bg-accent rounded flex items-center gap-2" onClick={() => setContextMenu(null)}>
                                            <FileCode2 className="w-3.5 h-3.5 text-muted-foreground" /> Stored Procedure
                                        </button>
                                        <button className="w-full text-left px-2 py-1.5 hover:bg-accent rounded flex items-center gap-2" onClick={() => setContextMenu(null)}>
                                            <FileCode2 className="w-3.5 h-3.5 text-muted-foreground" /> Stored Function
                                        </button>
                                        <button className="w-full text-left px-2 py-1.5 hover:bg-accent rounded flex items-center gap-2" onClick={() => setContextMenu(null)}>
                                            <FileCode2 className="w-3.5 h-3.5 text-muted-foreground" /> Trigger
                                        </button>
                                        <button className="w-full text-left px-2 py-1.5 hover:bg-accent rounded flex items-center gap-2" onClick={() => setContextMenu(null)}>
                                            <FileCode2 className="w-3.5 h-3.5 text-muted-foreground" /> Event
                                        </button>
                                    </ContextSubmenu>
                                    <div className="h-px bg-border my-1 mx-1" />
                                    <button className="w-full text-left px-2 py-1.5 hover:bg-accent rounded flex items-center gap-2 text-red-400" onClick={handleDrop}>
                                        <Trash className="w-3.5 h-3.5" /> Drop Database
                                    </button>
                                    <div className="h-px bg-border my-1 mx-1" />
                                    <button className="w-full text-left px-2 py-1.5 hover:bg-accent rounded flex items-center gap-2" onClick={handleExpandAll}>
                                        <Maximize2 className="w-3.5 h-3.5 text-muted-foreground" /> Expand All
                                    </button>
                                    <button className="w-full text-left px-2 py-1.5 hover:bg-accent rounded flex items-center gap-2" onClick={handleCollapseAll}>
                                        <Minimize2 className="w-3.5 h-3.5 text-muted-foreground" /> Collapse All
                                    </button>
                                </>
                            )}
                        </div>
                    );
                }

                return null;
            })()}

            {/* ─── Drop Confirmation Modal ──────────────────── */}
            {dropDbState && (
                <ConfirmModal
                    title={`Drop ${dropDbState.databases.length > 1 ? dropDbState.databases.length + " Databases" : "Database"}`}
                    message={
                        dropDbState.databases.length > 1
                            ? `Are you sure you want to permanently drop these ${dropDbState.databases.length} databases?\n\n${dropDbState.databases.map(d => `• ${d}`).join("\n")}\n\nThis action cannot be undone.`
                            : `Are you sure you want to permanently drop database "${dropDbState.databases[0]}"?\n\nThis action cannot be undone.`
                    }
                    confirmLabel="Drop"
                    danger
                    onCancel={() => setDropDbState(null)}
                    onConfirm={async () => {
                        const { profileId: pid, databases: dbsToDrop } = dropDbState;
                        setDropDbState(null);
                        for (const db of dbsToDrop) {
                            try {
                                await dbExecuteQuery(pid, `DROP DATABASE \`${db}\``);
                            } catch (e) {
                                console.error(`Failed to drop ${db}:`, e);
                            }
                        }
                        const schemaStore = useSchemaStore.getState();
                        schemaStore.setLoading(pid, "databases", true);
                        try {
                            const freshDbs = await dbListDatabases(pid);
                            schemaStore.setDatabases(pid, freshDbs);
                        } catch { /* ignore */ } finally {
                            schemaStore.setLoading(pid, "databases", false);
                        }
                        setSelectedDatabases(new Set());
                    }}
                />
            )}

            {/* ─── Edit Database Modal ──────────────────────── */}
            {editDbState && (
                <EditDatabaseModal
                    profileId={editDbState.profileId}
                    database={editDbState.database}
                    onClose={() => setEditDbState(null)}
                    onCompleted={async () => {
                        setEditDbState(null);
                        const schemaStore = useSchemaStore.getState();
                        schemaStore.setLoading(editDbState.profileId, "databases", true);
                        try {
                            const freshDbs = await dbListDatabases(editDbState.profileId);
                            schemaStore.setDatabases(editDbState.profileId, freshDbs);
                        } catch { /* ignore */ } finally {
                            schemaStore.setLoading(editDbState.profileId, "databases", false);
                        }
                    }}
                />
            )}

            {createDbProfileId !== null && (
                <CreateDatabaseModal
                    profileId={createDbProfileId}
                    onClose={() => setCreateDbProfileId(null)}
                    onCreated={() => {
                        setExpanded(prev => ({ ...prev, [`profile-${createDbProfileId}`]: true }));
                    }}
                />
            )}
        </div>
    );
}

// ─── Profile Node (root) → lazy loads databases ─────────────────────

function ProfileNode({
    profileId,
    name,
    color,
    type,
    expanded,
    toggle,
    onContextMenuServer,
    onContextMenuDatabase,
    onSelectDatabase,
    selectedDatabases,
    dbFilter,
    tableFilter,
}: {
    profileId: string;
    name: string;
    color: string;
    type: string;
    expanded: ExpandedSet;
    toggle: (key: string) => void;
    onContextMenuServer: (e: React.MouseEvent) => void;
    onContextMenuDatabase: (e: React.MouseEvent, database: string) => void;
    onSelectDatabase: (cacheKey: string, multi: boolean) => void;
    selectedDatabases: Set<string>;
    dbFilter: string;
    tableFilter: string;
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

    const filteredDatabases = useMemo(() => {
        if (!databases) return null;
        if (!dbFilter.trim()) return databases;
        try {
            const re = new RegExp(dbFilter, "i");
            return databases.filter(db => re.test(db));
        } catch {
            return databases;
        }
    }, [databases, dbFilter]);

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
                onContextMenu={onContextMenuServer}
                icon={(() => {
                    const Icon = DB_ICONS[type] || Database;
                    return <Icon className="w-3.5 h-3.5" style={{ color }} />;
                })()}
                label={name}
                badge={filteredDatabases ? String(filteredDatabases.length) : undefined}
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
                    {filteredDatabases?.map((db) => (
                        <DatabaseNode
                            key={db}
                            profileId={profileId}
                            profileName={name}
                            database={db}
                            expanded={expanded}
                            toggle={toggle}
                            tableFilter={tableFilter}
                            onSelectDatabase={onSelectDatabase}
                            selectedDatabases={selectedDatabases}
                            onContextMenuDatabase={onContextMenuDatabase}
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
    tableFilter,
    onSelectDatabase,
    selectedDatabases,
    onContextMenuDatabase,
}: {
    profileId: string;
    profileName: string;
    database: string;
    expanded: ExpandedSet;
    toggle: (key: string) => void;
    tableFilter: string;
    onSelectDatabase: (cacheKey: string, multi: boolean) => void;
    selectedDatabases: Set<string>;
    onContextMenuDatabase: (e: React.MouseEvent, database: string) => void;
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

    const filteredTables = useMemo(() => {
        if (!tables) return null;
        if (!tableFilter.trim()) return tables;
        try {
            const re = new RegExp(tableFilter, "i");
            return tables.filter(t => re.test(t));
        } catch {
            return tables;
        }
    }, [tables, tableFilter]);

    // Single click on label → open database tab OR select if ctrl/cmd held
    const handleLabelClick = (e: React.MouseEvent) => {
        if (e.ctrlKey || e.metaKey) {
            onSelectDatabase(cacheKey, true);
        } else {
            onSelectDatabase(cacheKey, false);
            openTab({
                title: `Database: ${database}`,
                type: "database-view",
                meta: {
                    profileId,
                    profileName,
                    database,
                },
            });
        }
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
                selected={selectedDatabases.has(cacheKey)}
                onChevronClick={handleExpand}
                onLabelClick={handleLabelClick}
                onDoubleClick={handleDoubleClick}
                onContextMenu={(e) => onContextMenuDatabase(e, database)}
                icon={<Database className="w-3.5 h-3.5 text-yellow-500/80" />}
                label={database}
                badge={filteredTables ? String(filteredTables.length) : undefined}
            />

            {isOpen && (
                <>
                    {loading && (
                        <TreeRow depth={2} icon={<Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />} label="Loading tables..." muted />
                    )}
                    {error && (
                        <TreeRow depth={2} icon={<AlertCircle className="w-3 h-3 text-red-400" />} label={error} muted />
                    )}
                    {filteredTables?.map((table) => (
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
    onContextMenu,
    icon,
    label,
    badge,
    suffix,
    bold,
    muted,
    selected,
}: {
    depth: number;
    isOpen?: boolean;
    onChevronClick?: () => void;
    onLabelClick?: (e: React.MouseEvent) => void;
    onDoubleClick?: () => void;
    onContextMenu?: (e: React.MouseEvent) => void;
    icon: React.ReactNode;
    label: string;
    badge?: string;
    suffix?: React.ReactNode;
    bold?: boolean;
    muted?: boolean;
    selected?: boolean;
}) {
    const isFolder = isOpen !== undefined;

    return (
        <div
            className={cn(
                "flex items-center h-[22px] cursor-pointer hover:bg-accent/50 transition-colors",
                bold && "font-medium",
                muted && "opacity-60",
                selected && "bg-accent/80 text-accent-foreground"
            )}
            style={{ paddingLeft: `${depth * 14 + 6}px` }}
            onDoubleClick={onDoubleClick}
            onContextMenu={onContextMenu}
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
                    onLabelClick?.(e);
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
