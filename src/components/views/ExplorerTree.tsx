import { useState, useCallback, useEffect, useMemo, memo, useRef } from "react";
import { useSchemaStore } from "@/state/schemaStore";
import { ExplorerTreeSkeleton } from "@/components/ui/Skeleton";
import { CreateDatabaseModal } from "./CreateDatabaseModal";
import { ConfirmModal } from "./ConfirmModal";
import { EditDatabaseModal } from "./EditDatabaseModal";
import { ContextSubmenu } from "./ContextSubmenu";
import { useProfilesStore } from "@/state/profilesStore";
import { useLayoutStore } from "@/state/layoutStore";
import { useSavedQueriesStore } from "@/state/savedQueriesStore";
import {
  dbListDatabases,
  dbListTables,
  dbListColumns,
  dbQuery,
  dbDisconnect,
  dbExecuteQuery,
  dbImportCsv,
  dbImportSql,
  dbExportTableCsv,
  dbExportTableJson,
  dbExportTableInserts,
  dbExportSqlDump,
  type ImportResult,
} from "@/lib/db";
import { cn } from "@/lib/utils/cn";
import { useAppStore } from "@/state/appStore";
import {
  appendConnectionOutput,
  formatConnectionTarget,
  formatOutputError,
} from "@/lib/output";
import { open, save } from "@tauri-apps/plugin-dialog";
import { homeDir } from "@tauri-apps/api/path";
import { listen } from "@tauri-apps/api/event";
import {
  Database,
  Table2,
  Key,
  Link2,
  Hash,
  ChevronRight,
  ChevronDown,
  PlugZap,
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
  FileText,
  Server,
  Plus,
  TableProperties,
  Rows3,
  Import,
  Search,
  Download,
  Columns3,
  Shield,
  FolderKanban,
  ScrollText,
  Braces,
} from "lucide-react";
import {
  MariadbIcon,
  MysqlIcon,
  PostgresIcon,
  SqliteIcon,
} from "@/components/icons/DatabaseTypeIcons";
import { appendOutput } from "@/lib/output";

const DB_ICONS: Record<string, React.ElementType> = {
  postgres: PostgresIcon,
  mysql: MysqlIcon,
  sqlite: SqliteIcon,
  mariadb: MariadbIcon,
  mssql: Database,
};

function escSqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

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

type ExpandedSet = Record<string, boolean>;

type ContextMenuTarget =
  | { type: "server"; profileId: string }
  | { type: "database"; profileId: string; databases: string[] }
  | { type: "table"; profileId: string; database: string; table: string };

interface ImportProgressState {
  jobId: string;
  kind: "sql" | "csv";
  phase: "started" | "progress" | "completed" | "error";
  itemsProcessed: number;
  itemsTotal: number;
  rowsProcessed: number;
  rowsTotal: number;
  percent: number;
  message: string;
  summary?: ImportResult | null;
  targetLabel: string;
  fileName: string;
}

