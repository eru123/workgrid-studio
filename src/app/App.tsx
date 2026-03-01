import { useEffect } from "react";
import { Workbench } from "@/components/layout/Workbench";
import { ThemeProvider } from "./providers/ThemeProvider";
import { useProfilesStore } from "@/state/profilesStore";

export function App() {
    const loadProfiles = useProfilesStore((s) => s.loadProfiles);

    useEffect(() => {
        loadProfiles();
    }, [loadProfiles]);

    return (
        <ThemeProvider>
            <Workbench />
        </ThemeProvider>
    );
}
