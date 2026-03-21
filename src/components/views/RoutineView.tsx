import { useEffect, useMemo, useState } from "react";
import { AlertCircle, Plus, RefreshCw, Trash2 } from "lucide-react";
import {
  dbCreateOrReplaceRoutine,
  dbDropRoutine,
  dbGetRoutineDdl,
  dbListRoutines,
  dbQuery,
  type QueryResultSet,
  type RoutineInfo,
} from "@/lib/db";
import { CodeEditorShell } from "@/components/ui/CodeEditorShell";
import { ConfirmModal } from "@/components/views/ConfirmModal";
import { cn } from "@/lib/utils/cn";
import { notifyError, notifySuccess } from "@/lib/notifications";

interface Props {
  profileId: string;
  database: string;
}

type RoutineKind = "PROCEDURE" | "FUNCTION";

interface RoutineParam {
  name: string;
  placeholder: string;
}

function quoteIdent(value: string): string {
  return `\`${value.replace(/`/g, "``")}\``;
}

function buildRoutineTemplate(kind: RoutineKind, database: string, routineName = "new_routine"): string {
  const statement =
    kind === "FUNCTION"
      ? [
          `CREATE FUNCTION ${quoteIdent(routineName)}(p_id INT)`,
          `RETURNS INT`,
          `BEGIN`,
          `  RETURN p_id;`,
          `END;`,
        ]
      : [
          `CREATE PROCEDURE ${quoteIdent(routineName)}(IN p_id INT)`,
          `BEGIN`,
          `  SELECT p_id;`,
          `END;`,
        ];

  return [`USE ${quoteIdent(database)};`, ...statement].join("\n");
}

