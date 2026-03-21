import { useEffect, useMemo, useState } from "react";
import { AlertCircle, RefreshCw, Trash2 } from "lucide-react";
import {
  dbCreateUser,
  dbDropUser,
  dbFlushPrivileges,
  dbGetUserGrants,
  dbGrant,
  dbListUsers,
  dbRevoke,
  type UserInfo,
} from "@/lib/db";
import { ConfirmModal } from "@/components/views/ConfirmModal";
import { cn } from "@/lib/utils/cn";
import { notifyError, notifySuccess } from "@/lib/notifications";

interface Props {
  profileId: string;
}

const COMMON_PRIVILEGES = [
  "SELECT",
  "INSERT",
  "UPDATE",
  "DELETE",
  "CREATE",
  "DROP",
  "ALTER",
  "INDEX",
  "EXECUTE",
  "USAGE",
];

function quoteIdent(value: string): string {
  return `\`${value.replace(/`/g, "``")}\``;
}

function scopeOnWhat(database: string, table: string | null): string {
  const db = database.trim() ? quoteIdent(database.trim()) : "*";
  if (!table || !table.trim()) {
    return `${db}.*`;
  }
  return `${db}.${quoteIdent(table.trim())}`;
}

function userKey(user: UserInfo): string {
  return `${user.user}@${user.host}`;
}

function GrantsList({ grants }: { grants: string[] }) {
  if (grants.length === 0) {
    return <div className="text-xs text-muted-foreground">No grants returned.</div>;
  }

  return (
    <div className="space-y-1">
      {grants.map((grant) => (
        <pre key={grant} className="whitespace-pre-wrap break-words rounded border bg-muted/20 px-2 py-1 text-[11px]">
          {grant}
        </pre>
      ))}
    </div>
  );
}

