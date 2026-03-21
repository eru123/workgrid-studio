import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { useSchemaStore } from "@/state/schemaStore";
import { CreateDatabaseModal } from "./CreateDatabaseModal";
import { ConfirmModal } from "./ConfirmModal";
import { EditDatabaseModal } from "./EditDatabaseModal";
import { useProfilesStore } from "@/state/profilesStore";
import { useLayoutStore } from "@/state/layoutStore";
import { useSavedQueriesStore } from "@/state/savedQueriesStore";
import {
  dbListColumns,
  dbQuery,
  dbListTriggers,
  dbListEvents,
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
import { notifyError, notifySuccess } from "@/lib/notifications";
import {
  appendConnectionOutput,
  formatConnectionTarget,
  formatOutputError,
  appendOutput,
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
  Loader2,
  PlugZap,
  AlertCircle,
  FolderPlus,
  Maximize2,
  Minimize2,
  RefreshCw,
  X,
  Trash,
  Pencil,
  FileCode2,
  FileText,
  Server,
  Plus,
  TableProperties,
  Rows3,
  Import,
  Download,
  Columns3,
  Shield,
  FolderKanban,
  ScrollText,
  Braces,
  Search,
  Zap,
  Users,
} from "lucide-react";
import {
  MariadbIcon,
  MysqlIcon,
  PostgresIcon,
  SqliteIcon,
} from "@/components/icons/DatabaseTypeIcons";
import { TreeView, type TreeNode, type ContextMenuItem } from "@/components/ui/TreeView";

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
      return { label: "Connected", dotClassName: "bg-green-500", badgeClassName: "text-green-400 bg-green-500/10" };
    case "connecting":
      return { label: "Connecting", dotClassName: "bg-yellow-500", badgeClassName: "text-yellow-400 bg-yellow-500/10" };
    case "error":
      return { label: "Error", dotClassName: "bg-red-500", badgeClassName: "text-red-400 bg-red-500/10" };
    default:
      return { label: "Disconnected", dotClassName: "bg-muted-foreground/50", badgeClassName: "text-muted-foreground bg-muted/50" };
  }
}

function tryRegex(s: string): RegExp | null {
  if (!s.trim()) return null;
  try { return new RegExp(s, "i"); } catch { return null; }
}

// ─── Highlight helper (for search results panel) ──────────────────────────────

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

// ─── Import Progress types ─────────────────────────────────────────────────────

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

// ─── ExplorerTree ──────────────────────────────────────────────────────────────

