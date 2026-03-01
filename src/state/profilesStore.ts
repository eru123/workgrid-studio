import { create } from "zustand";
import { readData, writeData } from "@/lib/storage";

export type DatabaseType = "postgres" | "mysql" | "sqlite" | "mariadb" | "mssql";

export type ConnectionStatus = "disconnected" | "connecting" | "connected" | "error";

export const DB_TYPE_LABELS: Record<DatabaseType, string> = {
    postgres: "PostgreSQL",
    mysql: "MySQL",
    sqlite: "SQLite",
    mariadb: "MariaDB",
    mssql: "SQL Server",
};

export const DB_TYPE_COLORS: Record<DatabaseType, string> = {
    postgres: "#336791",
    mysql: "#00758f",
    sqlite: "#003b57",
    mariadb: "#c0765a",
    mssql: "#cc2927",
};

export const DB_TYPE_DEFAULT_PORTS: Record<DatabaseType, number | undefined> = {
    postgres: 5432,
    mysql: 3306,
    sqlite: undefined,
    mariadb: 3306,
    mssql: 1433,
};

export interface ProfilePreferences {
    theme?: "light" | "dark" | "system";
    fontSize?: number;
}

// What gets saved to disk (no runtime-only fields)
export interface SavedProfile {
    id: string;
    name: string;
    type: DatabaseType;
    color: string;
    host: string;
    port: number | undefined;
    user: string;
    password: string;
    database: string;
    filePath: string;
    ssl: boolean;
    lastConnectedAt: number | null;
    createdAt: number;
    preferences?: ProfilePreferences;
}

// Runtime profile with transient connection state
export interface DatabaseProfile extends SavedProfile {
    connectionStatus: ConnectionStatus;
}

export type ProfileFormData = Omit<DatabaseProfile, "id" | "connectionStatus" | "lastConnectedAt" | "createdAt">;

export function createDefaultFormData(type?: DatabaseType): ProfileFormData {
    const dbType = type ?? "postgres";
    return {
        name: "",
        type: dbType,
        color: DB_TYPE_COLORS[dbType],
        host: "localhost",
        port: DB_TYPE_DEFAULT_PORTS[dbType],
        user: "",
        password: "",
        database: "",
        filePath: "",
        ssl: false,
    };
}

const PROFILES_FILE = "profiles.json";

// Debounce timer for saving
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function debouncedSave(profiles: DatabaseProfile[]) {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
        // Strip runtime-only fields before saving
        const toSave: SavedProfile[] = profiles.map(({ connectionStatus: _, ...rest }) => rest);
        writeData(PROFILES_FILE, toSave).catch((e) =>
            console.error("[profiles] save error:", e)
        );
    }, 300);
}

interface ProfilesState {
    profiles: DatabaseProfile[];
    globalPreferences: ProfilePreferences;
    _loaded: boolean;

    loadProfiles: () => Promise<void>;
    addProfile: (data: ProfileFormData) => DatabaseProfile;
    updateProfile: (id: string, updates: Partial<ProfileFormData>) => void;
    deleteProfile: (id: string) => void;
    duplicateProfile: (id: string) => void;
    setConnectionStatus: (id: string, status: ConnectionStatus) => void;
    setGlobalPreferences: (prefs: Partial<ProfilePreferences>) => void;
}

export const useProfilesStore = create<ProfilesState>((set, get) => ({
    profiles: [],
    globalPreferences: { theme: "dark", fontSize: 13 },
    _loaded: false,

    loadProfiles: async () => {
        if (get()._loaded) return;
        try {
            const saved = await readData<SavedProfile[]>(PROFILES_FILE, []);
            const profiles: DatabaseProfile[] = saved.map((s) => ({
                ...s,
                connectionStatus: "disconnected" as ConnectionStatus,
            }));
            set({ profiles, _loaded: true });
        } catch (e) {
            console.error("[profiles] load error:", e);
            set({ _loaded: true });
        }
    },

    addProfile: (data) => {
        const newProfile: DatabaseProfile = {
            ...data,
            id: crypto.randomUUID(),
            connectionStatus: "disconnected",
            lastConnectedAt: null,
            createdAt: Date.now(),
        };
        set((state) => {
            const profiles = [...state.profiles, newProfile];
            debouncedSave(profiles);
            return { profiles };
        });
        return newProfile;
    },

    updateProfile: (id, updates) =>
        set((state) => {
            const profiles = state.profiles.map((p) =>
                p.id === id ? { ...p, ...updates } : p
            );
            debouncedSave(profiles);
            return { profiles };
        }),

    deleteProfile: (id) =>
        set((state) => {
            const profiles = state.profiles.filter((p) => p.id !== id);
            debouncedSave(profiles);
            return { profiles };
        }),

    duplicateProfile: (id) => {
        const source = get().profiles.find((p) => p.id === id);
        if (!source) return;
        const dup: DatabaseProfile = {
            ...source,
            id: crypto.randomUUID(),
            name: `${source.name} (copy)`,
            connectionStatus: "disconnected",
            lastConnectedAt: null,
            createdAt: Date.now(),
        };
        set((state) => {
            const profiles = [...state.profiles, dup];
            debouncedSave(profiles);
            return { profiles };
        });
    },

    setConnectionStatus: (id, status) =>
        set((state) => {
            const profiles = state.profiles.map((p) =>
                p.id === id
                    ? {
                        ...p,
                        connectionStatus: status,
                        lastConnectedAt: status === "connected" ? Date.now() : p.lastConnectedAt,
                    }
                    : p
            );
            // Save on connect/disconnect to persist lastConnectedAt
            if (status === "connected" || status === "disconnected") {
                debouncedSave(profiles);
            }
            return { profiles };
        }),

    setGlobalPreferences: (prefs) =>
        set((state) => ({
            globalPreferences: { ...state.globalPreferences, ...prefs },
        })),
}));