// ─── Highlight helper ────────────────────────────────────────────────
function HighlightMatch({ text, query }: { text: string; query: string }) {
  if (!query.trim()) return <>{text}</>;
  let re: RegExp;
  try { re = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi"); }
  catch { return <>{text}</>; }
  const parts = text.split(re);
  return (
    <>
      {parts.map((part, i) =>
        re.test(part) ? (
          <mark key={i} className="bg-yellow-400/30 text-foreground rounded-sm px-px">{part}</mark>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  );
}

export function ExplorerTree() {
  const connectedProfiles = useSchemaStore((s) => s.connectedProfiles);
  const schemaDatabases = useSchemaStore((s) => s.databases);
  const schemaTables = useSchemaStore((s) => s.tables);
  const schemaColumns = useSchemaStore((s) => s.columns);
  const profiles = useProfilesStore((s) => s.profiles);
  const setActiveView = useLayoutStore((s) => s.setActiveView);
  const openTab = useLayoutStore((s) => s.openTab);
  const [expanded, setExpanded] = useState<ExpandedSet>({});

  const connectedList = profiles.filter(
    (p) => p.connectionStatus === "connected",
  );

  const [contextMenu, setContextMenu] = useState<{
    target: ContextMenuTarget;
    x: number;
    y: number;
  } | null>(null);
  const [selectedDatabases, setSelectedDatabases] = useState<Set<string>>(
    new Set(),
  );
  const [createDbProfileId, setCreateDbProfileId] = useState<string | null>(
    null,
  );
  const [dropDbState, setDropDbState] = useState<{
    profileId: string;
    databases: string[];
  } | null>(null);
  const [editDbState, setEditDbState] = useState<{
    profileId: string;
    database: string;
  } | null>(null);
  const [dbFilter, setDbFilter] = useState("");
  const [tableFilter, setTableFilter] = useState("");
  const [globalSearch, setGlobalSearch] = useState("");
  const [searchFocusIdx, setSearchFocusIdx] = useState(0);
  const globalSearchRef = useRef<HTMLInputElement>(null);
  const [importJobs, setImportJobs] = useState<Record<string, ImportProgressState>>({});

  // ── Global search results ────────────────────────────────
  type SearchResult =
    | { kind: "database"; profileId: string; profileName: string; database: string }
    | { kind: "table"; profileId: string; profileName: string; database: string; table: string }
    | { kind: "column"; profileId: string; profileName: string; database: string; table: string; column: string };

  const searchResults = useMemo((): SearchResult[] => {
    const q = globalSearch.trim();
    if (!q) return [];
    let re: RegExp;
    try { re = new RegExp(q, "i"); }
    catch { return []; }
    const results: SearchResult[] = [];
    for (const profile of connectedList) {
      const profileName = connectedProfiles[profile.id]?.name ?? profile.name;
      const dbs = schemaDatabases[profile.id] ?? [];
      for (const database of dbs) {
        if (re.test(database)) {
          results.push({ kind: "database", profileId: profile.id, profileName, database });
        }
        const tables = schemaTables[`${profile.id}::${database}`] ?? [];
        for (const table of tables) {
          if (re.test(table)) {
            results.push({ kind: "table", profileId: profile.id, profileName, database, table });
          }
          const cols = schemaColumns[`${profile.id}::${database}::${table}`] ?? [];
          for (const col of cols) {
            if (re.test(col.name)) {
              results.push({ kind: "column", profileId: profile.id, profileName, database, table, column: col.name });
            }
          }
        }
      }
    }
    return results.slice(0, 100);
  }, [globalSearch, connectedList, connectedProfiles, schemaDatabases, schemaTables, schemaColumns]);

  const openSearchResult = useCallback((result: SearchResult) => {
    if (result.kind === "database") {
      openTab({ title: result.database, type: "database-view", meta: { profileId: result.profileId, database: result.database } });
    } else if (result.kind === "table") {
      openTab({ title: `Data: ${result.table}`, type: "table-data", meta: { profileId: result.profileId, database: result.database, table: result.table } });
    } else {
      openTab({ title: `Data: ${result.table}`, type: "table-data", meta: { profileId: result.profileId, database: result.database, table: result.table } });
    }
    setGlobalSearch("");
  }, [openTab]);

  // Hide context menu on click outside
  useEffect(() => {
    const handleClose = () => setContextMenu(null);
    window.addEventListener("click", handleClose);
    window.addEventListener("scroll", handleClose, true);
    return () => {
      window.removeEventListener("click", handleClose);
      window.removeEventListener("scroll", handleClose, true);
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;

    void listen<ImportProgressState>("import-progress", (event) => {
      if (disposed) return;
      const payload = event.payload;
      setImportJobs((prev) => {
        const existing = prev[payload.jobId];
        if (!existing) return prev;

        return {
          ...prev,
          [payload.jobId]: {
            ...existing,
            ...payload,
            summary: existing.summary ?? null,
          },
        };
      });
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  const toggle = useCallback((key: string) => {
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const runImportJob = useCallback(
    async ({
      kind,
      targetLabel,
      filePath,
      run,
    }: {
      kind: "sql" | "csv";
      targetLabel: string;
      filePath: string;
      run: (jobId: string) => Promise<ImportResult>;
    }) => {
      const jobId = crypto.randomUUID();
      const fileName = filePath.split(/[/\\]/).pop() || filePath;

      setImportJobs((prev) => ({
        ...prev,
        [jobId]: {
          jobId,
          kind,
          phase: "started",
          itemsProcessed: 0,
          itemsTotal: 0,
          rowsProcessed: 0,
          rowsTotal: 0,
          percent: 0,
          message: `Preparing ${kind.toUpperCase()} import...`,
          summary: null,
          targetLabel,
          fileName,
        },
      }));

      appendOutput("info", `Starting ${kind.toUpperCase()} import for ${targetLabel} from ${fileName}.`);

      try {
        const result = await run(jobId);

        setImportJobs((prev) => ({
          ...prev,
          [jobId]: {
            ...(prev[jobId] ?? {
              jobId,
              kind,
              targetLabel,
              fileName,
            }),
            kind,
            phase: "completed",
            itemsProcessed: result.itemsCommitted,
            itemsTotal: result.itemsAttempted,
            rowsProcessed: result.rowsCommitted,
            rowsTotal: result.rowsAttempted,
            percent: 100,
            message: result.summary,
            summary: result,
            targetLabel,
            fileName,
          },
        }));

        appendOutput("success", `${kind.toUpperCase()} import completed for ${targetLabel}: ${result.summary}`);
        useAppStore.getState().addToast({
          title: `${kind.toUpperCase()} Import Complete`,
          description: result.summary,
        });
      } catch (error) {
        const message = String(error);

        setImportJobs((prev) => ({
          ...prev,
          [jobId]: {
            ...(prev[jobId] ?? {
              jobId,
              kind,
              targetLabel,
              fileName,
            }),
            kind,
            phase: "error",
            message,
            summary: null,
            targetLabel,
            fileName,
          },
        }));

        appendOutput("error", `${kind.toUpperCase()} import failed for ${targetLabel}: ${message}`);
        useAppStore.getState().addToast({
          title: `${kind.toUpperCase()} Import Failed`,
          description: message,
          variant: "destructive",
        });
      }
    },
    [],
  );

  if (connectedList.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-6 pt-10 text-center select-none gap-3">
        {/* Illustration */}
        <div className="relative w-16 h-16 mx-auto">
          <div className="absolute inset-0 rounded-2xl bg-muted/40 border border-border/30" />
          <Server className="absolute inset-0 m-auto w-8 h-8 text-muted-foreground/25" />
          <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center">
            <Plus className="w-3.5 h-3.5 text-primary/60" />
          </div>
        </div>
        <div>
          <p className="text-xs font-semibold text-foreground/70 mb-1">
            No active connections
          </p>
          <p className="text-[10px] text-muted-foreground/60 leading-relaxed max-w-[160px]">
            Connect to a MySQL or MariaDB server to start exploring.
          </p>
        </div>
        <button
          onClick={() => setActiveView("servers")}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          Add Connection
        </button>
      </div>
    );
  }

  return (
    <div className="relative flex h-full flex-col bg-background text-[12px] select-none">
      {/* Global Search */}
      <div className="shrink-0 flex items-center h-7 border-b bg-muted/10 px-2 gap-1.5 focus-within:bg-muted/20 transition-colors">
        <Search className="w-3 h-3 text-muted-foreground shrink-0" />
        <input
          ref={globalSearchRef}
          type="text"
          placeholder="Search across all servers…"
          value={globalSearch}
          onChange={(e) => { setGlobalSearch(e.target.value); setSearchFocusIdx(0); }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setSearchFocusIdx((i) => Math.max(0, Math.min(i + 1, searchResults.length - 1))); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setSearchFocusIdx((i) => Math.max(i - 1, 0)); }
            else if (e.key === "Enter" && searchResults.length > 0) { 
              const idx = Math.max(0, Math.min(searchFocusIdx, searchResults.length - 1));
              openSearchResult(searchResults[idx]); 
            }
            else if (e.key === "Escape") { setGlobalSearch(""); }
          }}
          className="bg-transparent border-none outline-none w-full text-[11px] text-foreground placeholder:text-muted-foreground/60 h-full"
        />
        {globalSearch && (
          <button
            type="button"
            className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground"
            onClick={() => setGlobalSearch("")}
            aria-label="Clear global search"
          >
            <X className="w-3 h-3" />
          </button>
        )}
      </div>

      {/* Filter Bar */}
      <div className="shrink-0 flex items-center h-6.5 border-b bg-muted/20 text-[11px]">
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
            <button
              type="button"
              className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground"
              onClick={() => setDbFilter("")}
              aria-label="Clear database filter"
            >
              <X className="w-3 h-3" />
            </button>
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
            <button
              type="button"
              className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground"
              onClick={() => setTableFilter("")}
              aria-label="Clear table filter"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {/* Global Search Results */}
      {globalSearch.trim() && (
        <div className="flex-1 overflow-y-auto overflow-x-hidden">
          {searchResults.length === 0 ? (
            <div className="px-3 py-4 text-[11px] text-muted-foreground text-center">No results</div>
          ) : (
            <div className="py-0.5">
              {searchResults.map((r, i) => {
                const isFocused = i === searchFocusIdx;
                return (
                  <button
                    key={i}
                    className={cn(
                      "w-full text-left px-3 py-1 flex flex-col gap-0.5 hover:bg-accent transition-colors",
                      isFocused && "bg-accent"
                    )}
                    onClick={() => openSearchResult(r)}
                    onMouseEnter={() => setSearchFocusIdx(i)}
                  >
                    <div className="flex items-center gap-1.5 text-[11px] font-medium truncate">
                      {r.kind === "database" && <Database className="w-3 h-3 text-blue-400 shrink-0" />}
                      {r.kind === "table" && <Table2 className="w-3 h-3 text-green-400 shrink-0" />}
                      {r.kind === "column" && <Hash className="w-3 h-3 text-muted-foreground shrink-0" />}
                      <span className="truncate">
                        <HighlightMatch text={r.kind === "database" ? r.database : r.kind === "table" ? r.table : r.column} query={globalSearch} />
                      </span>
                    </div>
                    <div className="text-[10px] text-muted-foreground truncate pl-4.5">
                      {r.profileName}
                      {r.kind !== "database" && <> › <HighlightMatch text={r.database} query={globalSearch} /></>}
                      {r.kind === "column" && <> › <HighlightMatch text={r.table} query={globalSearch} /></>}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Tree (hidden when global search is active) */}
      <div
        className={cn("flex-1 overflow-y-auto overflow-x-hidden pt-1", globalSearch.trim() && "hidden")}
        role="tree"
        aria-label="Connected databases"
        onContextMenu={(e) => {
          // If we clicked directly on this container (empty space)
          // and not on a child element, show context menu for the last server
          if (e.target === e.currentTarget && connectedList.length > 0) {
            e.preventDefault();
            const lastProfile = connectedList[connectedList.length - 1];
            setContextMenu({
              target: { type: "server", profileId: lastProfile.id },
              x: e.clientX,
              y: e.clientY,
            });
          }
        }}
      >
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
                setSelectedDatabases((prev) => {
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
                setContextMenu({
                  target: { type: "server", profileId: profile.id },
                  x: e.clientX,
                  y: e.clientY,
                });
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
                  .filter((k) => k.startsWith(profile.id + "::"))
                  .map((k) => k.split("::")[1]);

                setContextMenu({
                  target: {
                    type: "database",
                    profileId: profile.id,
                    databases: dbsUnderProfile,
                  },
                  x: e.clientX,
                  y: e.clientY,
                });
              }}
              onContextMenuTable={(e, database, table) => {
                e.preventDefault();
                setContextMenu({
                  target: {
                    type: "table",
                    profileId: profile.id,
                    database,
                    table,
                  },
                  x: e.clientX,
                  y: e.clientY,
                });
              }}
            />
          );
        })}
      </div>

      {/* Context Menu Dropdown */}
      {contextMenu &&
        (() => {
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
              appendConnectionOutput(
                profile,
                "info",
                `Disconnecting from ${formatConnectionTarget(profile)}...`,
              );
              try {
                await dbDisconnect(profileId);
                appendConnectionOutput(
                  profile,
                  "success",
                  `Disconnected from ${formatConnectionTarget(profile)}.`,
                );
              } catch (e) {
                appendConnectionOutput(
                  profile,
                  "warning",
                  `Disconnect failed for ${formatConnectionTarget(profile)}: ${formatOutputError(e)}`,
                );
              }
              useProfilesStore
                .getState()
                .setConnectionStatus(profileId, "disconnected");
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
                setExpanded((prev) => ({
                  ...prev,
                  [`profile-${profileId}`]: true,
                }));
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

            const handleExpandAllServer = async () => {
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
                setExpanded((prev) => ({
                  ...prev,
                  [`profile-${profileId}`]: true,
                }));
                await Promise.all(
                  dbs.map(async (db) => {
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
                  }),
                );
                setExpanded((prev) => {
                  const next = { ...prev };
                  dbs.forEach((db) => {
                    next[`db-${profileId}::${db}`] = true;
                  });
                  return next;
                });
              }
            };

            const handleCollapseAllServer = () => {
              setContextMenu(null);
              setExpanded((prev) => {
                const next = { ...prev };
                Object.keys(next).forEach((k) => {
                  if (
                    k.startsWith(`db-${profileId}::`) ||
                    k === `profile-${profileId}`
                  ) {
                    next[k] = false;
                  }
                });
                return next;
              });
            };

            return (
              <div
                className="fixed z-100 min-w-45 bg-popover text-popover-foreground border rounded-md shadow-md p-1 text-xs"
                style={menuStyle}
              >
                <button
                  className="w-full text-left px-2 py-1.5 hover:bg-accent rounded flex items-center gap-2"
                  onClick={handleDisconnect}
                >
                  <PlugZap className="w-3.5 h-3.5 text-red-500" /> Disconnect
                </button>
                <button
                  className="w-full text-left px-2 py-1.5 hover:bg-accent rounded flex items-center gap-2"
                  onClick={handleRefresh}
                >
                  <RefreshCw className="w-3.5 h-3.5 text-muted-foreground" />{" "}
                  Refresh
                </button>
                <div className="h-px bg-border my-1 mx-1" />
                <button
                  className="w-full text-left px-2 py-1.5 hover:bg-accent rounded flex items-center gap-2"
                  onClick={handleCreateDatabase}
                >
                  <FolderPlus className="w-3.5 h-3.5 text-muted-foreground" />{" "}
                  Create Database...
                </button>
                <div className="h-px bg-border my-1 mx-1" />
                <button
                  className="w-full text-left px-2 py-1.5 hover:bg-accent rounded flex items-center gap-2"
                  onClick={handleExpandAllServer}
                >
                  <Maximize2 className="w-3.5 h-3.5 text-muted-foreground" />{" "}
                  Expand All
                </button>
                <button
                  className="w-full text-left px-2 py-1.5 hover:bg-accent rounded flex items-center gap-2"
                  onClick={handleCollapseAllServer}
                >
                  <Minimize2 className="w-3.5 h-3.5 text-muted-foreground" />{" "}
                  Collapse All
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
                meta: {
                  profileId,
                  profileName: profile.name,
                  database: targetDbs[0],
                },
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

            const handleRefreshDatabase = async () => {
              setContextMenu(null);
              const schemaStore = useSchemaStore.getState();
              await Promise.all(
                targetDbs.map(async (db) => {
                  const cacheKey = `${profileId}::${db}`;
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
                }),
              );
            };

            const handleExpandAllDatabase = async () => {
              setContextMenu(null);
              const schemaStore = useSchemaStore.getState();
              await Promise.all(
                targetDbs.map(async (db) => {
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
                }),
              );
              setExpanded((prev) => {
                const next = { ...prev };
                targetDbs.forEach((db) => {
                  next[`db-${profileId}::${db}`] = true;
                });
                return next;
              });
            };

            const handleCollapseAllDatabase = () => {
              setContextMenu(null);
              setExpanded((prev) => {
                const next = { ...prev };
                targetDbs.forEach((db) => {
                  next[`db-${profileId}::${db}`] = false;
                });
                return next;
              });
            };

            const handleSelectAll = () => {
              setContextMenu(null);
              const allDbs =
                useSchemaStore.getState().databases[profileId] || [];
              setSelectedDatabases(
                new Set(allDbs.map((db) => `${profileId}::${db}`)),
              );
            };

            const handleDeselectAll = () => {
              setContextMenu(null);
              setSelectedDatabases(new Set());
            };

            return (
              <div
                className="fixed z-100 min-w-50 bg-popover text-popover-foreground border rounded-md shadow-md p-1 text-xs"
                style={menuStyle}
              >
                {isMulti ? (
                  <>
                    <button
                      className="w-full text-left px-2 py-1.5 hover:bg-accent rounded flex items-center gap-2"
                      onClick={handleSelectAll}
                    >
                      <CheckSquare className="w-3.5 h-3.5 text-muted-foreground" />{" "}
                      Select All
                    </button>
                    <button
                      className="w-full text-left px-2 py-1.5 hover:bg-accent rounded flex items-center gap-2"
                      onClick={handleDeselectAll}
                    >
                      <Square className="w-3.5 h-3.5 text-muted-foreground" />{" "}
                      Deselect All
                    </button>
                    <button
                      className="w-full text-left px-2 py-1.5 hover:bg-accent rounded flex items-center gap-2"
                      onClick={handleRefreshDatabase}
                    >
                      <RefreshCw className="w-3.5 h-3.5 text-muted-foreground" />{" "}
                      Refresh
                    </button>
                    <div className="h-px bg-border my-1 mx-1" />
                    <button
                      className="w-full text-left px-2 py-1.5 hover:bg-accent rounded flex items-center gap-2 text-red-400"
                      onClick={handleDrop}
                    >
                      <Trash className="w-3.5 h-3.5" /> Drop ({targetDbs.length}{" "}
                      databases)
                    </button>
                    <div className="h-px bg-border my-1 mx-1" />
                    <button
                      className="w-full text-left px-2 py-1.5 hover:bg-accent rounded flex items-center gap-2"
                      onClick={handleExpandAllDatabase}
                    >
                      <Maximize2 className="w-3.5 h-3.5 text-muted-foreground" />{" "}
                      Expand All
                    </button>
                    <button
                      className="w-full text-left px-2 py-1.5 hover:bg-accent rounded flex items-center gap-2"
                      onClick={handleCollapseAllDatabase}
                    >
                      <Minimize2 className="w-3.5 h-3.5 text-muted-foreground" />{" "}
                      Collapse All
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      className="w-full text-left px-2 py-1.5 hover:bg-accent rounded flex items-center gap-2"
                      onClick={handleShowTables}
                    >
                      <Table2 className="w-3.5 h-3.5 text-muted-foreground" />{" "}
                      Show Tables
                    </button>
                    <button
                      className="w-full text-left px-2 py-1.5 hover:bg-accent rounded flex items-center gap-2"
                      onClick={() => {
                        setContextMenu(null);
                        useLayoutStore.getState().openTab({
                          title: `Schema: ${targetDbs[0]}`,
                          type: "schema",
                          meta: {
                            profileId,
                            database: targetDbs[0],
                          },
                        });
                      }}
                    >
                      <Link2 className="w-3.5 h-3.5 text-muted-foreground" />{" "}
                      Schema Diagram
                    </button>
                    <button
                      className="w-full text-left px-2 py-1.5 hover:bg-accent rounded flex items-center gap-2"
                      onClick={() => {
                        setContextMenu(null);
                        useLayoutStore.getState().openTab({
                          title: `Query: ${targetDbs[0]}`,
                          type: "sql",
                          meta: { profileId, database: targetDbs[0] },
                        });
                      }}
                    >
                      <FileCode2 className="w-3.5 h-3.5 text-muted-foreground" />{" "}
                      New Query
                    </button>
                    <button
                      className="w-full text-left px-2 py-1.5 hover:bg-accent rounded flex items-center gap-2"
                      onClick={handleEditDatabase}
                    >
                      <Pencil className="w-3.5 h-3.5 text-muted-foreground" />{" "}
                      Edit Database...
                    </button>
                    <button
                      className="w-full text-left px-2 py-1.5 hover:bg-accent rounded flex items-center gap-2"
                      onClick={handleRefreshDatabase}
                    >
                      <RefreshCw className="w-3.5 h-3.5 text-muted-foreground" />{" "}
                      Refresh
                    </button>
                    <div className="h-px bg-border my-1 mx-1" />
                    <button
                      className="w-full text-left px-2 py-1.5 hover:bg-accent rounded flex items-center gap-2"
                      onClick={async () => {
                        setContextMenu(null);
                        const file = await open({
                           multiple: false,
                           defaultPath: await homeDir(),
                           filters: [{ name: 'SQL Script', extensions: ['sql'] }]
                        });
                        if (file) {
                          const selectedFile = Array.isArray(file) ? file[0] : file;
                          await runImportJob({
                            kind: "sql",
                            targetLabel: `${profile.name} / ${targetDbs[0]}`,
                            filePath: selectedFile,
                            run: (jobId) =>
                              dbImportSql(profileId, targetDbs[0], selectedFile, jobId),
                          });
                        }
                      }}
                    >
                      <Import className="w-3.5 h-3.5 text-muted-foreground" />{" "}
                      Import SQL File...
                    </button>
                    <button
                      className="w-full text-left px-2 py-1.5 hover:bg-accent rounded flex items-center gap-2"
                      onClick={async () => {
                        setContextMenu(null);
                        const filePath = await save({
                          defaultPath: `${targetDbs[0]}_dump.sql`,
                          filters: [{ name: "SQL File", extensions: ["sql"] }],
                        });
                        if (!filePath) return;
                        try {
                          const bytes = await dbExportSqlDump(profileId, targetDbs[0], filePath);
                          useAppStore.getState().addToast({
                            title: "Export complete",
                            description: `Schema dump saved (${(bytes / 1024).toFixed(1)} KB)`,
                          });
                        } catch (e) {
                          useAppStore.getState().addToast({
                            title: "Export failed",
                            description: String(e),
                            variant: "destructive",
                          });
                        }
                      }}
                    >
                      <Download className="w-3.5 h-3.5 text-muted-foreground" />{" "}
                      Export as SQL Dump...
                    </button>
                    <ContextSubmenu
                      label="Create"
                      icon={
                        <PlusSquare className="w-3.5 h-3.5 text-muted-foreground" />
                      }
                    >
                      <button
                        className="w-full text-left px-2 py-1.5 hover:bg-accent rounded flex items-center gap-2"
                        onClick={() => {
                          setContextMenu(null);
                          const openTab = useLayoutStore.getState().openTab;
                          openTab({
                            title: `New Table @ ${targetDbs[0]}`,
                            type: "table-designer",
                            meta: { profileId, database: targetDbs[0] },
                          });
                        }}
                      >
                        <Table2 className="w-3.5 h-3.5 text-muted-foreground" />{" "}
                        Table
                      </button>
                      <button
                        className="w-full text-left px-2 py-1.5 hover:bg-accent rounded flex items-center gap-2"
                        onClick={() => setContextMenu(null)}
                      >
                        <FileCode2 className="w-3.5 h-3.5 text-muted-foreground" />{" "}
                        View
                      </button>
                      <button
                        className="w-full text-left px-2 py-1.5 hover:bg-accent rounded flex items-center gap-2"
                        onClick={() => setContextMenu(null)}
                      >
                        <FileCode2 className="w-3.5 h-3.5 text-muted-foreground" />{" "}
                        Stored Procedure
                      </button>
                      <button
                        className="w-full text-left px-2 py-1.5 hover:bg-accent rounded flex items-center gap-2"
                        onClick={() => setContextMenu(null)}
                      >
                        <FileCode2 className="w-3.5 h-3.5 text-muted-foreground" />{" "}
                        Stored Function
                      </button>
                      <button
                        className="w-full text-left px-2 py-1.5 hover:bg-accent rounded flex items-center gap-2"
                        onClick={() => setContextMenu(null)}
                      >
                        <FileCode2 className="w-3.5 h-3.5 text-muted-foreground" />{" "}
                        Trigger
                      </button>
                      <button
                        className="w-full text-left px-2 py-1.5 hover:bg-accent rounded flex items-center gap-2"
                        onClick={() => setContextMenu(null)}
                      >
                        <FileCode2 className="w-3.5 h-3.5 text-muted-foreground" />{" "}
                        Event
                      </button>
                    </ContextSubmenu>
                    <div className="h-px bg-border my-1 mx-1" />
                    <button
                      className="w-full text-left px-2 py-1.5 hover:bg-accent rounded flex items-center gap-2 text-red-400"
                      onClick={handleDrop}
                    >
                      <Trash className="w-3.5 h-3.5" /> Drop Database
                    </button>
                    <div className="h-px bg-border my-1 mx-1" />
                    <button
                      className="w-full text-left px-2 py-1.5 hover:bg-accent rounded flex items-center gap-2"
                      onClick={handleExpandAllDatabase}
                    >
                      <Maximize2 className="w-3.5 h-3.5 text-muted-foreground" />{" "}
                      Expand All
                    </button>
                    <button
                      className="w-full text-left px-2 py-1.5 hover:bg-accent rounded flex items-center gap-2"
                      onClick={handleCollapseAllDatabase}
                    >
                      <Minimize2 className="w-3.5 h-3.5 text-muted-foreground" />{" "}
                      Collapse All
                    </button>
                  </>
                )}
              </div>
            );
          }

          // ─── Table context menu ──────────────────────
          if (target.type === "table") {
            const { database: targetDb, table: targetTable } = target;
            return (
              <div
                className="fixed z-100 min-w-45 bg-popover text-popover-foreground border rounded-md shadow-md p-1 text-xs"
                style={menuStyle}
              >
                <button
                  className="w-full text-left px-2 py-1.5 hover:bg-accent rounded flex items-center gap-2"
                  onClick={() => {
                    setContextMenu(null);
                    useLayoutStore.getState().openTab({
                      title: `Data: ${targetTable}`,
                      type: "table-data",
                      meta: {
                        profileId,
                        database: targetDb,
                        tableName: targetTable,
                      },
                    });
                  }}
                >
                  <Rows3 className="w-3.5 h-3.5 text-muted-foreground" /> View
                  Data
                </button>
                <button
                  className="w-full text-left px-2 py-1.5 hover:bg-accent rounded flex items-center gap-2"
                  onClick={() => {
                    setContextMenu(null);
                    useLayoutStore.getState().openTab({
                      title: `Query: ${targetDb}`,
                      type: "sql",
                      meta: { profileId, database: targetDb },
                    });
                  }}
                >
                  <FileCode2 className="w-3.5 h-3.5 text-muted-foreground" />{" "}
                  New Query
                </button>
                <button
                  className="w-full text-left px-2 py-1.5 hover:bg-accent rounded flex items-center gap-2"
                  onClick={() => {
                    setContextMenu(null);
                    useLayoutStore.getState().openTab({
                      title: `Database: ${targetDb}`,
                      type: "database-view",
                      meta: {
                        profileId,
                        profileName: profile.name,
                        database: targetDb,
                      },
                    });
                  }}
                >
                  <TableProperties className="w-3.5 h-3.5 text-muted-foreground" />{" "}
                  Show Tables
                </button>
                <div className="h-px bg-border my-1 mx-1" />
                <button
                  className="w-full text-left px-2 py-1.5 hover:bg-accent rounded flex items-center gap-2"
                  onClick={() => {
                    setContextMenu(null);
                    useLayoutStore.getState().openTab({
                      title: targetTable,
                      type: "table-designer",
                      meta: {
                        profileId,
                        database: targetDb,
                        tableName: targetTable,
                      },
                    });
                  }}
                >
                  <Pencil className="w-3.5 h-3.5 text-muted-foreground" /> Edit
                  Table
                </button>
                <div className="h-px bg-border my-1 mx-1" />
                <button
                  className="w-full text-left px-2 py-1.5 hover:bg-accent rounded flex items-center gap-2"
                  onClick={async () => {
                    setContextMenu(null);
                    const file = await open({
                       multiple: false,
                       defaultPath: await homeDir(),
                       filters: [{ name: 'CSV File', extensions: ['csv'] }]
                    });
                    if (file) {
                      const selectedFile = Array.isArray(file) ? file[0] : file;
                      await runImportJob({
                        kind: "csv",
                        targetLabel: `${profile.name} / ${targetDb}.${targetTable}`,
                        filePath: selectedFile,
                        run: (jobId) =>
                          dbImportCsv(profileId, targetDb, targetTable, selectedFile, jobId),
                      });
                    }
                  }}
                >
                  <Import className="w-3.5 h-3.5 text-muted-foreground" /> Import CSV...
                </button>
                <div className="h-px bg-border my-1 mx-1" />
                <button
                  className="w-full text-left px-2 py-1.5 hover:bg-accent rounded flex items-center gap-2"
                  onClick={async () => {
                    setContextMenu(null);
                    const filePath = await save({
                      defaultPath: `${targetTable}.csv`,
                      filters: [{ name: "CSV File", extensions: ["csv"] }],
                    });
                    if (!filePath) return;
                    try {
                      const rows = await dbExportTableCsv(profileId, targetDb, targetTable, filePath);
                      useAppStore.getState().addToast({
                        title: "Export complete",
                        description: `${rows} rows saved to CSV`,
                      });
                    } catch (e) {
                      useAppStore.getState().addToast({
                        title: "Export failed",
                        description: String(e),
                        variant: "destructive",
                      });
                    }
                  }}
                >
                  <Download className="w-3.5 h-3.5 text-muted-foreground" /> Export as CSV...
                </button>
                <button
                  className="w-full text-left px-2 py-1.5 hover:bg-accent rounded flex items-center gap-2"
                  onClick={async () => {
                    setContextMenu(null);
                    const filePath = await save({
                      defaultPath: `${targetTable}.json`,
                      filters: [{ name: "JSON File", extensions: ["json"] }],
                    });
                    if (!filePath) return;
                    try {
                      const rows = await dbExportTableJson(profileId, targetDb, targetTable, filePath);
                      useAppStore.getState().addToast({
                        title: "Export complete",
                        description: `${rows} rows saved to JSON`,
                      });
                    } catch (e) {
                      useAppStore.getState().addToast({
                        title: "Export failed",
                        description: String(e),
                        variant: "destructive",
                      });
                    }
                  }}
                >
                  <Download className="w-3.5 h-3.5 text-muted-foreground" /> Export as JSON...
                </button>
                <button
                  className="w-full text-left px-2 py-1.5 hover:bg-accent rounded flex items-center gap-2"
                  onClick={async () => {
                    setContextMenu(null);
                    const filePath = await save({
                      defaultPath: `${targetTable}_inserts.sql`,
                      filters: [{ name: "SQL File", extensions: ["sql"] }],
                    });
                    if (!filePath) return;
                    try {
                      const rows = await dbExportTableInserts(profileId, targetDb, targetTable, filePath);
                      useAppStore.getState().addToast({
                        title: "Export complete",
                        description: `${rows} rows saved as SQL INSERTs`,
                      });
                    } catch (e) {
                      useAppStore.getState().addToast({
                        title: "Export failed",
                        description: String(e),
                        variant: "destructive",
                      });
                    }
                  }}
                >
                  <Download className="w-3.5 h-3.5 text-muted-foreground" /> Export as SQL INSERTs...
                </button>
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
              ? `Are you sure you want to permanently drop these ${dropDbState.databases.length} databases?\n\n${dropDbState.databases.map((d) => `• ${d}`).join("\n")}\n\nThis action cannot be undone.`
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
                const safeDbName = db.replace(/`/g, "``");
                await dbExecuteQuery(pid, `DROP DATABASE \`${safeDbName}\``);
              } catch (e) {
                console.error(`Failed to drop ${db}:`, e);
              }
            }
            const schemaStore = useSchemaStore.getState();
            schemaStore.setLoading(pid, "databases", true);
            try {
              const freshDbs = await dbListDatabases(pid);
              schemaStore.setDatabases(pid, freshDbs);
            } catch {
              /* ignore */
            } finally {
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
            } catch {
              /* ignore */
            } finally {
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
            setExpanded((prev) => ({
              ...prev,
              [`profile-${createDbProfileId}`]: true,
            }));
          }}
        />
      )}

      {Object.keys(importJobs).length > 0 && (
        <div className="pointer-events-none absolute inset-x-2 bottom-2 z-30 flex max-h-64 flex-col gap-2 overflow-y-auto">
          {Object.values(importJobs)
            .sort((left, right) => left.fileName.localeCompare(right.fileName))
            .map((job) => {
              const percent = Math.max(0, Math.min(100, Math.round(job.percent || 0)));
              const toneClass =
                job.phase === "error"
                  ? "border-red-500/40 bg-red-500/10"
                  : job.phase === "completed"
                    ? "border-green-500/40 bg-green-500/10"
                    : "border-primary/30 bg-background/95";

              return (
                <div
                  key={job.jobId}
                  className={cn(
                    "pointer-events-auto rounded-lg border p-3 shadow-lg backdrop-blur",
                    toneClass,
                  )}
                >
                  <div className="mb-2 flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-foreground">
                        {job.kind.toUpperCase()} import
                      </div>
                      <div className="truncate text-[11px] text-muted-foreground">
                        {job.targetLabel}
                      </div>
                    </div>
                    {(job.phase === "completed" || job.phase === "error") && (
                      <button
                        type="button"
                        onClick={() =>
                          setImportJobs((prev) => {
                            const next = { ...prev };
                            delete next[job.jobId];
                            return next;
                          })
                        }
                        className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                        aria-label="Dismiss import summary"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>

                  <div className="mb-2 h-2 overflow-hidden rounded-full bg-muted/40">
                    <div
                      className={cn(
                        "h-full transition-[width]",
                        job.phase === "error"
                          ? "bg-red-400"
                          : job.phase === "completed"
                            ? "bg-green-400"
                            : "bg-primary",
                      )}
                      style={{ width: `${job.phase === "error" ? percent : Math.max(percent, 4)}%` }}
                    />
                  </div>

                  <div className="text-[11px] text-foreground">{job.message}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
                    <span>{job.fileName}</span>
                    {(job.rowsTotal > 0 || job.summary?.rowsAttempted) && (
                      <span>
                        Rows {job.summary?.rowsCommitted ?? job.rowsProcessed}/
                        {job.summary?.rowsAttempted ?? job.rowsTotal}
                      </span>
                    )}
                    {(job.itemsTotal > 0 || job.summary?.itemsAttempted) && (
                      <span>
                        Items {job.summary?.itemsCommitted ?? job.itemsProcessed}/
                        {job.summary?.itemsAttempted ?? job.itemsTotal}
                      </span>
                    )}
                    {job.summary && (
                      <span>
                        Skipped {job.summary.rowsSkipped}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
        </div>
      )}
    </div>
  );
}

// ─── Profile Node (root) → lazy loads databases ─────────────────────

const ProfileNode = memo(function ProfileNode({
  profileId,
  name,
  color,
  type,
  expanded,
  toggle,
  onContextMenuServer,
  onContextMenuDatabase,
  onContextMenuTable,
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
  onContextMenuTable: (
    e: React.MouseEvent,
    database: string,
    table: string,
  ) => void;
  onSelectDatabase: (cacheKey: string, multi: boolean) => void;
  selectedDatabases: Set<string>;
  dbFilter: string;
  tableFilter: string;
}) {
  const databases = useSchemaStore((s) => s.databases[profileId]);
  const loading = useSchemaStore((s) => s.loadingDatabases[profileId]);
  const error = useSchemaStore((s) => s.errors[`dbs-${profileId}`]);
  const latency = useSchemaStore((s) => s.latencies[profileId] ?? null);
  const serverVersion = useSchemaStore((s) => s.serverVersions[profileId] ?? null);
  const refreshDatabases = useSchemaStore((s) => s.refreshDatabases);
  const refreshTables = useSchemaStore((s) => s.refreshTables);
  const openTab = useLayoutStore((s) => s.openTab);

  const connectionStatus = useProfilesStore((s) => s.profiles.find((p) => p.id === profileId)?.connectionStatus);
  const statusMeta = getConnectionStatusMeta(connectionStatus);

  const nodeKey = `profile-${profileId}`;
  const isOpen = expanded[nodeKey] ?? true;

  const handleExpand = async () => {
    const wasOpen = isOpen;
    toggle(nodeKey);

    // Lazy load: fetch databases on first expand
    if (!wasOpen || (!databases && !loading)) {
      if (!databases) {
        await refreshDatabases(profileId);
      }
    }
  };

  const handleRefreshAll = async (event: React.MouseEvent) => {
    event.stopPropagation();
    await refreshDatabases(profileId);
    const knownDatabases = useSchemaStore.getState().databases[profileId] ?? [];
    await Promise.allSettled(
      knownDatabases.map((database) =>
        useSchemaStore.getState().refreshTables(profileId, database),
      ),
    );
  };

  const filteredDatabases = useMemo(() => {
    if (!databases) return null;
    if (!dbFilter.trim()) return databases;
    try {
      const re = new RegExp(dbFilter, "i");
      return databases.filter((db) => re.test(db));
    } catch {
      return databases;
    }
  }, [databases, dbFilter]);

  // Auto-load table data for all databases when tableFilter is active so the
  // table filter works without requiring the user to manually expand each node.
  useEffect(() => {
    if (!tableFilter.trim() || !databases?.length) return;
    const store = useSchemaStore.getState();
    for (const db of databases) {
      const cacheKey = `${profileId}::${db}`;
      if (!store.tables[cacheKey] && !store.loadingTables[cacheKey]) {
        void refreshTables(profileId, db);
      }
    }
  }, [tableFilter, databases, profileId, refreshTables]);

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
          return (
            <div className="relative">
              <Icon className="w-3.5 h-3.5" style={{ color }} />
              {connectionStatus === "connected" && (
                 <span className="absolute -bottom-0.5 -right-0.5 w-[6px] h-[6px] bg-green-500 rounded-full border border-background shadow-sm shadow-green-500/50" />
              )}
              {connectionStatus === "error" && (
                 <span className="absolute -bottom-0.5 -right-0.5 w-[6px] h-[6px] bg-red-500 rounded-full border border-background shadow-sm shadow-red-500/50" />
              )}
            </div>
          );
        })()}
        label={name}
        badge={filteredDatabases ? String(filteredDatabases.length) : undefined}
        suffix={
          <span className="ml-1 flex items-center gap-1 shrink-0">
            {serverVersion && (
              <span className="max-w-44 truncate rounded bg-muted/40 px-1.5 py-0.5 text-[9px] text-muted-foreground/80">
                {serverVersion}
              </span>
            )}
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-medium",
                statusMeta.badgeClassName,
              )}
            >
              <span className={cn("h-1.5 w-1.5 rounded-full", statusMeta.dotClassName)} />
              {statusMeta.label}
            </span>
            {latency !== null && (
              <span className={cn(
                "text-[9px] tabular-nums font-mono px-1 rounded shrink-0",
                latency === -1
                  ? "text-red-400 bg-red-400/10"
                  : latency > 200
                  ? "text-amber-400 bg-amber-400/10"
                  : "text-muted-foreground/60"
              )}>
                {latency === -1 ? "err" : `${latency}ms`}
              </span>
            )}
            <button
              type="button"
              onClick={handleRefreshAll}
              className="rounded p-1 text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground"
              title="Refresh all databases and tables for this server"
              aria-label={`Refresh all nodes for ${name}`}
            >
              <RefreshCw className="h-3 w-3" />
            </button>
          </span>
        }
        bold
      />

      <TreeBranch open={isOpen}>
        <>
          <SavedQueriesNode
            profileId={profileId}
            expanded={expanded}
            toggle={toggle}
          />
          {loading && (
            <ExplorerTreeSkeleton depth={1} rows={4} />
          )}
          {error && (
            <TreeRow
              depth={1}
              icon={<AlertCircle className="w-3 h-3 text-red-400" />}
              label={error}
              muted
            />
          )}
          {filteredDatabases?.map((db) => (
            <DatabaseNode
              key={db}
              profileId={profileId}
              profileName={name}
              database={db}
              expanded={expanded}
              toggle={toggle}
              dbFilter={dbFilter}
              tableFilter={tableFilter}
              onSelectDatabase={onSelectDatabase}
              selectedDatabases={selectedDatabases}
              onContextMenuDatabase={onContextMenuDatabase}
              onContextMenuTable={onContextMenuTable}
            />
          ))}
        </>
      </TreeBranch>
    </>
  );
});

// ─── Database Node → single-click opens tab, expand loads tables ────

const SavedQueriesNode = memo(function SavedQueriesNode({
  profileId,
  expanded,
  toggle,
}: {
  profileId: string;
  expanded: ExpandedSet;
  toggle: (key: string) => void;
}) {
  const savedQueries = useSavedQueriesStore((s) => s.byProfile[profileId]) ?? [];
  const loading = useSavedQueriesStore((s) => s.loadingByProfile[profileId] ?? false);
  const error = useSavedQueriesStore((s) => s.errorByProfile[profileId] ?? null);
  const loadProfileQueries = useSavedQueriesStore((s) => s.loadProfileQueries);
  const openTab = useLayoutStore((s) => s.openTab);

  const nodeKey = `saved-queries-${profileId}`;
  const isOpen = expanded[nodeKey] ?? true;

  useEffect(() => {
    if (isOpen) {
      void loadProfileQueries(profileId);
    }
  }, [isOpen, loadProfileQueries, profileId]);

  return (
    <>
      <TreeRow
        depth={1}
        isOpen={isOpen}
        onChevronClick={() => toggle(nodeKey)}
        onLabelClick={() => toggle(nodeKey)}
        icon={<FileCode2 className="w-3.5 h-3.5 text-emerald-400/80" />}
        label="Saved Queries"
        badge={savedQueries.length > 0 ? String(savedQueries.length) : undefined}
      />

      <TreeBranch open={isOpen}>
        <>
          {loading && (
            <ExplorerTreeSkeleton depth={2} rows={3} />
          )}
          {error && (
            <TreeRow
              depth={2}
              icon={<AlertCircle className="w-3 h-3 text-red-400" />}
              label={error}
              muted
            />
          )}
          {!loading && !error && savedQueries.length === 0 && (
            <TreeRow
              depth={2}
              icon={<FileCode2 className="w-3 h-3 text-muted-foreground/40" />}
              label="No saved queries yet"
              muted
            />
          )}
          {savedQueries.map((query) => (
            <TreeRow
              key={query.id}
              depth={2}
              onLabelClick={() =>
                openTab({
                  title: query.name,
                  type: "sql",
                  meta: {
                    profileId,
                    database: query.database ?? "",
                    savedQueryId: query.id,
                    savedQueryPath: query.filePath,
                    filePath: query.absolutePath,
                  },
                })
              }
              icon={<FileText className="w-3.5 h-3.5 text-primary/80" />}
              label={query.name}
              suffix={
                <span className="ml-1 flex items-center gap-1 text-[10px] text-muted-foreground">
                  {query.database && (
                    <span className="rounded bg-muted/40 px-1 py-0.5 font-mono">
                      {query.database}
                    </span>
                  )}
                  {query.scheduleEnabled && query.scheduleMinutes && (
                    <span className="rounded bg-primary/10 px-1 py-0.5 text-primary">
                      {query.scheduleMinutes}m
                    </span>
                  )}
                </span>
              }
            />
          ))}
        </>
      </TreeBranch>
    </>
  );
});

const DatabaseNode = memo(function DatabaseNode({
  profileId,
  profileName,
  database,
  expanded,
  toggle,
  dbFilter,
  tableFilter,
  onSelectDatabase,
  selectedDatabases,
  onContextMenuDatabase,
  onContextMenuTable,
}: {
  profileId: string;
  profileName: string;
  database: string;
  expanded: ExpandedSet;
  toggle: (key: string) => void;
  dbFilter: string;
  tableFilter: string;
  onSelectDatabase: (cacheKey: string, multi: boolean) => void;
  selectedDatabases: Set<string>;
  onContextMenuDatabase: (e: React.MouseEvent, database: string) => void;
  onContextMenuTable: (
    e: React.MouseEvent,
    database: string,
    table: string,
  ) => void;
}) {
  const cacheKey = `${profileId}::${database}`;
  const tables = useSchemaStore((s) => s.tables[cacheKey]);
  const rawTableInfos = useSchemaStore((s) => s.tableInfos[cacheKey]);
  const tableInfos = useMemo(() => rawTableInfos ?? [], [rawTableInfos]);
  const loading = useSchemaStore((s) => s.loadingTables[cacheKey]);
  const error = useSchemaStore((s) => s.errors[`tbl-${cacheKey}`]);
  const refreshTables = useSchemaStore((s) => s.refreshTables);
  const openTab = useLayoutStore((s) => s.openTab);
  const [procedures, setProcedures] = useState<string[] | null>(null);
  const [functions, setFunctions] = useState<string[] | null>(null);
  const [loadingProcedures, setLoadingProcedures] = useState(false);
  const [loadingFunctions, setLoadingFunctions] = useState(false);
  const [proceduresError, setProceduresError] = useState<string | null>(null);
  const [functionsError, setFunctionsError] = useState<string | null>(null);

  const nodeKey = `db-${cacheKey}`;
  const isOpen = expanded[nodeKey] ?? false;
  const viewsNodeKey = `views-${cacheKey}`;
  const proceduresNodeKey = `procedures-${cacheKey}`;
  const functionsNodeKey = `functions-${cacheKey}`;

  // Expand/collapse + lazy load tables
  const handleExpand = async () => {
    const wasOpen = isOpen;
    toggle(nodeKey);

    if (!wasOpen && !tables && !loading) {
      await refreshTables(profileId, database);
    }
  };

  const tableRowCounts = useMemo(
    () =>
      new Map(
        tableInfos.map((tableInfo) => [tableInfo.name, tableInfo.rows] as const),
      ),
    [tableInfos],
  );
  const viewNames = useMemo(
    () =>
      tableInfos
        .filter((tableInfo) => tableInfo.type_ === "VIEW")
        .map((tableInfo) => tableInfo.name),
    [tableInfos],
  );

  const loadRoutineNames = useCallback(
    async (routineType: "PROCEDURE" | "FUNCTION") => {
      const query = `
        SELECT ROUTINE_NAME
        FROM information_schema.ROUTINES
        WHERE ROUTINE_SCHEMA = ${escSqlString(database)}
          AND ROUTINE_TYPE = ${escSqlString(routineType)}
        ORDER BY ROUTINE_NAME
      `;
      const result = await dbQuery(profileId, query);
      return result[0]?.rows
        .map((row) => row[0])
        .filter((value): value is string => typeof value === "string") ?? [];
    },
    [database, profileId],
  );

  const toggleProcedures = async () => {
    const nextOpen = !(expanded[proceduresNodeKey] ?? false);
    toggle(proceduresNodeKey);
    if (nextOpen && procedures === null && !loadingProcedures) {
      setLoadingProcedures(true);
      setProceduresError(null);
      try {
        setProcedures(await loadRoutineNames("PROCEDURE"));
      } catch (loadError) {
        setProceduresError(String(loadError));
      } finally {
        setLoadingProcedures(false);
      }
    }
  };

  const toggleFunctions = async () => {
    const nextOpen = !(expanded[functionsNodeKey] ?? false);
    toggle(functionsNodeKey);
    if (nextOpen && functions === null && !loadingFunctions) {
      setLoadingFunctions(true);
      setFunctionsError(null);
      try {
        setFunctions(await loadRoutineNames("FUNCTION"));
      } catch (loadError) {
        setFunctionsError(String(loadError));
      } finally {
        setLoadingFunctions(false);
      }
    }
  };

  const filteredTables = useMemo(() => {
    if (!tables) return null;
    if (!tableFilter.trim()) return tables;
    try {
      const re = new RegExp(tableFilter, "i");
      return tables.filter((t) => re.test(t));
    } catch {
      return tables;
    }
  }, [tables, tableFilter]);

  // When a table filter is active and this database has no matching tables,
  // hide the entire database node so only relevant databases are visible.
  if (tableFilter.trim() && tables !== undefined && filteredTables !== null && filteredTables.length === 0) {
    return null;
  }

  // Single click on label → open database tab OR select if ctrl/cmd held
  const handleLabelClick = (e: React.MouseEvent | React.KeyboardEvent) => {
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
        highlight={dbFilter}
      />

      <TreeBranch open={isOpen}>
        <>
          {loading && (
            <ExplorerTreeSkeleton depth={2} rows={5} />
          )}
          {error && (
            <TreeRow
              depth={2}
              icon={<AlertCircle className="w-3 h-3 text-red-400" />}
              label={error}
              muted
            />
          )}
          {filteredTables?.map((table) => (
            <TableNode
              key={table}
              profileId={profileId}
              database={database}
              table={table}
              expanded={expanded}
              toggle={toggle}
              tableFilter={tableFilter}
              rowCount={tableRowCounts.get(table) ?? null}
              onContextMenu={(e) => onContextMenuTable(e, database, table)}
            />
          ))}

          <TreeRow
            depth={2}
            isOpen={expanded[viewsNodeKey] ?? false}
            onChevronClick={() => toggle(viewsNodeKey)}
            onLabelClick={() => toggle(viewsNodeKey)}
            icon={<FolderKanban className="w-3.5 h-3.5 text-cyan-400/80" />}
            label="Views"
            badge={String(viewNames.length)}
          />
          <TreeBranch open={expanded[viewsNodeKey] ?? false}>
            <>
              {viewNames.length === 0 ? (
                <TreeRow
                  depth={3}
                  icon={<Table2 className="w-3 h-3 text-muted-foreground/40" />}
                  label="No views"
                  muted
                />
              ) : (
                viewNames.map((viewName) => (
                  <TreeRow
                    key={`view-${viewName}`}
                    depth={3}
                    icon={<Table2 className="w-3.5 h-3.5 text-cyan-400/80" />}
                    label={viewName}
                    onLabelClick={() =>
                      openTab({
                        title: `Data: ${viewName}`,
                        type: "table-data",
                        meta: { profileId, database, tableName: viewName },
                      })
                    }
                  />
                ))
              )}
            </>
          </TreeBranch>

          <TreeRow
            depth={2}
            isOpen={expanded[proceduresNodeKey] ?? false}
            onChevronClick={toggleProcedures}
            onLabelClick={toggleProcedures}
            icon={<ScrollText className="w-3.5 h-3.5 text-violet-400/80" />}
            label="Procedures"
            badge={procedures ? String(procedures.length) : undefined}
          />
          <TreeBranch open={expanded[proceduresNodeKey] ?? false}>
            <>
              {loadingProcedures && <ExplorerTreeSkeleton depth={3} rows={3} />}
              {proceduresError && (
                <TreeRow
                  depth={3}
                  icon={<AlertCircle className="w-3 h-3 text-red-400" />}
                  label={proceduresError}
                  muted
                />
              )}
              {!loadingProcedures && !proceduresError && (procedures?.length ?? 0) === 0 && (
                <TreeRow
                  depth={3}
                  icon={<ScrollText className="w-3 h-3 text-muted-foreground/40" />}
                  label="No procedures"
                  muted
                />
              )}
              {procedures?.map((routineName) => (
                <TreeRow
                  key={`proc-${routineName}`}
                  depth={3}
                  icon={<ScrollText className="w-3.5 h-3.5 text-violet-400/80" />}
                  label={routineName}
                  onLabelClick={() =>
                    openTab({
                      title: `SHOW CREATE ${routineName}`,
                      type: "sql",
                      meta: {
                        profileId,
                        database,
                        initialSql: `SHOW CREATE PROCEDURE \`${routineName.replace(/`/g, "``")}\`;`,
                      },
                    })
                  }
                />
              ))}
            </>
          </TreeBranch>

          <TreeRow
            depth={2}
            isOpen={expanded[functionsNodeKey] ?? false}
            onChevronClick={toggleFunctions}
            onLabelClick={toggleFunctions}
            icon={<Braces className="w-3.5 h-3.5 text-emerald-400/80" />}
            label="Functions"
            badge={functions ? String(functions.length) : undefined}
          />
          <TreeBranch open={expanded[functionsNodeKey] ?? false}>
            <>
              {loadingFunctions && <ExplorerTreeSkeleton depth={3} rows={3} />}
              {functionsError && (
                <TreeRow
                  depth={3}
                  icon={<AlertCircle className="w-3 h-3 text-red-400" />}
                  label={functionsError}
                  muted
                />
              )}
              {!loadingFunctions && !functionsError && (functions?.length ?? 0) === 0 && (
                <TreeRow
                  depth={3}
                  icon={<Braces className="w-3 h-3 text-muted-foreground/40" />}
                  label="No functions"
                  muted
                />
              )}
              {functions?.map((routineName) => (
                <TreeRow
                  key={`fn-${routineName}`}
                  depth={3}
                  icon={<Braces className="w-3.5 h-3.5 text-emerald-400/80" />}
                  label={routineName}
                  onLabelClick={() =>
                    openTab({
                      title: `SHOW CREATE ${routineName}`,
                      type: "sql",
                      meta: {
                        profileId,
                        database,
                        initialSql: `SHOW CREATE FUNCTION \`${routineName.replace(/`/g, "``")}\`;`,
                      },
                    })
                  }
                />
              ))}
            </>
          </TreeBranch>
        </>
      </TreeBranch>
    </>
  );
});

// ─── Table Node → lazy loads columns ────────────────────────────────

const TableNode = memo(function TableNode({
  profileId,
  database,
  table,
  expanded,
  toggle,
  tableFilter,
  rowCount,
  onContextMenu,
}: {
  profileId: string;
  database: string;
  table: string;
  expanded: ExpandedSet;
  toggle: (key: string) => void;
  tableFilter: string;
  rowCount: number | null;
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  const cacheKey = `${profileId}::${database}::${table}`;
  const columns = useSchemaStore((s) => s.columns[cacheKey]);
  const loading = useSchemaStore((s) => s.loadingColumns[cacheKey]);
  const error = useSchemaStore((s) => s.errors[`col-${cacheKey}`]);
  const setColumns = useSchemaStore((s) => s.setColumns);
  const setLoading = useSchemaStore((s) => s.setLoading);
  const setError = useSchemaStore((s) => s.setError);
  const clearError = useSchemaStore((s) => s.clearError);

  const openTab = useLayoutStore((s) => s.openTab);

  const nodeKey = `tbl-${cacheKey}`;
  const columnsNodeKey = `columns-${cacheKey}`;
  const indexesNodeKey = `indexes-${cacheKey}`;
  const constraintsNodeKey = `constraints-${cacheKey}`;
  const isOpen = expanded[nodeKey] ?? false;
  const [indexes, setIndexes] = useState<
    { name: string; unique: boolean; columns: string[] }[] | null
  >(null);
  const [constraints, setConstraints] = useState<
    { name: string; type: string }[] | null
  >(null);
  const [loadingIndexes, setLoadingIndexes] = useState(false);
  const [loadingConstraints, setLoadingConstraints] = useState(false);
  const [indexesError, setIndexesError] = useState<string | null>(null);
  const [constraintsError, setConstraintsError] = useState<string | null>(null);

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

  const handleDoubleClick = () => {
    openTab({
      title: `Data: ${table}`,
      type: "table-data",
      meta: { profileId, database, tableName: table },
    });
  };

  const toggleIndexes = async () => {
    const nextOpen = !(expanded[indexesNodeKey] ?? false);
    toggle(indexesNodeKey);
    if (!nextOpen || indexes !== null || loadingIndexes) {
      return;
    }

    setLoadingIndexes(true);
    setIndexesError(null);
    try {
      const result = await dbQuery(
        profileId,
        `SHOW INDEX FROM \`${table.replace(/`/g, "``")}\` FROM \`${database.replace(/`/g, "``")}\``,
      );
      const grouped = new Map<string, { name: string; unique: boolean; columns: string[] }>();
      for (const row of result[0]?.rows ?? []) {
        const indexName = String(row[2] ?? "");
        const unique = Number(row[1] ?? 1) === 0;
        const columnName = String(row[4] ?? "");
        if (!grouped.has(indexName)) {
          grouped.set(indexName, { name: indexName, unique, columns: [] });
        }
        if (columnName) {
          grouped.get(indexName)?.columns.push(columnName);
        }
      }
      setIndexes(Array.from(grouped.values()));
    } catch (loadError) {
      setIndexesError(String(loadError));
    } finally {
      setLoadingIndexes(false);
    }
  };

  const toggleConstraints = async () => {
    const nextOpen = !(expanded[constraintsNodeKey] ?? false);
    toggle(constraintsNodeKey);
    if (!nextOpen || constraints !== null || loadingConstraints) {
      return;
    }

    setLoadingConstraints(true);
    setConstraintsError(null);
    try {
      const result = await dbQuery(
        profileId,
        `
          SELECT CONSTRAINT_NAME, CONSTRAINT_TYPE
          FROM information_schema.TABLE_CONSTRAINTS
          WHERE TABLE_SCHEMA = ${escSqlString(database)}
            AND TABLE_NAME = ${escSqlString(table)}
          ORDER BY CONSTRAINT_TYPE, CONSTRAINT_NAME
        `,
      );
      setConstraints(
        (result[0]?.rows ?? []).map((row) => ({
          name: String(row[0] ?? ""),
          type: String(row[1] ?? ""),
        })),
      );
    } catch (loadError) {
      setConstraintsError(String(loadError));
    } finally {
      setLoadingConstraints(false);
    }
  };

  return (
    <>
      <TreeRow
        depth={2}
        isOpen={isOpen}
        onChevronClick={handleToggle}
        onLabelClick={handleToggle}
        onDoubleClick={handleDoubleClick}
        onContextMenu={onContextMenu}
        icon={<Table2 className="w-3.5 h-3.5 text-blue-400/80" />}
        label={table}
        badge={columns ? String(columns.length) : undefined}
        highlight={tableFilter}
        suffix={
          rowCount !== null ? (
            <span className="ml-1 shrink-0 rounded bg-muted/40 px-1 py-0.5 text-[9px] font-mono text-muted-foreground/70">
              {rowCount.toLocaleString()} rows
            </span>
          ) : undefined
        }
      />

      <TreeBranch open={isOpen}>
        <>
          <TreeRow
            depth={3}
            isOpen={expanded[columnsNodeKey] ?? true}
            onChevronClick={() => toggle(columnsNodeKey)}
            onLabelClick={() => toggle(columnsNodeKey)}
            icon={<Columns3 className="w-3.5 h-3.5 text-sky-400/80" />}
            label="Columns"
            badge={columns ? String(columns.length) : undefined}
          />
          <TreeBranch open={expanded[columnsNodeKey] ?? true}>
            <>
              {loading && <ExplorerTreeSkeleton depth={4} rows={4} />}
              {error && (
                <TreeRow
                  depth={4}
                  icon={<AlertCircle className="w-3 h-3 text-red-400" />}
                  label={error}
                  muted
                />
              )}
              {columns?.map((col) => (
                <TreeRow
                  key={col.name}
                  depth={4}
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
                  highlight={tableFilter}
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
          </TreeBranch>

          <TreeRow
            depth={3}
            isOpen={expanded[indexesNodeKey] ?? false}
            onChevronClick={toggleIndexes}
            onLabelClick={toggleIndexes}
            icon={<Key className="w-3.5 h-3.5 text-amber-400/80" />}
            label="Indexes"
            badge={indexes ? String(indexes.length) : undefined}
          />
          <TreeBranch open={expanded[indexesNodeKey] ?? false}>
            <>
              {loadingIndexes && <ExplorerTreeSkeleton depth={4} rows={3} />}
              {indexesError && (
                <TreeRow
                  depth={4}
                  icon={<AlertCircle className="w-3 h-3 text-red-400" />}
                  label={indexesError}
                  muted
                />
              )}
              {!loadingIndexes && !indexesError && (indexes?.length ?? 0) === 0 && (
                <TreeRow
                  depth={4}
                  icon={<Key className="w-3 h-3 text-muted-foreground/40" />}
                  label="No indexes"
                  muted
                />
              )}
              {indexes?.map((indexEntry) => (
                <TreeRow
                  key={indexEntry.name}
                  depth={4}
                  icon={indexEntry.unique ? <Key className="w-3 h-3 text-yellow-400" /> : <Link2 className="w-3 h-3 text-cyan-400" />}
                  label={indexEntry.name}
                  suffix={
                    <span className="ml-1 truncate text-[10px] font-mono text-muted-foreground/50">
                      {indexEntry.columns.join(", ")}
                    </span>
                  }
                />
              ))}
            </>
          </TreeBranch>

          <TreeRow
            depth={3}
            isOpen={expanded[constraintsNodeKey] ?? false}
            onChevronClick={toggleConstraints}
            onLabelClick={toggleConstraints}
            icon={<Shield className="w-3.5 h-3.5 text-rose-400/80" />}
            label="Constraints"
            badge={constraints ? String(constraints.length) : undefined}
          />
          <TreeBranch open={expanded[constraintsNodeKey] ?? false}>
            <>
              {loadingConstraints && <ExplorerTreeSkeleton depth={4} rows={3} />}
              {constraintsError && (
                <TreeRow
                  depth={4}
                  icon={<AlertCircle className="w-3 h-3 text-red-400" />}
                  label={constraintsError}
                  muted
                />
              )}
              {!loadingConstraints && !constraintsError && (constraints?.length ?? 0) === 0 && (
                <TreeRow
                  depth={4}
                  icon={<Shield className="w-3 h-3 text-muted-foreground/40" />}
                  label="No constraints"
                  muted
                />
              )}
              {constraints?.map((constraint) => (
                <TreeRow
                  key={`${constraint.type}-${constraint.name}`}
                  depth={4}
                  icon={<Shield className="w-3 h-3 text-rose-400/80" />}
                  label={constraint.name}
                  suffix={
                    <span className="ml-1 rounded bg-muted/40 px-1 py-0.5 text-[9px] font-mono text-muted-foreground/70">
                      {constraint.type}
                    </span>
                  }
                />
              ))}
            </>
          </TreeBranch>
        </>
      </TreeBranch>
    </>
  );
});

// ─── Highlight matching text in a label ────────────────────────────────

function HighlightedLabel({ label, query }: { label: string; query: string }) {
  if (!query.trim()) return <>{label}</>;
  let re: RegExp;
  try {
    re = new RegExp(`(${query})`, "gi");
  } catch {
    return <>{label}</>;
  }
  const parts = label.split(re);
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <mark
            key={i}
            className="bg-yellow-400/40 text-foreground rounded-[2px] not-italic"
          >
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

// ─── Generic tree row (memoised) ───────────────────────────────────────

function TreeBranch({
  open,
  children,
}: {
  open: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "grid transition-[grid-template-rows,opacity] duration-200 ease-out",
        open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
      )}
    >
      <div className="overflow-hidden">{children}</div>
    </div>
  );
}

const TreeRow = memo(function TreeRow({
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
  highlight,
}: {
  depth: number;
  isOpen?: boolean;
  onChevronClick?: () => void;
  onLabelClick?: (e: React.MouseEvent | React.KeyboardEvent) => void;
  onDoubleClick?: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  icon: React.ReactNode;
  label: string;
  badge?: string;
  suffix?: React.ReactNode;
  bold?: boolean;
  muted?: boolean;
  selected?: boolean;
  highlight?: string;
}) {
  const isFolder = isOpen !== undefined;
  const isInteractive = Boolean(onChevronClick || onLabelClick || onDoubleClick);

  return (
    <div
      role="treeitem"
      tabIndex={isInteractive ? 0 : -1}
      aria-expanded={isFolder ? isOpen : undefined}
      aria-selected={selected || undefined}
      aria-label={label}
      className={cn(
        "flex items-center h-5.5 cursor-pointer hover:bg-accent/50 transition-colors outline-none",
        bold && "font-medium",
        muted && "opacity-60",
        selected && "bg-accent/80 text-accent-foreground",
      )}
      style={{ paddingLeft: `${depth * 14 + 6}px` }}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight" && isFolder && !isOpen) {
          e.preventDefault();
          onChevronClick?.();
          return;
        }

        if (e.key === "ArrowLeft" && isFolder && isOpen) {
          e.preventDefault();
          onChevronClick?.();
          return;
        }

        if (e.key === " ") {
          e.preventDefault();
          if (isFolder) {
            onChevronClick?.();
          } else {
            onLabelClick?.(e);
          }
          return;
        }

        if (e.key === "Enter") {
          e.preventDefault();
          if (onLabelClick) {
            onLabelClick(e);
          } else {
            onDoubleClick?.();
          }
        }
      }}
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
          {isOpen ? (
            <ChevronDown className="w-3 h-3" />
          ) : (
            <ChevronRight className="w-3 h-3" />
          )}
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

        <span className="truncate">
          {highlight ? (
            <HighlightedLabel label={label} query={highlight} />
          ) : (
            label
          )}
        </span>

        {suffix}
      </span>

      {badge && (
        <span className="ml-auto mr-1 text-[9px] text-muted-foreground/40 font-mono shrink-0">
          {badge}
        </span>
      )}
    </div>
  );
});
