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
    addHistoryItem: (item: Omit<QueryHistoryItem, "id" | "timestamp">) => void;
    deleteHistoryItem: (id: string) => void;
    toggleFavorite: (id: string) => void;
    clearHistory: (profileId?: string) => void;
}

/**
 * Store for executed query history.
 * Persists to history.json.
 */
export const useQueryHistoryStore = create<QueryHistoryState>()(
    (set) => ({
        history: [],

        addHistoryItem: (item) => {
            const newItem: QueryHistoryItem = {
                ...item,
                id: crypto.randomUUID(),
                timestamp: Date.now(),
            };

            set((state) => {
                // Keep only top 100 items, and remove duplicates of the same query within the same profile/db
                const filtered = state.history.filter(
                    (h) => !(h.profileId === item.profileId && h.query.trim() === item.query.trim())
                );
                const next = [newItem, ...filtered].slice(0, 100);
                debouncedSave(next);
                return { history: next };
            });
        },

        deleteHistoryItem: (id) => {
            set((state) => {
                const next = state.history.filter(h => h.id !== id);
                debouncedSave(next);
                return { history: next };
            });
        },

        toggleFavorite: (id) => {
            set((state) => {
                const next = state.history.map(h =>
                    h.id === id ? { ...h, favorited: !h.favorited } : h
                );
                debouncedSave(next);
                return { history: next };
            });
        },

        clearHistory: (profileId) => {
            set((state) => {
                const next = profileId
                    ? state.history.filter(h => h.profileId !== profileId || h.favorited)
                    : state.history.filter(h => h.favorited);
                debouncedSave(next);
                return { history: next };
            });
        },
    })
);

// Initialization: Load from disk
readData<QueryHistoryItem[]>("history.json", []).then((data) => {
    useQueryHistoryStore.setState({ history: data });
});

let saveTimeout: ReturnType<typeof setTimeout> | null = null;
function debouncedSave(data: QueryHistoryItem[]) {
    if (saveTimeout) clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => {
        writeData("history.json", data);
    }, 300);
}
