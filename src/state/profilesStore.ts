import { create } from "zustand";
import { readData, writeData } from "@/lib/storage";
import { encryptPassword, decryptPassword } from "@/lib/db";
import { useAppStore } from "@/state/appStore";

export type DatabaseType =
  | "postgres"
  | "mysql"
  | "sqlite"
  | "mariadb"
  | "mssql";

export type ConnectionStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "error";

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

export interface GlobalPreferences extends ProfilePreferences {
  privacyDisclosureAcceptedAt?: number | null;
  aiPromptWarningAcceptedAt?: number | null;
  blockAiRequests?: boolean;
  allowUpdateChecks?: boolean;
  maxLogSizeMb?: number;
  maxResultRows?: number;
  queryTimeoutMs?: number;
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
  sslCaFile?: string;
  sslCertFile?: string;
  sslKeyFile?: string;
  sslRejectUnauthorized?: boolean;
  // SSH Tunneling
  ssh: boolean;
  sshHost: string;
  sshPort: number;
  sshUser: string;
  sshPassword?: string;
  sshKeyFile?: string;
  sshPassphrase?: string;
  sshStrictKeyChecking?: boolean;
  sshKeepAliveInterval?: number;
  sshCompression?: boolean;
  lastConnectedAt: number | null;
  createdAt: number;
  preferences?: ProfilePreferences;
}

export interface UnreadableSecrets {
  password?: boolean;
  sshPassword?: boolean;
  sshPassphrase?: boolean;
}

// Runtime profile with transient connection state
export interface DatabaseProfile extends SavedProfile {
  connectionStatus: ConnectionStatus;
  unreadableSecrets?: UnreadableSecrets;
}

export type ProfileFormData = Omit<
  DatabaseProfile,
  "id" | "connectionStatus" | "lastConnectedAt" | "createdAt" | "unreadableSecrets"
>;

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
    sslRejectUnauthorized: false,
    ssh: false,
    sshHost: "",
    sshPort: 22,
    sshUser: "",
    sshPassword: "",
    sshKeyFile: "",
    sshPassphrase: "",
    sshStrictKeyChecking: false,
    sshKeepAliveInterval: 0,
    sshCompression: true,
  };
}

const PROFILES_FILE = "profiles.json";
const GLOBAL_PREFERENCES_FILE = "preferences.json";
export const DEFAULT_GLOBAL_PREFERENCES: GlobalPreferences = {
  theme: "dark",
  fontSize: 13,
  privacyDisclosureAcceptedAt: null,
  aiPromptWarningAcceptedAt: null,
  blockAiRequests: false,
  allowUpdateChecks: true,
  maxLogSizeMb: 10,
  maxResultRows: 1000,
  queryTimeoutMs: 30_000,
};

// Debounce timer for saving
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let prefsSaveTimer: ReturnType<typeof setTimeout> | null = null;

async function safeDecryptSecret(
  value: string | undefined,
  profile: Pick<SavedProfile, "id" | "name">,
  field: keyof UnreadableSecrets,
): Promise<{ value: string | undefined; unreadable: boolean }> {
  if (!value) {
    return { value, unreadable: false };
  }

  try {
    return { value: await decryptPassword(value), unreadable: false };
  } catch (error) {
    const labels: Record<keyof UnreadableSecrets, string> = {
      password: "database password",
      sshPassword: "SSH password",
      sshPassphrase: "SSH passphrase",
    };

    useAppStore.getState().addOutputEntry({
      level: "error",
      message: `Stored ${labels[field]} for profile "${profile.name}" could not be decrypted. Re-enter it and save the profile again. ${String(error)}`,
      profileId: profile.id,
      profileName: profile.name,
    });

    return { value: "", unreadable: true };
  }
}

