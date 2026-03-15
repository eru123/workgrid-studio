import { useState, useEffect, useMemo, useCallback, useRef, memo } from "react";

// ── Session-level persistence cache (survives tab switches, reset on page reload) ──
interface TableSessionState {
  colWidths: Record<string, number>;
  sorts: { column: string; direction: "ASC" | "DESC" }[];
  whereClause: string;
  frozenCols: Set<string>;
}
const tableSessionCache = new Map<string, TableSessionState>();
function getSessionKey(profileId: string, database: string, tableName: string) {
  return `${profileId}::${database}::${tableName}`;
}
import { dbQuery, dbExecuteQuery, dbListColumns } from "@/lib/db";
import type { ColumnInfo, QueryResultSet } from "@/lib/db";
import { cn } from "@/lib/utils/cn";
import {
  getCanvasFontFromElement,
  getDataGridCellText,
  isEditableTarget,
  measureDataGridColumnWidth,
} from "@/lib/utils/dataGrid";
import { useAppStore } from "@/state/appStore";
import { useSchemaStore } from "@/state/schemaStore";
import { useProfilesStore } from "@/state/profilesStore";
import { FindToolbar } from "@/components/ui/FindToolbar";
import { CellContextMenu } from "@/components/ui/CellContextMenu";
import { AutocompleteInput } from "@/components/ui/AutocompleteInput";
import { DataGridSkeleton } from "@/components/ui/Skeleton";
import { highlightSQL } from "@/lib/sqlHighlight";
import {
  Loader2,
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
  Filter,
  Columns3,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  X,
  Eye,
  EyeOff,
  ArrowUpDown,
  AlertCircle,
  Check,
  Plus,
  Trash2,
  Save,
  RotateCcw,
} from "lucide-react";

// ═══════════════════════════════════════════════════════════════════════
//  Types
// ═══════════════════════════════════════════════════════════════════════

interface SortColumn {
  column: string;
  direction: "ASC" | "DESC";
}

interface Props {
  profileId: string;
  database: string;
  tableName: string;
}

// ═══════════════════════════════════════════════════════════════════════
//  Helpers
// ═══════════════════════════════════════════════════════════════════════

function escId(v: string): string {
  return `\`${v.replace(/`/g, "``")}\``;
}

const PAGE_SIZE_OPTIONS = [50, 100, 200, 500, 1000];

const VALUE_OPERATORS = new Set([
  "=",
  "!=",
  "<>",
  ">",
  ">=",
  "<",
  "<=",
  "LIKE",
]);

