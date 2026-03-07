import { useProfilesStore } from "@/state/profilesStore";
import { cn } from "@/lib/utils/cn";
import { Monitor, Moon, Sun, Type } from "lucide-react";

export function SettingsPage() {
    const globalPrefs = useProfilesStore((s) => s.globalPreferences);
    const setGlobalPrefs = useProfilesStore((s) => s.setGlobalPreferences);

    return (
        <div className="flex flex-col w-full h-full bg-background text-foreground text-sm overflow-hidden">
            <div className="h-10 border-b flex items-center px-4 shrink-0 bg-muted/20">
                <h2 className="font-semibold tracking-wide">Settings</h2>
            </div>

            <div className="p-6 overflow-y-auto w-full max-w-3xl mx-auto flex flex-col gap-10">

                {/* Theme Section */}
                <section className="flex flex-col gap-4">
                    <div className="border-b pb-2">
                        <h3 className="font-medium text-lg">Appearance</h3>
                        <p className="text-muted-foreground text-xs">Manage the editor UI visual theme.</p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        {(["light", "dark", "system"] as const).map((themeOpt) => (
                            <button
                                key={themeOpt}
                                onClick={() => setGlobalPrefs({ ...globalPrefs, theme: themeOpt })}
                                className={cn(
                                    "flex flex-col items-center justify-center p-4 rounded-lg border-2 transition-all hover:bg-muted/50",
                                    globalPrefs.theme === themeOpt ? "border-primary bg-primary/5" : "border-border/50"
                                )}
                            >
                                {themeOpt === "light" && <Sun className="w-8 h-8 mb-3 text-primary" />}
                                {themeOpt === "dark" && <Moon className="w-8 h-8 mb-3 text-primary" />}
                                {themeOpt === "system" && <Monitor className="w-8 h-8 mb-3 text-primary" />}
                                <span className="font-medium capitalize">{themeOpt}</span>
                            </button>
                        ))}
                    </div>
                </section>

                {/* Editor Section */}
                <section className="flex flex-col gap-4">
                    <div className="border-b pb-2">
                        <h3 className="font-medium text-lg">Editor</h3>
                        <p className="text-muted-foreground text-xs">Configure text editing behaviors.</p>
                    </div>

                    <div className="flex items-center justify-between p-4 bg-muted/20 rounded-lg border">
                        <div className="flex items-center gap-3">
                            <Type className="w-5 h-5 text-muted-foreground" />
                            <div>
                                <span className="font-medium">Font Size</span>
                                <p className="text-muted-foreground text-[11px] mt-0.5">Adjust the global editor typography scale.</p>
                            </div>
                        </div>

                        <div className="flex items-center gap-2">
                            <span className="text-sm w-6 text-right font-mono">{globalPrefs.fontSize || 13}px</span>
                            <input
                                type="range"
                                min="10"
                                max="24"
                                step="1"
                                className="w-32 accent-primary"
                                value={globalPrefs.fontSize || 13}
                                onChange={(e) => setGlobalPrefs({ ...globalPrefs, fontSize: parseInt(e.target.value) })}
                            />
                        </div>
                    </div>
                </section>

            </div>
        </div>
    );
}
