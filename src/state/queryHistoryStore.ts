import { create } from "zustand";
import { readData, writeData } from "@/lib/storage";

/**
 * Query history item
 */
export interface QueryHistoryItem {
    id: string;
    query: string;
    timestamp: number;
    profileId: string;
    database?: string;
    executionTimeMs?: number;
    favorited?: boolean;
}

interface QueryHistoryState {
    history: QueryHistoryItem[];
    /** True once the persisted history has been read from disk. Writes are
     *  suppressed until hydrated to prevent an early empty-state save from
     *  wiping previously stored history (C8 race-condition fix). */
    _hydrated: boolean;
    loadHistory: () => Promise<void>;
    addHistoryItem: (item: Omit<QueryHistoryItem, "id" | "timestamp">) => void;
    deleteHistoryItem: (id: string) => void;
    toggleFavorite: (id: string) => void;
    clearHistory: (profileId?: string) => void;
}

/**
 * Store for executed query history.
 * Persists to history.json.
 *
 * Call loadHistory() explicitly from App.tsx on startup rather than relying
 * on a module-level side-effect, which could race with first writes.
 */
export const useQueryHistoryStore = create<QueryHistoryState>()(
    (set, get) => ({
        history: [],
        _hydrated: false,

        loadHistory: async () => {
            if (get()._hydrated) return;
            const data = await readData<QueryHistoryItem[]>("history.json", []);
            set({ history: data, _hydrated: true });
        },

        addHistoryItem: (item) => {
            const newItem: QueryHistoryItem = {
                ...item,
                id: crypto.randomUUID(),
                timestamp: Date.now(),
            };

            set((state) => {
                // Keep only top 100 items, removing duplicates of the same query per profile/db
                const filtered = state.history.filter(
                    (h) => !(h.profileId === item.profileId && h.query.trim() === item.query.trim())
                );
                const next = [newItem, ...filtered].slice(0, 100);
                if (state._hydrated) debouncedSave(next);
                return { history: next };
            });
        },

        deleteHistoryItem: (id) => {
            set((state) => {
                const next = state.history.filter((h) => h.id !== id);
                if (state._hydrated) debouncedSave(next);
                return { history: next };
            });
        },

        toggleFavorite: (id) => {
            set((state) => {
                const next = state.history.map((h) =>
                    h.id === id ? { ...h, favorited: !h.favorited } : h
                );
                if (state._hydrated) debouncedSave(next);
                return { history: next };
            });
        },

        clearHistory: (profileId) => {
            set((state) => {
                const next = profileId
                    ? state.history.filter((h) => h.profileId !== profileId || h.favorited)
                    : state.history.filter((h) => h.favorited);
                if (state._hydrated) debouncedSave(next);
                return { history: next };
            });
        },
    })
);

let saveTimeout: ReturnType<typeof setTimeout> | null = null;
function debouncedSave(data: QueryHistoryItem[]) {
    if (saveTimeout) clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => {
        writeData("history.json", data);
    }, 300);
}