function normalizeWhereIdentifier(token: string): string {
  return token
    .replace(/^[`(]+/, "")
    .replace(/[`)]+$/, "")
    .replace(/`/g, "")
    .trim()
    .toLowerCase();
}

function inferWhereValueKind(colType: string | undefined) {
  const upper = (colType ?? "").toUpperCase();
  if (
    /^TINYINT\(1\)$/.test(upper) ||
    /\bBOOL\b/.test(upper) ||
    /\bBOOLEAN\b/.test(upper)
  ) {
    return "boolean" as const;
  }
  if (
    /\b(TINYINT|SMALLINT|MEDIUMINT|INT|INTEGER|BIGINT|DECIMAL|NUMERIC|FLOAT|DOUBLE|REAL|BIT)\b/.test(
      upper,
    )
  ) {
    return "numeric" as const;
  }
  if (/\b(DATE|DATETIME|TIMESTAMP|TIME|YEAR)\b/.test(upper)) {
    return "temporal" as const;
  }
  if (/\b(JSON)\b/.test(upper)) {
    return "json" as const;
  }
  if (
    /\b(CHAR|VARCHAR|TEXT|TINYTEXT|MEDIUMTEXT|LONGTEXT|ENUM|SET|BLOB|TINYBLOB|MEDIUMBLOB|LONGBLOB)\b/.test(
      upper,
    )
  ) {
    return "string" as const;
  }
  return "other" as const;
}

function whereValueSuggestions(columnInfo?: ColumnInfo): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (value: string) => {
    if (!value || seen.has(value)) return;
    seen.add(value);
    out.push(value);
  };

  if (!columnInfo || columnInfo.nullable) add("NULL");

  const kind = inferWhereValueKind(columnInfo?.col_type);
  if (kind === "boolean") {
    add("1");
    add("0");
    add("TRUE");
    add("FALSE");
    return out;
  }
  if (kind === "numeric") {
    add("0");
    add("1");
    add("-1");
    return out;
  }
  if (kind === "temporal") {
    add("CURRENT_DATE");
    add("CURRENT_TIMESTAMP");
    add("NOW()");
    add("'2026-01-01'");
    return out;
  }
  if (kind === "json") {
    add("(JSON_OBJECT())");
    add("(JSON_ARRAY())");
    add("'{}'");
    add("'[]'");
    return out;
  }
  if (kind === "string") {
    add("''");
    add("'value'");
    add("'%term%'");
    return out;
  }

  add("'value'");
  return out;
}

function buildWhereSuggestions(
  whereClause: string,
  columns: string[],
  columnInfos: ColumnInfo[],
): string[] {
  const sourceColumns =
    columns.length > 0 ? columns : columnInfos.map((col) => col.name);
  const uniqueColumns = Array.from(new Set(sourceColumns));
  const columnTokens = uniqueColumns.map((col) =>
    /^[A-Za-z_][A-Za-z0-9_]*$/.test(col) ? col : escId(col),
  );
  const findColumn = (token: string): ColumnInfo | undefined => {
    const normalized = normalizeWhereIdentifier(token);
    if (!normalized) return undefined;
    return columnInfos.find((col) => col.name.toLowerCase() === normalized);
  };
  const isColumnToken = (token: string): boolean => {
    const normalized = normalizeWhereIdentifier(token);
    if (!normalized) return false;
    return uniqueColumns.some((col) => col.toLowerCase() === normalized);
  };

  const tokenMatch = whereClause.match(/(\S+)$/);
  const activeToken = tokenMatch ? tokenMatch[1] : "";
  const prefix = tokenMatch
    ? whereClause.slice(0, whereClause.length - activeToken.length)
    : whereClause;
  const activeLower = activeToken.toLowerCase();

  const words = whereClause.trim() ? whereClause.trim().split(/\s+/) : [];
  const contextWords = tokenMatch ? words.slice(0, -1) : words;
  const prev = contextWords[contextWords.length - 1] ?? "";
  const prevUpper = prev.toUpperCase();
  const prevPrev = contextWords[contextWords.length - 2] ?? "";
  const prevPrevUpper = prevPrev.toUpperCase();
  const prevPrevPrev = contextWords[contextWords.length - 3] ?? "";

  const out: string[] = [];
  const seen = new Set<string>();
  const add = (candidate: string) => {
    if (!candidate) return;
    if (activeLower && !candidate.toLowerCase().includes(activeLower)) return;
    const finalValue = `${prefix}${candidate}`;
    if (seen.has(finalValue)) return;
    seen.add(finalValue);
    out.push(finalValue);
  };
  const addColumns = () => columnTokens.forEach(add);
  const addOperators = () => {
    [
      "=",
      "!=",
      "<>",
      ">",
      ">=",
      "<",
      "<=",
      "LIKE",
      "NOT LIKE",
      "IN",
      "NOT IN",
      "BETWEEN",
      "IS NULL",
      "IS NOT NULL",
    ].forEach(add);
  };

  if (contextWords.length === 0) {
    addColumns();
    ["(", "NOT", "NULL"].forEach(add);
    return out.slice(0, 12);
  }

  if (prevUpper === "AND" || prevUpper === "OR" || prevUpper === "(") {
    addColumns();
    add("NOT");
    add("(");
    return out.slice(0, 12);
  }

  if (isColumnToken(prev)) {
    addOperators();
    return out.slice(0, 12);
  }

  if (prevUpper === "IS") {
    add("NULL");
    add("NOT NULL");
    return out.slice(0, 12);
  }

  if (prevUpper === "NOT") {
    if (prevPrevUpper === "IS") {
      add("NULL");
      return out.slice(0, 12);
    }
    add("LIKE");
    add("IN");
    return out.slice(0, 12);
  }

  let valueColumn: ColumnInfo | undefined;
  if (VALUE_OPERATORS.has(prevUpper)) {
    valueColumn = findColumn(prevPrev);
  } else if (prevUpper === "LIKE" && prevPrevUpper === "NOT") {
    valueColumn = findColumn(prevPrevPrev);
  } else if (prevUpper === "IN" || prevUpper === "BETWEEN") {
    valueColumn = findColumn(prevPrev);
  }

  if (prevUpper === "BETWEEN") {
    whereValueSuggestions(valueColumn).forEach((value) =>
      add(`${value} AND ${value}`),
    );
    return out.slice(0, 12);
  }

  if (
    contextWords.length >= 2 &&
    contextWords[contextWords.length - 2].toUpperCase() === "BETWEEN"
  ) {
    add("AND");
    return out.slice(0, 12);
  }

  if (prevUpper === "IN") {
    add("(NULL)");
    whereValueSuggestions(valueColumn).forEach((value) => add(`(${value})`));
    add("(...)");
    return out.slice(0, 12);
  }

  if (VALUE_OPERATORS.has(prevUpper) || valueColumn) {
    whereValueSuggestions(valueColumn).forEach(add);
    return out.slice(0, 12);
  }

  addColumns();
  ["AND", "OR", "NOT", "LIKE", "IN", "IS", "NULL"].forEach(add);
  return out.slice(0, 12);
}

// ═══════════════════════════════════════════════════════════════════════
//  Component
// ═══════════════════════════════════════════════════════════════════════

export function TableDataTab({ profileId, database, tableName }: Props) {
  const queryTimeoutMs = useProfilesStore(
    (s) => s.globalPreferences.queryTimeoutMs ?? 30000,
  );

  // ── Restore persisted session state ─────────────────────
  const sessionKey = getSessionKey(profileId, database, tableName);
  const cached = tableSessionCache.get(sessionKey);

  // ── Column metadata ─────────────────────────────────────
  const [columnInfos, setColumnInfos] = useState<ColumnInfo[]>([]);
  const [loadingMeta, setLoadingMeta] = useState(true);

  // ── Data state ──────────────────────────────────────────
  const [rows, setRows] = useState<(string | number | null)[][]>([]);
  const [columns, setColumns] = useState<string[]>([]);
  const [totalRows, setTotalRows] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Pagination ──────────────────────────────────────────
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(100);

  // ── Sorting — restored from session cache ────────────────
  const [sorts, setSorts] = useState<SortColumn[]>(cached?.sorts ?? []);

  // ── Column visibility ───────────────────────────────────
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(new Set());
  const [showColumnPicker, setShowColumnPicker] = useState(false);
  const columnPickerRef = useRef<HTMLDivElement>(null);

  // ── Edit state ──────────────────────────────────────────
  const [editedCells, setEditedCells] = useState<Record<string, string | null>>({});
  const [addedRows, setAddedRows] = useState<Record<string, string | null>[]>([]);
  const [deletedRows, setDeletedRows] = useState<Set<number>>(new Set());
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
  const [isApplying, setIsApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [columnFilters, setColumnFilters] = useState<Record<string, string>>({});

  const hasEdits = Object.keys(editedCells).length > 0 || addedRows.length > 0 || deletedRows.size > 0;
  const tableHasPK = !loadingMeta && columnInfos.some(c => c.key === "PRI");

  // ── Filter — restored from session cache ─────────────────
  const [whereClause, setWhereClause] = useState(cached?.whereClause ?? "");
  const [appliedWhere, setAppliedWhere] = useState(cached?.whereClause ?? "");
  const [showFilter, setShowFilter] = useState(false);

  // ── Find-in-Results ─────────────────────────────────────
  const [isFindOpen, setIsFindOpen] = useState(false);
  const [findMatches, setFindMatches] = useState<{ rowIdx: number; colName: string }[]>([]);
  const [currentMatchIdx, setCurrentMatchIdx] = useState(0);

  // ── Column widths — restored from session cache ──────────
  const [colWidths, setColWidths] = useState<Record<string, number>>(cached?.colWidths ?? {});

  // ── Frozen columns — restored from session cache ─────────
  const [frozenCols, setFrozenCols] = useState<Set<string>>(cached?.frozenCols ?? new Set());

  // ── Persist session state on change ─────────────────────
  useEffect(() => {
    tableSessionCache.set(sessionKey, { colWidths, sorts, whereClause: appliedWhere, frozenCols });
  }, [sessionKey, colWidths, sorts, appliedWhere, frozenCols]);

  // ── Cell selection & context menu ──────────────────────
  const [selectedCellKey, setSelectedCellKey] = useState<string | null>(null);
  const [cellContextMenu, setCellContextMenu] = useState<{
    x: number; y: number; rowIdx: number; colName: string; value: string | number | null;
  } | null>(null);
  const shouldHandleTableGridKeys = useCallback((target: EventTarget | null) => {
    if (isEditableTarget(target)) return false;
    return target instanceof HTMLElement && target.id.startsWith("cell-");
  }, []);

  // ── Fetch column metadata ───────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setLoadingMeta(true);
    dbListColumns(profileId, database, tableName)
      .then((cols) => {
        if (!cancelled) setColumnInfos(cols);
      })
      .catch(() => { })
      .finally(() => {
        if (!cancelled) setLoadingMeta(false);
      });
    return () => {
      cancelled = true;
    };
  }, [profileId, database, tableName]);

  // ── Build count query ───────────────────────────────────
  const effectiveWhere = useMemo(() => {
    const parts: string[] = [];
    if (appliedWhere.trim()) parts.push(`(${appliedWhere.trim()})`);

    Object.entries(columnFilters).forEach(([col, val]) => {
      if (val.trim()) {
        const escapedVal = val.replace(/'/g, "''");
        parts.push(`${escId(col)} LIKE '%${escapedVal}%'`);
      }
    });

    return parts.length > 0 ? ` WHERE ${parts.join(" AND ")}` : "";
  }, [appliedWhere, columnFilters]);

  const countQuery = useMemo(() => {
    return `SELECT COUNT(*) AS cnt FROM ${escId(database)}.${escId(tableName)}${effectiveWhere}`;
  }, [database, tableName, effectiveWhere]);

  // ── Build data query ────────────────────────────────────
  const dataQuery = useMemo(() => {
    let q = `SELECT * FROM ${escId(database)}.${escId(tableName)}${effectiveWhere}`;
    if (sorts.length > 0) {
      q += ` ORDER BY ${sorts.map((s) => `${escId(s.column)} ${s.direction}`).join(", ")}`;
    }
    q += ` LIMIT ${pageSize} OFFSET ${page * pageSize}`;
    return q;
  }, [database, tableName, effectiveWhere, sorts, page, pageSize]);

  // ── Fetch data ──────────────────────────────────────────
  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    setEditedCells({});
    setAddedRows([]);
    setDeletedRows(new Set());
    setSelectedRows(new Set());
    setApplyError(null);
    setColumnFilters({});
    try {
      const [countRes, dataRes] = await Promise.all([
        dbQuery(profileId, countQuery, { timeoutMs: queryTimeoutMs }),
        dbQuery(profileId, dataQuery, { timeoutMs: queryTimeoutMs }),
      ]);

      const cnt = countRes[0]?.rows?.[0]?.[0];
      const totalCount = typeof cnt === "number" ? cnt : Number(cnt) || 0;
      setTotalRows(totalCount);

      const result = dataRes[0] as QueryResultSet | undefined;
      setColumns(result?.columns ?? []);
      setRows(result?.rows ?? []);

      // Update status bar with connection context
      useAppStore.getState().setStatusBarInfo({
        profileId,
        connectionName: useSchemaStore.getState().connectedProfiles[profileId]?.name,
        database,
        rowCount: totalCount,
      });
    } catch (e) {
      setError(String(e));
      setRows([]);
      setColumns([]);
      setTotalRows(0);
      useAppStore.getState().addToast({
        title: "Query Error",
        description: String(e),
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [profileId, countQuery, dataQuery, queryTimeoutMs]);

  // Auto-fetch on mount and when query params change
  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // ── Pagination computed ─────────────────────────────────
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  const displayPage = page + 1;

  const goToPage = useCallback(
    (p: number) => setPage(Math.max(0, Math.min(p, totalPages - 1))),
    [totalPages],
  );

  // ── Sorting handlers ───────────────────────────────────
  const handleSort = useCallback((colName: string, multi: boolean) => {
    setSorts((prev) => {
      const existingIdx = prev.findIndex((s) => s.column === colName);
      if (existingIdx >= 0) {
        const existing = prev[existingIdx];
        if (existing.direction === "ASC") {
          // Toggle to DESC
          const next = [...prev];
          next[existingIdx] = { ...existing, direction: "DESC" };
          return next;
        }
        // Remove sort (was DESC)
        return prev.filter((_, i) => i !== existingIdx);
      }
      // Add new sort
      if (multi) {
        return [...prev, { column: colName, direction: "ASC" }];
      }
      return [{ column: colName, direction: "ASC" }];
    });
    setPage(0);
  }, []);

  const clearSorts = useCallback(() => {
    setSorts([]);
    setPage(0);
  }, []);

  // ── Column visibility handlers ──────────────────────────
  const toggleColumn = useCallback((colName: string) => {
    setHiddenColumns((prev) => {
      const next = new Set(prev);
      if (next.has(colName)) next.delete(colName);
      else next.add(colName);
      return next;
    });
  }, []);

  const showAllColumns = useCallback(() => setHiddenColumns(new Set()), []);
  const effectiveColumns = useMemo(
    () => (columns.length > 0 ? columns : columnInfos.map((c) => c.name)),
    [columns, columnInfos],
  );

  const hideAllColumns = useCallback(() => {
    setHiddenColumns(new Set(effectiveColumns));
  }, [effectiveColumns]);

  // ── Visible columns ─────────────────────────────────────
  const visibleColumns = useMemo(
    () => effectiveColumns.filter((c) => !hiddenColumns.has(c)),
    [effectiveColumns, hiddenColumns],
  );

  const autoFitColumn = useCallback((colName: string, headerCell: HTMLTableCellElement | null) => {
    const colIdx = columns.indexOf(colName);
    if (colIdx === -1) return;

    const width = measureDataGridColumnWidth({
      headerText: colName,
      values: [
        ...rows.map((row) => row[colIdx]),
        ...addedRows.map((row) => row[colName] ?? null),
      ],
      headerFont: getCanvasFontFromElement(
        headerCell,
        '500 11px "Segoe UI", -apple-system, BlinkMacSystemFont, sans-serif',
      ),
      minWidth: 80,
      maxWidth: 560,
    });

    setColWidths((prev) => ({ ...prev, [colName]: width }));
  }, [addedRows, columns, rows]);

  // ── Filter handlers ─────────────────────────────────────
  const applyFilter = useCallback(() => {
    setAppliedWhere(whereClause);
    setPage(0);
  }, [whereClause]);

  const clearFilter = useCallback(() => {
    setWhereClause("");
    setAppliedWhere("");
    setPage(0);
  }, []);

  const whereSuggestions = useMemo(
    () => buildWhereSuggestions(whereClause, columns, columnInfos),
    [whereClause, columns, columnInfos],
  );
  const whereHighlightHtml = useMemo(() => {
    if (!whereClause) return "";
    const html = highlightSQL(
      whereClause,
      whereClause.length,
      whereClause.length,
      null,
    );
    return html.endsWith("\n") ? html.slice(0, -1) : html;
  }, [whereClause]);

  // ── Close column picker on outside click ────────────────
  useEffect(() => {
    if (!showColumnPicker) return;
    const handleClick = (e: MouseEvent) => {
      if (
        columnPickerRef.current &&
        !columnPickerRef.current.contains(e.target as Node)
      ) {
        setShowColumnPicker(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showColumnPicker]);

  // ── Find Logic ──────────────────────────────────────────
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setIsFindOpen(true);
      }
    };
    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
  }, []);

  useEffect(() => {
    if (!cellContextMenu) return;
    const close = () => setCellContextMenu(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [cellContextMenu]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const gridFocused = shouldHandleTableGridKeys(e.target);

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "c" && selectedCellKey) {
        if (!gridFocused) return;
        const colonIdx = selectedCellKey.indexOf(":");
        const rowIdx = Number(selectedCellKey.slice(0, colonIdx));
        const colName = selectedCellKey.slice(colonIdx + 1);
        const colIdx = columns.indexOf(colName);
        const row = rows[rowIdx];
        if (!row) return;
        const val = colIdx >= 0 ? row[colIdx] : null;
        navigator.clipboard
          .writeText(getDataGridCellText(val))
          .catch(() => {});
        return;
      }

      // Arrow key / Tab navigation
      if (!gridFocused || !selectedCellKey) return;
      const isArrow = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key);
      const isTab = e.key === "Tab";
      if (!isArrow && !isTab) return;

      const colonIdx = selectedCellKey.indexOf(":");
      let rowIdx = Number(selectedCellKey.slice(0, colonIdx));
      const colName = selectedCellKey.slice(colonIdx + 1);
      let colIdx = visibleColumns.indexOf(colName);
      if (colIdx === -1) return;

      if (e.key === "ArrowRight" || (isTab && !e.shiftKey)) {
        e.preventDefault();
        if (colIdx < visibleColumns.length - 1) colIdx++;
        else if (rowIdx < rows.length - 1) { rowIdx++; colIdx = 0; }
      } else if (e.key === "ArrowLeft" || (isTab && e.shiftKey)) {
        e.preventDefault();
        if (colIdx > 0) colIdx--;
        else if (rowIdx > 0) { rowIdx--; colIdx = visibleColumns.length - 1; }
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        if (rowIdx < rows.length - 1) rowIdx++;
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        if (rowIdx > 0) rowIdx--;
      }

      const newKey = `${rowIdx}:${visibleColumns[colIdx]}`;
      setSelectedCellKey(newKey);
      // Scroll the cell into view
      const cellEl = document.getElementById(`cell-${rowIdx}-${visibleColumns[colIdx]}`);
      cellEl?.scrollIntoView({ block: "nearest", inline: "nearest" });
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedCellKey, columns, rows, shouldHandleTableGridKeys, visibleColumns]);

  useEffect(() => {
    if (!selectedCellKey) return;
    const colonIdx = selectedCellKey.indexOf(":");
    const rowIdx = Number(selectedCellKey.slice(0, colonIdx));
    const colName = selectedCellKey.slice(colonIdx + 1);
    const cellEl = document.getElementById(
      `cell-${rowIdx}-${colName}`,
    ) as HTMLElement | null;
    cellEl?.focus({ preventScroll: true });
  }, [selectedCellKey]);

  const handleSearch = useCallback((q: string) => {
    if (!q) {
      setFindMatches([]);
      return;
    }

    const matches: { rowIdx: number; colName: string }[] = [];
    const lowerQ = q.toLowerCase();

    // Search in current page results
    rows.forEach((row, rowIdx) => {
      visibleColumns.forEach((colName) => {
        const colIdx = columns.indexOf(colName);
        const val = row[colIdx];
        if (val !== null && String(val).toLowerCase().includes(lowerQ)) {
          matches.push({ rowIdx, colName });
        }
      });
    });

    setFindMatches(matches);
    setCurrentMatchIdx(0);

    if (matches.length > 0) {
      scrollToMatch(0, matches);
    }
  }, [rows, visibleColumns, columns]);

  const scrollToMatch = (idx: number, matches = findMatches) => {
    const match = matches[idx];
    if (!match) return;

    const cellId = `cell-${match.rowIdx}-${match.colName}`;
    const el = document.getElementById(cellId);
    if (el) {
      el.scrollIntoView({ block: "center", inline: "center" });
    }
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

  const copyCellContextValue = useCallback(() => {
    if (!cellContextMenu) return;
    navigator.clipboard
      .writeText(getDataGridCellText(cellContextMenu.value))
      .catch(() => {});
  }, [cellContextMenu]);

  const copyRowValues = useCallback(() => {
    if (!cellContextMenu) return;
    const row = rows[cellContextMenu.rowIdx];
    if (!row) return;
    const text = visibleColumns
      .map((col) => {
        const idx = columns.indexOf(col);
        const val = idx >= 0 ? row[idx] : null;
        return getDataGridCellText(val);
      })
      .join("\t");
    navigator.clipboard.writeText(text).catch(() => {});
  }, [cellContextMenu, rows, columns, visibleColumns]);

  const copyColumnValues = useCallback(() => {
    if (!cellContextMenu) return;
    const colIdx = columns.indexOf(cellContextMenu.colName);
    const text = rows
      .map((row) => {
        const val = colIdx >= 0 ? row[colIdx] : null;
        return getDataGridCellText(val);
      })
      .join("\n");
    navigator.clipboard.writeText(text).catch(() => {});
  }, [cellContextMenu, rows, columns]);

  const copyRowAsJson = useCallback(() => {
    if (!cellContextMenu) return;
    const row = rows[cellContextMenu.rowIdx];
    if (!row) return;
    const obj: Record<string, string | number | null> = {};
    visibleColumns.forEach((col) => {
      const idx = columns.indexOf(col);
      obj[col] = idx >= 0 ? (row[idx] ?? null) : null;
    });
    navigator.clipboard.writeText(JSON.stringify(obj, null, 2)).catch(() => {});
  }, [cellContextMenu, rows, columns, visibleColumns]);

  const copyRowAsCsv = useCallback(() => {
    if (!cellContextMenu) return;
    const row = rows[cellContextMenu.rowIdx];
    if (!row) return;
    const escapeCSV = (val: string | number | null): string => {
      if (val === null) return "";
      const s = String(val);
      if (s.includes(",") || s.includes('"') || s.includes("\n")) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };
    const header = visibleColumns.map(escapeCSV).join(",");
    const values = visibleColumns.map((col) => {
      const idx = columns.indexOf(col);
      return escapeCSV(idx >= 0 ? row[idx] ?? null : null);
    }).join(",");
    navigator.clipboard.writeText(`${header}\n${values}`).catch(() => {});
  }, [cellContextMenu, rows, columns, visibleColumns]);

  const copyRowAsSqlInsert = useCallback(() => {
    if (!cellContextMenu) return;
    const row = rows[cellContextMenu.rowIdx];
    if (!row) return;
    const cols = visibleColumns.map(escId).join(", ");
    const vals = visibleColumns.map((col) => {
      const idx = columns.indexOf(col);
      const v = idx >= 0 ? row[idx] ?? null : null;
      return v === null ? "NULL" : `'${String(v).replace(/'/g, "''")}'`;
    }).join(", ");
    navigator.clipboard.writeText(`INSERT INTO ${escId(tableName)} (${cols}) VALUES (${vals});`).catch(() => {});
  }, [cellContextMenu, rows, columns, visibleColumns, tableName]);

  // ── Edit handlers ───────────────────────────────────────
  const handleAddRow = useCallback(() => {
    setAddedRows(prev => {
      const newRow: Record<string, string | null> = {};
      columns.forEach(col => newRow[col] = null);
      return [...prev, newRow];
    });
  }, [columns]);

  const handleDeleteSelected = useCallback(() => {
    if (selectedRows.size === 0) return;
    if (!window.confirm(`Are you sure you want to mark ${selectedRows.size} row(s) for deletion? Changes will not be permanent until you click 'Apply'.`)) return;

    setDeletedRows(prev => {
      const next = new Set(prev);
      selectedRows.forEach(idx => {
        if (idx < rows.length) next.add(idx);
      });
      return next;
    });
    setSelectedRows(new Set());
  }, [selectedRows, rows]);

  const handleExport = useCallback((format: 'csv' | 'json' | 'sql') => {
    try {
      let content = "";
      let fileName = `${tableName}_export.${format}`;
      let mimeType = "text/plain";

      if (format === 'csv') {
        mimeType = "text/csv";
        const header = columns.join(",");
        const body = rows.map(r => r.map(v => {
          if (v === null) return "NULL";
          const s = String(v);
          if (s.includes(",") || s.includes('"') || s.includes("\n")) {
            return `"${s.replace(/"/g, '""')}"`;
          }
          return s;
        }).join(",")).join("\n");
        content = header + "\n" + body;
      } else if (format === 'json') {
        mimeType = "application/json";
        const data = rows.map(r => {
          const obj: Record<string, string | number | null> = {};
          columns.forEach((col, i) => obj[col] = r[i]);
          return obj;
        });
        content = JSON.stringify(data, null, 2);
      } else if (format === 'sql') {
        const body = rows.map(r => {
          const colNames = columns.map(c => escId(c)).join(", ");
          const colVals = r.map(v => v === null ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`).join(", ");
          return `INSERT INTO ${escId(tableName)} (${colNames}) VALUES (${colVals});`;
        }).join("\n");
        content = body;
      }

      const blob = new Blob([content], { type: mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(url);

      useAppStore.getState().addToast({
        title: "Export Successful",
        description: `Exported ${rows.length} rows to ${format.toUpperCase()}.`,
      });
    } catch (e) {
      useAppStore.getState().addToast({
        title: "Export Failed",
        description: String(e),
        variant: "destructive",
      });
    }
  }, [rows, columns, tableName]);

  const handleDiscardChanges = useCallback(() => {
    setEditedCells({});
    setAddedRows([]);
    setDeletedRows(new Set());
    setSelectedRows(new Set());
    setApplyError(null);
  }, []);

  const handleApplyChanges = useCallback(async () => {
    if (!hasEdits) return;
    setIsApplying(true);
    setApplyError(null);
    try {
      // Find PK columns
      const pkCols = columnInfos.filter(c => c.key === "PRI").map(c => c.name);
      if (pkCols.length === 0 && (Object.keys(editedCells).length > 0 || deletedRows.size > 0)) {
        throw new Error("Cannot update or delete rows because the table has no Primary Key.");
      }

      const queries: string[] = [];

      // 1. Deletes
      for (const rowIdx of deletedRows) {
        const row = rows[rowIdx];
        const whereParts = pkCols.map(pkCol => {
          const colIdx = columns.indexOf(pkCol);
          const val = row[colIdx];
          return `${escId(pkCol)} = ${val === null ? 'NULL' : `'${String(val).replace(/'/g, "''")}'`}`;
        });
        queries.push(`DELETE FROM ${escId(database)}.${escId(tableName)} WHERE ${whereParts.join(" AND ")};`);
      }

      // 2. Updates
      const updatesByRow: Record<number, Record<string, string | null>> = {};
      Object.entries(editedCells).forEach(([key, val]) => {
        const [rowIdxStr, colName] = key.split(":");
        const rowIdx = parseInt(rowIdxStr, 10);
        if (!updatesByRow[rowIdx]) updatesByRow[rowIdx] = {};
        updatesByRow[rowIdx][colName] = val;
      });

      for (const [rowIdxStr, changes] of Object.entries(updatesByRow)) {
        const rowIdx = parseInt(rowIdxStr, 10);
        if (deletedRows.has(rowIdx)) continue; // skip if deleted

        const row = rows[rowIdx];
        const setParts = Object.entries(changes).map(([col, val]) => {
          return `${escId(col)} = ${val === null ? 'NULL' : `'${String(val).replace(/'/g, "''")}'`}`;
        });
        const whereParts = pkCols.map(pkCol => {
          const colIdx = columns.indexOf(pkCol);
          const val = row[colIdx];
          return `${escId(pkCol)} = ${val === null ? 'NULL' : `'${String(val).replace(/'/g, "''")}'`}`;
        });

        queries.push(`UPDATE ${escId(database)}.${escId(tableName)} SET ${setParts.join(", ")} WHERE ${whereParts.join(" AND ")};`);
      }

      // 3. Inserts
      for (const newRow of addedRows) {
        const colsToInsert = Object.keys(newRow).filter(col => newRow[col] !== null && newRow[col] !== "");
        if (colsToInsert.length === 0) continue; // skip totally empty rows

        const colNames = colsToInsert.map(c => escId(c)).join(", ");
        const colVals = colsToInsert.map(c => newRow[c] === null ? 'NULL' : `'${String(newRow[c]).replace(/'/g, "''")}'`).join(", ");
        queries.push(`INSERT INTO ${escId(database)}.${escId(tableName)} (${colNames}) VALUES (${colVals});`);
      }

      if (queries.length > 0) {
        for (const q of queries) {
          await dbExecuteQuery(profileId, q, { timeoutMs: queryTimeoutMs });
        }
      }

      useAppStore.getState().addToast({
        title: "Changes Applied",
        description: `Successfully applied ${queries.length} change(s).`,
      });

      await fetchData();

    } catch (e) {
      setApplyError(String(e));
      useAppStore.getState().addToast({
        title: "Failed to apply changes",
        description: String(e),
        variant: "destructive",
      });
    } finally {
      setIsApplying(false);
    }
  }, [hasEdits, editedCells, addedRows, deletedRows, rows, columns, columnInfos, database, tableName, profileId, fetchData, queryTimeoutMs]);

  const toggleRowSelection = useCallback((rowIdx: number) => {
    setSelectedRows(prev => {
      const next = new Set(prev);
      if (next.has(rowIdx)) next.delete(rowIdx);
      else next.add(rowIdx);
      return next;
    });
  }, []);

  const toggleAllSelection = useCallback(() => {
    if (selectedRows.size === rows.length - deletedRows.size) {
      setSelectedRows(new Set());
    } else {
      const next = new Set<number>();
      rows.forEach((_, i) => {
        if (!deletedRows.has(i)) next.add(i);
      });
      setSelectedRows(next);
    }
  }, [rows, selectedRows.size, deletedRows]);

  // ── Render: Loading ─────────────────────────────────────
  if (loadingMeta && effectiveColumns.length === 0) {
    return (
      <div className="w-full h-full flex items-center justify-center gap-2 text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin" />
        <span className="text-sm">Loading table structure...</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col w-full h-full bg-background text-foreground text-xs overflow-hidden">
      {/* ─── Toolbar ────────────────────────────────── */}
      <div className="flex items-center gap-1 px-2 py-1.5 border-b bg-muted/20 shrink-0 flex-wrap">
        {/* Refresh */}
        <button
          className="flex items-center gap-1 px-2 py-1 rounded hover:bg-accent transition-colors text-xs"
          onClick={fetchData}
          disabled={loading}
          title="Refresh data"
        >
          <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} />
          Refresh
        </button>

        <div className="w-px h-4 bg-border mx-1" />

        {/* Sort indicator */}
        <button
          className={cn(
            "flex items-center gap-1 px-2 py-1 rounded hover:bg-accent transition-colors text-xs",
            sorts.length > 0 && "text-primary",
          )}
          onClick={clearSorts}
          title={
            sorts.length > 0
              ? `${sorts.length} sort(s) active — Click to clear`
              : "No sorting"
          }
        >
          <ArrowUpDown className="w-3.5 h-3.5" />
          Sorting{sorts.length > 0 ? ` (${sorts.length})` : ""}
        </button>

        <div className="w-px h-4 bg-border mx-1" />

        {/* Column Picker */}
        <div className="relative">
          <button
            className={cn(
              "flex items-center gap-1 px-2 py-1 rounded hover:bg-accent transition-colors text-xs",
              hiddenColumns.size > 0 && "text-orange-400",
            )}
            onClick={() => setShowColumnPicker((v) => !v)}
            title="Show/hide columns"
          >
            <Columns3 className="w-3.5 h-3.5" />
            Columns ({visibleColumns.length}/{effectiveColumns.length})
          </button>

          {showColumnPicker && (
            <div
              ref={columnPickerRef}
              className="absolute top-full left-0 z-50 mt-1 w-56 max-h-80 overflow-y-auto bg-popover border rounded-md shadow-lg p-1"
            >
              <div className="flex items-center gap-1 px-2 py-1 border-b mb-1">
                <button
                  className="text-[10px] hover:text-primary transition-colors"
                  onClick={showAllColumns}
                >
                  Show All
                </button>
                <span className="text-muted-foreground/40">|</span>
                <button
                  className="text-[10px] hover:text-primary transition-colors"
                  onClick={hideAllColumns}
                >
                  Hide All
                </button>
              </div>
              {effectiveColumns.map((col) => (
                <button
                  key={col}
                  className="w-full flex items-center gap-2 px-2 py-1 rounded hover:bg-accent text-xs text-left transition-colors"
                  onClick={() => toggleColumn(col)}
                >
                  {hiddenColumns.has(col) ? (
                    <EyeOff className="w-3 h-3 text-muted-foreground/40 shrink-0" />
                  ) : (
                    <Eye className="w-3 h-3 text-primary shrink-0" />
                  )}
                  <span
                    className={cn(
                      "truncate",
                      hiddenColumns.has(col) &&
                      "text-muted-foreground/50 line-through",
                    )}
                  >
                    {col}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="w-px h-4 bg-border mx-1" />

        {/* Export */}
        <div className="relative group/export">
          <button
            className="flex items-center gap-1 px-2 py-1 rounded hover:bg-accent transition-colors text-xs"
            title="Export data"
            aria-haspopup="menu"
            aria-label="Export data"
          >
            <Save className="w-3.5 h-3.5" />
            Export
          </button>
          <div className="absolute top-full left-0 z-50 mt-1 hidden w-32 bg-popover border rounded-md shadow-lg p-1 group-hover/export:block group-focus-within/export:block">
            <button className="w-full text-left px-2 py-1 hover:bg-accent rounded text-xs" onClick={() => handleExport('csv')}>CSV</button>
            <button className="w-full text-left px-2 py-1 hover:bg-accent rounded text-xs" onClick={() => handleExport('json')}>JSON</button>
            <button className="w-full text-left px-2 py-1 hover:bg-accent rounded text-xs" onClick={() => handleExport('sql')}>SQL INSERTs</button>
          </div>
        </div>

        <div className="w-px h-4 bg-border mx-1" />

        {/* Filter toggle */}
        <button
          className={cn(
            "flex items-center gap-1 px-2 py-1 rounded hover:bg-accent transition-colors text-xs",
            appliedWhere && "text-blue-400",
          )}
          onClick={() => setShowFilter((v) => !v)}
          title="WHERE filter"
        >
          <Filter className="w-3.5 h-3.5" />
          Filter
        </button>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Edit Controls */}
        <div className="flex items-center gap-1 border-l pl-1">
          <button
            className={cn("flex items-center gap-1 px-2 py-1 rounded transition-colors text-xs",
              tableHasPK ? "hover:bg-accent text-muted-foreground hover:text-foreground" : "opacity-30 pointer-events-none text-muted-foreground")}
            onClick={tableHasPK ? handleAddRow : undefined}
            title={tableHasPK ? "Insert new row" : "Table has no Primary Key — editing disabled"}
          >
            <Plus className="w-3.5 h-3.5" />
            Insert
          </button>
          <button
            className={cn("flex items-center gap-1 px-2 py-1 rounded transition-colors text-xs",
              tableHasPK && selectedRows.size > 0 ? "hover:bg-red-500/20 text-red-500" : "opacity-30 pointer-events-none text-muted-foreground")}
            onClick={tableHasPK && selectedRows.size > 0 ? handleDeleteSelected : undefined}
            title={tableHasPK ? "Delete selected rows" : "Table has no Primary Key — editing disabled"}
          >
            <Trash2 className="w-3.5 h-3.5" />
            Delete
          </button>

          <div className="w-px h-4 bg-border mx-1" />

          {hasEdits && (
            <>
              <button
                className="flex items-center gap-1 px-2 py-1 rounded hover:bg-accent transition-colors text-xs text-muted-foreground"
                onClick={handleDiscardChanges}
                disabled={isApplying}
                title="Discard all changes"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Discard
              </button>
              <button
                className="flex items-center gap-1 px-2 py-1 rounded bg-primary text-primary-foreground hover:bg-primary/90 transition-colors text-xs"
                onClick={handleApplyChanges}
                disabled={isApplying}
                title="Apply changes to database"
              >
                {isApplying ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                Apply
              </button>
            </>
          )}
        </div>

        <div className="w-px h-4 bg-border mx-1" />

        {/* Row count */}
        <span className="text-muted-foreground text-[10px] mr-1 flex items-center gap-1">
          {totalRows.toLocaleString()} rows total
          {appliedWhere ? " (filtered)" : ""}
        </span>
      </div>

      <FindToolbar
        isOpen={isFindOpen}
        onClose={() => {
          setIsFindOpen(false);
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

      {/* ─── Filter Bar ────────────────────────────── */}
      {showFilter && (
        <div className="px-3 py-1.5 border-b bg-muted/10 shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-muted-foreground shrink-0 font-medium uppercase tracking-wide">
              WHERE
            </span>
            <AutocompleteInput
              value={whereClause}
              onChange={setWhereClause}
              suggestions={whereSuggestions}
              selectOnEnter={false}
              selectOnTab
              onEnter={applyFilter}
              highlightHtml={whereHighlightHtml}
              highlightClassName="h-6 rounded px-2 py-[4px] text-xs leading-4 font-mono"
              inputClassName="flex-1 h-6 rounded bg-secondary/50 border px-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-primary"
              dropdownClassName="max-h-56 overflow-y-auto border-border/70"
              placeholder="e.g. status = 'active' AND created_at > '2024-01-01'"
              spellCheck={false}
            />
            <button
              className="px-2 py-1 text-xs rounded bg-primary text-primary-foreground hover:bg-primary/90 transition-colors flex items-center gap-1"
              onClick={applyFilter}
            >
              <Check className="w-3 h-3" />
              Apply
            </button>
            {appliedWhere && (
              <button
                className="px-2 py-1 text-xs rounded border hover:bg-accent transition-colors flex items-center gap-1"
                onClick={clearFilter}
              >
                <X className="w-3 h-3" />
                Clear
              </button>
            )}
          </div>
        </div>
      )}

      {/* ─── No Primary Key warning banner ─────────── */}
      {!loadingMeta && columnInfos.length > 0 && !columnInfos.some(c => c.key === "PRI") && (
        <div className="flex items-center gap-2 px-3 py-1.5 border-b bg-yellow-500/10 text-yellow-500 text-xs shrink-0">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          <span>This table has no primary key — row editing and deletion are disabled.</span>
        </div>
      )}

      {/* ─── Error banner ──────────────────────────── */}
      {(error || applyError) && (
        <div className="flex items-start gap-2 px-3 py-2 border-b bg-red-500/10 text-red-400 text-xs shrink-0">
          <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span className="break-all">{error || applyError}</span>
        </div>
      )}

      {/* ─── Data Grid ─────────────────────────────── */}
      <div className="flex-1 overflow-auto relative">
        {loading && (
          <div className="absolute inset-0 z-20 overflow-hidden bg-background/80 backdrop-blur-[1px]">
            <div className="flex items-center justify-between border-b bg-muted/20 px-3 py-2 text-[11px] text-muted-foreground">
              <span className="inline-flex items-center gap-2">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Loading data...
              </span>
              <span className="font-mono">{tableName}</span>
            </div>
            <DataGridSkeleton columns={Math.max(visibleColumns.length, 4)} rows={12} />
          </div>
        )}

        <table
          className="min-w-full text-xs border-collapse"
          role="grid"
          aria-label={`Data grid for ${tableName}`}
          aria-rowcount={rows.length - deletedRows.size + addedRows.length + 1}
          aria-colcount={visibleColumns.length + 2}
        >
          <thead className="sticky top-0 z-30">
            <tr className="bg-muted/70 backdrop-blur-sm" role="row" aria-rowindex={1}>
              <th
                className="sticky left-0 z-30 text-center px-1.5 py-1.5 border-b border-r bg-muted/70 whitespace-nowrap"
                style={{ width: 32, maxWidth: 32, minWidth: 32 }}
                role="columnheader"
                aria-colindex={1}
              >
                <input
                  type="checkbox"
                  className="w-3 h-3 rounded-sm opacity-50 hover:opacity-100 cursor-pointer"
                  style={{ accentColor: 'var(--primary)' }}
                  checked={rows.length > 0 && selectedRows.size === rows.length - deletedRows.size}
                  onChange={toggleAllSelection}
                  aria-label="Select all rows"
                />
              </th>
              {/* Row number column */}
              <th
                className="sticky left-[32px] z-30 text-center px-1.5 py-1.5 text-[10px] font-medium text-muted-foreground/70 tracking-wider border-b border-r bg-muted/70 whitespace-nowrap"
                style={{ width: 40, maxWidth: 40, minWidth: 40 }}
                role="columnheader"
                aria-colindex={2}
              >
                #
              </th>
              {(() => {
                // checkbox col ≈32px + row number col ≈40px
                let leftOffset = 72;
                return visibleColumns.map((col, colOrder) => {
                  const isFrozen = frozenCols.has(col);
                  const colLeft = isFrozen ? leftOffset : undefined;
                  if (isFrozen) leftOffset += colWidths[col] ?? 120;
                  const sortEntry = sorts.find((s) => s.column === col);
                  const sortIndex = sorts.findIndex((s) => s.column === col);
                  const colInfo = columnInfos.find((ci) => ci.name === col);

                  return (
                    <SortableHeader
                      key={col}
                      name={col}
                      colInfo={colInfo}
                      sortDirection={sortEntry?.direction}
                      sortIndex={sorts.length > 1 ? sortIndex : -1}
                      onSort={(e) => handleSort(col, e.ctrlKey || e.metaKey)}
                      filterValue={columnFilters[col] || ""}
                      onFilter={(val) => {
                        setColumnFilters(prev => ({ ...prev, [col]: val }));
                        setPage(0);
                      }}
                      width={colWidths[col]}
                      onResize={(w) => setColWidths(prev => ({ ...prev, [col]: w }))}
                      onAutoFit={(headerCell) => autoFitColumn(col, headerCell)}
                      frozen={isFrozen}
                      frozenLeft={colLeft}
                      ariaColIndex={colOrder + 3}
                      onToggleFreeze={() => setFrozenCols(prev => {
                        const next = new Set(prev);
                        if (next.has(col)) next.delete(col); else next.add(col);
                        return next;
                      })}
                    />
                  );
                });
              })()}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && addedRows.length === 0 && !loading && (
              <tr>
                <td
                  colSpan={visibleColumns.length + 2}
                  className="text-center py-10 text-muted-foreground/40"
                >
                  {appliedWhere ? "No rows matching filter" : "Empty table"}
                </td>
              </tr>
            )}
            {addedRows.map((newRow, idx) => (
              <NewDataRow
                key={`new-${idx}`}
                newRow={newRow}
                rowIdx={idx}
                rowIndexAria={idx + 2}
                columns={effectiveColumns}
                visibleColumns={visibleColumns}
                columnInfos={columnInfos}
                colWidths={colWidths}
                onEditCell={(colName, val) => {
                  setAddedRows(prev => {
                    const next = [...prev];
                    next[idx] = { ...next[idx], [colName]: val };
                    return next;
                  });
                }}
                hasMatch={(col) => findMatches.some(m => m.rowIdx === -(idx + 1) && m.colName === col)}
                isCurrentMatch={(col) => {
                  const m = findMatches[currentMatchIdx];
                  return m?.rowIdx === -(idx + 1) && m?.colName === col;
                }}
              />
            ))}
            {rows.map((row, rowIdx) => {
              if (deletedRows.has(rowIdx)) return null;
              const rowNumber = page * pageSize + rowIdx + 1;
              const isSelected = selectedRows.has(rowIdx);
              return (
                <DataRow
                  key={`row-${rowIdx}`}
                  row={row}
                  rowIdx={rowIdx}
                  rowNumber={rowNumber}
                  rowIndexAria={addedRows.length + rowIdx + 2}
                  columns={effectiveColumns}
                  visibleColumns={visibleColumns}
                  columnInfos={columnInfos}
                  isSelected={isSelected}
                  onToggleSelect={() => toggleRowSelection(rowIdx)}
                  editedCells={editedCells}
                  onEditCell={(colName, val) => setEditedCells(prev => ({ ...prev, [`${rowIdx}:${colName}`]: val }))}
                  hasMatch={(col) => findMatches.some(m => m.rowIdx === rowIdx && m.colName === col)}
                  isCurrentMatch={(col) => {
                    const m = findMatches[currentMatchIdx];
                    return m?.rowIdx === rowIdx && m?.colName === col;
                  }}
                  selectedCellKey={selectedCellKey}
                  onCellSelect={(colName) => setSelectedCellKey(`${rowIdx}:${colName}`)}
                  onCellContextMenu={(e, colName, value) => {
                    e.preventDefault();
                    setSelectedCellKey(`${rowIdx}:${colName}`);
                    setCellContextMenu({ x: e.clientX, y: e.clientY, rowIdx, colName, value });
                  }}
                  frozenCols={frozenCols}
                  colWidths={colWidths}
                />
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ─── Pagination Bar ────────────────────────── */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-t bg-muted/20 shrink-0">
        {/* Page size */}
        <span className="text-[10px] text-muted-foreground">
          Rows per page:
        </span>
        <select
          className="h-6 rounded bg-secondary/50 border px-1 text-xs focus:outline-none focus:ring-1 focus:ring-primary cursor-pointer"
          value={pageSize}
          onChange={(e) => {
            setPageSize(Number(e.target.value));
            setPage(0);
          }}
          aria-label="Rows per page"
        >
          {PAGE_SIZE_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>

        <div className="flex-1" />

        {/* Page info */}
        <span className="text-[10px] text-muted-foreground">
          {page * pageSize + 1}–{Math.min((page + 1) * pageSize, totalRows)} of{" "}
          {totalRows.toLocaleString()}
        </span>

        {/* Page navigation */}
        <div className="flex items-center gap-0.5">
          <PaginationBtn
            icon={<ChevronsLeft className="w-3.5 h-3.5" />}
            onClick={() => goToPage(0)}
            disabled={page === 0}
            title="First page"
          />
          <PaginationBtn
            icon={<ChevronLeft className="w-3.5 h-3.5" />}
            onClick={() => goToPage(page - 1)}
            disabled={page === 0}
            title="Previous page"
          />

          <span className="px-2 text-xs tabular-nums">
            {displayPage} / {totalPages}
          </span>

          <PaginationBtn
            icon={<ChevronRight className="w-3.5 h-3.5" />}
            onClick={() => goToPage(page + 1)}
            disabled={page >= totalPages - 1}
            title="Next page"
          />
          <PaginationBtn
            icon={<ChevronsRight className="w-3.5 h-3.5" />}
            onClick={() => goToPage(totalPages - 1)}
            disabled={page >= totalPages - 1}
            title="Last page"
          />
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
//  Sub-components
// ═══════════════════════════════════════════════════════════════════════

const SortableHeader = memo(function SortableHeader({
  name,
  colInfo,
  sortDirection,
  sortIndex,
  onSort,
  filterValue,
  onFilter,
  width,
  onResize,
  onAutoFit,
  frozen,
  frozenLeft,
  ariaColIndex,
  onToggleFreeze,
}: {
  name: string;
  colInfo?: ColumnInfo;
  sortDirection?: "ASC" | "DESC";
  sortIndex: number;
  onSort: (e: React.MouseEvent) => void;
  filterValue: string;
  onFilter: (val: string) => void;
  width?: number;
  onResize?: (w: number) => void;
  onAutoFit?: (headerCell: HTMLTableCellElement | null) => void;
  frozen?: boolean;
  frozenLeft?: number;
  ariaColIndex: number;
  onToggleFreeze?: () => void;
}) {
  const isPK = colInfo?.key === "PRI";
  const [showFilter, setShowFilter] = useState(false);
  const filterRef = useRef<HTMLDivElement>(null);
  const thRef = useRef<HTMLTableCellElement>(null);

  useEffect(() => {
    if (!showFilter) return;
    const handleClick = (e: MouseEvent) => {
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) {
        setShowFilter(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showFilter]);

  const handleResizeMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startWidth = thRef.current?.offsetWidth ?? 80;
    const onMouseMove = (ev: MouseEvent) => {
      const newWidth = Math.max(60, startWidth + ev.clientX - startX);
      onResize?.(newWidth);
    };
    const onMouseUp = () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  };

  return (
    <th
      ref={thRef}
      role="columnheader"
      aria-colindex={ariaColIndex}
      aria-sort={
        sortDirection === "ASC"
          ? "ascending"
          : sortDirection === "DESC"
            ? "descending"
            : "none"
      }
      className={cn(
        "text-left px-1.5 py-1.5 text-[10px] font-medium tracking-wider border-b border-r bg-muted/70 whitespace-nowrap select-none group relative",
        sortDirection && "bg-primary/10",
        frozen && "sticky z-30 shadow-[2px_0_4px_rgba(0,0,0,0.08)]",
      )}
      style={{
        ...(width ? { width, minWidth: width } : undefined),
        ...(frozen && frozenLeft !== undefined ? { left: frozenLeft } : undefined),
      }}
      title={colInfo ? `Type: ${colInfo.col_type}` : ""}
    >
      <div className="flex items-center gap-1">
        <button
          type="button"
          className="flex flex-1 items-center gap-1 text-left hover:text-foreground transition-colors"
          onClick={onSort}
          aria-label={`Sort by ${name}`}
          title="Click to sort • Ctrl+Click for multi-sort"
        >
          {isPK && (
            <span className="text-yellow-500 text-[9px]" title="Primary Key">
              🔑
            </span>
          )}
          <span
            className={cn(
              sortDirection ? "text-primary" : "text-muted-foreground/70",
            )}
          >
            {name}
          </span>
          <span className="flex items-center gap-0.5">
            {sortDirection === "ASC" && (
              <ChevronUp className="w-3 h-3 text-primary" />
            )}
            {sortDirection === "DESC" && (
              <ChevronDown className="w-3 h-3 text-primary" />
            )}
            {!sortDirection && (
              <ChevronsUpDown className="w-3 h-3 text-muted-foreground/20 group-hover:text-muted-foreground/50 transition-colors" />
            )}
            {sortIndex >= 0 && (
              <span className="text-[8px] text-primary/70 font-bold">
                {sortIndex + 1}
              </span>
            )}
          </span>
        </button>

        <button
          type="button"
          className={cn(
            "p-0.5 rounded hover:bg-accent transition-colors focus-visible:text-muted-foreground/80",
            (filterValue || showFilter) ? "text-primary" : "text-muted-foreground/0 group-hover:text-muted-foreground/50"
          )}
          onClick={(e) => { e.stopPropagation(); setShowFilter(!showFilter); }}
          title="Filter column"
          aria-label={`Filter ${name} column`}
        >
          <Filter className="w-3 h-3" />
        </button>
        {onToggleFreeze && (
          <button
            type="button"
            className={cn(
              "p-0.5 rounded hover:bg-accent transition-colors focus-visible:text-muted-foreground/80",
              frozen ? "text-primary" : "text-muted-foreground/0 group-hover:text-muted-foreground/50"
            )}
            onClick={(e) => { e.stopPropagation(); onToggleFreeze(); }}
            title={frozen ? "Unfreeze column" : "Freeze column (pin left)"}
            aria-label={frozen ? `Unfreeze ${name} column` : `Freeze ${name} column`}
          >
            <ArrowUpDown className="w-3 h-3 rotate-90" />
          </button>
        )}

        {showFilter && (
          <div
            ref={filterRef}
            className="absolute top-full left-0 z-50 mt-1 w-48 bg-popover border rounded-md shadow-lg p-2"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex flex-col gap-2">
              <span className="text-[10px] font-bold text-muted-foreground uppercase">Filter {name}</span>
              <input
                autoFocus
                type="text"
                placeholder="Contains..."
                className="w-full h-7 px-2 bg-secondary/50 border rounded text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                value={filterValue}
                onChange={(e) => onFilter(e.target.value)}
                aria-label={`Filter values in ${name}`}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === 'Escape') setShowFilter(false);
                }}
              />
              {filterValue && (
                <button
                  className="text-[10px] text-primary hover:underline text-left"
                  onClick={() => {
                    onFilter("");
                    setShowFilter(false);
                  }}
                >
                  Clear Filter
                </button>
              )}
            </div>
          </div>
        )}
      </div>
      {/* Column resize handle */}
      <div
        className="absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-primary/40 active:bg-primary/60 z-20 opacity-0 group-hover:opacity-100 transition-opacity"
        onMouseDown={handleResizeMouseDown}
        onDoubleClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onAutoFit?.(thRef.current);
        }}
        title="Drag to resize, double-click to auto-fit"
      />
    </th>
  );
});

const NewDataRow = memo(function NewDataRow({
  newRow,
  rowIdx,
  rowIndexAria,
  visibleColumns,
  columnInfos,
  colWidths,
  onEditCell,
  isCurrentMatch,
  hasMatch,
}: {
  newRow: Record<string, string | null>;
  rowIdx: number;
  rowIndexAria: number;
  columns: string[];
  visibleColumns: string[];
  columnInfos: ColumnInfo[];
  colWidths?: Record<string, number>;
  onEditCell: (colName: string, val: string | null) => void;
  isCurrentMatch?: (colName: string) => boolean;
  hasMatch?: (colName: string) => boolean;
}) {
  return (
    <tr
      className="border-b bg-green-500/5 hover:bg-green-500/10 transition-colors"
      role="row"
      aria-rowindex={rowIndexAria}
    >
      <td className="text-center px-1 py-0 border-r h-7 bg-green-500/10" role="gridcell" aria-colindex={1}>
        <Plus className="w-3 h-3 text-green-500 mx-auto" />
      </td>
      <td
        className="text-center px-1 py-0 border-r h-7 text-green-500 font-bold tabular-nums text-[10px] bg-green-500/10"
        role="rowheader"
        aria-colindex={2}
      >
        *
      </td>
      {visibleColumns.map((col, colOrder) => {
        const value = newRow[col] ?? null;
        const colInfo = columnInfos.find((ci) => ci.name === col);

        return (
          <EditableCell
            key={col}
            cellId={`cell-${-(rowIdx + 1)}-${col}`}
            ariaColIndex={colOrder + 3}
            value={value}
            colInfo={colInfo}
            isEdited={value !== null}
            onSave={(val) => onEditCell(col, val)}
            isMatch={hasMatch?.(col)}
            isCurrent={isCurrentMatch?.(col)}
            width={colWidths?.[col]}
          />
        );
      })}
    </tr>
  );
});

const DataRow = memo(function DataRow({
  row,
  rowIdx,
  rowNumber,
  rowIndexAria,
  columns,
  visibleColumns,
  columnInfos,
  isSelected,
  onToggleSelect,
  editedCells,
  onEditCell,
  isCurrentMatch,
  hasMatch,
  selectedCellKey,
  onCellSelect,
  onCellContextMenu,
  frozenCols,
  colWidths,
}: {
  row: (string | number | null)[];
  rowIdx: number;
  rowNumber: number;
  rowIndexAria: number;
  columns: string[];
  visibleColumns: string[];
  columnInfos: ColumnInfo[];
  isSelected: boolean;
  onToggleSelect: () => void;
  editedCells: Record<string, string | null>;
  onEditCell: (colName: string, val: string | null) => void;
  isCurrentMatch?: (colName: string) => boolean;
  hasMatch?: (colName: string) => boolean;
  selectedCellKey?: string | null;
  onCellSelect?: (colName: string) => void;
  onCellContextMenu?: (e: React.MouseEvent, colName: string, value: string | number | null) => void;
  frozenCols?: Set<string>;
  colWidths?: Record<string, number>;
}) {
  return (
    <tr
      role="row"
      aria-rowindex={rowIndexAria}
      className={cn(
        "border-b transition-colors",
        isSelected ? "bg-primary/10 hover:bg-primary/15" : "hover:bg-accent/15"
      )}
    >
      <td
        className="sticky left-0 z-10 text-center px-1 py-0 border-r h-7 whitespace-nowrap bg-background"
        style={{ width: 32, maxWidth: 32, minWidth: 32 }}
        role="gridcell"
        aria-colindex={1}
      >
        <input
          type="checkbox"
          className="w-3 h-3 rounded-sm opacity-50 hover:opacity-100 cursor-pointer"
          style={{ accentColor: 'var(--primary)' }}
          checked={isSelected}
          onChange={onToggleSelect}
          aria-label={`Select row ${rowNumber}`}
        />
      </td>
      <td
        className="sticky left-[32px] z-10 text-center px-1 py-0 border-r h-7 text-muted-foreground/40 tabular-nums text-[10px] bg-muted/20"
        style={{ width: 40, maxWidth: 40, minWidth: 40 }}
        role="rowheader"
        aria-colindex={2}
      >
        {rowNumber}
      </td>
      {(() => {
        const frozenLeftOffsets = visibleColumns.reduce(
          (state, col) => {
            if (!(frozenCols?.has(col) ?? false)) {
              return state;
            }

            return {
              offset: state.offset + (colWidths?.[col] ?? 120),
              positions: {
                ...state.positions,
                [col]: state.offset,
              },
            };
          },
          {
            // checkbox col ≈32px + row# col ≈40px
            offset: 72,
            positions: {} as Record<string, number>,
          },
        ).positions;

        return visibleColumns.map((col, colOrder) => {
          const colIdx = columns.indexOf(col);
          const originalValue = colIdx >= 0 ? row[colIdx] : null;
          const editKey = `${rowIdx}:${col}`;
          const isEdited = editKey in editedCells;
          const value = isEdited ? editedCells[editKey] : originalValue;
          const colInfo = columnInfos.find((ci) => ci.name === col);
          const isFrozen = frozenCols?.has(col) ?? false;
          const colLeft = isFrozen ? frozenLeftOffsets[col] : undefined;

          return (
            <EditableCell
              key={col}
              cellId={`cell-${rowIdx}-${col}`}
              ariaColIndex={colOrder + 3}
              value={value}
              colInfo={colInfo}
              isEdited={isEdited}
              onSave={(val) => onEditCell(col, val)}
              isMatch={hasMatch?.(col)}
              isCurrent={isCurrentMatch?.(col)}
              isSelected={selectedCellKey === `${rowIdx}:${col}`}
              isTabStop={
                selectedCellKey === `${rowIdx}:${col}` ||
                (!selectedCellKey && rowIdx === 0 && colOrder === 0)
              }
              onSelect={() => onCellSelect?.(col)}
              onCellContextMenu={(e) => onCellContextMenu?.(e, col, value ?? null)}
              frozen={isFrozen}
              frozenLeft={colLeft}
              width={colWidths?.[col]}
            />
          );
        });
      })()}
    </tr>
  );
});

const EditableCell = memo(function EditableCell({
  cellId,
  ariaColIndex,
  value,
  colInfo,
  isEdited,
  onSave,
  isMatch,
  isCurrent,
  isSelected,
  isTabStop,
  onSelect,
  onCellContextMenu,
  frozen,
  frozenLeft,
  width,
}: {
  cellId?: string;
  ariaColIndex: number;
  value: string | number | null;
  colInfo?: ColumnInfo;
  isEdited: boolean;
  onSave: (val: string | null) => void;
  isMatch?: boolean;
  isCurrent?: boolean;
  isSelected?: boolean;
  isTabStop?: boolean;
  onSelect?: () => void;
  onCellContextMenu?: (e: React.MouseEvent) => void;
  frozen?: boolean;
  frozenLeft?: number;
  width?: number;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [localValue, setLocalValue] = useState<string>(value === null ? "" : String(value));
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [isEditing]);

  const handleBlur = () => {
    setIsEditing(false);
    const finalVal = localValue === "" && colInfo?.nullable ? null : localValue;
    if (String(finalVal) !== String(value)) {
      onSave(finalVal as string | null);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleBlur();
    } else if (e.key === "Escape") {
      setLocalValue(value === null ? "" : String(value));
      setIsEditing(false);
    }
  };

  const stickyStyle = {
    ...(frozen && frozenLeft !== undefined ? { left: frozenLeft } : undefined),
    ...(width ? { width, minWidth: width, maxWidth: width } : undefined),
  };
  const stickyClass = frozen ? "sticky z-10 shadow-[2px_0_4px_rgba(0,0,0,0.08)]" : undefined;

  if (isEditing) {
    return (
      <td className={cn("p-0 border-r h-7 min-w-[80px] bg-background", stickyClass)} style={stickyStyle}>
        <input
          ref={inputRef}
          type="text"
          className="w-full h-full px-1.5 py-0 bg-background text-xs font-mono focus:outline-none focus:ring-1 focus:ring-inset focus:ring-primary"
          value={localValue}
          onChange={(e) => setLocalValue(e.target.value)}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
        />
      </td>
    );
  }

  const isNumeric =
    colInfo &&
    /^(TINYINT|SMALLINT|MEDIUMINT|INT|BIGINT|DECIMAL|FLOAT|DOUBLE|BIT)/i.test(
      colInfo.col_type,
    );

  return (
    <td
      id={cellId}
      role="gridcell"
      aria-colindex={ariaColIndex}
      aria-selected={isSelected}
      tabIndex={isTabStop ? 0 : -1}
      className={cn(
        "px-2 py-0 border-r h-7 min-w-[80px] relative group/cell cursor-default bg-background",
        isNumeric && "text-right tabular-nums",
        isEdited && "bg-amber-500/10",
        isCurrent && "ring-2 ring-primary ring-inset z-10 bg-primary/20",
        !isCurrent && isMatch && "bg-yellow-500/30",
        isSelected && !isCurrent && "ring-1 ring-primary/60 bg-primary/8",
        stickyClass,
      )}
      style={stickyStyle}
      onClick={onSelect}
      onFocus={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === "F2") {
          e.preventDefault();
          setIsEditing(true);
        }
      }}
      onDoubleClick={() => setIsEditing(true)}
      onContextMenu={onCellContextMenu}
      title={getDataGridCellText(value)}
    >
      {value === null ? (
        <span className="text-muted-foreground/30 italic">NULL</span>
      ) : (
        <div
          className={cn(
            "overflow-hidden text-ellipsis whitespace-nowrap",
            isNumeric && "text-right",
          )}
          style={{ maxWidth: width ? Math.max(width - 16, 64) : 280 }}
        >
          {String(value)}
        </div>
      )}
      {isEdited && (
        <div className="absolute top-0 right-0 w-0 h-0 border-t-[4px] border-t-orange-500 border-l-[4px] border-l-transparent" />
      )}
      <div className="absolute inset-0 bg-primary/5 opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity" />
    </td>
  );
});

function PaginationBtn({
  icon,
  onClick,
  disabled,
  title,
}: {
  icon: React.ReactNode;
  onClick: () => void;
  disabled: boolean;
  title: string;
}) {
  return (
    <button
      type="button"
      className={cn(
        "p-1 rounded hover:bg-accent transition-colors",
        disabled && "opacity-30 pointer-events-none",
      )}
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      aria-disabled={disabled}
    >
      {icon}
    </button>
  );
}
