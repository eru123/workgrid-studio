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
import { dbCancelConnect, dbConnect, dbDisconnect } from "@/lib/db";
import {
    appendConnectionOutput,
    formatConnectionTarget,
    formatOutputError,
} from "@/lib/output";

export type ViewMode = "list" | "create" | "edit";

interface HandleConnectOptions {
    silentFailureToast?: boolean;
    reconnectAttempt?: number;
}

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
            useDocker: profile.useDocker ?? false,
            dockerContainer: profile.dockerContainer ?? "",
            connectionVerboseLogging: profile.connectionVerboseLogging ?? false,
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

    const handleConnect = async (
        id: string,
        options: HandleConnectOptions = {},
    ) => {
        const profile = useProfilesStore.getState().profiles.find((p) => p.id === id);
        if (!profile) return;
        const target = formatConnectionTarget(profile);
        const { silentFailureToast = false, reconnectAttempt } = options;

        if (profile.unreadableSecrets?.password) {
            setConnectionStatus(id, "error");
            appendConnectionOutput(
                profile,
                "error",
                `Stored password for ${target} could not be decrypted. Re-enter the password in the profile and save it again before connecting.`,
            );
            if (!silentFailureToast) {
                useAppStore.getState().addToast({
                    title: "Stored Password Unavailable",
                    description: "This profile's saved password could not be decrypted. Re-enter it and save the profile again.",
                    variant: "destructive",
                });
            }
            return;
        }

        if (
            profile.ssh &&
            (profile.unreadableSecrets?.sshPassword || profile.unreadableSecrets?.sshPassphrase)
        ) {
            setConnectionStatus(id, "error");
            appendConnectionOutput(
                profile,
                "error",
                `Stored SSH credentials for ${target} could not be decrypted. Re-enter the SSH secret in the profile and save it again before connecting.`,
            );
            if (!silentFailureToast) {
                useAppStore.getState().addToast({
                    title: "Stored SSH Secret Unavailable",
                    description: "This profile's saved SSH credential could not be decrypted. Re-enter it and save the profile again.",
                    variant: "destructive",
                });
            }
            return;
        }

        if (profile.type !== "mysql" && profile.type !== "mariadb") {
            setConnectionStatus(id, "error");
            appendConnectionOutput(
                profile,
                "error",
                `Connection blocked for ${target}: only MySQL and MariaDB are supported in this version.`,
            );
            if (!silentFailureToast) {
                useAppStore.getState().addToast({
                    title: "Connection Failed",
                    description: "Only MySQL and MariaDB are supported in this version.",
                    variant: "destructive",
                });
            }
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
                reconnectAttempt
                    ? `Reconnecting to ${target} (attempt ${reconnectAttempt})...`
                    : `Connecting to ${target}...`,
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
                    use_docker: profile.useDocker ?? false,
                    docker_container: profile.dockerContainer || null,
                    connection_verbose_logging: profile.connectionVerboseLogging ?? false,
                });
                setConnectionStatus(id, "connected");
                appendConnectionOutput(
                    profile,
                    "success",
                    reconnectAttempt
                        ? `Reconnected to ${target} on attempt ${reconnectAttempt}.`
                        : `Connected to ${target}.`,
                );
                addConnection(id, profile.name, profile.color);
                setActiveView("explorer");
            } catch (e) {
                const errorMsg = formatOutputError(e);
                const wasCancelled = errorMsg.includes("Connection cancelled");
                setConnectionStatus(id, wasCancelled ? "disconnected" : "error");
                if (wasCancelled) {
                    appendConnectionOutput(
                        profile,
                        "info",
                        `Connection to ${target} was cancelled.`,
                    );
                } else {
                    appendConnectionOutput(
                        profile,
                        "error",
                        reconnectAttempt
                            ? `Reconnect attempt ${reconnectAttempt} failed for ${target}: ${errorMsg}`
                            : `Connection failed for ${target}: ${errorMsg}`,
                    );
                    if (!silentFailureToast) {
                        useAppStore.getState().addToast({
                            title: "Connection Failed",
                            description: String(e),
                            variant: "destructive",
                        });
                    }
                }
            }
        }
    };

    const handleCancelConnect = async (id: string) => {
        const profile = useProfilesStore.getState().profiles.find((p) => p.id === id);
        if (!profile || profile.connectionStatus !== "connecting") return;
        try {
            await dbCancelConnect(id);
        } catch {
            // ignore — the connect attempt will time out on its own
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
        handleCancelConnect,
        handleDoubleClick,

        // Form
        handleTypeChange,
        updateField,
    };
}
