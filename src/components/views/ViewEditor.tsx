import { useEffect, useMemo, useState } from "react";
import { AlertCircle, Eye, Plus, RefreshCw, Trash2 } from "lucide-react";
import {
  dbCreateOrReplaceView,
  dbDropView,
  dbGetViewDdl,
  dbQuery,
  dbListViews,
  type QueryResultSet,
  type ViewInfo,
} from "@/lib/db";
import { CodeEditorShell } from "@/components/ui/CodeEditorShell";
import { ConfirmModal } from "@/components/views/ConfirmModal";
import { cn } from "@/lib/utils/cn";
import { notifyError, notifySuccess } from "@/lib/notifications";

interface Props {
  profileId: string;
  database: string;
  viewName?: string;
}

function quoteIdent(value: string): string {
  return `\`${value.replace(/`/g, "``")}\``;
}

function buildViewTemplate(database: string, viewName = "new_view"): string {
  return [
    `CREATE OR REPLACE VIEW ${quoteIdent(viewName)} AS`,
    `SELECT *`,
    `FROM ${quoteIdent(database)}.${quoteIdent("some_table")};`,
  ].join("\n");
}

function PreviewTable({ result }: { result: QueryResultSet | null }) {
  if (!result) {
    return <div className="text-xs text-muted-foreground">Run a preview to inspect the first 100 rows.</div>;
  }

  return (
    <div className="overflow-auto rounded border">
      <table className="w-full text-[11px]">
        <thead className="sticky top-0 bg-muted/30">
          <tr>
            {result.columns.map((column) => (
              <th key={column} className="border-b px-2 py-1 text-left font-medium">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {result.rows.slice(0, 20).map((row, rowIndex) => (
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
  );
}

export function ViewEditor({ profileId, database, viewName }: Props) {
  const [views, setViews] = useState<ViewInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedName, setSelectedName] = useState(viewName ?? "");
  const [ddl, setDdl] = useState("");
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [preview, setPreview] = useState<QueryResultSet | null>(null);
  const [dropTarget, setDropTarget] = useState<ViewInfo | null>(null);

  const selectedView = useMemo(
    () => views.find((view) => view.name === selectedName) ?? null,
    [selectedName, views],
  );

  const refresh = async () => {
    setLoading(true);
    try {
      const next = await dbListViews(profileId, database);
      setViews(next);
      if (next.length > 0 && !next.some((view) => view.name === selectedName)) {
        setSelectedName(next[0].name);
      }
      if (next.length === 0) {
        setSelectedName("");
        setDdl(buildViewTemplate(database));
      }
    } catch (error) {
      notifyError("Failed to load views", String(error));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId, database]);

  useEffect(() => {
    if (!selectedView) {
      return;
    }

    let cancelled = false;
    void dbGetViewDdl(profileId, database, selectedView.name)
      .then((sql) => {
        if (!cancelled) {
          setDdl(sql);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setDdl(buildViewTemplate(database, selectedView.name));
          notifyError("Failed to load view DDL", String(error));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [database, profileId, selectedView]);

  const filteredViews = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) {
      return views;
    }
    return views.filter((view) => view.name.toLowerCase().includes(query));
  }, [search, views]);

  const handleSave = async () => {
    if (!ddl.trim()) {
      notifyError("View DDL is empty", "Enter a CREATE VIEW statement first.");
      return;
    }

    setSaving(true);
    try {
      await dbCreateOrReplaceView(profileId, database, ddl);
      notifySuccess("View saved", "The view DDL was executed successfully.");
      await refresh();
    } catch (error) {
      notifyError("Failed to save view", String(error));
    } finally {
      setSaving(false);
    }
  };

  const handlePreview = async () => {
    if (!selectedName) {
      notifyError("No view selected", "Select a view before previewing it.");
      return;
    }

    setPreviewing(true);
    setPreview(null);
    try {
      const target = `${quoteIdent(database)}.${quoteIdent(selectedName)}`;
      const results = await dbQuery(profileId, `SELECT * FROM ${target} LIMIT 100;`);
      setPreview(results[0] ?? null);
      notifySuccess("Preview loaded", selectedName);
    } catch (error) {
      notifyError("Failed to preview view", String(error));
    } finally {
      setPreviewing(false);
    }
  };

  const handleCreateNew = () => {
    setSelectedName("");
    setDdl(buildViewTemplate(database));
    setPreview(null);
  };

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider">
          <span>Views</span>
          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
            {database}
          </span>
        </div>
        <div className="flex-1" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search views"
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
          {filteredViews.length === 0 ? (
            <div className="p-4 text-xs text-muted-foreground">
              <div className="flex items-center gap-2">
                <AlertCircle className="h-3.5 w-3.5" />
                No views found.
              </div>
            </div>
          ) : (
            filteredViews.map((view) => (
              <button
                key={view.name}
                type="button"
                onClick={() => setSelectedName(view.name)}
                className={cn(
                  "flex w-full items-center gap-2 border-b px-3 py-2 text-left text-xs hover:bg-accent/50",
                  selectedName === view.name && "bg-accent/70",
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{view.name}</div>
                  <div className="truncate text-[10px] text-muted-foreground">
                    {view.definition ? "Has definition" : "No cached definition"}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setDropTarget(view);
                  }}
                  className="rounded p-1 text-muted-foreground hover:bg-red-500/10 hover:text-red-500"
                  aria-label={`Drop ${view.name}`}
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
              {selectedView ? (
                <>
                  <span className="font-medium text-foreground">{selectedView.name}</span>
                  <span className="mx-2">|</span>
                  <span>View editor</span>
                </>
              ) : (
                "Create or select a view to edit its DDL."
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void handlePreview()}
                disabled={previewing || !selectedName}
                className="inline-flex items-center gap-1 rounded border px-3 py-1.5 text-xs hover:bg-accent disabled:opacity-50"
              >
                <Eye className="h-3 w-3" />
                {previewing ? "Previewing..." : "Preview"}
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

          <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_240px] gap-3 p-3">
            <CodeEditorShell value={ddl} onChange={setDdl} language="sql" className="h-full min-h-[260px]" />

            <div className="grid min-h-0 grid-cols-[1fr_1fr] gap-3">
              <div className="min-h-0 overflow-auto rounded border bg-background p-3">
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Preview
                </div>
                <PreviewTable result={preview} />
              </div>
              <div className="min-h-0 overflow-auto rounded border bg-muted/10 p-3">
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Notes
                </div>
                <div className="space-y-2 text-xs text-muted-foreground">
                  <p>
                    The preview executes <span className="font-mono text-foreground">SELECT * FROM view LIMIT 100</span> on demand.
                  </p>
                  <p>
                    If the editor is empty, create a new view DDL from the template and then save it.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {dropTarget && (
        <ConfirmModal
          title={`Drop view ${dropTarget.name}?`}
          message={`This will permanently drop view "${dropTarget.name}".`}
          confirmLabel="Drop"
          danger
          onCancel={() => setDropTarget(null)}
          onConfirm={async () => {
            try {
              await dbDropView(profileId, database, dropTarget.name);
              notifySuccess("View dropped", dropTarget.name);
              setDropTarget(null);
              await refresh();
            } catch (error) {
              notifyError("Failed to drop view", String(error));
            }
          }}
        />
      )}
    </div>
  );
}
