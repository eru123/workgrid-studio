import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Database,
  GitBranch,
  Loader2,
  Rows3,
  Table2,
} from "lucide-react";
import { dbQuery } from "@/lib/db";
import { cn } from "@/lib/utils/cn";
import { useLayoutStore } from "@/state/layoutStore";

interface Props {
  profileId: string;
  database: string;
}

interface TableMeta {
  name: string;
  engine: string;
  rows: number | null;
  comment: string;
}

interface TableColumn {
  tableName: string;
  columnName: string;
  columnType: string;
  key: string;
  nullable: boolean;
}

interface ForeignKeyRelation {
  constraintName: string;
  tableName: string;
  columnName: string;
  referencedTableName: string;
  referencedColumnName: string;
}

interface PositionedTable {
  table: TableMeta;
  columns: TableColumn[];
  x: number;
  y: number;
  width: number;
  height: number;
}

const CARD_WIDTH = 260;
const CARD_HEADER_HEIGHT = 62;
const CARD_ROW_HEIGHT = 20;
const CARD_GAP_X = 48;
const CARD_GAP_Y = 32;
const MAX_VISIBLE_COLUMNS = 8;

function asString(value: string | number | null | undefined): string {
  return value === null || value === undefined ? "" : String(value);
}

function asNumber(value: string | number | null | undefined): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function escapeSqlLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

