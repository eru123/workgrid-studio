import { useState, useEffect, useRef, useCallback } from "react";
import { useLayoutStore, ActivityView } from "@/state/layoutStore";
import { useProfilesStore } from "@/state/profilesStore";
import { Sash } from "./Sash";
import { EditorNode } from "./EditorNode";
import { ExplorerTree } from "@/components/views/ExplorerTree";
import { readProfileLog, clearProfileLog } from "@/lib/db";
import { cn } from "@/lib/utils/cn";
import {
    FolderTree,
    CheckSquare,
    PanelBottom,
    Sidebar,
    Server,
    Trash2,
    RefreshCw,
    Bot
} from "lucide-react";
import { ServersSidebar } from "@/components/views/ServersSidebar";

const activityItems: { id: ActivityView; icon: any; label: string }[] = [
    { id: "explorer", icon: FolderTree, label: "Explorer" },
    { id: "servers", icon: Server, label: "Servers" },
    { id: "models", icon: Bot, label: "AI Models" },
    { id: "tasks", icon: CheckSquare, label: "Tasks" },
];

export function Workbench() {
    const {
        activityBarWidth,
        primarySidebarWidth,
        isPrimarySidebarVisible,
        isBottomPanelVisible,
        bottomPanelHeight,
        activeView,
        editorTree,
        setActiveView,
        adjustSidebarWidth,
        adjustPanelHeight,
        toggleSidebar,
        togglePanel,
        openTab,
    } = useLayoutStore();

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.ctrlKey || e.metaKey) {
                if (e.key === '`') {
                    e.preventDefault();
                    togglePanel();
                } else if (e.key.toLowerCase() === 'b') {
                    e.preventDefault();
                    toggleSidebar();
                }
            }
        };
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [togglePanel, toggleSidebar]);

    return (

        <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
            {/* Activity Bar */}
            <div
                className="flex-shrink-0 bg-muted/20 border-r flex flex-col items-center py-2 justify-between"
                style={{ width: activityBarWidth }}
            >
                <div className="flex flex-col items-center gap-1">
                    {activityItems.map((item) => {
                        const Icon = item.icon;
                        const isActive = activeView === item.id && isPrimarySidebarVisible;
                        return (
                            <button
                                key={item.id}
                                onClick={() => setActiveView(item.id)}
                                className={cn(
                                    "w-10 h-10 flex items-center justify-center rounded-md transition-colors relative",
                                    isActive
                                        ? "text-foreground bg-accent"
                                        : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
                                )}
                                title={item.label}
                            >
                                {isActive && (
                                    <div className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-foreground rounded-r" />
                                )}
                                <Icon className="w-5 h-5" />
                            </button>
                        );
                    })}
                </div>

                {/* Bottom icons */}
                <div className="flex flex-col items-center gap-1 mb-2">
                    <button
                        onClick={toggleSidebar}
                        className="w-10 h-10 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
                        title="Toggle Sidebar (Ctrl+B)"
                    >
                        <Sidebar className="w-5 h-5" />
                    </button>
                    <button
                        onClick={togglePanel}
                        className="w-10 h-10 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
                        title="Toggle Panel (Ctrl+`)"
                    >
                        <PanelBottom className="w-5 h-5" />
                    </button>
                </div>
            </div>

            {/* Primary Sidebar */}
            {isPrimarySidebarVisible && (
                <div
                    className="relative bg-muted/10 border-r flex flex-col"
                    style={{ width: primarySidebarWidth }}
                >
                    {activeView !== "servers" && (
                        <div className="h-9 px-4 flex items-center border-b shrink-0 bg-background/50">
                            <span className="font-semibold text-xs uppercase tracking-wider">
                                {activityItems.find((i) => i.id === activeView)?.label ?? "Explorer"}
                            </span>
                        </div>
                    )}
                    <div className="flex-1 overflow-auto">
                        {activeView === "explorer" && (
                            <ExplorerTree />
                        )}
                        {activeView === "servers" && (
                            <ServersSidebar />
                        )}
                        {activeView === "models" && (
                            <div className="flex flex-col gap-2 p-2">
                                <p className="text-xs text-muted-foreground mb-1">AI Providers</p>
                                <button
                                    onClick={() => openTab({ title: "AI Models", type: "models" })}
                                    className="w-full text-left text-sm px-3 py-2 rounded border bg-card hover:bg-accent transition-colors"
                                >
                                    Manage Models →
                                </button>
                            </div>
                        )}
                        {activeView === "tasks" && (
                            <div className="flex flex-col gap-2 p-2">
                                <p className="text-xs text-muted-foreground mb-1">Task tracker</p>
                                <button
                                    onClick={() => openTab({ title: "Tasks", type: "tasks" })}
                                    className="w-full text-left text-sm px-3 py-2 rounded border bg-card hover:bg-accent transition-colors"
                                >
                                    Open Tasks →
                                </button>
                            </div>
                        )}
                    </div>
                    <Sash
                        direction="vertical"
                        className="right-0 translate-x-0.5"
                        onDrag={adjustSidebarWidth}
                    />
                </div>
            )}

            {/* Main Content Area */}
            <div className="flex-1 flex flex-col relative min-w-0">
                {/* Editor Group */}
                <div className="flex-1 flex overflow-hidden">
                    <div className="flex-1 relative p-0.5">
                        <EditorNode tree={editorTree} />
                    </div>
                </div>

                {/* Bottom Panel */}
                {isBottomPanelVisible && (
                    <div
                        className="relative bg-muted/10 border-t flex flex-col"
                        style={{ height: bottomPanelHeight }}
                    >
                        <Sash
                            direction="horizontal"
                            className="top-0 -translate-y-0.5"
                            onDrag={(delta) => adjustPanelHeight(-delta)}
                        />
                        <BottomPanel />
                    </div>
                )}

                {/* Status Bar */}
                <div className="h-6 bg-primary text-primary-foreground flex items-center px-4 text-xs gap-4 shrink-0">
                    <span>WorkGrid Studio</span>
                    <span className="ml-auto opacity-70">v0.1.0</span>
                </div>
            </div>
        </div>
    );
}

