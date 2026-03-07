import { useState, useCallback, useRef, useMemo, useEffect } from "react";
import { format as formatSqlInternal } from "sql-formatter";
import { dbQuery, QueryResultSet } from "@/lib/db";
import {
  highlightSQL,
  getActiveQueryRange,
  findMatchingBrackets,
} from "@/lib/sqlHighlight";
import {
  detectContext,
  getSuggestions,
  measureCursorPosition,
} from "@/lib/sqlSuggestions";
import type { Suggestion } from "@/lib/sqlSuggestions";
import { SqlAutocomplete } from "@/components/ui/SqlAutocomplete";
import { useSchemaStore } from "@/state/schemaStore";
import { useLayoutStore } from "@/state/layoutStore";
import { useAppStore } from "@/state/appStore";
import { useModelsStore } from "@/state/modelsStore";
import { aiGenerateQuery, dbGetSchemaDdl } from "@/lib/db";
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
  RotateCcw,
  AlignLeft,
  Bot
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

interface EditorEdit {
  value: string;
  selectionStart: number;
  selectionEnd: number;
}

const DEFAULT_QUERY_FONT_SIZE_PX = 12;
const MIN_QUERY_FONT_SIZE_PX = 10;
const MAX_QUERY_FONT_SIZE_PX = 24;
const MINIMAP_SELECTOR_MIN_HEIGHT_PX = 28;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function getSelectedLineRange(
  value: string,
  selectionStart: number,
  selectionEnd: number,
) {
  const start = Math.min(selectionStart, selectionEnd);
  const end = Math.max(selectionStart, selectionEnd);
  const effectiveEnd = end > start && value[end - 1] === "\n" ? end - 1 : end;

  const lineStart = value.lastIndexOf("\n", start - 1) + 1;
  const lineBreakIndex = value.indexOf("\n", effectiveEnd);
  const lineEnd = lineBreakIndex === -1 ? value.length : lineBreakIndex;
  const lineEndWithBreak =
    lineBreakIndex === -1 ? value.length : lineBreakIndex + 1;

  return {
    start,
    end,
    lineStart,
    lineEnd,
    lineEndWithBreak,
  };
}

function moveSelectedLines(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  direction: "up" | "down",
): EditorEdit | null {
  const { start, end, lineStart, lineEnd } = getSelectedLineRange(
    value,
    selectionStart,
    selectionEnd,
  );
  const selectedBlock = value.slice(lineStart, lineEnd);

  if (direction === "up") {
    if (lineStart === 0) return null;

    const aboveLineStart = value.lastIndexOf("\n", lineStart - 2) + 1;
    const aboveLine = value.slice(aboveLineStart, lineStart - 1);
    const beforeAbove = value.slice(0, aboveLineStart);
    const afterSelection = value.slice(lineEnd);

    const nextValue = `${beforeAbove}${selectedBlock}\n${aboveLine}${afterSelection}`;
    const delta = aboveLine.length + 1;
    return {
      value: nextValue,
      selectionStart: start - delta,
      selectionEnd: end - delta,
    };
  }

  if (lineEnd === value.length) return null;

  const nextLineStart = lineEnd + 1;
  const nextLineBreakIndex = value.indexOf("\n", nextLineStart);
  const nextLineEnd =
    nextLineBreakIndex === -1 ? value.length : nextLineBreakIndex;
  const nextLine = value.slice(nextLineStart, nextLineEnd);
  const beforeSelection = value.slice(0, lineStart);
  const afterNextLine = value.slice(nextLineEnd);
  const trailingBreak = nextLineBreakIndex === -1 ? "" : "\n";

  const nextValue = `${beforeSelection}${nextLine}\n${selectedBlock}${trailingBreak}${afterNextLine}`;
  const delta = nextLine.length + 1;
  return {
    value: nextValue,
    selectionStart: start + delta,
    selectionEnd: end + delta,
  };
}

function duplicateSelectedLines(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  direction: "up" | "down",
): EditorEdit {
  const { start, end, lineStart, lineEndWithBreak } = getSelectedLineRange(
    value,
    selectionStart,
    selectionEnd,
  );
  const selectedBlock = value.slice(lineStart, lineEndWithBreak);

  if (direction === "up") {
    const nextValue = `${value.slice(0, lineStart)}${selectedBlock}${value.slice(lineStart)}`;
    const delta = selectedBlock.length;
    return {
      value: nextValue,
      selectionStart: start + delta,
      selectionEnd: end + delta,
    };
  }

  const nextValue = `${value.slice(0, lineEndWithBreak)}${selectedBlock}${value.slice(lineEndWithBreak)}`;
  return {
    value: nextValue,
    selectionStart: start,
    selectionEnd: end,
  };
}

function toggleSqlComments(
  value: string,
  selectionStart: number,
  selectionEnd: number,
): EditorEdit {
  const { lineStart, lineEnd } = getSelectedLineRange(
    value,
    selectionStart,
    selectionEnd,
  );
  const selectedBlock = value.slice(lineStart, lineEnd);
  const lines = selectedBlock.split("\n");
  const shouldUncomment = lines.every(
    (line) => line.trim() === "" || line.trimStart().startsWith("--"),
  );

  const nextLines = lines.map((line) => {
    if (line.trim() === "") return line;
    if (shouldUncomment) {
      return line.replace(/^(\s*)--\s?/, "$1");
    }
    return line.replace(/^(\s*)/, "$1-- ");
  });

  const nextBlock = nextLines.join("\n");
  const nextValue = `${value.slice(0, lineStart)}${nextBlock}${value.slice(lineEnd)}`;

  return {
    value: nextValue,
    selectionStart: lineStart,
    selectionEnd: lineStart + nextBlock.length,
  };
}

function deleteSelectedLines(
  value: string,
  selectionStart: number,
  selectionEnd: number,
): EditorEdit {
  const { lineStart, lineEndWithBreak } = getSelectedLineRange(
    value,
    selectionStart,
    selectionEnd,
  );
  let removeStart = lineStart;
  const removeEnd = lineEndWithBreak;

  // Preserve valid line structure when deleting the final line.
  if (removeEnd === value.length && removeStart > 0) {
    removeStart -= 1;
  }

  const nextValue = `${value.slice(0, removeStart)}${value.slice(removeEnd)}`;
  const nextCursor = Math.min(removeStart, nextValue.length);

  return {
    value: nextValue,
    selectionStart: nextCursor,
    selectionEnd: nextCursor,
  };
}

