import { useState, useEffect, useRef, Suspense, lazy, memo } from "react";
import { useLayoutStore, SplitTree, EditorTab } from "@/state/layoutStore";
import { Sash } from "./Sash";
import { cn } from "@/lib/utils/cn";
import {
  X,
  Plus,
  Terminal,
  Database,
  Table2,
  Boxes,
  ListChecks,
  FileText,
  Loader2,
  Rows3,
  Circle,
  Pin,
  PinOff,
} from "lucide-react";
import { useSchemaStore } from "@/state/schemaStore";
import { WelcomeTab } from "@/components/views/WelcomeTab";

// Lazy-load heavy view components — they are only loaded when first rendered,
// which eliminates upfront bundle cost and speeds up tab switching.
const ModelsPage = lazy(() =>
  import("@/components/views/ModelsPage").then((m) => ({
    default: m.ModelsPage,
  })),
);
const TasksView = lazy(() =>
  import("@/components/views/TasksView").then((m) => ({
    default: m.TasksView,
  })),
);
const DatabaseView = lazy(() =>
  import("@/components/views/DatabaseView").then((m) => ({
    default: m.DatabaseView,
  })),
);
const TableDesigner = lazy(() =>
  import("@/components/views/TableDesigner").then((m) => ({
    default: m.TableDesigner,
  })),
);
const QueryTab = lazy(() =>
  import("@/components/views/QueryTab").then((m) => ({
    default: m.QueryTab,
  })),
);
const ResultsTab = lazy(() =>
  import("@/components/views/ResultsTab").then((m) => ({
    default: m.ResultsTab,
  })),
);
const SchemaDiagramTab = lazy(() =>
  import("@/components/views/SchemaDiagramTab").then((m) => ({
    default: m.SchemaDiagramTab,
  })),
);
const TableDataTab = lazy(() =>
  import("@/components/views/TableDataTab").then((m) => ({
    default: m.TableDataTab,
  })),
);
const SettingsPage = lazy(() =>
  import("@/components/views/SettingsPage").then((m) => ({
    default: m.SettingsPage,
  })),
);

// Loading skeleton shown while a lazy component is being resolved
function TabLoadingFallback() {
  return (
    <div className="w-full h-full flex flex-col items-center justify-center gap-3 text-muted-foreground/60">
      <Loader2 className="w-6 h-6 animate-spin" />
      <span className="text-xs">Loading…</span>
    </div>
  );
}

// Memoised tab content — prevents hidden tabs from re-rendering when
// only the parent tree (e.g. activeTabId) changes.
const TabContent = memo(function TabContent({ tab, leafId }: { tab: EditorTab, leafId: string }) {
  const content = (() => {
    switch (tab.type) {
      case "models":
        return <ModelsPage />;
      case "tasks":
        return <TasksView />;
      case "settings":
        return <SettingsPage />;
      case "database-view":
        return (
          <DatabaseView
            tabId={tab.id}
            profileId={tab.meta?.profileId ?? ""}
            profileName={tab.meta?.profileName ?? "Database"}
            database={tab.meta?.database}
          />
        );
      case "table-designer":
        return (
          <TableDesigner
            tabId={tab.id}
            leafId={leafId}
            profileId={tab.meta?.profileId ?? ""}
            database={tab.meta?.database ?? ""}
            tableName={tab.meta?.tableName}
          />
        );
      case "table-data":
        return (
          <TableDataTab
            profileId={tab.meta?.profileId ?? ""}
            database={tab.meta?.database ?? ""}
            tableName={tab.meta?.tableName ?? ""}
          />
        );
      case "sql":
        return (
          <QueryTab
            tabId={tab.id}
            leafId={leafId}
            profileId={tab.meta?.profileId ?? ""}
            database={tab.meta?.database}
            savedQueryId={tab.meta?.savedQueryId}
            savedQueryPath={tab.meta?.savedQueryPath}
            savedQueryName={tab.title}
            initialTabMeta={tab.meta}
          />
        );
      case "results":
        return <ResultsTab tabId={tab.id} />;
      case "schema":
        return (
          <SchemaDiagramTab
            profileId={tab.meta?.profileId ?? ""}
            database={tab.meta?.database ?? ""}
          />
        );
      default:
        return (
          <div className="w-full h-full flex items-center justify-center text-muted-foreground text-sm">
            {tab.title}
          </div>
        );
    }
  })();

  return <Suspense fallback={<TabLoadingFallback />}>{content}</Suspense>;
});

