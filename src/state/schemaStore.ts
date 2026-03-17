import { startTransition } from "react";
import { create } from "zustand";
import { dbGetTablesInfo, dbGetVariables, dbListDatabases, dbListTables, type TableInfo } from "@/lib/db";

const AUTO_REFRESH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const autoRefreshTimers = new Map<string, ReturnType<typeof setInterval>>();

// Minimal schema types — data is loaded lazily on expand
export interface ColumnInfo {
    name: string;
    col_type: string;
    nullable: boolean;
    key: string;
    default_val: string | null;
    extra: string;
}

interface SchemaState {
    // Connected profile IDs with their connection metadata
    connectedProfiles: Record<string, { name: string; color: string }>;

    // Lazily-loaded data caches
    databases: Record<string, string[]>;                                // profileId → database names
    tables: Record<string, string[]>;                                    // `${profileId}::${db}` → table names
    columns: Record<string, ColumnInfo[]>;                               // `${profileId}::${db}::${table}` → columns

    // Loading states
    loadingDatabases: Record<string, boolean>;
    loadingTables: Record<string, boolean>;
    loadingColumns: Record<string, boolean>;

    // Errors
    errors: Record<string, string>;

    // Per-profile ping latency (ms). null = unknown, -1 = error
    latencies: Record<string, number | null>;
    serverVersions: Record<string, string | null>;
    tableInfos: Record<string, TableInfo[]>;

    // Actions
    addConnection: (profileId: string, name: string, color: string) => void;
    removeConnection: (profileId: string) => void;
    setLatency: (profileId: string, ms: number | null) => void;
    setServerVersion: (profileId: string, version: string | null) => void;
    setTableInfos: (profileId: string, db: string, tableInfos: TableInfo[]) => void;
    fetchServerVersion: (profileId: string) => Promise<void>;

    setDatabases: (profileId: string, dbs: string[]) => void;
    setTables: (profileId: string, db: string, tables: string[]) => void;
    setColumns: (profileId: string, db: string, table: string, columns: ColumnInfo[]) => void;

    setLoading: (key: string, kind: "databases" | "tables" | "columns", loading: boolean) => void;
    setError: (key: string, error: string) => void;
    clearError: (key: string) => void;

    // Refresh actions
    refreshDatabases: (profileId: string) => Promise<void>;
    refreshTables: (profileId: string, db: string) => Promise<void>;
}

