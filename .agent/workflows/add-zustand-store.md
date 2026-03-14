---
description: Generate a new Zustand store following existing patterns
---

# Add New Zustand Store

Follow these steps to create a new Zustand store that follows the project's patterns.

## 1. Create the store file

Create `src/state/yourStore.ts`:

```typescript
import { create } from "zustand";

// 1. Define your interfaces at top
interface YourItem {
    id: string;
    name: string;
    // ...
}

// 2. Define the state shape
interface YourState {
    // Data
    items: YourItem[];
    _loaded: boolean;

    // Loading / Error tracking
    loading: Record<string, boolean>;
    errors: Record<string, string>;

    // Actions
    loadItems: () => Promise<void>;
    addItem: (item: Omit<YourItem, "id">) => void;
    removeItem: (id: string) => void;
    setLoading: (key: string, loading: boolean) => void;
    setError: (key: string, error: string) => void;
    clearError: (key: string) => void;
}

// 3. Create with typed state
export const useYourStore = create<YourState>((set, get) => ({
    items: [],
    _loaded: false,
    loading: {},
    errors: {},

    loadItems: async () => {
        if (get()._loaded) return;
        try {
            // Load from disk or API
            set({ items: [], _loaded: true });
        } catch (e) {
            console.error("[yourStore] load error:", e);
            set({ _loaded: true });
        }
    },

    addItem: (data) => {
        const newItem: YourItem = {
            ...data,
            id: crypto.randomUUID(),
        };
        set((state) => ({ items: [...state.items, newItem] }));
    },

    removeItem: (id) =>
        set((state) => ({
            items: state.items.filter((item) => item.id !== id),
        })),

    setLoading: (key, loading) =>
        set((state) => ({
            loading: { ...state.loading, [key]: loading },
        })),

    setError: (key, error) =>
        set((state) => ({
            errors: { ...state.errors, [key]: error },
        })),

    clearError: (key) =>
        set((state) => {
            const errors = { ...state.errors };
            delete errors[key];
            return { errors };
        }),
}));
```

## Key Patterns to Follow

- Use `create<StateType>((set, get) => ({ ... }))` — always typed
- Track loading per-key with `Record<string, boolean>`
- Use `_loaded` guard for one-time initialization
- For persistence: import `readData`/`writeData` from `@/lib/storage` and use `debouncedSave()`
- For cache keys: use composite format `${profileId}::${database}::${table}`
- Access outside React: `useYourStore.getState().someAction()`

## Checklist
- [ ] Interfaces defined for all data shapes
- [ ] State interface includes loading/error tracking
- [ ] Store created with proper typing
- [ ] Persistence added if data needs to survive restarts
- [ ] `_loaded` guard prevents redundant loading