const TAB_TYPE_LABELS: Record<EditorTab["type"], string> = {
  sql: "SQL Query (Ctrl+N)",
  results: "Frozen Results",
  schema: "Schema Diagram",
  "database-view": "Database View",
  "table-designer": "Table Designer",
  "table-data": "Table Data",
  models: "AI Models",
  tasks: "Tasks",
  settings: "Settings",
};

function tabIcon(type: EditorTab["type"], isActive: boolean) {
  const cls = cn(
    "w-3.5 h-3.5 shrink-0",
    isActive ? "text-primary" : "text-muted-foreground/60",
  );
  const label = TAB_TYPE_LABELS[type] ?? type;
  let icon;
  switch (type) {
    case "sql":          icon = <Terminal className={cls} />; break;
    case "results":      icon = <Rows3 className={cls} />; break;
    case "schema":       icon = <Database className={cls} />; break;
    case "database-view": icon = <Database className={cls} />; break;
    case "table-designer": icon = <Table2 className={cls} />; break;
    case "table-data":   icon = <Rows3 className={cls} />; break;
    case "models":       icon = <Boxes className={cls} />; break;
    case "tasks":        icon = <ListChecks className={cls} />; break;
    default:             icon = <FileText className={cls} />;
  }
  return <span title={label} className="shrink-0">{icon}</span>;
}

// Module-level state for drag payload to bypass WebView dataTransfer filtering robustly
let activeDragPayload: { tabId: string; sourceLeafId: string } | null = null;
const EMPTY_TABS: EditorTab[] = [];

