import { useEffect } from "react";
import { Workbench } from "@/components/layout/Workbench";
import { ThemeProvider } from "./providers/ThemeProvider";
import { useProfilesStore } from "@/state/profilesStore";
import { useTasksStore } from "@/state/tasksStore";
import { ToastContainer } from "@/components/ui/ToastContainer";
import { CommandPalette } from "@/components/views/CommandPalette";
import { useAppStore } from "@/state/appStore";

export function App() {
    const loadProfiles = useProfilesStore((s) => s.loadProfiles);
    const loadTasks = useTasksStore((s) => s.loadTasks);

    const setCommandPaletteOpen = useAppStore((s) => s.setCommandPaletteOpen);

    useEffect(() => {
        loadProfiles();
        loadTasks();
    }, [loadProfiles, loadTasks]);

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
        </ThemeProvider>
    );
}