// ═══════════════════════════════════════════════════════════════════════
//  Component
// ═══════════════════════════════════════════════════════════════════════

export function QueryTab({
  tabId,
  profileId,
  database: initialDatabase,
}: Props) {
  // ── State ──────────────────────────────────────────────────
  const [sql, setSql] = useState("");
  const [lastSavedSql, setLastSavedSql] = useState("");
  const [results, setResults] = useState<QueryResultSet[]>([]);
  const [hasRun, setHasRun] = useState(false);
  const [activeResultIdx, setActiveResultIdx] = useState(0);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [executionTime, setExecutionTime] = useState<number | null>(null);
  const [wordWrap, setWordWrap] = useState(false);
  const [editorFontSize, setEditorFontSize] = useState(
    DEFAULT_QUERY_FONT_SIZE_PX,
  );
  const [cursorPos, setCursorPos] = useState(0);
  const [selectedCharCount, setSelectedCharCount] = useState(0);
  const [editorViewport, setEditorViewport] = useState({
    scrollTop: 0,
    scrollHeight: 1,
    clientHeight: 1,
  });
  const [minimapTrackHeight, setMinimapTrackHeight] = useState(1);
  const [hasDbSelectionHistory, setHasDbSelectionHistory] = useState(
    initialDatabase !== undefined,
  );
  const [textareaContentWidth, setTextareaContentWidth] = useState(0);
  const [isFormatting, setIsFormatting] = useState(false);
  const [isAskingAI, setIsAskingAI] = useState(false);

  // ── Autocomplete state ──────────────────────────────────────
  const [acVisible, setAcVisible] = useState(false);
  const [acSelectedIdx, setAcSelectedIdx] = useState(0);
  const [acSuggestions, setAcSuggestions] = useState<Suggestion[]>([]);
  const [acPosition, setAcPosition] = useState({ top: 0, left: 0 });
  const [acPrefix, setAcPrefix] = useState("");
  const acDismissedForPrefix = useRef<string | null>(null);

  // ── Active query range ────────────────────────────────────
  const activeQueryRange = useMemo(() => {
    return getActiveQueryRange(sql, cursorPos, cursorPos + selectedCharCount);
  }, [sql, cursorPos, selectedCharCount]);

  useEffect(() => {
    setEditorFontSize((prev) =>
      clamp(prev, MIN_QUERY_FONT_SIZE_PX, MAX_QUERY_FONT_SIZE_PX),
    );
  }, []);

  const editorRef = useRef<HTMLTextAreaElement>(null);
  const lineNumberRef = useRef<HTMLDivElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);
  const pendingEditorSelectionRef = useRef<{
    start: number;
    end: number;
  } | null>(null);
  const minimapRef = useRef<HTMLButtonElement>(null);
  const minimapRafRef = useRef<number | null>(null);
  const minimapTargetScrollRef = useRef(0);
  const minimapDraggingRef = useRef(false);
  const minimapDragOffsetRef = useRef(0);

  // ── Matching brackets ─────────────────────────────────────
  const matchBrackets = useMemo(() => {
    return findMatchingBrackets(sql, cursorPos);
  }, [sql, cursorPos]);

  // Memoised highlighted HTML for the overlay
  const highlightedHTML = useMemo(() => {
    if (activeQueryRange) {
      return highlightSQL(
        sql,
        activeQueryRange.start,
        activeQueryRange.end,
        matchBrackets,
      );
    }
    return highlightSQL(sql, 0, sql.length, matchBrackets);
  }, [sql, activeQueryRange, matchBrackets]);

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

  // Schema data for autocomplete
  const storeTables = useSchemaStore((s) => s.tables);
  const storeColumns = useSchemaStore((s) => s.columns);

  const acSchemaInfo = useMemo(() => {
    const tables =
      selectedProfileId && selectedDb
        ? (storeTables[`${selectedProfileId}::${selectedDb}`] ?? [])
        : [];

    // Collect columns from all loaded tables in the selected db
    const columns: Array<{ name: string; type: string; table: string }> = [];
    if (selectedProfileId && selectedDb) {
      for (const table of tables) {
        const key = `${selectedProfileId}::${selectedDb}::${table}`;
        const cols = storeColumns[key];
        if (cols) {
          for (const c of cols) {
            columns.push({ name: c.name, type: c.col_type, table });
          }
        }
      }
    }

    return {
      databases,
      tables,
      columns,
      tablesForDb: (db: string) => {
        if (!selectedProfileId) return [];
        return storeTables[`${selectedProfileId}::${db}`] ?? [];
      },
      columnsForTable: (table: string) => {
        if (!selectedProfileId || !selectedDb) return [];
        const cols =
          storeColumns[`${selectedProfileId}::${selectedDb}::${table}`];
        return cols
          ? cols.map((c) => ({ name: c.name, type: c.col_type }))
          : [];
      },
    };
  }, [databases, selectedProfileId, selectedDb, storeTables, storeColumns]);

  // Auto-select database only for brand-new tabs with no DB selection history.
  useEffect(() => {
    if (databases.length === 0) {
      if (selectedDb) setSelectedDb("");
      return;
    }

    if (selectedDb && !databases.includes(selectedDb)) {
      setSelectedDb("");
      return;
    }

    if (!selectedDb && !hasDbSelectionHistory) {
      setSelectedDb(databases[0]);
      setHasDbSelectionHistory(true);
    }
  }, [databases, selectedDb, hasDbSelectionHistory]);

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

  // Sync dirty state
  useEffect(() => {
    if (tabId) {
      updateTab(tabId, { dirty: sql !== lastSavedSql });
    }
  }, [sql, lastSavedSql, tabId, updateTab]);

  const executeQuery = useCallback(
    async (queryText: string) => {
      if (!queryText.trim() || running || !selectedProfileId) return;

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
        let fullQuery = queryText;
        if (selectedDb) {
          const escapedDb = selectedDb.replace(/`/g, "``");
          fullQuery = `USE \`${escapedDb}\`;\n${queryText}`;
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
        setLastSavedSql(sql);
      } catch (e) {
        if (token !== runTokenRef.current) return;
        const elapsed = performance.now() - startTime;
        setExecutionTime(elapsed);
        setError(String(e));
        setHasRun(true);
        useAppStore.getState().addToast({
          title: "Query Error",
          description: String(e),
          variant: "destructive",
        });
      } finally {
        if (token === runTokenRef.current) {
          setRunning(false);
        }
      }
    },
    [selectedProfileId, selectedDb, running],
  );

  const handleFormat = useCallback(
    async (choice: "internal" | "sqlformat") => {
      const textToFormat = sql;
      if (!textToFormat.trim()) return;

      setIsFormatting(true);
      setError(null);

      try {
        let formatted = textToFormat;

        if (choice === "internal") {
          formatted = formatSqlInternal(textToFormat, { language: "mysql" });
        } else if (choice === "sqlformat") {
          const res = await fetch("https://sqlformat.org/api/v1/format", {
            method: "POST",
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
              Accept: "application/json",
            },
            body: new URLSearchParams({ sql: textToFormat, reindent: "1" }),
          });
          if (!res.ok)
            throw new Error(
              `sqlformat.org API failed with status: ${res.status}`,
            );
          const data = await res.json();
          formatted = data.result;
        }

        if (formatted && formatted !== sql) {
          setSql(formatted);
        }
      } catch (err: unknown) {
        if (err instanceof Error) {
          setError(`Formatting Error: ${err.message}`);
        } else {
          setError(`Formatting Error: ${String(err)}`);
        }
      } finally {
        setIsFormatting(false);
      }
    },
    [sql],
  );

  const handleRun = useCallback(() => executeQuery(sql), [executeQuery, sql]);
  const handleRunSelected = useCallback(() => {
    if (activeQueryRange) {
      executeQuery(activeQueryRange.text);
    }
  }, [executeQuery, activeQueryRange]);

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
    const blob = new Blob([`${bom}${header}\n${rows}`], {
      type: "text/csv;charset=utf-8;",
    });
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

  // ── Ask AI ─────────────────────────────────────────────────
  const handleAskAI = useCallback(async () => {
    const { selectedProviderId, providers } = useModelsStore.getState();
    const activeProvider = providers.find((p) => p.id === selectedProviderId);

    if (!activeProvider) {
      useAppStore.getState().addToast({
        title: "No AI Provider",
        description: "Please select an AI provider in the Models tab first.",
        variant: "destructive",
      });
      return;
    }

    const prompt = window.prompt("Ask AI to generate a SQL query:");
    if (!prompt || !prompt.trim()) return;

    setIsAskingAI(true);
    try {
      // Build full DDL schema context from the database
      let schemaContext = "No schema selected.";
      if (selectedDb) {
        try {
          schemaContext = await dbGetSchemaDdl(profileId, selectedDb);
        } catch {
          // Fallback: pass minimal context
          schemaContext = `Database: ${selectedDb} (DDL unavailable)`;
        }
      }

      const generatedSql = await aiGenerateQuery(
        activeProvider.type,
        activeProvider.baseUrl || null,
        activeProvider.apiKeyRef || "",
        activeProvider.defaultModelId || "",
        prompt,
        schemaContext,
        sql
      );

      // Insert at current cursor position
      const nextValue = `${sql.slice(0, cursorPos)}${generatedSql}${sql.slice(cursorPos)}`;
      const nextPos = cursorPos + generatedSql.length;
      setSql(nextValue);
      setCursorPos(nextPos);

      useAppStore.getState().addToast({
        title: "AI Response",
        description: "Query generated successfully.",
        variant: "default",
      });
    } catch (e: any) {
      console.error(e);
      useAppStore.getState().addToast({
        title: "AI Error",
        description: e.message || String(e),
        variant: "destructive",
      });
    } finally {
      setIsAskingAI(false);
    }
  }, [selectedDb, profileId, sql, cursorPos, setSql, setCursorPos]);

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

  const editorLineHeight = useMemo(
    () => Math.round(editorFontSize * 1.6 * 100) / 100,
    [editorFontSize],
  );
  const isDefaultEditorFontSize = editorFontSize === DEFAULT_QUERY_FONT_SIZE_PX;
  const lineCount = useMemo(() => Math.max(1, sql.split("\n").length), [sql]);

  const minimapSegments = useMemo(() => {
    const lines = sql.split("\n");
    const totalLines = Math.max(1, lines.length);
    const maxSegments = 220;
    const step = Math.max(1, Math.ceil(totalLines / maxSegments));
    const segments: Array<{
      top: number;
      height: number;
      width: number;
      opacity: number;
    }> = [];

    for (let i = 0; i < totalLines; i += step) {
      const chunk = lines.slice(i, i + step);
      const maxLen = chunk.reduce(
        (curr, line) => Math.max(curr, line.trimEnd().length),
        0,
      );
      const widthRatio = clamp(maxLen / 140, 0.08, 1);
      const top = (i / totalLines) * 100;
      const height = Math.max((step / totalLines) * 100, 0.45);

      segments.push({
        top,
        height,
        width: 12 + widthRatio * 88,
        opacity: 0.18 + widthRatio * 0.28,
      });
    }

    return segments;
  }, [sql]);
  const activeLine = useMemo(() => {
    const safePos = clamp(cursorPos, 0, sql.length);
    return sql.slice(0, safePos).split("\n").length;
  }, [cursorPos, sql]);
  const activeColumn = useMemo(() => {
    const safePos = clamp(cursorPos, 0, sql.length);
    const lineStart = sql.lastIndexOf("\n", safePos - 1) + 1;
    return safePos - lineStart + 1;
  }, [cursorPos, sql]);
  const totalCharCount = useMemo(() => sql.length, [sql]);

  // Active line highlight top offset (non-wrap only; wrap mode uses line-number container measurement)
  const activeLineTopPx = useMemo(() => {
    // padding-top of textarea is 12px (p-3)
    return (activeLine - 1) * editorLineHeight + 12;
  }, [activeLine, editorLineHeight]);

  const syncEditorMetrics = useCallback((textarea: HTMLTextAreaElement) => {
    setCursorPos(textarea.selectionStart);
    setSelectedCharCount(
      Math.abs(textarea.selectionEnd - textarea.selectionStart),
    );
    setEditorViewport({
      scrollTop: textarea.scrollTop,
      scrollHeight: Math.max(1, textarea.scrollHeight),
      clientHeight: Math.max(1, textarea.clientHeight),
    });
  }, []);

  const setEditorSelection = useCallback(
    (start: number, end: number = start) => {
      const textarea = editorRef.current;
      if (!textarea) return;
      textarea.focus();
      textarea.setSelectionRange(start, end);
      syncEditorMetrics(textarea);
    },
    [syncEditorMetrics],
  );

  const applyEditorEdit = useCallback(
    (edit: EditorEdit, currentValue: string) => {
      if (edit.value === currentValue) {
        setEditorSelection(edit.selectionStart, edit.selectionEnd);
        return;
      }

      pendingEditorSelectionRef.current = {
        start: edit.selectionStart,
        end: edit.selectionEnd,
      };
      setSql(edit.value);
    },
    [setEditorSelection],
  );

  // ── Autocomplete helpers ──────────────────────────────────
  const acTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const updateAutocompleteImmediate = useCallback(
    (text: string, pos: number, force = false) => {
      const textarea = editorRef.current;
      if (!textarea) {
        setAcVisible(false);
        return;
      }

      const ctx = detectContext(text, pos);

      // Require at least 1 char (or force via Ctrl+Space) to show popup
      if (
        !force &&
        ctx.prefix.length < 1 &&
        ctx.context !== "dot-table" &&
        ctx.context !== "dot-column"
      ) {
        setAcVisible(false);
        return;
      }

      // If user dismissed for this exact prefix, don't re-trigger
      if (!force && acDismissedForPrefix.current === ctx.prefix) {
        return;
      }

      const suggestions = getSuggestions(ctx, acSchemaInfo);

      if (suggestions.length === 0) {
        setAcVisible(false);
        return;
      }

      // Measure cursor position relative to the editor container
      const cursorPx = measureCursorPosition(textarea, pos);
      const lineHeight =
        parseFloat(getComputedStyle(textarea).lineHeight) || 20;

      setAcSuggestions(suggestions);
      setAcPrefix(ctx.prefix);
      setAcSelectedIdx(0);
      setAcPosition({
        top: cursorPx.top + lineHeight + 2,
        left: cursorPx.left,
      });
      setAcVisible(true);
      acDismissedForPrefix.current = null;
    },
    [acSchemaInfo],
  );

  // Debounced wrapper — avoids blocking every keystroke with DOM measurement
  const updateAutocomplete = useCallback(
    (text: string, pos: number, force = false) => {
      if (acTimerRef.current) clearTimeout(acTimerRef.current);
      if (force) {
        updateAutocompleteImmediate(text, pos, true);
        return;
      }
      acTimerRef.current = setTimeout(() => {
        updateAutocompleteImmediate(text, pos, false);
      }, 120);
    },
    [updateAutocompleteImmediate],
  );

  const dismissAutocomplete = useCallback(() => {
    if (acVisible) {
      acDismissedForPrefix.current = acPrefix;
    }
    setAcVisible(false);
  }, [acVisible, acPrefix]);

  const handleAcceptSuggestion = useCallback((suggestion: Suggestion) => {
    const textarea = editorRef.current;
    if (!textarea) return;

    const pos = textarea.selectionStart;
    const text = textarea.value;
    const insertText = suggestion.insertText ?? suggestion.label;

    // Find the start of the prefix being replaced
    const ctx = detectContext(text, pos);
    const prefixLen = ctx.prefix.length;
    const replaceStart = pos - prefixLen;

    const newText = text.slice(0, replaceStart) + insertText + text.slice(pos);
    const newCursor = replaceStart + insertText.length;

    pendingEditorSelectionRef.current = {
      start: newCursor,
      end: newCursor,
    };
    setSql(newText);
    setAcVisible(false);
    acDismissedForPrefix.current = null;

    // Re-trigger autocomplete after accepting (for chaining, e.g. after dot)
    setTimeout(() => {
      const ta = editorRef.current;
      if (ta) {
        ta.focus();
      }
    }, 0);
  }, []);

  // Dismiss autocomplete on blur/click elsewhere
  useEffect(() => {
    const handleClickOutside = () => {
      setAcVisible(false);
    };
    window.addEventListener("click", handleClickOutside);
    window.addEventListener("scroll", handleClickOutside, true);
    return () => {
      window.removeEventListener("click", handleClickOutside);
      window.removeEventListener("scroll", handleClickOutside, true);
    };
  }, []);

  useEffect(() => {
    const pending = pendingEditorSelectionRef.current;
    if (!pending) return;
    setEditorSelection(pending.start, pending.end);
    pendingEditorSelectionRef.current = null;
  }, [sql, setEditorSelection]);

  useEffect(() => {
    const textarea = editorRef.current;
    if (!textarea) return;
    syncEditorMetrics(textarea);
    if (lineNumberRef.current) {
      lineNumberRef.current.scrollTop = textarea.scrollTop;
    }
    if (highlightRef.current) {
      highlightRef.current.scrollTop = textarea.scrollTop;
      highlightRef.current.scrollLeft = textarea.scrollLeft;
    }
  }, [editorFontSize, splitPercent, syncEditorMetrics, wordWrap]);

  // Track textarea content width for word-wrap line number sync
  useEffect(() => {
    const textarea = editorRef.current;
    if (!textarea) return;

    const updateWidth = () => {
      // clientWidth excludes scrollbar; subtract horizontal padding (p-3 = 12px each side)
      setTextareaContentWidth(textarea.clientWidth - 24);
    };

    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(textarea);
    return () => observer.disconnect();
  }, [wordWrap]);

  useEffect(() => {
    const minimapEl = minimapRef.current;
    if (!minimapEl) return;

    const updateTrackHeight = () => {
      setMinimapTrackHeight(Math.max(1, minimapEl.clientHeight));
    };

    updateTrackHeight();
    const observer = new ResizeObserver(updateTrackHeight);
    observer.observe(minimapEl);
    return () => observer.disconnect();
  }, [splitPercent]);

  const minimapViewportHeightPx = useMemo(() => {
    const ratio = editorViewport.clientHeight / editorViewport.scrollHeight;
    const proportionalHeight = ratio * minimapTrackHeight;
    return clamp(
      proportionalHeight,
      MINIMAP_SELECTOR_MIN_HEIGHT_PX,
      minimapTrackHeight,
    );
  }, [
    editorViewport.clientHeight,
    editorViewport.scrollHeight,
    minimapTrackHeight,
  ]);
  const minimapViewportTopPx = useMemo(() => {
    if (editorViewport.scrollHeight <= editorViewport.clientHeight) return 0;
    const maxScroll = Math.max(
      0,
      editorViewport.scrollHeight - editorViewport.clientHeight,
    );
    const maxTop = Math.max(0, minimapTrackHeight - minimapViewportHeightPx);
    const ratio = maxScroll === 0 ? 0 : editorViewport.scrollTop / maxScroll;
    return clamp(ratio * maxTop, 0, maxTop);
  }, [
    editorViewport.clientHeight,
    editorViewport.scrollHeight,
    editorViewport.scrollTop,
    minimapTrackHeight,
    minimapViewportHeightPx,
  ]);

  const handleEditorScroll = useCallback(
    (e: React.UIEvent<HTMLTextAreaElement>) => {
      if (lineNumberRef.current) {
        lineNumberRef.current.scrollTop = e.currentTarget.scrollTop;
      }
      if (highlightRef.current) {
        highlightRef.current.scrollTop = e.currentTarget.scrollTop;
        highlightRef.current.scrollLeft = e.currentTarget.scrollLeft;
      }
      syncEditorMetrics(e.currentTarget);
    },
    [syncEditorMetrics],
  );

  const handleEditorSelectionChange = useCallback(
    (e: React.SyntheticEvent<HTMLTextAreaElement>) => {
      syncEditorMetrics(e.currentTarget);
    },
    [syncEditorMetrics],
  );

  const handleResetEditorFontSize = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      e.preventDefault();
      e.stopPropagation();
      setEditorFontSize(DEFAULT_QUERY_FONT_SIZE_PX);
    },
    [],
  );

  const animateMinimapScroll = useCallback(() => {
    if (minimapRafRef.current !== null) return;

    const step = () => {
      const textarea = editorRef.current;
      if (!textarea) {
        minimapRafRef.current = null;
        return;
      }

      const targetScrollTop = minimapTargetScrollRef.current;
      const delta = targetScrollTop - textarea.scrollTop;
      const isCloseEnough = Math.abs(delta) < 0.5;
      const nextTop = isCloseEnough
        ? targetScrollTop
        : textarea.scrollTop + delta * 0.28;

      textarea.scrollTop = nextTop;
      if (lineNumberRef.current) {
        lineNumberRef.current.scrollTop = nextTop;
      }
      if (highlightRef.current) {
        highlightRef.current.scrollTop = nextTop;
      }
      syncEditorMetrics(textarea);

      if (isCloseEnough && !minimapDraggingRef.current) {
        minimapRafRef.current = null;
        return;
      }

      minimapRafRef.current = requestAnimationFrame(step);
    };

    minimapRafRef.current = requestAnimationFrame(step);
  }, [syncEditorMetrics]);

  const setMinimapTargetFromClientY = useCallback(
    (clientY: number, minimapEl: HTMLButtonElement, dragOffset: number) => {
      const textarea = editorRef.current;
      if (!textarea) return;

      const rect = minimapEl.getBoundingClientRect();
      if (rect.height <= 0) return;

      const selectorHeight = clamp(
        (textarea.clientHeight / textarea.scrollHeight) * rect.height,
        MINIMAP_SELECTOR_MIN_HEIGHT_PX,
        rect.height,
      );
      const maxSelectorTop = Math.max(0, rect.height - selectorHeight);
      const selectorTop = clamp(
        clientY - rect.top - dragOffset,
        0,
        maxSelectorTop,
      );
      const scrollRatio =
        maxSelectorTop === 0 ? 0 : selectorTop / maxSelectorTop;
      const maxScroll = Math.max(
        0,
        textarea.scrollHeight - textarea.clientHeight,
      );

      minimapTargetScrollRef.current = scrollRatio * maxScroll;
      animateMinimapScroll();
    },
    [animateMinimapScroll],
  );

  const handleMinimapDragMove = useCallback(
    (e: MouseEvent) => {
      const minimapEl = minimapRef.current;
      if (!minimapDraggingRef.current || !minimapEl) return;
      setMinimapTargetFromClientY(
        e.clientY,
        minimapEl,
        minimapDragOffsetRef.current,
      );
    },
    [setMinimapTargetFromClientY],
  );

  const stopMinimapDrag = useCallback(() => {
    if (!minimapDraggingRef.current) return;
    minimapDraggingRef.current = false;
    window.removeEventListener("mousemove", handleMinimapDragMove);
    window.removeEventListener("mouseup", stopMinimapDrag);
  }, [handleMinimapDragMove]);

  const handleMinimapMouseDown = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      e.preventDefault();
      const minimapEl = e.currentTarget;
      minimapRef.current = minimapEl;

      const rect = minimapEl.getBoundingClientRect();
      const pointerY = clamp(e.clientY - rect.top, 0, rect.height);
      const viewportTopPx = minimapViewportTopPx;
      const viewportHeightPx = minimapViewportHeightPx;
      const pointerInsideViewport =
        pointerY >= viewportTopPx &&
        pointerY <= viewportTopPx + viewportHeightPx;

      minimapDragOffsetRef.current = pointerInsideViewport
        ? pointerY - viewportTopPx
        : viewportHeightPx / 2;

      minimapDraggingRef.current = true;
      window.addEventListener("mousemove", handleMinimapDragMove);
      window.addEventListener("mouseup", stopMinimapDrag);

      setMinimapTargetFromClientY(
        e.clientY,
        minimapEl,
        minimapDragOffsetRef.current,
      );
    },
    [
      handleMinimapDragMove,
      minimapViewportHeightPx,
      minimapViewportTopPx,
      setMinimapTargetFromClientY,
      stopMinimapDrag,
    ],
  );

  useEffect(
    () => () => {
      stopMinimapDrag();
      if (minimapRafRef.current !== null) {
        cancelAnimationFrame(minimapRafRef.current);
        minimapRafRef.current = null;
      }
    },
    [stopMinimapDrag],
  );

  // ── Keyboard shortcut ─────────────────────────────────────
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      const editorValue = e.currentTarget.value;
      const { selectionStart, selectionEnd } = e.currentTarget;
      const modKey = e.ctrlKey || e.metaKey;
      const lowered = e.key.toLowerCase();

      // ── Bracket / Quote wrapping ──
      const wrapPairs: Record<string, string> = {
        "(": ")",
        "[": "]",
        "{": "}",
        "'": "'",
        '"': '"',
        "`": "`",
      };

      if (
        selectionStart !== selectionEnd &&
        wrapPairs[e.key] &&
        !modKey &&
        !e.altKey &&
        !e.ctrlKey &&
        !e.metaKey
      ) {
        e.preventDefault();
        const start = Math.min(selectionStart, selectionEnd);
        const end = Math.max(selectionStart, selectionEnd);
        const selectedText = editorValue.slice(start, end);
        const nextValue = `${editorValue.slice(0, start)}${e.key}${selectedText}${wrapPairs[e.key]}${editorValue.slice(end)}`;

        applyEditorEdit(
          {
            value: nextValue,
            selectionStart: start + 1,
            selectionEnd: end + 1, // keep selection inside brackets
          },
          editorValue,
        );
        return;
      }

      // ── Autocomplete keyboard handling ──────────────────────
      if (acVisible && acSuggestions.length > 0) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setAcSelectedIdx((prev) =>
            Math.min(prev + 1, acSuggestions.length - 1),
          );
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setAcSelectedIdx((prev) => Math.max(prev - 1, 0));
          return;
        }
        if (e.key === "Tab" || e.key === "Enter") {
          e.preventDefault();
          handleAcceptSuggestion(acSuggestions[acSelectedIdx]);
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          dismissAutocomplete();
          return;
        }
      }

      // Ctrl+Space: force trigger autocomplete
      if (modKey && e.key === " ") {
        e.preventDefault();
        updateAutocomplete(editorValue, selectionStart, true);
        return;
      }
      const isIncreaseFontShortcut =
        modKey &&
        e.shiftKey &&
        (e.key === "+" ||
          e.key === "=" ||
          e.code === "Equal" ||
          e.code === "NumpadAdd");
      const isDecreaseFontShortcut =
        modKey &&
        e.shiftKey &&
        (e.key === "-" ||
          e.key === "_" ||
          e.code === "Minus" ||
          e.code === "NumpadSubtract");

      if (isIncreaseFontShortcut || isDecreaseFontShortcut) {
        e.preventDefault();
        setEditorFontSize((prev) =>
          clamp(
            prev + (isIncreaseFontShortcut ? 1 : -1),
            MIN_QUERY_FONT_SIZE_PX,
            MAX_QUERY_FONT_SIZE_PX,
          ),
        );
        return;
      }

      // Alt+Z: toggle word wrap
      if (e.altKey && !e.shiftKey && !modKey && lowered === "z") {
        e.preventDefault();
        setWordWrap((p) => !p);
        return;
      }

      if (modKey && e.shiftKey && e.key === "Enter") {
        e.preventDefault();
        handleRunSelected();
        return;
      }

      if ((modKey && e.key === "Enter") || e.key === "F5") {
        e.preventDefault();
        handleRun();
        return;
      }
      if (e.key === "Escape" && running) {
        e.preventDefault();
        handleStop();
        return;
      }

      if (modKey && lowered === "g") {
        e.preventDefault();
        const rawInput = window.prompt(
          "Go to line[:column]",
          `${activeLine}:${activeColumn}`,
        );
        if (rawInput === null) return;

        const match = rawInput.trim().match(/^(\d+)(?::(\d+))?$/);
        if (!match) return;

        const requestedLine = Number(match[1]);
        const requestedCol = Number(match[2] || 1);
        const lineStarts = [0];
        for (let i = 0; i < editorValue.length; i++) {
          if (editorValue[i] === "\n") lineStarts.push(i + 1);
        }

        const lineIndex = clamp(requestedLine - 1, 0, lineStarts.length - 1);
        const lineStart = lineStarts[lineIndex];
        const lineEnd =
          lineIndex + 1 < lineStarts.length
            ? lineStarts[lineIndex + 1] - 1
            : editorValue.length;
        const colIndex = clamp(
          requestedCol - 1,
          0,
          Math.max(0, lineEnd - lineStart),
        );
        const nextPos = lineStart + colIndex;
        setEditorSelection(nextPos, nextPos);
        return;
      }

      if (modKey && lowered === "/") {
        e.preventDefault();
        const edit = toggleSqlComments(
          editorValue,
          selectionStart,
          selectionEnd,
        );
        applyEditorEdit(edit, editorValue);
        return;
      }

      if (modKey && e.shiftKey && lowered === "k") {
        e.preventDefault();
        const edit = deleteSelectedLines(
          editorValue,
          selectionStart,
          selectionEnd,
        );
        applyEditorEdit(edit, editorValue);
        return;
      }

      if (modKey && lowered === "l") {
        e.preventDefault();
        const { lineStart, lineEnd } = getSelectedLineRange(
          editorValue,
          selectionStart,
          selectionEnd,
        );
        setEditorSelection(lineStart, lineEnd);
        return;
      }

      if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
        e.preventDefault();

        if (e.shiftKey) {
          const edit = duplicateSelectedLines(
            editorValue,
            selectionStart,
            selectionEnd,
            e.key === "ArrowUp" ? "up" : "down",
          );
          applyEditorEdit(edit, editorValue);
          return;
        }

        const edit = moveSelectedLines(
          editorValue,
          selectionStart,
          selectionEnd,
          e.key === "ArrowUp" ? "up" : "down",
        );
        if (edit) applyEditorEdit(edit, editorValue);
      }
    },
    [
      acSelectedIdx,
      acSuggestions,
      acVisible,
      activeColumn,
      activeLine,
      applyEditorEdit,
      dismissAutocomplete,
      handleAcceptSuggestion,
      handleRun,
      handleRunSelected,
      handleStop,
      running,
      setEditorSelection,
      updateAutocomplete,
    ],
  );

  // ═══════════════════════════════════════════════════════════
  //  Render
  // ═══════════════════════════════════════════════════════════

  return (
    <div
      ref={containerRef}
      className="flex flex-col w-full h-full bg-background text-foreground text-xs overflow-hidden min-w-0 min-h-0"
    >
      {/* ─── Toolbar ─────────────────────────────────── */}
      <div className="flex items-center gap-0.5 px-2 py-1 border-b bg-muted/20 shrink-0 overflow-x-auto min-h-0">
        {/* Run */}
        <ToolBtn
          icon={
            running ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Play className="w-4 h-4" />
            )
          }
          title="Execute All (Ctrl+Enter / F5)"
          onClick={handleRun}
          disabled={running || !sql.trim()}
          active={false}
          accent="text-green-500"
          label={
            activeQueryRange && activeQueryRange.text.trim() !== sql.trim()
              ? "Run All"
              : "Run"
          }
        />
        {/* Run Selected */}
        {activeQueryRange &&
          activeQueryRange.text.trim().length > 0 &&
          activeQueryRange.text.trim() !== sql.trim() && (
            <ToolBtn
              icon={<Play className="w-4 h-4" />}
              title="Execute Selected Query (Ctrl+Shift+Enter)"
              onClick={handleRunSelected}
              disabled={running}
              active={false}
              accent="text-blue-500"
              label="Run Selected"
            />
          )}
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
        {/* Wrap Text */}
        <button
          type="button"
          title="Wrap text (Alt+Z)"
          aria-label="Wrap text"
          onClick={() => setWordWrap((p) => !p)}
          className={cn(
            "h-7 inline-flex items-center gap-1 px-2 rounded transition-colors text-[11px]",
            wordWrap
              ? "bg-accent/70 text-foreground"
              : "text-muted-foreground hover:bg-accent hover:text-foreground",
          )}
        >
          <WrapText className="w-3.5 h-3.5" />
          <span>Wrap Text</span>
        </button>

        <div className="w-px h-5 bg-border mx-1" />

        {/* Ask AI */}
        <ToolBtn
          icon={
            isAskingAI ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Bot className="w-4 h-4" />
            )
          }
          title="Ask AI to generate a query based on the schema"
          onClick={handleAskAI}
          disabled={running || isAskingAI}
          active={false}
          accent="text-indigo-400"
          label="Ask AI"
        />

        <div className="w-px h-5 bg-border mx-1" />

        {/* Format SQL */}
        <div className="relative flex items-center h-7 px-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors overflow-hidden">
          <div className="flex items-center pointer-events-none">
            {isFormatting ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <AlignLeft className="w-3.5 h-3.5 text-blue-400 group-hover:text-blue-500" />
            )}
          </div>
          <select
            value=""
            onChange={(e) => {
              if (e.target.value) handleFormat(e.target.value as any);
            }}
            disabled={isFormatting || !sql.trim()}
            className="h-full bg-transparent text-[11px] font-medium pl-1 pr-1 focus:outline-none appearance-none cursor-pointer"
            title="Format SQL"
          >
            <option value="" disabled>
              Format SQL
            </option>
            <option value="internal">Internal (offline)</option>
            <option value="sqlformat">sqlformat.org (online)</option>
          </select>
        </div>

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
              value={
                selectedProfileId && connectedProfiles[selectedProfileId]
                  ? selectedProfileId
                  : (profileIds[0] ?? "")
              }
              onChange={(e) => {
                setSelectedProfileId(e.target.value);
                setSelectedDb("");
              }}
              disabled={profileIds.length === 0}
              className="h-6 text-xs bg-secondary/50 border rounded px-1.5 focus:outline-none focus:ring-1 focus:ring-primary min-w-30 max-w-37.5 truncate"
            >
              {profileIds.length === 0 && <option value="">(no server)</option>}
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
              onChange={(e) => {
                setSelectedDb(e.target.value);
                setHasDbSelectionHistory(true);
              }}
              disabled={
                !selectedProfileId || !connectedProfiles[selectedProfileId]
              }
              className="h-6 text-xs bg-secondary/50 border rounded px-1.5 focus:outline-none focus:ring-1 focus:ring-primary min-w-30 max-w-37.5 truncate"
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
        <div className="flex-1 relative overflow-hidden flex">
          {/* ── Line number gutter ── */}
          <div
            ref={lineNumberRef}
            className="w-12 shrink-0 overflow-hidden"
            style={{ backgroundColor: "rgba(30,30,30,0.6)" }}
            aria-hidden="true"
          >
            {wordWrap && textareaContentWidth > 0 ? (
              <div className="py-3">
                {sql.split("\n").map((lineText, idx) => (
                  <div key={idx} className="relative overflow-hidden">
                    <div
                      className={cn(
                        "px-2 text-right font-mono select-none absolute top-0 inset-x-0",
                        idx + 1 === activeLine
                          ? "text-foreground"
                          : "text-muted-foreground/50",
                      )}
                      style={{
                        fontSize: `${editorFontSize}px`,
                        lineHeight: `${editorLineHeight}px`,
                      }}
                    >
                      {idx + 1}
                    </div>
                    <div
                      className="invisible whitespace-pre-wrap break-all font-mono"
                      style={{
                        width: textareaContentWidth,
                        fontSize: `${editorFontSize}px`,
                        lineHeight: `${editorLineHeight}px`,
                      }}
                    >
                      {lineText || "\u200B"}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="py-3">
                {Array.from({ length: lineCount }, (_, idx) => (
                  <div
                    key={idx}
                    className={cn(
                      "px-2 text-right font-mono select-none",
                      idx + 1 === activeLine
                        ? "text-foreground"
                        : "text-muted-foreground/50",
                    )}
                    style={{
                      fontSize: `${editorFontSize}px`,
                      lineHeight: `${editorLineHeight}px`,
                    }}
                  >
                    {idx + 1}
                  </div>
                ))}
              </div>
            )}
          </div>
          {/* ── Textarea + syntax highlight overlay ── */}
          <div className="relative flex-1 min-w-0 bg-background">
            {/* Active line highlight */}
            {!wordWrap && (
              <div
                className="absolute left-0 right-0 pointer-events-none z-0"
                style={{
                  top: `${activeLineTopPx - editorViewport.scrollTop}px`,
                  height: `${editorLineHeight}px`,
                  backgroundColor: "rgba(255,255,255,0.04)",
                }}
              />
            )}
            {/* Syntax highlight overlay (behind the textarea) */}
            <div
              ref={highlightRef}
              className="absolute inset-0 overflow-hidden pointer-events-none z-0 p-3 font-mono"
              aria-hidden="true"
            >
              <pre
                className={cn(
                  "m-0",
                  wordWrap ? "whitespace-pre-wrap break-all" : "whitespace-pre",
                )}
                style={{
                  fontSize: `${editorFontSize}px`,
                  lineHeight: `${editorLineHeight}px`,
                }}
                dangerouslySetInnerHTML={{ __html: highlightedHTML }}
              />
            </div>
            <textarea
              ref={editorRef}
              value={sql}
              onChange={(e) => {
                const newVal = e.target.value;
                const newPos = e.target.selectionStart;
                setSql(newVal);
                syncEditorMetrics(e.target);
                updateAutocomplete(newVal, newPos);
              }}
              onScroll={handleEditorScroll}
              onSelect={handleEditorSelectionChange}
              onKeyUp={handleEditorSelectionChange}
              onClick={handleEditorSelectionChange}
              onKeyDown={handleKeyDown}
              className={cn(
                "w-full h-full bg-transparent resize-none outline-none text-transparent font-mono p-3 relative z-1 caret-white placeholder:text-muted-foreground/30",
                wordWrap
                  ? "whitespace-pre-wrap break-all overflow-auto"
                  : "whitespace-pre overflow-auto",
              )}
              style={{
                fontSize: `${editorFontSize}px`,
                lineHeight: `${editorLineHeight}px`,
              }}
              spellCheck={false}
              placeholder="Enter SQL query here... (Ctrl+Enter to execute)"
            />
            {!isDefaultEditorFontSize && (
              <button
                type="button"
                className="absolute top-1 right-10 z-10 inline-flex items-center gap-1 rounded border bg-background/95 px-2 py-1 text-[10px] text-muted-foreground hover:text-foreground hover:bg-accent/70 transition-colors"
                onClick={handleResetEditorFontSize}
                title="Reset editor font size"
                aria-label="Reset editor font size"
              >
                <RotateCcw className="w-3 h-3" />
                Reset Font-Size
              </button>
            )}
            <div className="absolute top-2 right-4 text-[10px] text-muted-foreground/40 select-none uppercase tracking-wider pointer-events-none z-2">
              SQL
            </div>
            {/* Autocomplete popup */}
            <SqlAutocomplete
              suggestions={acSuggestions}
              selectedIndex={acSelectedIdx}
              prefix={acPrefix}
              position={acPosition}
              onAccept={handleAcceptSuggestion}
              onSelectedIndexChange={setAcSelectedIdx}
              visible={acVisible}
            />
          </div>
          <div className="w-20 shrink-0 border-l bg-muted/20 relative overflow-hidden">
            <button
              ref={minimapRef}
              type="button"
              className="absolute inset-0 cursor-pointer bg-muted/15"
              onMouseDown={handleMinimapMouseDown}
              aria-label="Navigate editor via minimap"
            >
              <span className="absolute inset-0 pointer-events-none">
                {minimapSegments.map((segment, idx) => (
                  <span
                    key={idx}
                    className="absolute left-1.5 rounded-[1px] bg-muted-foreground"
                    style={{
                      top: `${segment.top}%`,
                      height: `${segment.height}%`,
                      width: `${segment.width}%`,
                      opacity: segment.opacity,
                    }}
                  />
                ))}
              </span>
              <span
                className="absolute left-0.5 right-0.5 border border-muted-foreground/45 bg-muted-foreground/10 pointer-events-none rounded-[2px]"
                style={{
                  top: `${minimapViewportTopPx}px`,
                  height: `${minimapViewportHeightPx}px`,
                }}
              >
                <span className="absolute top-0.5 left-1/2 -translate-x-1/2 h-0.5 w-4 rounded bg-muted-foreground/55" />
                <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 h-0.5 w-4 rounded bg-muted-foreground/55" />
              </span>
            </button>
          </div>
        </div>
      </div>

      {/* ─── Drag handle ─────────────────────────────── */}
      <div
        className="shrink-0 border-y border-border cursor-row-resize hover:bg-primary/20 active:bg-primary/30 transition-colors group flex items-center justify-center"
        style={{ height: 5 }}
        onMouseDown={handleDragStart}
      >
        <div className="w-8 h-0.5 rounded bg-muted-foreground/20 group-hover:bg-primary/50 transition-colors" />
      </div>

      {/* ─── Results area ─────────────────────────────── */}
      <div className="flex-1 min-h-0 min-w-0 flex flex-col overflow-hidden">
        {/* Results tab bar (when multiple result sets) */}
        {results.length > 1 && (
          <div
            className="shrink-0 relative border-b bg-muted/20"
            style={{ height: 30 }}
          >
            <div className="absolute inset-0 flex items-center px-1 gap-0 overflow-x-auto overflow-y-hidden">
              {results.map((r, i) => (
                <button
                  key={i}
                  className={cn(
                    "flex items-center gap-1.5 px-3 h-full text-xs transition-all whitespace-nowrap shrink-0 border-b-2",
                    activeResultIdx === i
                      ? "border-primary bg-background text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground hover:bg-accent/40",
                  )}
                  onClick={() => setActiveResultIdx(i)}
                >
                  <FileText
                    className={cn(
                      "w-3 h-3",
                      activeResultIdx === i
                        ? "text-primary"
                        : "text-muted-foreground/60",
                    )}
                  />
                  Result {i + 1}
                  <span
                    className={cn(
                      "text-[10px] ml-0.5",
                      activeResultIdx === i
                        ? "text-muted-foreground"
                        : "text-muted-foreground/40",
                    )}
                  >
                    ({r.rows.length}r × {r.columns.length}c)
                  </span>
                </button>
              ))}
            </div>
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
          <div className="flex-1 min-h-0 relative">
            <div className="absolute inset-0 overflow-auto">
              <table className="min-w-max text-xs border-collapse">
                <thead>
                  <tr className="bg-muted sticky top-0 z-10">
                    <th className="text-center px-2 py-1.5 text-[10px] font-medium text-muted-foreground/70 border-b border-r bg-muted w-12.5">
                      #
                    </th>
                    {activeResult.columns.map((col, ci) => (
                      <th
                        key={ci}
                        className="text-left px-2 py-1.5 text-[10px] font-medium text-muted-foreground/70 border-b border-r bg-muted whitespace-nowrap"
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
                            "px-2 py-1 border-r font-mono max-w-75",
                            val === null
                              ? "text-muted-foreground/40 italic"
                              : "",
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
        <div className="text-muted-foreground">
          Ln {activeLine}, Col {activeColumn}
        </div>
        <div className="text-muted-foreground">
          Sel {selectedCharCount} char(s)
        </div>
        <div className="text-muted-foreground">
          Total {lineCount} line(s), {totalCharCount} char(s)
        </div>
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
  label,
}: {
  icon: React.ReactNode;
  title: string;
  onClick: () => void;
  disabled: boolean;
  active: boolean;
  accent?: string;
  label?: string;
}) {
  return (
    <button
      className={cn(
        "p-1.5 rounded transition-colors flex items-center gap-1.5",
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
      {label && (
        <span className="text-[11px] font-medium leading-none tracking-wide pr-1 pt-0.5">
          {label}
        </span>
      )}
    </button>
  );
}