export function ExplorerTree() {
  const connectedProfiles = useSchemaStore((s) => s.connectedProfiles);
  const schemaDatabases = useSchemaStore((s) => s.databases);
  const schemaTables = useSchemaStore((s) => s.tables);
  const schemaColumns = useSchemaStore((s) => s.columns);
  const tableInfos = useSchemaStore((s) => s.tableInfos);
  const loadingDatabases = useSchemaStore((s) => s.loadingDatabases);
  const loadingTables = useSchemaStore((s) => s.loadingTables);
  const loadingColumns = useSchemaStore((s) => s.loadingColumns);
  const errors = useSchemaStore((s) => s.errors);
  const latencies = useSchemaStore((s) => s.latencies);
  const serverVersions = useSchemaStore((s) => s.serverVersions);
  const profiles = useProfilesStore((s) => s.profiles);
  const setActiveView = useLayoutStore((s) => s.setActiveView);
  const openTab = useLayoutStore((s) => s.openTab);
  const savedQueriesByProfile = useSavedQueriesStore((s) => s.byProfile);
  const loadingSavedQueries = useSavedQueriesStore((s) => s.loadingByProfile);
  const savedQueriesErrors = useSavedQueriesStore((s) => s.errorByProfile);

  const connectedList = profiles.filter((p) => p.connectionStatus === "connected");

  // ── Tree expand/select state ──────────────────────────────────────────────
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const expandedIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => { expandedIdsRef.current = expandedIds; }, [expandedIds]);

  // ── Modal state ───────────────────────────────────────────────────────────
  const [createDbProfileId, setCreateDbProfileId] = useState<string | null>(null);
  const [dropDbState, setDropDbState] = useState<{ profileId: string; databases: string[] } | null>(null);
  const [editDbState, setEditDbState] = useState<{ profileId: string; database: string } | null>(null);

  // ── Filters / search ──────────────────────────────────────────────────────
  const [dbFilter, setDbFilter] = useState("");
  const [tableFilter, setTableFilter] = useState("");
  const [globalSearch, setGlobalSearch] = useState("");
  const [searchFocusIdx, setSearchFocusIdx] = useState(0);
  const globalSearchRef = useRef<HTMLInputElement>(null);

  // ── Import jobs ───────────────────────────────────────────────────────────
  const [importJobs, setImportJobs] = useState<Record<string, ImportProgressState>>({});

  // ── Import progress listener ──────────────────────────────────────────────
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen<ImportProgressState>("import-progress", (event) => {
      if (disposed) return;
      const payload = event.payload;
      setImportJobs((prev) => {
        const existing = prev[payload.jobId];
        if (!existing) return prev;
        return { ...prev, [payload.jobId]: { ...existing, ...payload, summary: existing.summary ?? null } };
      });
    }).then((fn) => { unlisten = fn; });
    return () => { disposed = true; unlisten?.(); };
  }, []);

  // ── Auto-load tables when table filter is active ──────────────────────────
  useEffect(() => {
    if (!tableFilter.trim()) return;
    const timer = setTimeout(() => {
      const store = useSchemaStore.getState();
      for (const profile of connectedList) {
        const dbs = store.databases[profile.id] ?? [];
        for (const db of dbs) {
          const cacheKey = `${profile.id}::${db}`;
          if (!store.tables[cacheKey] && !store.loadingTables[cacheKey]) {
            void store.refreshTables(profile.id, db);
          }
        }
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [tableFilter, connectedList, schemaDatabases]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Global search ─────────────────────────────────────────────────────────
  type SearchResult =
    | { kind: "database"; profileId: string; profileName: string; database: string }
    | { kind: "table"; profileId: string; profileName: string; database: string; table: string }
    | { kind: "column"; profileId: string; profileName: string; database: string; table: string; column: string };

  const searchResults = useMemo((): SearchResult[] => {
    const q = globalSearch.trim();
    if (!q) return [];
    let re: RegExp;
    try { re = new RegExp(q, "i"); } catch { return []; }
    const results: SearchResult[] = [];
    for (const profile of connectedList) {
      const profileName = connectedProfiles[profile.id]?.name ?? profile.name;
      const dbs = schemaDatabases[profile.id] ?? [];
      for (const database of dbs) {
        if (re.test(database)) results.push({ kind: "database", profileId: profile.id, profileName, database });
        const tables = schemaTables[`${profile.id}::${database}`] ?? [];
        for (const table of tables) {
          if (re.test(table)) results.push({ kind: "table", profileId: profile.id, profileName, database, table });
          const cols = schemaColumns[`${profile.id}::${database}::${table}`] ?? [];
          for (const col of cols) {
            if (re.test(col.name)) results.push({ kind: "column", profileId: profile.id, profileName, database, table, column: col.name });
          }
        }
      }
    }
    return results.slice(0, 100);
  }, [globalSearch, connectedList, connectedProfiles, schemaDatabases, schemaTables, schemaColumns]);

  const openSearchResult = useCallback((result: SearchResult) => {
    if (result.kind === "database") {
      openTab({ title: result.database, type: "database-view", meta: { profileId: result.profileId, database: result.database } });
    } else {
      openTab({ title: `Data: ${result.table}`, type: "table-data", meta: { profileId: result.profileId, database: result.database, tableName: result.table } });
    }
    setGlobalSearch("");
  }, [openTab]);

  // ── Import job runner ─────────────────────────────────────────────────────
  const runImportJob = useCallback(async ({
    kind, targetLabel, filePath, run,
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
      [jobId]: { jobId, kind, phase: "started", itemsProcessed: 0, itemsTotal: 0, rowsProcessed: 0, rowsTotal: 0, percent: 0, message: `Preparing ${kind.toUpperCase()} import...`, summary: null, targetLabel, fileName },
    }));
    appendOutput("info", `Starting ${kind.toUpperCase()} import for ${targetLabel} from ${fileName}.`);
    try {
      const result = await run(jobId);
      setImportJobs((prev) => ({
        ...prev,
        [jobId]: { ...(prev[jobId] ?? { jobId, kind, targetLabel, fileName }), kind, phase: "completed", itemsProcessed: result.itemsCommitted, itemsTotal: result.itemsAttempted, rowsProcessed: result.rowsCommitted, rowsTotal: result.rowsAttempted, percent: 100, message: result.summary, summary: result, targetLabel, fileName },
      }));
      appendOutput("success", `${kind.toUpperCase()} import completed for ${targetLabel}: ${result.summary}`);
      notifySuccess(`${kind.toUpperCase()} Import Complete`, result.summary);
    } catch (error) {
      const message = String(error);
      setImportJobs((prev) => ({
        ...prev,
        [jobId]: { ...(prev[jobId] ?? { jobId, kind, targetLabel, fileName }), kind, phase: "error", message, summary: null, targetLabel, fileName },
      }));
      appendOutput("error", `${kind.toUpperCase()} import failed for ${targetLabel}: ${message}`);
      notifyError(`${kind.toUpperCase()} Import Failed`, message);
    }
  }, []);

  // ── Expand/select handlers ────────────────────────────────────────────────
  const handleExpandedChange = useCallback((newIds: Set<string>) => {
    const addedIds = [...newIds].filter((id) => !expandedIdsRef.current.has(id));
    const idsToAdd = new Set(newIds);

    for (const nodeId of addedIds) {
      // Auto-expand columns section when a table node is expanded
      if (nodeId.startsWith("tbl::")) {
        idsToAdd.add(`cols::${nodeId.slice(5)}`);
      }
      // Trigger lazy loads
      if (nodeId.startsWith("prof::")) {
        const profileId = nodeId.slice(6);
        const store = useSchemaStore.getState();
        if (!store.databases[profileId] && !store.loadingDatabases[profileId]) {
          void store.refreshDatabases(profileId);
        }
      } else if (nodeId.startsWith("sq::")) {
        const profileId = nodeId.slice(4);
        const { byProfile, loadProfileQueries } = useSavedQueriesStore.getState();
        if (!byProfile[profileId]) void loadProfileQueries(profileId);
      } else if (nodeId.startsWith("db::")) {
        const rest = nodeId.slice(4);
        const sep = rest.indexOf("::");
        if (sep !== -1) {
          const profileId = rest.slice(0, sep);
          const db = rest.slice(sep + 2);
          const store = useSchemaStore.getState();
          const cacheKey = `${profileId}::${db}`;
          if (!store.tables[cacheKey] && !store.loadingTables[cacheKey]) {
            void store.refreshTables(profileId, db);
          }
        }
      } else if (nodeId.startsWith("tbl::")) {
        const rest = nodeId.slice(5);
        const sep1 = rest.indexOf("::");
        if (sep1 !== -1) {
          const profileId = rest.slice(0, sep1);
          const rest2 = rest.slice(sep1 + 2);
          const sep2 = rest2.indexOf("::");
          if (sep2 !== -1) {
            const db = rest2.slice(0, sep2);
            const table = rest2.slice(sep2 + 2);
            const store = useSchemaStore.getState();
            const cacheKey = `${profileId}::${db}::${table}`;
            if (!store.columns[cacheKey] && !store.loadingColumns[cacheKey]) {
              store.setLoading(cacheKey, "columns", true);
              store.clearError(`col-${cacheKey}`);
              void dbListColumns(profileId, db, table)
                .then((cols) => store.setColumns(profileId, db, table, cols))
                .catch((e) => store.setError(`col-${cacheKey}`, String(e)))
                .finally(() => store.setLoading(cacheKey, "columns", false));
            }
          }
        }
      }
    }

    setExpandedIds(idsToAdd);
    expandedIdsRef.current = idsToAdd;
  }, []);

  const handleSelect = useCallback((node: TreeNode) => {
    setSelectedId(node.id);
    const id = node.id;
    // Leaf nodes open on single-click
    if (id.startsWith("query::")) {
      const parts = id.split("::");
      if (parts.length >= 3) {
        const profileId = parts[1];
        const d = node.data as { queryId: string; database?: string; filePath?: string } | undefined;
        if (d) openTab({ title: node.label, type: "sql", meta: { profileId, database: d.database ?? "", savedQueryId: d.queryId, ...(d.filePath ? { filePath: d.filePath } : {}) } });
      }
    } else if (id.startsWith("proc::") || id.startsWith("func::")) {
      const d = node.data as { profileId: string; database: string; name: string; kind: string } | undefined;
      if (d) {
        openTab({ title: `${d.kind}: ${d.name}`, type: "routine", meta: { profileId: d.profileId, database: d.database, routineName: d.name, routineType: d.kind } });
      }
    } else if (id.startsWith("view::")) {
      const d = node.data as { profileId: string; database: string; table: string } | undefined;
      if (d) openTab({ title: `View: ${d.table}`, type: "view", meta: { profileId: d.profileId, database: d.database, viewName: d.table } });
    } else if (id.startsWith("trigger::")) {
      const d = node.data as { profileId: string; database: string; name: string } | undefined;
      if (d) openTab({ title: `Trigger: ${d.name}`, type: "trigger", meta: { profileId: d.profileId, database: d.database, triggerName: d.name } });
    } else if (id.startsWith("event::")) {
      const d = node.data as { profileId: string; database: string; name: string } | undefined;
      if (d) openTab({ title: `Event: ${d.name}`, type: "event", meta: { profileId: d.profileId, database: d.database, eventName: d.name } });
    }
  }, [openTab]);

  const handleActivate = useCallback((node: TreeNode) => {
    const id = node.id;
    if (id.startsWith("db::")) {
      const rest = id.slice(4);
      const sep = rest.indexOf("::");
      if (sep !== -1) {
        const profileId = rest.slice(0, sep);
        const db = rest.slice(sep + 2);
        const meta = connectedProfiles[profileId];
        openTab({ title: `Database: ${db}`, type: "database-view", meta: { profileId, profileName: meta?.name ?? profileId, database: db } });
      }
    } else if (id.startsWith("tbl::")) {
      const rest = id.slice(5);
      const sep1 = rest.indexOf("::");
      if (sep1 !== -1) {
        const profileId = rest.slice(0, sep1);
        const rest2 = rest.slice(sep1 + 2);
        const sep2 = rest2.indexOf("::");
        if (sep2 !== -1) {
          const db = rest2.slice(0, sep2);
          const table = rest2.slice(sep2 + 2);
          openTab({ title: `Data: ${table}`, type: "table-data", meta: { profileId, database: db, tableName: table } });
        }
      }
    } else if (id.startsWith("prof::")) {
      const profileId = id.slice(6);
      const meta = connectedProfiles[profileId];
      openTab({ title: meta?.name ?? profileId, type: "database-view", meta: { profileId, profileName: meta?.name ?? profileId } });
    }
  }, [openTab, connectedProfiles]);

  // ── Build tree nodes ──────────────────────────────────────────────────────
  const nodes = useMemo((): TreeNode[] => {
    if (connectedList.length === 0) return [];
    const dbFilterRe = tryRegex(dbFilter);
    const tableFilterRe = tryRegex(tableFilter);

    return connectedList.map((profile): TreeNode => {
      const profileId = profile.id;
      const meta = connectedProfiles[profileId];
      const name = meta?.name ?? profile.name;
      const latency = latencies[profileId] ?? null;
      const serverVersion = serverVersions[profileId] ?? null;
      const dbs = schemaDatabases[profileId];
      const isLoadingDbs = loadingDatabases[profileId];
      const dbError = errors[`dbs-${profileId}`];
      const statusMeta = getConnectionStatusMeta(profile.connectionStatus);

      // ── Saved Queries section ────────────────────────────────────────────
      const savedQueries = savedQueriesByProfile[profileId] ?? [];
      const sqLoading = loadingSavedQueries[profileId] ?? false;
      const sqError = savedQueriesErrors[profileId] ?? null;

      const sqChildren: TreeNode[] = sqLoading
        ? [{ id: `sq-load::${profileId}`, label: "Loading...", icon: <Loader2 className="w-3 h-3 animate-spin opacity-60" />, disabled: true }]
        : sqError
        ? [{ id: `sq-err::${profileId}`, label: sqError, icon: <AlertCircle className="w-3 h-3 text-red-400" />, disabled: true }]
        : savedQueries.length === 0
        ? [{ id: `sq-empty::${profileId}`, label: "No saved queries yet", icon: <FileCode2 className="w-3 h-3 text-muted-foreground/40" />, disabled: true }]
        : savedQueries.map((q): TreeNode => ({
            id: `query::${profileId}::${q.id}`,
            label: q.name,
            icon: <FileText className="w-3.5 h-3.5 text-primary/80" />,
            data: { queryId: q.id, database: q.database, filePath: q.absolutePath },
            suffix: (q.database || (q.scheduleEnabled && q.scheduleMinutes)) ? (
              <span className="ml-1 flex items-center gap-1 text-[10px] text-muted-foreground">
                {q.database && <span className="rounded bg-muted/40 px-1 py-0.5 font-mono">{q.database}</span>}
                {q.scheduleEnabled && q.scheduleMinutes && <span className="rounded bg-primary/10 px-1 py-0.5 text-primary">{q.scheduleMinutes}m</span>}
              </span>
            ) : undefined,
          }));

      const savedQueriesNode: TreeNode = {
        id: `sq::${profileId}`,
        label: "Saved Queries",
        icon: <FileCode2 className="w-3.5 h-3.5 text-emerald-400/80" />,
        expandable: true,
        decorations: { badge: savedQueries.length > 0 ? savedQueries.length : undefined },
        children: sqChildren,
      };

      // ── Database nodes ───────────────────────────────────────────────────
      let dbChildren: TreeNode[];
      if (isLoadingDbs && !dbs) {
        dbChildren = [{ id: `db-load::${profileId}`, label: "Loading databases...", icon: <Loader2 className="w-3 h-3 animate-spin opacity-60" />, disabled: true }];
      } else if (dbError) {
        dbChildren = [{ id: `db-err::${profileId}`, label: dbError, icon: <AlertCircle className="w-3 h-3 text-red-400" />, disabled: true }];
      } else if (!dbs) {
        dbChildren = [];
      } else {
        const filteredDbs = dbFilterRe ? dbs.filter((db) => dbFilterRe.test(db)) : dbs;
        const builtDbs = filteredDbs.map((db): TreeNode | null => {
          const cacheKey = `${profileId}::${db}`;
          const tables = schemaTables[cacheKey];
          const rawTIs = tableInfos[cacheKey] ?? [];
          const isLoadingTables = loadingTables[cacheKey];
          const tblError = errors[`tbl-${cacheKey}`];

          const viewNames = rawTIs.filter((ti) => ti.type_ === "VIEW").map((ti) => ti.name);
          const tableRowCounts = new Map(rawTIs.map((ti) => [ti.name, ti.rows] as const));

          let filteredTables = tables;
          if (tableFilterRe && tables) filteredTables = tables.filter((t) => tableFilterRe.test(t));

          // Hide database when table filter active and no matches
          if (tableFilter.trim() && tables !== undefined && (filteredTables?.length ?? 0) === 0) return null;

          // ── Table nodes ────────────────────────────────────────────────
          const tableNodes: TreeNode[] = (filteredTables ?? []).map((table): TreeNode => {
            const tblKey = `${profileId}::${db}::${table}`;
            const columns = schemaColumns[tblKey];
            const isLoadingCols = loadingColumns[tblKey];
            const colError = errors[`col-${tblKey}`];
            const rowCount = tableRowCounts.get(table) ?? null;

            const colChildren: TreeNode[] = isLoadingCols
              ? [{ id: `col-load::${tblKey}`, label: "Loading...", icon: <Loader2 className="w-3 h-3 animate-spin opacity-60" />, disabled: true }]
              : colError
              ? [{ id: `col-err::${tblKey}`, label: colError, icon: <AlertCircle className="w-3 h-3 text-red-400" />, disabled: true }]
              : !columns
              ? [{ id: `col-pend::${tblKey}`, label: "—", disabled: true }]
              : columns.length === 0
              ? [{ id: `col-none::${tblKey}`, label: "No columns", icon: <Columns3 className="w-3 h-3 text-muted-foreground/40" />, disabled: true }]
              : columns.map((col): TreeNode => ({
                  id: `col::${tblKey}::${col.name}`,
                  label: col.name,
                  icon: col.key === "PRI"
                    ? <Key className="w-3 h-3 text-yellow-400" />
                    : col.key === "MUL"
                    ? <Link2 className="w-3 h-3 text-cyan-400" />
                    : col.key === "UNI"
                    ? <Key className="w-3 h-3 text-orange-400" />
                    : <Hash className="w-3 h-3 text-muted-foreground/40" />,
                  suffix: (
                    <span className="text-[10px] text-muted-foreground/50 ml-1 font-mono truncate">
                      {col.col_type}{col.nullable ? "" : " NOT NULL"}{col.extra ? ` ${col.extra}` : ""}
                    </span>
                  ),
                }));

            const tableContextMenu: ContextMenuItem[] = [
              { label: "View Data", icon: <Rows3 className="w-3.5 h-3.5" />, onClick: () => openTab({ title: `Data: ${table}`, type: "table-data", meta: { profileId, database: db, tableName: table } }) },
              { label: "New Query", icon: <FileCode2 className="w-3.5 h-3.5" />, onClick: () => openTab({ title: "New Query", type: "sql", meta: { profileId, database: db } }) },
              { label: "Show Tables", icon: <TableProperties className="w-3.5 h-3.5" />, onClick: () => openTab({ title: `Database: ${db}`, type: "database-view", meta: { profileId, profileName: name, database: db } }) },
              { label: "Edit Table", icon: <Pencil className="w-3.5 h-3.5" />, onClick: () => openTab({ title: `Design: ${table}`, type: "table-designer", meta: { profileId, database: db, tableName: table } }) },
              { label: "---", onClick: () => {}, separator: true },
              { label: "Import CSV...", icon: <Import className="w-3.5 h-3.5" />, onClick: async () => {
                const fp = await open({ multiple: false, defaultPath: await homeDir(), filters: [{ name: "CSV Files", extensions: ["csv"] }] });
                if (typeof fp === "string") await runImportJob({ kind: "csv", targetLabel: `${db}.${table}`, filePath: fp, run: (jobId) => dbImportCsv(profileId, db, table, fp, jobId) });
              }},
              { label: "---", onClick: () => {}, separator: true },
              { label: "Export as CSV...", icon: <Download className="w-3.5 h-3.5" />, onClick: async () => {
                const sp = await save({ defaultPath: await homeDir(), filters: [{ name: "CSV", extensions: ["csv"] }] });
                if (typeof sp === "string") await dbExportTableCsv(profileId, db, table, sp);
              }},
              { label: "Export as JSON...", icon: <Download className="w-3.5 h-3.5" />, onClick: async () => {
                const sp = await save({ defaultPath: await homeDir(), filters: [{ name: "JSON", extensions: ["json"] }] });
                if (typeof sp === "string") await dbExportTableJson(profileId, db, table, sp);
              }},
              { label: "Export as SQL INSERTs...", icon: <Download className="w-3.5 h-3.5" />, onClick: async () => {
                const sp = await save({ defaultPath: await homeDir(), filters: [{ name: "SQL", extensions: ["sql"] }] });
                if (typeof sp === "string") await dbExportTableInserts(profileId, db, table, sp);
              }},
            ];

            return {
              id: `tbl::${profileId}::${db}::${table}`,
              label: table,
              icon: <Table2 className="w-3.5 h-3.5 text-blue-400/80" />,
              expandable: true,
              decorations: { badge: columns?.length },
              suffix: rowCount !== null ? (
                <span className="ml-1 shrink-0 rounded bg-muted/40 px-1 py-0.5 text-[9px] font-mono text-muted-foreground/70">
                  {rowCount.toLocaleString()} rows
                </span>
              ) : undefined,
              contextMenu: tableContextMenu,
              data: { profileId, database: db, table },
              children: [
                {
                  id: `cols::${profileId}::${db}::${table}`,
                  label: "Columns",
                  icon: <Columns3 className="w-3.5 h-3.5 text-sky-400/80" />,
                  expandable: true,
                  decorations: { badge: columns?.length },
                  children: colChildren,
                },
                {
                  id: `idxs::${profileId}::${db}::${table}`,
                  label: "Indexes",
                  icon: <Key className="w-3.5 h-3.5 text-amber-400/80" />,
                  expandable: true,
                  loadChildren: async () => {
                    const result = await dbQuery(profileId, `SHOW INDEX FROM \`${table.replace(/`/g, "``")}\` FROM \`${db.replace(/`/g, "``")}\``);
                    const grouped = new Map<string, { name: string; unique: boolean; columns: string[] }>();
                    for (const row of result[0]?.rows ?? []) {
                      const n = String(row[2] ?? "");
                      const u = Number(row[1] ?? 1) === 0;
                      const c = String(row[4] ?? "");
                      if (!grouped.has(n)) grouped.set(n, { name: n, unique: u, columns: [] });
                      if (c) grouped.get(n)?.columns.push(c);
                    }
                    const idxs = Array.from(grouped.values());
                    if (idxs.length === 0) return [{ id: `idx-none::${profileId}::${db}::${table}`, label: "No indexes", icon: <Key className="w-3 h-3 text-muted-foreground/40" />, disabled: true }];
                    return idxs.map((idx): TreeNode => ({
                      id: `idx::${profileId}::${db}::${table}::${idx.name}`,
                      label: idx.name,
                      icon: idx.unique ? <Key className="w-3 h-3 text-yellow-400" /> : <Link2 className="w-3 h-3 text-cyan-400" />,
                      suffix: <span className="ml-1 truncate text-[10px] font-mono text-muted-foreground/50">{idx.columns.join(", ")}</span>,
                    }));
                  },
                },
                {
                  id: `cons::${profileId}::${db}::${table}`,
                  label: "Constraints",
                  icon: <Shield className="w-3.5 h-3.5 text-rose-400/80" />,
                  expandable: true,
                  loadChildren: async () => {
                    const result = await dbQuery(profileId, `SELECT CONSTRAINT_NAME, CONSTRAINT_TYPE FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = ${escSqlString(db)} AND TABLE_NAME = ${escSqlString(table)} ORDER BY CONSTRAINT_TYPE, CONSTRAINT_NAME`);
                    const cons = (result[0]?.rows ?? []).map((row) => ({ name: String(row[0] ?? ""), type: String(row[1] ?? "") }));
                    if (cons.length === 0) return [{ id: `con-none::${profileId}::${db}::${table}`, label: "No constraints", icon: <Shield className="w-3 h-3 text-muted-foreground/40" />, disabled: true }];
                    return cons.map((c): TreeNode => ({
                      id: `con::${profileId}::${db}::${table}::${c.name}`,
                      label: c.name,
                      icon: <Shield className="w-3 h-3 text-rose-400/80" />,
                      suffix: <span className="ml-1 rounded bg-muted/40 px-1 py-0.5 text-[9px] font-mono text-muted-foreground/70">{c.type}</span>,
                    }));
                  },
                },
              ],
            };
          });

          // ── Views section ──────────────────────────────────────────────
          const viewsNode: TreeNode = {
            id: `views::${profileId}::${db}`,
            label: "Views",
            icon: <FolderKanban className="w-3.5 h-3.5 text-cyan-400/80" />,
            expandable: true,
            decorations: { badge: viewNames.length > 0 ? viewNames.length : undefined },
            children: viewNames.length === 0
              ? [{ id: `view-empty::${profileId}::${db}`, label: "No views", icon: <Table2 className="w-3 h-3 text-muted-foreground/40" />, disabled: true }]
              : viewNames.map((vn): TreeNode => ({
                  id: `view::${profileId}::${db}::${vn}`,
                  label: vn,
                  icon: <Table2 className="w-3.5 h-3.5 text-cyan-400/80" />,
                  data: { profileId, database: db, table: vn },
                })),
          };

          // ── Procedures section (async) ─────────────────────────────────
          const procsNode: TreeNode = {
            id: `procs::${profileId}::${db}`,
            label: "Procedures",
            icon: <ScrollText className="w-3.5 h-3.5 text-violet-400/80" />,
            expandable: true,
            loadChildren: async () => {
              const result = await dbQuery(profileId, `SELECT ROUTINE_NAME FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = ${escSqlString(db)} AND ROUTINE_TYPE = 'PROCEDURE' ORDER BY ROUTINE_NAME`);
              const names = result[0]?.rows.map((r) => r[0]).filter((v): v is string => typeof v === "string") ?? [];
              if (names.length === 0) return [{ id: `proc-none::${profileId}::${db}`, label: "No procedures", icon: <ScrollText className="w-3 h-3 text-muted-foreground/40" />, disabled: true }];
              return names.map((n): TreeNode => ({
                id: `proc::${profileId}::${db}::${n}`,
                label: n,
                icon: <ScrollText className="w-3.5 h-3.5 text-violet-400/80" />,
                data: { profileId, database: db, name: n, kind: "PROCEDURE" },
              }));
            },
          };

          // ── Functions section (async) ──────────────────────────────────
          const funcsNode: TreeNode = {
            id: `funcs::${profileId}::${db}`,
            label: "Functions",
            icon: <Braces className="w-3.5 h-3.5 text-emerald-400/80" />,
            expandable: true,
            loadChildren: async () => {
              const result = await dbQuery(profileId, `SELECT ROUTINE_NAME FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = ${escSqlString(db)} AND ROUTINE_TYPE = 'FUNCTION' ORDER BY ROUTINE_NAME`);
              const names = result[0]?.rows.map((r) => r[0]).filter((v): v is string => typeof v === "string") ?? [];
              if (names.length === 0) return [{ id: `func-none::${profileId}::${db}`, label: "No functions", icon: <Braces className="w-3 h-3 text-muted-foreground/40" />, disabled: true }];
              return names.map((n): TreeNode => ({
                id: `func::${profileId}::${db}::${n}`,
                label: n,
                icon: <Braces className="w-3.5 h-3.5 text-emerald-400/80" />,
                data: { profileId, database: db, name: n, kind: "FUNCTION" },
              }));
            },
          };

          const triggersNode: TreeNode = {
            id: `triggers::${profileId}::${db}`,
            label: "Triggers",
            icon: <Zap className="w-3.5 h-3.5 text-amber-400/80" />,
            expandable: true,
            loadChildren: async () => {
              const triggers = await dbListTriggers(profileId, db);
              if (triggers.length === 0) return [{ id: `trigger-none::${profileId}::${db}`, label: "No triggers", icon: <Zap className="w-3 h-3 text-muted-foreground/40" />, disabled: true }];
              return triggers.map((trigger): TreeNode => ({
                id: `trigger::${profileId}::${db}::${trigger.name}`,
                label: trigger.name,
                icon: <Zap className="w-3.5 h-3.5 text-amber-400/80" />,
                data: { profileId, database: db, name: trigger.name },
              }));
            },
          };

          const eventsNode: TreeNode = {
            id: `events::${profileId}::${db}`,
            label: "Events",
            icon: <AlertCircle className="w-3.5 h-3.5 text-orange-400/80" />,
            expandable: true,
            loadChildren: async () => {
              const events = await dbListEvents(profileId, db);
              if (events.length === 0) return [{ id: `event-none::${profileId}::${db}`, label: "No events", icon: <AlertCircle className="w-3 h-3 text-muted-foreground/40" />, disabled: true }];
              return events.map((event): TreeNode => ({
                id: `event::${profileId}::${db}::${event.name}`,
                label: event.name,
                icon: <AlertCircle className="w-3.5 h-3.5 text-orange-400/80" />,
                data: { profileId, database: db, name: event.name },
              }));
            },
          };

          // ── Database context menu ──────────────────────────────────────
          const dbContextMenu: ContextMenuItem[] = [
            { label: "Show Tables", icon: <Table2 className="w-3.5 h-3.5" />, onClick: () => openTab({ title: `Database: ${db}`, type: "database-view", meta: { profileId, profileName: name, database: db } }) },
            { label: "Schema Diagram", icon: <Link2 className="w-3.5 h-3.5" />, onClick: () => openTab({ title: `Diagram: ${db}`, type: "schema", meta: { profileId, database: db } }) },
            { label: "New Query", icon: <FileCode2 className="w-3.5 h-3.5" />, onClick: () => openTab({ title: "New Query", type: "sql", meta: { profileId, database: db } }) },
            { label: "Edit Database...", icon: <Pencil className="w-3.5 h-3.5" />, onClick: () => setEditDbState({ profileId, database: db }) },
            { label: "Refresh", icon: <RefreshCw className="w-3.5 h-3.5" />, onClick: () => { void useSchemaStore.getState().refreshTables(profileId, db); } },
            { label: "---", onClick: () => {}, separator: true },
            { label: "Import SQL File...", icon: <Import className="w-3.5 h-3.5" />, onClick: async () => {
              const fp = await open({ multiple: false, defaultPath: await homeDir(), filters: [{ name: "SQL Files", extensions: ["sql"] }] });
              if (typeof fp === "string") await runImportJob({ kind: "sql", targetLabel: db, filePath: fp, run: (jobId) => dbImportSql(profileId, db, fp, jobId) });
            }},
            { label: "Export as SQL Dump...", icon: <Download className="w-3.5 h-3.5" />, onClick: async () => {
              const sp = await save({ defaultPath: await homeDir(), filters: [{ name: "SQL", extensions: ["sql"] }] });
              if (typeof sp === "string") await dbExportSqlDump(profileId, db, sp);
            }},
            { label: "---", onClick: () => {}, separator: true },
            { label: "Create Table", icon: <Table2 className="w-3.5 h-3.5" />, onClick: () => openTab({ title: "Design: New Table", type: "table-designer", meta: { profileId, database: db, tableName: "" } }) },
            { label: "Open Query Builder", icon: <Braces className="w-3.5 h-3.5" />, onClick: () => openTab({ title: `Query Builder: ${db}`, type: "query-builder", meta: { profileId, database: db } }) },
            { label: "---", onClick: () => {}, separator: true },
            { label: "Drop Database", icon: <Trash className="w-3.5 h-3.5" />, danger: true, onClick: () => setDropDbState({ profileId, databases: [db] }) },
            { label: "---", onClick: () => {}, separator: true },
            { label: "Expand All", icon: <Maximize2 className="w-3.5 h-3.5" />, onClick: async () => {
              const store = useSchemaStore.getState();
              if (!store.tables[`${profileId}::${db}`]) await store.refreshTables(profileId, db);
              const tbls = useSchemaStore.getState().tables[`${profileId}::${db}`] ?? [];
              setExpandedIds((prev) => {
                const next = new Set(prev);
                next.add(`db::${profileId}::${db}`);
                for (const t of tbls) next.add(`tbl::${profileId}::${db}::${t}`);
                return next;
              });
            }},
            { label: "Collapse All", icon: <Minimize2 className="w-3.5 h-3.5" />, onClick: () => {
              setExpandedIds((prev) => {
                const next = new Set(prev);
                for (const id of [...next]) {
                  if (id.startsWith(`tbl::${profileId}::${db}::`) || id.startsWith(`cols::${profileId}::${db}::`) || id.startsWith(`idxs::${profileId}::${db}::`) || id.startsWith(`cons::${profileId}::${db}::`) || id === `views::${profileId}::${db}` || id === `procs::${profileId}::${db}` || id === `funcs::${profileId}::${db}` || id === `triggers::${profileId}::${db}` || id === `events::${profileId}::${db}`) {
                    next.delete(id);
                  }
                }
                return next;
              });
            }},
          ];

          // ── Build database node ────────────────────────────────────────
          let dbNodeChildren: TreeNode[];
          if (isLoadingTables && !tables) {
            dbNodeChildren = [{ id: `tbl-load::${profileId}::${db}`, label: "Loading tables...", icon: <Loader2 className="w-3 h-3 animate-spin opacity-60" />, disabled: true }];
          } else if (tblError) {
            dbNodeChildren = [{ id: `tbl-err::${profileId}::${db}`, label: tblError, icon: <AlertCircle className="w-3 h-3 text-red-400" />, disabled: true }];
          } else {
            dbNodeChildren = [...tableNodes, viewsNode, procsNode, funcsNode, triggersNode, eventsNode];
          }

          return {
            id: `db::${profileId}::${db}`,
            label: db,
            icon: <Database className="w-3.5 h-3.5 text-yellow-500/80" />,
            expandable: true,
            decorations: { badge: filteredTables?.length },
            contextMenu: dbContextMenu,
            children: dbNodeChildren,
          };
        });
        dbChildren = builtDbs.filter((n): n is TreeNode => n !== null);
      }

      // ── Profile icon with status dot ─────────────────────────────────────
      const Icon = DB_ICONS[profile.type] || Database;
      const profileIcon = (
        <div className="relative shrink-0">
          <Icon className="w-3.5 h-3.5" style={{ color: meta?.color ?? profile.color }} />
          {profile.connectionStatus === "connected" && (
            <span className="absolute -bottom-0.5 -right-0.5 w-[6px] h-[6px] bg-green-500 rounded-full border border-background" />
          )}
          {profile.connectionStatus === "error" && (
            <span className="absolute -bottom-0.5 -right-0.5 w-[6px] h-[6px] bg-red-500 rounded-full border border-background" />
          )}
        </div>
      );

      // ── Profile suffix (version, status badge, latency, refresh button) ─
      const profileSuffix = (
        <span className="ml-1 flex items-center gap-1 shrink-0">
          {serverVersion && (
            <span className="max-w-44 truncate rounded bg-muted/40 px-1.5 py-0.5 text-[9px] text-muted-foreground/80">{serverVersion}</span>
          )}
          <span className={cn("inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-medium", statusMeta.badgeClassName)}>
            <span className={cn("h-1.5 w-1.5 rounded-full", statusMeta.dotClassName)} />
            {statusMeta.label}
          </span>
          {latency !== null && (
            <span className={cn("text-[9px] tabular-nums font-mono px-1 rounded shrink-0",
              latency === -1 ? "text-red-400 bg-red-400/10" : latency > 200 ? "text-amber-400 bg-amber-400/10" : "text-muted-foreground/60"
            )}>
              {latency === -1 ? "err" : `${latency}ms`}
            </span>
          )}
          <button
            type="button"
            onClick={async (e) => {
              e.stopPropagation();
              const store = useSchemaStore.getState();
              await store.refreshDatabases(profileId);
              const knownDbs = useSchemaStore.getState().databases[profileId] ?? [];
              await Promise.allSettled(knownDbs.map((db) => useSchemaStore.getState().refreshTables(profileId, db)));
            }}
            className="rounded p-1 text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground"
            title={`Refresh all for ${name}`}
            aria-label={`Refresh all nodes for ${name}`}
          >
            <RefreshCw className="h-3 w-3" />
          </button>
        </span>
      );

      // ── Profile context menu ──────────────────────────────────────────────
      const serverContextMenu: ContextMenuItem[] = [
        { label: "Disconnect", icon: <PlugZap className="w-3.5 h-3.5 text-red-500" />, danger: true, onClick: async () => {
          appendConnectionOutput(profile, "info", `Disconnecting from ${formatConnectionTarget(profile)}...`);
          try {
            await dbDisconnect(profileId);
            appendConnectionOutput(profile, "success", `Disconnected from ${formatConnectionTarget(profile)}.`);
          } catch (e) {
            appendConnectionOutput(profile, "warning", `Disconnect failed for ${formatConnectionTarget(profile)}: ${formatOutputError(e)}`);
          }
          useProfilesStore.getState().setConnectionStatus(profileId, "disconnected");
          useSchemaStore.getState().removeConnection(profileId);
        }},
        { label: "Refresh", icon: <RefreshCw className="w-3.5 h-3.5" />, onClick: () => { void useSchemaStore.getState().refreshDatabases(profileId); } },
        { label: "Manage Users", icon: <Users className="w-3.5 h-3.5" />, onClick: () => openTab({ title: `Users: ${name}`, type: "users", meta: { profileId } }) },
        { label: "---", onClick: () => {}, separator: true },
        { label: "Create Database...", icon: <FolderPlus className="w-3.5 h-3.5" />, onClick: () => setCreateDbProfileId(profileId) },
        { label: "---", onClick: () => {}, separator: true },
        { label: "Expand All", icon: <Maximize2 className="w-3.5 h-3.5" />, onClick: async () => {
          const store = useSchemaStore.getState();
          let expandDbs = store.databases[profileId];
          if (!expandDbs) {
            await store.refreshDatabases(profileId);
            expandDbs = useSchemaStore.getState().databases[profileId] ?? [];
          }
          const newIds = new Set(expandedIdsRef.current);
          newIds.add(`prof::${profileId}`);
          await Promise.all((expandDbs ?? []).map(async (db) => {
            const ck = `${profileId}::${db}`;
            if (!useSchemaStore.getState().tables[ck]) await useSchemaStore.getState().refreshTables(profileId, db);
            newIds.add(`db::${profileId}::${db}`);
            for (const t of (useSchemaStore.getState().tables[ck] ?? [])) newIds.add(`tbl::${profileId}::${db}::${t}`);
          }));
          setExpandedIds(newIds);
        }},
        { label: "Collapse All", icon: <Minimize2 className="w-3.5 h-3.5" />, onClick: () => {
          setExpandedIds((prev) => {
            const next = new Set(prev);
            for (const id of [...next]) {
              if (id === `prof::${profileId}` || id === `sq::${profileId}` ||
                id.startsWith(`db::${profileId}::`) || id.startsWith(`tbl::${profileId}::`) ||
                id.startsWith(`cols::${profileId}::`) || id.startsWith(`idxs::${profileId}::`) ||
                id.startsWith(`cons::${profileId}::`) || id.startsWith(`views::${profileId}::`) ||
                id.startsWith(`procs::${profileId}::`) || id.startsWith(`funcs::${profileId}::`)) {
                next.delete(id);
              }
            }
            return next;
          });
        }},
      ];

      return {
        id: `prof::${profileId}`,
        label: name,
        icon: profileIcon,
        expandable: true,
        decorations: { badge: dbs?.length },
        suffix: profileSuffix,
        contextMenu: serverContextMenu,
        children: [savedQueriesNode, ...dbChildren],
      };
    });
  }, [
    connectedList, connectedProfiles, schemaDatabases, schemaTables, schemaColumns, tableInfos,
    loadingDatabases, loadingTables, loadingColumns, errors, latencies, serverVersions,
    dbFilter, tableFilter, savedQueriesByProfile, loadingSavedQueries, savedQueriesErrors,
    openTab, setCreateDbProfileId, setDropDbState, setEditDbState, runImportJob,
  ]);

  // ── Empty state ───────────────────────────────────────────────────────────
  if (connectedList.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-6 pt-10 text-center select-none gap-3">
        <div className="relative w-16 h-16 mx-auto">
          <div className="absolute inset-0 rounded-2xl bg-muted/40 border border-border/30" />
          <Server className="absolute inset-0 m-auto w-8 h-8 text-muted-foreground/25" />
          <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center">
            <Plus className="w-3.5 h-3.5 text-primary/60" />
          </div>
        </div>
        <div>
          <p className="text-xs font-semibold text-foreground/70 mb-1">No active connections</p>
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

  // ── Main render ───────────────────────────────────────────────────────────
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
            if (e.key === "ArrowDown") { e.preventDefault(); setSearchFocusIdx((i) => Math.min(i + 1, searchResults.length - 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setSearchFocusIdx((i) => Math.max(i - 1, 0)); }
            else if (e.key === "Enter" && searchResults.length > 0) { openSearchResult(searchResults[Math.max(0, Math.min(searchFocusIdx, searchResults.length - 1))]); }
            else if (e.key === "Escape") { setGlobalSearch(""); }
          }}
          className="bg-transparent border-none outline-none w-full text-[11px] text-foreground placeholder:text-muted-foreground/60 h-full"
        />
        {globalSearch && (
          <button type="button" className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground" onClick={() => setGlobalSearch("")} aria-label="Clear search">
            <X className="w-3 h-3" />
          </button>
        )}
      </div>

      {/* Filter Bar */}
      <div className="shrink-0 flex items-center h-6.5 border-b bg-muted/20 text-[11px]">
        <div className="flex-1 flex items-center h-full px-2 border-r focus-within:bg-muted/30 transition-colors">
          <Database className="w-3 h-3 text-muted-foreground mr-1.5 shrink-0" />
          <input type="text" placeholder="Database filter" value={dbFilter} onChange={(e) => setDbFilter(e.target.value)}
            className="bg-transparent border-none outline-none w-full text-foreground placeholder:text-muted-foreground/60 h-full" />
          {dbFilter && <button type="button" className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground" onClick={() => setDbFilter("")}><X className="w-3 h-3" /></button>}
        </div>
        <div className="flex-1 flex items-center h-full px-2 focus-within:bg-muted/30 transition-colors">
          <Table2 className="w-3 h-3 text-muted-foreground mr-1.5 shrink-0" />
          <input type="text" placeholder="Table filter" value={tableFilter} onChange={(e) => setTableFilter(e.target.value)}
            className="bg-transparent border-none outline-none w-full text-foreground placeholder:text-muted-foreground/60 h-full font-mono" />
          {tableFilter && <button type="button" className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground" onClick={() => setTableFilter("")}><X className="w-3 h-3" /></button>}
        </div>
      </div>

      {/* Global Search Results */}
      {globalSearch.trim() && (
        <div className="flex-1 overflow-y-auto overflow-x-hidden">
          {searchResults.length === 0 ? (
            <div className="px-3 py-4 text-[11px] text-muted-foreground text-center">No results</div>
          ) : (
            <div className="py-0.5">
              {searchResults.map((r, i) => (
                <button
                  key={i}
                  className={cn("w-full text-left px-3 py-1 flex flex-col gap-0.5 hover:bg-accent transition-colors", i === searchFocusIdx && "bg-accent")}
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
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tree */}
      {!globalSearch.trim() && (
        <div className="flex-1 overflow-y-auto overflow-x-hidden pt-1">
          <TreeView
            nodes={nodes}
            expandedIds={expandedIds}
            onExpandedChange={handleExpandedChange}
            selectedId={selectedId}
            onSelect={handleSelect}
            onActivate={handleActivate}
            indent={14}
            className="text-[12px]"
          />
        </div>
      )}

      {/* Drop Confirmation Modal */}
      {dropDbState && (
        <ConfirmModal
          title={`Drop ${dropDbState.databases.length > 1 ? `${dropDbState.databases.length} Databases` : "Database"}`}
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
                await dbExecuteQuery(pid, `DROP DATABASE \`${db.replace(/`/g, "``")}\``);
              } catch (e) {
                console.error(`Failed to drop ${db}:`, e);
              }
            }
            await useSchemaStore.getState().refreshDatabases(pid);
          }}
        />
      )}

      {/* Edit Database Modal */}
      {editDbState && (
        <EditDatabaseModal
          profileId={editDbState.profileId}
          database={editDbState.database}
          onClose={() => setEditDbState(null)}
          onCompleted={async () => {
            const { profileId: pid } = editDbState;
            setEditDbState(null);
            await useSchemaStore.getState().refreshDatabases(pid);
          }}
        />
      )}

      {/* Create Database Modal */}
      {createDbProfileId !== null && (
        <CreateDatabaseModal
          profileId={createDbProfileId}
          onClose={() => setCreateDbProfileId(null)}
          onCreated={async () => {
            if (createDbProfileId) await useSchemaStore.getState().refreshDatabases(createDbProfileId);
            setCreateDbProfileId(null);
          }}
        />
      )}

      {/* Import Progress Tracker */}
      {Object.keys(importJobs).length > 0 && (
        <div className="pointer-events-none absolute inset-x-2 bottom-2 z-30 flex max-h-64 flex-col gap-2 overflow-y-auto">
          {Object.values(importJobs)
            .sort((a, b) => a.fileName.localeCompare(b.fileName))
            .map((job) => {
              const percent = Math.max(0, Math.min(100, Math.round(job.percent || 0)));
              const toneClass = job.phase === "error" ? "border-red-500/40 bg-red-500/10" : job.phase === "completed" ? "border-green-500/40 bg-green-500/10" : "border-primary/30 bg-background/95";
              return (
                <div key={job.jobId} className={cn("pointer-events-auto rounded-lg border p-3 shadow-lg backdrop-blur", toneClass)}>
                  <div className="mb-2 flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-foreground">{job.kind.toUpperCase()} import</div>
                      <div className="truncate text-[11px] text-muted-foreground">{job.targetLabel}</div>
                    </div>
                    {(job.phase === "completed" || job.phase === "error") && (
                      <button type="button" onClick={() => setImportJobs((prev) => { const next = { ...prev }; delete next[job.jobId]; return next; })}
                        className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground" aria-label="Dismiss">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                  <div className="mb-2 h-2 overflow-hidden rounded-full bg-muted/40">
                    <div className={cn("h-full transition-[width]", job.phase === "error" ? "bg-red-400" : job.phase === "completed" ? "bg-green-400" : "bg-primary")}
                      style={{ width: `${job.phase === "error" ? percent : Math.max(percent, 4)}%` }} />
                  </div>
                  <div className="text-[11px] text-foreground">{job.message}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
                    <span>{job.fileName}</span>
                    {(job.rowsTotal > 0 || job.summary?.rowsAttempted) && <span>Rows {job.summary?.rowsCommitted ?? job.rowsProcessed}/{job.summary?.rowsAttempted ?? job.rowsTotal}</span>}
                    {(job.itemsTotal > 0 || job.summary?.itemsAttempted) && <span>Items {job.summary?.itemsCommitted ?? job.itemsProcessed}/{job.summary?.itemsAttempted ?? job.itemsTotal}</span>}
                    {job.summary && <span>Skipped {job.summary.rowsSkipped}</span>}
                  </div>
                </div>
              );
            })}
        </div>
      )}
    </div>
  );
}
