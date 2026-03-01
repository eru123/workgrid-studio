import { create } from "zustand";

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

interface TasksState {
    tasks: Task[];
    addTask: (task: Omit<Task, "id" | "createdAt" | "updatedAt">) => void;
    updateTask: (id: string, updates: Partial<Omit<Task, "id" | "createdAt" | "updatedAt">>) => void;
    // Notice NO deleteTask function is provided per business rules.
}

export const useTasksStore = create<TasksState>((set) => ({
    tasks: [],

    addTask: (payload) =>
        set((state) => {
            const now = Date.now();
            const newTask: Task = {
                id: crypto.randomUUID(),
                ...payload,
                createdAt: now,
                updatedAt: now,
            };
            return { tasks: [...state.tasks, newTask] }; // append-only logic
        }),

    updateTask: (id, updates) =>
        set((state) => ({
            tasks: state.tasks.map((task) =>
                task.id === id
                    ? { ...task, ...updates, updatedAt: Date.now() }
                    : task
            ),
        })),
}));