export function UsersView({ profileId }: Props) {
  const [users, setUsers] = useState<UserInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedKey, setSelectedKey] = useState("");
  const [grants, setGrants] = useState<string[]>([]);
  const [grantsLoading, setGrantsLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [createUser, setCreateUser] = useState("");
  const [createHost, setCreateHost] = useState("%");
  const [createPassword, setCreatePassword] = useState("");
  const [databaseScope, setDatabaseScope] = useState("");
  const [tableScope, setTableScope] = useState("");
  const [databasePrivileges, setDatabasePrivileges] = useState<Set<string>>(new Set());
  const [tablePrivileges, setTablePrivileges] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [dropTarget, setDropTarget] = useState<UserInfo | null>(null);

  const selectedUser = useMemo(
    () => users.find((user) => userKey(user) === selectedKey) ?? null,
    [selectedKey, users],
  );

  const refresh = async () => {
    setLoading(true);
    try {
      const next = await dbListUsers(profileId);
      setUsers(next);
      if (next.length > 0 && !next.some((user) => userKey(user) === selectedKey)) {
        setSelectedKey(userKey(next[0]));
      }
      if (next.length === 0) {
        setSelectedKey("");
        setGrants([]);
      }
    } catch (error) {
      notifyError("Failed to load users", String(error));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId]);

  useEffect(() => {
    if (!selectedUser) {
      setGrants([]);
      return;
    }

    let cancelled = false;
    setGrantsLoading(true);
    void dbGetUserGrants(profileId, selectedUser.user, selectedUser.host)
      .then((next) => {
        if (!cancelled) {
          setGrants(next);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setGrants([]);
          notifyError("Failed to load grants", String(error));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setGrantsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [profileId, selectedUser]);

  const filteredUsers = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) {
      return users;
    }
    return users.filter((user) => userKey(user).toLowerCase().includes(query));
  }, [search, users]);

  const togglePrivilege = (scope: "database" | "table", privilege: string, checked: boolean) => {
    const setter = scope === "database" ? setDatabasePrivileges : setTablePrivileges;
    setter((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(privilege);
      } else {
        next.delete(privilege);
      }
      return next;
    });
  };

  const applyPrivileges = async (action: "grant" | "revoke", scope: "database" | "table") => {
    if (!selectedUser) {
      notifyError("No user selected", "Select a user before editing privileges.");
      return;
    }

    const privileges = Array.from(scope === "database" ? databasePrivileges : tablePrivileges);
    if (privileges.length === 0) {
      notifyError("No privileges selected", "Choose at least one privilege to apply.");
      return;
    }

    const onWhat = scope === "database" ? scopeOnWhat(databaseScope, null) : scopeOnWhat(databaseScope, tableScope);

    setSaving(true);
    try {
      for (const privilege of privileges) {
        if (action === "grant") {
          await dbGrant(profileId, privilege, onWhat, selectedUser.user, selectedUser.host);
        } else {
          await dbRevoke(profileId, privilege, onWhat, selectedUser.user, selectedUser.host);
        }
      }
      notifySuccess(
        action === "grant" ? "Privileges granted" : "Privileges revoked",
        `${privileges.length} privilege(s) updated for ${selectedKey || selectedUser.user}.`,
      );
      await refresh();
      const next = await dbGetUserGrants(profileId, selectedUser.user, selectedUser.host);
      setGrants(next);
    } catch (error) {
      notifyError(`Failed to ${action} privileges`, String(error));
    } finally {
      setSaving(false);
    }
  };

  const handleCreateUser = async () => {
    if (!createUser.trim()) {
      notifyError("Username is required", "Enter a username before creating the account.");
      return;
    }

    setSaving(true);
    try {
      await dbCreateUser(profileId, createUser.trim(), createHost.trim() || "%", createPassword);
      notifySuccess("User created", `${createUser.trim()}@${createHost.trim() || "%"}`);
      setCreateUser("");
      setCreateHost("%");
      setCreatePassword("");
      await refresh();
    } catch (error) {
      notifyError("Failed to create user", String(error));
    } finally {
      setSaving(false);
    }
  };

  const handleFlushPrivileges = async () => {
    setSaving(true);
    try {
      await dbFlushPrivileges(profileId);
      notifySuccess("Privileges flushed", "MySQL privilege cache refreshed.");
    } catch (error) {
      notifyError("Failed to flush privileges", String(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider">
          <span>Users</span>
        </div>
        <div className="flex-1" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search user@host"
          className="h-7 w-52 rounded border bg-background px-2 text-xs outline-none focus:border-primary/50"
        />
        <button
          type="button"
          onClick={() => void handleFlushPrivileges()}
          className="inline-flex items-center gap-1 rounded border px-2 py-1 text-xs hover:bg-accent"
        >
          <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} />
          Flush Privileges
        </button>
      </div>

      <div className="grid flex-1 min-h-0 grid-cols-[300px_minmax(0,1fr)]">
        <div className="overflow-auto border-r">
          {filteredUsers.length === 0 ? (
            <div className="p-4 text-xs text-muted-foreground">
              <div className="flex items-center gap-2">
                <AlertCircle className="h-3.5 w-3.5" />
                No users found.
              </div>
            </div>
          ) : (
            filteredUsers.map((user) => (
              <button
                key={userKey(user)}
                type="button"
                onClick={() => setSelectedKey(userKey(user))}
                className={cn(
                  "flex w-full items-center justify-between gap-3 border-b px-3 py-2 text-left text-xs hover:bg-accent/50",
                  selectedKey === userKey(user) && "bg-accent/70",
                )}
              >
                <div className="min-w-0">
                  <div className="truncate font-mono font-medium">
                    {user.user || "anonymous"}@{user.host}
                  </div>
                  <div className="truncate text-[10px] text-muted-foreground">
                    {user.plugin ?? "unknown plugin"}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setDropTarget(user);
                  }}
                  className="rounded p-1 text-muted-foreground hover:bg-red-500/10 hover:text-red-500"
                  aria-label={`Drop ${userKey(user)}`}
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </button>
            ))
          )}
        </div>

        <div className="flex min-h-0 flex-col gap-3 p-3">
          <div className="grid gap-3 rounded border bg-background p-3 text-xs">
            <div className="grid grid-cols-3 gap-3">
              <label className="flex flex-col gap-1">
                <span className="font-medium">Username</span>
                <input
                  value={createUser}
                  onChange={(e) => setCreateUser(e.target.value)}
                  className="h-8 rounded border bg-background px-2 font-mono text-xs outline-none focus:border-primary/50"
                  placeholder="new_user"
                  disabled={saving}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="font-medium">Host</span>
                <input
                  value={createHost}
                  onChange={(e) => setCreateHost(e.target.value)}
                  className="h-8 rounded border bg-background px-2 font-mono text-xs outline-none focus:border-primary/50"
                  placeholder="%"
                  disabled={saving}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="font-medium">Password</span>
                <input
                  type="password"
                  value={createPassword}
                  onChange={(e) => setCreatePassword(e.target.value)}
                  className="h-8 rounded border bg-background px-2 text-xs outline-none focus:border-primary/50"
                  placeholder="password"
                  disabled={saving}
                />
              </label>
            </div>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => void handleCreateUser()}
                disabled={saving || !createUser.trim()}
                className="rounded bg-primary px-3 py-1.5 text-xs text-primary-foreground disabled:opacity-50"
              >
                Create User
              </button>
            </div>
          </div>

          <div className="grid min-h-0 flex-1 grid-cols-[1fr_1fr] gap-3">
            <div className="min-h-0 overflow-auto rounded border bg-background p-3">
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Selected User
              </div>
              {selectedUser ? (
                <div className="space-y-3 text-xs">
                  <div className="rounded border bg-muted/10 p-2">
                    <div className="font-mono font-medium text-foreground">
                      {selectedUser.user}@{selectedUser.host}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      Plugin: {selectedUser.plugin ?? "unknown"} | Locked: {selectedUser.account_locked ?? "unknown"}
                    </div>
                  </div>
                  {grantsLoading ? (
                    <div className="text-xs text-muted-foreground">Loading grants...</div>
                  ) : (
                    <GrantsList grants={grants} />
                  )}
                </div>
              ) : (
                <div className="text-xs text-muted-foreground">Select a user to inspect their grants.</div>
              )}
            </div>

            <div className="min-h-0 overflow-auto rounded border bg-muted/10 p-3">
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Privilege Matrix
              </div>
              <div className="space-y-4 text-xs">
                <label className="flex flex-col gap-1">
                  <span className="font-medium">Database scope</span>
                  <input
                    value={databaseScope}
                    onChange={(e) => setDatabaseScope(e.target.value)}
                    className="h-8 rounded border bg-background px-2 font-mono text-xs outline-none focus:border-primary/50"
                    placeholder="my_database"
                    disabled={saving}
                  />
                </label>
                <div>
                  <div className="mb-2 font-medium">Database-level privileges</div>
                  <div className="grid grid-cols-2 gap-2">
                    {COMMON_PRIVILEGES.map((privilege) => (
                      <label key={`db-${privilege}`} className="flex items-center gap-2 rounded border bg-background px-2 py-1">
                        <input
                          type="checkbox"
                          checked={databasePrivileges.has(privilege)}
                          onChange={(e) => togglePrivilege("database", privilege, e.target.checked)}
                          disabled={saving}
                        />
                        <span>{privilege}</span>
                      </label>
                    ))}
                  </div>
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      onClick={() => void applyPrivileges("grant", "database")}
                      disabled={saving || !selectedUser}
                      className="rounded border px-3 py-1.5 text-[11px] hover:bg-accent disabled:opacity-50"
                    >
                      Grant selected
                    </button>
                    <button
                      type="button"
                      onClick={() => void applyPrivileges("revoke", "database")}
                      disabled={saving || !selectedUser}
                      className="rounded border px-3 py-1.5 text-[11px] hover:bg-accent disabled:opacity-50"
                    >
                      Revoke selected
                    </button>
                  </div>
                </div>

                <label className="flex flex-col gap-1">
                  <span className="font-medium">Table scope</span>
                  <input
                    value={tableScope}
                    onChange={(e) => setTableScope(e.target.value)}
                    className="h-8 rounded border bg-background px-2 font-mono text-xs outline-none focus:border-primary/50"
                    placeholder="table_name"
                    disabled={saving}
                  />
                </label>
                <div>
                  <div className="mb-2 font-medium">Table-level privileges</div>
                  <div className="grid grid-cols-2 gap-2">
                    {COMMON_PRIVILEGES.map((privilege) => (
                      <label key={`table-${privilege}`} className="flex items-center gap-2 rounded border bg-background px-2 py-1">
                        <input
                          type="checkbox"
                          checked={tablePrivileges.has(privilege)}
                          onChange={(e) => togglePrivilege("table", privilege, e.target.checked)}
                          disabled={saving}
                        />
                        <span>{privilege}</span>
                      </label>
                    ))}
                  </div>
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      onClick={() => void applyPrivileges("grant", "table")}
                      disabled={saving || !selectedUser}
                      className="rounded border px-3 py-1.5 text-[11px] hover:bg-accent disabled:opacity-50"
                    >
                      Grant selected
                    </button>
                    <button
                      type="button"
                      onClick={() => void applyPrivileges("revoke", "table")}
                      disabled={saving || !selectedUser}
                      className="rounded border px-3 py-1.5 text-[11px] hover:bg-accent disabled:opacity-50"
                    >
                      Revoke selected
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {dropTarget && (
        <ConfirmModal
          title={`Drop user ${userKey(dropTarget)}?`}
          message={`This will permanently remove user "${userKey(dropTarget)}".`}
          confirmLabel="Drop"
          danger
          onCancel={() => setDropTarget(null)}
          onConfirm={async () => {
            try {
              await dbDropUser(profileId, dropTarget.user, dropTarget.host);
              notifySuccess("User dropped", userKey(dropTarget));
              setDropTarget(null);
              await refresh();
            } catch (error) {
              notifyError("Failed to drop user", String(error));
            }
          }}
        />
      )}
    </div>
  );
}