export const EditorNode = memo(function EditorNode({ tree }: { tree: SplitTree }) {
  const resizeNode = useLayoutStore((s) => s.resizeNode);
  const openTab = useLayoutStore((s) => s.openTab);
  const closeTab = useLayoutStore((s) => s.closeTab);
  const closeOtherTabs = useLayoutStore((s) => s.closeOtherTabs);
  const closeTabsToRight = useLayoutStore((s) => s.closeTabsToRight);
  const closeAllTabs = useLayoutStore((s) => s.closeAllTabs);
  const splitLeaf = useLayoutStore((s) => s.splitLeaf);
  const splitLeafAndMove = useLayoutStore((s) => s.splitLeafAndMove);
  const closeLeaf = useLayoutStore((s) => s.closeLeaf);
  const setActiveLeaf = useLayoutStore((s) => s.setActiveLeaf);
  const setActiveTab = useLayoutStore((s) => s.setActiveTab);
  const moveTab = useLayoutStore((s) => s.moveTab);
  const updateTab = useLayoutStore((s) => s.updateTab);
  const togglePinTab = useLayoutStore((s) => s.togglePinTab);
  const connectedProfiles = useSchemaStore((s) => s.connectedProfiles);
  const activeLeafId = useLayoutStore((s) => s.activeLeafId);
  const isSplit = useLayoutStore((s) => s.editorTree.type !== "leaf");
  const treeTabs = tree.type === "leaf" ? tree.tabs : EMPTY_TABS;
  const treeActiveTabId = tree.type === "leaf" ? tree.activeTabId : null;

  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    tabId: string;
  } | null>(null);

  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [dragOverTabId, setDragOverTabId] = useState<string | null>(null);
  const [isDragOverPane, setIsDragOverPane] = useState<boolean>(false);
  const [dragOverSplit, setDragOverSplit] = useState<"horizontal" | "vertical" | null>(null);
  const [renamingTabId, setRenamingTabId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const tabScrollRef = useRef<HTMLDivElement | null>(null);
  const [tabOverflow, setTabOverflow] = useState({
    start: false,
    end: false,
  });

  // Track any drag-in-progress globally so all panes show their edge drop zones
  useEffect(() => {
    const onStart = () => setIsDragging(true);
    const onEnd = () => { setIsDragging(false); setDragOverSplit(null); };
    window.addEventListener("dragstart", onStart);
    window.addEventListener("dragend", onEnd);
    return () => {
      window.removeEventListener("dragstart", onStart);
      window.removeEventListener("dragend", onEnd);
    };
  }, []);

  const handleDragStart = (e: React.DragEvent, tabId: string, leafId: string) => {
    e.dataTransfer.effectAllowed = "move";
    // Browsers require some text data to initiate a drag properly
    e.dataTransfer.setData("text/plain", "workgrid-tab");
    activeDragPayload = { tabId, sourceLeafId: leafId };
  };

  const handleDragEnter = (e: React.DragEvent, tabId: string | null) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (tabId) {
      if (dragOverTabId !== tabId) setDragOverTabId(tabId);
      if (isDragOverPane) setIsDragOverPane(false);
    } else {
      if (dragOverTabId !== null) setDragOverTabId(null);
      if (!isDragOverPane) setIsDragOverPane(true);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault(); // Unconditional preventDefault to allow drop
    e.dataTransfer.dropEffect = "move";
  };

  const handleDragLeave = (e: React.DragEvent) => {
    // Only reset if we actually left the boundary (not just entering a child)
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setDragOverTabId(null);
      setIsDragOverPane(false);
    }
  };

  const handleDrop = (e: React.DragEvent, leafId: string, targetIndex?: number) => {
    e.preventDefault();
    setDragOverTabId(null);
    setIsDragOverPane(false);

    if (activeDragPayload) {
      moveTab(activeDragPayload.tabId, activeDragPayload.sourceLeafId, leafId, targetIndex);
    }
  };

  const handleDragEnd = () => {
    activeDragPayload = null;
    setDragOverTabId(null);
    setIsDragOverPane(false);
  };

  // Global click listener to close context menu
  useEffect(() => {
    const handleClick = () => setContextMenu(null);
    window.addEventListener("click", handleClick);
    window.addEventListener("scroll", handleClick, true);
    return () => {
      window.removeEventListener("click", handleClick);
      window.removeEventListener("scroll", handleClick, true);
    };
  }, []);

  useEffect(() => {
    if (tree.type !== "leaf") {
      setTabOverflow({ start: false, end: false });
      return;
    }

    const scroller = tabScrollRef.current;
    if (!scroller) {
      setTabOverflow({ start: false, end: false });
      return;
    }

    const updateOverflow = () => {
      const hasOverflow = scroller.scrollWidth > scroller.clientWidth + 1;
      setTabOverflow({
        start: hasOverflow && scroller.scrollLeft > 1,
        end:
          hasOverflow &&
          scroller.scrollLeft + scroller.clientWidth < scroller.scrollWidth - 1,
      });
    };

    updateOverflow();
    scroller.addEventListener("scroll", updateOverflow, { passive: true });

    const resizeObserver =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => updateOverflow())
        : null;

    resizeObserver?.observe(scroller);

    return () => {
      scroller.removeEventListener("scroll", updateOverflow);
      resizeObserver?.disconnect();
    };
  }, [tree.type, treeTabs]);

  useEffect(() => {
    if (tree.type !== "leaf" || !treeActiveTabId) return;

    const scroller = tabScrollRef.current;
    if (!scroller) return;

    const activeTabEl = scroller.querySelector<HTMLElement>(
      `[data-tab-id="${treeActiveTabId}"]`,
    );
    activeTabEl?.scrollIntoView({
      behavior: "auto",
      block: "nearest",
      inline: "nearest",
    });
  }, [tree.type, treeActiveTabId, treeTabs]);

  // Shortcut for closing active tab (Ctrl+W)
  useEffect(() => {
    if (tree.type !== "leaf") return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key.toLowerCase() === "w") {
        e.preventDefault();
        if (tree.activeTabId && activeLeafId === tree.id) {
          const activeTab = tree.tabs.find(t => t.id === tree.activeTabId);
          if (activeTab?.dirty && !window.confirm("You have unsaved changes. Are you sure you want to close this tab?")) {
            return;
          }
          closeTab(tree.activeTabId, tree.id);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [tree, closeTab, activeLeafId]);

  const checkDirtyTabs = (tabsToClose: EditorTab[]) => {
    const dirtyCount = tabsToClose.filter(t => t.dirty).length;
    if (dirtyCount > 0) {
      return window.confirm(`You have ${dirtyCount} tab(s) with unsaved changes. Are you sure you want to close them?`);
    }
    return true;
  };

  if (tree.type === "leaf") {
    const isLeafActive = activeLeafId === tree.id;
    const pinnedTabs = tree.tabs.filter((tab) => tab.pinned);
    const scrollableTabs = tree.tabs.filter((tab) => !tab.pinned);
    const renderTab = (tab: EditorTab, idx: number) => {
      const isActive = tab.id === tree.activeTabId;
      const isDragTarget = dragOverTabId === tab.id;

      return (
        <div
          key={tab.id}
          role="tab"
          aria-selected={isActive}
          aria-label={`${tab.title} (${TAB_TYPE_LABELS[tab.type] ?? tab.type})`}
          tabIndex={isActive ? 0 : -1}
          data-tab-id={tab.id}
          className={cn(
            "group flex items-center gap-1 h-full px-2 text-xs cursor-pointer select-none shrink-0 transition-all border-b-2",
            isActive
              ? "border-primary bg-background text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground hover:bg-accent/40",
            isDragTarget && "border-l-2 border-l-primary",
          )}
          draggable
          onDragStart={(e) => handleDragStart(e, tab.id, tree.id)}
          onDragEnter={(e) => handleDragEnter(e, tab.id)}
          onDragOver={handleDragOver}
          onDragLeave={() => setDragOverTabId(null)}
          onDragEnd={handleDragEnd}
          onDrop={(e) => {
            e.stopPropagation();
            handleDrop(e, tree.id, idx);
          }}
          onClick={() => setActiveTab(tab.id, tree.id)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setActiveTab(tab.id, tree.id);
              return;
            }

            if (
              e.key !== "ArrowRight" &&
              e.key !== "ArrowLeft" &&
              e.key !== "Home" &&
              e.key !== "End"
            ) {
              return;
            }

            const tabEls = Array.from(
              document.querySelectorAll<HTMLElement>(
                `[data-leaf-id="${tree.id}"] [role="tab"]`,
              ),
            );
            if (tabEls.length === 0) return;

            let nextIndex = idx;
            if (e.key === "ArrowRight") {
              nextIndex = (idx + 1) % tabEls.length;
            } else if (e.key === "ArrowLeft") {
              nextIndex = (idx - 1 + tabEls.length) % tabEls.length;
            } else if (e.key === "Home") {
              nextIndex = 0;
            } else if (e.key === "End") {
              nextIndex = tabEls.length - 1;
            }

            e.preventDefault();
            tabEls[nextIndex]?.focus();
            const nextTabId = tabEls[nextIndex]?.dataset.tabId;
            if (nextTabId) {
              setActiveTab(nextTabId, tree.id);
            }
          }}
          onAuxClick={(e) => {
            if (e.button === 1) {
              e.preventDefault();
              if (
                tab.dirty &&
                !window.confirm(
                  "You have unsaved changes. Are you sure you want to close this tab?",
                )
              ) {
                return;
              }
              closeTab(tab.id, tree.id);
            }
          }}
          onMouseDown={(e) => {
            if (e.button === 1) e.preventDefault();
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            setContextMenu({
              x: e.clientX,
              y: e.clientY,
              tabId: tab.id,
            });
          }}
        >
          {tabIcon(tab.type, isActive)}
          {renamingTabId === tab.id ? (
            <input
              autoFocus
              value={renameValue}
              className="max-w-30 bg-background border border-primary rounded px-1 text-xs outline-none"
              onChange={e => setRenameValue(e.target.value)}
              onBlur={() => {
                if (renameValue.trim()) updateTab(tab.id, { title: renameValue.trim() });
                setRenamingTabId(null);
              }}
              onKeyDown={e => {
                if (e.key === "Enter") {
                  if (renameValue.trim()) updateTab(tab.id, { title: renameValue.trim() });
                  setRenamingTabId(null);
                } else if (e.key === "Escape") {
                  setRenamingTabId(null);
                }
                e.stopPropagation();
              }}
              onClick={e => e.stopPropagation()}
            />
          ) : (
            <span
              className="truncate max-w-30"
              onDoubleClick={e => {
                e.stopPropagation();
                setRenamingTabId(tab.id);
                setRenameValue(tab.title);
              }}
            >
              {tab.title}
            </span>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); togglePinTab(tab.id, tree.id); }}
            className={cn(
              "ml-0.5 p-0.5 rounded hover:bg-muted/80 transition-opacity",
              tab.pinned ? "opacity-100 text-primary" : "opacity-0 group-hover:opacity-60"
            )}
            aria-label={tab.pinned ? "Unpin tab" : "Pin tab"}
            title={tab.pinned ? "Unpin tab" : "Pin tab"}
          >
            {tab.pinned
              ? <Pin className="w-2.5 h-2.5" />
              : <PinOff className="w-2.5 h-2.5" />
            }
          </button>
          {!tab.pinned && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (tab.dirty && !window.confirm("You have unsaved changes. Are you sure you want to close this tab?")) {
                  return;
                }
                closeTab(tab.id, tree.id);
              }}
              className={cn(
                "ml-0.5 p-0.5 rounded hover:bg-muted/80 transition-opacity group/close",
                tab.dirty ? "opacity-100" : "opacity-0 group-hover:opacity-100"
              )}
              aria-label="Close tab"
            >
              {tab.dirty ? (
                <>
                  <Circle className="w-2 h-2 fill-current opacity-80 group-hover/close:hidden" />
                  <X className="w-3 h-3 hidden group-hover/close:block" />
                </>
              ) : (
                <X className="w-3 h-3" />
              )}
            </button>
          )}
        </div>
      );
    };
    return (
      <div
        className={cn(
          "flex-1 w-full h-full bg-background border rounded-sm overflow-hidden flex flex-col transition-colors",
          isLeafActive && isSplit ? "border-primary/50" : "border-border",
          isDragOverPane && "ring-2 ring-primary bg-primary/5"
        )}
        onClickCapture={() => setActiveLeaf(tree.id)}
        onDragEnter={(e) => handleDragEnter(e, null)}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={(e) => handleDrop(e, tree.id)}
      >
        {/* Tab bar */}
        <div
          className="shrink-0 relative border-b bg-muted/30"
          style={{ height: 29 }}
        >
          <div
            className="absolute inset-0 flex items-stretch"
            role="tablist"
            data-leaf-id={tree.id}
            aria-label="Editor tabs"
            onDragEnter={(e) => handleDragEnter(e, null)}
            onDragOver={handleDragOver}
            onDrop={(e) => handleDrop(e, tree.id)}
          >
            {pinnedTabs.length > 0 && (
              <div
                className={cn(
                  "flex h-full shrink-0 items-end bg-background/60",
                  scrollableTabs.length > 0 && "border-r",
                )}
              >
                {pinnedTabs.map((tab, idx) => renderTab(tab, idx))}
              </div>
            )}
            <div className="relative h-full min-w-0 flex-1">
              <div
                ref={tabScrollRef}
                className="h-full overflow-x-auto overflow-y-hidden"
              >
                <div className="flex h-full min-w-max items-end">
            {scrollableTabs.map((tab, idx) => {
              const isActive = tab.id === tree.activeTabId;
              const isDragTarget = dragOverTabId === tab.id;
              const actualIdx = pinnedTabs.length + idx;
              return (
                <div
                  key={tab.id}
                  role="tab"
                  aria-selected={isActive}
                  aria-label={`${tab.title} (${TAB_TYPE_LABELS[tab.type] ?? tab.type})`}
                  tabIndex={isActive ? 0 : -1}
                  data-tab-id={tab.id}
                  className={cn(
                    "group flex items-center gap-1 h-full px-2 text-xs cursor-pointer select-none shrink-0 transition-all border-b-2",
                    isActive
                      ? "border-primary bg-background text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground hover:bg-accent/40",
                    isDragTarget && "border-l-2 border-l-primary",
                  )}
                  draggable
                  onDragStart={(e) => handleDragStart(e, tab.id, tree.id)}
                  onDragEnter={(e) => handleDragEnter(e, tab.id)}
                  onDragOver={handleDragOver}
                  onDragLeave={() => setDragOverTabId(null)}
                  onDragEnd={handleDragEnd}
                  onDrop={(e) => {
                    e.stopPropagation(); // prevent container drop
                    handleDrop(e, tree.id, actualIdx);
                  }}
                  onClick={() => setActiveTab(tab.id, tree.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setActiveTab(tab.id, tree.id);
                      return;
                    }

                    if (
                      e.key !== "ArrowRight" &&
                      e.key !== "ArrowLeft" &&
                      e.key !== "Home" &&
                      e.key !== "End"
                    ) {
                      return;
                    }

                    const tabEls = Array.from(
                      document.querySelectorAll<HTMLElement>(
                        `[data-leaf-id="${tree.id}"] [role="tab"]`,
                      ),
                    );
                    if (tabEls.length === 0) return;

                    let nextIndex = actualIdx;
                    if (e.key === "ArrowRight") {
                      nextIndex = (actualIdx + 1) % tabEls.length;
                    } else if (e.key === "ArrowLeft") {
                      nextIndex = (actualIdx - 1 + tabEls.length) % tabEls.length;
                    } else if (e.key === "Home") {
                      nextIndex = 0;
                    } else if (e.key === "End") {
                      nextIndex = tabEls.length - 1;
                    }

                    e.preventDefault();
                    tabEls[nextIndex]?.focus();
                    const nextTabId = tabEls[nextIndex]?.dataset.tabId;
                    if (nextTabId) {
                      setActiveTab(nextTabId, tree.id);
                    }
                  }}
                  onAuxClick={(e) => {
                    if (e.button === 1) {
                      e.preventDefault();
                      if (
                        tab.dirty &&
                        !window.confirm(
                          "You have unsaved changes. Are you sure you want to close this tab?",
                        )
                      ) {
                        return;
                      }
                      closeTab(tab.id, tree.id);
                    }
                  }}
                  onMouseDown={(e) => {
                    if (e.button === 1) e.preventDefault();
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setContextMenu({
                      x: e.clientX,
                      y: e.clientY,
                      tabId: tab.id,
                    });
                  }}
                >
                  {tabIcon(tab.type, isActive)}
                  {renamingTabId === tab.id ? (
                    <input
                      autoFocus
                      value={renameValue}
                      className="max-w-30 bg-background border border-primary rounded px-1 text-xs outline-none"
                      onChange={e => setRenameValue(e.target.value)}
                      onBlur={() => {
                        if (renameValue.trim()) updateTab(tab.id, { title: renameValue.trim() });
                        setRenamingTabId(null);
                      }}
                      onKeyDown={e => {
                        if (e.key === "Enter") {
                          if (renameValue.trim()) updateTab(tab.id, { title: renameValue.trim() });
                          setRenamingTabId(null);
                        } else if (e.key === "Escape") {
                          setRenamingTabId(null);
                        }
                        e.stopPropagation();
                      }}
                      onClick={e => e.stopPropagation()}
                    />
                  ) : (
                    <span
                      className="truncate max-w-30"
                      onDoubleClick={e => {
                        e.stopPropagation();
                        setRenamingTabId(tab.id);
                        setRenameValue(tab.title);
                      }}
                    >
                      {tab.title}
                    </span>
                  )}
                  {/* Pin button — visible on hover or when pinned */}
                  <button
                    onClick={(e) => { e.stopPropagation(); togglePinTab(tab.id, tree.id); }}
                    className={cn(
                      "ml-0.5 p-0.5 rounded hover:bg-muted/80 transition-opacity",
                      tab.pinned ? "opacity-100 text-primary" : "opacity-0 group-hover:opacity-60"
                    )}
                    aria-label={tab.pinned ? "Unpin tab" : "Pin tab"}
                    title={tab.pinned ? "Unpin tab" : "Pin tab"}
                  >
                    {tab.pinned
                      ? <Pin className="w-2.5 h-2.5" />
                      : <PinOff className="w-2.5 h-2.5" />
                    }
                  </button>
                  {/* Close button — hidden for pinned tabs */}
                  {!tab.pinned && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (tab.dirty && !window.confirm("You have unsaved changes. Are you sure you want to close this tab?")) {
                          return;
                        }
                        closeTab(tab.id, tree.id);
                      }}
                      className={cn(
                        "ml-0.5 p-0.5 rounded hover:bg-muted/80 transition-opacity group/close",
                        tab.dirty ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                      )}
                      aria-label="Close tab"
                    >
                      {tab.dirty ? (
                        <>
                          <Circle className="w-2 h-2 fill-current opacity-80 group-hover/close:hidden" />
                          <X className="w-3 h-3 hidden group-hover/close:block" />
                        </>
                      ) : (
                        <X className="w-3 h-3" />
                      )}
                    </button>
                  )}
                </div>
              );
            })}
                </div>
              </div>
              {tabOverflow.start && (
                <div className="pointer-events-none absolute inset-y-0 left-0 w-6 bg-gradient-to-r from-muted/80 via-muted/30 to-transparent" />
              )}
              {tabOverflow.end && (
                <div className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-muted/80 via-muted/30 to-transparent" />
              )}
            </div>
            {/* New tab button */}
            <button
              onClick={() => {
                const entries = Object.entries(connectedProfiles);
                const meta: Record<string, string> = {};
                if (entries.length > 0) {
                  meta.profileId = entries[0][0];
                  meta.profileName = entries[0][1].name;
                }
                openTab({ title: "New Query", type: "sql", meta }, tree.id);
              }}
              className="h-full px-2 text-muted-foreground hover:text-foreground hover:bg-accent/40 transition-colors shrink-0"
              title="New SQL Query (Ctrl+N)"
              aria-label="New SQL Query (Ctrl+N)"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>

            <div className="mx-1 h-4 w-px bg-border/60 shrink-0" />

            {/* Pane Actions (always visible on hover of the tab bar, or just keep them subtle) */}
            <div className="flex items-center px-2 py-1 gap-1 shrink-0">
              <button
                onClick={() => splitLeaf(tree.id, "horizontal")}
                className="p-1 rounded text-muted-foreground/60 hover:text-foreground hover:bg-accent/60 transition-colors"
                title="Split Right"
                aria-label="Split Right"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2" /><line x1="15" x2="15" y1="3" y2="21" /></svg>
              </button>
              <button
                onClick={() => splitLeaf(tree.id, "vertical")}
                className="p-1 rounded text-muted-foreground/60 hover:text-foreground hover:bg-accent/60 transition-colors"
                title="Split Down"
                aria-label="Split Down"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2" /><line x1="3" x2="21" y1="15" y2="15" /></svg>
              </button>
              <button
                onClick={() => {
                  if (checkDirtyTabs(tree.tabs)) {
                    closeLeaf(tree.id);
                  }
                }}
                className="p-1 rounded text-muted-foreground/60 hover:text-red-400 hover:bg-red-400/10 transition-colors ml-1"
                title="Close Pane"
                aria-label="Close Pane"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>

        {/* Context Menu Dropdown */}
        {contextMenu && (
          <div
            className="fixed z-50 min-w-40 bg-popover text-popover-foreground border rounded-md shadow-md p-1 text-xs"
            style={{
              top: contextMenu.y,
              left: contextMenu.x,
            }}
          >
            {/* Pin / Unpin */}
            <button
              className="w-full text-left px-2 py-1.5 hover:bg-accent rounded text-foreground flex items-center gap-2"
              onClick={() => {
                togglePinTab(contextMenu.tabId, tree.id);
                setContextMenu(null);
              }}
            >
              {tree.tabs.find(t => t.id === contextMenu.tabId)?.pinned
                ? <><PinOff className="w-3 h-3" /> Unpin Tab</>
                : <><Pin className="w-3 h-3" /> Pin Tab</>
              }
            </button>
            <div className="h-px bg-border my-1" />
            <button
              className="w-full text-left px-2 py-1.5 hover:bg-accent rounded text-foreground flex justify-between items-center"
              onClick={() => {
                const tab = tree.tabs.find(t => t.id === contextMenu.tabId);
                if (tab?.pinned) { setContextMenu(null); return; }
                if (tab?.dirty && !window.confirm("You have unsaved changes. Are you sure you want to close this tab?")) {
                  setContextMenu(null);
                  return;
                }
                closeTab(contextMenu.tabId, tree.id);
                setContextMenu(null);
              }}
            >
              <span>Close</span>
              <span className="text-muted-foreground text-opacity-70 text-[10px]">
                Ctrl+W
              </span>
            </button>
            <button
              className="w-full text-left px-2 py-1.5 hover:bg-accent rounded text-foreground"
              onClick={() => {
                const toClose = tree.tabs.filter(t => t.id !== contextMenu.tabId);
                if (checkDirtyTabs(toClose)) {
                  closeOtherTabs(contextMenu.tabId, tree.id);
                }
                setContextMenu(null);
              }}
            >
              Close Others
            </button>
            <button
              className="w-full text-left px-2 py-1.5 hover:bg-accent rounded text-foreground"
              onClick={() => {
                const tabIndex = tree.tabs.findIndex((t) => t.id === contextMenu.tabId);
                const toClose = tree.tabs.slice(tabIndex + 1);
                if (checkDirtyTabs(toClose)) {
                  closeTabsToRight(contextMenu.tabId, tree.id);
                }
                setContextMenu(null);
              }}
            >
              Close to the Right
            </button>
            <div className="h-px bg-border my-1" />
            <button
              className="w-full text-left px-2 py-1.5 hover:bg-accent rounded text-foreground"
              onClick={() => {
                if (checkDirtyTabs(tree.tabs)) {
                  closeAllTabs(tree.id);
                }
                setContextMenu(null);
              }}
            >
              Close All
            </button>
          </div>
        )}

        {/* Tab content */}
        <div className="flex-1 min-w-0 overflow-hidden relative">
          {tree.activeTabId ? (
            tree.tabs.map((tab) => (
              <div
                key={tab.id}
                className={cn(
                  "w-full h-full",
                  tab.id === tree.activeTabId ? "block" : "hidden",
                )}
              >
                <TabContent tab={tab} leafId={tree.id} />
              </div>
            ))
          ) : (
            <WelcomeTab />
          )}

          {/* Edge drop zones — only visible when a tab drag is in progress */}
          {isDragging && (
            <>
              {/* Right edge → horizontal split */}
              <div
                className={cn(
                  "absolute top-0 right-0 h-full w-[20%] z-50 flex items-center justify-center transition-colors",
                  dragOverSplit === "horizontal"
                    ? "bg-primary/20 border-r-2 border-primary"
                    : "bg-transparent"
                )}
                onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); setDragOverSplit("horizontal"); setIsDragOverPane(false); }}
                onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = "move"; }}
                onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverSplit(null); }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setDragOverSplit(null);
                  if (activeDragPayload) {
                    splitLeafAndMove(activeDragPayload.tabId, activeDragPayload.sourceLeafId, tree.id, "horizontal");
                    activeDragPayload = null;
                  }
                }}
              >
                {dragOverSplit === "horizontal" && (
                  <span className="text-[10px] text-primary font-semibold pointer-events-none">Split Right</span>
                )}
              </div>

              {/* Bottom edge → vertical split */}
              <div
                className={cn(
                  "absolute bottom-0 left-0 w-full h-[20%] z-50 flex items-center justify-center transition-colors",
                  dragOverSplit === "vertical"
                    ? "bg-primary/20 border-b-2 border-primary"
                    : "bg-transparent"
                )}
                onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); setDragOverSplit("vertical"); setIsDragOverPane(false); }}
                onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = "move"; }}
                onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverSplit(null); }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setDragOverSplit(null);
                  if (activeDragPayload) {
                    splitLeafAndMove(activeDragPayload.tabId, activeDragPayload.sourceLeafId, tree.id, "vertical");
                    activeDragPayload = null;
                  }
                }}
              >
                {dragOverSplit === "vertical" && (
                  <span className="text-[10px] text-primary font-semibold pointer-events-none">Split Down</span>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  const isVert = tree.direction === "vertical";

  return (
    <div
      className={cn(
        "flex w-full h-full relative overflow-hidden",
        isVert ? "flex-col" : "flex-row",
      )}
    >
      <div
        className="relative min-w-0 min-h-0"
        style={{ [isVert ? "height" : "width"]: `${tree.ratio * 100}%` }}
      >
        <EditorNode tree={tree.a} />
      </div>

      <Sash
        className={
          isVert
            ? "relative h-[4px] w-full cursor-row-resize flex-shrink-0 -my-[2px]"
            : "relative w-[4px] h-full cursor-col-resize flex-shrink-0 -mx-[2px]"
        }
        direction={tree.direction}
        onDrag={(delta) => {
          const container = window.document.getElementById(
            `editor-node-${tree.id}`,
          );
          if (!container) return;
          const totalSize = isVert
            ? container.clientHeight
            : container.clientWidth;
          if (totalSize === 0) return;
          const ratioChange = delta / totalSize;
          const newRatio = Math.min(
            Math.max(tree.ratio + ratioChange, 0.1),
            0.9,
          );
          resizeNode(tree.id, newRatio);
        }}
      />

      <div className="flex-1 relative min-w-0 min-h-0">
        <EditorNode tree={tree.b} />
      </div>

      <div
        id={`editor-node-${tree.id}`}
        className="absolute inset-0 pointer-events-none z-[-1]"
      />
    </div>
  );
});
