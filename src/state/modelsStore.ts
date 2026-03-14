import { create } from "zustand";
import { readData, writeData } from "@/lib/storage";

export interface AIModel {
    id: string;
    name: string;
}

export interface ModelProvider {
    id: string;
    type: "openai" | "gemini" | "deepseek" | "other";
    name: string;
    baseUrl?: string;
    apiKeyRef?: string; // Reference to secure storage, never the raw key
    models: AIModel[];
    defaultModelId?: string;
}

interface ModelsState {
    providers: ModelProvider[];
    selectedProviderId: string | null;
    _loaded: boolean;

    loadProviders: () => Promise<void>;
    addProvider: (provider: ModelProvider) => void;
    updateProvider: (id: string, provider: Partial<ModelProvider>) => void;
    deleteProvider: (id: string) => void;
    setSelectedProviderId: (id: string | null) => void;
}

const MODELS_FILE = "models.json";

let saveTimer: ReturnType<typeof setTimeout> | null = null;
function debouncedSave(state: { providers: ModelProvider[], selectedProviderId: string | null }) {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
        writeData(MODELS_FILE, state).catch(() => { });
    }, 300);
}

export const useModelsStore = create<ModelsState>((set, get) => ({
    providers: [],
    selectedProviderId: null,
    _loaded: false,

    loadProviders: async () => {
        if (get()._loaded) return;
        try {
            const saved = await readData<{ providers: ModelProvider[], selectedProviderId: string | null }>(MODELS_FILE, {
                providers: [],
                selectedProviderId: null
            });
            set({
                providers: saved.providers || [],
                selectedProviderId: saved.selectedProviderId || null,
                _loaded: true
            });
        } catch {
            set({ _loaded: true });
        }
    },

    addProvider: (provider) =>
        set((state) => {
            const nextState = { providers: [...state.providers, provider], selectedProviderId: state.selectedProviderId };
            debouncedSave(nextState);
            return nextState;
        }),

    updateProvider: (id, updates) =>
        set((state) => {
            const nextState = {
                providers: state.providers.map((p) =>
                    p.id === id ? { ...p, ...updates } : p
                ),
                selectedProviderId: state.selectedProviderId
            };
            debouncedSave(nextState);
            return nextState;
        }),

    deleteProvider: (id) =>
        set((state) => {
            const nextState = {
                providers: state.providers.filter((p) => p.id !== id),
                selectedProviderId: state.selectedProviderId === id ? null : state.selectedProviderId,
            };
            debouncedSave(nextState);
            return nextState;
        }),

    setSelectedProviderId: (id) => set((state) => {
        const nextState = { providers: state.providers, selectedProviderId: id };
        debouncedSave(nextState);
        return nextState;
    }),
}));
