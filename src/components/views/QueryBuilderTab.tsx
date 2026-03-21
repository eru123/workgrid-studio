import { useCallback, useEffect, useMemo, useState } from "react";
import { Copy, Plus, Play, RefreshCw, Trash2 } from "lucide-react";
import { QueryBuilder, formatQuery, type Field, type RuleGroupType } from "react-querybuilder";
import { useSchemaStore, type ColumnInfo } from "@/state/schemaStore";
import { useLayoutStore } from "@/state/layoutStore";
import { notifyError, notifySuccess } from "@/lib/notifications";

interface Props {
  profileId: string;
  database?: string;
}

interface JoinRow {
  id: string;
  joinType: "INNER JOIN" | "LEFT JOIN" | "RIGHT JOIN";
  table: string;
  leftColumn: string;
  rightColumn: string;
}

interface OrderRow {
  id: string;
  column: string;
  direction: "ASC" | "DESC";
}

// Stable empty references — prevent useSyncExternalStore infinite loop when
// a schema key doesn't exist yet (inline `?? []` creates a new reference each call).
const EMPTY_STR: string[] = [];
const EMPTY_COL: ColumnInfo[] = [];

function quoteIdent(value: string): string {
  return `\`${value.replace(/`/g, "``")}\``;
}

function buildSql(
  database: string,
  table: string,
  selectedColumns: string[],
  whereSql: string,
  joins: JoinRow[],
  orderRows: OrderRow[],
): string {
  const baseTable = database ? `${quoteIdent(database)}.${quoteIdent(table)}` : quoteIdent(table);
  const columns = selectedColumns.length > 0 ? selectedColumns.map(quoteIdent).join(", ") : "*";
  const joinSql = joins
    .filter((join) => join.table && join.leftColumn && join.rightColumn)
    .map((join) => {
      const joinTable = database ? `${quoteIdent(database)}.${quoteIdent(join.table)}` : quoteIdent(join.table);
      return `${join.joinType} ${joinTable} ON ${quoteIdent(join.leftColumn)} = ${quoteIdent(join.rightColumn)}`;
    })
    .join("\n");
  const orderSql = orderRows
    .filter((order) => order.column)
    .map((order) => `${quoteIdent(order.column)} ${order.direction}`)
    .join(", ");

  const parts = [`SELECT ${columns}`, `FROM ${baseTable}`];
  if (joinSql) {
    parts.push(joinSql);
  }
  if (whereSql.trim()) {
    parts.push(`WHERE ${whereSql.trim()}`);
  }
  if (orderSql) {
    parts.push(`ORDER BY ${orderSql}`);
  }
  parts.push("LIMIT 100;");
  return parts.join("\n");
}

