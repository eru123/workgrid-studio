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
    Plus,
    Trash2,
    Copy,
    Pencil,
    Plug,
    PlugZap,
    X,
    ChevronRight,
    Server,
    Loader2,
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
    const [expandedId, setExpandedId] = useState<string | null>(null);
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
            addProfile(formData);
        }
        setViewMode("list");
    };

    const handleCancel = () => {
        setViewMode("list");
        setEditingId(null);
    };

    const handleDelete = async (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        try { await dbDisconnect(id); } catch { /* ignore */ }
        removeConnection(id);
        deleteProfile(id);
        if (expandedId === id) setExpandedId(null);
    };

    const handleConnect = async (id: string, e?: React.MouseEvent) => {
        if (e) e.stopPropagation();
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
                setExpandedId(id); // Show error inside the expanded card
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

    const toggleExpand = (id: string) => {
        setExpandedId(prev => prev === id ? null : id);
        setConnectError(null); // Clear errors when toggling
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
                        const isExpanded = expandedId === profile.id;

                        return (
                            <div
                                key={profile.id}
                                className={cn(
                                    "flex flex-col rounded border overflow-hidden transition-all",
                                    isExpanded ? "border-primary/50 bg-accent/30" : "border-border/40 hover:border-border/80 bg-background"
                                )}
                            >
                                <button
                                    onClick={() => toggleExpand(profile.id)}
                                    onDoubleClick={() => handleDoubleClick(profile.id)}
                                    className="w-full text-left px-3 py-2.5 flex items-center gap-2.5 transition-colors group relative"
                                    title="Double click to connect"
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
                                        {profile.connectionStatus === "error" && (
                                            <div className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-red-500 border border-background" />
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

                                    <div className="shrink-0 text-muted-foreground/50 transition-transform">
                                        {profile.connectionStatus === "connected" ? (
                                            <button
                                                onClick={(e) => { e.stopPropagation(); handleConnect(profile.id); }}
                                                title="Disconnect"
                                                className="w-6 h-6 flex items-center justify-center rounded hover:bg-red-500/20 hover:text-red-500 transition-colors"
                                            >
                                                <PlugZap className="w-3.5 h-3.5" />
                                            </button>
                                        ) : profile.connectionStatus === "connecting" ? (
                                            <Loader2 className="w-3.5 h-3.5 animate-spin mx-1" />
                                        ) : (
                                            <button
                                                onClick={(e) => { e.stopPropagation(); handleConnect(profile.id); }}
                                                title="Connect"
                                                className="w-6 h-6 flex items-center justify-center rounded hover:bg-primary/20 hover:text-primary transition-colors"
                                            >
                                                <Plug className="w-3.5 h-3.5" />
                                            </button>
                                        )}
                                    </div>

                                    <ChevronRight className={cn(
                                        "w-3.5 h-3.5 text-muted-foreground/50 transition-transform shrink-0 ml-1.5",
                                        isExpanded && "rotate-90"
                                    )} />
                                </button>

                                {/* Expanded Actions */}
                                {isExpanded && (
                                    <div className="px-3 pb-3 pt-1 border-t border-border/50 bg-accent/10">
                                        {/* Action buttons */}
                                        <div className="grid grid-cols-3 gap-1.5 mb-2 mt-2">
                                            <button
                                                onClick={() => handleEdit(profile)}
                                                className="flex flex-col items-center justify-center gap-1 py-1.5 text-[10px] rounded border bg-background hover:bg-accent hover:text-foreground text-muted-foreground transition-colors"
                                            >
                                                <Pencil className="w-3.5 h-3.5" /> Edit
                                            </button>
                                            <button
                                                onClick={() => duplicateProfile(profile.id)}
                                                className="flex flex-col items-center justify-center gap-1 py-1.5 text-[10px] rounded border bg-background hover:bg-accent hover:text-foreground text-muted-foreground transition-colors"
                                            >
                                                <Copy className="w-3.5 h-3.5" /> Duplicate
                                            </button>
                                            <button
                                                onClick={(e) => handleDelete(profile.id, e)}
                                                className="flex flex-col items-center justify-center gap-1 py-1.5 text-[10px] rounded border border-red-800/30 text-red-500/80 hover:bg-red-900/20 hover:text-red-400 transition-colors"
                                            >
                                                <Trash2 className="w-3.5 h-3.5" /> Delete
                                            </button>
                                        </div>

                                        {/* Connection Error */}
                                        {connectError && profile.connectionStatus === "error" && (
                                            <div className="mt-2 px-2 py-1.5 rounded bg-red-900/20 border border-red-800/40 text-[10px] text-red-400 font-mono break-all line-clamp-3 overflow-hidden">
                                                {connectError}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        );
                    })
                )}
            </div>

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
