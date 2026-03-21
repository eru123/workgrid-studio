import { create } from "zustand";
import { readData, writeData } from "@/lib/storage";

export interface SnippetEntry {
  id: string;
  name: string;
  description: string;
  body: string;
  profileId?: string;
}

interface SnippetsState {
  snippets: SnippetEntry[];
  _loaded: boolean;

  loadSnippets: () => Promise<void>;
  addSnippet: (snippet: Omit<SnippetEntry, "id">) => SnippetEntry;
  updateSnippet: (id: string, updates: Partial<Omit<SnippetEntry, "id">>) => void;
  deleteSnippet: (id: string) => void;
}

const SNIPPETS_FILE = "snippets.json";
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function debouncedSave(snippets: SnippetEntry[]) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    writeData(SNIPPETS_FILE, snippets).catch(() => {});
  }, 300);
}

export const useSnippetsStore = create<SnippetsState>((set, get) => ({
  snippets: [],
  _loaded: false,

  loadSnippets: async () => {
    if (get()._loaded) return;
    try {
      const snippets = await readData<SnippetEntry[]>(SNIPPETS_FILE, []);
      set({ snippets, _loaded: true });
    } catch {
      set({ snippets: [], _loaded: true });
    }
  },

  addSnippet: (snippet) => {
    const entry: SnippetEntry = {
      ...snippet,
      id: crypto.randomUUID(),
    };
    set((state) => {
      const snippets = [...state.snippets, entry];
      debouncedSave(snippets);
      return { snippets };
    });
    return entry;
  },

  updateSnippet: (id, updates) =>
    set((state) => {
      const snippets = state.snippets.map((snippet) =>
        snippet.id === id ? { ...snippet, ...updates } : snippet,
      );
      debouncedSave(snippets);
      return { snippets };
    }),

  deleteSnippet: (id) =>
    set((state) => {
      const snippets = state.snippets.filter((snippet) => snippet.id !== id);
      debouncedSave(snippets);
      return { snippets };
    }),
}));
