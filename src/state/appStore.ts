import { create } from "zustand";

interface Toast {
    id: string;
    title: string;
    description?: string;
    variant?: "default" | "destructive";
}

interface AppState {
    theme: "light" | "dark" | "system";
    focusedContainerId: string | null;
    toasts: Toast[];
    hotkeysEnabled: boolean;
    setTheme: (theme: "light" | "dark" | "system") => void;
    setFocusedContainerId: (id: string | null) => void;
    setHotkeysEnabled: (enabled: boolean) => void;
    addToast: (toast: Omit<Toast, "id">) => void;
    dismissToast: (id: string) => void;
}

export const useAppStore = create<AppState>((set) => ({
    theme: "dark",
    focusedContainerId: null,
    toasts: [],
    hotkeysEnabled: true,
    setTheme: (theme) => set({ theme }),
    setFocusedContainerId: (id) => set({ focusedContainerId: id }),
    setHotkeysEnabled: (enabled) => set({ hotkeysEnabled: enabled }),
    addToast: (toast) =>
        set((state) => ({
            toasts: [...state.toasts, { ...toast, id: crypto.randomUUID() }],
        })),
    dismissToast: (id) =>
        set((state) => ({
            toasts: state.toasts.filter((t) => t.id !== id),
        })),
}));
