import { startTransition, useState, useEffect, useRef, useCallback, useMemo, lazy, Suspense } from "react";
import { useCommand } from "@/hooks/useCommand";
import { setContext, initKeybindings } from "@/lib/keybindings";
import { useLayoutStore, ActivityView } from "@/state/layoutStore";
import { useProfilesStore } from "@/state/profilesStore";
import { useSchemaStore } from "@/state/schemaStore";
import { useModelsStore } from "@/state/modelsStore";
import { useTasksStore } from "@/state/tasksStore";
import { useSavedQueriesStore } from "@/state/savedQueriesStore";
import { useAppVersion } from "@/hooks/useAppVersion";
import { Sash } from "./Sash";
import { EditorNode } from "./EditorNode";
import { ExplorerTree } from "@/components/views/ExplorerTree";
import { readProfileLog, clearProfileLog, getAiLogs, clearAiLogs, AiLogEntry, dbPing, dbQuery } from "@/lib/db";
import { getLogBuffer, subscribeToLogStream, type LogEntry as StreamLogEntry } from "@/lib/log";
import { cn } from "@/lib/utils/cn";
import { useProfileManager } from "@/hooks/useProfileManager";
import { useAppStore } from "@/state/appStore";
import { notifyError, notify } from "@/lib/notifications";
import {
  appendConnectionOutput,
  formatConnectionTarget,
  formatOutputError,
} from "@/lib/output";
import {
  FolderTree,
  CheckSquare,
  FileCode2,
  PanelBottom,
  Sidebar,
  Server,
  Bot,
  Sun,
  Moon,
  Monitor,
  Settings,
  Trash2,
  RefreshCw,
  Sparkles,
  Columns2,
  ArrowDownToLine,
  Heart,
  Loader2,
} from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { MenuBar } from "./MenuBar";
import { ServersSidebar } from "@/components/views/ServersSidebar";
import { AiChatSidebar } from "@/components/views/AiChatSidebar";
const SnippetsPanel = lazy(() => import("@/components/views/SnippetsPanel").then(m => ({ default: m.SnippetsPanel })));
import { KeyboardShortcutsOverlay } from "@/components/views/KeyboardShortcutsOverlay";
import { OnboardingFlow } from "@/components/views/OnboardingFlow";
import { check as checkForUpdate } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

const activityItems: { id: ActivityView; icon: any; label: string }[] = [
  { id: "explorer", icon: FolderTree, label: "Explorer" },
  { id: "servers", icon: Server, label: "Servers" },
  { id: "snippets", icon: FileCode2, label: "Snippets" },
  { id: "models", icon: Bot, label: "AI Models" },
  { id: "tasks", icon: CheckSquare, label: "Tasks" },
];

const RECONNECT_BASE_DELAY_MS = 2_000;
const RECONNECT_MAX_DELAY_MS = 60_000;
const RECONNECT_MAX_ATTEMPTS = 6;