function debouncedSave(profiles: DatabaseProfile[]) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    (async () => {
      try {
        // Strip runtime-only fields and selectively encrypt passwords
        const toSave: SavedProfile[] = await Promise.all(
          profiles.map(async ({ connectionStatus: _, unreadableSecrets: __, password, sshPassword, sshPassphrase, ...rest }) => ({
            ...rest,
            password:       password       ? await encryptPassword(password)       : "",
            sshPassword:    sshPassword    ? await encryptPassword(sshPassword)    : sshPassword,
            sshPassphrase:  sshPassphrase  ? await encryptPassword(sshPassphrase)  : sshPassphrase,
          }))
        );
        await writeData(PROFILES_FILE, toSave);
      } catch (err) {
        // Silently catch in production, persistence will retry on next action
      }
    })();
  }, 300);
}

function debouncedSavePreferences(preferences: GlobalPreferences) {
  if (prefsSaveTimer) clearTimeout(prefsSaveTimer);
  prefsSaveTimer = setTimeout(() => {
    writeData(GLOBAL_PREFERENCES_FILE, preferences).catch(() => {});
  }, 300);
}

interface ProfilesState {
  profiles: DatabaseProfile[];
  globalPreferences: GlobalPreferences;
  _loaded: boolean;

  loadProfiles: () => Promise<void>;
  addProfile: (data: ProfileFormData) => DatabaseProfile;
  updateProfile: (id: string, updates: Partial<ProfileFormData>) => void;
  deleteProfile: (id: string) => void;
  duplicateProfile: (id: string) => void;
  setConnectionStatus: (id: string, status: ConnectionStatus) => void;
  setGlobalPreferences: (prefs: Partial<GlobalPreferences>) => void;
}

export const useProfilesStore = create<ProfilesState>((set, get) => ({
  profiles: [],
  globalPreferences: DEFAULT_GLOBAL_PREFERENCES,
  _loaded: false,

  loadProfiles: async () => {
    if (get()._loaded) return;
    try {
      const savedPreferences = await readData<GlobalPreferences>(
        GLOBAL_PREFERENCES_FILE,
        DEFAULT_GLOBAL_PREFERENCES,
      );
      const saved = await readData<SavedProfile[]>(PROFILES_FILE, []);
      const profiles: DatabaseProfile[] = await Promise.all(
        saved.map(async (s) => {
          const password = await safeDecryptSecret(s.password, s, "password");
          const sshPassword = await safeDecryptSecret(s.sshPassword, s, "sshPassword");
          const sshPassphrase = await safeDecryptSecret(s.sshPassphrase, s, "sshPassphrase");

          const unreadableSecrets: UnreadableSecrets = {};
          if (password.unreadable) unreadableSecrets.password = true;
          if (sshPassword.unreadable) unreadableSecrets.sshPassword = true;
          if (sshPassphrase.unreadable) unreadableSecrets.sshPassphrase = true;

          return {
            ...s,
            password: password.value ?? "",
            sshPassword: sshPassword.value,
            sshPassphrase: sshPassphrase.value,
            connectionStatus: "disconnected" as ConnectionStatus,
            unreadableSecrets:
              Object.keys(unreadableSecrets).length > 0 ? unreadableSecrets : undefined,
          };
        })
      );
      set({
        profiles,
        globalPreferences: {
          ...DEFAULT_GLOBAL_PREFERENCES,
          ...savedPreferences,
        },
        _loaded: true,
      });
    } catch (e) {
      // console.error("[profiles] load error:", e);
      set({
        globalPreferences: DEFAULT_GLOBAL_PREFERENCES,
        _loaded: true,
      });
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
        p.id === id
          ? {
              ...p,
              ...updates,
              unreadableSecrets:
                "password" in updates || "sshPassword" in updates || "sshPassphrase" in updates
                  ? undefined
                  : p.unreadableSecrets,
            }
          : p,
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
      unreadableSecrets: source.unreadableSecrets,
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
            lastConnectedAt:
              status === "connected" ? Date.now() : p.lastConnectedAt,
          }
          : p,
      );
      // Save on connect/disconnect to persist lastConnectedAt
      if (status === "connected" || status === "disconnected") {
        debouncedSave(profiles);
      }
      return { profiles };
    }),

  setGlobalPreferences: (prefs) =>
    set((state) => {
      const globalPreferences = { ...state.globalPreferences, ...prefs };
      debouncedSavePreferences(globalPreferences);
      return { globalPreferences };
    }),
}));
