import { create } from "zustand";


export interface Session {
    id: string; // The window/session UUID
    profileId: string; // To match which DB it's connected to
    connectedAt: number;
}

interface SessionState {
    sessions: Session[];
    activeSessionId: string | null;

    openSession: (profileId: string) => void;
    closeSession: (id: string) => void;
    setActiveSession: (id: string | null) => void;
}

export const useSessionStore = create<SessionState>((set) => ({
    sessions: [],
    activeSessionId: null,

    openSession: (profileId) =>
        set((state) => {
            // Check if already open
            const existing = state.sessions.find((s) => s.profileId === profileId);
            if (existing) {
                return { activeSessionId: existing.id };
            }
            const newSession: Session = {
                id: crypto.randomUUID(),
                profileId,
                connectedAt: Date.now()
            };
            return {
                sessions: [...state.sessions, newSession],
                activeSessionId: newSession.id
            };
        }),

    closeSession: (id) =>
        set((state) => {
            const activeSessionId =
                state.activeSessionId === id ? null : state.activeSessionId;
            return {
                sessions: state.sessions.filter((s) => s.id !== id),
                activeSessionId,
            };
        }),

    setActiveSession: (id) => set({ activeSessionId: id }),
}));
