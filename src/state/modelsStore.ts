import { create } from "zustand";

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
    addProvider: (provider: ModelProvider) => void;
    updateProvider: (id: string, provider: Partial<ModelProvider>) => void;
    deleteProvider: (id: string) => void;
    setSelectedProviderId: (id: string | null) => void;
}

export const useModelsStore = create<ModelsState>((set) => ({
    providers: [],
    selectedProviderId: null,

    addProvider: (provider) =>
        set((state) => ({ providers: [...state.providers, provider] })),

    updateProvider: (id, updates) =>
        set((state) => ({
            providers: state.providers.map((p) =>
                p.id === id ? { ...p, ...updates } : p
            ),
        })),

    deleteProvider: (id) =>
        set((state) => ({
            providers: state.providers.filter((p) => p.id !== id),
            selectedProviderId:
                state.selectedProviderId === id ? null : state.selectedProviderId,
        })),

    setSelectedProviderId: (id) => set({ selectedProviderId: id }),
}));