export function SchemaDiagramTab({ profileId, database }: Props) {
  const openTab = useLayoutStore((s) => s.openTab);
  const [tables, setTables] = useState<TableMeta[]>([]);
  const [columns, setColumns] = useState<TableColumn[]>([]);
  const [relations, setRelations] = useState<ForeignKeyRelation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const loadDiagram = async () => {
      setLoading(true);
      setError(null);

      const dbLiteral = escapeSqlLiteral(database);

      try {
        const [tableRes, columnRes, relationRes] = await Promise.all([
          dbQuery(
            profileId,
            `SELECT TABLE_NAME, ENGINE, TABLE_ROWS, TABLE_COMMENT
             FROM information_schema.TABLES
             WHERE TABLE_SCHEMA = '${dbLiteral}' AND TABLE_TYPE = 'BASE TABLE'
             ORDER BY TABLE_NAME`,
          ),
          dbQuery(
            profileId,
            `SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, COLUMN_KEY, IS_NULLABLE
             FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = '${dbLiteral}'
             ORDER BY TABLE_NAME, ORDINAL_POSITION`,
          ),
          dbQuery(
            profileId,
            `SELECT CONSTRAINT_NAME, TABLE_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
             FROM information_schema.KEY_COLUMN_USAGE
             WHERE TABLE_SCHEMA = '${dbLiteral}' AND REFERENCED_TABLE_NAME IS NOT NULL
             ORDER BY TABLE_NAME, ORDINAL_POSITION`,
          ),
        ]);

        if (cancelled) return;

        setTables(
          (tableRes[0]?.rows ?? []).map((row) => ({
            name: asString(row[0]),
            engine: asString(row[1]),
            rows: asNumber(row[2]),
            comment: asString(row[3]),
          })),
        );
        setColumns(
          (columnRes[0]?.rows ?? []).map((row) => ({
            tableName: asString(row[0]),
            columnName: asString(row[1]),
            columnType: asString(row[2]),
            key: asString(row[3]),
            nullable: asString(row[4]).toUpperCase() === "YES",
          })),
        );
        setRelations(
          (relationRes[0]?.rows ?? []).map((row) => ({
            constraintName: asString(row[0]),
            tableName: asString(row[1]),
            columnName: asString(row[2]),
            referencedTableName: asString(row[3]),
            referencedColumnName: asString(row[4]),
          })),
        );
      } catch (err) {
        if (!cancelled) {
          setError(String(err));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void loadDiagram();

    return () => {
      cancelled = true;
    };
  }, [database, profileId]);

  const columnsByTable = useMemo(() => {
    const grouped = new Map<string, TableColumn[]>();
    columns.forEach((column) => {
      const bucket = grouped.get(column.tableName) ?? [];
      bucket.push(column);
      grouped.set(column.tableName, bucket);
    });
    return grouped;
  }, [columns]);

  const fkColumnsByTable = useMemo(() => {
    const grouped = new Map<string, Set<string>>();
    relations.forEach((relation) => {
      const bucket = grouped.get(relation.tableName) ?? new Set<string>();
      bucket.add(relation.columnName);
      grouped.set(relation.tableName, bucket);
    });
    return grouped;
  }, [relations]);

  const diagram = useMemo(() => {
    const sortedTables = [...tables].sort((left, right) =>
      left.name.localeCompare(right.name),
    );
    const columnCount = Math.max(
      1,
      Math.min(4, Math.ceil(Math.sqrt(sortedTables.length || 1))),
    );
    const columnHeights = Array.from({ length: columnCount }, () => 0);

    const positionedTables: PositionedTable[] = sortedTables.map((table) => {
      const tableColumns = columnsByTable.get(table.name) ?? [];
      const visibleColumns = tableColumns.slice(0, MAX_VISIBLE_COLUMNS);
      const extraColumns = Math.max(0, tableColumns.length - visibleColumns.length);
      const height =
        CARD_HEADER_HEIGHT +
        visibleColumns.length * CARD_ROW_HEIGHT +
        (extraColumns > 0 ? CARD_ROW_HEIGHT : 0) +
        18;

      const targetColumnIdx = columnHeights.indexOf(Math.min(...columnHeights));
      const x = targetColumnIdx * (CARD_WIDTH + CARD_GAP_X);
      const y = columnHeights[targetColumnIdx];
      columnHeights[targetColumnIdx] += height + CARD_GAP_Y;

      return {
        table,
        columns: tableColumns,
        x,
        y,
        width: CARD_WIDTH,
        height,
      };
    });

    const width =
      (sortedTables.length === 0 ? 1 : columnCount) * CARD_WIDTH +
      Math.max(0, columnCount - 1) * CARD_GAP_X;
    const height = Math.max(320, ...columnHeights) + 40;

    return { positionedTables, width, height };
  }, [columnsByTable, tables]);

  const positionedTableMap = useMemo(() => {
    return new Map(
      diagram.positionedTables.map((entry) => [entry.table.name, entry]),
    );
  }, [diagram.positionedTables]);

  const edgePaths = useMemo(() => {
    return relations
      .map((relation) => {
        const source = positionedTableMap.get(relation.tableName);
        const target = positionedTableMap.get(relation.referencedTableName);
        if (!source || !target) return null;

        const sourceColumnIdx = source.columns.findIndex(
          (column) => column.columnName === relation.columnName,
        );
        const targetColumnIdx = target.columns.findIndex(
          (column) => column.columnName === relation.referencedColumnName,
        );

        const sourceUsesRightAnchor = source.x <= target.x;
        const targetUsesLeftAnchor = sourceUsesRightAnchor;

        const sourceX = sourceUsesRightAnchor ? source.x + source.width : source.x;
        const targetX = targetUsesLeftAnchor ? target.x : target.x + target.width;
        const sourceY =
          source.y +
          CARD_HEADER_HEIGHT +
          (Math.max(sourceColumnIdx, 0) + 0.5) * CARD_ROW_HEIGHT;
        const targetY =
          target.y +
          CARD_HEADER_HEIGHT +
          (Math.max(targetColumnIdx, 0) + 0.5) * CARD_ROW_HEIGHT;
        const horizontalGap = Math.max(42, Math.abs(targetX - sourceX) / 2);
        const controlA = sourceUsesRightAnchor
          ? sourceX + horizontalGap
          : sourceX - horizontalGap;
        const controlB = targetUsesLeftAnchor
          ? targetX - horizontalGap
          : targetX + horizontalGap;

        return {
          id: `${relation.constraintName}:${relation.tableName}:${relation.columnName}`,
          label: `${relation.tableName}.${relation.columnName} -> ${relation.referencedTableName}.${relation.referencedColumnName}`,
          path: `M ${sourceX} ${sourceY} C ${controlA} ${sourceY}, ${controlB} ${targetY}, ${targetX} ${targetY}`,
          danger: source.table.name === relation.referencedTableName,
        };
      })
      .filter((edge): edge is NonNullable<typeof edge> => !!edge);
  }, [positionedTableMap, relations]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        <div className="text-center">
          <Loader2 className="mx-auto mb-2 h-6 w-6 animate-spin" />
          Loading schema diagram...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="max-w-xl rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-100">
          <div className="mb-2 flex items-center gap-2 font-medium">
            <AlertCircle className="h-4 w-4" />
            Failed to load schema diagram
          </div>
          <pre className="whitespace-pre-wrap font-mono text-xs">{error}</pre>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="border-b bg-muted/20 px-3 py-2">
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          <span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 font-medium text-primary">
            Schema diagram
          </span>
          <span className="flex items-center gap-1 text-muted-foreground">
            <Database className="h-3.5 w-3.5" />
            {database}
          </span>
          <span className="flex items-center gap-1 text-muted-foreground">
            <Table2 className="h-3.5 w-3.5" />
            {tables.length.toLocaleString()} table(s)
          </span>
          <span className="flex items-center gap-1 text-muted-foreground">
            <GitBranch className="h-3.5 w-3.5" />
            {relations.length.toLocaleString()} relation(s)
          </span>
          <span className="flex items-center gap-1 text-muted-foreground">
            <Rows3 className="h-3.5 w-3.5" />
            Click a table card to open `TableDesigner`
          </span>
        </div>
      </div>

      {tables.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          This database has no readable base tables.
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-auto bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.04),_transparent_55%)] p-5">
          <div
            className="relative rounded-xl border border-border/60 bg-card/40 p-5 shadow-sm"
            style={{ width: diagram.width + 40, minHeight: diagram.height + 40 }}
          >
            <svg
              className="pointer-events-none absolute left-5 top-5"
              width={diagram.width}
              height={diagram.height}
              viewBox={`0 0 ${diagram.width} ${diagram.height}`}
              aria-hidden="true"
            >
              <defs>
                <marker
                  id="schema-edge-arrow"
                  markerWidth="8"
                  markerHeight="8"
                  refX="6"
                  refY="3"
                  orient="auto"
                >
                  <path d="M0,0 L0,6 L6,3 z" fill="currentColor" />
                </marker>
              </defs>
              {edgePaths.map((edge) => (
                <path
                  key={edge.id}
                  d={edge.path}
                  className={cn(
                    "fill-none stroke-[1.5]",
                    edge.danger ? "text-yellow-400/80" : "text-sky-400/70",
                  )}
                  markerEnd="url(#schema-edge-arrow)"
                >
                  <title>{edge.label}</title>
                </path>
              ))}
            </svg>

            {diagram.positionedTables.map((entry) => {
              const visibleColumns = entry.columns.slice(0, MAX_VISIBLE_COLUMNS);
              const hiddenColumns = Math.max(
                0,
                entry.columns.length - visibleColumns.length,
              );
              const fkColumns = fkColumnsByTable.get(entry.table.name) ?? new Set<string>();

              return (
                <button
                  key={entry.table.name}
                  type="button"
                  className="absolute overflow-hidden rounded-xl border border-border/80 bg-background/95 text-left shadow-lg transition-all hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-primary/10"
                  style={{
                    left: entry.x + 20,
                    top: entry.y + 20,
                    width: entry.width,
                    minHeight: entry.height,
                  }}
                  onClick={() =>
                    openTab({
                      title: entry.table.name,
                      type: "table-designer",
                      meta: {
                        profileId,
                        database,
                        tableName: entry.table.name,
                      },
                    })
                  }
                >
                  <div className="border-b bg-muted/30 px-3 py-2">
                    <div className="flex items-center gap-2">
                      <Table2 className="h-4 w-4 text-primary" />
                      <span className="truncate font-medium">{entry.table.name}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
                      {entry.table.engine && (
                        <span className="rounded bg-muted px-1.5 py-0.5">
                          {entry.table.engine}
                        </span>
                      )}
                      {entry.table.rows !== null && (
                        <span className="rounded bg-muted px-1.5 py-0.5">
                          {entry.table.rows.toLocaleString()} rows
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="px-3 py-2">
                    <div className="space-y-1">
                      {visibleColumns.map((column) => (
                        <div
                          key={`${entry.table.name}:${column.columnName}`}
                          className="flex items-center gap-2 text-[11px]"
                        >
                          <span
                            className={cn(
                              "min-w-7 rounded px-1.5 py-0.5 text-center text-[10px] font-medium",
                              column.key === "PRI"
                                ? "bg-amber-500/15 text-amber-200"
                                : fkColumns.has(column.columnName)
                                  ? "bg-sky-500/15 text-sky-200"
                                  : "bg-muted text-muted-foreground",
                            )}
                          >
                            {column.key === "PRI"
                              ? "PK"
                              : fkColumns.has(column.columnName)
                                ? "FK"
                                : column.nullable
                                  ? "NULL"
                                  : "COL"}
                          </span>
                          <span className="truncate font-medium text-foreground">
                            {column.columnName}
                          </span>
                          <span className="truncate text-muted-foreground">
                            {column.columnType}
                          </span>
                        </div>
                      ))}
                    </div>

                    {hiddenColumns > 0 && (
                      <div className="mt-2 text-[11px] text-muted-foreground">
                        + {hiddenColumns} more column(s)
                      </div>
                    )}

                    {entry.table.comment && (
                      <div
                        className="mt-3 border-t pt-2 text-[10px] text-muted-foreground"
                        title={entry.table.comment}
                      >
                        {entry.table.comment}
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
