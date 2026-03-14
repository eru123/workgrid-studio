import { create } from "zustand";

interface Toast {
    id: string;
    title: string;
    description?: string;
    variant?: "default" | "destructive";
}

export interface StatusBarInfo {
    connectionName?: string;
    database?: string;
    executionTimeMs?: number;
    rowCount?: number;
}

export type OutputLevel = "info" | "success" | "warning" | "error";

export interface OutputEntry {
    id: string;
    timestamp: string;
    level: OutputLevel;
    message: string;
    profileId?: string;
    profileName?: string;
}

const MAX_OUTPUT_ENTRIES = 500;

function formatOutputTimestamp(date: Date = new Date()): string {
    const pad = (value: number) => value.toString().padStart(2, "0");

    return [
        date.getFullYear(),
        pad(date.getMonth() + 1),
        pad(date.getDate()),
    ].join("-") + ` ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

interface AppState {
    focusedContainerId: string | null;
    toasts: Toast[];
    outputEntries: OutputEntry[];
    hotkeysEnabled: boolean;
    isCommandPaletteOpen: boolean;
    statusBarInfo: StatusBarInfo;
    setFocusedContainerId: (id: string | null) => void;
    setHotkeysEnabled: (enabled: boolean) => void;
    setCommandPaletteOpen: (open: boolean) => void;
    addToast: (toast: Omit<Toast, "id">) => void;
    dismissToast: (id: string) => void;
    addOutputEntry: (entry: Omit<OutputEntry, "id" | "timestamp"> & { timestamp?: string }) => void;
    clearOutputEntries: () => void;
    setStatusBarInfo: (info: StatusBarInfo) => void;
}

export const useAppStore = create<AppState>((set) => ({
    focusedContainerId: null,
    toasts: [],
    outputEntries: [],
    hotkeysEnabled: true,
    isCommandPaletteOpen: false,
    statusBarInfo: {},
    setFocusedContainerId: (id) => set({ focusedContainerId: id }),
    setHotkeysEnabled: (enabled) => set({ hotkeysEnabled: enabled }),
    setCommandPaletteOpen: (open) => set({ isCommandPaletteOpen: open }),
    addToast: (toast) =>
        set((state) => ({
            toasts: [...state.toasts, { ...toast, id: crypto.randomUUID() }],
        })),
    dismissToast: (id) =>
        set((state) => ({
            toasts: state.toasts.filter((t) => t.id !== id),
        })),
    addOutputEntry: (entry) =>
        set((state) => ({
            outputEntries: [
                ...state.outputEntries,
                {
                    ...entry,
                    id: crypto.randomUUID(),
                    timestamp: entry.timestamp ?? formatOutputTimestamp(),
                },
            ].slice(-MAX_OUTPUT_ENTRIES),
        })),
    clearOutputEntries: () => set({ outputEntries: [] }),
    setStatusBarInfo: (info) => set({ statusBarInfo: info }),
}));
