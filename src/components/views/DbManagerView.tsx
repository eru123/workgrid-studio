import { useState } from "react";
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
    Database,
    Plus,
    Trash2,
    Copy,
    Pencil,
    Plug,
    PlugZap,
    X,
    ChevronRight,
    Server,
    Folder,
    Loader2,
} from "lucide-react";

type ViewMode = "list" | "create" | "edit";

export function DbManagerView() {
    const { profiles, addProfile, updateProfile, deleteProfile, duplicateProfile, setConnectionStatus } =
        useProfilesStore();
    const addConnection = useSchemaStore((s) => s.addConnection);
    const removeConnection = useSchemaStore((s) => s.removeConnection);
    const setActiveView = useLayoutStore((s) => s.setActiveView);

    const [viewMode, setViewMode] = useState<ViewMode>("list");
    const [editingId, setEditingId] = useState<string | null>(null);
    const [formData, setFormData] = useState<ProfileFormData>(createDefaultFormData());
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [connectError, setConnectError] = useState<string | null>(null);

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
            const created = addProfile(formData);
            setSelectedId(created.id);
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
        if (selectedId === id) setSelectedId(null);
    };

    const handleConnect = async (id: string) => {
        const profile = profiles.find((p) => p.id === id);
        if (!profile) return;
        setConnectError(null);

        if (profile.connectionStatus === "connected") {
            // Disconnect
            try { await dbDisconnect(id); } catch { /* ignore */ }
            setConnectionStatus(id, "disconnected");
            removeConnection(id);
        } else {
            // Real connection via Tauri backend
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
                // Switch sidebar to Explorer so user sees the schema tree
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
            // Already connected, just switch view
            setActiveView("explorer");
        } else {
            // Real connection via Tauri backend
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
                // Switch sidebar to Explorer so user sees the schema tree
                setActiveView("explorer");
            } catch (e) {
                setConnectionStatus(id, "error");
                setConnectError(String(e));
            }
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

    const selectedProfile = selectedId ? profiles.find((p) => p.id === selectedId) : null;

    // ─── Form View ────────────────────────────────────────────────────
    if (viewMode === "create" || viewMode === "edit") {
        const isSqlite = formData.type === "sqlite";

        return (
            <div className="h-full flex flex-col bg-background">
                {/* Header */}
                <div className="h-10 border-b flex items-center justify-between px-4 shrink-0">
                    <div className="flex items-center gap-2">
                        <button onClick={handleCancel} className="text-muted-foreground hover:text-foreground">
                            <X className="w-4 h-4" />
                        </button>
                        <span className="text-sm font-medium">
                            {viewMode === "edit" ? "Edit Connection" : "New Connection"}
                        </span>
                    </div>
                    <div className="flex gap-2">
                        <button
                            onClick={handleCancel}
                            className="px-3 py-1.5 text-xs rounded border bg-secondary text-secondary-foreground hover:bg-secondary/80"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleSave}
                            disabled={!formData.name.trim()}
                            className="px-3 py-1.5 text-xs rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
                        >
                            {viewMode === "edit" ? "Save Changes" : "Create Connection"}
                        </button>
                    </div>
                </div>

                {/* Form */}
                <div className="flex-1 overflow-y-auto p-6">
                    <div className="max-w-lg mx-auto space-y-5">
                        {/* Connection Name */}
                        <div>
                            <label className="text-xs text-muted-foreground block mb-1.5">Connection Name *</label>
                            <input
                                type="text"
                                value={formData.name}
                                onChange={(e) => updateField("name", e.target.value)}
                                placeholder="My Database"
                                autoFocus
                                className="w-full h-9 rounded border bg-secondary/50 px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                            />
                        </div>

                        {/* Database Type */}
                        <div>
                            <label className="text-xs text-muted-foreground block mb-1.5">Database Type</label>
                            <div className="grid grid-cols-5 gap-1.5">
                                {(Object.keys(DB_TYPE_LABELS) as DatabaseType[]).map((type) => (
                                    <button
                                        key={type}
                                        onClick={() => handleTypeChange(type)}
                                        className={cn(
                                            "flex flex-col items-center gap-1 py-2.5 px-2 rounded border text-xs transition-colors",
                                            formData.type === type
                                                ? "border-ring bg-accent text-foreground"
                                                : "border-transparent bg-secondary/30 text-muted-foreground hover:bg-secondary/60"
                                        )}
                                    >
                                        <div
                                            className="w-3 h-3 rounded-full"
                                            style={{ backgroundColor: DB_TYPE_COLORS[type] }}
                                        />
                                        <span>{DB_TYPE_LABELS[type]}</span>
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Color Tag */}
                        <div>
                            <label className="text-xs text-muted-foreground block mb-1.5">Color Tag</label>
                            <div className="flex gap-2 items-center">
                                <input
                                    type="color"
                                    value={formData.color}
                                    onChange={(e) => updateField("color", e.target.value)}
                                    className="w-8 h-8 rounded border cursor-pointer bg-transparent"
                                />
                                <span className="text-xs text-muted-foreground">{formData.color}</span>
                            </div>
                        </div>

                        {isSqlite ? (
                            /* SQLite: File Path */
                            <div>
                                <label className="text-xs text-muted-foreground block mb-1.5">Database File Path</label>
                                <div className="flex gap-2">
                                    <input
                                        type="text"
                                        value={formData.filePath}
                                        onChange={(e) => updateField("filePath", e.target.value)}
                                        placeholder="/path/to/database.db"
                                        className="flex-1 h-9 rounded border bg-secondary/50 px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                                    />
                                    <button className="h-9 px-3 rounded border bg-secondary/50 text-muted-foreground hover:text-foreground text-xs">
                                        Browse
                                    </button>
                                </div>
                            </div>
                        ) : (
                            /* TCP: Host, Port, User, Password, Database */
                            <>
                                <div className="grid grid-cols-3 gap-3">
                                    <div className="col-span-2">
                                        <label className="text-xs text-muted-foreground block mb-1.5">Host</label>
                                        <input
                                            type="text"
                                            value={formData.host}
                                            onChange={(e) => updateField("host", e.target.value)}
                                            placeholder="localhost"
                                            className="w-full h-9 rounded border bg-secondary/50 px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                                        />
                                    </div>
                                    <div>
                                        <label className="text-xs text-muted-foreground block mb-1.5">Port</label>
                                        <input
                                            type="number"
                                            value={formData.port ?? ""}
                                            onChange={(e) => updateField("port", e.target.value ? Number(e.target.value) : undefined)}
                                            placeholder={String(DB_TYPE_DEFAULT_PORTS[formData.type] ?? "")}
                                            className="w-full h-9 rounded border bg-secondary/50 px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                                        />
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <label className="text-xs text-muted-foreground block mb-1.5">Username</label>
                                        <input
                                            type="text"
                                            value={formData.user}
                                            onChange={(e) => updateField("user", e.target.value)}
                                            placeholder="root"
                                            className="w-full h-9 rounded border bg-secondary/50 px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                                        />
                                    </div>
                                    <div>
                                        <label className="text-xs text-muted-foreground block mb-1.5">Password</label>
                                        <input
                                            type="password"
                                            value={formData.password}
                                            onChange={(e) => updateField("password", e.target.value)}
                                            placeholder="••••••••"
                                            className="w-full h-9 rounded border bg-secondary/50 px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                                        />
                                    </div>
                                </div>

                                <div>
                                    <label className="text-xs text-muted-foreground block mb-1.5">Database</label>
                                    <input
                                        type="text"
                                        value={formData.database}
                                        onChange={(e) => updateField("database", e.target.value)}
                                        placeholder="my_database"
                                        className="w-full h-9 rounded border bg-secondary/50 px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                                    />
                                </div>

                                {/* SSL Toggle */}
                                <div className="flex items-center gap-3">
                                    <button
                                        onClick={() => updateField("ssl", !formData.ssl)}
                                        className={cn(
                                            "relative w-9 h-5 rounded-full transition-colors",
                                            formData.ssl ? "bg-primary" : "bg-secondary"
                                        )}
                                    >
                                        <div
                                            className={cn(
                                                "absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform",
                                                formData.ssl ? "translate-x-4" : "translate-x-0.5"
                                            )}
                                        />
                                    </button>
                                    <span className="text-xs text-muted-foreground">Use SSL</span>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            </div>
        );
    }

    // ─── List View ────────────────────────────────────────────────────
    return (
        <div className="h-full flex bg-background">
            {/* Profile List (left) */}
            <div className="w-[280px] border-r flex flex-col shrink-0">
                {/* List header */}
                <div className="h-10 border-b flex items-center justify-between px-3 shrink-0">
                    <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Connections
                    </span>
                    <button
                        onClick={handleCreate}
                        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                        title="New Connection"
                    >
                        <Plus className="w-4 h-4" />
                    </button>
                </div>

                {/* Profile entries */}
                <div className="flex-1 overflow-y-auto">
                    {profiles.length === 0 ? (
                        <div className="p-6 text-center">
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
                        profiles.map((profile) => (
                            <button
                                key={profile.id}
                                onClick={() => setSelectedId(profile.id)}
                                onDoubleClick={() => handleDoubleClick(profile.id)}
                                className={cn(
                                    "w-full text-left px-3 py-2.5 border-b border-border/50 flex items-center gap-2.5 transition-colors group",
                                    selectedId === profile.id
                                        ? "bg-accent"
                                        : "hover:bg-accent/50"
                                )}
                            >
                                {/* Color dot + status */}
                                <div className="relative shrink-0">
                                    <div
                                        className="w-4 h-4 rounded"
                                        style={{ backgroundColor: profile.color }}
                                    />
                                    {profile.connectionStatus === "connected" && (
                                        <div className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-green-500 border border-background" />
                                    )}
                                    {profile.connectionStatus === "connecting" && (
                                        <div className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-yellow-500 border border-background animate-pulse" />
                                    )}
                                </div>

                                <div className="flex-1 min-w-0">
                                    <div className="text-sm font-medium truncate">{profile.name}</div>
                                    <div className="text-[10px] text-muted-foreground truncate">
                                        {profile.type === "sqlite"
                                            ? profile.filePath || "No file set"
                                            : `${profile.host}:${profile.port ?? "—"}`}
                                    </div>
                                </div>

                                <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/50 shrink-0" />
                            </button>
                        ))
                    )}
                </div>
            </div>

            {/* Detail Panel (right) */}
            <div className="flex-1 overflow-y-auto">
                {selectedProfile ? (
                    <div className="p-6 max-w-xl">
                        {/* Profile Header */}
                        <div className="flex items-start gap-4 mb-6">
                            <div
                                className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
                                style={{ backgroundColor: selectedProfile.color }}
                            >
                                {selectedProfile.type === "sqlite" ? (
                                    <Folder className="w-5 h-5 text-white/90" />
                                ) : (
                                    <Database className="w-5 h-5 text-white/90" />
                                )}
                            </div>
                            <div className="flex-1 min-w-0">
                                <h2 className="text-lg font-semibold truncate">{selectedProfile.name}</h2>
                                <p className="text-xs text-muted-foreground">
                                    {DB_TYPE_LABELS[selectedProfile.type]}
                                    {" · "}
                                    <span
                                        className={cn(
                                            selectedProfile.connectionStatus === "connected" && "text-green-400",
                                            selectedProfile.connectionStatus === "connecting" && "text-yellow-400",
                                            selectedProfile.connectionStatus === "error" && "text-red-400"
                                        )}
                                    >
                                        {selectedProfile.connectionStatus === "connected"
                                            ? "Connected"
                                            : selectedProfile.connectionStatus === "connecting"
                                                ? "Connecting…"
                                                : selectedProfile.connectionStatus === "error"
                                                    ? "Error"
                                                    : "Disconnected"}
                                    </span>
                                </p>
                            </div>
                        </div>

                        {/* Action buttons */}
                        <div className="flex gap-2 mb-6">
                            <button
                                onClick={() => handleConnect(selectedProfile.id)}
                                className={cn(
                                    "flex items-center gap-1.5 px-3 py-1.5 text-xs rounded transition-colors",
                                    selectedProfile.connectionStatus === "connected"
                                        ? "bg-red-900/30 text-red-400 border border-red-800/50 hover:bg-red-900/50"
                                        : "bg-primary text-primary-foreground hover:bg-primary/90"
                                )}
                            >
                                {selectedProfile.connectionStatus === "connected" ? (
                                    <><PlugZap className="w-3.5 h-3.5" /> Disconnect</>
                                ) : selectedProfile.connectionStatus === "connecting" ? (
                                    <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Connecting…</>
                                ) : (
                                    <><Plug className="w-3.5 h-3.5" /> Connect</>
                                )}
                            </button>
                            <button
                                onClick={() => handleEdit(selectedProfile)}
                                className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded border bg-secondary text-secondary-foreground hover:bg-secondary/80"
                            >
                                <Pencil className="w-3.5 h-3.5" /> Edit
                            </button>
                            <button
                                onClick={() => duplicateProfile(selectedProfile.id)}
                                className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded border bg-secondary text-secondary-foreground hover:bg-secondary/80"
                            >
                                <Copy className="w-3.5 h-3.5" /> Duplicate
                            </button>
                            <button
                                onClick={() => handleDelete(selectedProfile.id)}
                                className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded border border-red-800/30 text-red-400 hover:bg-red-900/20"
                            >
                                <Trash2 className="w-3.5 h-3.5" /> Delete
                            </button>
                        </div>

                        {/* Connection Error */}
                        {connectError && selectedProfile.connectionStatus === "error" && (
                            <div className="mb-4 px-3 py-2 rounded border border-red-800/40 bg-red-900/20 text-red-400 text-xs font-mono break-all">
                                {connectError}
                            </div>
                        )}

                        {/* Connection Details */}
                        <div className="border rounded-lg">
                            <div className="px-4 py-2 border-b">
                                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                    Connection Details
                                </span>
                            </div>
                            <div className="divide-y divide-border/50">
                                <DetailRow label="Type" value={DB_TYPE_LABELS[selectedProfile.type]} />
                                {selectedProfile.type === "sqlite" ? (
                                    <DetailRow label="File Path" value={selectedProfile.filePath || "—"} />
                                ) : (
                                    <>
                                        <DetailRow label="Host" value={selectedProfile.host || "—"} />
                                        <DetailRow label="Port" value={selectedProfile.port != null ? String(selectedProfile.port) : "—"} />
                                        <DetailRow label="Username" value={selectedProfile.user || "—"} />
                                        <DetailRow label="Password" value={selectedProfile.password ? "••••••••" : "—"} />
                                        <DetailRow label="Database" value={selectedProfile.database || "—"} />
                                        <DetailRow label="SSL" value={selectedProfile.ssl ? "Enabled" : "Disabled"} />
                                    </>
                                )}
                                {selectedProfile.lastConnectedAt && (
                                    <DetailRow
                                        label="Last Connected"
                                        value={new Date(selectedProfile.lastConnectedAt).toLocaleString()}
                                    />
                                )}
                                <DetailRow
                                    label="Created"
                                    value={new Date(selectedProfile.createdAt).toLocaleString()}
                                />
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="h-full flex items-center justify-center text-muted-foreground">
                        <div className="text-center">
                            <Database className="w-12 h-12 mx-auto mb-3 opacity-20" />
                            <p className="text-sm mb-1">No connection selected</p>
                            <p className="text-xs text-muted-foreground/60 mb-4">
                                Select a connection from the list or create a new one
                            </p>
                            <button
                                onClick={handleCreate}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded bg-primary text-primary-foreground hover:bg-primary/90"
                            >
                                <Plus className="w-3.5 h-3.5" />
                                New Connection
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

function DetailRow({ label, value }: { label: string; value: string }) {
    return (
        <div className="flex items-center px-4 py-2">
            <span className="text-xs text-muted-foreground w-28 shrink-0">{label}</span>
            <span className="text-sm font-mono truncate">{value}</span>
        </div>
    );
}