function splitTopLevel(input: string): string[] {
  const parts: string[] = [];
  let current = "";
  let depth = 0;
  let quote: "'" | '"' | "`" | null = null;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    const prev = input[i - 1];

    if (quote) {
      current += char;
      if (char === quote && prev !== "\\") {
        quote = null;
      }
      continue;
    }

    if (char === "'" || char === '"' || char === "`") {
      quote = char;
      current += char;
      continue;
    }

    if (char === "(") depth += 1;
    if (char === ")") depth = Math.max(0, depth - 1);

    if (char === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  if (current.trim()) {
    parts.push(current.trim());
  }

  return parts;
}

function parseRoutineParams(ddl: string): RoutineParam[] {
  const headerMatch = ddl.match(
    /\bCREATE\s+(?:DEFINER\s*=\s*[^\s]+\s+)?(?:PROCEDURE|FUNCTION)\s+[^\s(]+\s*\(([\s\S]*?)\)\s*(?:RETURNS|BEGIN|COMMENT|LANGUAGE|DETERMINISTIC|READS|MODIFIES|SQL|RETURN|AS|BEGIN|;)/i,
  );
  const block = headerMatch?.[1] ?? "";
  if (!block.trim()) {
    return [];
  }

  return splitTopLevel(block)
    .map((chunk) => {
      const match = chunk.match(/^\s*(?:IN|INOUT|OUT)\s+([`"\w]+)\s+(.+?)\s*$/i);
      if (!match) {
        return null;
      }
      return {
        name: match[1].replace(/[`"]/g, ""),
        placeholder: match[2].trim(),
      };
    })
    .filter((param): param is RoutineParam => Boolean(param));
}

function escapeSqlLiteral(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function formatRoutineArgs(values: string[]): string {
  return values.map((value) => `'${escapeSqlLiteral(value)}'`).join(", ");
}

function ResultPreview({ results }: { results: QueryResultSet[] }) {
  if (results.length === 0) {
    return <div className="text-xs text-muted-foreground">No result sets returned.</div>;
  }

  const active = results[0];
  return (
    <div className="space-y-2">
      <div className="text-[11px] text-muted-foreground">
        {results.length} result set(s), {active.rows.length} row(s) in the first set.
      </div>
      <div className="overflow-auto rounded border">
        <table className="w-full text-[11px]">
          <thead className="sticky top-0 bg-muted/30">
            <tr>
              {active.columns.map((column) => (
                <th key={column} className="border-b px-2 py-1 text-left font-medium">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {active.rows.slice(0, 20).map((row, rowIndex) => (
              <tr key={rowIndex} className="border-b last:border-b-0">
                {row.map((value, colIndex) => (
                  <td key={`${rowIndex}-${colIndex}`} className="px-2 py-1 align-top">
                    {value === null ? <span className="italic text-muted-foreground">NULL</span> : String(value)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function RoutineView({ profileId, database }: Props) {
  const [routineType, setRoutineType] = useState<RoutineKind>("PROCEDURE");
  const [routines, setRoutines] = useState<RoutineInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedName, setSelectedName] = useState("");
  const [ddl, setDdl] = useState("");
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [executionResult, setExecutionResult] = useState<QueryResultSet[]>([]);
  const [paramValues, setParamValues] = useState<Record<string, string>>({});
  const [dropTarget, setDropTarget] = useState<RoutineInfo | null>(null);

  const selectedRoutine = useMemo(
    () => routines.find((routine) => routine.name === selectedName) ?? null,
    [routines, selectedName],
  );

  const refresh = async () => {
    setLoading(true);
    try {
      const next = await dbListRoutines(profileId, database, routineType);
      setRoutines(next);
      if (next.length > 0) {
        setSelectedName((current) => (next.some((routine) => routine.name === current) ? current : next[0].name));
      } else {
        setSelectedName("");
        setDdl(buildRoutineTemplate(routineType, database));
      }
    } catch (error) {
      notifyError("Failed to load routines", String(error));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId, database, routineType]);

  useEffect(() => {
    if (!selectedRoutine) {
      return;
    }

    let cancelled = false;
    void dbGetRoutineDdl(profileId, database, selectedRoutine.name, routineType)
      .then((sql) => {
        if (!cancelled) {
          setDdl(sql);
          const params = parseRoutineParams(sql);
          setParamValues((current) => {
            const nextValues: Record<string, string> = {};
            params.forEach((param) => {
              nextValues[param.name] = current[param.name] ?? "";
            });
            return nextValues;
          });
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setDdl(buildRoutineTemplate(routineType, database, selectedRoutine.name));
          notifyError("Failed to load routine DDL", String(error));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [database, profileId, routineType, selectedRoutine]);

  const parsedParams = useMemo(() => parseRoutineParams(ddl), [ddl]);

  const filteredRoutines = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) {
      return routines;
    }
    return routines.filter((routine) => routine.name.toLowerCase().includes(query));
  }, [routines, search]);

  const handleSave = async () => {
    if (!ddl.trim()) {
      notifyError("Routine DDL is empty", "Enter a CREATE PROCEDURE/FUNCTION statement first.");
      return;
    }

    setSaving(true);
    try {
      await dbCreateOrReplaceRoutine(profileId, database, ddl);
      notifySuccess("Routine saved", "The routine DDL was executed successfully.");
      await refresh();
    } catch (error) {
      notifyError("Failed to save routine", String(error));
    } finally {
      setSaving(false);
    }
  };

  const handleExecute = async () => {
    if (!selectedName) {
      notifyError("No routine selected", "Select a routine before executing it.");
      return;
    }

    setExecuting(true);
    setExecutionResult([]);
    try {
      const args = parsedParams.map((param) => paramValues[param.name] ?? "");
      const sql =
        routineType === "PROCEDURE"
          ? `CALL ${quoteIdent(selectedName)}(${formatRoutineArgs(args)});`
          : `SELECT ${quoteIdent(selectedName)}(${formatRoutineArgs(args)}) AS result;`;
      const results = await dbQuery(profileId, sql);
      setExecutionResult(results);
      notifySuccess("Routine executed", routineType === "PROCEDURE" ? "Procedure call completed." : "Function call completed.");
    } catch (error) {
      notifyError("Failed to execute routine", String(error));
    } finally {
      setExecuting(false);
    }
  };

  const handleCreateNew = () => {
    setSelectedName("");
    setDdl(buildRoutineTemplate(routineType, database));
    setParamValues({});
    setExecutionResult([]);
  };

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider">
          <span>Routines</span>
          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
            {database}
          </span>
        </div>
        <div className="flex gap-1 rounded border bg-muted/20 p-0.5">
          {(["PROCEDURE", "FUNCTION"] as const).map((kind) => (
            <button
              key={kind}
              type="button"
              onClick={() => setRoutineType(kind)}
              className={cn(
                "rounded px-2 py-1 text-[11px] font-medium",
                routineType === kind ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {kind}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search routines"
          className="h-7 w-44 rounded border bg-background px-2 text-xs outline-none focus:border-primary/50"
        />
        <button
          type="button"
          onClick={handleCreateNew}
          className="inline-flex items-center gap-1 rounded border px-2 py-1 text-xs hover:bg-accent"
        >
          <Plus className="h-3 w-3" />
          New
        </button>
        <button
          type="button"
          onClick={() => void refresh()}
          className="inline-flex items-center gap-1 rounded border px-2 py-1 text-xs hover:bg-accent"
        >
          <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} />
          Refresh
        </button>
      </div>

      <div className="grid flex-1 min-h-0 grid-cols-[260px_minmax(0,1fr)]">
        <div className="overflow-auto border-r">
          {filteredRoutines.length === 0 ? (
            <div className="p-4 text-xs text-muted-foreground">
              <div className="flex items-center gap-2">
                <AlertCircle className="h-3.5 w-3.5" />
                No {routineType.toLowerCase()}s found.
              </div>
            </div>
          ) : (
            filteredRoutines.map((routine) => (
              <button
                key={routine.name}
                type="button"
                onClick={() => setSelectedName(routine.name)}
                className={cn(
                  "flex w-full items-center gap-2 border-b px-3 py-2 text-left text-xs hover:bg-accent/50",
                  selectedName === routine.name && "bg-accent/70",
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{routine.name}</div>
                  <div className="truncate text-[10px] text-muted-foreground">
                    {routine.data_type ?? routine.routine_type}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setDropTarget(routine);
                  }}
                  className="rounded p-1 text-muted-foreground hover:bg-red-500/10 hover:text-red-500"
                  aria-label={`Drop ${routine.name}`}
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </button>
            ))
          )}
        </div>

        <div className="flex min-h-0 flex-col">
          <div className="flex items-center justify-between gap-3 border-b px-3 py-2">
            <div className="min-w-0 text-xs text-muted-foreground">
              {selectedRoutine ? (
                <>
                  <span className="font-medium text-foreground">{selectedRoutine.name}</span>
                  <span className="mx-2">|</span>
                  <span>{selectedRoutine.routine_type}</span>
                </>
              ) : (
                "Create or select a routine to edit its DDL."
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void handleExecute()}
                disabled={executing || !selectedName}
                className="rounded border px-3 py-1.5 text-xs hover:bg-accent disabled:opacity-50"
              >
                {executing ? "Executing..." : "Execute"}
              </button>
              <button
                type="button"
                onClick={() => void handleSave()}
                disabled={saving || !ddl.trim()}
                className="rounded bg-primary px-3 py-1.5 text-xs text-primary-foreground disabled:opacity-50"
              >
                {saving ? "Saving..." : "Save DDL"}
              </button>
            </div>
          </div>

          <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_220px] gap-3 p-3">
            <CodeEditorShell value={ddl} onChange={setDdl} language="sql" className="h-full min-h-[260px]" />

            <div className="grid min-h-0 grid-cols-[280px_minmax(0,1fr)] gap-3">
              <div className="min-h-0 overflow-auto rounded border bg-muted/10 p-3">
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Parameters
                </div>
                {parsedParams.length === 0 ? (
                  <div className="text-xs text-muted-foreground">No IN parameters detected.</div>
                ) : (
                  <div className="space-y-2">
                    {parsedParams.map((param) => (
                      <label key={param.name} className="flex flex-col gap-1 text-[11px]">
                        <span className="font-medium text-foreground">
                          {param.name}
                          <span className="ml-1 text-muted-foreground">({param.placeholder})</span>
                        </span>
                        <input
                          value={paramValues[param.name] ?? ""}
                          onChange={(e) =>
                            setParamValues((current) => ({
                              ...current,
                              [param.name]: e.target.value,
                            }))
                          }
                          className="h-8 rounded border bg-background px-2 text-xs outline-none focus:border-primary/50"
                        />
                      </label>
                    ))}
                  </div>
                )}
              </div>

              <div className="min-h-0 overflow-auto rounded border bg-background p-3">
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Execution Preview
                </div>
                {executionResult.length > 0 ? (
                  <ResultPreview results={executionResult} />
                ) : (
                  <div className="text-xs text-muted-foreground">
                    Execute the selected routine to inspect the returned result sets here.
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {dropTarget && (
        <ConfirmModal
          title={`Drop routine ${dropTarget.name}?`}
          message={`This will permanently drop routine "${dropTarget.name}".`}
          confirmLabel="Drop"
          danger
          onCancel={() => setDropTarget(null)}
          onConfirm={async () => {
            try {
              await dbDropRoutine(profileId, database, dropTarget.name, routineType);
              notifySuccess("Routine dropped", dropTarget.name);
              setDropTarget(null);
              await refresh();
            } catch (error) {
              notifyError("Failed to drop routine", String(error));
            }
          }}
        />
      )}
    </div>
  );
}
