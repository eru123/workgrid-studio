import { useEffect } from "react";
import { Workbench } from "@/components/layout/Workbench";
import { ThemeProvider } from "./providers/ThemeProvider";
import { useProfilesStore } from "@/state/profilesStore";
import { useTasksStore } from "@/state/tasksStore";
import { useQueryHistoryStore } from "@/state/queryHistoryStore";
import { ToastContainer } from "@/components/ui/ToastContainer";
import { CommandPalette } from "@/components/views/CommandPalette";
import { PrivacyDisclosureModal } from "@/components/views/PrivacyDisclosureModal";
import { useAppStore } from "@/state/appStore";

export function App() {
    const profilesLoaded = useProfilesStore((s) => s._loaded);
    const globalPreferences = useProfilesStore((s) => s.globalPreferences);

    const setCommandPaletteOpen = useAppStore((s) => s.setCommandPaletteOpen);

    useEffect(() => {
        void useProfilesStore.getState().loadProfiles();
        void useTasksStore.getState().loadTasks();
        void useQueryHistoryStore.getState().loadHistory();
    }, []); // intentionally empty — one-time initialization

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && (e.key === "p" || e.key === "k")) {
                e.preventDefault();
                setCommandPaletteOpen(true);
            }
        };
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [setCommandPaletteOpen]);

    return (
        <ThemeProvider>
            <Workbench />
            <CommandPalette />
            <ToastContainer />
            {profilesLoaded && !globalPreferences.privacyDisclosureAcceptedAt && (
                <PrivacyDisclosureModal />
            )}
        </ThemeProvider>
    );
}