export function Workbench() {
  const appVersion = useAppVersion();
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const profilesLoaded = useProfilesStore((s) => s._loaded);
  const profileCount = useProfilesStore((s) => s.profiles.length);
  const profiles = useProfilesStore((s) => s.profiles);
  const connectedProfiles = useSchemaStore((s) => s.connectedProfiles);
  const connectedCount = Object.keys(connectedProfiles).length;
  const connectingCount = profiles.filter(
    (profile) => profile.connectionStatus === "connecting",
  ).length;
  const tasks = useTasksStore((s) => s.tasks);
  const savedQueriesByProfile = useSavedQueriesStore((s) => s.byProfile);
  const loadAllSavedQueries = useSavedQueriesStore((s) => s.loadAllQueries);
  const readSavedQueryText = useSavedQueriesStore((s) => s.readQueryText);
  const recordSavedQueryRun = useSavedQueriesStore((s) => s.recordQueryRun);
  const pendingTaskCount = tasks.filter((t) => t.status !== "done").length;
  const activityBarWidth = useLayoutStore((s) => s.activityBarWidth);
  const primarySidebarWidth = useLayoutStore((s) => s.primarySidebarWidth);
  const isPrimarySidebarVisible = useLayoutStore(
    (s) => s.isPrimarySidebarVisible,
  );
  const isBottomPanelVisible = useLayoutStore((s) => s.isBottomPanelVisible);
  const isBottomPanelSplit = useLayoutStore((s) => s.isBottomPanelSplit);
  const bottomPanelSplitRatio = useLayoutStore((s) => s.bottomPanelSplitRatio);
  const setBottomPanelSplitRatio = useLayoutStore((s) => s.setBottomPanelSplitRatio);
  const bottomPanelHeight = useLayoutStore((s) => s.bottomPanelHeight);
  const activeView = useLayoutStore((s) => s.activeView);
  const editorTree = useLayoutStore((s) => s.editorTree);
  const activeLeafId = useLayoutStore((s) => s.activeLeafId);
  const setActiveView = useLayoutStore((s) => s.setActiveView);
  const saveLayoutPrefs = useLayoutStore((s) => s.saveLayoutPrefs);
  const adjustSidebarWidth = useLayoutStore((s) => s.adjustSidebarWidth);
  const adjustPanelHeight = useLayoutStore((s) => s.adjustPanelHeight);
  const toggleSidebar = useLayoutStore((s) => s.toggleSidebar);
  const togglePanel = useLayoutStore((s) => s.togglePanel);
  const openTab = useLayoutStore((s) => s.openTab);
  const isSecondarySidebarVisible = useLayoutStore((s) => s.isSecondarySidebarVisible);
  const secondarySidebarWidth = useLayoutStore((s) => s.secondarySidebarWidth);
  const toggleSecondarySidebar = useLayoutStore((s) => s.toggleSecondarySidebar);
  const adjustSecondarySidebarWidth = useLayoutStore((s) => s.adjustSecondarySidebarWidth);
  const bottomPanelRef = useRef<HTMLDivElement>(null);
  const hasLoadedLayoutRef = useRef(false);
  const reconnectAttemptsRef = useRef<Record<string, number>>({});
  const reconnectTimeoutsRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const scheduledQueryIntervalsRef = useRef<Record<string, ReturnType<typeof setInterval>>>({});
  const scheduledQueryRunningRef = useRef<Record<string, boolean>>({});

  const handleBottomPanelSplitDrag = useCallback(
    (delta: number) => {
      if (!bottomPanelRef.current) return;
      const width = bottomPanelRef.current.clientWidth;
      if (width === 0) return;
      const currentWidth = width * bottomPanelSplitRatio;
      const newWidth = currentWidth + delta;
      setBottomPanelSplitRatio(newWidth / width);
    },
    [bottomPanelSplitRatio, setBottomPanelSplitRatio]
  );
  
  const { handleConnect } = useProfileManager();

  const clearReconnectSchedule = useCallback((profileId: string, resetAttempt = true) => {
    const timeout = reconnectTimeoutsRef.current[profileId];
    if (timeout) {
      clearTimeout(timeout);
      delete reconnectTimeoutsRef.current[profileId];
    }
    if (resetAttempt) {
      delete reconnectAttemptsRef.current[profileId];
    }
  }, []);

  const scheduleReconnect = useCallback(function scheduleReconnect(profileId: string) {
    if (reconnectTimeoutsRef.current[profileId]) return;

    const profile = useProfilesStore.getState().profiles.find((entry) => entry.id === profileId);
    if (
      !profile ||
      profile.connectionStatus === "disconnected" ||
      profile.connectionStatus === "connecting" ||
      profile.unreadableSecrets?.password ||
      (profile.ssh &&
        (profile.unreadableSecrets?.sshPassword || profile.unreadableSecrets?.sshPassphrase)) ||
      (profile.type !== "mysql" && profile.type !== "mariadb")
    ) {
      clearReconnectSchedule(profileId, true);
      return;
    }

    const attempt = (reconnectAttemptsRef.current[profileId] ?? 0) + 1;
    if (attempt > RECONNECT_MAX_ATTEMPTS) {
      appendConnectionOutput(
        profile,
        "warning",
        `Auto-reconnect stopped for ${formatConnectionTarget(profile)} after ${RECONNECT_MAX_ATTEMPTS} failed attempts. Connect manually to try again.`,
      );
      clearReconnectSchedule(profileId, true);
      return;
    }

    reconnectAttemptsRef.current[profileId] = attempt;
    const delay = Math.min(
      RECONNECT_MAX_DELAY_MS,
      RECONNECT_BASE_DELAY_MS * 2 ** (attempt - 1),
    );

    appendConnectionOutput(
      profile,
      "warning",
      `Scheduling reconnect to ${formatConnectionTarget(profile)} in ${Math.ceil(delay / 1000)}s (attempt ${attempt}/${RECONNECT_MAX_ATTEMPTS}).`,
    );

    reconnectTimeoutsRef.current[profileId] = setTimeout(async () => {
      delete reconnectTimeoutsRef.current[profileId];

      const latestProfile = useProfilesStore.getState().profiles.find((entry) => entry.id === profileId);
      if (
        !latestProfile ||
        latestProfile.connectionStatus === "connected" ||
        latestProfile.connectionStatus === "disconnected"
      ) {
        clearReconnectSchedule(profileId, true);
        return;
      }

      await handleConnect(profileId, {
        silentFailureToast: true,
        reconnectAttempt: attempt,
      });

      const refreshedProfile = useProfilesStore.getState().profiles.find((entry) => entry.id === profileId);
      if (
        refreshedProfile &&
        refreshedProfile.connectionStatus !== "connected" &&
        refreshedProfile.connectionStatus !== "disconnected"
      ) {
        scheduleReconnect(profileId);
        return;
      }

      clearReconnectSchedule(profileId, true);
    }, delay);
  }, [clearReconnectSchedule, handleConnect]);

  // Theme Toggle Logic
  const globalPrefs = useProfilesStore((s) => s.globalPreferences);
  const setGlobalPrefs = useProfilesStore((s) => s.setGlobalPreferences);
  const theme = globalPrefs.theme || "system";

  const handleToggleTheme = () => {
    const next: "light" | "dark" | "system" =
      theme === "dark" ? "light" : theme === "light" ? "system" : "dark";
    setGlobalPrefs({ ...globalPrefs, theme: next });
  };

  // App Initialization
  useEffect(() => {
    let cancelled = false;

    void Promise.all([
      useProfilesStore.getState().loadProfiles(),
      useModelsStore.getState().loadProviders(),
      useTasksStore.getState().loadTasks(),
      useLayoutStore.getState().loadLayoutPrefs(),
    ]).finally(() => {
      if (!cancelled) {
        hasLoadedLayoutRef.current = true;
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!hasLoadedLayoutRef.current) return;
    saveLayoutPrefs();
  }, [activeLeafId, activeView, editorTree, saveLayoutPrefs]);

  // First-run onboarding: show wizard when no profiles exist after load
  useEffect(() => {
    if (profilesLoaded && profileCount === 0) {
      setShowOnboarding(true);
    }
  }, [profilesLoaded, profileCount]);

  // Startup background update check
  useEffect(() => {
    const { allowUpdateChecks } = useProfilesStore.getState().globalPreferences;
    if (!allowUpdateChecks) return;

    (async () => {
      try {
        const update = await checkForUpdate();
        if (!update) return;
        notify({
          severity: "info",
          title: `Update available — v${update.version}`,
          detail: update.body?.split("\n")[0] ?? "A new version of WorkGrid Studio is ready.",
          toast: true,
          persistent: true,
          actions: [{
            label: "Download & restart",
            onClick: async () => {
              try {
                await update.downloadAndInstall();
                await relaunch();
              } catch {
                notifyError("Update failed", "Open Settings to retry.");
              }
            },
          }],
        });
      } catch {
        // Silently ignore startup update check failures
      }
    })();
   
  }, []);

  // Derive a stable string key from profile IDs — only changes when the actual set of IDs changes
  const profileIdKey = useMemo(() => profiles.map((p) => p.id).join(","), [profiles]);

  useEffect(() => {
    if (!profileIdKey) return;
    void loadAllSavedQueries(profileIdKey.split(","));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileIdKey]); // loadAllSavedQueries is a stable store action; key only changes when IDs change

  useEffect(() => {
    const clearScheduledInterval = (queryId: string) => {
      const timer = scheduledQueryIntervalsRef.current[queryId];
      if (timer) {
        clearInterval(timer);
        delete scheduledQueryIntervalsRef.current[queryId];
      }
      delete scheduledQueryRunningRef.current[queryId];
    };

    const desiredQueryIds = new Set<string>();

    Object.values(savedQueriesByProfile)
      .flat()
      .forEach((savedQuery) => {
        if (
          !savedQuery.scheduleEnabled ||
          !savedQuery.scheduleMinutes ||
          savedQuery.scheduleMinutes <= 0
        ) {
          clearScheduledInterval(savedQuery.id);
          return;
        }

        const profile = profiles.find((entry) => entry.id === savedQuery.profileId);
        if (!profile || profile.connectionStatus !== "connected") {
          clearScheduledInterval(savedQuery.id);
          return;
        }

        desiredQueryIds.add(savedQuery.id);

        if (scheduledQueryIntervalsRef.current[savedQuery.id]) {
          return;
        }

        const executeSavedQuery = async () => {
          if (scheduledQueryRunningRef.current[savedQuery.id]) return;
          scheduledQueryRunningRef.current[savedQuery.id] = true;

          try {
            const queryText = await readSavedQueryText(savedQuery.filePath);
            if (!queryText.trim()) {
              appendConnectionOutput(
                profile,
                "warning",
                `Scheduled query "${savedQuery.name}" was skipped because its file is empty.`,
              );
              return;
            }

            const startTime = performance.now();
            const fullQuery = savedQuery.database
              ? `USE \`${savedQuery.database.replace(/`/g, "``")}\`;\n${queryText}`
              : queryText;

            appendConnectionOutput(
              profile,
              "info",
              `Running scheduled query "${savedQuery.name}"${savedQuery.database ? ` on ${savedQuery.database}` : ""}.`,
            );

            const resultSets = await dbQuery(savedQuery.profileId, fullQuery);
            const filteredResults = savedQuery.database ? resultSets.slice(1) : resultSets;
            const totalRows = filteredResults.reduce(
              (sum, result) => sum + result.rows.length,
              0,
            );
            const elapsed = performance.now() - startTime;
            const summary = `${filteredResults.length} result set(s), ${totalRows.toLocaleString()} row(s) in ${elapsed < 1000 ? `${Math.round(elapsed)}ms` : `${(elapsed / 1000).toFixed(2)}s`}.`;

            appendConnectionOutput(
              profile,
              "success",
              `Scheduled query "${savedQuery.name}" completed: ${summary}`,
            );
            await recordSavedQueryRun(savedQuery.profileId, savedQuery.id, {
              lastRunAt: new Date().toISOString(),
              lastRunStatus: "success",
              lastRunSummary: summary,
            });
          } catch (error) {
            const message = String(error);
            appendConnectionOutput(
              profile,
              "error",
              `Scheduled query "${savedQuery.name}" failed: ${message}`,
            );
            await recordSavedQueryRun(savedQuery.profileId, savedQuery.id, {
              lastRunAt: new Date().toISOString(),
              lastRunStatus: "error",
              lastRunSummary: message,
            });
          } finally {
            scheduledQueryRunningRef.current[savedQuery.id] = false;
          }
        };

        scheduledQueryIntervalsRef.current[savedQuery.id] = setInterval(
          executeSavedQuery,
          savedQuery.scheduleMinutes * 60_000,
        );
      });

    Object.keys(scheduledQueryIntervalsRef.current).forEach((queryId) => {
      if (!desiredQueryIds.has(queryId)) {
        clearScheduledInterval(queryId);
      }
    });

    const intervalsRef = scheduledQueryIntervalsRef.current;
    return () => {
      Object.keys(intervalsRef).forEach(clearScheduledInterval);
    };
  }, [
    loadAllSavedQueries,
    profiles,
    readSavedQueryText,
    recordSavedQueryRun,
    savedQueriesByProfile,
  ]);

  // Connection Keep-Alive Loop
  useEffect(() => {
    const pinger = setInterval(async () => {
      const { profiles, setConnectionStatus } = useProfilesStore.getState();
      const { setLatency } = useSchemaStore.getState();
      const connected = profiles.filter((p) => p.connectionStatus === "connected");
      for (const p of connected) {
        try {
          const ms = await dbPing(p.id);
          setLatency(p.id, ms);
        } catch (e) {
          console.warn(`[Keep-Alive] Ping failed for ${p.id}, marking error and scheduling reconnect...`);
          appendConnectionOutput(
            p,
            "warning",
            `Keep-alive ping failed for ${formatConnectionTarget(p)}: ${formatOutputError(e)}.`,
          );
          setLatency(p.id, -1);
          setConnectionStatus(p.id, "error");
          scheduleReconnect(p.id);
        }
      }
    }, 15_000); // 15 seconds

    return () => clearInterval(pinger);
  }, [scheduleReconnect]);

  useEffect(() => {
    const activeProfileIds = new Set(profiles.map((profile) => profile.id));

    for (const profileId of Object.keys(reconnectTimeoutsRef.current)) {
      if (!activeProfileIds.has(profileId)) {
        clearReconnectSchedule(profileId, true);
      }
    }

    for (const profile of profiles) {
      if (
        profile.connectionStatus === "connected" ||
        profile.connectionStatus === "disconnected"
      ) {
        clearReconnectSchedule(profile.id, true);
      } else if (profile.connectionStatus === "connecting") {
        clearReconnectSchedule(profile.id, false);
      }
    }
  }, [clearReconnectSchedule, profiles]);

  useEffect(() => {
    return () => {
      for (const timeout of Object.values(reconnectTimeoutsRef.current)) {
        clearTimeout(timeout);
      }
      reconnectTimeoutsRef.current = {};
      reconnectAttemptsRef.current = {};
    };
  }, []);

  // ── Bootstrap keybinding engine ────────────────────────────────────────────
  useEffect(() => initKeybindings(), []);

  // ── Keep when-context in sync with layout state ────────────────────────────
  useEffect(() => {
    setContext({
      sidebarVisible: isPrimarySidebarVisible,
      panelVisible: isBottomPanelVisible,
    });
  }, [isPrimarySidebarVisible, isBottomPanelVisible]);

  // ── Command registrations (replace all hardcoded onKeyDown handlers) ───────
  useCommand("layout.toggleSidebar", toggleSidebar, [toggleSidebar]);
  useCommand("layout.togglePanel",   togglePanel,   [togglePanel]);
  useCommand("layout.toggleSecondarySidebar", toggleSecondarySidebar, [toggleSecondarySidebar]);
  useCommand("tab.newSqlQuery", () => {
    useLayoutStore.getState().openTab({ title: "New Query", type: "sql", meta: {} });
  });
  useCommand("tab.reopenClosed", () => {
    useLayoutStore.getState().restoreLastClosedTab();
  });
  useCommand("app.showShortcuts", () => setShowShortcuts((v) => !v));
  useCommand("app.commandPalette", () => {
    useAppStore.getState().setCommandPaletteOpen(true);
  });
  useCommand("app.openSettings", () => {
    useLayoutStore.getState().openTab({ title: "Settings", type: "settings", meta: {} });
  });

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-background text-foreground">
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>

      {showShortcuts && (
        <KeyboardShortcutsOverlay onClose={() => setShowShortcuts(false)} />
      )}

      {showOnboarding && (
        <OnboardingFlow onClose={() => setShowOnboarding(false)} />
      )}

      {/* Menu Bar — full width */}
      <MenuBar onShowShortcuts={() => setShowShortcuts(true)} />

      {/* Middle section: activity bar + sidebar + editor */}
      <div className="flex flex-1 overflow-hidden min-h-0">

      {/* Activity Bar */}
      <div
        className="shrink-0 bg-muted/20 border-r flex flex-col items-center py-2 justify-between"
        style={{ width: activityBarWidth }}
      >
        <div className="flex flex-col items-center gap-1">
          {activityItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeView === item.id && isPrimarySidebarVisible;
            const badge =
              item.id === "explorer" && connectedCount > 0
                ? connectedCount
                : item.id === "servers" && connectingCount > 0
                ? "connecting"
                : item.id === "tasks" && pendingTaskCount > 0
                ? pendingTaskCount
                : null;
            return (
              <button
                key={item.id}
                onClick={() => setActiveView(item.id)}
                className={cn(
                  "w-10 h-10 flex items-center justify-center rounded-md transition-colors relative",
                  isActive
                    ? "text-foreground bg-accent"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent/50",
                )}
                title={item.label}
                aria-label={item.label}
              >
                {isActive && (
                  <div className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-foreground rounded-r" />
                )}
                <Icon className="w-5 h-5" />
                {badge !== null && (
                  <span
                    className={cn(
                      "absolute top-1 right-1 min-w-[14px] h-[14px] rounded-full text-[9px] font-bold flex items-center justify-center px-0.5 leading-none",
                      badge === "connecting"
                        ? "bg-amber-500/20 text-amber-300 ring-1 ring-amber-500/40"
                        : "bg-primary text-primary-foreground",
                    )}
                  >
                    {badge === "connecting" ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      badge
                    )}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Bottom icons */}
        <div className="flex flex-col items-center gap-1 mb-2">
          <button
            onClick={() => openTab({ title: "Settings", type: "settings", meta: {} })}
            className="w-10 h-10 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
            title="Settings"
            aria-label="Settings"
          >
            <Settings className="w-5 h-5" />
          </button>

          <button
            onClick={toggleSecondarySidebar}
            className={cn(
              "w-10 h-10 flex items-center justify-center rounded-md transition-colors",
              isSecondarySidebarVisible
                ? "text-indigo-400 bg-accent"
                : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
            )}
            title="AI Chat"
            aria-label="AI Chat"
          >
            <Sparkles className="w-5 h-5" />
          </button>

          <button
            onClick={handleToggleTheme}
            className="w-10 h-10 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
            title={`Theme: ${theme.charAt(0).toUpperCase() + theme.slice(1)}`}
            aria-label={`Theme: ${theme.charAt(0).toUpperCase() + theme.slice(1)}`}
          >
            {theme === "dark" && <Moon className="w-5 h-5" />}
            {theme === "light" && <Sun className="w-5 h-5" />}
            {theme === "system" && <Monitor className="w-5 h-5" />}
          </button>
          <button
            onClick={toggleSidebar}
            className="w-10 h-10 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
            title="Toggle Sidebar (Ctrl+B)"
            aria-label="Toggle Sidebar (Ctrl+B)"
          >
            <Sidebar className="w-5 h-5" />
          </button>
          <button
            onClick={togglePanel}
            className="w-10 h-10 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
            title="Toggle Panel (Ctrl+`)"
            aria-label="Toggle Panel (Ctrl+`)"
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
                {activityItems.find((i) => i.id === activeView)?.label ??
                  "Explorer"}
              </span>
            </div>
          )}
          <div className="flex-1 overflow-auto">
            {activeView === "explorer" && <ExplorerTree />}
            {activeView === "servers" && <ServersSidebar />}
            {activeView === "snippets" && <Suspense fallback={null}><SnippetsPanel /></Suspense>}
            {activeView === "models" && (
              <div className="flex flex-col gap-2 p-2">
                <p className="text-xs text-muted-foreground mb-1">
                  AI Providers
                </p>
                <button
                  onClick={() =>
                    openTab({ title: "AI Models", type: "models" })
                  }
                  className="w-full text-left text-sm px-3 py-2 rounded border bg-card hover:bg-accent transition-colors"
                >
                  Manage Models →
                </button>
              </div>
            )}
            {activeView === "tasks" && (
              <div className="flex flex-col gap-2 p-2">
                <p className="text-xs text-muted-foreground mb-1">
                  Task tracker
                </p>
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
            direction="horizontal"
            className="absolute top-0 bottom-0 right-0 w-1 translate-x-0.5 cursor-col-resize"
            onDrag={adjustSidebarWidth}
          />
        </div>
      )}

      {/* Main Content Area */}
      <main
        id="main-content"
        tabIndex={-1}
        className="flex-1 flex flex-col relative min-w-0"
      >
        {/* Editor Group */}
        <div className="flex-1 flex overflow-hidden min-h-0 min-w-0">
          <div className="flex-1 relative p-0.5 min-w-0 min-h-0">
            <EditorNode tree={editorTree} />
          </div>

          {/* Secondary Sidebar (AI Chat) */}
          {isSecondarySidebarVisible && (
            <div
              className="relative bg-muted/10 border-l flex flex-col shrink-0"
              style={{ width: secondarySidebarWidth }}
            >
              <Sash
                direction="horizontal"
                className="absolute top-0 bottom-0 left-0 w-1 cursor-col-resize"
                onDrag={(delta) => adjustSecondarySidebarWidth(-delta)}
              />
              <AiChatSidebar />
            </div>
          )}
        </div>

        {/* Bottom Panel */}
        {isBottomPanelVisible && (
          <div
            ref={bottomPanelRef}
            className="relative bg-muted/10 border-t flex flex-row"
            style={{ height: bottomPanelHeight }}
          >
            <Sash
              direction="vertical"
              className="absolute top-0 left-0 right-0 h-1 -translate-y-0.5 cursor-row-resize"
              onDrag={(delta) => adjustPanelHeight(-delta)}
            />
            {isBottomPanelSplit ? (
              <>
                <div
                  className="relative flex flex-col min-w-0"
                  style={{ width: `${bottomPanelSplitRatio * 100}%` }}
                >
                  <BottomPanel />
                  <Sash
                    direction="horizontal"
                    className="absolute top-0 bottom-0 right-0 w-1 translate-x-0.5 cursor-col-resize"
                    onDrag={handleBottomPanelSplitDrag}
                  />
                </div>
                <div className="relative flex flex-col flex-1 min-w-0 border-l">
                  <BottomPanel isSecondary />
                </div>
              </>
            ) : (
              <div className="flex-1 flex flex-col min-w-0 relative">
                <BottomPanel />
              </div>
            )}
          </div>
        )}

      </main>
      </div>{/* end middle section */}

      {/* Status Bar — full width */}
      <StatusBar appVersion={appVersion} />
    </div>
  );
}

