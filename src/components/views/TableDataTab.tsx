import { useState, useEffect, useMemo, useCallback, useRef, memo } from "react";
import { dbQuery, dbListColumns } from "@/lib/db";
import type { ColumnInfo, QueryResultSet } from "@/lib/db";
import { cn } from "@/lib/utils/cn";
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

// ═══════════════════════════════════════════════════════════════════════
//  Component
// ═══════════════════════════════════════════════════════════════════════

export function TableDataTab({ profileId, database, tableName }: Props) {
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

  // ── Sorting ─────────────────────────────────────────────
  const [sorts, setSorts] = useState<SortColumn[]>([]);

  // ── Column visibility ───────────────────────────────────
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(new Set());
  const [showColumnPicker, setShowColumnPicker] = useState(false);
  const columnPickerRef = useRef<HTMLDivElement>(null);

  // ── Filter ──────────────────────────────────────────────
  const [whereClause, setWhereClause] = useState("");
  const [appliedWhere, setAppliedWhere] = useState("");
  const [showFilter, setShowFilter] = useState(false);

  // ── Fetch column metadata ───────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setLoadingMeta(true);
    dbListColumns(profileId, database, tableName)
      .then((cols) => {
        if (!cancelled) setColumnInfos(cols);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoadingMeta(false);
      });
    return () => {
      cancelled = true;
    };
  }, [profileId, database, tableName]);

  // ── Build count query ───────────────────────────────────
  const countQuery = useMemo(() => {
    let q = `SELECT COUNT(*) AS cnt FROM ${escId(database)}.${escId(tableName)}`;
    if (appliedWhere.trim()) q += ` WHERE ${appliedWhere.trim()}`;
    return q;
  }, [database, tableName, appliedWhere]);

  // ── Build data query ────────────────────────────────────
  const dataQuery = useMemo(() => {
    let q = `SELECT * FROM ${escId(database)}.${escId(tableName)}`;
    if (appliedWhere.trim()) q += ` WHERE ${appliedWhere.trim()}`;
    if (sorts.length > 0) {
      q += ` ORDER BY ${sorts.map((s) => `${escId(s.column)} ${s.direction}`).join(", ")}`;
    }
    q += ` LIMIT ${pageSize} OFFSET ${page * pageSize}`;
    return q;
  }, [database, tableName, appliedWhere, sorts, page, pageSize]);

  // ── Fetch data ──────────────────────────────────────────
  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [countRes, dataRes] = await Promise.all([
        dbQuery(profileId, countQuery),
        dbQuery(profileId, dataQuery),
      ]);

      const cnt = countRes[0]?.rows?.[0]?.[0];
      setTotalRows(typeof cnt === "number" ? cnt : Number(cnt) || 0);

      const result = dataRes[0] as QueryResultSet | undefined;
      setColumns(result?.columns ?? []);
      setRows(result?.rows ?? []);
    } catch (e) {
      setError(String(e));
      setRows([]);
      setColumns([]);
      setTotalRows(0);
    } finally {
      setLoading(false);
    }
  }, [profileId, countQuery, dataQuery]);

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
  const hideAllColumns = useCallback(() => {
    setHiddenColumns(new Set(columns));
  }, [columns]);

  // ── Visible columns ─────────────────────────────────────
  const visibleColumns = useMemo(
    () => columns.filter((c) => !hiddenColumns.has(c)),
    [columns, hiddenColumns],
  );

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

  // ── Render: Loading ─────────────────────────────────────
  if (loadingMeta && columns.length === 0) {
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
            Columns ({visibleColumns.length}/{columns.length})
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
              {columns.map((col) => (
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

        {/* Row count */}
        <span className="text-muted-foreground text-[10px] mr-1">
          {totalRows.toLocaleString()} rows total
          {appliedWhere ? " (filtered)" : ""}
        </span>
      </div>

      {/* ─── Filter Bar ────────────────────────────── */}
      {showFilter && (
        <div className="flex items-center gap-2 px-3 py-1.5 border-b bg-muted/10 shrink-0">
          <span className="text-[10px] text-muted-foreground shrink-0 font-medium uppercase tracking-wide">
            WHERE
          </span>
          <input
            className="flex-1 h-6 rounded bg-secondary/50 border px-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-primary"
            value={whereClause}
            onChange={(e) => setWhereClause(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") applyFilter();
            }}
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
      )}

      {/* ─── Error banner ──────────────────────────── */}
      {error && (
        <div className="flex items-start gap-2 px-3 py-2 border-b bg-red-500/10 text-red-400 text-xs shrink-0">
          <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span className="break-all">{error}</span>
        </div>
      )}

      {/* ─── Data Grid ─────────────────────────────── */}
      <div className="flex-1 overflow-auto relative">
        {loading && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-background/60 backdrop-blur-[1px]">
            <div className="flex items-center gap-2 rounded border bg-secondary/70 px-3 py-2 text-xs">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Loading data...
            </div>
          </div>
        )}

        <table className="w-full text-xs border-collapse">
          <thead className="sticky top-0 z-10">
            <tr className="bg-muted/70 backdrop-blur-sm">
              {/* Row number column */}
              <th className="text-center px-1.5 py-1.5 text-[10px] font-medium text-muted-foreground/70 uppercase tracking-wider border-b border-r bg-muted/70 whitespace-nowrap w-10">
                #
              </th>
              {visibleColumns.map((col) => {
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
                    onClick={(e) => handleSort(col, e.ctrlKey || e.metaKey)}
                  />
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && !loading && (
              <tr>
                <td
                  colSpan={visibleColumns.length + 1}
                  className="text-center py-10 text-muted-foreground/40"
                >
                  {appliedWhere ? "No rows matching filter" : "Empty table"}
                </td>
              </tr>
            )}
            {rows.map((row, rowIdx) => {
              const rowNumber = page * pageSize + rowIdx + 1;
              return (
                <DataRow
                  key={rowIdx}
                  row={row}
                  rowNumber={rowNumber}
                  columns={columns}
                  visibleColumns={visibleColumns}
                  columnInfos={columnInfos}
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
  onClick,
}: {
  name: string;
  colInfo?: ColumnInfo;
  sortDirection?: "ASC" | "DESC";
  sortIndex: number;
  onClick: (e: React.MouseEvent) => void;
}) {
  const isPK = colInfo?.key === "PRI";

  return (
    <th
      className={cn(
        "text-left px-1.5 py-1.5 text-[10px] font-medium uppercase tracking-wider border-b border-r bg-muted/70 whitespace-nowrap cursor-pointer hover:bg-accent/40 transition-colors select-none group",
        sortDirection && "bg-primary/10",
      )}
      onClick={onClick}
      title={`Click to sort • Ctrl+Click for multi-sort${colInfo ? `\nType: ${colInfo.col_type}` : ""}`}
    >
      <div className="flex items-center gap-1">
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
        <span className="ml-auto flex items-center gap-0.5">
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
      </div>
    </th>
  );
});

const DataRow = memo(function DataRow({
  row,
  rowNumber,
  columns,
  visibleColumns,
  columnInfos,
}: {
  row: (string | number | null)[];
  rowNumber: number;
  columns: string[];
  visibleColumns: string[];
  columnInfos: ColumnInfo[];
}) {
  return (
    <tr className="border-b hover:bg-accent/15 transition-colors">
      <td className="text-center px-1 py-0 border-r h-7 text-muted-foreground/40 tabular-nums text-[10px] bg-muted/20">
        {rowNumber}
      </td>
      {visibleColumns.map((col) => {
        const colIdx = columns.indexOf(col);
        const value = colIdx >= 0 ? row[colIdx] : null;
        const colInfo = columnInfos.find((ci) => ci.name === col);

        return <DataCell key={col} value={value} colInfo={colInfo} />;
      })}
    </tr>
  );
});

const DataCell = memo(function DataCell({
  value,
  colInfo,
}: {
  value: string | number | null;
  colInfo?: ColumnInfo;
}) {
  if (value === null) {
    return (
      <td className="px-1.5 py-0 border-r h-7 max-w-60 truncate">
        <span className="text-muted-foreground/30 italic">NULL</span>
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
      className={cn(
        "px-1.5 py-0 border-r h-7 max-w-80 truncate font-mono",
        isNumeric && "text-right tabular-nums",
      )}
      title={String(value)}
    >
      {String(value)}
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
      className={cn(
        "p-1 rounded hover:bg-accent transition-colors",
        disabled && "opacity-30 pointer-events-none",
      )}
      onClick={onClick}
      disabled={disabled}
      title={title}
    >
      {icon}
    </button>
  );
}
