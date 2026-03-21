import { create } from "zustand";

interface Toast {
    id: string;
    title: string;
    description?: string;
    variant?: "default" | "destructive";
    action?: { label: string; onClick: () => void };
    persistent?: boolean;
}

export interface StatusBarInfo {
    profileId?: string;
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

// ─── Pluggable status bar entries ────────────────────────────────────────────

export interface StatusBarEntry {
  /** Unique identifier for this entry */
  id: string;
  /** Text label shown in the status bar */
  label: string;
  /** Tooltip shown on hover */
  title?: string;
  /** Which side to render on */
  side: "left" | "right";
  /** Higher priority items appear closer to the center (left: descending, right: ascending) */
  priority: number;
  /** Optional click handler */
  onClick?: () => void;
}

interface AppState {
    toasts: Toast[];
    outputEntries: OutputEntry[];
    isCommandPaletteOpen: boolean;
    statusBarInfo: StatusBarInfo;
    statusBarEntries: StatusBarEntry[];
    setCommandPaletteOpen: (open: boolean) => void;
    addToast: (toast: Omit<Toast, "id">) => void;
    dismissToast: (id: string) => void;
    addOutputEntry: (entry: Omit<OutputEntry, "id" | "timestamp"> & { timestamp?: string }) => void;
    clearOutputEntries: () => void;
    setStatusBarInfo: (info: StatusBarInfo) => void;
    addStatusBarEntry: (entry: StatusBarEntry) => void;
    removeStatusBarEntry: (id: string) => void;
    updateStatusBarEntry: (id: string, updates: Partial<Omit<StatusBarEntry, "id">>) => void;
}

export const useAppStore = create<AppState>((set) => ({
    toasts: [],
    outputEntries: [],
    isCommandPaletteOpen: false,
    statusBarInfo: {},
    statusBarEntries: [],
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
    addStatusBarEntry: (entry) =>
        set((state) => ({
            statusBarEntries: state.statusBarEntries.some((e) => e.id === entry.id)
                ? state.statusBarEntries.map((e) => (e.id === entry.id ? entry : e))
                : [...state.statusBarEntries, entry],
        })),
    removeStatusBarEntry: (id) =>
        set((state) => ({
            statusBarEntries: state.statusBarEntries.filter((e) => e.id !== id),
        })),
    updateStatusBarEntry: (id, updates) =>
        set((state) => ({
            statusBarEntries: state.statusBarEntries.map((e) =>
                e.id === id ? { ...e, ...updates } : e,
            ),
        })),
}));