// ─── Bottom Panel ───────────────────────────────────────────────────

type PanelTab = "output" | "problems" | "logs";
type LogFilter = "mysql" | "error";

interface ProblemItem {
    id: string;
    severity: "error" | "warning" | "info";
    timestamp: string;
    profileName: string;
    profileColor: string;
    message: string;
}

function parseProblems(
    profileId: string,
    profileName: string,
    profileColor: string,
    raw: string
): ProblemItem[] {
    if (!raw.trim()) return [];
    return raw
        .split("\n")
        .filter((line) => line.trim())
        .map((line, i) => {
            // Format: [2026-02-28 05:00:09] ERROR: Connection failed ...
            const tsMatch = line.match(/^\[([^\]]+)\]\s*/);
            const timestamp = tsMatch ? tsMatch[1] : "";
            const rest = tsMatch ? line.slice(tsMatch[0].length) : line;

            let severity: ProblemItem["severity"] = "error";
            let message = rest;

            if (rest.startsWith("ERROR:")) {
                severity = "error";
                message = rest.slice(7).trim();
            } else if (rest.startsWith("WARNING:")) {
                severity = "warning";
                message = rest.slice(9).trim();
            } else if (rest.startsWith("INFO:")) {
                severity = "info";
                message = rest.slice(6).trim();
            }

            // Classify specific errors
            if (message.includes("Connection failed")) severity = "error";
            if (message.includes("Query error")) severity = "error";
            if (message.includes("Lock error")) severity = "warning";
            if (message.includes("Not connected")) severity = "warning";

            return {
                id: `${profileId}-${i}`,
                severity,
                timestamp,
                profileName,
                profileColor,
                message,
            };
        });
}

