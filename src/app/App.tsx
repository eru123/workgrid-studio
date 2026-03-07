import { useEffect } from "react";
import { Workbench } from "@/components/layout/Workbench";
import { ThemeProvider } from "./providers/ThemeProvider";
import { useProfilesStore } from "@/state/profilesStore";
import { useTasksStore } from "@/state/tasksStore";
import { ToastContainer } from "@/components/ui/ToastContainer";

export function App() {
    const loadProfiles = useProfilesStore((s) => s.loadProfiles);
    const loadTasks = useTasksStore((s) => s.loadTasks);

    useEffect(() => {
        loadProfiles();
        loadTasks();
    }, [loadProfiles, loadTasks]);

    return (
        <ThemeProvider>
            <Workbench />
            <ToastContainer />
        </ThemeProvider>
    );
}
