import { useEffect, useMemo, useState } from "react";
import { AlertCircle, PauseCircle, Plus, RefreshCw, Trash2 } from "lucide-react";
import {
  dbCreateEvent,
  dbDropEvent,
  dbExecuteQuery,
  dbGetEventDdl,
  dbListEvents,
  type EventInfo,
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

function buildEventTemplate(database: string, eventName = "new_event"): string {
  return [
    `USE ${quoteIdent(database)};`,
    `CREATE EVENT ${quoteIdent(eventName)}`,
    `ON SCHEDULE EVERY 1 DAY`,
    `DO`,
    `BEGIN`,
    `  -- event body`,
    `END;`,
  ].join("\n");
}

export function EventsView({ profileId, database }: Props) {
  const [events, setEvents] = useState<EventInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedName, setSelectedName] = useState("");
  const [ddl, setDdl] = useState("");
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [dropTarget, setDropTarget] = useState<EventInfo | null>(null);

  const selectedEvent = useMemo(
    () => events.find((event) => event.name === selectedName) ?? null,
    [events, selectedName],
  );

  const refresh = async () => {
    setLoading(true);
    try {
      const next = await dbListEvents(profileId, database);
      setEvents(next);
      if (next.length > 0 && !next.some((event) => event.name === selectedName)) {
        setSelectedName(next[0].name);
      }
      if (next.length === 0) {
        setSelectedName("");
        setDdl(buildEventTemplate(database));
      }
    } catch (error) {
      notifyError("Failed to load events", String(error));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId, database]);

  useEffect(() => {
    if (!selectedEvent) {
      return;
    }

    let cancelled = false;
    void dbGetEventDdl(profileId, database, selectedEvent.name)
      .then((sql) => {
        if (!cancelled) {
          setDdl(sql);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setDdl(buildEventTemplate(database, selectedEvent.name));
          notifyError("Failed to load event DDL", String(error));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [database, profileId, selectedEvent]);

  const filteredEvents = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) {
      return events;
    }
    return events.filter((event) => event.name.toLowerCase().includes(query));
  }, [events, search]);

  const handleSave = async () => {
    if (!ddl.trim()) {
      notifyError("Event DDL is empty", "Enter a CREATE EVENT statement first.");
      return;
    }

    setSaving(true);
    try {
      await dbCreateEvent(profileId, database, ddl);
      notifySuccess("Event saved", "The event DDL was executed successfully.");
      await refresh();
    } catch (error) {
      notifyError("Failed to save event", String(error));
    } finally {
      setSaving(false);
    }
  };

  const handleToggleEnabled = async () => {
    if (!selectedEvent) {
      return;
    }

    const isDisabled = (selectedEvent.status ?? "").toUpperCase().includes("DISABLED");
    setToggling(true);
    try {
      await dbExecuteQuery(
        profileId,
        `ALTER EVENT ${quoteIdent(selectedEvent.name)} ${isDisabled ? "ENABLE" : "DISABLE"};`,
      );
      notifySuccess("Event updated", `${selectedEvent.name} is now ${isDisabled ? "enabled" : "disabled"}.`);
      await refresh();
    } catch (error) {
      notifyError("Failed to toggle event", String(error));
    } finally {
      setToggling(false);
    }
  };

  const handleCreateNew = () => {
    setSelectedName("");
    setDdl(buildEventTemplate(database));
  };

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider">
          <span>Events</span>
          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
            {database}
          </span>
        </div>
        <div className="flex-1" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search events"
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
          {filteredEvents.length === 0 ? (
            <div className="p-4 text-xs text-muted-foreground">
              <div className="flex items-center gap-2">
                <AlertCircle className="h-3.5 w-3.5" />
                No events found.
              </div>
            </div>
          ) : (
            filteredEvents.map((event) => {
              const disabled = (event.status ?? "").toUpperCase().includes("DISABLED");
              return (
                <button
                  key={event.name}
                  type="button"
                  onClick={() => setSelectedName(event.name)}
                  className={cn(
                    "flex w-full items-center gap-2 border-b px-3 py-2 text-left text-xs hover:bg-accent/50",
                    selectedName === event.name && "bg-accent/70",
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{event.name}</div>
                    <div className="truncate text-[10px] text-muted-foreground">
                      {event.schedule ?? "No schedule"}{" "}
                      <span className={cn("ml-1", disabled ? "text-amber-500" : "text-emerald-500")}>
                        {disabled ? "DISABLED" : "ENABLED"}
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setDropTarget(event);
                    }}
                    className="rounded p-1 text-muted-foreground hover:bg-red-500/10 hover:text-red-500"
                    aria-label={`Drop ${event.name}`}
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </button>
              );
            })
          )}
        </div>

        <div className="flex min-h-0 flex-col">
          <div className="flex items-center justify-between gap-3 border-b px-3 py-2">
            <div className="min-w-0 text-xs text-muted-foreground">
              {selectedEvent ? (
                <>
                  <span className="font-medium text-foreground">{selectedEvent.name}</span>
                  <span className="mx-2">|</span>
                  <span>{selectedEvent.schedule ?? "No schedule"}</span>
                </>
              ) : (
                "Create or select an event to edit its DDL."
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void handleToggleEnabled()}
                disabled={toggling || !selectedEvent}
                className="inline-flex items-center gap-1 rounded border px-3 py-1.5 text-xs hover:bg-accent disabled:opacity-50"
              >
                <PauseCircle className="h-3 w-3" />
                {toggling
                  ? "Updating..."
                  : (selectedEvent?.status ?? "").toUpperCase().includes("DISABLED")
                    ? "Enable"
                    : "Disable"}
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

          <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_180px] gap-3 p-3">
            <CodeEditorShell value={ddl} onChange={setDdl} language="sql" className="h-full min-h-[260px]" />

            <div className="grid min-h-0 grid-cols-[1fr_1fr] gap-3">
              <div className="min-h-0 overflow-auto rounded border bg-background p-3">
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Definition
                </div>
                <pre className="whitespace-pre-wrap break-words text-[11px] text-muted-foreground">
                  {selectedEvent?.event_definition ?? "Select an event to inspect its definition."}
                </pre>
              </div>
              <div className="min-h-0 overflow-auto rounded border bg-muted/10 p-3">
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Schedule
                </div>
                <div className="space-y-2 text-xs text-muted-foreground">
                  <p>
                    Status: <span className="text-foreground">{selectedEvent?.status ?? "Unknown"}</span>
                  </p>
                  <p>
                    Schedule: <span className="text-foreground">{selectedEvent?.schedule ?? "Unknown"}</span>
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {dropTarget && (
        <ConfirmModal
          title={`Drop event ${dropTarget.name}?`}
          message={`This will permanently drop event "${dropTarget.name}".`}
          confirmLabel="Drop"
          danger
          onCancel={() => setDropTarget(null)}
          onConfirm={async () => {
            try {
              await dbDropEvent(profileId, database, dropTarget.name);
              notifySuccess("Event dropped", dropTarget.name);
              setDropTarget(null);
              await refresh();
            } catch (error) {
              notifyError("Failed to drop event", String(error));
            }
          }}
        />
      )}
    </div>
  );
}
