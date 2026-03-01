import { useState, useEffect } from "react";
import {
    useProfilesStore,
    DatabaseProfile,
    DatabaseType,
    ProfileFormData,
    DB_TYPE_LABELS,
    DB_TYPE_COLORS,
    DB_TYPE_DEFAULT_PORTS,
    createDefaultFormData,
} from "@/state/profilesStore";
import { useSchemaStore } from "@/state/schemaStore";
import { useLayoutStore } from "@/state/layoutStore";
import { dbConnect, dbDisconnect } from "@/lib/db";
import { cn } from "@/lib/utils/cn";
import {
    Plus,
    Trash2,
    Copy,
    Pencil,
    Plug,
    PlugZap,
    X,
    Server,
    Loader2,
    MoreVertical,
} from "lucide-react";

type ViewMode = "list" | "create" | "edit";

export function ServersSidebar() {
    const { profiles, addProfile, updateProfile, deleteProfile, duplicateProfile, setConnectionStatus } =
        useProfilesStore();
    const addConnection = useSchemaStore((s) => s.addConnection);
    const removeConnection = useSchemaStore((s) => s.removeConnection);
    const setActiveView = useLayoutStore((s) => s.setActiveView);

    const [viewMode, setViewMode] = useState<ViewMode>("list");
    const [editingId, setEditingId] = useState<string | null>(null);
    const [formData, setFormData] = useState<ProfileFormData>(createDefaultFormData());
    const [connectError, setConnectError] = useState<string | null>(null);
    const [contextMenu, setContextMenu] = useState<{ id: string; x: number; y: number } | null>(null);

    useEffect(() => {
        const handleClick = () => setContextMenu(null);
        window.addEventListener("click", handleClick);
        return () => window.removeEventListener("click", handleClick);
    }, []);

    const handleCreate = () => {
        setFormData(createDefaultFormData());
        setEditingId(null);
        setViewMode("create");
    };

    const handleEdit = (profile: DatabaseProfile) => {
        setFormData({
            name: profile.name,
            type: profile.type,
            color: profile.color,
            host: profile.host,
            port: profile.port,
            user: profile.user,
            password: profile.password,
            database: profile.database,
            filePath: profile.filePath,
            ssl: profile.ssl,
        });
        setEditingId(profile.id);
        setViewMode("edit");
    };

    const handleSave = () => {
        if (!formData.name.trim()) return;

        if (viewMode === "edit" && editingId) {
            updateProfile(editingId, formData);
        } else {
            addProfile(formData);
        }
        setViewMode("list");
    };

    const handleCancel = () => {
        setViewMode("list");
        setEditingId(null);
    };

    const handleDelete = async (id: string) => {
        try { await dbDisconnect(id); } catch { /* ignore */ }
        removeConnection(id);
        deleteProfile(id);
        setContextMenu(null);
    };

    const handleConnect = async (id: string) => {
        const profile = profiles.find((p) => p.id === id);
        if (!profile) return;
        setConnectError(null);

        if (profile.connectionStatus === "connected") {
            try { await dbDisconnect(id); } catch { /* ignore */ }
            setConnectionStatus(id, "disconnected");
            removeConnection(id);
        } else {
            setConnectionStatus(id, "connecting");
            try {
                await dbConnect({
                    profile_id: id,
                    host: profile.host,
                    port: profile.port ?? 3306,
                    user: profile.user,
                    password: profile.password,
                    database: profile.database || null,
                    ssl: profile.ssl,
                });
                setConnectionStatus(id, "connected");
                addConnection(id, profile.name, profile.color);
                setActiveView("explorer");
            } catch (e) {
                setConnectionStatus(id, "error");
                setConnectError(String(e));
            }
        }
    };

    const handleDoubleClick = async (id: string) => {
        const profile = profiles.find((p) => p.id === id);
        if (!profile) return;
        setConnectError(null);

        if (profile.connectionStatus === "connected") {
            setActiveView("explorer");
        } else {
            handleConnect(id);
        }
    };

    const handleTypeChange = (type: DatabaseType) => {
        setFormData((prev) => ({
            ...prev,
            type,
            color: DB_TYPE_COLORS[type],
            port: DB_TYPE_DEFAULT_PORTS[type],
            host: type === "sqlite" ? "" : prev.host || "localhost",
        }));
    };

    const updateField = <K extends keyof ProfileFormData>(key: K, value: ProfileFormData[K]) => {
        setFormData((prev) => ({ ...prev, [key]: value }));
    };

    const isSqlite = formData.type === "sqlite";

    return (
        <div className="h-full flex flex-col relative bg-background">
            {/* Sidebar Header */}
            <div className="h-9 px-4 flex items-center justify-between border-b shrink-0">
                <span className="font-semibold text-xs uppercase tracking-wider">
                    SERVERS
                </span>
                <button
                    onClick={handleCreate}
                    className="flex items-center justify-center w-6 h-6 rounded text-muted-foreground hover:bg-accent/50 hover:text-foreground transition-colors"
                    title="New Connection"
                >
                    <Plus className="w-4 h-4" />
                </button>
            </div>

            {/* List View */}
            <div className="flex-1 overflow-y-auto w-full p-2 space-y-1">
                {profiles.length === 0 ? (
                    <div className="p-6 text-center mt-10">
                        <Server className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
                        <p className="text-xs text-muted-foreground mb-4">No connections yet</p>
                        <button
                            onClick={handleCreate}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded bg-primary text-primary-foreground hover:bg-primary/90"
                        >
                            <Plus className="w-3.5 h-3.5" />
                            New Connection
                        </button>
                    </div>
                ) : (
                    profiles.map((profile) => {
                        return (
                            <div
                                key={profile.id}
                                className="flex flex-col bg-transparent relative group/item"
                                onContextMenu={(e) => {
                                    e.preventDefault();
                                    setContextMenu({ id: profile.id, x: e.clientX, y: e.clientY });
                                }}
                            >
                                <button
                                    onClick={() => handleDoubleClick(profile.id)}
                                    className="w-full text-left px-3 py-1.5 flex items-center gap-2.5 transition-colors group relative hover:bg-accent/50"
                                    title="Click to connect / open"
                                >
                                    {/* Color dot + status */}
                                    <div className="relative shrink-0">
                                        <div
                                            className="w-3.5 h-3.5 rounded"
                                            style={{ backgroundColor: profile.color }}
                                        />
                                        {profile.connectionStatus === "connected" && (
                                            <div className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-green-500 border border-background" />
                                        )}
                                        {profile.connectionStatus === "connecting" && (
                                            <div className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-yellow-500 border border-background animate-pulse" />
                                        )}
                                        {profile.connectionStatus === "error" && (
                                            <div className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-red-500 border border-background" />
                                        )}
                                    </div>

                                    <div className="flex-1 min-w-0">
                                        <div className="text-[13px] font-medium truncate leading-tight">{profile.name}</div>
                                        <div className="text-[10px] text-muted-foreground truncate leading-tight mt-0.5">
                                            {profile.type === "sqlite"
                                                ? profile.filePath || "No file set"
                                                : `${profile.host}:${profile.port ?? "—"}`}
                                        </div>
                                    </div>

                                    <div className="shrink-0 text-muted-foreground/50 transition-transform flex items-center gap-0.5 ml-auto">
                                        {profile.connectionStatus === "connected" ? (
                                            <button
                                                onClick={(e) => { e.stopPropagation(); handleConnect(profile.id); }}
                                                title="Disconnect"
                                                className="w-6 h-6 flex items-center justify-center rounded hover:bg-red-500/20 hover:text-red-500 transition-colors"
                                            >
                                                <PlugZap className="w-3.5 h-3.5" />
                                            </button>
                                        ) : profile.connectionStatus === "connecting" ? (
                                            <div className="w-6 h-6 flex items-center justify-center">
                                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                            </div>
                                        ) : (
                                            <button
                                                onClick={(e) => { e.stopPropagation(); handleConnect(profile.id); }}
                                                title="Connect"
                                                className="w-6 h-6 flex items-center justify-center rounded hover:bg-primary/20 hover:text-primary transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100"
                                            >
                                                <Plug className="w-3.5 h-3.5" />
                                            </button>
                                        )}
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                setContextMenu({ id: profile.id, x: e.clientX, y: e.clientY });
                                            }}
                                            className="w-6 h-6 flex items-center justify-center rounded hover:bg-muted transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100"
                                            title="More Actions"
                                        >
                                            <MoreVertical className="w-3.5 h-3.5" />
                                        </button>
                                    </div>
                                </button>

                                {connectError && profile.connectionStatus === "error" && (
                                    <div className="px-3 pb-2 pt-1">
                                        <div className="text-[10px] text-red-500/90 font-mono break-all overflow-hidden relative pr-4 bg-red-500/10 border border-red-500/20 rounded-md p-1.5">
                                            {connectError}
                                            <button onClick={() => setConnectError(null)} className="absolute top-1 right-1 p-0.5 rounded text-red-400 hover:text-red-300 transition-colors">
                                                <X className="w-3 h-3" />
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        );
                    })
                )}
            </div>

            {/* Context Menu Dropdown */}
            {contextMenu && (() => {
                const profile = profiles.find(p => p.id === contextMenu.id);
                if (!profile) return null;
                const isConnected = profile.connectionStatus === "connected";

                return (
                    <div
                        className="fixed z-[100] min-w-[160px] bg-popover text-popover-foreground border rounded-md shadow-md p-1 text-xs"
                        style={{
                            top: Math.min(contextMenu.y, window.innerHeight - 180),
                            left: Math.min(contextMenu.x, window.innerWidth - 160),
                        }}
                    >
                        <button
                            className="w-full text-left px-2 py-1.5 hover:bg-accent rounded flex items-center gap-2"
                            onClick={() => {
                                setContextMenu(null);
                                handleConnect(profile.id);
                            }}
                        >
                            {isConnected ? <PlugZap className="w-3.5 h-3.5 text-red-400" /> : <Plug className="w-3.5 h-3.5 text-primary" />}
                            {isConnected ? "Disconnect" : "Connect"}
                        </button>
                        <button
                            className="w-full text-left px-2 py-1.5 hover:bg-accent rounded flex items-center gap-2"
                            onClick={() => {
                                setContextMenu(null);
                                handleEdit(profile);
                            }}
                        >
                            <Pencil className="w-3.5 h-3.5 text-muted-foreground" /> Edit
                        </button>
                        <button
                            className="w-full text-left px-2 py-1.5 hover:bg-accent rounded flex items-center gap-2"
                            onClick={() => {
                                setContextMenu(null);
                                duplicateProfile(profile.id);
                            }}
                        >
                            <Copy className="w-3.5 h-3.5 text-muted-foreground" /> Duplicate
                        </button>
                        <div className="h-px bg-border my-1" />
                        <button
                            className="w-full text-left px-2 py-1.5 hover:bg-red-500/20 text-red-500 rounded flex items-center gap-2"
                            onClick={() => handleDelete(profile.id)}
                        >
                            <Trash2 className="w-3.5 h-3.5" /> Delete
                        </button>
                    </div>
                );
            })()}

            {/* Modal Form overlay rendered absolutely within the sidebar / screen */}
            {viewMode !== "list" && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4">
                    <div className="w-full max-w-lg bg-card border shadow-2xl rounded-xl flex flex-col max-h-full overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                        {/* Modal Header */}
                        <div className="h-12 border-b flex items-center justify-between px-5 shrink-0 bg-muted/40">
                            <div className="flex items-center gap-2">
                                <span className="text-sm font-semibold">
                                    {viewMode === "edit" ? "Edit Connection" : "New Connection"}
                                </span>
                            </div>
                            <button onClick={handleCancel} className="text-muted-foreground hover:text-foreground rounded-full p-1 hover:bg-accent transition-colors">
                                <X className="w-4 h-4" />
                            </button>
                        </div>

                        {/* Modal Body */}
                        <div className="flex-1 overflow-y-auto p-5 space-y-5">
                            {/* Connection Name */}
                            <div>
                                <label className="text-xs font-semibold block mb-1.5">Connection Name *</label>
                                <input
                                    type="text"
                                    value={formData.name}
                                    onChange={(e) => updateField("name", e.target.value)}
                                    placeholder="My Database"
                                    autoFocus
                                    className="w-full h-9 rounded-md border bg-secondary/50 px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50 transition-all"
                                />
                            </div>

                            {/* Database Type */}
                            <div>
                                <label className="text-xs font-semibold block mb-1.5">Database Type</label>
                                <div className="grid grid-cols-5 gap-2">
                                    {(Object.keys(DB_TYPE_LABELS) as DatabaseType[]).map((type) => (
                                        <button
                                            key={type}
                                            onClick={() => handleTypeChange(type)}
                                            className={cn(
                                                "flex flex-col items-center gap-1.5 py-3 px-1 rounded-md border text-xs transition-all",
                                                formData.type === type
                                                    ? "border-primary bg-primary/10 text-primary font-medium"
                                                    : "border-border bg-secondary/30 text-muted-foreground hover:bg-secondary/80 hover:text-foreground"
                                            )}
                                        >
                                            <div
                                                className="w-3.5 h-3.5 rounded-full"
                                                style={{ backgroundColor: DB_TYPE_COLORS[type] }}
                                            />
                                            <span>{DB_TYPE_LABELS[type]}</span>
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Color Tag */}
                            <div>
                                <label className="text-xs font-semibold block mb-1.5">Color Tag</label>
                                <div className="flex gap-2 items-center">
                                    <input
                                        type="color"
                                        value={formData.color}
                                        onChange={(e) => updateField("color", e.target.value)}
                                        className="w-8 h-8 rounded border cursor-pointer border-border bg-background p-0.5"
                                    />
                                    <span className="text-xs font-mono text-muted-foreground uppercase">{formData.color}</span>
                                </div>
                            </div>

                            {isSqlite ? (
                                /* SQLite: File Path */
                                <div>
                                    <label className="text-xs font-semibold block mb-1.5">Database File Path</label>
                                    <div className="flex gap-2">
                                        <input
                                            type="text"
                                            value={formData.filePath}
                                            onChange={(e) => updateField("filePath", e.target.value)}
                                            placeholder="/path/to/database.db"
                                            className="flex-1 h-9 rounded-md border bg-secondary/50 px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
                                        />
                                        <button className="h-9 px-4 rounded-md border bg-secondary/50 font-medium hover:bg-secondary hover:text-foreground text-xs transition-all">
                                            Browse
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                /* TCP: Host, Port, User, Password, Database */
                                <div className="space-y-4 pt-1">
                                    <div className="grid grid-cols-3 gap-3">
                                        <div className="col-span-2">
                                            <label className="text-xs font-medium text-muted-foreground block mb-1.5">Hostname</label>
                                            <input
                                                type="text"
                                                value={formData.host}
                                                onChange={(e) => updateField("host", e.target.value)}
                                                placeholder="localhost"
                                                className="w-full h-9 rounded-md border bg-secondary/50 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
                                            />
                                        </div>
                                        <div>
                                            <label className="text-xs font-medium text-muted-foreground block mb-1.5">Port</label>
                                            <input
                                                type="number"
                                                value={formData.port ?? ""}
                                                onChange={(e) => updateField("port", e.target.value ? Number(e.target.value) : undefined)}
                                                placeholder={String(DB_TYPE_DEFAULT_PORTS[formData.type] ?? "")}
                                                className="w-full h-9 rounded-md border bg-secondary/50 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
                                            />
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-2 gap-3">
                                        <div>
                                            <label className="text-xs font-medium text-muted-foreground block mb-1.5">Username</label>
                                            <input
                                                type="text"
                                                value={formData.user}
                                                onChange={(e) => updateField("user", e.target.value)}
                                                placeholder="root"
                                                className="w-full h-9 rounded-md border bg-secondary/50 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
                                            />
                                        </div>
                                        <div>
                                            <label className="text-xs font-medium text-muted-foreground block mb-1.5">Password</label>
                                            <input
                                                type="password"
                                                value={formData.password}
                                                onChange={(e) => updateField("password", e.target.value)}
                                                placeholder="••••••••"
                                                className="w-full h-9 rounded-md border bg-secondary/50 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
                                            />
                                        </div>
                                    </div>

                                    <div>
                                        <label className="text-xs font-medium text-muted-foreground block mb-1.5">Default Database (Optional)</label>
                                        <input
                                            type="text"
                                            value={formData.database}
                                            onChange={(e) => updateField("database", e.target.value)}
                                            placeholder="my_database"
                                            className="w-full h-9 rounded-md border bg-secondary/50 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
                                        />
                                    </div>

                                    {/* SSL Toggle */}
                                    <div className="flex items-center gap-3 pt-2">
                                        <button
                                            onClick={() => updateField("ssl", !formData.ssl)}
                                            className={cn(
                                                "relative w-10 h-5 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-background space-x-0 ring-primary/50",
                                                formData.ssl ? "bg-primary" : "bg-secondary"
                                            )}
                                        >
                                            <div
                                                className={cn(
                                                    "absolute top-[2px] w-4 h-4 rounded-full bg-white transition-transform shadow-sm",
                                                    formData.ssl ? "translate-x-[22px]" : "translate-x-[2px]"
                                                )}
                                            />
                                        </button>
                                        <span className="text-xs font-medium">Use SSL Protocol</span>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Modal Footer */}
                        <div className="h-14 border-t flex items-center justify-end px-5 gap-3 bg-muted/20 shrink-0">
                            <button
                                onClick={handleCancel}
                                className="px-4 py-2 text-xs font-medium rounded-md hover:bg-secondary text-foreground transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleSave}
                                disabled={!formData.name.trim()}
                                className="px-5 py-2 text-xs font-semibold rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm"
                            >
                                {viewMode === "edit" ? "Save Changes" : "Create Connection"}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