export function QueryBuilderTab({ profileId, database }: Props) {
  const databases = useSchemaStore((state) => state.databases[profileId] ?? EMPTY_STR);
  const [selectedDatabase, setSelectedDatabase] = useState(database ?? databases[0] ?? "");
  const tables = useSchemaStore((state) =>
    selectedDatabase ? state.tables[`${profileId}::${selectedDatabase}`] ?? EMPTY_STR : EMPTY_STR,
  );
  const [selectedTable, setSelectedTable] = useState(tables[0] ?? "");
  const [selectedColumns, setSelectedColumns] = useState<string[]>([]);
  const [query, setQuery] = useState<RuleGroupType>({ combinator: "and", rules: [] });
  const [joins, setJoins] = useState<JoinRow[]>([]);
  const [orderRows, setOrderRows] = useState<OrderRow[]>([]);
  const [sql, setSql] = useState("");
  const handleQueryChange = useCallback((next: RuleGroupType) => setQuery(next), []);

  useEffect(() => {
    if (!database && databases.length > 0 && !selectedDatabase) {
      setSelectedDatabase(databases[0]);
    }
  }, [database, databases, selectedDatabase]);

  useEffect(() => {
    if (database) {
      setSelectedDatabase(database);
    }
  }, [database]);

  useEffect(() => {
    if (!selectedDatabase) {
      return;
    }
    void useSchemaStore.getState().refreshTables(profileId, selectedDatabase);
  }, [profileId, selectedDatabase]);

  useEffect(() => {
    if (!selectedDatabase) {
      return;
    }
    const nextTables = useSchemaStore.getState().tables[`${profileId}::${selectedDatabase}`] ?? [];
    if (nextTables.length > 0 && !nextTables.includes(selectedTable)) {
      setSelectedTable(nextTables[0]);
    }
  }, [profileId, selectedDatabase, selectedTable, tables]);

  const selectedTableColumns = useSchemaStore((state) => {
    if (!selectedDatabase || !selectedTable) return EMPTY_COL;
    return state.columns[`${profileId}::${selectedDatabase}::${selectedTable}`] ?? EMPTY_COL;
  });

  const availableFields = useMemo<Field[]>(
    () =>
      selectedTableColumns.map((column) => ({
        name: column.name,
        label: `${column.name} (${column.col_type})`,
      })),
    [selectedTableColumns],
  );

  useEffect(() => {
    setSelectedColumns(availableFields.map((field) => field.name));
    setJoins([]);
    setOrderRows([]);
    setQuery({ combinator: "and", rules: [] });
  }, [availableFields]);

  useEffect(() => {
    if (!selectedDatabase || !selectedTable) {
      setSql("");
      return;
    }

    let whereSql = "";
    try {
      whereSql = formatQuery(query, { format: "sql", quoteFieldNamesWith: "`" }).trim();
    } catch {
      whereSql = "";
    }

    setSql(buildSql(selectedDatabase, selectedTable, selectedColumns, whereSql, joins, orderRows));
  }, [joins, orderRows, query, selectedColumns, selectedDatabase, selectedTable]);

  const addJoin = () => {
    setJoins((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        joinType: "LEFT JOIN",
        table: "",
        leftColumn: "",
        rightColumn: "",
      },
    ]);
  };

  const addOrder = () => {
    setOrderRows((current) => [...current, { id: crypto.randomUUID(), column: "", direction: "ASC" }]);
  };

  const openQueryTab = () => {
    if (!sql.trim()) {
      notifyError("No SQL generated", "Choose a table and fields before opening the query.");
      return;
    }

    useLayoutStore.getState().openTab({
      title: "Query Builder SQL",
      type: "sql",
      meta: {
        profileId,
        database: selectedDatabase,
        initialSql: sql,
      },
    });
  };

  const copySql = async () => {
    try {
      await navigator.clipboard.writeText(sql);
      notifySuccess("SQL copied", "The generated statement is on your clipboard.");
    } catch (error) {
      notifyError("Failed to copy SQL", String(error));
    }
  };

  const refreshSchema = async () => {
    if (!selectedDatabase) {
      return;
    }
    try {
      await useSchemaStore.getState().refreshTables(profileId, selectedDatabase);
      notifySuccess("Schema refreshed", selectedDatabase);
    } catch (error) {
      notifyError("Failed to refresh schema", String(error));
    }
  };

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider">
          <span>Query Builder</span>
        </div>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => void refreshSchema()}
          className="inline-flex items-center gap-1 rounded border px-2 py-1 text-xs hover:bg-accent"
        >
          <RefreshCw className="h-3 w-3" />
          Refresh Schema
        </button>
        <button
          type="button"
          onClick={copySql}
          className="inline-flex items-center gap-1 rounded border px-2 py-1 text-xs hover:bg-accent"
        >
          <Copy className="h-3 w-3" />
          Copy SQL
        </button>
        <button
          type="button"
          onClick={openQueryTab}
          className="inline-flex items-center gap-1 rounded bg-primary px-2 py-1 text-xs text-primary-foreground"
        >
          <Play className="h-3 w-3" />
          Open in Query Tab
        </button>
      </div>

      <div className="grid flex-1 min-h-0 grid-cols-[300px_minmax(0,1fr)]">
        <div className="min-h-0 overflow-auto border-r p-3">
          <div className="space-y-3">
            <label className="flex flex-col gap-1 text-xs">
              <span className="font-medium">Database</span>
              <select
                value={selectedDatabase}
                onChange={(e) => setSelectedDatabase(e.target.value)}
                className="h-8 rounded border bg-background px-2 outline-none focus:border-primary/50"
              >
                <option value="">Select a database</option>
                {(database ? [database] : databases).map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1 text-xs">
              <span className="font-medium">Table</span>
              <select
                value={selectedTable}
                onChange={(e) => setSelectedTable(e.target.value)}
                className="h-8 rounded border bg-background px-2 outline-none focus:border-primary/50"
                disabled={!selectedDatabase}
              >
                <option value="">Select a table</option>
                {tables.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>

            <div>
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Select Columns
              </div>
              <div className="max-h-64 space-y-1 overflow-auto rounded border bg-background p-2">
                {selectedTableColumns.length === 0 ? (
                  <div className="text-xs text-muted-foreground">No columns available.</div>
                ) : (
                  selectedTableColumns.map((column) => (
                    <label key={column.name} className="flex items-center gap-2 rounded px-1 py-1 text-xs hover:bg-accent/40">
                      <input
                        type="checkbox"
                        checked={selectedColumns.includes(column.name)}
                        onChange={(e) => {
                          setSelectedColumns((current) =>
                            e.target.checked
                              ? [...current, column.name]
                              : current.filter((name) => name !== column.name),
                          );
                        }}
                      />
                      <span className="font-mono">{column.name}</span>
                    </label>
                  ))
                )}
              </div>
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Joins
                </div>
                <button type="button" onClick={addJoin} className="rounded border px-2 py-1 text-[11px] hover:bg-accent">
                  <Plus className="mr-1 inline h-3 w-3" />
                  Add
                </button>
              </div>
              <div className="space-y-2">
                {joins.map((join, index) => (
                  <div key={join.id} className="rounded border bg-background p-2 text-xs">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="font-medium">Join {index + 1}</span>
                      <button
                        type="button"
                        onClick={() => setJoins((current) => current.filter((item) => item.id !== join.id))}
                        className="rounded p-1 text-muted-foreground hover:bg-red-500/10 hover:text-red-500"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                    <select
                      value={join.joinType}
                      onChange={(e) =>
                        setJoins((current) =>
                          current.map((item) =>
                            item.id === join.id ? { ...item, joinType: e.target.value as JoinRow["joinType"] } : item,
                          ),
                        )
                      }
                      className="mb-2 h-8 w-full rounded border bg-background px-2"
                    >
                      <option value="INNER JOIN">INNER JOIN</option>
                      <option value="LEFT JOIN">LEFT JOIN</option>
                      <option value="RIGHT JOIN">RIGHT JOIN</option>
                    </select>
                    <input
                      value={join.table}
                      onChange={(e) =>
                        setJoins((current) =>
                          current.map((item) => (item.id === join.id ? { ...item, table: e.target.value } : item)),
                        )
                      }
                      className="mb-2 h-8 w-full rounded border bg-background px-2 font-mono"
                      placeholder="joined_table"
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        value={join.leftColumn}
                        onChange={(e) =>
                          setJoins((current) =>
                            current.map((item) =>
                              item.id === join.id ? { ...item, leftColumn: e.target.value } : item,
                            ),
                          )
                        }
                        className="h-8 rounded border bg-background px-2 font-mono"
                        placeholder="left_column"
                      />
                      <input
                        value={join.rightColumn}
                        onChange={(e) =>
                          setJoins((current) =>
                            current.map((item) =>
                              item.id === join.id ? { ...item, rightColumn: e.target.value } : item,
                            ),
                          )
                        }
                        className="h-8 rounded border bg-background px-2 font-mono"
                        placeholder="right_column"
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Order By
                </div>
                <button type="button" onClick={addOrder} className="rounded border px-2 py-1 text-[11px] hover:bg-accent">
                  <Plus className="mr-1 inline h-3 w-3" />
                  Add
                </button>
              </div>
              <div className="space-y-2">
                {orderRows.map((order, index) => (
                  <div
                    key={order.id}
                    className="grid grid-cols-[1fr_88px_24px] gap-2 rounded border bg-background p-2 text-xs"
                  >
                    <input
                      value={order.column}
                      onChange={(e) =>
                        setOrderRows((current) =>
                          current.map((item) => (item.id === order.id ? { ...item, column: e.target.value } : item)),
                        )
                      }
                      className="h-8 rounded border bg-background px-2 font-mono"
                      placeholder={`column ${index + 1}`}
                    />
                    <select
                      value={order.direction}
                      onChange={(e) =>
                        setOrderRows((current) =>
                          current.map((item) =>
                            item.id === order.id ? { ...item, direction: e.target.value as OrderRow["direction"] } : item,
                          ),
                        )
                      }
                      className="h-8 rounded border bg-background px-2"
                    >
                      <option value="ASC">ASC</option>
                      <option value="DESC">DESC</option>
                    </select>
                    <button
                      type="button"
                      onClick={() => setOrderRows((current) => current.filter((item) => item.id !== order.id))}
                      className="rounded p-1 text-muted-foreground hover:bg-red-500/10 hover:text-red-500"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="min-h-0 overflow-auto p-3">
          <div className="space-y-3">
            <div className="rounded border bg-background p-3">
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                WHERE Builder
              </div>
              <QueryBuilder
                fields={availableFields}
                query={query}
                onQueryChange={handleQueryChange}
              />
            </div>

            <div className="rounded border bg-background p-3">
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Generated SQL
              </div>
              <textarea
                readOnly
                value={sql}
                className="min-h-64 w-full rounded border bg-muted/20 p-3 font-mono text-[11px] outline-none"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
