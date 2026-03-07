import { useEffect } from "react";
import { Workbench } from "@/components/layout/Workbench";
import { ThemeProvider } from "./providers/ThemeProvider";
import { useProfilesStore } from "@/state/profilesStore";
import { ToastContainer } from "@/components/ui/ToastContainer";

export function App() {
    const loadProfiles = useProfilesStore((s) => s.loadProfiles);

    useEffect(() => {
        loadProfiles();
    }, [loadProfiles]);

    return (
        <ThemeProvider>
            <Workbench />
            <ToastContainer />
        </ThemeProvider>
    );
}
