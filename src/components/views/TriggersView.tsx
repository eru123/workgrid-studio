import { useEffect, useMemo, useState } from "react";
import { AlertCircle, Plus, RefreshCw, Trash2 } from "lucide-react";
import {
  dbCreateTrigger,
  dbDropTrigger,
  dbGetTriggerDdl,
  dbListTriggers,
  type TriggerInfo,
} from "@/lib/db";
import { CodeEditorShell } from "@/components/ui/CodeEditorShell";
import { ConfirmModal } from "@/components/views/ConfirmModal";
import { cn } from "@/lib/utils/cn";
import { notifyError, notifySuccess } from "@/lib/notifications";

interface Props {
  profileId: string;
  database: string;
}

function quoteIdent(value: string): string {
  return `\`${value.replace(/`/g, "``")}\``;
}

function buildNewTriggerTemplate(database: string, trigger?: TriggerInfo): string {
  const triggerName = trigger?.name ? `${trigger.name}_copy` : "new_trigger";
  const tableName = trigger?.table_name ?? "your_table";
  const timing = trigger?.timing ?? "BEFORE";
  const event = trigger?.event ?? "INSERT";
  return [
    `DELIMITER $$`,
    `CREATE TRIGGER ${quoteIdent(triggerName)}`,
    `${timing} ${event} ON ${quoteIdent(database)}.${quoteIdent(tableName)}`,
    `FOR EACH ROW`,
    `BEGIN`,
    `  -- write your trigger body here`,
    `END$$`,
    `DELIMITER ;`,
  ].join("\n");
}

export function TriggersView({ profileId, database }: Props) {
  const [triggers, setTriggers] = useState<TriggerInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedName, setSelectedName] = useState<string>("");
  const [ddl, setDdl] = useState("");
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [dropTarget, setDropTarget] = useState<TriggerInfo | null>(null);

  const selectedTrigger = useMemo(
    () => triggers.find((trigger) => trigger.name === selectedName) ?? null,
    [selectedName, triggers],
  );

  const refresh = async () => {
    setLoading(true);
    try {
      const next = await dbListTriggers(profileId, database);
      setTriggers(next);
      if (next.length > 0 && !next.some((trigger) => trigger.name === selectedName)) {
        setSelectedName(next[0].name);
      }
      if (next.length === 0) {
        setSelectedName("");
        setDdl(buildNewTriggerTemplate(database));
      }
    } catch (error) {
      notifyError("Failed to load triggers", String(error));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId, database]);

  useEffect(() => {
    if (!selectedTrigger) {
      return;
    }

    let cancelled = false;
    void dbGetTriggerDdl(profileId, database, selectedTrigger.name)
      .then((sql) => {
        if (!cancelled) {
          setDdl(sql);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setDdl(buildNewTriggerTemplate(database, selectedTrigger));
          notifyError("Failed to load trigger DDL", String(error));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [database, profileId, selectedTrigger]);

  const filteredTriggers = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) {
      return triggers;
    }
    return triggers.filter(
      (trigger) =>
        trigger.name.toLowerCase().includes(query) ||
        trigger.table_name.toLowerCase().includes(query) ||
        trigger.event.toLowerCase().includes(query) ||
        trigger.timing.toLowerCase().includes(query),
    );
  }, [search, triggers]);

  const groupedTriggers = useMemo(() => {
    const groups = new Map<string, TriggerInfo[]>();
    for (const trigger of filteredTriggers) {
      const list = groups.get(trigger.table_name) ?? [];
      list.push(trigger);
      groups.set(trigger.table_name, list);
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [filteredTriggers]);

  const handleSave = async () => {
    if (!ddl.trim()) {
      notifyError("Trigger DDL is empty", "Enter a CREATE TRIGGER statement first.");
      return;
    }

    setSaving(true);
    try {
      await dbCreateTrigger(profileId, database, ddl);
      notifySuccess("Trigger saved", "The trigger DDL was executed successfully.");
      await refresh();
    } catch (error) {
      notifyError("Failed to save trigger", String(error));
    } finally {
      setSaving(false);
    }
  };

  const handleSelect = (trigger: TriggerInfo) => {
    setSelectedName(trigger.name);
  };

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider">
          <span>Triggers</span>
          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
            {database}
          </span>
        </div>
        <div className="flex-1" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search triggers"
          className="h-7 w-44 rounded border bg-background px-2 text-xs outline-none focus:border-primary/50"
        />
        <button
          type="button"
          onClick={() => {
            setSelectedName("");
            setDdl(buildNewTriggerTemplate(database, selectedTrigger ?? undefined));
          }}
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
          {groupedTriggers.length === 0 ? (
            <div className="p-4 text-xs text-muted-foreground">
              <div className="flex items-center gap-2">
                <AlertCircle className="h-3.5 w-3.5" />
                No triggers found.
              </div>
            </div>
          ) : (
            groupedTriggers.map(([tableName, items]) => (
              <div key={tableName} className="border-b last:border-b-0">
                <div className="bg-muted/30 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {tableName}
                </div>
                {items.map((trigger) => (
                  <button
                    key={trigger.name}
                    type="button"
                    onClick={() => handleSelect(trigger)}
                    className={cn(
                      "flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-accent/50",
                      selectedName === trigger.name && "bg-accent/70",
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{trigger.name}</div>
                      <div className="truncate text-[10px] text-muted-foreground">
                        {trigger.timing} {trigger.event}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setDropTarget(trigger);
                      }}
                      className="rounded p-1 text-muted-foreground hover:bg-red-500/10 hover:text-red-500"
                      aria-label={`Drop ${trigger.name}`}
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </button>
                ))}
              </div>
            ))
          )}
        </div>

        <div className="flex min-h-0 flex-col">
          <div className="flex items-center justify-between border-b px-3 py-2">
            <div className="text-xs text-muted-foreground">
              {selectedTrigger ? (
                <>
                  <span className="font-medium text-foreground">{selectedTrigger.name}</span>
                  <span className="mx-2">|</span>
                  <span>
                    {selectedTrigger.timing} {selectedTrigger.event} on {selectedTrigger.table_name}
                  </span>
                </>
              ) : (
                "Create or select a trigger to edit its DDL."
              )}
            </div>
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving || !ddl.trim()}
              className="rounded bg-primary px-3 py-1.5 text-xs text-primary-foreground disabled:opacity-50"
            >
              {saving ? "Saving..." : selectedTrigger ? "Save DDL" : "Create Trigger"}
            </button>
          </div>

          <div className="min-h-0 flex-1 p-3">
            <CodeEditorShell
              value={ddl}
              onChange={setDdl}
              language="sql"
              className="h-full min-h-[280px]"
            />
          </div>
        </div>
      </div>

      {dropTarget && (
        <ConfirmModal
          title={`Drop trigger ${dropTarget.name}?`}
          message={`This will permanently drop trigger "${dropTarget.name}" on ${dropTarget.table_name}.`}
          confirmLabel="Drop"
          danger
          onCancel={() => setDropTarget(null)}
          onConfirm={async () => {
            try {
              await dbDropTrigger(profileId, database, dropTarget.name);
              notifySuccess("Trigger dropped", dropTarget.name);
              setDropTarget(null);
              await refresh();
            } catch (error) {
              notifyError("Failed to drop trigger", String(error));
            }
          }}
        />
      )}
    </div>
  );
}
