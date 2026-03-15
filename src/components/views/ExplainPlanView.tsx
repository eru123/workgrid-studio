import { useMemo } from "react";
import { AlertCircle, Clock3, Database, Layers3 } from "lucide-react";
import { cn } from "@/lib/utils/cn";

export type ExplainMode = "explain" | "analyze";

export interface ExplainResultPayload {
  mode: ExplainMode;
  format: "json" | "text";
  rawText: string;
  parsedJson: unknown | null;
}

interface ExplainPlanViewProps {
  payload: ExplainResultPayload | null;
  loading: boolean;
  error: string | null;
}

type NodeSeverity = "normal" | "warn" | "danger";

interface ExplainTreeNode {
  id: string;
  label: string;
  summary: string[];
  reasons: string[];
  severity: NodeSeverity;
  children: ExplainTreeNode[];
}

const NON_PLAN_KEYS = new Set([
  "cost_info",
  "message",
  "used_columns",
  "used_key_parts",
  "attached_condition",
  "filtered",
  "possible_keys",
  "key",
  "key_length",
  "ref",
  "rows",
  "rows_examined_per_scan",
  "rows_produced_per_join",
  "table_name",
  "access_type",
  "select_id",
  "using_filesort",
  "using_temporary_table",
  "temporary_table",
  "dependent",
  "cacheable",
  "materialized",
  "query_cost",
  "read_cost",
  "eval_cost",
  "prefix_cost",
  "data_read_per_join",
  "r_loops",
  "r_total_time_ms",
  "r_table_time_ms",
  "r_other_time_ms",
  "r_rows",
  "r_filtered",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function asBoolean(value: unknown): boolean {
  return value === true;
}

function prettifyKey(key: string): string {
  return key
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function classifySeverity(reasons: string[]): NodeSeverity {
  if (reasons.some((reason) => reason.includes("Full table scan"))) {
    return "danger";
  }
  if (reasons.length > 0) {
    return "warn";
  }
  return "normal";
}

function collectChildNodes(
  source: Record<string, unknown>,
  path: string,
): ExplainTreeNode[] {
  const children: ExplainTreeNode[] = [];

  Object.entries(source).forEach(([key, value], index) => {
    if (NON_PLAN_KEYS.has(key)) return;

    if (Array.isArray(value)) {
      value.forEach((item, itemIndex) => {
        if (!isRecord(item)) return;
        const node = buildTreeNode(
          key,
          item,
          `${path}.${key}.${itemIndex}`,
        );
        if (node) children.push(node);
      });
      return;
    }

    if (isRecord(value)) {
      const node = buildTreeNode(key, value, `${path}.${key}.${index}`);
      if (node) children.push(node);
    }
  });

  return children;
}

function buildTreeNode(
  key: string,
  source: Record<string, unknown>,
  path: string,
): ExplainTreeNode | null {
  const tableName = asString(source.table_name);
  const accessType = asString(source.access_type);
  const selectId = asNumber(source.select_id);
  const rowsExamined =
    asNumber(source.rows_examined_per_scan) ??
    asNumber(source.rows_produced_per_join) ??
    asNumber(source.rows) ??
    asNumber(source.r_rows);
  const queryCost = isRecord(source.cost_info)
    ? asString(source.cost_info.query_cost) ??
      asString(source.cost_info.prefix_cost) ??
      asString(source.cost_info.read_cost)
    : null;
  const totalTimeMs = asNumber(source.r_total_time_ms);
  const usingFilesort =
    asBoolean(source.using_filesort) || key === "ordering_operation";
  const usingTemporary =
    asBoolean(source.using_temporary_table) || asBoolean(source.temporary_table);

  const summary: string[] = [];
  const reasons: string[] = [];

  if (selectId !== null) {
    summary.push(`select #${selectId}`);
  }
  if (accessType) {
    summary.push(accessType.toLowerCase());
    if (accessType.toUpperCase() === "ALL") {
      reasons.push("Full table scan");
    }
  }
  if (rowsExamined !== null) {
    summary.push(`${Math.round(rowsExamined).toLocaleString()} rows`);
    if (rowsExamined >= 10_000) {
      reasons.push("Large row estimate");
    }
  }
  if (queryCost) {
    summary.push(`cost ${queryCost}`);
  }
  if (totalTimeMs !== null) {
    summary.push(`${totalTimeMs.toFixed(2)} ms`);
  }
  if (usingFilesort) {
    reasons.push("Sort / filesort");
  }
  if (usingTemporary) {
    reasons.push("Temporary table");
  }

  const children = collectChildNodes(source, path);

  const label = tableName
    ? `Table ${tableName}`
    : key === "query_block"
      ? "Query Block"
      : key === "nested_loop"
        ? "Nested Loop"
        : key === "ordering_operation"
          ? "Sort"
          : key === "grouping_operation"
            ? "Grouping"
            : key === "duplicates_removal"
              ? "Duplicate Removal"
              : prettifyKey(key);

  if (!tableName && summary.length === 0 && children.length === 0) {
    return null;
  }

  return {
    id: path,
    label,
    summary,
    reasons,
    severity: classifySeverity(reasons),
    children,
  };
}

function parseExplainTree(json: unknown): ExplainTreeNode | null {
  if (!isRecord(json)) return null;
  if (isRecord(json.query_block)) {
    return buildTreeNode("query_block", json.query_block, "query_block");
  }
  return buildTreeNode("plan", json, "plan");
}

function toneClasses(severity: NodeSeverity) {
  switch (severity) {
    case "danger":
      return "border-red-500/40 bg-red-500/10 text-red-100";
    case "warn":
      return "border-yellow-500/40 bg-yellow-500/10 text-yellow-100";
    default:
      return "border-border bg-card/60 text-foreground";
  }
}

function severityLabel(severity: NodeSeverity) {
  switch (severity) {
    case "danger":
      return "Expensive";
    case "warn":
      return "Watch";
    default:
      return "Normal";
  }
}

function ExplainTreeBranch({
  node,
  depth = 0,
}: {
  node: ExplainTreeNode;
  depth?: number;
}) {
  return (
    <div className="relative" style={{ marginLeft: depth * 16 }}>
      {depth > 0 && (
        <div className="absolute left-[-10px] top-0 bottom-0 w-px bg-border/70" />
      )}
      <div className={cn("rounded-lg border p-3 shadow-sm", toneClasses(node.severity))}>
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{node.label}</span>
          <span className="rounded-full border border-current/20 px-2 py-0.5 text-[10px] uppercase tracking-wide opacity-80">
            {severityLabel(node.severity)}
          </span>
        </div>

        {node.summary.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-2 text-[11px] opacity-85">
            {node.summary.map((item) => (
              <span key={item} className="rounded bg-background/40 px-1.5 py-0.5">
                {item}
              </span>
            ))}
          </div>
        )}

        {node.reasons.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
            {node.reasons.map((reason) => (
              <span key={reason} className="rounded bg-background/50 px-1.5 py-0.5">
                {reason}
              </span>
            ))}
          </div>
        )}
      </div>

      {node.children.length > 0 && (
        <div className="mt-3 space-y-3">
          {node.children.map((child) => (
            <ExplainTreeBranch key={child.id} node={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

export function ExplainPlanView({
  payload,
  loading,
  error,
}: ExplainPlanViewProps) {
  const planTree = useMemo(() => {
    if (!payload?.parsedJson) return null;
    return parseExplainTree(payload.parsedJson);
  }, [payload]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <div className="text-center">
          <Layers3 className="mx-auto mb-2 h-6 w-6 animate-pulse" />
          <div>Building execution plan...</div>
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
            Explain failed
          </div>
          <pre className="whitespace-pre-wrap font-mono text-xs">{error}</pre>
        </div>
      </div>
    );
  }

  if (!payload) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <div className="text-center">
          <Database className="mx-auto mb-2 h-6 w-6 opacity-50" />
          <div>Run Explain to inspect the query plan.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="shrink-0 border-b bg-muted/20 px-3 py-2">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="rounded-full border px-2 py-0.5 font-medium uppercase tracking-wide">
            {payload.mode === "analyze" ? "Explain Analyze" : "Explain JSON"}
          </span>
          <span className="text-muted-foreground">
            {payload.format === "json"
              ? "Visual tree generated from JSON output."
              : "Server returned textual plan output."}
          </span>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4">
        {payload.format === "json" && planTree ? (
          <div className="space-y-3">
            <ExplainTreeBranch node={planTree} />
          </div>
        ) : (
          <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-4 text-sm text-yellow-100">
            <div className="mb-2 flex items-center gap-2 font-medium">
              <Clock3 className="h-4 w-4" />
              Raw explain output
            </div>
            <p className="mb-3 text-xs text-yellow-50/80">
              This server returned a textual plan, so the visual tree is unavailable for this mode.
            </p>
            <pre className="overflow-auto whitespace-pre-wrap font-mono text-xs">
              {payload.rawText}
            </pre>
          </div>
        )}

        {payload.rawText && (
          <details className="mt-4 rounded-lg border bg-card/40 p-3">
            <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
              Raw payload
            </summary>
            <pre className="mt-3 overflow-auto whitespace-pre-wrap font-mono text-xs text-muted-foreground">
              {payload.rawText}
            </pre>
          </details>
        )}
      </div>
    </div>
  );
}
