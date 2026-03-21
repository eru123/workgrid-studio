import { useState, useEffect, useMemo } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { homeDir, join } from "@tauri-apps/api/path";
import { dbConnect, dbDisconnect, dbForgetHostKey, dbPing } from "@/lib/db";
import {
  MariadbIcon,
  MysqlIcon,
  PostgresIcon,
  SqliteIcon,
} from "@/components/icons/DatabaseTypeIcons";
import {
  DatabaseType,
  DB_TYPE_LABELS,
  DB_TYPE_COLORS,
  DB_TYPE_DEFAULT_PORTS,
} from "@/state/profilesStore";
import { useProfileManager } from "@/hooks/useProfileManager";
import { useProfilesStore } from "@/state/profilesStore";
import { useSchemaStore } from "@/state/schemaStore";
import { notifyError, notifySuccess } from "@/lib/notifications";
import { ProfileListSkeleton } from "@/components/ui/Skeleton";
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
  Database,
  ShieldCheck,
  Key,
} from "lucide-react";
import { TreeView, type TreeNode, type ContextMenuItem } from "@/components/ui/TreeView";

const DB_ICONS: Record<DatabaseType, React.ElementType> = {
  postgres: PostgresIcon,
  mysql: MysqlIcon,
  sqlite: SqliteIcon,
  mariadb: MariadbIcon,
  mssql: Database,
};

function getConnectionStatusMeta(status?: string) {
  switch (status) {
    case "connected":
      return {
        label: "Connected",
        dotClassName: "bg-green-500",
        badgeClassName: "text-green-400 bg-green-500/10",
      };
    case "connecting":
      return {
        label: "Connecting",
        dotClassName: "bg-yellow-500",
        badgeClassName: "text-yellow-400 bg-yellow-500/10",
      };
    case "error":
      return {
        label: "Error",
        dotClassName: "bg-red-500",
        badgeClassName: "text-red-400 bg-red-500/10",
      };
    default:
      return {
        label: "Disconnected",
        dotClassName: "bg-muted-foreground/50",
        badgeClassName: "text-muted-foreground bg-muted/50",
      };
  }
}

