import { create } from "zustand";

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

    // Actions
    addConnection: (profileId: string, name: string, color: string) => void;
    removeConnection: (profileId: string) => void;

    setDatabases: (profileId: string, dbs: string[]) => void;
    setTables: (profileId: string, db: string, tables: string[]) => void;
    setColumns: (profileId: string, db: string, table: string, columns: ColumnInfo[]) => void;

    setLoading: (key: string, kind: "databases" | "tables" | "columns", loading: boolean) => void;
    setError: (key: string, error: string) => void;
    clearError: (key: string) => void;
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

    addConnection: (profileId, name, color) =>
        set((state) => ({
            connectedProfiles: { ...state.connectedProfiles, [profileId]: { name, color } },
        })),

    removeConnection: (profileId) =>
        set((state) => {
            const next = { ...state };
            const cp = { ...next.connectedProfiles };
            delete cp[profileId];

            // Clean up all cached data for this profile
            const dbs = { ...next.databases };
            delete dbs[profileId];

            const tables = { ...next.tables };
            const columns = { ...next.columns };
            const errors = { ...next.errors };
            for (const key of Object.keys(tables)) {
                if (key.startsWith(`${profileId}::`)) delete tables[key];
            }
            for (const key of Object.keys(columns)) {
                if (key.startsWith(`${profileId}::`)) delete columns[key];
            }
            for (const key of Object.keys(errors)) {
                if (key.startsWith(profileId)) delete errors[key];
            }

            return { connectedProfiles: cp, databases: dbs, tables, columns, errors };
        }),

    setDatabases: (profileId, dbs) =>
        set((state) => ({
            databases: { ...state.databases, [profileId]: dbs },
        })),

    setTables: (profileId, db, tbls) =>
        set((state) => ({
            tables: { ...state.tables, [`${profileId}::${db}`]: tbls },
        })),

    setColumns: (profileId, db, table, cols) =>
        set((state) => ({
            columns: { ...state.columns, [`${profileId}::${db}::${table}`]: cols },
        })),

    setLoading: (key, kind, loading) =>
        set((state) => {
            const loadingKey = kind === "databases" ? "loadingDatabases" : kind === "tables" ? "loadingTables" : "loadingColumns";
            return { [loadingKey]: { ...state[loadingKey], [key]: loading } };
        }),

    setError: (key, error) =>
        set((state) => ({ errors: { ...state.errors, [key]: error } })),

    clearError: (key) =>
        set((state) => {
            const errors = { ...state.errors };
            delete errors[key];
            return { errors };
        }),
}));
