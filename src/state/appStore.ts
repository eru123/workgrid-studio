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

interface AppState {
    focusedContainerId: string | null;
    toasts: Toast[];
    hotkeysEnabled: boolean;
    isCommandPaletteOpen: boolean;
    statusBarInfo: StatusBarInfo;
    setFocusedContainerId: (id: string | null) => void;
    setHotkeysEnabled: (enabled: boolean) => void;
    setCommandPaletteOpen: (open: boolean) => void;
    addToast: (toast: Omit<Toast, "id">) => void;
    dismissToast: (id: string) => void;
    setStatusBarInfo: (info: StatusBarInfo) => void;
}

export const useAppStore = create<AppState>((set) => ({
    focusedContainerId: null,
    toasts: [],
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
    setStatusBarInfo: (info) => set({ statusBarInfo: info }),
}));
