import {
  useState,
  useCallback,
  useRef,
  useMemo,
  useEffect,
  useDeferredValue,
} from "react";
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
import { useProfilesStore } from "@/state/profilesStore";
import { aiGenerateQuery, dbGetSchemaDdl } from "@/lib/db";
import { ensureAiUseAllowed } from "@/lib/privacy";
import { save, open } from "@tauri-apps/plugin-dialog";
import { homeDir } from "@tauri-apps/api/path";
import { writeFile, readTextFile } from "@tauri-apps/plugin-fs";
import { useQueryHistoryStore } from "@/state/queryHistoryStore";
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
  Bot,
  Sparkles,
  Save as SaveIcon,
  FolderOpen,
  History,
  Star,
  X,
  Search,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { FindToolbar } from "@/components/ui/FindToolbar";
import { CellContextMenu } from "@/components/ui/CellContextMenu";
import { Skeleton } from "@/components/ui/Skeleton";

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
const QUERY_RESULT_ROW_HEIGHT_PX = 30;
const QUERY_RESULT_OVERSCAN_ROWS = 10;

let sqlFormatterModulePromise:
  | Promise<typeof import("sql-formatter")>
  | null = null;

async function formatSqlOffline(query: string): Promise<string> {
  if (!sqlFormatterModulePromise) {
    sqlFormatterModulePromise = import("sql-formatter");
  }

  const { format } = await sqlFormatterModulePromise;
  return format(query, { language: "mysql" });
}

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
  const [isAskingAI, setIsAskingAI] = useState(false);
  const [isAiModalOpen, setIsAiModalOpen] = useState(false);
  const [aiPromptText, setAiPromptText] = useState("");
  const [wordWrap, setWordWrap] = useState(false);
  const [editorFontSize, setEditorFontSize] = useState(
    DEFAULT_QUERY_FONT_SIZE_PX,
  );
  const [cursorPos, setCursorPos] = useState(0);
  const [selectedCharCount, setSelectedCharCount] = useState(0);
  const [visibleRowCounts, setVisibleRowCounts] = useState<Record<number, number>>(
    {},
  );
  const [editorViewport, setEditorViewport] = useState({
    scrollTop: 0,
    scrollHeight: 1,
    clientHeight: 1,
  });
  const [hasDbSelectionHistory, setHasDbSelectionHistory] = useState(
    initialDatabase !== undefined,
  );
  const [textareaContentWidth, setTextareaContentWidth] = useState(0);
  const [isFormatting, setIsFormatting] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [resultViewport, setResultViewport] = useState({
    scrollTop: 0,
    clientHeight: 1,
  });

  // ── Find-in-Results ─────────────────────────────────────
  const [isFindOpen, setIsFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [findMatches, setFindMatches] = useState<{ rowIdx: number; colIdx: number }[]>([]);
  const [currentMatchIdx, setCurrentMatchIdx] = useState(0);

  // ── Column widths (resizing) ─────────────────────────────
  const [colWidths, setColWidths] = useState<Record<number, number>>({});

  // ── Cell selection & context menu ──────────────────────
  const [selectedCell, setSelectedCell] = useState<{ rowIdx: number; colIdx: number } | null>(null);
  const [cellContextMenu, setCellContextMenu] = useState<{
    x: number; y: number; rowIdx: number; colIdx: number; value: string | number | null;
  } | null>(null);

  const addHistoryItem = useQueryHistoryStore((s) => s.addHistoryItem);
  const history = useQueryHistoryStore((s) => s.history);
  const isHistoryLoading = useQueryHistoryStore((s) => s.isLoading);
  const clearHistory = useQueryHistoryStore((s) => s.clearHistory);
  const deleteHistoryItem = useQueryHistoryStore((s) => s.deleteHistoryItem);
  const toggleFavorite = useQueryHistoryStore((s) => s.toggleFavorite);
  const [historyFilter, setHistoryFilter] = useState("");

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
  const resultScrollRef = useRef<HTMLDivElement>(null);
  const pendingEditorSelectionRef = useRef<{
    start: number;
    end: number;
  } | null>(null);

  // ── Matching brackets ─────────────────────────────────────
  const deferredSql = useDeferredValue(sql);
  const deferredMatchBrackets = useMemo(() => {
    return findMatchingBrackets(
      deferredSql,
      clamp(cursorPos, 0, deferredSql.length),
    );
  }, [cursorPos, deferredSql]);
  const deferredActiveQueryRange = useMemo(() => {
    return getActiveQueryRange(
      deferredSql,
      clamp(cursorPos, 0, deferredSql.length),
      clamp(cursorPos + selectedCharCount, 0, deferredSql.length),
    );
  }, [cursorPos, deferredSql, selectedCharCount]);

  const highlightedHTML = useMemo(() => {
    if (deferredActiveQueryRange) {
      return highlightSQL(
        deferredSql,
        deferredActiveQueryRange.start,
        deferredActiveQueryRange.end,
        deferredMatchBrackets,
      );
    }
    return highlightSQL(
      deferredSql,
      0,
      deferredSql.length,
      deferredMatchBrackets,
    );
  }, [deferredSql, deferredActiveQueryRange, deferredMatchBrackets]);

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
  const refreshDatabases = useSchemaStore((s) => s.refreshDatabases);
  const updateTab = useLayoutStore((s) => s.updateTab);
  const aiBlocked = useProfilesStore(
    (s) => s.globalPreferences.blockAiRequests ?? false,
  );
  const maxResultRows = useProfilesStore(
    (s) => s.globalPreferences.maxResultRows ?? 1000,
  );
  const queryTimeoutMs = useProfilesStore(
    (s) => s.globalPreferences.queryTimeoutMs ?? 30000,
  );

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
  const loadingDatabases = useSchemaStore((s) =>
    selectedProfileId ? s.loadingDatabases[selectedProfileId] ?? false : false,
  );
  const databases = storeDatabases ?? [];

  useEffect(() => {
    if (
      !selectedProfileId ||
      !connectedProfiles[selectedProfileId] ||
      storeDatabases ||
      loadingDatabases
    ) {
      return;
    }

    refreshDatabases(selectedProfileId).catch(() => {});
  }, [
    connectedProfiles,
    loadingDatabases,
    refreshDatabases,
    selectedProfileId,
    storeDatabases,
  ]);

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

  const handleSave = useCallback(async () => {
    if (!sql.trim()) return;
    try {
      const path = await save({
        defaultPath: await homeDir(),
        filters: [{
          name: 'SQL',
          extensions: ['sql']
        }]
      });
      if (!path) return;
      await writeFile(path, new TextEncoder().encode(sql));
      setLastSavedSql(sql);

      // Extract filename and update tab title
      const filename = path.split(/[/\\]/).pop() || "Query";
      updateTab(tabId, { title: filename });

      useAppStore.getState().addToast({
        title: "File Saved",
        description: `Successfully saved to ${path}`,
      });
    } catch (e) {
      useAppStore.getState().addToast({
        title: "Save Failed",
        description: String(e),
        variant: "destructive",
      });
    }
  }, [sql, tabId, updateTab]);

  const handleOpenFile = useCallback(async () => {
    try {
      const selected = await open({
        multiple: false,
        defaultPath: await homeDir(),
        filters: [{
          name: 'SQL',
          extensions: ['sql']
        }]
      });
      if (!selected || Array.isArray(selected)) return;
      const content = await readTextFile(selected);
      setSql(content);
      setLastSavedSql(content);

      // Extract filename and update tab title
      const filename = selected.split(/[/\\]/).pop() || "Query";
      updateTab(tabId, { title: filename });
    } catch (e) {
      useAppStore.getState().addToast({
        title: "Open Failed",
        description: String(e),
        variant: "destructive",
      });
    }
  }, [tabId, updateTab]);

  // ── Find Logic ──────────────────────────────────────────
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
        if (results.length > 0) {
          e.preventDefault();
          setIsFindOpen(true);
        }
      }
    };
    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
  }, [results.length]);

  const searchActiveResult = results[activeResultIdx];

  const handleSearch = useCallback((q: string) => {
    setFindQuery(q);
    if (!q || !searchActiveResult) {
      setFindMatches([]);
      return;
    }

    const matches: { rowIdx: number; colIdx: number }[] = [];
    const lowerQ = q.toLowerCase();

    searchActiveResult.rows.forEach((row, rowIdx) => {
      row.forEach((val, colIdx) => {
        if (val !== null && String(val).toLowerCase().includes(lowerQ)) {
          matches.push({ rowIdx, colIdx });
        }
      });
    });

    setFindMatches(matches);
    setCurrentMatchIdx(0);

    if (matches.length > 0) {
      scrollToMatch(0, matches);
    }
  }, [searchActiveResult]);

  const scrollToMatch = (idx: number, matches = findMatches) => {
    const match = matches[idx];
    if (!match) return;

    scrollResultCellIntoView(match.rowIdx, match.colIdx, "center");
  };

  const findNext = () => {
    if (findMatches.length === 0) return;
    const nextIdx = (currentMatchIdx + 1) % findMatches.length;
    setCurrentMatchIdx(nextIdx);
    scrollToMatch(nextIdx);
  };

  const findPrev = () => {
    if (findMatches.length === 0) return;
    const prevIdx = (currentMatchIdx - 1 + findMatches.length) % findMatches.length;
    setCurrentMatchIdx(prevIdx);
    scrollToMatch(prevIdx);
  };

  useEffect(() => {
    if (!cellContextMenu) return;
    const close = () => setCellContextMenu(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [cellContextMenu]);

  useEffect(() => {
    setSelectedCell(null);
    setCellContextMenu(null);
    resultScrollRef.current?.scrollTo({ top: 0, left: 0 });
    setResultViewport({ scrollTop: 0, clientHeight: 1 });

    if (findQuery) {
      handleSearch(findQuery);
    } else {
      setFindMatches([]);
      setCurrentMatchIdx(0);
    }
  }, [activeResultIdx, handleSearch]);

  useEffect(() => {
    const scroller = resultScrollRef.current;
    if (!scroller) return;

    const syncViewport = () => {
      setResultViewport({
        scrollTop: scroller.scrollTop,
        clientHeight: Math.max(1, scroller.clientHeight),
      });
    };

    syncViewport();
    scroller.addEventListener("scroll", syncViewport, { passive: true });
    window.addEventListener("resize", syncViewport);
    return () => {
      scroller.removeEventListener("scroll", syncViewport);
      window.removeEventListener("resize", syncViewport);
    };
  }, [activeResultIdx, wordWrap]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const active = results[activeResultIdx];

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "c" && selectedCell) {
        if (!active) return;
        const row = active.rows[selectedCell.rowIdx];
        if (!row) return;
        const val = row[selectedCell.colIdx];
        navigator.clipboard.writeText(val === null ? "NULL" : String(val)).catch(() => {});
        return;
      }

      // Arrow key / Tab navigation for result grid
      if (!selectedCell || !active) return;
      const isArrow = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key);
      const isTab = e.key === "Tab";
      if (!isArrow && !isTab) return;

      let { rowIdx, colIdx } = selectedCell;
      const numRows = active.rows.length;
      const numCols = active.columns.length;

      if (e.key === "ArrowRight" || (isTab && !e.shiftKey)) {
        e.preventDefault();
        if (colIdx < numCols - 1) colIdx++;
        else if (rowIdx < numRows - 1) { rowIdx++; colIdx = 0; }
      } else if (e.key === "ArrowLeft" || (isTab && e.shiftKey)) {
        e.preventDefault();
        if (colIdx > 0) colIdx--;
        else if (rowIdx > 0) { rowIdx--; colIdx = numCols - 1; }
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        if (rowIdx < numRows - 1) rowIdx++;
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        if (rowIdx > 0) rowIdx--;
      }

      setSelectedCell({ rowIdx, colIdx });
      scrollResultCellIntoView(rowIdx, colIdx);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedCell, results, activeResultIdx]);

  useEffect(() => {
    if (!selectedCell) return;
    ensureResultRowsLoaded(activeResultIdx, selectedCell.rowIdx);
    const cellEl = document.getElementById(
      `qcell-${selectedCell.rowIdx}-${selectedCell.colIdx}`,
    ) as HTMLElement | null;
    cellEl?.focus({ preventScroll: true });
  }, [activeResultIdx, selectedCell]);

  const copyCellContextValue = useCallback(() => {
    if (!cellContextMenu) return;
    const text = cellContextMenu.value === null ? "NULL" : String(cellContextMenu.value);
    navigator.clipboard.writeText(text).catch(() => {});
  }, [cellContextMenu]);

  const copyRowValues = useCallback(() => {
    if (!cellContextMenu) return;
    const active = results[activeResultIdx];
    if (!active) return;
    const row = active.rows[cellContextMenu.rowIdx];
    if (!row) return;
    const text = row.map((v) => (v === null ? "NULL" : String(v))).join("\t");
    navigator.clipboard.writeText(text).catch(() => {});
  }, [cellContextMenu, results, activeResultIdx]);

  const copyColumnValues = useCallback(() => {
    if (!cellContextMenu) return;
    const active = results[activeResultIdx];
    if (!active) return;
    const text = active.rows
      .map((row) => {
        const val = row[cellContextMenu.colIdx];
        return val === null ? "NULL" : String(val);
      })
      .join("\n");
    navigator.clipboard.writeText(text).catch(() => {});
  }, [cellContextMenu, results, activeResultIdx]);

  const copyRowAsJson = useCallback(() => {
    if (!cellContextMenu) return;
    const active = results[activeResultIdx];
    if (!active) return;
    const row = active.rows[cellContextMenu.rowIdx];
    if (!row) return;
    const obj: Record<string, string | number | null> = {};
    active.columns.forEach((col, i) => { obj[col] = row[i] ?? null; });
    navigator.clipboard.writeText(JSON.stringify(obj, null, 2)).catch(() => {});
  }, [cellContextMenu, results, activeResultIdx]);

  const copyRowAsCsv = useCallback(() => {
    if (!cellContextMenu) return;
    const active = results[activeResultIdx];
    if (!active) return;
    const row = active.rows[cellContextMenu.rowIdx];
    if (!row) return;
    const escapeCSV = (val: string | number | null): string => {
      if (val === null) return "";
      const s = String(val);
      if (s.includes(",") || s.includes('"') || s.includes("\n")) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };
    const header = active.columns.map(escapeCSV).join(",");
    const values = row.map(escapeCSV).join(",");
    navigator.clipboard.writeText(`${header}\n${values}`).catch(() => {});
  }, [cellContextMenu, results, activeResultIdx]);

  const copyRowAsSqlInsert = useCallback(() => {
    if (!cellContextMenu) return;
    const active = results[activeResultIdx];
    if (!active) return;
    const row = active.rows[cellContextMenu.rowIdx];
    if (!row) return;
    const escId = (v: string) => `\`${v.replace(/`/g, "``")}\``;
    const cols = active.columns.map(escId).join(", ");
    const vals = row.map((v) => v === null ? "NULL" : `'${String(v).replace(/'/g, "''")}'`).join(", ");
    navigator.clipboard.writeText(`INSERT INTO \`table\` (${cols}) VALUES (${vals});`).catch(() => {});
  }, [cellContextMenu, results, activeResultIdx]);

  // Ctrl+S listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleSave]);

  // Ctrl+A — select all result rows and copy as TSV
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key !== "a") return;
      const active = results[activeResultIdx];
      if (!active || active.rows.length === 0) return;
      // Only intercept when focus is inside the result grid (not the SQL editor)
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "TEXTAREA" || target.tagName === "INPUT")) return;
      e.preventDefault();
      const header = active.columns.join("\t");
      const rows = active.rows
        .map((r) => r.map((v) => (v === null ? "NULL" : String(v))).join("\t"))
        .join("\n");
      navigator.clipboard.writeText(`${header}\n${rows}`).catch(() => {});
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [results, activeResultIdx]);

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
      setVisibleRowCounts({});
      setHasRun(false);
      setExecutionTime(null);
      setSelectedCell(null);
      setCellContextMenu(null);
      setFindMatches([]);
      setCurrentMatchIdx(0);

      const startTime = performance.now();

      try {
        // Escape backticks in the database name to avoid malformed USE statements
        // (e.g. a db named: test`db  →  USE `test``db`)
        let fullQuery = queryText;
        if (selectedDb) {
          const escapedDb = selectedDb.replace(/`/g, "``");
          fullQuery = `USE \`${escapedDb}\`;\n${queryText}`;
        }

        const res = await dbQuery(selectedProfileId, fullQuery, {
          timeoutMs: queryTimeoutMs,
        });

        // Discard stale results if the user cancelled (soft-stop) and re-ran
        if (token !== runTokenRef.current) return;

        const elapsed = performance.now() - startTime;
        setExecutionTime(elapsed);

        // Drop the USE result (index 0) so callers only see their query results
        const filteredResults = selectedDb ? res.slice(1) : res;

        setResults(filteredResults);
        setVisibleRowCounts(
          Object.fromEntries(
            filteredResults.map((result, index) => [
              index,
              Math.min(result.rows.length, maxResultRows),
            ]),
          ),
        );
        setHasRun(true);
        setActiveResultIdx(0);
        setLastSavedSql(sql);
        resultScrollRef.current?.scrollTo({ top: 0, left: 0 });
        setResultViewport({ scrollTop: 0, clientHeight: 1 });

        // Add to history
        addHistoryItem({
          query: queryText,
          profileId: selectedProfileId!,
          database: selectedDb,
          executionTimeMs: elapsed,
        });

        // Update status bar
        useAppStore.getState().setStatusBarInfo({
          connectionName: connectedProfiles[selectedProfileId]?.name,
          database: selectedDb || undefined,
          executionTimeMs: elapsed,
          rowCount: filteredResults[0]?.rows?.length,
        });

        // Invalidate schema cache after DDL operations
        const isDdl = /\b(CREATE|ALTER|DROP|RENAME|TRUNCATE)\s+(TABLE|DATABASE|SCHEMA|VIEW|INDEX)\b/i.test(queryText);
        if (isDdl && selectedProfileId) {
          const schemaStore = useSchemaStore.getState();
          if (selectedDb) {
            schemaStore.refreshTables(selectedProfileId, selectedDb);
          } else {
            schemaStore.refreshDatabases(selectedProfileId);
          }
        }
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
    [maxResultRows, queryTimeoutMs, selectedProfileId, selectedDb, running, sql],
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
          formatted = await formatSqlOffline(textToFormat);
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
    setVisibleRowCounts({});
    setError(null);
    setExecutionTime(null);
    setHasRun(false);
    setSelectedCell(null);
    setCellContextMenu(null);
    setFindMatches([]);
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

  // ── Export JSON ────────────────────────────────────────────
  const handleExportJSON = useCallback(() => {
    const active = results[activeResultIdx];
    if (!active || active.rows.length === 0) return;
    const data = active.rows.map((r) => {
      const obj: Record<string, string | number | null> = {};
      active.columns.forEach((col, i) => { obj[col] = r[i] ?? null; });
      return obj;
    });
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `query_result_${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [results, activeResultIdx]);

  // ── Export SQL INSERTs ──────────────────────────────────────
  const handleExportSQL = useCallback(() => {
    const active = results[activeResultIdx];
    if (!active || active.rows.length === 0) return;
    const escId = (v: string) => `\`${v.replace(/`/g, "``")}\``;
    const cols = active.columns.map(escId).join(", ");
    const lines = active.rows.map((r) => {
      const vals = r.map((v) => v === null ? "NULL" : `'${String(v).replace(/'/g, "''")}'`).join(", ");
      return `INSERT INTO \`table\` (${cols}) VALUES (${vals});`;
    });
    const blob = new Blob([lines.join("\n")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `query_result_${Date.now()}.sql`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [results, activeResultIdx]);

  // ── Ask AI ─────────────────────────────────────────────────
  const handleAskAI = useCallback(() => {
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

    setIsAiModalOpen(true);
    setAiPromptText("");
  }, []);

  const submitAiPrompt = useCallback(async () => {
    if (!aiPromptText.trim()) return;

    const { selectedProviderId, providers } = useModelsStore.getState();
    const activeProvider = providers.find((p) => p.id === selectedProviderId);
    if (!activeProvider) {
      setIsAiModalOpen(false);
      return;
    }

    if (
      !ensureAiUseAllowed({
        providerName: activeProvider.name,
        includesSchemaContext: Boolean(selectedDb),
      })
    ) {
      return;
    }

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
        aiPromptText,
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
      setIsAiModalOpen(false);
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
  }, [aiPromptText, selectedDb, profileId, sql, cursorPos, setSql, setCursorPos]);

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
  const activeVisibleRowCount = useMemo(() => {
    if (!activeResult) return 0;
    const defaultCount = Math.min(activeResult.rows.length, maxResultRows);
    return Math.min(
      activeResult.rows.length,
      visibleRowCounts[activeResultIdx] ?? defaultCount,
    );
  }, [activeResult, activeResultIdx, maxResultRows, visibleRowCounts]);
  const activeDisplayedRows = useMemo(() => {
    if (!activeResult) return [];
    return activeResult.rows.slice(0, activeVisibleRowCount);
  }, [activeResult, activeVisibleRowCount]);
  const hasMoreActiveRows =
    !!activeResult && activeVisibleRowCount < activeResult.rows.length;
  const shouldVirtualizeResults =
    !wordWrap && activeDisplayedRows.length > 200;
  const virtualStartIdx = shouldVirtualizeResults
    ? clamp(
        Math.floor(resultViewport.scrollTop / QUERY_RESULT_ROW_HEIGHT_PX) -
          QUERY_RESULT_OVERSCAN_ROWS,
        0,
        activeDisplayedRows.length,
      )
    : 0;
  const virtualEndIdx = shouldVirtualizeResults
    ? clamp(
        Math.ceil(
          (resultViewport.scrollTop + resultViewport.clientHeight) /
            QUERY_RESULT_ROW_HEIGHT_PX,
        ) + QUERY_RESULT_OVERSCAN_ROWS,
        0,
        activeDisplayedRows.length,
      )
    : activeDisplayedRows.length;
  const visibleResultRows = shouldVirtualizeResults
    ? activeDisplayedRows.slice(virtualStartIdx, virtualEndIdx)
    : activeDisplayedRows;
  const topVirtualSpacerHeight = shouldVirtualizeResults
    ? virtualStartIdx * QUERY_RESULT_ROW_HEIGHT_PX
    : 0;
  const bottomVirtualSpacerHeight = shouldVirtualizeResults
    ? (activeDisplayedRows.length - virtualEndIdx) * QUERY_RESULT_ROW_HEIGHT_PX
    : 0;

  function ensureResultRowsLoaded(resultIndex: number, rowIdx: number) {
    setVisibleRowCounts((prev) => {
      const result = results[resultIndex];
      if (!result) return prev;

      const current =
        prev[resultIndex] ?? Math.min(result.rows.length, maxResultRows);
      if (rowIdx < current) return prev;

      const nextCount = Math.min(
        result.rows.length,
        Math.max(current + maxResultRows, rowIdx + 1),
      );
      if (nextCount === current) return prev;

      return {
        ...prev,
        [resultIndex]: nextCount,
      };
    });
  }

  function scrollResultCellIntoView(
    rowIdx: number,
    colIdx: number,
    block: ScrollLogicalPosition = "nearest",
  ) {
    ensureResultRowsLoaded(activeResultIdx, rowIdx);

    const scroller = resultScrollRef.current;
    if (scroller && shouldVirtualizeResults) {
      const targetTop = rowIdx * QUERY_RESULT_ROW_HEIGHT_PX;
      if (block === "center") {
        scroller.scrollTop = Math.max(
          0,
          targetTop - (scroller.clientHeight - QUERY_RESULT_ROW_HEIGHT_PX) / 2,
        );
      } else {
        const bottomEdge = scroller.scrollTop + scroller.clientHeight;
        if (targetTop < scroller.scrollTop) {
          scroller.scrollTop = targetTop;
        } else if (targetTop + QUERY_RESULT_ROW_HEIGHT_PX > bottomEdge) {
          scroller.scrollTop =
            targetTop - scroller.clientHeight + QUERY_RESULT_ROW_HEIGHT_PX;
        }
      }
    }

    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const cellEl = document.getElementById(`qcell-${rowIdx}-${colIdx}`);
        cellEl?.scrollIntoView({ block, inline: "nearest" });
      });
    });
  }

  // ── Row count summary ─────────────────────────────────────

  const handleLoadMoreRows = useCallback(() => {
    if (!activeResult) return;

    setVisibleRowCounts((prev) => {
      const current =
        prev[activeResultIdx] ?? Math.min(activeResult.rows.length, maxResultRows);
      const nextCount = Math.min(
        activeResult.rows.length,
        current + maxResultRows,
      );
      if (nextCount === current) return prev;

      return {
        ...prev,
        [activeResultIdx]: nextCount,
      };
    });
  }, [activeResult, activeResultIdx, maxResultRows]);

  const editorLineHeight = useMemo(
    () => Math.round(editorFontSize * 1.6 * 100) / 100,
    [editorFontSize],
  );
  const isDefaultEditorFontSize = editorFontSize === DEFAULT_QUERY_FONT_SIZE_PX;
  const lineCount = useMemo(() => Math.max(1, sql.split("\n").length), [sql]);

  // Sort newest first
  const activeLine = useMemo(() => {
    const safePos = clamp(cursorPos, 0, sql.length);
    return sql.slice(0, safePos).split("\n").length;
  }, [cursorPos, sql]);
  const activeColumn = useMemo(() => {
    const safePos = clamp(cursorPos, 0, sql.length);
    const lineStart = sql.lastIndexOf("\n", safePos - 1) + 1;
    return safePos - lineStart + 1;
  }, [cursorPos, sql]);

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
      className="flex flex-col w-full h-full bg-background text-foreground text-xs overflow-hidden min-w-0 min-h-0 relative"
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
            "h-7 inline-flex w-fit shrink-0 items-center gap-1 px-2 rounded whitespace-nowrap transition-colors text-[11px]",
            wordWrap
              ? "bg-accent/70 text-foreground"
              : "text-muted-foreground hover:bg-accent hover:text-foreground",
          )}
        >
          <WrapText className="w-3.5 h-3.5" />
          <span className="whitespace-nowrap">Wrap Text</span>
        </button>

        <div className="w-px h-5 bg-border mx-1" />

        <ToolBtn
          icon={<Bot className="w-4 h-4" />}
          title="Ask AI to generate a query based on the schema"
          onClick={handleAskAI}
          disabled={running || isAskingAI || aiBlocked}
          active={false}
          accent="text-indigo-400"
          label="Ask AI"
        />

        <div className="w-px h-5 bg-border mx-1" />

        <ToolBtn
          icon={<FolderOpen className="w-4 h-4" />}
          title="Open SQL file (Ctrl+O)"
          onClick={handleOpenFile}
          disabled={running}
          active={false}
        />
        <ToolBtn
          icon={<SaveIcon className="w-4 h-4" />}
          title="Save to SQL file (Ctrl+S)"
          onClick={handleSave}
          disabled={running || !sql.trim()}
          active={false}
        />

        <div className="w-px h-5 bg-border mx-1" />

        <div className="relative group/history">
          <ToolBtn
            icon={<History className="w-4 h-4" />}
            title="Query History"
            onClick={() => setShowHistory(!showHistory)}
            disabled={running}
            active={showHistory}
          />
          {showHistory && (
            <div className="absolute top-full left-0 z-50 mt-1 w-96 max-h-[480px] bg-popover border rounded-md shadow-xl flex flex-col overflow-hidden">
              <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/30 shrink-0">
                <span className="text-[10px] font-bold uppercase tracking-wider">Query History</span>
                <button
                  className={cn(
                    "text-[10px] text-red-500 hover:underline",
                    isHistoryLoading && "opacity-50 cursor-not-allowed hover:no-underline",
                  )}
                  disabled={isHistoryLoading}
                  onClick={() => { if (window.confirm("Clear non-favorited history?")) clearHistory(selectedProfileId || undefined); }}
                >
                  Clear
                </button>
              </div>
              {/* Search filter */}
              <div className="px-2 py-1.5 border-b shrink-0">
                <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-muted/30 border">
                  <Search className="w-3 h-3 text-muted-foreground shrink-0" />
                  <input
                    type="text"
                    placeholder="Filter queries..."
                    value={historyFilter}
                    onChange={e => setHistoryFilter(e.target.value)}
                    disabled={isHistoryLoading}
                    className="flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground/50"
                  />
                  {historyFilter && (
                    <button onClick={() => setHistoryFilter("")}>
                      <X className="w-3 h-3 text-muted-foreground hover:text-foreground" />
                    </button>
                  )}
                </div>
              </div>
              <div className="flex-1 overflow-y-auto p-1 space-y-0.5">
                {isHistoryLoading ? (
                  <div className="space-y-1.5 p-1">
                    {[1, 2, 3, 4].map((item) => (
                      <div
                        key={item}
                        className="flex items-start gap-2 rounded border border-border/50 bg-card/40 p-2"
                      >
                        <div className="flex-1 space-y-2">
                          <Skeleton className="h-3 w-11/12 rounded" />
                          <Skeleton className="h-3 w-8/12 rounded" />
                          <div className="flex items-center gap-2 pt-1">
                            <Skeleton className="h-2.5 w-16 rounded" />
                            <Skeleton className="h-2.5 w-12 rounded" />
                            <Skeleton className="ml-auto h-2.5 w-24 rounded" />
                          </div>
                        </div>
                        <div className="space-y-1 pt-0.5">
                          <Skeleton className="h-4 w-4 rounded" />
                          <Skeleton className="h-4 w-4 rounded" />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (() => {
                  const filtered = history
                    .filter(h => h.profileId === selectedProfileId)
                    .filter(h => !historyFilter || h.query.toLowerCase().includes(historyFilter.toLowerCase()) || (h.database ?? "").toLowerCase().includes(historyFilter.toLowerCase()));
                  const sorted = [...filtered.filter(h => h.favorited), ...filtered.filter(h => !h.favorited)];
                  if (sorted.length === 0) {
                    return <div className="py-8 text-center text-muted-foreground/40 text-[10px]">{historyFilter ? "No matches" : "No history yet"}</div>;
                  }
                  return sorted.map((h) => (
                    <div
                      key={h.id}
                      className="group/hitem relative flex items-start gap-1 p-2 rounded hover:bg-accent transition-colors border border-transparent hover:border-border"
                    >
                      <button
                        className="flex-1 text-left min-w-0"
                        onClick={() => { setSql(h.query); setShowHistory(false); }}
                      >
                        <div className="text-[11px] font-mono line-clamp-2 text-foreground/80 group-hover/hitem:text-foreground">
                          {h.query}
                        </div>
                        <div className="mt-1 flex items-center gap-2 text-[9px] text-muted-foreground">
                          {h.database && <span className="font-mono">{h.database}</span>}
                          {h.executionTimeMs !== undefined && (
                            <span className="flex items-center gap-0.5">
                              <Clock className="w-2.5 h-2.5" />
                              {h.executionTimeMs < 1000 ? `${Math.round(h.executionTimeMs)}ms` : `${(h.executionTimeMs / 1000).toFixed(2)}s`}
                            </span>
                          )}
                          <span className="ml-auto">{new Date(h.timestamp).toLocaleString()}</span>
                        </div>
                      </button>
                      <div className="flex items-center gap-0.5 opacity-0 transition-opacity shrink-0 mt-0.5 group-hover/hitem:opacity-100 group-focus-within/hitem:opacity-100">
                        <button
                          className={cn("p-0.5 rounded hover:bg-muted transition-colors", h.favorited ? "text-yellow-400" : "text-muted-foreground")}
                          title={h.favorited ? "Unpin" : "Pin"}
                          aria-label={h.favorited ? "Unpin saved history item" : "Pin saved history item"}
                          onClick={() => toggleFavorite(h.id)}
                        >
                          <Star className="w-3 h-3" fill={h.favorited ? "currentColor" : "none"} />
                        </button>
                        <button
                          className="p-0.5 rounded hover:bg-red-500/20 text-muted-foreground hover:text-red-400 transition-colors"
                          title="Delete"
                          aria-label="Delete history item"
                          onClick={() => deleteHistoryItem(h.id)}
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  ));
                })()}
              </div>
            </div>
          )}
        </div>

        <div className="w-px h-5 bg-border mx-1" />

        {/* Format SQL */}
        <div className="relative flex h-7 w-fit shrink-0 items-center px-1 rounded whitespace-nowrap hover:bg-accent text-muted-foreground hover:text-foreground transition-colors">
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
            className="h-full w-fit whitespace-nowrap bg-transparent text-[11px] font-medium pl-1 pr-1 focus:outline-none appearance-none cursor-pointer"
            style={{ fieldSizing: "content" } as React.CSSProperties}
            title="Format SQL"
            aria-label="Format SQL"
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
        <div className="relative flex h-7 w-fit shrink-0 items-center px-1 rounded whitespace-nowrap hover:bg-accent text-muted-foreground hover:text-foreground transition-colors">
          <div className="flex items-center pointer-events-none">
            <Download className="w-3.5 h-3.5" />
          </div>
          <select
            value=""
            onChange={(e) => {
              if (e.target.value === "csv") handleExportCSV();
              else if (e.target.value === "json") handleExportJSON();
              else if (e.target.value === "sql") handleExportSQL();
            }}
            disabled={!activeResult || activeResult.rows.length === 0}
            className="h-full w-fit whitespace-nowrap bg-transparent text-[11px] font-medium pl-1 pr-1 focus:outline-none appearance-none cursor-pointer"
            style={{ fieldSizing: "content" } as React.CSSProperties}
            title="Export results"
            aria-label="Export results"
          >
            <option value="" disabled>Export</option>
            <option value="csv">CSV</option>
            <option value="json">JSON</option>
            <option value="sql">SQL INSERTs</option>
          </select>
        </div>

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
              aria-label="Select server"
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
              aria-label="Select database"
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
            className="w-12 shrink-0 overflow-hidden bg-muted/30 border-r"
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
        </div>
      </div>

      <div
        className="h-2 flex-none cursor-row-resize flex flex-col justify-center items-center z-10 group bg-muted/30 border-y border-border/50 hover:bg-muted/70 transition-colors"
        onMouseDown={handleDragStart}
      >
        <div className="w-8 h-0.5 rounded bg-muted-foreground/30 group-hover:bg-primary/50 transition-colors" />
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
          <div className="flex-1 min-h-0 relative flex flex-col">
            <FindToolbar
              isOpen={isFindOpen}
              onClose={() => {
                setIsFindOpen(false);
                setFindQuery("");
                setFindMatches([]);
              }}
              onSearch={handleSearch}
              onNext={findNext}
              onPrev={findPrev}
              totalMatches={findMatches.length}
              currentMatch={currentMatchIdx}
            />
            {cellContextMenu && (
              <CellContextMenu
                x={cellContextMenu.x}
                y={cellContextMenu.y}
                onCopyCell={copyCellContextValue}
                onCopyRow={copyRowValues}
                onCopyRowJson={copyRowAsJson}
                onCopyRowCsv={copyRowAsCsv}
                onCopyRowSqlInsert={copyRowAsSqlInsert}
                onCopyColumn={copyColumnValues}
                onClose={() => setCellContextMenu(null)}
              />
            )}
            <div
              ref={resultScrollRef}
              className="flex-1 overflow-auto"
            >
              <table
                className="min-w-max text-xs border-collapse"
                role="grid"
                aria-label="Query results"
                aria-rowcount={activeVisibleRowCount + 1}
                aria-colcount={activeResult.columns.length + 1}
              >
                <thead>
                  <tr className="bg-muted sticky top-0 z-10" role="row" aria-rowindex={1}>
                    <th
                      className="text-center px-2 py-1.5 text-[10px] font-medium text-muted-foreground/70 border-b border-r bg-muted w-12.5"
                      role="columnheader"
                      aria-colindex={1}
                    >
                      #
                    </th>
                    {activeResult.columns.map((col, ci) => (
                      <th
                        key={ci}
                        className="text-left px-2 py-1.5 text-[10px] font-medium text-muted-foreground/70 border-b border-r bg-muted whitespace-nowrap relative group/qth select-none"
                        style={colWidths[ci] ? { width: colWidths[ci], minWidth: colWidths[ci] } : undefined}
                        role="columnheader"
                        aria-colindex={ci + 2}
                      >
                        {col}
                        <div
                          className="absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-primary/40 active:bg-primary/60 z-20 opacity-0 group-hover/qth:opacity-100 transition-opacity"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            const startX = e.clientX;
                            const th = e.currentTarget.parentElement as HTMLTableCellElement;
                            const startWidth = th?.offsetWidth ?? 80;
                            const onMove = (ev: MouseEvent) => {
                              setColWidths(prev => ({ ...prev, [ci]: Math.max(60, startWidth + ev.clientX - startX) }));
                            };
                            const onUp = () => {
                              window.removeEventListener("mousemove", onMove);
                              window.removeEventListener("mouseup", onUp);
                            };
                            window.addEventListener("mousemove", onMove);
                            window.addEventListener("mouseup", onUp);
                          }}
                        />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {topVirtualSpacerHeight > 0 && (
                    <tr aria-hidden="true">
                      <td
                        colSpan={activeResult.columns.length + 1}
                        className="border-0 p-0"
                        style={{ height: topVirtualSpacerHeight }}
                      />
                    </tr>
                  )}
                  {visibleResultRows.map((row, rowOffset) => {
                    const ri = shouldVirtualizeResults
                      ? rowOffset + virtualStartIdx
                      : rowOffset;

                    return (
                    <tr
                      key={ri}
                      className="border-b hover:bg-accent/20 transition-colors"
                      role="row"
                      aria-rowindex={ri + 2}
                    >
                      <td
                        className="text-center px-2 py-1 border-r text-muted-foreground/40 select-none"
                        role="rowheader"
                        aria-colindex={1}
                      >
                        {ri + 1}
                      </td>
                      {row.map((val, ci) => {
                        const isMatch = findQuery && val !== null && String(val).toLowerCase().includes(findQuery.toLowerCase());
                        const match = findMatches[currentMatchIdx];
                        const isCurrent = match?.rowIdx === ri && match?.colIdx === ci;
                        const isSelected = selectedCell?.rowIdx === ri && selectedCell?.colIdx === ci;

                        return (
                          <td
                            key={ci}
                            id={`qcell-${ri}-${ci}`}
                            role="gridcell"
                            aria-colindex={ci + 2}
                            aria-selected={isSelected}
                            tabIndex={
                              isSelected || (!selectedCell && ri === 0 && ci === 0)
                                ? 0
                                : -1
                            }
                            className={cn(
                              "px-2 py-1 border-r font-mono max-w-75 transition-all cursor-default",
                              val === null
                                ? "text-muted-foreground/40 italic"
                                : "",
                              wordWrap
                                ? "whitespace-pre-wrap break-all"
                                : "whitespace-nowrap truncate",
                              isCurrent && "ring-2 ring-primary ring-inset z-10 bg-primary/20",
                              !isCurrent && isMatch && "bg-yellow-500/30",
                              isSelected && !isCurrent && "ring-1 ring-primary/60 bg-primary/8",
                            )}
                            title={val === null ? "NULL" : String(val)}
                            onClick={() => setSelectedCell({ rowIdx: ri, colIdx: ci })}
                            onFocus={() => setSelectedCell({ rowIdx: ri, colIdx: ci })}
                            onContextMenu={(e) => {
                              e.preventDefault();
                              setSelectedCell({ rowIdx: ri, colIdx: ci });
                              setCellContextMenu({ x: e.clientX, y: e.clientY, rowIdx: ri, colIdx: ci, value: val });
                            }}
                          >
                            {val === null ? "NULL" : String(val)}
                          </td>
                        );
                      })}
                    </tr>
                    );
                  })}
                  {bottomVirtualSpacerHeight > 0 && (
                    <tr aria-hidden="true">
                      <td
                        colSpan={activeResult.columns.length + 1}
                        className="border-0 p-0"
                        style={{ height: bottomVirtualSpacerHeight }}
                      />
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {hasMoreActiveRows && (
              <div className="flex items-center justify-between gap-3 border-t bg-muted/20 px-3 py-2 text-[11px] text-muted-foreground">
                <span>
                  Showing {activeVisibleRowCount.toLocaleString()} of{" "}
                  {activeResult.rows.length.toLocaleString()} row(s)
                </span>
                <button
                  type="button"
                  onClick={handleLoadMoreRows}
                  className="rounded border px-2.5 py-1 text-[11px] font-medium text-foreground transition-colors hover:bg-accent"
                >
                  Load more
                </button>
              </div>
            )}
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
          <div className="flex-1 flex items-center justify-center select-none">
            <div className="text-center flex flex-col items-center gap-3">
              <div className="relative w-14 h-14">
                <div className="absolute inset-0 rounded-xl bg-muted/40 border border-border/30" />
                <Play className="absolute inset-0 m-auto w-6 h-6 text-muted-foreground/25" />
              </div>
              <div>
                <p className="text-xs font-medium text-foreground/40">Run a query to see results</p>
                <p className="text-[10px] text-muted-foreground/30 mt-0.5">Ctrl+Enter or F5</p>
              </div>
            </div>
          </div>
        ) : null
        }
      </div >

      {/* ─── Status bar ──────────────────────────────── */}
      < div className="flex items-center gap-3 px-3 py-1 border-t bg-muted/20 shrink-0 text-[10px]" >
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
          {running
            ? "Executing..."
            : error
              ? "Error"
              : results.length === 0
                ? (hasRun ? "Done" : "Ready")
                : `${results.length} result set(s), ${results.reduce((a, r) => a + r.rows.length, 0)} total row(s)`}
        </div>
        {
          executionTime !== null && (
            <div className="flex items-center gap-1 text-muted-foreground">
              <Clock className="w-3 h-3" />
              {executionTime < 1000
                ? `${Math.round(executionTime)}ms`
                : `${(executionTime / 1000).toFixed(2)}s`}
            </div>
          )
        }
        <div className="text-muted-foreground">
          Ln {activeLine}, Col {activeColumn}
        </div>
        <div className="text-muted-foreground">
          Sel {selectedCharCount} char(s)
        </div>
        <div className="text-muted-foreground">
          Total {lineCount} line(s)
        </div>
        <div className="flex-1" />
        {activeResult && activeResult.rows.length > 0 && (
          <div className="text-muted-foreground">
            {activeResult.rows.length} row(s) × {activeResult.columns.length}{" "}
            col(s)
          </div>
        )}
      </div>

      {/* ─── Ask AI Overlay Modal ────────────────────── */}
      {isAiModalOpen && (
        <div className="absolute inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center p-4 min-h-0">
          <div className="bg-popover border shadow-lg rounded-lg flex flex-col w-full max-w-lg overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="px-4 py-3 border-b bg-muted/30 flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-indigo-400" />
              <h3 className="font-medium text-[13px] text-foreground">Ask AI Assistant</h3>
            </div>
            <div className="p-4 flex flex-col gap-3 relative">
              <textarea
                autoFocus
                value={aiPromptText}
                onChange={(e) => setAiPromptText(e.target.value)}
                placeholder="What would you like the AI to generate or modify?"
                className={cn(
                  "w-full h-28 bg-background border rounded-md p-3 text-xs resize-none focus:outline-none focus:ring-1 focus:ring-indigo-500/50 transition-shadow",
                  isAskingAI && "opacity-50 pointer-events-none"
                )}
                disabled={isAskingAI}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    submitAiPrompt();
                  }
                }}
              />
              <div className="flex items-center justify-between text-muted-foreground">
                <span className="text-[10px] italic">
                  {aiBlocked
                    ? "AI requests are disabled in Settings > Privacy."
                    : "Schema and editor contents are sent as context. (Ctrl+Enter to submit)"}
                </span>
                {isAskingAI && (
                  <div className="flex items-center gap-1.5 text-indigo-400 text-[11px] font-medium">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Thinking...</span>
                  </div>
                )}
              </div>
            </div>
            <div className="px-4 py-3 border-t bg-muted/20 flex justify-end gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setIsAiModalOpen(false)}
                disabled={isAskingAI}
                className="px-3 py-1.5 rounded bg-secondary hover:bg-secondary/80 text-foreground transition-colors disabled:opacity-50 font-medium"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submitAiPrompt}
                disabled={isAskingAI || !aiPromptText.trim() || aiBlocked}
                className="px-3 py-1.5 rounded bg-indigo-500 text-white hover:bg-indigo-600 transition-colors flex items-center gap-1.5 disabled:opacity-50 font-medium"
              >
                {isAskingAI ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Sparkles className="w-3.5 h-3.5" />
                )}
                Generate
              </button>
            </div>
          </div>
        </div>
      )
      }
    </div >
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
        "flex w-fit shrink-0 items-center gap-1.5 rounded p-1.5 whitespace-nowrap transition-colors",
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
        <span className="whitespace-nowrap pr-1 pt-0.5 text-[11px] font-medium leading-none tracking-wide">
          {label}
        </span>
      )}
    </button>
  );
}
