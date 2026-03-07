import { useState } from "react";
import {
    useProfilesStore,
    DatabaseProfile,
    DatabaseType,
    ProfileFormData,
    DB_TYPE_COLORS,
    DB_TYPE_DEFAULT_PORTS,
    createDefaultFormData,
} from "@/state/profilesStore";
import { useSchemaStore } from "@/state/schemaStore";
import { useLayoutStore } from "@/state/layoutStore";
import { useAppStore } from "@/state/appStore";
import { dbConnect, dbDisconnect, dbListDatabases } from "@/lib/db";

export type ViewMode = "list" | "create" | "edit";

/**
 * Shared profile management hook used by ServersSidebar (and any future
 * profile-editing UI). Encapsulates CRUD, connection toggle, form state,
 * and database pre-loading so no component needs to duplicate this logic.
 */
export function useProfileManager() {
    const {
        profiles,
        addProfile,
        updateProfile,
        deleteProfile,
        duplicateProfile,
        setConnectionStatus,
    } = useProfilesStore();
    const addConnection = useSchemaStore((s) => s.addConnection);
    const removeConnection = useSchemaStore((s) => s.removeConnection);
    const setActiveView = useLayoutStore((s) => s.setActiveView);

    const [viewMode, setViewMode] = useState<ViewMode>("list");
    const [editingId, setEditingId] = useState<string | null>(null);
    const [formData, setFormData] = useState<ProfileFormData>(
        createDefaultFormData(),
    );

    // ── CRUD ──────────────────────────────────────────────

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
        try {
            await dbDisconnect(id);
        } catch {
            /* ignore */
        }
        removeConnection(id);
        deleteProfile(id);
    };

    // ── Connection ────────────────────────────────────────

    const handleConnect = async (id: string) => {
        const profile = profiles.find((p) => p.id === id);
        if (!profile) return;

        if (profile.type !== "mysql" && profile.type !== "mariadb") {
            setConnectionStatus(id, "error");
            useAppStore.getState().addToast({
                title: "Connection Failed",
                description: "Only MySQL and MariaDB are supported in this version.",
                variant: "destructive",
            });
            return;
        }

        if (profile.connectionStatus === "connected") {
            try {
                await dbDisconnect(id);
            } catch {
                /* ignore */
            }
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
                    db_type: profile.type,
                });
                setConnectionStatus(id, "connected");
                addConnection(id, profile.name, profile.color);
                // Pre-load database list so Explorer is ready on arrival
                const schemaStore = useSchemaStore.getState();
                schemaStore.setLoading(id, "databases", true);
                try {
                    const dbs = await dbListDatabases(id);
                    schemaStore.setDatabases(id, dbs);
                } catch {
                    /* non-fatal */
                } finally {
                    schemaStore.setLoading(id, "databases", false);
                }
                setActiveView("explorer");
            } catch (e) {
                setConnectionStatus(id, "error");
                useAppStore.getState().addToast({
                    title: "Connection Failed",
                    description: String(e),
                    variant: "destructive",
                });
            }
        }
    };

    const handleDoubleClick = async (id: string) => {
        const profile = profiles.find((p) => p.id === id);
        if (!profile) return;

        if (profile.connectionStatus === "connected") {
            setActiveView("explorer");
        } else {
            handleConnect(id);
        }
    };

    // ── Form helpers ──────────────────────────────────────

    const handleTypeChange = (type: DatabaseType) => {
        setFormData((prev) => ({
            ...prev,
            type,
            color: DB_TYPE_COLORS[type],
            port: DB_TYPE_DEFAULT_PORTS[type],
            host: type === "sqlite" ? "" : prev.host || "localhost",
        }));
    };

    const updateField = <K extends keyof ProfileFormData>(
        key: K,
        value: ProfileFormData[K],
    ) => {
        setFormData((prev) => ({ ...prev, [key]: value }));
    };

    return {
        // State
        profiles,
        viewMode,
        editingId,
        formData,

        // CRUD
        handleCreate,
        handleEdit,
        handleSave,
        handleCancel,
        handleDelete,
        duplicateProfile,

        // Connection
        handleConnect,
        handleDoubleClick,

        // Form
        handleTypeChange,
        updateField,
    };
}
