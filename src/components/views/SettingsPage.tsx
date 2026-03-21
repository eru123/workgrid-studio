import { useState, useMemo } from "react";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { openUrl } from "@tauri-apps/plugin-opener";
import { open } from "@tauri-apps/plugin-dialog";
import { readTextFile } from "@tauri-apps/plugin-fs";
import {
    Monitor,
    Moon,
    Sun,
    Type,
    Rows3,
    TimerReset,
    RefreshCw,
    CheckCircle2,
    AlertCircle,
    Download,
    Shield,
    BrainCircuit,
    Trash2,
    HardDrive,
    Heart,
    ExternalLink,
    Palette,
    Search,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { useProfilesStore } from "@/state/profilesStore";
import type { GlobalPreferences } from "@/state/profilesStore";
import { useAppStore } from "@/state/appStore";
import { notifyError, notifySuccess, notify } from "@/lib/notifications";
import { useAppVersion } from "@/hooks/useAppVersion";
import { clearAllLogs, dbDisconnect, deleteAllAppData } from "@/lib/db";
import { PrivacyPolicyPanel } from "@/components/views/PrivacyPolicyPanel";
import { ConfirmModal } from "@/components/views/ConfirmModal";
import { getAllBindings } from "@/lib/keybindings";
import type { ThemeManifest } from "@/lib/theme";

function clampLogSizeMb(value: number): number {
    return Math.max(1, Math.min(250, value));
}

function clampLogAgeDays(value: number): number {
    return Math.max(1, Math.min(365, value));
}

function clampMaxResultRows(value: number): number {
    return Math.max(100, Math.min(10000, value));
}

function clampQueryTimeoutMs(value: number): number {
    return Math.max(5000, Math.min(300000, value));
}

export function SettingsPage() {
    const profiles = useProfilesStore((s) => s.profiles);
    const globalPrefs = useProfilesStore((s) => s.globalPreferences);
    const setGlobalPrefs = useProfilesStore((s) => s.setGlobalPreferences);
    const clearOutputEntries = useAppStore((s) => s.clearOutputEntries);
    const appVersion = useAppVersion();

    type UpdateState =
        | "idle"
        | "checking"
        | "available"
        | "downloading"
        | "up-to-date"
        | "error";
    type Update = Awaited<ReturnType<typeof check>>;

    const [updateState, setUpdateState] = useState<UpdateState>("idle");
    const [updateVersion, setUpdateVersion] = useState<string | null>(null);
    const [pendingUpdate, setPendingUpdate] = useState<Update>(null);
    const [isClearingLogs, setIsClearingLogs] = useState(false);
    const [isDeletingData, setIsDeletingData] = useState(false);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const [kbSearch, setKbSearch] = useState("");

    const allBindings = useMemo(() => getAllBindings(), []);
    const filteredBindings = useMemo(() => {
        const q = kbSearch.trim().toLowerCase();
        if (!q) return allBindings;
        return allBindings.filter(
            (b) =>
                b.command.toLowerCase().includes(q) ||
                b.key.toLowerCase().includes(q) ||
                (b.when ?? "").toLowerCase().includes(q),
        );
    }, [allBindings, kbSearch]);

    const customTheme = globalPrefs.customTheme as ThemeManifest | undefined;

    const handleLoadCustomTheme = async () => {
        const selected = await open({
            title: "Select theme JSON file",
            filters: [{ name: "JSON", extensions: ["json"] }],
            multiple: false,
            directory: false,
        });
        if (!selected) return;
        const path = typeof selected === "string" ? selected : selected[0];
        if (!path) return;
        try {
            const text = await readTextFile(path);
            const manifest = JSON.parse(text) as ThemeManifest;
            if (!manifest.type || !manifest.colors) {
                notifyError("Invalid Theme File", "The selected file is not a valid WGS theme manifest.");
                return;
            }
            const name = (manifest as ThemeManifest & { name?: string }).name;
            setGlobalPrefs({ theme: "custom" as GlobalPreferences["theme"], customTheme: manifest as unknown as Record<string, unknown> });
            notifySuccess("Theme Loaded", `"${name ?? path}" applied.`);
        } catch (e) {
            notifyError("Theme Load Failed", String(e));
        }
    };

    const handleResetTheme = () => {
        setGlobalPrefs({ theme: "system", customTheme: undefined });
    };

    const allowUpdateChecks = globalPrefs.allowUpdateChecks ?? true;
    const blockAiRequests = globalPrefs.blockAiRequests ?? false;
    const maxLogSizeMb = globalPrefs.maxLogSizeMb ?? 10;
    const maxLogAgeDays = globalPrefs.maxLogAgeDays ?? 14;
    const maxResultRows = globalPrefs.maxResultRows ?? 1000;
    const queryTimeoutMs = globalPrefs.queryTimeoutMs ?? 30000;

    const handleCheckForUpdates = async () => {
        if (!allowUpdateChecks) {
            notify({ severity: "info", title: "Update Checks Disabled", detail: "Enable update checks in Privacy settings if you want to contact the updater service.", toast: true });
            return;
        }

        setUpdateState("checking");
        try {
            const update = await check();
            if (update) {
                setUpdateVersion(update.version ?? null);
                setPendingUpdate(update);
                setUpdateState("available");
            } else {
                setPendingUpdate(null);
                setUpdateState("up-to-date");
            }
        } catch (e) {
            setUpdateState("error");
            notifyError("Update check failed", String(e));
        }
    };

    const handleInstallUpdate = async () => {
        if (!pendingUpdate) return;
        setUpdateState("downloading");
        try {
            await pendingUpdate.downloadAndInstall();
            await relaunch();
        } catch (e) {
            setUpdateState("error");
            notifyError("Update failed", String(e));
        }
    };

    const handleClearAllLogs = async () => {
        setIsClearingLogs(true);
        try {
            await clearAllLogs();
            clearOutputEntries();
            notifySuccess("Logs Cleared", "Profile logs, AI logs, and Output entries were cleared.");
        } catch (e) {
            notifyError("Failed to clear logs", String(e));
        } finally {
            setIsClearingLogs(false);
        }
    };

    const handleDeleteAllData = async () => {
        setShowDeleteConfirm(false);
        setIsDeletingData(true);
        try {
            const activeProfiles = profiles.filter(
                (profile) =>
                    profile.connectionStatus === "connected" ||
                    profile.connectionStatus === "connecting",
            );
            await Promise.allSettled(
                activeProfiles.map((profile) => dbDisconnect(profile.id)),
            );
            await deleteAllAppData();
            clearOutputEntries();
            window.location.reload();
        } catch (e) {
            notifyError("Delete all data failed", String(e));
            setIsDeletingData(false);
        }
    };

    return (
        <div className="flex h-full w-full flex-col overflow-hidden bg-background text-sm text-foreground">
            <div className="h-10 shrink-0 border-b bg-muted/20 px-4 flex items-center">
                <h2 className="font-semibold tracking-wide">Settings</h2>
            </div>

            <div className="mx-auto flex w-full max-w-3xl flex-col gap-10 overflow-y-auto p-6">
                <section className="flex flex-col gap-4">
                    <div className="border-b pb-2">
                        <h3 className="text-lg font-medium">Appearance</h3>
                        <p className="text-xs text-muted-foreground">
                            Manage the editor UI visual theme.
                        </p>
                    </div>

                    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                        {(["light", "dark", "system"] as const).map((themeOpt) => (
                            <button
                                key={themeOpt}
                                onClick={() =>
                                    setGlobalPrefs({ theme: themeOpt })
                                }
                                className={cn(
                                    "flex flex-col items-center justify-center rounded-lg border-2 p-4 transition-all hover:bg-muted/50",
                                    globalPrefs.theme === themeOpt
                                        ? "border-primary bg-primary/5"
                                        : "border-border/50",
                                )}
                            >
                                {themeOpt === "light" && (
                                    <Sun className="mb-3 h-8 w-8 text-primary" />
                                )}
                                {themeOpt === "dark" && (
                                    <Moon className="mb-3 h-8 w-8 text-primary" />
                                )}
                                {themeOpt === "system" && (
                                    <Monitor className="mb-3 h-8 w-8 text-primary" />
                                )}
                                <span className="font-medium capitalize">{themeOpt}</span>
                            </button>
                        ))}
                    </div>

                    {/* Custom theme loader */}
                    <div className="flex items-center justify-between rounded-lg border bg-muted/20 p-4">
                        <div className="flex items-center gap-3">
                            <Palette className="h-5 w-5 text-muted-foreground" />
                            <div>
                                <span className="font-medium">Custom Theme</span>
                                <p className="mt-0.5 text-[11px] text-muted-foreground">
                                    Load a JSON theme manifest file to override the built-in theme.{" "}
                                    {customTheme && (
                                        <span className="text-primary">
                                            Active: {(customTheme as ThemeManifest & { name?: string }).name ?? "custom"}
                                        </span>
                                    )}
                                </p>
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            {customTheme && (
                                <button
                                    onClick={handleResetTheme}
                                    className="rounded border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                                >
                                    Reset
                                </button>
                            )}
                            <button
                                onClick={handleLoadCustomTheme}
                                className="rounded border px-3 py-1.5 text-xs font-medium hover:bg-accent transition-colors"
                            >
                                Load theme…
                            </button>
                        </div>
                    </div>
                </section>

                <section className="flex flex-col gap-4">
                    <div className="border-b pb-2">
                        <h3 className="text-lg font-medium">Editor</h3>
                        <p className="text-xs text-muted-foreground">
                            Configure text editing behaviors.
                        </p>
                    </div>

                    <div className="flex items-center justify-between rounded-lg border bg-muted/20 p-4">
                        <div className="flex items-center gap-3">
                            <Type className="h-5 w-5 text-muted-foreground" />
                            <div>
                                <span className="font-medium">Font Size</span>
                                <p className="mt-0.5 text-[11px] text-muted-foreground">
                                    Adjust the global editor typography scale.
                                </p>
                            </div>
                        </div>

                        <div className="flex items-center gap-2">
                            <span className="w-6 text-right font-mono text-sm">
                                {globalPrefs.fontSize || 13}px
                            </span>
                            <input
                                type="range"
                                min="10"
                                max="24"
                                step="1"
                                className="w-32 accent-primary"
                                value={globalPrefs.fontSize || 13}
                                onChange={(e) =>
                                    setGlobalPrefs({
                                        fontSize: parseInt(e.target.value, 10),
                                    })
                                }
                            />
                        </div>
                    </div>
                </section>

                {/* Keybindings viewer */}
                <section className="flex flex-col gap-4">
                    <div className="border-b pb-2">
                        <h3 className="text-lg font-medium">Keyboard Shortcuts</h3>
                        <p className="text-xs text-muted-foreground">
                            All active keybindings. Override by editing{" "}
                            <code className="rounded bg-muted px-1 py-0.5 text-[10px]">keybindings.json</code>.
                        </p>
                    </div>

                    <div className="relative">
                        <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                        <input
                            type="text"
                            placeholder="Search commands, keys…"
                            value={kbSearch}
                            onChange={(e) => setKbSearch(e.target.value)}
                            className="w-full rounded-md border bg-background py-1.5 pl-8 pr-3 text-xs outline-none focus:ring-1 focus:ring-primary"
                        />
                    </div>

                    <div className="rounded-md border overflow-hidden">
                        <table className="w-full text-xs">
                            <thead>
                                <tr className="border-b bg-muted/40 text-left text-muted-foreground">
                                    <th className="px-3 py-2 font-medium w-1/2">Command</th>
                                    <th className="px-3 py-2 font-medium w-1/4">Key</th>
                                    <th className="px-3 py-2 font-medium w-1/4">When</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredBindings.length === 0 ? (
                                    <tr>
                                        <td colSpan={3} className="px-3 py-6 text-center text-muted-foreground">
                                            No matching shortcuts.
                                        </td>
                                    </tr>
                                ) : (
                                    filteredBindings.map((b, i) => (
                                        <tr key={i} className="border-b last:border-0 hover:bg-muted/20 transition-colors">
                                            <td className="px-3 py-2 font-mono text-foreground/80">{b.command}</td>
                                            <td className="px-3 py-2">
                                                <kbd className="inline-flex items-center rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-foreground/70">
                                                    {b.key}
                                                </kbd>
                                            </td>
                                            <td className="px-3 py-2 text-muted-foreground font-mono text-[10px]">
                                                {b.when ?? <span className="opacity-40">—</span>}
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </section>

                <section className="flex flex-col gap-4">
                    <div className="border-b pb-2">
                        <h3 className="text-lg font-medium">Performance</h3>
                        <p className="text-xs text-muted-foreground">
                            Tune result rendering and query execution limits for slower hardware.
                        </p>
                    </div>

                    <div className="grid gap-4">
                        <div className="flex items-start justify-between gap-4 rounded-lg border bg-muted/20 p-4">
                            <div className="flex gap-3">
                                <Rows3 className="mt-0.5 h-5 w-5 text-primary" />
                                <div>
                                    <p className="font-medium">Max result rows</p>
                                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                                        Query results initially render up to this many rows.
                                        Use Load more in the results grid to reveal more rows on demand.
                                    </p>
                                </div>
                            </div>

                            <div className="flex items-center gap-2">
                                <input
                                    type="number"
                                    min="100"
                                    max="10000"
                                    step="100"
                                    className="w-24 rounded border bg-background px-2 py-1 text-right text-xs"
                                    value={maxResultRows}
                                    onChange={(e) => {
                                        const next = parseInt(e.target.value || "1000", 10);
                                        setGlobalPrefs({
                                            maxResultRows: clampMaxResultRows(
                                                Number.isFinite(next) ? next : 1000,
                                            ),
                                        });
                                    }}
                                />
                                <span className="text-xs text-muted-foreground">rows</span>
                            </div>
                        </div>

                        <div className="flex items-start justify-between gap-4 rounded-lg border bg-muted/20 p-4">
                            <div className="flex gap-3">
                                <TimerReset className="mt-0.5 h-5 w-5 text-primary" />
                                <div>
                                    <p className="font-medium">Query timeout</p>
                                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                                        Long-running queries are cancelled after this limit so the app
                                        does not appear frozen on older machines.
                                    </p>
                                </div>
                            </div>

                            <div className="flex items-center gap-2">
                                <input
                                    type="number"
                                    min="5"
                                    max="300"
                                    step="5"
                                    className="w-20 rounded border bg-background px-2 py-1 text-right text-xs"
                                    value={Math.round(queryTimeoutMs / 1000)}
                                    onChange={(e) => {
                                        const nextSeconds = parseInt(e.target.value || "30", 10);
                                        setGlobalPrefs({
                                            queryTimeoutMs: clampQueryTimeoutMs(
                                                (Number.isFinite(nextSeconds) ? nextSeconds : 30) * 1000,
                                            ),
                                        });
                                    }}
                                />
                                <span className="text-xs text-muted-foreground">sec</span>
                            </div>
                        </div>
                    </div>
                </section>

                <section className="flex flex-col gap-4">
                    <div className="border-b pb-2">
                        <h3 className="text-lg font-medium">Privacy</h3>
                        <p className="text-xs text-muted-foreground">
                            Control what data can leave this device and how long logs are kept.
                        </p>
                    </div>

                    <div className="grid gap-4">
                        <div className="flex items-start justify-between gap-4 rounded-lg border bg-muted/20 p-4">
                            <div className="flex gap-3">
                                <BrainCircuit className="mt-0.5 h-5 w-5 text-indigo-400" />
                                <div>
                                    <p className="font-medium">Do not send data to AI</p>
                                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                                        Blocks all AI provider requests, including AI Chat,
                                        Ask AI, and provider test calls.
                                    </p>
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={() =>
                                    setGlobalPrefs({
                                        blockAiRequests: !blockAiRequests,
                                    })
                                }
                                className={cn(
                                    "rounded border px-3 py-1.5 text-xs font-medium transition-colors",
                                    blockAiRequests
                                        ? "border-red-500/40 bg-red-500/10 text-red-300"
                                        : "hover:bg-accent",
                                )}
                            >
                                {blockAiRequests ? "Enabled" : "Disabled"}
                            </button>
                        </div>

                        <div className="flex items-start justify-between gap-4 rounded-lg border bg-muted/20 p-4">
                            <div className="flex gap-3">
                                <Shield className="mt-0.5 h-5 w-5 text-primary" />
                                <div>
                                    <p className="font-medium">Allow update checks</p>
                                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                                        When enabled, checking for updates sends the current
                                        version and platform target to the updater service.
                                    </p>
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={() =>
                                    setGlobalPrefs({
                                        allowUpdateChecks: !allowUpdateChecks,
                                    })
                                }
                                className={cn(
                                    "rounded border px-3 py-1.5 text-xs font-medium transition-colors",
                                    allowUpdateChecks
                                        ? "border-primary/40 bg-primary/10 text-primary"
                                        : "hover:bg-accent",
                                )}
                            >
                                {allowUpdateChecks ? "Enabled" : "Disabled"}
                            </button>
                        </div>

                        <div className="rounded-lg border bg-muted/20 p-4">
                            <div className="flex items-start justify-between gap-4">
                                <div className="flex gap-3">
                                    <HardDrive className="mt-0.5 h-5 w-5 text-muted-foreground" />
                                    <div>
                                        <p className="font-medium">Log retention</p>
                                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                                            Per-profile logs are trimmed by size and old log files
                                            are purged automatically after the configured age.
                                        </p>
                                    </div>
                                </div>

                                <div className="grid gap-2">
                                    <div className="flex items-center justify-end gap-2">
                                        <input
                                            type="number"
                                            min="1"
                                            max="250"
                                            className="w-20 rounded border bg-background px-2 py-1 text-right text-xs"
                                            value={maxLogSizeMb}
                                            onChange={(e) => {
                                                const next = parseInt(e.target.value || "10", 10);
                                                setGlobalPrefs({
                                                    maxLogSizeMb: clampLogSizeMb(
                                                        Number.isFinite(next) ? next : 10,
                                                    ),
                                                });
                                            }}
                                        />
                                        <span className="text-xs text-muted-foreground">MB</span>
                                    </div>
                                    <div className="flex items-center justify-end gap-2">
                                        <input
                                            type="number"
                                            min="1"
                                            max="365"
                                            className="w-20 rounded border bg-background px-2 py-1 text-right text-xs"
                                            value={maxLogAgeDays}
                                            onChange={(e) => {
                                                const next = parseInt(e.target.value || "14", 10);
                                                setGlobalPrefs({
                                                    maxLogAgeDays: clampLogAgeDays(
                                                        Number.isFinite(next) ? next : 14,
                                                    ),
                                                });
                                            }}
                                        />
                                        <span className="text-xs text-muted-foreground">days</span>
                                    </div>
                                </div>
                            </div>

                            <div className="mt-4 flex flex-wrap gap-2">
                                <button
                                    type="button"
                                    onClick={handleClearAllLogs}
                                    disabled={isClearingLogs || isDeletingData}
                                    className="inline-flex items-center gap-1.5 rounded border px-3 py-1.5 text-xs hover:bg-accent transition-colors disabled:opacity-50"
                                >
                                    <Trash2 className="h-3.5 w-3.5" />
                                    {isClearingLogs ? "Clearing logs..." : "Clear all logs"}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setShowDeleteConfirm(true)}
                                    disabled={isDeletingData}
                                    className="inline-flex items-center gap-1.5 rounded border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs text-red-300 hover:bg-red-500/15 transition-colors disabled:opacity-50"
                                >
                                    <Trash2 className="h-3.5 w-3.5" />
                                    {isDeletingData ? "Deleting..." : "Delete all data"}
                                </button>
                            </div>
                        </div>

                        <PrivacyPolicyPanel />
                    </div>
                </section>

                <section className="flex flex-col gap-4">
                    <div className="border-b pb-2">
                        <h3 className="text-lg font-medium">About</h3>
                        <p className="text-xs text-muted-foreground">
                            Version information and updates.
                        </p>
                    </div>

                    <div className="flex items-center justify-between rounded-lg border bg-muted/20 p-4">
                        <div>
                            <p className="font-medium">WorkGrid Studio</p>
                            <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                                v{appVersion}
                            </p>
                        </div>

                        <div className="flex items-center gap-3">
                            {updateState === "up-to-date" && (
                                <span className="flex items-center gap-1.5 text-xs text-green-500">
                                    <CheckCircle2 className="h-4 w-4" />
                                    Up to date
                                </span>
                            )}
                            {updateState === "error" && (
                                <span className="flex items-center gap-1.5 text-xs text-destructive">
                                    <AlertCircle className="h-4 w-4" />
                                    Check failed
                                </span>
                            )}
                            {updateState === "available" && (
                                <span className="text-xs text-yellow-500">
                                    v{updateVersion} available
                                </span>
                            )}

                            {(updateState === "idle" ||
                                updateState === "up-to-date" ||
                                updateState === "error") && (
                                    <button
                                        onClick={handleCheckForUpdates}
                                        disabled={!allowUpdateChecks}
                                        className="flex items-center gap-1.5 rounded border bg-card px-3 py-1.5 text-xs transition-colors hover:bg-accent disabled:opacity-50"
                                    >
                                        <RefreshCw className="h-3.5 w-3.5" />
                                        Check for Updates
                                    </button>
                                )}
                            {updateState === "checking" && (
                                <button
                                    disabled
                                    className="flex items-center gap-1.5 rounded border bg-card px-3 py-1.5 text-xs text-muted-foreground"
                                >
                                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                                    Checking...
                                </button>
                            )}
                            {updateState === "available" && (
                                <button
                                    onClick={handleInstallUpdate}
                                    className="flex items-center gap-1.5 rounded bg-primary px-3 py-1.5 text-xs text-primary-foreground transition-colors hover:bg-primary/90"
                                >
                                    <Download className="h-3.5 w-3.5" />
                                    Install Update
                                </button>
                            )}
                            {updateState === "downloading" && (
                                <button
                                    disabled
                                    className="flex items-center gap-1.5 rounded bg-primary px-3 py-1.5 text-xs text-primary-foreground opacity-70"
                                >
                                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                                    Installing...
                                </button>
                            )}
                        </div>
                    </div>
                    {!allowUpdateChecks && (
                        <p className="text-[11px] text-muted-foreground">
                            Update checks are disabled in Privacy settings, so no version
                            data is sent to the updater service.
                        </p>
                    )}

                    <div className="flex flex-wrap items-center gap-2 text-[11px]">
                        <button
                            type="button"
                            onClick={() => openUrl("https://github.com/eru123/workgrid-studio")}
                            className="inline-flex items-center gap-1 rounded border bg-card px-2.5 py-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                        >
                            GitHub
                            <ExternalLink className="h-3 w-3" />
                        </button>
                        <button
                            type="button"
                            onClick={() => openUrl("https://github.com/eru123/workgrid-studio/blob/main/CHANGELOG.md")}
                            className="inline-flex items-center gap-1 rounded border bg-card px-2.5 py-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                        >
                            Changelog
                            <ExternalLink className="h-3 w-3" />
                        </button>
                        <button
                            type="button"
                            onClick={() => openUrl("https://paypal.me/ja1030")}
                            className="inline-flex items-center gap-1 rounded border bg-card px-2.5 py-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                        >
                            Support
                            <ExternalLink className="h-3 w-3" />
                        </button>
                    </div>

                    <p className="text-[11px] text-muted-foreground/60">
                        WorkGrid Studio is free and open source.{" "}
                        <button
                            onClick={() => openUrl("https://paypal.me/ja1030")}
                            className="inline-flex items-center gap-1 hover:text-muted-foreground transition-colors underline-offset-2 hover:underline"
                        >
                            <Heart className="h-3 w-3" />
                            Support the project
                        </button>
                    </p>
                </section>
            </div>

            {showDeleteConfirm && (
                <ConfirmModal
                    title="Delete all local data?"
                    message={
                        "This removes profiles, encrypted secrets, logs, cached schema, query history, tasks, AI logs, and local settings from ~/.workgrid-studio.\n\nThis action cannot be undone."
                    }
                    confirmLabel="Delete Everything"
                    danger
                    onCancel={() => setShowDeleteConfirm(false)}
                    onConfirm={handleDeleteAllData}
                />
            )}
        </div>
    );
}
