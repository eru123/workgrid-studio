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
import {
    appendConnectionOutput,
    formatConnectionTarget,
    formatOutputError,
} from "@/lib/output";

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
            sslCaFile: profile.sslCaFile,
            sslCertFile: profile.sslCertFile,
            sslKeyFile: profile.sslKeyFile,
            sslRejectUnauthorized: profile.sslRejectUnauthorized,
            ssh: profile.ssh,
            sshHost: profile.sshHost,
            sshPort: profile.sshPort,
            sshUser: profile.sshUser,
            sshPassword: profile.sshPassword,
            sshKeyFile: profile.sshKeyFile,
            sshPassphrase: profile.sshPassphrase,
            sshStrictKeyChecking: profile.sshStrictKeyChecking ?? false,
            sshKeepAliveInterval: profile.sshKeepAliveInterval ?? 0,
            sshCompression: profile.sshCompression ?? true,
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
        const profile = useProfilesStore.getState().profiles.find((p) => p.id === id);
        const shouldDisconnect = profile?.connectionStatus === "connected"
            || profile?.connectionStatus === "connecting";

        if (shouldDisconnect && profile) {
            appendConnectionOutput(
                profile,
                "info",
                `Disconnecting before deleting profile from ${formatConnectionTarget(profile)}...`,
            );
            try {
                await dbDisconnect(id);
                appendConnectionOutput(
                    profile,
                    "success",
                    `Disconnected from ${formatConnectionTarget(profile)}.`,
                );
            } catch (e) {
                appendConnectionOutput(
                    profile,
                    "warning",
                    `Disconnect before delete reported an error for ${formatConnectionTarget(profile)}: ${formatOutputError(e)}`,
                );
            }
        }
        removeConnection(id);
        deleteProfile(id);
    };

    // ── Connection ────────────────────────────────────────

    const handleConnect = async (id: string) => {
        const profile = useProfilesStore.getState().profiles.find((p) => p.id === id);
        if (!profile) return;
        const target = formatConnectionTarget(profile);

        if (profile.type !== "mysql" && profile.type !== "mariadb") {
            setConnectionStatus(id, "error");
            appendConnectionOutput(
                profile,
                "error",
                `Connection blocked for ${target}: only MySQL and MariaDB are supported in this version.`,
            );
            useAppStore.getState().addToast({
                title: "Connection Failed",
                description: "Only MySQL and MariaDB are supported in this version.",
                variant: "destructive",
            });
            return;
        }

        if (profile.connectionStatus === "connected") {
            appendConnectionOutput(
                profile,
                "info",
                `Disconnecting from ${target}...`,
            );
            try {
                await dbDisconnect(id);
                appendConnectionOutput(
                    profile,
                    "success",
                    `Disconnected from ${target}.`,
                );
            } catch (e) {
                appendConnectionOutput(
                    profile,
                    "warning",
                    `Disconnect failed for ${target}: ${formatOutputError(e)}`,
                );
            }
            setConnectionStatus(id, "disconnected");
            removeConnection(id);
        } else {
            setConnectionStatus(id, "connecting");
            appendConnectionOutput(
                profile,
                "info",
                `Connecting to ${target}...`,
            );
            try {
                await dbConnect({
                    profile_id: id,
                    host: profile.host,
                    port: profile.port ?? 3306,
                    user: profile.user,
                    password: profile.password,
                    database: profile.database || null,
                    ssl: profile.ssl,
                    ssl_ca_file: profile.sslCaFile || null,
                    ssl_cert_file: profile.sslCertFile || null,
                    ssl_key_file: profile.sslKeyFile || null,
                    ssl_reject_unauthorized: profile.sslRejectUnauthorized ?? false,
                    db_type: profile.type,
                    ssh: profile.ssh,
                    ssh_host: profile.sshHost || "",
                    ssh_port: profile.sshPort || 22,
                    ssh_user: profile.sshUser || "",
                    ssh_password: profile.sshPassword || null,
                    ssh_key_file: profile.sshKeyFile || null,
                    ssh_passphrase: profile.sshPassphrase || null,
                    ssh_strict_key_checking: profile.sshStrictKeyChecking ?? false,
                    ssh_keep_alive_interval: profile.sshKeepAliveInterval ?? 0,
                    ssh_compression: profile.sshCompression ?? true,
                });
                setConnectionStatus(id, "connected");
                appendConnectionOutput(
                    profile,
                    "success",
                    `Connected to ${target}.`,
                );
                addConnection(id, profile.name, profile.color);
                // Pre-load database list so Explorer is ready on arrival
                const schemaStore = useSchemaStore.getState();
                schemaStore.setLoading(id, "databases", true);
                try {
                    const dbs = await dbListDatabases(id);
                    schemaStore.setDatabases(id, dbs);
                } catch (e) {
                    appendConnectionOutput(
                        profile,
                        "warning",
                        `Connected to ${target}, but database preload failed: ${formatOutputError(e)}`,
                    );
                } finally {
                    schemaStore.setLoading(id, "databases", false);
                }
                setActiveView("explorer");
            } catch (e) {
                setConnectionStatus(id, "error");
                appendConnectionOutput(
                    profile,
                    "error",
                    `Connection failed for ${target}: ${formatOutputError(e)}`,
                );
                useAppStore.getState().addToast({
                    title: "Connection Failed",
                    description: String(e),
                    variant: "destructive",
                });
            }
        }
    };

    const handleDoubleClick = async (id: string) => {
        const profile = useProfilesStore.getState().profiles.find((p) => p.id === id);
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
