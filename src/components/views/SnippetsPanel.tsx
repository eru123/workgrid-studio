import { useEffect, useMemo, useState } from "react";
import { useSnippetsStore, type SnippetEntry } from "@/state/snippetsStore";
import { useProfilesStore } from "@/state/profilesStore";
import { notifyError, notifySuccess } from "@/lib/notifications";
import { Plus, Pencil, Trash2, Search, Snail, FileCode2, Play } from "lucide-react";

const INSERT_EVENT = "workgrid:insert-snippet";

interface Props {
  activeProfileId?: string;
}

interface DraftState {
  id?: string;
  name: string;
  description: string;
  body: string;
  profileId: string;
}

function emptyDraft(activeProfileId = ""): DraftState {
  return {
    name: "",
    description: "",
    body: "",
    profileId: activeProfileId,
  };
}

function emitInsert(body: string) {
  window.dispatchEvent(new CustomEvent(INSERT_EVENT, { detail: { body } }));
}

function matchesProfile(snippet: SnippetEntry, activeProfileId?: string) {
  if (!activeProfileId) return true;
  return !snippet.profileId || snippet.profileId === activeProfileId;
}

export function SnippetsPanel({ activeProfileId }: Props) {
  const snippets = useSnippetsStore((s) => s.snippets);
  const loadSnippets = useSnippetsStore((s) => s.loadSnippets);
  const addSnippet = useSnippetsStore((s) => s.addSnippet);
  const updateSnippet = useSnippetsStore((s) => s.updateSnippet);
  const deleteSnippet = useSnippetsStore((s) => s.deleteSnippet);
  const profiles = useProfilesStore((s) => s.profiles);

  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<DraftState | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  useEffect(() => {
    void loadSnippets();
  }, [loadSnippets]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return snippets.filter((snippet) => {
      if (!matchesProfile(snippet, activeProfileId)) return false;
      if (!q) return true;
      return (
        snippet.name.toLowerCase().includes(q) ||
        snippet.description.toLowerCase().includes(q) ||
        snippet.body.toLowerCase().includes(q)
      );
    });
  }, [snippets, query, activeProfileId]);

  const activeProfileLabel = activeProfileId
    ? profiles.find((profile) => profile.id === activeProfileId)?.name ?? "Selected profile"
    : "All profiles";

  const startCreate = () => {
    setEditing(emptyDraft(activeProfileId));
  };

  const startEdit = (snippet: SnippetEntry) => {
    setEditing({
      id: snippet.id,
      name: snippet.name,
      description: snippet.description,
      body: snippet.body,
      profileId: snippet.profileId ?? "",
    });
  };

  const handleSave = () => {
    if (!editing) return;
    const payload = {
      name: editing.name.trim(),
      description: editing.description.trim(),
      body: editing.body,
      profileId: editing.profileId.trim() || undefined,
    };

    if (!payload.name || !payload.body.trim()) {
      notifyError("Snippet not saved", "A snippet needs both a name and body.");
      return;
    }

    if (editing.id) {
      updateSnippet(editing.id, payload);
      notifySuccess("Snippet updated", payload.name);
    } else {
      addSnippet(payload);
      notifySuccess("Snippet created", payload.name);
    }

    setEditing(null);
  };

  const handleDelete = (id: string) => {
    deleteSnippet(id);
    setConfirmDeleteId(null);
    notifySuccess("Snippet deleted", "The snippet was removed.");
  };

  return (
    <div className="flex h-full flex-col bg-background text-xs">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <div className="flex items-center gap-2 rounded-md border bg-muted/30 px-2 py-1.5 flex-1">
          <Search className="h-3.5 w-3.5 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search snippets in ${activeProfileLabel}`}
            className="w-full bg-transparent text-xs outline-none placeholder:text-muted-foreground/60"
          />
        </div>
        <button
          type="button"
          onClick={startCreate}
          className="inline-flex items-center gap-1.5 rounded-md border bg-primary px-2.5 py-1.5 text-[11px] font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          <Plus className="h-3.5 w-3.5" />
          New
        </button>
      </div>

      <div className="flex-1 overflow-auto p-2">
        {filtered.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed bg-muted/20 px-6 py-10 text-center text-muted-foreground">
            <Snail className="h-6 w-6" />
            <div className="space-y-1">
              <p className="font-medium text-foreground">No snippets yet</p>
              <p className="text-[11px]">
                Create reusable SQL fragments and insert them into the active editor.
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map((snippet) => (
              <div
                key={snippet.id}
                className="rounded-lg border bg-card/70 p-3 shadow-sm transition-colors hover:border-primary/40"
              >
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <FileCode2 className="h-3.5 w-3.5 text-primary" />
                      <h3 className="truncate font-medium text-foreground">{snippet.name}</h3>
                    </div>
                    {snippet.description && (
                      <p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">
                        {snippet.description}
                      </p>
                    )}
                    <p className="mt-2 line-clamp-3 rounded-md bg-muted/30 px-2 py-1 font-mono text-[11px] text-foreground/80">
                      {snippet.body}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
                      <span className="rounded-full bg-muted px-2 py-0.5">
                        {snippet.profileId
                          ? profiles.find((profile) => profile.id === snippet.profileId)?.name ?? "Profile snippet"
                          : "Global"}
                      </span>
                    </div>
                  </div>

                  <div className="flex shrink-0 flex-col gap-1">
                    <button
                      type="button"
                      onClick={() => emitInsert(snippet.body)}
                      className="inline-flex items-center gap-1 rounded border px-2 py-1 text-[11px] transition-colors hover:bg-accent"
                      title="Insert into active SQL editor"
                    >
                      <Play className="h-3 w-3" />
                      Insert
                    </button>
                    <button
                      type="button"
                      onClick={() => startEdit(snippet)}
                      className="inline-flex items-center gap-1 rounded border px-2 py-1 text-[11px] transition-colors hover:bg-accent"
                    >
                      <Pencil className="h-3 w-3" />
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteId(snippet.id)}
                      className="inline-flex items-center gap-1 rounded border px-2 py-1 text-[11px] text-red-500 transition-colors hover:bg-red-500/10"
                    >
                      <Trash2 className="h-3 w-3" />
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/75 p-4 backdrop-blur-sm">
          <div className="w-full max-w-2xl rounded-xl border bg-card shadow-2xl">
            <div className="border-b px-4 py-3">
              <div className="flex items-center gap-2">
                <FileCode2 className="h-4 w-4 text-primary" />
                <h2 className="text-sm font-semibold">{editing.id ? "Edit Snippet" : "New Snippet"}</h2>
              </div>
            </div>
            <div className="space-y-3 p-4">
              <div className="grid gap-3 md:grid-cols-2">
                <label className="space-y-1">
                  <span className="text-[11px] text-muted-foreground">Name</span>
                  <input
                    value={editing.name}
                    onChange={(e) => setEditing((prev) => prev ? { ...prev, name: e.target.value } : prev)}
                    className="w-full rounded-md border bg-background px-3 py-2 text-xs outline-none focus:border-primary"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-[11px] text-muted-foreground">Profile</span>
                  <select
                    value={editing.profileId}
                    onChange={(e) => setEditing((prev) => prev ? { ...prev, profileId: e.target.value } : prev)}
                    className="w-full rounded-md border bg-background px-3 py-2 text-xs outline-none focus:border-primary"
                  >
                    <option value="">All profiles</option>
                    {profiles.map((profile) => (
                      <option key={profile.id} value={profile.id}>
                        {profile.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <label className="space-y-1">
                <span className="text-[11px] text-muted-foreground">Description</span>
                <input
                  value={editing.description}
                  onChange={(e) => setEditing((prev) => prev ? { ...prev, description: e.target.value } : prev)}
                  className="w-full rounded-md border bg-background px-3 py-2 text-xs outline-none focus:border-primary"
                />
              </label>

              <label className="space-y-1">
                <span className="text-[11px] text-muted-foreground">Body</span>
                <textarea
                  value={editing.body}
                  onChange={(e) => setEditing((prev) => prev ? { ...prev, body: e.target.value } : prev)}
                  rows={10}
                  className="w-full rounded-md border bg-background px-3 py-2 font-mono text-xs outline-none focus:border-primary"
                />
              </label>
            </div>
            <div className="flex items-center justify-end gap-2 border-t px-4 py-3">
              <button
                type="button"
                onClick={() => setEditing(null)}
                className="rounded-md border px-3 py-1.5 text-[11px] transition-colors hover:bg-accent"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                className="rounded-md bg-primary px-3 py-1.5 text-[11px] font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              >
                Save Snippet
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmDeleteId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/75 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-xl border bg-card shadow-2xl">
            <div className="border-b px-4 py-3">
              <h2 className="text-sm font-semibold">Delete Snippet</h2>
            </div>
            <div className="space-y-2 p-4 text-xs text-muted-foreground">
              <p>This action cannot be undone.</p>
              <p>Delete "{snippets.find((snippet) => snippet.id === confirmDeleteId)?.name ?? "this snippet"}"?</p>
            </div>
            <div className="flex items-center justify-end gap-2 border-t px-4 py-3">
              <button
                type="button"
                onClick={() => setConfirmDeleteId(null)}
                className="rounded-md border px-3 py-1.5 text-[11px] transition-colors hover:bg-accent"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleDelete(confirmDeleteId)}
                className="rounded-md bg-red-500 px-3 py-1.5 text-[11px] font-medium text-white transition-colors hover:bg-red-600"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