// ─── Bottom Panel ───────────────────────────────────────────────────

type PanelTab = "output" | "problems" | "logs" | "ailogs";
type LogFilter = "mysql" | "ssh" | "error";

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
  raw: string,
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

// Module-level helper — reads store state directly, no React dependencies
async function buildProblems(): Promise<ProblemItem[]> {
  const stateProfiles = useProfilesStore.getState().profiles;
  const currentConnected = stateProfiles.filter((p) => p.connectionStatus === "connected");
  const allProblems: ProblemItem[] = [];
  for (const p of currentConnected) {
    try {
      const raw = await readProfileLog(p.id, "error");
      const parsed = parseProblems(p.id, p.name, p.color, raw);
      allProblems.push(...parsed);
    } catch {
      // Skip profiles with read errors
    }
  }
  for (const p of stateProfiles.filter((p) => p.connectionStatus === "error")) {
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
  allProblems.reverse();
  return allProblems;
}

function BottomPanel({ isSecondary }: { isSecondary?: boolean }) {
  const profiles = useProfilesStore((s) => s.profiles);
  const outputEntries = useAppStore((s) => s.outputEntries);
  const clearOutputEntries = useAppStore((s) => s.clearOutputEntries);
  const connectedProfiles = profiles.filter(
    (p) => p.connectionStatus === "connected",
  );
  const logProfiles = profiles;

  const isBottomPanelSplit = useLayoutStore((s) => s.isBottomPanelSplit);
  const toggleBottomPanelSplit = useLayoutStore((s) => s.toggleBottomPanelSplit);

  const [activeTab, setActiveTab] = useState<PanelTab>(isSecondary ? "logs" : "output");
  const [logFilter, setLogFilter] = useState<LogFilter>("mysql");
  // Stable user choice — only set explicitly by the dropdown
  const [preferredProfileId, setPreferredProfileId] = useState<string>("");
  // Derived: use preferred if still valid, else fall back to first available
  const selectedProfileId = useMemo(() => {
    if (logProfiles.find((p) => p.id === preferredProfileId)) return preferredProfileId;
    return logProfiles[0]?.id ?? "";
  }, [logProfiles, preferredProfileId]);
  const [streamEntries, setStreamEntries] = useState<StreamLogEntry[]>([]);
  const [problems, setProblems] = useState<ProblemItem[]>([]);
  const [aiLogs, setAiLogs] = useState<AiLogEntry[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  // ── Live log stream ─────────────────────────────────────────────
  useEffect(() => {
    void getLogBuffer().then((entries) => {
      startTransition(() => setStreamEntries(entries));
    });
    const unsub = subscribeToLogStream((entries) => {
      startTransition(() =>
        setStreamEntries((prev) => {
          const next = [...prev, ...entries];
          return next.length > 500 ? next.slice(next.length - 500) : next;
        }),
      );
    });
    return unsub;
  }, []);

  // ── Problems fetching ───────────────────────────────────────────
  useEffect(() => {
    async function run() {
      const result = await buildProblems();
      startTransition(() => setProblems(result));
    }

    void run();
    const interval = setInterval(() => void run(), 3000);
    return () => clearInterval(interval);
  }, []); // empty — all reads go through getState()

  // ── AI Logs fetching ────────────────────────────────────────────
  const fetchAiLogs = useCallback(async () => {
    try {
      const logs = await getAiLogs();
      startTransition(() => {
        setAiLogs(logs);
      });
    } catch (e) {
      console.error("Failed to fetch AI logs", e);
    }
  }, []); // no activeTab dependency — guard lives in the effect

  useEffect(() => {
    if (activeTab !== "ailogs") return; // guard here, not in callback
    void fetchAiLogs();
    const interval = setInterval(() => void fetchAiLogs(), 2000);
    return () => clearInterval(interval);
  }, [activeTab, fetchAiLogs]); // fetchAiLogs is now stable (empty deps), effect only restarts when activeTab changes

  // Filter stream entries by profile and log type
  const filteredStreamEntries = useMemo(() => {
    return streamEntries.filter((e) => {
      if (selectedProfileId && e.profileId !== selectedProfileId) return false;
      if (logFilter === "mysql") return e.source === "query" || e.source === "connection";
      if (logFilter === "ssh") return e.source === "ssh";
      if (logFilter === "error") return e.level === "error";
      return true;
    });
  }, [streamEntries, selectedProfileId, logFilter]);

  // Auto-scroll to bottom when log content changes
  useEffect(() => {
    if (
      scrollRef.current &&
      (activeTab === "output" || activeTab === "logs" || activeTab === "ailogs") &&
      autoScroll
    ) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [outputEntries, streamEntries, aiLogs, activeTab, autoScroll]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    if (activeTab === "logs") {
      const entries = await getLogBuffer().catch(() => [] as StreamLogEntry[]);
      startTransition(() => setStreamEntries(entries));
    }
    if (activeTab === "problems") {
      const result = await buildProblems();
      startTransition(() => setProblems(result));
    }
    if (activeTab === "ailogs") await fetchAiLogs();
    setTimeout(() => setIsRefreshing(false), 300);
  };

  const handleClear = async () => {
    if (activeTab === "output") {
      clearOutputEntries();
    } else if (activeTab === "logs") {
      startTransition(() => setStreamEntries([]));
      if (selectedProfileId) {
        try {
          await clearProfileLog(selectedProfileId, logFilter);
        } catch (e) {
          console.error("Clear log error:", e);
        }
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
    } else if (activeTab === "ailogs") {
      try {
        await clearAiLogs();
        setAiLogs([]);
      } catch (e) {
        console.error("Clear AI log error:", e);
      }
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
              ? "text-foreground border-b-2 border-primary"
              : "text-muted-foreground hover:text-foreground",
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
              ? "text-foreground border-b-2 border-primary"
              : "text-muted-foreground hover:text-foreground",
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
              ? "text-foreground border-b-2 border-primary"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          Logs
        </button>

        {/* AI Logs tab */}
        <button
          onClick={() => setActiveTab("ailogs")}
          className={cn(
            "px-3 h-full text-xs transition-colors flex items-center gap-1",
            activeTab === "ailogs"
              ? "text-foreground border-b-2 border-primary"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Bot className="w-3 h-3" />
          AI Logs
        </button>

        <div className="ml-auto flex items-center gap-2">
          {/* Logs-specific: Profile selector */}
          {activeTab === "logs" && logProfiles.length > 0 && (
            <select
              value={selectedProfileId}
              onChange={(e) => setPreferredProfileId(e.target.value)}
              className="h-6 text-[11px] rounded border bg-secondary/50 text-foreground px-1.5 outline-none"
              aria-label="Select log profile"
            >
              {logProfiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          )}

          {/* Logs-specific: Log type filter */}
          {activeTab === "logs" && (
            <select
              value={logFilter}
              onChange={(e) => setLogFilter(e.target.value as LogFilter)}
              className="h-6 text-[11px] rounded border bg-secondary/50 text-foreground px-1.5 outline-none"
              aria-label="Select log type"
            >
              <option value="mysql">MySQL Log</option>
              <option value="ssh">SSH Log</option>
              <option value="error">Error Log</option>
            </select>
          )}

          {/* Refresh */}
          {activeTab !== "output" && (
            <button
              onClick={handleRefresh}
              className="p-1 text-muted-foreground hover:text-foreground transition-colors"
              title="Refresh"
              aria-label="Refresh"
            >
              <RefreshCw
                className={cn("w-3.5 h-3.5", isRefreshing && "animate-spin")}
              />
            </button>
          )}

          {/* Clear */}
          <button
            onClick={handleClear}
            className="p-1 text-muted-foreground hover:text-red-400 transition-colors"
            title={
              activeTab === "output"
                ? "Clear output"
                : activeTab === "problems"
                  ? "Clear all problems"
                  : activeTab === "ailogs"
                    ? "Clear AI logs"
                    : "Clear log"
            }
            aria-label={
              activeTab === "output"
                ? "Clear output"
                : activeTab === "problems"
                  ? "Clear all problems"
                  : activeTab === "ailogs"
                    ? "Clear AI logs"
                    : "Clear log"
            }
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>

          {/* Auto Scroll Toggle */}
          {(activeTab === "output" || activeTab === "logs" || activeTab === "ailogs") && (
            <button
              onClick={() => setAutoScroll(!autoScroll)}
              className={cn(
                "p-1 transition-colors relative",
                autoScroll ? "text-primary hover:text-primary/80" : "text-muted-foreground hover:text-foreground"
              )}
              title="Toggle Auto-Scroll"
              aria-label="Toggle Auto-Scroll"
            >
              <ArrowDownToLine className="w-3.5 h-3.5" />
              {autoScroll && (
                <span className="absolute bottom-1 right-1 w-1.5 h-1.5 bg-primary rounded-full shadow-sm shadow-foreground/20" />
              )}
            </button>
          )}

          {/* Split Panel Toggle */}
          <button
            onClick={toggleBottomPanelSplit}
            className={cn(
              "p-1 transition-colors",
              isBottomPanelSplit && !isSecondary ? "text-primary hover:text-primary/80" : "text-muted-foreground hover:text-foreground"
            )}
            title={isBottomPanelSplit && !isSecondary ? "Close Split View" : "Split View"}
            aria-label={isBottomPanelSplit && !isSecondary ? "Close Split View" : "Split View"}
          >
            <Columns2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Panel content */}
      <div ref={scrollRef} className="flex-1 overflow-auto">
        {/* ── Output ─────────────────────────────────────────── */}
        {activeTab === "output" && (
          <div className="text-xs">
            {outputEntries.length === 0 ? (
              <div className="p-3 font-mono text-muted-foreground">
                Connection activity and debugging events will appear here.
              </div>
            ) : (
              <div className="divide-y divide-border/40 font-mono">
                {outputEntries.map((entry) => (
                  <div
                    key={entry.id}
                    className="flex items-start gap-2 px-3 py-1.5 hover:bg-accent/30 transition-colors"
                  >
                    <span className="shrink-0 whitespace-nowrap text-[10px] text-muted-foreground/60">
                      {entry.timestamp}
                    </span>
                    <span
                      className={cn(
                        "shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide",
                        entry.level === "info" && "bg-blue-500/15 text-blue-400",
                        entry.level === "success" && "bg-emerald-500/15 text-emerald-400",
                        entry.level === "warning" && "bg-yellow-500/15 text-yellow-400",
                        entry.level === "error" && "bg-red-500/15 text-red-400",
                      )}
                    >
                      {entry.level}
                    </span>
                    {entry.profileName && (
                      <span className="shrink-0 rounded-full bg-secondary/70 px-1.5 py-0.5 text-[10px] text-foreground/70">
                        {entry.profileName}
                      </span>
                    )}
                    <span
                      className={cn(
                        "flex-1 break-all leading-relaxed",
                        entry.level === "error" && "text-red-400",
                        entry.level === "warning" && "text-yellow-300",
                        entry.level === "success" && "text-emerald-300",
                        entry.level === "info" && "text-foreground/80",
                      )}
                    >
                      {entry.message}
                    </span>
                  </div>
                ))}
              </div>
            )}
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
                      item.severity === "error" && "bg-red-500/3",
                      item.severity === "warning" && "bg-yellow-500/3",
                    )}
                  >
                    {/* Severity icon */}
                    <span className="mt-0.5 shrink-0">
                      {item.severity === "error" && (
                        <span className="inline-block w-3.5 h-3.5 rounded-full bg-red-500/20 text-red-400 text-center leading-[14px] text-[9px] font-bold">
                          ✕
                        </span>
                      )}
                      {item.severity === "warning" && (
                        <span className="inline-block w-3.5 h-3.5 rounded-full bg-yellow-500/20 text-yellow-400 text-center leading-[14px] text-[9px] font-bold">
                          !
                        </span>
                      )}
                      {item.severity === "info" && (
                        <span className="inline-block w-3.5 h-3.5 rounded-full bg-blue-500/20 text-blue-400 text-center leading-[14px] text-[9px] font-bold">
                          i
                        </span>
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
          <div className="font-mono text-xs leading-5">
            {filteredStreamEntries.length === 0 ? (
              <div className="p-3 text-muted-foreground">
                {logProfiles.length === 0
                  ? "Create a connection profile to view logs."
                  : "No log entries yet. Run a connection attempt or query to capture diagnostics here."}
              </div>
            ) : (
              <div className="divide-y divide-border/20">
                {filteredStreamEntries.map((entry, i) => (
                  <div
                    key={i}
                    className={cn(
                      "flex items-start gap-2 px-3 py-0.5 min-h-5 hover:bg-accent/20 transition-colors",
                      entry.level === "error" && "text-red-400",
                      entry.level === "warn" && "text-yellow-300",
                      entry.source === "ssh" && entry.level !== "error" && entry.level !== "warn" && "text-cyan-300/80",
                      entry.source === "query" && entry.level !== "error" && "text-foreground/80",
                      entry.source === "connection" && entry.level !== "error" && "text-blue-400/70",
                    )}
                  >
                    <span className="shrink-0 whitespace-nowrap text-[10px] text-muted-foreground/50 mt-0.5">
                      {entry.ts}
                    </span>
                    <span
                      className={cn(
                        "shrink-0 rounded px-1 text-[9px] font-bold uppercase mt-0.5",
                        entry.level === "error" && "bg-red-500/15 text-red-400",
                        entry.level === "warn" && "bg-yellow-500/15 text-yellow-400",
                        entry.level === "info" && "bg-blue-500/15 text-blue-400",
                        entry.level === "debug" && "bg-muted text-muted-foreground",
                      )}
                    >
                      {entry.source}
                    </span>
                    <span className="flex-1 break-all">
                      {entry.message}
                      {entry.detail && (
                        <span className="ml-1 text-muted-foreground/60">{entry.detail}</span>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── AI Logs ───────────────────────────────────────────── */}
        {activeTab === "ailogs" && (
          <div className="min-w-max text-xs">
            {aiLogs.length === 0 ? (
              <div className="p-3 text-muted-foreground font-mono">
                No AI transactions logged.
              </div>
            ) : (
              <table className="w-full text-left font-mono border-collapse">
                <thead className="bg-muted/50 sticky top-0 border-b border-border/40 select-none">
                  <tr>
                    <th className="py-2 px-3 tracking-tighter hover:bg-muted/50 bg-background text-foreground/70 cursor-pointer min-w-[140px] sticky left-0 z-10 font-normal">
                      Timestamp
                    </th>
                    <th className="py-2 px-3 font-normal tracking-wide min-w-[120px]">
                      Model
                    </th>
                    <th className="py-2 px-3 font-normal max-w-[200px] truncate">
                      URI
                    </th>
                    <th className="py-2 px-3 font-normal min-w-[200px]">
                      Payload
                    </th>
                    <th className="py-2 px-3 font-normal min-w-[300px]">
                      Response
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40 text-foreground/80">
                  {aiLogs.map((log) => (
                    <tr
                      key={log.id}
                      className="hover:bg-accent/30 transition-colors group align-top"
                    >
                      <td className="py-2 px-3 whitespace-nowrap bg-background group-hover:bg-accent/10 sticky left-0 z-10 border-r border-border/20 text-muted-foreground">
                        {log.timestamp}
                      </td>
                      <td className="py-2 px-3 whitespace-nowrap">
                        <span className="bg-primary/5 border border-primary/20 text-primary px-1.5 py-0.5 rounded text-[10px]">
                          {log.model}
                        </span>
                      </td>
                      <td
                        className="py-2 px-3 truncate max-w-[200px] text-muted-foreground/80"
                        title={log.uri}
                      >
                        {log.uri}
                      </td>
                      <td className="py-2 px-3">
                        <div
                          className="max-w-[30vw] line-clamp-3 text-muted-foreground cursor-help"
                          title={log.payload_preview}
                        >
                          {log.payload_preview}
                        </div>
                      </td>
                      <td className="py-2 px-3">
                        <div
                          className="max-w-[40vw] line-clamp-3 text-muted-foreground cursor-help"
                          title={log.response_preview}
                        >
                          {log.response_preview}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </>
  );
}

// ─── Status Bar ─────────────────────────────────────────────────────

function StatusBar({ appVersion }: { appVersion: string }) {
  const entries = useAppStore((s) => s.statusBarEntries);
  const openUrl_ = openUrl;

  const leftEntries = [...entries.filter((e) => e.side === "left" && e.label)]
    .sort((a, b) => b.priority - a.priority);
  const rightEntries = [...entries.filter((e) => e.side === "right" && e.label)]
    .sort((a, b) => a.priority - b.priority);

  return (
    <div className="h-6 bg-primary text-primary-foreground flex items-center px-4 text-xs gap-3 shrink-0 select-none">
      {/* App name — always present */}
      <span className="font-medium">WorkGrid Studio</span>

      {/* Dynamic left-side entries */}
      {leftEntries.map((entry) =>
        entry.onClick ? (
          <button
            key={entry.id}
            type="button"
            onClick={entry.onClick}
            title={entry.title}
            className="opacity-80 transition-opacity hover:opacity-100 hover:underline"
          >
            {entry.label}
          </button>
        ) : (
          <span key={entry.id} title={entry.title} className="opacity-80">
            {entry.label}
          </span>
        ),
      )}

      {/* Dynamic right-side entries + version + heart */}
      <span className="ml-auto flex items-center gap-3">
        {rightEntries.map((entry) =>
          entry.onClick ? (
            <button
              key={entry.id}
              type="button"
              onClick={entry.onClick}
              title={entry.title}
              className="opacity-70 transition-opacity hover:opacity-100"
            >
              {entry.label}
            </button>
          ) : (
            <span key={entry.id} title={entry.title} className="opacity-70">
              {entry.label}
            </span>
          ),
        )}
        <span className="opacity-60">v{appVersion}</span>
        <button
          onClick={() => openUrl_("https://paypal.me/ja1030")}
          title="Support WorkGrid Studio"
          aria-label="Support WorkGrid Studio"
          className="opacity-50 hover:opacity-100 transition-opacity"
        >
          <Heart className="w-3 h-3" />
        </button>
      </span>
    </div>
  );
}
