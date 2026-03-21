import { useEffect } from "react";
import { useProfilesStore } from "@/state/profilesStore";
import { applyTheme, getDefaultTheme } from "@/lib/theme";
import type { ThemeManifest } from "@/lib/theme";

function resolveManifest(
  themePreference: string,
  customTheme?: ThemeManifest | null,
): ThemeManifest {
  if (themePreference === "system") {
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    return getDefaultTheme(prefersDark ? "dark" : "light");
  }
  if (themePreference === "custom" && customTheme) {
    return customTheme;
  }
  if (themePreference === "dark" || themePreference === "light") {
    return getDefaultTheme(themePreference);
  }
  return getDefaultTheme("dark");
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const theme = useProfilesStore((s) => s.globalPreferences.theme ?? "system");
  const fontSize = useProfilesStore((s) => s.globalPreferences.fontSize ?? 13);
  const customTheme = useProfilesStore(
    (s) => s.globalPreferences.customTheme as ThemeManifest | undefined,
  );

  // Apply full JSON theme manifest on every preference change
  useEffect(() => {
    applyTheme(resolveManifest(theme, customTheme));
  }, [theme, customTheme]);

  // Re-apply when OS color scheme changes (only matters for "system" preference)
  useEffect(() => {
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => applyTheme(resolveManifest("system", customTheme));
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [theme, customTheme]);

  // Font size is standalone — not part of the theme manifest
  useEffect(() => {
    document.documentElement.style.setProperty("--app-font-size", `${fontSize}px`);
  }, [fontSize]);

  return <>{children}</>;
}
