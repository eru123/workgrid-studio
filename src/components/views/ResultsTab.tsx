import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  Clock,
  Database,
  FileSearch,
  Rows3,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { useResultsStore } from "@/state/resultsStore";

interface Props {
  tabId: string;
}

export function ResultsTab({ tabId }: Props) {
  const snapshot = useResultsStore((s) => s.tabs[tabId] ?? null);
  const [activeResultIdx, setActiveResultIdx] = useState(0);

  useEffect(() => {
    setActiveResultIdx(0);
  }, [tabId, snapshot?.createdAt]);

  const totalRows = useMemo(
    () => snapshot?.results.reduce((sum, result) => sum + result.rows.length, 0) ?? 0,
    [snapshot],
  );

  const activeResult = snapshot?.results[activeResultIdx] ?? null;

  if (!snapshot) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Result snapshot is no longer available.
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="border-b bg-muted/20 px-3 py-2">
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          <span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 font-medium text-primary">
            Frozen results
          </span>
          <span className="flex items-center gap-1 text-muted-foreground">
            <Database className="h-3.5 w-3.5" />
            {snapshot.database || "(no database)"}
          </span>
          <span className="flex items-center gap-1 text-muted-foreground">
            <Rows3 className="h-3.5 w-3.5" />
            {totalRows.toLocaleString()} row(s)
          </span>
          {snapshot.executionTimeMs !== null && (
            <span className="flex items-center gap-1 text-muted-foreground">
              <Clock className="h-3.5 w-3.5" />
              {snapshot.executionTimeMs < 1000
                ? `${Math.round(snapshot.executionTimeMs)}ms`
                : `${(snapshot.executionTimeMs / 1000).toFixed(2)}s`}
            </span>
          )}
        </div>
        <div className="mt-2 flex items-start gap-2 rounded-md border bg-card/60 px-3 py-2">
          <FileSearch className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <div className="text-[11px] font-medium text-foreground">
              Source: {snapshot.sourceTitle}
            </div>
            <pre className="mt-1 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] text-muted-foreground">
              {snapshot.queryText}
            </pre>
          </div>
        </div>
      </div>

      {snapshot.results.length > 1 && (
        <div className="shrink-0 border-b bg-muted/10 px-1">
          <div className="flex items-center gap-1 overflow-x-auto py-1">
            {snapshot.results.map((result, index) => (
              <button
                key={`${tabId}-result-${index}`}
                type="button"
                onClick={() => setActiveResultIdx(index)}
                className={cn(
                  "shrink-0 rounded-md border px-2.5 py-1 text-[11px] transition-colors",
                  activeResultIdx === index
                    ? "border-primary/40 bg-primary/10 text-primary"
                    : "border-transparent text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                Result {index + 1} ({result.rows.length.toLocaleString()} row(s))
              </button>
            ))}
          </div>
        </div>
      )}

      {!activeResult ? (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          No result sets were captured for this execution.
        </div>
      ) : activeResult.columns.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-muted-foreground">
          <div>
            <CheckCircle2 className="mx-auto mb-2 h-6 w-6 text-green-500/60" />
            <div>{activeResult.info || "Query executed successfully."}</div>
            {activeResult.affected_rows > 0 && (
              <div className="mt-1 text-xs text-muted-foreground/70">
                {activeResult.affected_rows.toLocaleString()} row(s) affected
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-auto">
          <table
            className="min-w-max border-collapse text-xs"
            role="grid"
            aria-label="Frozen query results"
            aria-rowcount={activeResult.rows.length + 1}
            aria-colcount={activeResult.columns.length + 1}
          >
            <thead>
              <tr className="sticky top-0 z-10 bg-muted" role="row" aria-rowindex={1}>
                <th
                  className="w-12 border-b border-r bg-muted px-2 py-1.5 text-center text-[10px] font-medium text-muted-foreground/70"
                  role="columnheader"
                  aria-colindex={1}
                >
                  #
                </th>
                {activeResult.columns.map((column, index) => (
                  <th
                    key={`${tabId}-col-${index}`}
                    className="border-b border-r bg-muted px-2 py-1.5 text-left text-[10px] font-medium text-muted-foreground/70"
                    role="columnheader"
                    aria-colindex={index + 2}
                  >
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {activeResult.rows.map((row, rowIdx) => (
                <tr
                  key={`${tabId}-row-${rowIdx}`}
                  className="border-b transition-colors hover:bg-accent/20"
                  role="row"
                  aria-rowindex={rowIdx + 2}
                >
                  <td
                    className="border-r px-2 py-1 text-center text-muted-foreground/50"
                    role="rowheader"
                    aria-colindex={1}
                  >
                    {rowIdx + 1}
                  </td>
                  {row.map((value, colIdx) => (
                    <td
                      key={`${tabId}-cell-${rowIdx}-${colIdx}`}
                      className={cn(
                        "max-w-[28rem] border-r px-2 py-1 font-mono",
                        value === null
                          ? "italic text-muted-foreground/50"
                          : "text-foreground",
                      )}
                      role="gridcell"
                      aria-colindex={colIdx + 2}
                    >
                      <span className="block truncate" title={value === null ? "NULL" : String(value)}>
                        {value === null ? "NULL" : String(value)}
                      </span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
