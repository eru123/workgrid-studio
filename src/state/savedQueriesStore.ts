import { create } from "zustand";
import {
  deleteData,
  getDataDir,
  readData,
  readTextData,
  writeData,
  writeTextData,
} from "@/lib/storage";
import { appendOutput } from "@/lib/output";

const QUERIES_ROOT = "queries";

export interface SavedQueryEntry {
  id: string;
  profileId: string;
  name: string;
  filePath: string;
  absolutePath: string;
  database?: string;
  scheduleMinutes: number | null;
  scheduleEnabled: boolean;
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string | null;
  lastRunStatus?: "success" | "error" | null;
  lastRunSummary?: string | null;
}

interface SaveSavedQueryInput {
  profileId: string;
  name: string;
  sql: string;
  database?: string;
  scheduleMinutes?: number | null;
  existingId?: string;
}

interface SavedQueriesState {
  byProfile: Record<string, SavedQueryEntry[]>;
  loadingByProfile: Record<string, boolean>;
  errorByProfile: Record<string, string | null>;
  loadProfileQueries: (profileId: string) => Promise<void>;
  loadAllQueries: (profileIds: string[]) => Promise<void>;
  saveQuery: (input: SaveSavedQueryInput) => Promise<SavedQueryEntry>;
  deleteQuery: (profileId: string, queryId: string) => Promise<void>;
  readQueryText: (filePath: string) => Promise<string>;
  recordQueryRun: (
    profileId: string,
    queryId: string,
    updates: Pick<SavedQueryEntry, "lastRunAt" | "lastRunStatus" | "lastRunSummary">,
  ) => Promise<void>;
}

let cachedDataDir: string | null = null;

function manifestPath(profileId: string) {
  return `${QUERIES_ROOT}/${profileId}/index.json`;
}

function buildAbsolutePath(baseDir: string, relativePath: string) {
  return `${baseDir.replace(/[\\/]+$/, "")}\\data\\${relativePath.replace(/\//g, "\\")}`;
}

function normalizeEntry(baseDir: string, entry: SavedQueryEntry): SavedQueryEntry {
  return {
    ...entry,
    absolutePath:
      entry.absolutePath || buildAbsolutePath(baseDir, entry.filePath),
    scheduleMinutes:
      typeof entry.scheduleMinutes === "number" && Number.isFinite(entry.scheduleMinutes)
        ? Math.max(1, Math.round(entry.scheduleMinutes))
        : null,
    scheduleEnabled:
      typeof entry.scheduleMinutes === "number" && Number.isFinite(entry.scheduleMinutes)
        ? !!entry.scheduleEnabled
        : false,
  };
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "query";
}

async function resolveDataDir() {
  if (!cachedDataDir) {
    cachedDataDir = await getDataDir();
  }
  return cachedDataDir;
}

async function writeManifest(profileId: string, entries: SavedQueryEntry[]) {
  await writeData(manifestPath(profileId), entries);
}

export const useSavedQueriesStore = create<SavedQueriesState>((set, get) => ({
  byProfile: {},
  loadingByProfile: {},
  errorByProfile: {},

  loadProfileQueries: async (profileId) => {
    set((state) => ({
      loadingByProfile: { ...state.loadingByProfile, [profileId]: true },
      errorByProfile: { ...state.errorByProfile, [profileId]: null },
    }));

    try {
      const baseDir = await resolveDataDir();
      const entries = await readData<SavedQueryEntry[]>(manifestPath(profileId), []);
      const normalized = entries
        .map((entry) => normalizeEntry(baseDir, entry))
        .sort((left, right) => left.name.localeCompare(right.name));

      set((state) => ({
        byProfile: { ...state.byProfile, [profileId]: normalized },
        loadingByProfile: { ...state.loadingByProfile, [profileId]: false },
      }));
    } catch (error) {
      set((state) => ({
        loadingByProfile: { ...state.loadingByProfile, [profileId]: false },
        errorByProfile: { ...state.errorByProfile, [profileId]: String(error) },
      }));
    }
  },

  loadAllQueries: async (profileIds) => {
    await Promise.all(profileIds.map((profileId) => get().loadProfileQueries(profileId)));
  },

  saveQuery: async ({
    profileId,
    name,
    sql,
    database,
    scheduleMinutes,
    existingId,
  }) => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      throw new Error("Saved query name is required.");
    }
    if (!sql.trim()) {
      throw new Error("Cannot save an empty query.");
    }

    const baseDir = await resolveDataDir();
    const current = get().byProfile[profileId] ?? [];
    const now = new Date().toISOString();
    const existing = existingId
      ? current.find((entry) => entry.id === existingId)
      : undefined;
    const id = existing?.id ?? crypto.randomUUID();
    const relativePath =
      existing?.filePath ?? `${QUERIES_ROOT}/${profileId}/${slugify(trimmedName)}-${id.slice(0, 8)}.sql`;

    const nextEntry: SavedQueryEntry = {
      id,
      profileId,
      name: trimmedName,
      filePath: relativePath,
      absolutePath: buildAbsolutePath(baseDir, relativePath),
      database: database?.trim() ? database.trim() : undefined,
      scheduleMinutes:
        typeof scheduleMinutes === "number" && Number.isFinite(scheduleMinutes)
          ? Math.max(1, Math.round(scheduleMinutes))
          : null,
      scheduleEnabled:
        typeof scheduleMinutes === "number" && Number.isFinite(scheduleMinutes),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      lastRunAt: existing?.lastRunAt ?? null,
      lastRunStatus: existing?.lastRunStatus ?? null,
      lastRunSummary: existing?.lastRunSummary ?? null,
    };

    await writeTextData(relativePath, sql);

    const nextEntries = existing
      ? current.map((entry) => (entry.id === existing.id ? nextEntry : entry))
      : [...current, nextEntry];
    const sortedEntries = [...nextEntries].sort((left, right) =>
      left.name.localeCompare(right.name),
    );

    await writeManifest(profileId, sortedEntries);
    set((state) => ({
      byProfile: {
        ...state.byProfile,
        [profileId]: sortedEntries,
      },
    }));

    appendOutput(
      "success",
      `Saved query "${trimmedName}" to ${nextEntry.absolutePath}.`,
    );

    return nextEntry;
  },

  deleteQuery: async (profileId, queryId) => {
    const current = get().byProfile[profileId] ?? [];
    const existing = current.find((entry) => entry.id === queryId);
    if (!existing) return;

    const nextEntries = current.filter((entry) => entry.id !== queryId);
    await Promise.all([
      deleteData(existing.filePath).catch(() => {}),
      writeManifest(profileId, nextEntries),
    ]);

    set((state) => ({
      byProfile: {
        ...state.byProfile,
        [profileId]: nextEntries,
      },
    }));
  },

  readQueryText: async (filePath) => {
    return readTextData(filePath, "");
  },

  recordQueryRun: async (profileId, queryId, updates) => {
    const current = get().byProfile[profileId] ?? [];
    const nextEntries = current.map((entry) =>
      entry.id === queryId
        ? {
            ...entry,
            ...updates,
          }
        : entry,
    );

    set((state) => ({
      byProfile: {
        ...state.byProfile,
        [profileId]: nextEntries,
      },
    }));

    await writeManifest(profileId, nextEntries);
  },
}));