function BottomPanel() {
    const profiles = useProfilesStore((s) => s.profiles);
    const connectedProfiles = profiles.filter((p) => p.connectionStatus === "connected");

    const [activeTab, setActiveTab] = useState<PanelTab>("output");
    const [logFilter, setLogFilter] = useState<LogFilter>("mysql");
    const [selectedProfileId, setSelectedProfileId] = useState<string>("");
    const [logContent, setLogContent] = useState<string>("");
    const [problems, setProblems] = useState<ProblemItem[]>([]);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const scrollRef = useRef<HTMLDivElement>(null);

    // Auto-select first connected profile
    useEffect(() => {
        if (!selectedProfileId && connectedProfiles.length > 0) {
            setSelectedProfileId(connectedProfiles[0].id);
        }
        if (selectedProfileId && !connectedProfiles.find((p) => p.id === selectedProfileId)) {
            setSelectedProfileId(connectedProfiles[0]?.id ?? "");
        }
    }, [connectedProfiles, selectedProfileId]);

    // ── Logs fetching ───────────────────────────────────────────────
    const fetchLogs = useCallback(async () => {
        if (!selectedProfileId || activeTab !== "logs") return;
        try {
            const content = await readProfileLog(selectedProfileId, logFilter);
            setLogContent(content);
        } catch (e) {
            setLogContent(`Error reading logs: ${e}`);
        }
    }, [selectedProfileId, logFilter, activeTab]);

    useEffect(() => {
        fetchLogs();
        if (activeTab !== "logs") return;
        const interval = setInterval(fetchLogs, 2000);
        return () => clearInterval(interval);
    }, [fetchLogs, activeTab]);

    // ── Problems fetching ───────────────────────────────────────────
    const fetchProblems = useCallback(async () => {
        if (connectedProfiles.length === 0) {
            setProblems([]);
            return;
        }
        const allProblems: ProblemItem[] = [];
        for (const p of connectedProfiles) {
            try {
                const raw = await readProfileLog(p.id, "error");
                const parsed = parseProblems(p.id, p.name, p.color, raw);
                allProblems.push(...parsed);
            } catch {
                // Skip profiles with read errors
            }
        }
        // Also check profiles with error status that aren't connected
        for (const p of profiles.filter((p) => p.connectionStatus === "error")) {
            allProblems.push({
                id: `status-${p.id}`,
                severity: "error",
                timestamp: p.lastConnectedAt
                    ? new Date(p.lastConnectedAt).toLocaleString()
                    : "Unknown",
                profileName: p.name,
                profileColor: p.color,
                message: `Connection to ${p.host}:${p.port} is in error state`,
            });
        }
        // Sort newest first
        allProblems.reverse();
        setProblems(allProblems);
    }, [connectedProfiles, profiles]);

    useEffect(() => {
        fetchProblems();
        // Refresh problems every 3 seconds when tab is active or in background
        const interval = setInterval(fetchProblems, 3000);
        return () => clearInterval(interval);
    }, [fetchProblems]);

    // Auto-scroll to bottom when log content changes
    useEffect(() => {
        if (scrollRef.current && activeTab === "logs") {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [logContent, activeTab]);

    const handleRefresh = async () => {
        setIsRefreshing(true);
        if (activeTab === "logs") await fetchLogs();
        if (activeTab === "problems") await fetchProblems();
        setTimeout(() => setIsRefreshing(false), 300);
    };

    const handleClear = async () => {
        if (activeTab === "logs") {
            if (!selectedProfileId) return;
            try {
                await clearProfileLog(selectedProfileId, logFilter);
                setLogContent("");
            } catch (e) {
                console.error("Clear log error:", e);
            }
        } else if (activeTab === "problems") {
            // Clear all error logs for all connected profiles
            for (const p of connectedProfiles) {
                try {
                    await clearProfileLog(p.id, "error");
                } catch {
                    // ignore
                }
            }
            setProblems([]);
        }
    };

    const errorCount = problems.filter((p) => p.severity === "error").length;
    const warningCount = problems.filter((p) => p.severity === "warning").length;

    return (
        <>
            {/* Tab bar */}
            <div className="h-8 border-b flex items-center px-2 gap-1 shrink-0">
                {/* Output tab */}
                <button
                    onClick={() => setActiveTab("output")}
                    className={cn(
                        "px-3 h-full text-xs transition-colors",
                        activeTab === "output"
                            ? "font-semibold text-foreground border-b-2 border-primary"
                            : "text-muted-foreground hover:text-foreground"
                    )}
                >
                    Output
                </button>

                {/* Problems tab with badge */}
                <button
                    onClick={() => setActiveTab("problems")}
                    className={cn(
                        "px-3 h-full text-xs transition-colors flex items-center gap-1.5",
                        activeTab === "problems"
                            ? "font-semibold text-foreground border-b-2 border-primary"
                            : "text-muted-foreground hover:text-foreground"
                    )}
                >
                    Problems
                    {(errorCount > 0 || warningCount > 0) && (
                        <span className="flex items-center gap-1">
                            {errorCount > 0 && (
                                <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-red-500/20 text-red-400">
                                    {errorCount}
                                </span>
                            )}
                            {warningCount > 0 && (
                                <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-yellow-500/20 text-yellow-400">
                                    {warningCount}
                                </span>
                            )}
                        </span>
                    )}
                </button>

                {/* Logs tab */}
                <button
                    onClick={() => setActiveTab("logs")}
                    className={cn(
                        "px-3 h-full text-xs transition-colors",
                        activeTab === "logs"
                            ? "font-semibold text-foreground border-b-2 border-primary"
                            : "text-muted-foreground hover:text-foreground"
                    )}
                >
                    Logs
                </button>

                {/* Right-side controls */}
                {(activeTab === "logs" || activeTab === "problems") && (
                    <div className="ml-auto flex items-center gap-2">
                        {/* Logs-specific: Profile selector */}
                        {activeTab === "logs" && connectedProfiles.length > 0 && (
                            <select
                                value={selectedProfileId}
                                onChange={(e) => setSelectedProfileId(e.target.value)}
                                className="h-6 text-[11px] rounded border bg-secondary/50 text-foreground px-1.5 outline-none"
                            >
                                {connectedProfiles.map((p) => (
                                    <option key={p.id} value={p.id}>{p.name}</option>
                                ))}
                            </select>
                        )}

                        {/* Logs-specific: Log type filter */}
                        {activeTab === "logs" && (
                            <select
                                value={logFilter}
                                onChange={(e) => setLogFilter(e.target.value as LogFilter)}
                                className="h-6 text-[11px] rounded border bg-secondary/50 text-foreground px-1.5 outline-none"
                            >
                                <option value="mysql">Query Log</option>
                                <option value="error">Error Log</option>
                            </select>
                        )}

                        {/* Refresh */}
                        <button
                            onClick={handleRefresh}
                            className="p-1 text-muted-foreground hover:text-foreground transition-colors"
                            title="Refresh"
                        >
                            <RefreshCw className={cn("w-3.5 h-3.5", isRefreshing && "animate-spin")} />
                        </button>

                        {/* Clear */}
                        <button
                            onClick={handleClear}
                            className="p-1 text-muted-foreground hover:text-red-400 transition-colors"
                            title={activeTab === "problems" ? "Clear all problems" : "Clear log"}
                        >
                            <Trash2 className="w-3.5 h-3.5" />
                        </button>
                    </div>
                )}
            </div>

            {/* Panel content */}
            <div ref={scrollRef} className="flex-1 overflow-auto">
                {/* ── Output ─────────────────────────────────────────── */}
                {activeTab === "output" && (
                    <div className="p-3 font-mono text-xs leading-5 text-muted-foreground">
                        WorkGrid Studio ready.
                    </div>
                )}

                {/* ── Problems ───────────────────────────────────────── */}
                {activeTab === "problems" && (
                    <div className="text-xs">
                        {problems.length === 0 ? (
                            <div className="p-3 text-muted-foreground font-mono">
                                No problems detected.
                            </div>
                        ) : (
                            <div className="divide-y divide-border/40">
                                {problems.map((item) => (
                                    <div
                                        key={item.id}
                                        className={cn(
                                            "flex items-start gap-2 px-3 py-1.5 hover:bg-accent/30 transition-colors",
                                            item.severity === "error" && "bg-red-500/[0.03]",
                                            item.severity === "warning" && "bg-yellow-500/[0.03]"
                                        )}
                                    >
                                        {/* Severity icon */}
                                        <span className="mt-0.5 shrink-0">
                                            {item.severity === "error" && (
                                                <span className="inline-block w-3.5 h-3.5 rounded-full bg-red-500/20 text-red-400 text-center leading-[14px] text-[9px] font-bold">✕</span>
                                            )}
                                            {item.severity === "warning" && (
                                                <span className="inline-block w-3.5 h-3.5 rounded-full bg-yellow-500/20 text-yellow-400 text-center leading-[14px] text-[9px] font-bold">!</span>
                                            )}
                                            {item.severity === "info" && (
                                                <span className="inline-block w-3.5 h-3.5 rounded-full bg-blue-500/20 text-blue-400 text-center leading-[14px] text-[9px] font-bold">i</span>
                                            )}
                                        </span>

                                        {/* Message */}
                                        <span className="flex-1 font-mono text-foreground/80 break-all leading-relaxed">
                                            {item.message}
                                        </span>

                                        {/* Profile badge */}
                                        <span className="shrink-0 flex items-center gap-1 ml-2">
                                            <span
                                                className="w-2 h-2 rounded-full shrink-0"
                                                style={{ backgroundColor: item.profileColor }}
                                            />
                                            <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                                                {item.profileName}
                                            </span>
                                        </span>

                                        {/* Timestamp */}
                                        <span className="shrink-0 text-[10px] text-muted-foreground/50 font-mono whitespace-nowrap">
                                            {item.timestamp}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {/* ── Logs ───────────────────────────────────────────── */}
                {activeTab === "logs" && (
                    <div className="p-3 font-mono text-xs leading-5">
                        {connectedProfiles.length === 0 ? (
                            <span className="text-muted-foreground">
                                Connect to a database to view logs.
                            </span>
                        ) : logContent ? (
                            <pre className="whitespace-pre-wrap break-all text-muted-foreground">
                                {logContent.split("\n").map((line, i) => (
                                    <div
                                        key={i}
                                        className={cn(
                                            line.includes("ERROR") && "text-red-400",
                                            line.includes("INFO") && "text-blue-400/70",
                                            line.includes("QUERY") && !line.includes("ERROR") && "text-foreground/80"
                                        )}
                                    >
                                        {line}
                                    </div>
                                ))}
                            </pre>
                        ) : (
                            <span className="text-muted-foreground">
                                No log entries yet. Interact with the database to see queries here.
                            </span>
                        )}
                    </div>
                )}
            </div>
        </>
    );
}
