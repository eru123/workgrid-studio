import { useEffect } from "react";
import { useProfilesStore } from "@/state/profilesStore";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
    const theme = useProfilesStore((state) => state.globalPreferences.theme || "system");
    const fontSize = useProfilesStore((state) => state.globalPreferences.fontSize || 13);

    useEffect(() => {
        const root = window.document.documentElement;

        root.classList.remove("light", "dark");

        if (theme === "system") {
            const systemTheme = window.matchMedia("(prefers-color-scheme: dark)")
                .matches
                ? "dark"
                : "light";

            root.classList.add(systemTheme);
            return;
        }

        root.classList.add(theme);
    }, [theme]);

    useEffect(() => {
        window.document.documentElement.style.setProperty("--app-font-size", `${fontSize}px`);
    }, [fontSize]);

    return <>{children}</>;
}
