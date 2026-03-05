import { useState, useCallback, useRef, useMemo, useEffect } from "react";
import { dbQuery, QueryResultSet } from "@/lib/db";
import { useSchemaStore } from "@/state/schemaStore";
import { useLayoutStore } from "@/state/layoutStore";
import {
  Play,
  Square,
  Trash2,
  Copy,
  Download,
  Loader2,
  Server,
  Database,
  Clock,
  CheckCircle2,
  XCircle,
  AlertCircle,
  FileText,
  WrapText,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";

// ═══════════════════════════════════════════════════════════════════════
//  Types
// ═══════════════════════════════════════════════════════════════════════

interface Props {
  tabId: string;
  profileId: string;
  database?: string;
}

// ═══════════════════════════════════════════════════════════════════════
//  Component
// ═══════════════════════════════════════════════════════════════════════

export function QueryTab({ tabId, profileId, database: initialDatabase }: Props) {
  // ── State ──────────────────────────────────────────────────
  const [sql, setSql] = useState("");
  const [results, setResults] = useState<QueryResultSet[]>([]);
  const [hasRun, setHasRun] = useState(false);
  const [activeResultIdx, setActiveResultIdx] = useState(0);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [executionTime, setExecutionTime] = useState<number | null>(null);
  const [wordWrap, setWordWrap] = useState(false);

  // ── Cancellation token ────────────────────────────────────
  // Incrementing counter: if the token when a query starts differs from the
  // current one by the time it resolves, the result is discarded (soft-cancel).
  const runTokenRef = useRef(0);

  // ── Resizable split ───────────────────────────────────────
  const [splitPercent, setSplitPercent] = useState(40);
  const containerRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  // ── Database from schema store ────────────────────────────
  const connectedProfiles = useSchemaStore((s) => s.connectedProfiles);
  const updateTab = useLayoutStore((s) => s.updateTab);

  const [selectedProfileId, setSelectedProfileId] = useState(profileId);
  const [selectedDb, setSelectedDb] = useState(initialDatabase ?? "");

  const profileIds = useMemo(
    () => Object.keys(connectedProfiles),
    [connectedProfiles],
  );

  // Auto-update server selection if disconnected or initially empty
  useEffect(() => {
    if (!selectedProfileId || !connectedProfiles[selectedProfileId]) {
      if (profileIds.length > 0) {
        const fallbackId = profileIds.includes(profileId)
          ? profileId
          : profileIds[profileIds.length - 1];
        setSelectedProfileId(fallbackId);
      } else if (selectedProfileId !== "") {
        setSelectedProfileId("");
      }
    }
  }, [connectedProfiles, selectedProfileId, profileIds, profileId]);

  const storeDatabases = useSchemaStore((s) =>
    selectedProfileId ? s.databases[selectedProfileId] : undefined,
  );
  const databases = storeDatabases ?? [];

  // Auto-select database if unselected or old one disappeared
  useEffect(() => {
    if (databases.length > 0) {
      if (!selectedDb) {
        setSelectedDb(databases[0]);
      } else if (!databases.includes(selectedDb)) {
        setSelectedDb(databases[0]);
      }
    }
  }, [databases, selectedDb]);

  // Sync state to layout tab metadata
  useEffect(() => {
    if (tabId && selectedProfileId) {
      updateTab(tabId, {
        meta: {
          profileId: selectedProfileId,
          profileName: connectedProfiles[selectedProfileId]?.name || "Server",
          database: selectedDb,
        },
      });
    }
  }, [selectedProfileId, selectedDb, tabId, updateTab, connectedProfiles]);

  const handleRun = useCallback(async () => {
    if (!sql.trim() || running || !selectedProfileId) return;

    // Mint a new token for this execution
    const token = ++runTokenRef.current;

    setRunning(true);
    setError(null);
    setResults([]);
    setHasRun(false);
    setExecutionTime(null);

    const startTime = performance.now();

    try {
      // Escape backticks in the database name to avoid malformed USE statements
      // (e.g. a db named: test`db  →  USE `test``db`)
      let fullQuery = sql;
      if (selectedDb) {
        const escapedDb = selectedDb.replace(/`/g, "``");
        fullQuery = `USE \`${escapedDb}\`;\n${sql}`;
      }

      const res = await dbQuery(selectedProfileId, fullQuery);

      // Discard stale results if the user cancelled (soft-stop) and re-ran
      if (token !== runTokenRef.current) return;

      const elapsed = performance.now() - startTime;
      setExecutionTime(elapsed);

      // Drop the USE result (index 0) so callers only see their query results
      const filteredResults = selectedDb ? res.slice(1) : res;

      setResults(filteredResults);
      setHasRun(true);
      setActiveResultIdx(0);
    } catch (e) {
      if (token !== runTokenRef.current) return;
      const elapsed = performance.now() - startTime;
      setExecutionTime(elapsed);
      setError(String(e));
      setHasRun(true);
    } finally {
      if (token === runTokenRef.current) {
        setRunning(false);
      }
    }
  }, [sql, selectedProfileId, selectedDb, running]);

  // ── Stop (soft-cancel) ────────────────────────────────────
  // Advances the token so the in-flight result is discarded when it arrives.
  // The underlying DB query still runs to completion on the server side.
  const handleStop = useCallback(() => {
    if (!running) return;
    runTokenRef.current++;
    setRunning(false);
    setError("Query cancelled by user.");
    setHasRun(true);
  }, [running]);

  // ── Clear ─────────────────────────────────────────────────
  const handleClear = useCallback(() => {
    setSql("");
    setResults([]);
    setError(null);
    setExecutionTime(null);
    setHasRun(false);
  }, []);

  // ── Copy results ──────────────────────────────────────────
  const handleCopyResults = useCallback(async () => {
    const active = results[activeResultIdx];
    if (!active || active.rows.length === 0) return;

    const header = active.columns.join("\t");
    const rows = active.rows
      .map((r) => r.map((v) => (v === null ? "NULL" : String(v))).join("\t"))
      .join("\n");

    try {
      await navigator.clipboard.writeText(`${header}\n${rows}`);
    } catch {
      // Clipboard access denied — silently ignore (Tauri desktop context should allow it)
    }
  }, [results, activeResultIdx]);

  // ── Export CSV ─────────────────────────────────────────────
  const handleExportCSV = useCallback(() => {
    const active = results[activeResultIdx];
    if (!active || active.rows.length === 0) return;

    const escapeCSV = (val: string | number | null): string => {
      if (val === null) return "";
      const s = String(val);
      if (s.includes(",") || s.includes('"') || s.includes("\n")) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    };

    const header = active.columns.map((c) => escapeCSV(c)).join(",");
    const rows = active.rows
      .map((r) => r.map((v) => escapeCSV(v)).join(","))
      .join("\n");

    // UTF-8 BOM ensures Excel renders the file correctly
    const bom = "\uFEFF";
    const blob = new Blob([`${bom}${header}\n${rows}`], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `query_result_${Date.now()}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // Defer revocation to give the browser time to initiate the download
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [results, activeResultIdx]);

  // ── Drag handle ───────────────────────────────────────────
  const handleDragStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      draggingRef.current = true;
      const startY = e.clientY;
      const startSplit = splitPercent;

      const onMove = (ev: MouseEvent) => {
        if (!draggingRef.current || !containerRef.current) return;
        const rect = containerRef.current.getBoundingClientRect();
        const deltaY = ev.clientY - startY;
        const deltaPct = (deltaY / rect.height) * 100;
        const next = Math.min(80, Math.max(15, startSplit + deltaPct));
        setSplitPercent(next);
      };

      const onUp = () => {
        draggingRef.current = false;
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };

      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
      document.body.style.cursor = "row-resize";
      document.body.style.userSelect = "none";
    },
    [splitPercent],
  );

  // ── Current result set ────────────────────────────────────
  const activeResult = results[activeResultIdx] ?? null;

  // ── Row count summary ─────────────────────────────────────
  const statusText = useMemo(() => {
    if (running) return "Executing...";
    if (error) return "Error";
    if (results.length === 0) return hasRun ? "Done" : "Ready";
    const total = results.reduce((a, r) => a + r.rows.length, 0);
    return `${results.length} result set(s), ${total} total row(s)`;
  }, [running, error, results, hasRun]);

  // ── Keyboard shortcut ─────────────────────────────────────
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if ((e.ctrlKey && e.key === "Enter") || e.key === "F5") {
        e.preventDefault();
        handleRun();
      }
      if (e.key === "Escape" && running) {
        e.preventDefault();
        handleStop();
      }
    },
    [handleRun, handleStop, running],
  );

  // ═══════════════════════════════════════════════════════════
  //  Render
  // ═══════════════════════════════════════════════════════════

  return (
    <div
      ref={containerRef}
      className="flex flex-col w-full h-full bg-background text-foreground text-xs overflow-hidden"
    >
      {/* ─── Toolbar ─────────────────────────────────── */}
      <div className="flex items-center gap-0.5 px-2 py-1 border-b bg-muted/20 shrink-0">
        {/* Run */}
        <ToolBtn
          icon={
            running ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Play className="w-4 h-4" />
            )
          }
          title="Execute (Ctrl+Enter / F5)"
          onClick={handleRun}
          disabled={running || !sql.trim()}
          active={false}
          accent="text-green-500"
        />
        {/* Stop */}
        <ToolBtn
          icon={<Square className="w-4 h-4" />}
          title="Stop (Escape)"
          onClick={handleStop}
          disabled={!running}
          active={false}
        />

        <div className="w-px h-5 bg-border mx-1" />

        {/* Clear */}
        <ToolBtn
          icon={<Trash2 className="w-4 h-4" />}
          title="Clear editor and results"
          onClick={handleClear}
          disabled={running}
          active={false}
        />
        {/* Word Wrap */}
        <ToolBtn
          icon={<WrapText className="w-4 h-4" />}
          title="Toggle word wrap"
          onClick={() => setWordWrap((p) => !p)}
          disabled={false}
          active={wordWrap}
        />

        <div className="w-px h-5 bg-border mx-1" />

        {/* Copy */}
        <ToolBtn
          icon={<Copy className="w-4 h-4" />}
          title="Copy results to clipboard"
          onClick={handleCopyResults}
          disabled={!activeResult || activeResult.rows.length === 0}
          active={false}
        />
        {/* Export */}
        <ToolBtn
          icon={<Download className="w-4 h-4" />}
          title="Export results as CSV"
          onClick={handleExportCSV}
          disabled={!activeResult || activeResult.rows.length === 0}
          active={false}
        />

        {/* ─── Spacer ─── */}
        <div className="flex-1" />

        {/* ─── Server + Database indicator ─── */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1">
            <Server className="w-3 h-3 text-muted-foreground" />
            <select
              value={selectedProfileId}
              onChange={(e) => {
                setSelectedProfileId(e.target.value);
                setSelectedDb("");
              }}
              className="h-6 text-xs bg-secondary/50 border rounded px-1.5 focus:outline-none focus:ring-1 focus:ring-primary min-w-[120px] max-w-[150px] truncate"
            >
              <option value="">(no server)</option>
              {Object.entries(connectedProfiles).map(([id, p]) => (
                <option key={id} value={id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-1">
            <Database className="w-3 h-3 text-muted-foreground" />
            <select
              value={selectedDb}
              onChange={(e) => setSelectedDb(e.target.value)}
              className="h-6 text-xs bg-secondary/50 border rounded px-1.5 focus:outline-none focus:ring-1 focus:ring-primary min-w-[120px] max-w-[150px] truncate"
            >
              <option value="">(no database)</option>
              {databases.map((db) => (
                <option key={db} value={db}>
                  {db}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* ─── SQL Editor area ─────────────────────────── */}
      <div
        className="shrink-0 flex flex-col overflow-hidden"
        style={{ height: `${splitPercent}%` }}
      >
        <div className="flex-1 relative overflow-hidden">
          <textarea
            value={sql}
            onChange={(e) => setSql(e.target.value)}
            onKeyDown={handleKeyDown}
            className={cn(
              "w-full h-full bg-background resize-none outline-none text-foreground font-mono text-xs p-3 leading-relaxed",
              wordWrap
                ? "whitespace-pre-wrap break-all"
                : "whitespace-pre overflow-auto",
            )}
            spellCheck={false}
            placeholder="Enter SQL query here... (Ctrl+Enter to execute)"
          />
          <div className="absolute top-2 right-2 text-[10px] text-muted-foreground/40 select-none uppercase tracking-wider">
            SQL
          </div>
        </div>
      </div>

      {/* ─── Drag handle ─────────────────────────────── */}
      <div
        className="shrink-0 border-y border-border cursor-row-resize hover:bg-primary/20 active:bg-primary/30 transition-colors group flex items-center justify-center"
        style={{ height: 5 }}
        onMouseDown={handleDragStart}
      >
        <div className="w-8 h-[2px] rounded bg-muted-foreground/20 group-hover:bg-primary/50 transition-colors" />
      </div>

      {/* ─── Results area ─────────────────────────────── */}
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        {/* Results tab bar (when multiple result sets) */}
        {results.length > 1 && (
          <div className="flex items-center border-b bg-muted/20 px-1 gap-0 shrink-0 overflow-x-auto">
            {results.map((r, i) => (
              <button
                key={i}
                className={cn(
                  "flex items-center gap-1 px-3 py-1.5 text-xs transition-colors border-b-2 whitespace-nowrap",
                  activeResultIdx === i
                    ? "border-primary text-foreground font-medium"
                    : "border-transparent text-muted-foreground hover:text-foreground hover:bg-accent/30",
                )}
                onClick={() => setActiveResultIdx(i)}
              >
                <FileText className="w-3 h-3" />
                Result {i + 1}
                <span className="text-muted-foreground/60 ml-1">
                  ({r.rows.length}r × {r.columns.length}c)
                </span>
              </button>
            ))}
          </div>
        )}

        {/* Loading state */}
        {running && (
          <div className="flex-1 flex items-center justify-center text-muted-foreground/50">
            <div className="text-center">
              <Loader2 className="w-6 h-6 mx-auto mb-2 animate-spin opacity-50" />
              <div>Executing query…</div>
            </div>
          </div>
        )}

        {/* Error display */}
        {!running && error && (
          <div className="flex items-start gap-2 px-3 py-2 bg-red-500/10 text-red-400 border-b shrink-0">
            <XCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <pre className="text-xs font-mono whitespace-pre-wrap flex-1 select-text">
              {error}
            </pre>
          </div>
        )}

        {/* Results grid */}
        {!running && activeResult && activeResult.columns.length > 0 ? (
          <div className="flex-1 min-h-0 overflow-auto">
            <table className="min-w-max text-xs border-collapse">
              <thead>
                <tr className="bg-muted/50 sticky top-0 z-10">
                  <th className="text-center px-2 py-1.5 text-[10px] font-medium text-muted-foreground/70 uppercase tracking-wider border-b border-r bg-muted/80 w-[50px]">
                    #
                  </th>
                  {activeResult.columns.map((col, ci) => (
                    <th
                      key={ci}
                      className="text-left px-2 py-1.5 text-[10px] font-medium text-muted-foreground/70 uppercase tracking-wider border-b border-r bg-muted/80 whitespace-nowrap"
                    >
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {activeResult.rows.map((row, ri) => (
                  <tr
                    key={ri}
                    className="border-b hover:bg-accent/20 transition-colors"
                  >
                    <td className="text-center px-2 py-1 border-r text-muted-foreground/40 select-none">
                      {ri + 1}
                    </td>
                    {row.map((val, ci) => (
                      <td
                        key={ci}
                        className={cn(
                          "px-2 py-1 border-r font-mono max-w-[300px]",
                          val === null ? "text-muted-foreground/40 italic" : "",
                          wordWrap
                            ? "whitespace-pre-wrap break-all"
                            : "whitespace-nowrap truncate",
                        )}
                        title={val === null ? "NULL" : String(val)}
                      >
                        {val === null ? "NULL" : String(val)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : !running && !error && hasRun && results.length > 0 ? (
          /* DML/DDL success: no column data but query ran */
          <div className="flex-1 flex items-center justify-center text-muted-foreground/50">
            <div className="text-center">
              <CheckCircle2 className="w-6 h-6 mx-auto mb-2 text-green-400/50" />
              <div>{activeResult?.info || "Query executed successfully"}</div>
              {activeResult && activeResult.affected_rows > 0 && (
                <div className="text-[10px] mt-1 text-muted-foreground/40">
                  {activeResult.affected_rows} row(s) affected
                </div>
              )}
            </div>
          </div>
        ) : !running && !error && hasRun ? (
          /* Ran successfully, no result sets returned (e.g. SET, pure DDL) */
          <div className="flex-1 flex items-center justify-center text-muted-foreground/50">
            <div className="text-center">
              <CheckCircle2 className="w-6 h-6 mx-auto mb-2 text-green-400/50" />
              <div>Query executed successfully</div>
            </div>
          </div>
        ) : !running && !error ? (
          /* Never run yet */
          <div className="flex-1 flex items-center justify-center text-muted-foreground/30">
            <div className="text-center">
              <AlertCircle className="w-6 h-6 mx-auto mb-2 opacity-30" />
              <div>Run a query to see results here</div>
              <div className="text-[10px] mt-1">Ctrl+Enter or F5</div>
            </div>
          </div>
        ) : null}
      </div>

      {/* ─── Status bar ──────────────────────────────── */}
      <div className="flex items-center gap-3 px-3 py-1 border-t bg-muted/20 shrink-0 text-[10px]">
        <div
          className={cn(
            "flex items-center gap-1",
            running
              ? "text-yellow-400"
              : error
                ? "text-red-400"
                : results.length > 0
                  ? "text-green-400"
                  : "text-muted-foreground",
          )}
        >
          {running ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : error ? (
            <XCircle className="w-3 h-3" />
          ) : results.length > 0 ? (
            <CheckCircle2 className="w-3 h-3" />
          ) : (
            <AlertCircle className="w-3 h-3" />
          )}
          {statusText}
        </div>
        {executionTime !== null && (
          <div className="flex items-center gap-1 text-muted-foreground">
            <Clock className="w-3 h-3" />
            {executionTime < 1000
              ? `${Math.round(executionTime)}ms`
              : `${(executionTime / 1000).toFixed(2)}s`}
          </div>
        )}
        <div className="flex-1" />
        {activeResult && activeResult.rows.length > 0 && (
          <div className="text-muted-foreground">
            {activeResult.rows.length} row(s) × {activeResult.columns.length}{" "}
            col(s)
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
//  Toolbar button sub-component
// ═══════════════════════════════════════════════════════════════════════

function ToolBtn({
  icon,
  title,
  onClick,
  disabled,
  active,
  accent,
}: {
  icon: React.ReactNode;
  title: string;
  onClick: () => void;
  disabled: boolean;
  active: boolean;
  accent?: string;
}) {
  return (
    <button
      className={cn(
        "p-1.5 rounded transition-colors",
        disabled ? "opacity-30 pointer-events-none" : "hover:bg-accent",
        active && "bg-accent/60",
        accent && !disabled && accent,
      )}
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
    >
      {icon}
    </button>
  );
}
