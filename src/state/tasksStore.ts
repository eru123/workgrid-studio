import { create } from "zustand";
import { readData, writeData } from "@/lib/storage";

export type TaskStatus = "todo" | "doing" | "blocked" | "done";

export interface Task {
    id: string;
    title: string;
    description: string;
    status: TaskStatus;
    tags: string[];
    createdAt: number;
    updatedAt: number;
}

const TASKS_FILE = "tasks.json";

let saveTimer: ReturnType<typeof setTimeout> | null = null;

function debouncedSave(tasks: Task[]) {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
        writeData(TASKS_FILE, tasks).catch(() => {
            // Silently catch in production
        });
    }, 300);
}

interface TasksState {
    tasks: Task[];
    _loaded: boolean;
    loadTasks: () => Promise<void>;
    addTask: (task: Omit<Task, "id" | "createdAt" | "updatedAt">) => void;
    updateTask: (id: string, updates: Partial<Omit<Task, "id" | "createdAt" | "updatedAt">>) => void;
    // Notice NO deleteTask function is provided per business rules.
}

export const useTasksStore = create<TasksState>((set, get) => ({
    tasks: [],
    _loaded: false,

    loadTasks: async () => {
        if (get()._loaded) return;
        try {
            const saved = await readData<Task[]>(TASKS_FILE, []);
            set({ tasks: saved, _loaded: true });
        } catch (e) {
            set({ _loaded: true });
        }
    },

    addTask: (payload) =>
        set((state) => {
            const now = Date.now();
            const newTask: Task = {
                id: crypto.randomUUID(),
                ...payload,
                createdAt: now,
                updatedAt: now,
            };
            const nextTasks = [...state.tasks, newTask];
            debouncedSave(nextTasks);
            return { tasks: nextTasks }; // append-only logic
        }),

    updateTask: (id, updates) =>
        set((state) => {
            const nextTasks = state.tasks.map((task) =>
                task.id === id
                    ? { ...task, ...updates, updatedAt: Date.now() }
                    : task
            );
            debouncedSave(nextTasks);
            return { tasks: nextTasks };
        }),
}));