export const useSchemaStore = create<SchemaState>((set) => ({
    connectedProfiles: {},
    databases: {},
    tables: {},
    columns: {},
    loadingDatabases: {},
    loadingTables: {},
    loadingColumns: {},
    errors: {},
    latencies: {},
    serverVersions: {},
    tableInfos: {},

    addConnection: (profileId, name, color) => {
        startTransition(() => {
            set((state) => ({
                connectedProfiles: { ...state.connectedProfiles, [profileId]: { name, color } },
            }));
        });
        // Start 5-minute auto-refresh for this profile
        if (!autoRefreshTimers.has(profileId)) {
            const timer = setInterval(() => {
                useSchemaStore.getState().refreshDatabases(profileId);
            }, AUTO_REFRESH_INTERVAL_MS);
            autoRefreshTimers.set(profileId, timer);
        }
        void useSchemaStore.getState().fetchServerVersion(profileId);
        void useSchemaStore.getState().refreshDatabases(profileId);
    },

    removeConnection: (profileId) => {
        // Stop auto-refresh timer
        const timer = autoRefreshTimers.get(profileId);
        if (timer) { clearInterval(timer); autoRefreshTimers.delete(profileId); }

        startTransition(() => {
            set((state) => {
                const next = { ...state };
                const cp = { ...next.connectedProfiles };
                delete cp[profileId];

                // Clean up all cached data for this profile
                const dbs = { ...next.databases };
                delete dbs[profileId];

                const tables = { ...next.tables };
                const tableInfos = { ...next.tableInfos };
                const columns = { ...next.columns };
                const errors = { ...next.errors };
                for (const key of Object.keys(tables)) {
                    if (key.startsWith(`${profileId}::`)) delete tables[key];
                }
                for (const key of Object.keys(tableInfos)) {
                    if (key.startsWith(`${profileId}::`)) delete tableInfos[key];
                }
                for (const key of Object.keys(columns)) {
                    if (key.startsWith(`${profileId}::`)) delete columns[key];
                }
                for (const key of Object.keys(errors)) {
                    if (key.startsWith(profileId)) delete errors[key];
                }

                const latencies = { ...next.latencies };
                delete latencies[profileId];

                const serverVersions = { ...next.serverVersions };
                delete serverVersions[profileId];

                return {
                    connectedProfiles: cp,
                    databases: dbs,
                    tables,
                    tableInfos,
                    columns,
                    errors,
                    latencies,
                    serverVersions,
                };
            });
        });
    },

    setDatabases: (profileId, dbs) =>
        startTransition(() => {
            set((state) => ({
                databases: { ...state.databases, [profileId]: dbs },
            }));
        }),

    setTables: (profileId, db, tbls) =>
        startTransition(() => {
            set((state) => ({
                tables: { ...state.tables, [`${profileId}::${db}`]: tbls },
            }));
        }),

    setTableInfos: (profileId, db, tableInfos) =>
        startTransition(() => {
            set((state) => ({
                tableInfos: { ...state.tableInfos, [`${profileId}::${db}`]: tableInfos },
                tables: {
                    ...state.tables,
                    [`${profileId}::${db}`]: tableInfos
                        .filter((tableInfo) => tableInfo.type_ === "BASE TABLE")
                        .map((tableInfo) => tableInfo.name),
                },
            }));
        }),

    setColumns: (profileId, db, table, cols) =>
        startTransition(() => {
            set((state) => ({
                columns: { ...state.columns, [`${profileId}::${db}::${table}`]: cols },
            }));
        }),

    setLoading: (key, kind, loading) =>
        startTransition(() => {
            set((state) => {
                const loadingKey = kind === "databases" ? "loadingDatabases" : kind === "tables" ? "loadingTables" : "loadingColumns";
                return { [loadingKey]: { ...state[loadingKey], [key]: loading } };
            });
        }),

    setLatency: (profileId, ms) =>
        startTransition(() => {
            set((state) => ({ latencies: { ...state.latencies, [profileId]: ms } }));
        }),

    setServerVersion: (profileId, version) =>
        startTransition(() => {
            set((state) => ({
                serverVersions: { ...state.serverVersions, [profileId]: version },
            }));
        }),

    setError: (key, error) =>
        startTransition(() => {
            set((state) => ({ errors: { ...state.errors, [key]: error } }));
        }),

    clearError: (key) =>
        startTransition(() => {
            set((state) => {
                const errors = { ...state.errors };
                delete errors[key];
                return { errors };
            });
        }),

    fetchServerVersion: async (profileId) => {
        const store = useSchemaStore.getState();
        if (store.serverVersions[profileId] !== undefined) {
            return;
        }

        try {
            const variables = await dbGetVariables(profileId);
            const variableMap = new Map(
                variables.map((variable) => [variable.name.toLowerCase(), variable]),
            );
            const version = variableMap.get("version")?.global_value
                || variableMap.get("version")?.session_value
                || "";
            const comment = variableMap.get("version_comment")?.global_value
                || variableMap.get("version_comment")?.session_value
                || "";
            const normalized = [comment, version].filter(Boolean).join(" ").trim() || null;
            store.setServerVersion(profileId, normalized);
        } catch {
            store.setServerVersion(profileId, null);
        }
    },

    refreshDatabases: async (profileId) => {
        const store = useSchemaStore.getState();
        store.setLoading(profileId, "databases", true);
        store.clearError(`dbs-${profileId}`);
        try {
            const dbs = await dbListDatabases(profileId);
            store.setDatabases(profileId, dbs);
        } catch (e) {
            store.setError(`dbs-${profileId}`, String(e));
        } finally {
            store.setLoading(profileId, "databases", false);
        }
    },

    refreshTables: async (profileId, db) => {
        const store = useSchemaStore.getState();
        const cacheKey = `${profileId}::${db}`;
        store.setLoading(cacheKey, "tables", true);
        store.clearError(`tbl-${cacheKey}`);
        try {
            const tableInfos = await dbGetTablesInfo(profileId, db);
            store.setTableInfos(profileId, db, tableInfos);
        } catch (e) {
            try {
                const tbls = await dbListTables(profileId, db);
                store.setTables(profileId, db, tbls);
            } catch (fallbackError) {
                store.setError(`tbl-${cacheKey}`, String(fallbackError));
            }
        } finally {
            store.setLoading(cacheKey, "tables", false);
        }
    },
}));