export function ServersSidebar() {
  const isLoaded = useProfilesStore((s) => s._loaded);
  const latencies = useSchemaStore((s) => s.latencies);
  const serverVersions = useSchemaStore((s) => s.serverVersions);
  const {
    profiles,
    viewMode,
    editingId,
    formData,
    handleCreate,
    handleEdit,
    handleSave,
    handleCancel,
    handleDelete,
    handleConnect,
    handleCancelConnect,
    handleDoubleClick,
    handleTypeChange,
    updateField,
    duplicateProfile,
  } = useProfileManager();

  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const [testConnectionResult, setTestConnectionResult] = useState<{
    tone: "success" | "error";
    message: string;
  } | null>(null);

  const isSqlite = formData.type === "sqlite";

  useEffect(() => {
    setTestConnectionResult(null);
  }, [editingId, formData.type, viewMode]);

  const handleTestConnection = async () => {
    if (formData.type !== "mysql" && formData.type !== "mariadb") {
      const message = "Test Connection currently supports MySQL and MariaDB profiles.";
      setTestConnectionResult({ tone: "error", message });
      notifyError("Test Connection Unavailable", message);
      return;
    }

    setIsTestingConnection(true);
    setTestConnectionResult(null);

    const editingProfile = editingId
      ? profiles.find((profile) => profile.id === editingId)
      : null;
    const testProfileId =
      editingId &&
      editingProfile &&
      editingProfile.connectionStatus !== "connected" &&
      editingProfile.connectionStatus !== "connecting"
        ? editingId
        : `test-${crypto.randomUUID()}`;

    try {
      await dbConnect({
        profile_id: testProfileId,
        host: formData.host,
        port: formData.port ?? DB_TYPE_DEFAULT_PORTS[formData.type] ?? 3306,
        user: formData.user,
        password: formData.password,
        database: formData.database || null,
        ssl: formData.ssl,
        ssl_ca_file: formData.sslCaFile || null,
        ssl_cert_file: formData.sslCertFile || null,
        ssl_key_file: formData.sslKeyFile || null,
        ssl_reject_unauthorized: formData.sslRejectUnauthorized ?? false,
        db_type: formData.type,
        ssh: formData.ssh,
        ssh_host: formData.sshHost || "",
        ssh_port: formData.sshPort || 22,
        ssh_user: formData.sshUser || "",
        ssh_password: formData.sshPassword || null,
        ssh_key_file: formData.sshKeyFile || null,
        ssh_passphrase: formData.sshPassphrase || null,
        ssh_strict_key_checking: formData.sshStrictKeyChecking ?? false,
        ssh_keep_alive_interval: formData.sshKeepAliveInterval ?? 0,
        ssh_compression: formData.sshCompression ?? true,
        use_docker: formData.useDocker ?? false,
        docker_container: formData.dockerContainer || null,
        connection_verbose_logging: formData.connectionVerboseLogging ?? false,
      });

      const latency = await dbPing(testProfileId);
      const message = `Connected successfully in ${latency}ms.`;
      setTestConnectionResult({ tone: "success", message });
      notifySuccess("Connection Test Passed", message);
    } catch (error) {
      const message = String(error);
      setTestConnectionResult({ tone: "error", message });
      notifyError("Connection Test Failed", message);
    } finally {
      try {
        await dbDisconnect(testProfileId);
      } catch {
        // Best-effort cleanup for temporary test connections.
      }
      setIsTestingConnection(false);
    }
  };

  const profileNodes = useMemo<TreeNode[]>(() => profiles.map((profile) => {
    const Icon = DB_ICONS[profile.type];
    const statusMeta = getConnectionStatusMeta(profile.connectionStatus);
    const latency = latencies[profile.id] ?? null;
    const serverVersion = serverVersions[profile.id] ?? null;
    const connectionTarget = profile.type === "sqlite"
      ? (profile.filePath || "No file set")
      : `${profile.host}:${profile.port ?? "—"}`;
    const isConnected = profile.connectionStatus === "connected";
    const isConnecting = profile.connectionStatus === "connecting";

    const contextMenu: ContextMenuItem[] = [
      {
        label: isConnected ? "Disconnect" : "Connect",
        icon: isConnected
          ? <PlugZap className="w-3.5 h-3.5 text-red-400" />
          : <Plug className="w-3.5 h-3.5 text-primary" />,
        onClick: () => handleConnect(profile.id),
      },
      {
        label: "Edit",
        icon: <Pencil className="w-3.5 h-3.5" />,
        onClick: () => handleEdit(profile),
      },
      {
        label: "Duplicate",
        icon: <Copy className="w-3.5 h-3.5" />,
        onClick: () => duplicateProfile(profile.id),
      },
      { label: "", separator: true, onClick: () => {} },
      {
        label: "Delete",
        icon: <Trash2 className="w-3.5 h-3.5" />,
        onClick: () => handleDelete(profile.id),
        danger: true,
      },
    ];

    const suffix = (
      <div className="flex items-center gap-0.5">
        <span className="text-[10px] text-muted-foreground font-mono max-w-[72px] truncate mr-0.5">
          {serverVersion ?? connectionTarget}
        </span>
        {isConnected && latency !== null && (
          <span className={cn(
            "shrink-0 rounded-full px-1 text-[9px] font-mono leading-4",
            latency === -1
              ? "bg-red-500/10 text-red-400"
              : latency > 200
                ? "bg-amber-500/10 text-amber-400"
                : "bg-primary/10 text-primary",
          )}>
            {latency === -1 ? "err" : `${latency}ms`}
          </span>
        )}
        {isConnected ? (
          <button
            onClick={(e) => { e.stopPropagation(); handleConnect(profile.id); }}
            title="Disconnect"
            className="w-5 h-5 flex items-center justify-center rounded hover:bg-red-500/20 hover:text-red-500 transition-colors"
          >
            <PlugZap className="w-3 h-3" />
          </button>
        ) : isConnecting ? (
          <button
            onClick={(e) => { e.stopPropagation(); handleCancelConnect(profile.id); }}
            title="Cancel"
            className="w-5 h-5 flex items-center justify-center rounded hover:bg-red-500/20 hover:text-red-500 transition-colors"
          >
            <Loader2 className="w-3 h-3 animate-spin" />
          </button>
        ) : (
          <button
            onClick={(e) => { e.stopPropagation(); handleConnect(profile.id); }}
            title="Connect"
            className="w-5 h-5 flex items-center justify-center rounded hover:bg-primary/20 hover:text-primary transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100"
          >
            <Plug className="w-3 h-3" />
          </button>
        )}
      </div>
    );

    return {
      id: profile.id,
      label: profile.name,
      icon: (
        <div className="relative w-3.5 h-3.5 flex items-center justify-center">
          <Icon className="w-3.5 h-3.5" style={{ color: DB_TYPE_COLORS[profile.type] }} />
          <div className={cn(
            "absolute -bottom-0.5 -right-0.5 h-1.5 w-1.5 rounded-full border border-background",
            statusMeta.dotClassName,
            isConnecting && "animate-pulse",
          )} />
        </div>
      ),
      suffix,
      contextMenu,
      data: profile,
    };
  }), [profiles, latencies, serverVersions, handleConnect, handleCancelConnect, handleEdit, duplicateProfile, handleDelete]);

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
          aria-label="New Connection"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>

      {/* List View */}
      <div className="flex-1 overflow-y-auto w-full">
        {!isLoaded ? (
          <div className="p-2"><ProfileListSkeleton /></div>
        ) : profiles.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-6 pt-10 text-center select-none gap-3">
            <div className="relative w-16 h-16 mx-auto">
              <div className="absolute inset-0 rounded-2xl bg-muted/40 border border-border/30" />
              <Server className="absolute inset-0 m-auto w-8 h-8 text-muted-foreground/25" />
              <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center">
                <Plus className="w-3.5 h-3.5 text-primary/60" />
              </div>
            </div>
            <div>
              <p className="text-xs font-semibold text-foreground/70 mb-1">No connections yet</p>
              <p className="text-[10px] text-muted-foreground/60 leading-relaxed max-w-[160px]">
                Add your first database connection to get started.
              </p>
            </div>
            <button
              onClick={handleCreate}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded bg-primary text-primary-foreground hover:bg-primary/90"
            >
              <Plus className="w-3.5 h-3.5" />
              New Connection
            </button>
          </div>
        ) : (
          <TreeView
            nodes={profileNodes}
            onActivate={(node) => handleDoubleClick(node.id)}
            className="p-1"
          />
        )}
      </div>

      {/* Modal Form overlay rendered absolutely within the sidebar / screen */}
      {
        viewMode !== "list" && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4">
            <div className="w-full max-w-lg bg-card border shadow-2xl rounded-xl flex flex-col max-h-full overflow-hidden animate-in fade-in zoom-in-95 duration-200">
              {/* Modal Header */}
              <div className="h-12 border-b flex items-center justify-between px-5 shrink-0 bg-muted/40">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold">
                    {viewMode === "edit" ? "Edit Connection" : "New Connection"}
                  </span>
                </div>
                <button
                  onClick={handleCancel}
                  className="text-muted-foreground hover:text-foreground rounded-full p-1 hover:bg-accent transition-colors"
                  aria-label="Close connection form"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Modal Body */}
              <div className="flex-1 overflow-y-auto p-5 space-y-5">
                {/* Connection Name */}
                <div>
                  <label className="text-xs font-semibold block mb-1.5">
                    Connection Name *
                  </label>
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
                  <label className="text-xs font-semibold block mb-1.5">
                    Database Type
                  </label>
                  <div className="grid grid-cols-5 gap-2">
                    {(Object.keys(DB_TYPE_LABELS) as DatabaseType[]).map(
                      (type) => {
                        const Icon = DB_ICONS[type];
                        const isSupported =
                          type === "mysql" || type === "mariadb";
                        return (
                          <button
                            key={type}
                            onClick={() => handleTypeChange(type)}
                            className={cn(
                              "flex flex-col items-center gap-1.5 py-3 px-1 rounded-md border text-xs transition-all relative overflow-hidden",
                              formData.type === type
                                ? "border-primary bg-primary/10 text-primary"
                                : "border-border bg-secondary/30 text-muted-foreground hover:bg-secondary/80 hover:text-foreground",
                              !isSupported && "opacity-70",
                            )}
                          >
                            {!isSupported && (
                              <div className="absolute -top-[10px] -right-[14px] bg-red-500/80 text-white text-[8px] font-bold px-4 py-1.5 transform rotate-45 scale-75">
                                SOON
                              </div>
                            )}
                            <Icon
                              className="w-4 h-4"
                              style={{
                                color:
                                  formData.type === type
                                    ? DB_TYPE_COLORS[type]
                                    : undefined,
                              }}
                            />
                            <span>{DB_TYPE_LABELS[type]}</span>
                          </button>
                        );
                      },
                    )}
                  </div>
                </div>

                {/* Color Tag */}
                <div>
                  <label className="text-xs font-semibold block mb-1.5">
                    Color Tag
                  </label>
                  <div className="flex gap-2 items-center">
                    <input
                      type="color"
                      value={formData.color}
                      onChange={(e) => updateField("color", e.target.value)}
                      className="w-8 h-8 rounded border cursor-pointer border-border bg-background p-0.5"
                    />
                    <span className="text-xs font-mono text-muted-foreground uppercase">
                      {formData.color}
                    </span>
                  </div>
                </div>

                {isSqlite ? (
                  /* SQLite: File Path */
                  <div>
                    <label className="text-xs font-semibold block mb-1.5">
                      Database File Path
                    </label>
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
                        <label className="text-xs font-medium text-muted-foreground block mb-1.5">
                          Hostname
                        </label>
                        <input
                          type="text"
                          value={formData.host}
                          onChange={(e) => updateField("host", e.target.value)}
                          placeholder="localhost"
                          className="w-full h-9 rounded-md border bg-secondary/50 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
                        />
                      </div>
                      <div>
                        <label className="text-xs font-medium text-muted-foreground block mb-1.5">
                          Port
                        </label>
                        <input
                          type="number"
                          value={formData.port ?? ""}
                          onChange={(e) =>
                            updateField(
                              "port",
                              e.target.value ? Number(e.target.value) : undefined,
                            )
                          }
                          placeholder={String(
                            DB_TYPE_DEFAULT_PORTS[formData.type] ?? "",
                          )}
                          className="w-full h-9 rounded-md border bg-secondary/50 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs font-medium text-muted-foreground block mb-1.5">
                          Username
                        </label>
                        <input
                          type="text"
                          value={formData.user}
                          onChange={(e) => updateField("user", e.target.value)}
                          placeholder="root"
                          className="w-full h-9 rounded-md border bg-secondary/50 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
                        />
                      </div>
                      <div>
                        <label className="text-xs font-medium text-muted-foreground block mb-1.5">
                          Password
                        </label>
                        <input
                          type="password"
                          value={formData.password}
                          onChange={(e) =>
                            updateField("password", e.target.value)
                          }
                          placeholder="••••••••"
                          className="w-full h-9 rounded-md border bg-secondary/50 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="text-xs font-medium text-muted-foreground block mb-1.5">
                        Default Database (Optional)
                      </label>
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
                          formData.ssl ? "bg-primary" : "bg-secondary",
                        )}
                      >
                        <div
                          className={cn(
                            "absolute top-[2px] w-4 h-4 rounded-full bg-white transition-transform shadow-sm",
                            formData.ssl
                              ? "translate-x-[22px]"
                              : "translate-x-[2px]",
                          )}
                        />
                      </button>
                      <span className="text-xs font-medium">
                        Use SSL Protocol
                      </span>
                    </div>

                    {/* Extended SSL Fields */}
                    {formData.ssl && (
                      <div className="space-y-3 pt-2 border-t mt-3 border-border/50">
                        {/* Reject Unauthorized Toggle */}
                        <div className="flex items-center gap-3 pb-1">
                          <button
                            onClick={() =>
                              updateField(
                                "sslRejectUnauthorized",
                                !formData.sslRejectUnauthorized,
                              )
                            }
                            className={cn(
                              "relative w-10 h-5 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-background space-x-0 ring-primary/50",
                              formData.sslRejectUnauthorized
                                ? "bg-primary"
                                : "bg-secondary",
                            )}
                          >
                            <div
                              className={cn(
                                "absolute top-[2px] w-4 h-4 rounded-full bg-white transition-transform shadow-sm",
                                formData.sslRejectUnauthorized
                                  ? "translate-x-[22px]"
                                  : "translate-x-[2px]",
                              )}
                            />
                          </button>
                          <span className="text-xs font-medium">
                            Reject Unauthorized (Strict Validation)
                          </span>
                        </div>

                        {/* CA Certificate */}
                        <div>
                          <label className="text-xs font-medium text-muted-foreground block mb-1.5">
                            CA Certificate (.pem, .crt)
                          </label>
                          <div className="flex gap-2">
                            <input
                              type="text"
                              value={formData.sslCaFile || ""}
                              onChange={(e) =>
                                updateField("sslCaFile", e.target.value)
                              }
                              placeholder="/path/to/ca.pem"
                              className="flex-1 h-9 rounded-md border bg-secondary/50 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all font-mono"
                            />
                            <button
                              onClick={async () => {
                                const selected = await open({
                                  multiple: false,
                                  directory: false,
                                  defaultPath: await homeDir(),
                                  filters: [{ name: "Certificate", extensions: ["pem", "crt"] }],
                                });
                                if (typeof selected === "string") {
                                  updateField("sslCaFile", selected);
                                }
                              }}
                              className="h-9 px-3 rounded-md border bg-secondary font-medium hover:bg-secondary/80 hover:text-foreground text-xs transition-all"
                            >
                              Browse
                            </button>
                            {formData.sslCaFile && (
                              <button
                                onClick={() => updateField("sslCaFile", undefined)}
                                className="h-9 px-2 text-muted-foreground hover:text-red-500 rounded-md hover:bg-red-500/10 transition-colors"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Client Certificate */}
                        <div>
                          <label className="text-xs font-medium text-muted-foreground block mb-1.5">
                            Client Certificate (.pem, .crt)
                          </label>
                          <div className="flex gap-2">
                            <input
                              type="text"
                              value={formData.sslCertFile || ""}
                              onChange={(e) =>
                                updateField("sslCertFile", e.target.value)
                              }
                              placeholder="/path/to/client-cert.pem"
                              className="flex-1 h-9 rounded-md border bg-secondary/50 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all font-mono"
                            />
                            <button
                              onClick={async () => {
                                const selected = await open({
                                  multiple: false,
                                  directory: false,
                                  defaultPath: await homeDir(),
                                  filters: [{ name: "Certificate", extensions: ["pem", "crt"] }],
                                });
                                if (typeof selected === "string") {
                                  updateField("sslCertFile", selected);
                                }
                              }}
                              className="h-9 px-3 rounded-md border bg-secondary font-medium hover:bg-secondary/80 hover:text-foreground text-xs transition-all"
                            >
                              Browse
                            </button>
                            {formData.sslCertFile && (
                              <button
                                onClick={() => updateField("sslCertFile", undefined)}
                                className="h-9 px-2 text-muted-foreground hover:text-red-500 rounded-md hover:bg-red-500/10 transition-colors"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Client Key */}
                        <div>
                          <label className="text-xs font-medium text-muted-foreground block mb-1.5">
                            Client Key (.pem, .key)
                          </label>
                          <div className="flex gap-2">
                            <input
                              type="text"
                              value={formData.sslKeyFile || ""}
                              onChange={(e) =>
                                updateField("sslKeyFile", e.target.value)
                              }
                              placeholder="/path/to/client-key.pem"
                              className="flex-1 h-9 rounded-md border bg-secondary/50 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all font-mono"
                            />
                            <button
                              onClick={async () => {
                                const selected = await open({
                                  multiple: false,
                                  directory: false,
                                  defaultPath: await homeDir(),
                                  filters: [{ name: "Key", extensions: ["pem", "key"] }],
                                });
                                if (typeof selected === "string") {
                                  updateField("sslKeyFile", selected);
                                }
                              }}
                              className="h-9 px-3 rounded-md border bg-secondary font-medium hover:bg-secondary/80 hover:text-foreground text-xs transition-all"
                            >
                              Browse
                            </button>
                            {formData.sslKeyFile && (
                              <button
                                onClick={() => updateField("sslKeyFile", undefined)}
                                className="h-9 px-2 text-muted-foreground hover:text-red-500 rounded-md hover:bg-red-500/10 transition-colors"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* SSH Toggle */}
                    <div className="flex items-center gap-3 pt-2">
                      <button
                        onClick={() => updateField("ssh", !formData.ssh)}
                        className={cn(
                          "relative w-10 h-5 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-background space-x-0 ring-primary/50",
                          formData.ssh ? "bg-primary" : "bg-secondary",
                        )}
                      >
                        <div
                          className={cn(
                            "absolute top-[2px] w-4 h-4 rounded-full bg-white transition-transform shadow-sm",
                            formData.ssh
                              ? "translate-x-[22px]"
                              : "translate-x-[2px]",
                          )}
                        />
                      </button>
                      <span className="text-xs font-medium">
                        Use SSH Tunneling
                      </span>
                    </div>

                    {/* SSH Tunnel Fields */}
                    {formData.ssh && (
                      <div className="space-y-4 pt-3 border-t mt-1 border-border/50">
                        <div className="grid grid-cols-3 gap-3">
                          <div className="col-span-2">
                            <label className="text-xs font-medium text-muted-foreground block mb-1.5">
                              SSH Hostname
                            </label>
                            <input
                              type="text"
                              value={formData.sshHost}
                              onChange={(e) => updateField("sshHost", e.target.value)}
                              placeholder="ssh.example.com"
                              className="w-full h-9 rounded-md border bg-secondary/50 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
                            />
                          </div>
                          <div>
                            <label className="text-xs font-medium text-muted-foreground block mb-1.5">
                              SSH Port
                            </label>
                            <input
                              type="number"
                              value={formData.sshPort ?? ""}
                              onChange={(e) =>
                                updateField(
                                  "sshPort",
                                  e.target.value ? Number(e.target.value) : 22,
                                )
                              }
                              placeholder="22"
                              className="w-full h-9 rounded-md border bg-secondary/50 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
                            />
                          </div>
                        </div>

                        <div>
                          <label className="text-xs font-medium text-muted-foreground block mb-1.5">
                            SSH Username
                          </label>
                          <input
                            type="text"
                            value={formData.sshUser}
                            onChange={(e) => updateField("sshUser", e.target.value)}
                            placeholder="user"
                            className="w-full h-9 rounded-md border bg-secondary/50 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
                          />
                        </div>

                        <div>
                          <label className="text-xs font-medium text-muted-foreground block mb-1.5">
                            SSH Private Key File <span className="text-muted-foreground/50">(optional)</span>
                          </label>
                          {formData.sshKeyFile ? (
                            <div className="flex items-center gap-2 h-9 px-3 rounded-md border bg-secondary/50 text-sm">
                              <Key className="w-3.5 h-3.5 shrink-0 text-primary/70" />
                              <span className="flex-1 truncate font-mono text-xs text-foreground" title={formData.sshKeyFile}>
                                {formData.sshKeyFile.replace(/.*[\\/]/, "")}
                              </span>
                              <button
                                type="button"
                                onClick={async () => {
                                  const selected = await open({
                                    multiple: false,
                                    directory: false,
                                    defaultPath: await join(await homeDir(), ".ssh"),
                                    filters: [{ name: "Key files", extensions: ["*", "pem", "key"] }],
                                  });
                                  if (typeof selected === "string") {
                                    updateField("sshKeyFile", selected);
                                  }
                                }}
                                className="text-[10px] text-muted-foreground hover:text-foreground transition-colors shrink-0"
                              >
                                Change
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  updateField("sshKeyFile", undefined);
                                  updateField("sshPassphrase", "");
                                }}
                                className="text-muted-foreground hover:text-red-500 rounded hover:bg-red-500/10 p-0.5 transition-colors shrink-0"
                                title="Remove key file"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={async () => {
                                const selected = await open({
                                  multiple: false,
                                  directory: false,
                                  defaultPath: await join(await homeDir(), ".ssh"),
                                  filters: [{ name: "Key files", extensions: ["*", "pem", "key"] }],
                                });
                                if (typeof selected === "string") {
                                  updateField("sshKeyFile", selected);
                                }
                              }}
                              className="w-full h-9 rounded-md border border-dashed border-border/70 bg-secondary/30 hover:bg-secondary/60 hover:border-primary/50 text-xs text-muted-foreground hover:text-foreground flex items-center justify-center gap-2 transition-all"
                            >
                              <Key className="w-3.5 h-3.5" />
                              Select private key file…
                            </button>
                          )}
                        </div>

                        <div>
                          <label className="text-xs font-medium text-muted-foreground block mb-1.5">
                            {formData.sshKeyFile ? "Key Passphrase" : "SSH Password"}
                          </label>
                          <input
                            type="password"
                            value={formData.sshKeyFile ? (formData.sshPassphrase ?? "") : (formData.sshPassword ?? "")}
                            onChange={(e) =>
                              updateField(
                                formData.sshKeyFile ? "sshPassphrase" : "sshPassword",
                                e.target.value,
                              )
                            }
                            placeholder="••••••••"
                            className="w-full h-9 rounded-md border bg-secondary/50 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
                          />
                        </div>

                        {/* Docker Container */}
                        <div className="pt-2 border-t border-border/50 mt-1">
                          <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70 block mb-2">
                            Docker Container
                          </label>
                          <div className="space-y-2.5">
                            <div className="flex items-center justify-between">
                              <div className="space-y-0.5">
                                <label className="text-xs font-medium">Use Docker Container</label>
                                <p className="text-[10px] text-muted-foreground">
                                  Connect to a container with unexposed ports
                                </p>
                              </div>
                              <input
                                type="checkbox"
                                checked={formData.useDocker ?? false}
                                onChange={(e) => updateField("useDocker", e.target.checked)}
                                className="h-3.5 w-3.5 rounded border-gray-300 text-primary focus:ring-primary"
                              />
                            </div>
                            {formData.useDocker && (
                              <div>
                                <label className="text-xs font-medium text-muted-foreground block mb-1.5">
                                  Container Name
                                </label>
                                <input
                                  type="text"
                                  value={formData.dockerContainer ?? ""}
                                  onChange={(e) => updateField("dockerContainer", e.target.value)}
                                  placeholder="my-mysql-container"
                                  className="w-full h-9 rounded-md border bg-secondary/50 px-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
                                />
                                <p className="text-[10px] text-muted-foreground mt-1">
                                  The MySQL host field above is ignored when Docker is enabled — the container's internal port is used directly.
                                </p>
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="pt-2 border-t border-border/50 mt-1">
                          <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70 block mb-2">
                            Advanced SSH Settings
                          </label>
                          <div className="space-y-2.5">
                            <div className="flex items-center justify-between">
                              <div className="space-y-0.5">
                                <label className="text-xs font-medium">Strict Host Key Checking</label>
                                <p className="text-[10px] text-muted-foreground">Verify remote host identity</p>
                              </div>
                              <input
                                type="checkbox"
                                checked={formData.sshStrictKeyChecking}
                                onChange={(e) => updateField("sshStrictKeyChecking", e.target.checked)}
                                className="h-3.5 w-3.5 rounded border-gray-300 text-primary focus:ring-primary"
                              />
                            </div>

                            <div className="flex items-center justify-between">
                              <div className="space-y-0.5">
                                <label className="text-xs font-medium">Enable Compression</label>
                                <p className="text-[10px] text-muted-foreground">Improve speed on slow connections</p>
                              </div>
                              <input
                                type="checkbox"
                                checked={formData.sshCompression}
                                onChange={(e) => updateField("sshCompression", e.target.checked)}
                                className="h-3.5 w-3.5 rounded border-gray-300 text-primary focus:ring-primary"
                              />
                            </div>

                            <div className="flex items-center gap-3">
                              <div className="flex-1">
                                <label className="text-[10px] font-medium text-muted-foreground block mb-1">
                                  Keep-alive Interval (seconds)
                                </label>
                                <input
                                  type="number"
                                  value={formData.sshKeepAliveInterval}
                                  onChange={(e) => updateField("sshKeepAliveInterval", parseInt(e.target.value) || 0)}
                                  placeholder="0 (disabled)"
                                  className="w-full h-8 rounded-md border bg-secondary/30 px-3 text-xs focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all font-mono"
                                />
                              </div>
                            </div>

                            {viewMode === "edit" && editingId && formData.sshHost && (
                              <div className="flex items-center justify-between pt-1">
                                <div className="space-y-0.5">
                                  <label className="text-xs font-medium">Stored Host Key</label>
                                  <p className="text-[10px] text-muted-foreground">
                                    Remove cached fingerprint for this host
                                  </p>
                                </div>
                                <button
                                  type="button"
                                  onClick={async () => {
                                    try {
                                      await dbForgetHostKey(
                                        editingId,
                                        formData.sshHost!,
                                        formData.sshPort ?? 22,
                                      );
                                      notifySuccess("Host Key Forgotten", `Fingerprint for ${formData.sshHost}:${formData.sshPort ?? 22} removed. Next connection will perform a fresh TOFU exchange.`);
                                    } catch (err) {
                                      notifyError("Failed to Forget Host Key", String(err));
                                    }
                                  }}
                                  className="h-7 px-2.5 rounded-md border border-destructive/40 bg-destructive/10 text-destructive hover:bg-destructive/20 text-[10px] font-medium transition-colors"
                                >
                                  Forget Key
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    )}

                    <div className="pt-3 border-t mt-1 border-border/50">
                      <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70 block mb-2">
                        Diagnostics
                      </label>
                      <div className="flex items-center justify-between gap-3">
                        <div className="space-y-0.5">
                          <label className="text-xs font-medium">Verbose Connection Logging</label>
                          <p className="text-[10px] text-muted-foreground">
                            Log step-by-step SSH and MySQL connection diagnostics for this profile
                          </p>
                        </div>
                        <input
                          type="checkbox"
                          checked={formData.connectionVerboseLogging ?? false}
                          onChange={(e) => updateField("connectionVerboseLogging", e.target.checked)}
                          className="h-3.5 w-3.5 rounded border-gray-300 text-primary focus:ring-primary"
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Modal Footer */}
              <div className="border-t bg-muted/20 shrink-0">
                {testConnectionResult && (
                  <div
                    className={cn(
                      "px-5 pt-3 text-[11px]",
                      testConnectionResult.tone === "success"
                        ? "text-emerald-400"
                        : "text-red-400",
                    )}
                  >
                    {testConnectionResult.message}
                  </div>
                )}
                <div className="h-14 flex items-center justify-between px-5 gap-3">
                  <button
                    type="button"
                    onClick={handleTestConnection}
                    disabled={isTestingConnection}
                    className="inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-secondary disabled:opacity-50"
                  >
                    {isTestingConnection ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <ShieldCheck className="h-3.5 w-3.5" />
                    )}
                    {isTestingConnection ? "Testing..." : "Test Connection"}
                  </button>
                  <div className="flex items-center gap-3">
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
            </div>
          </div>
        )}
    </div>
  );
}
