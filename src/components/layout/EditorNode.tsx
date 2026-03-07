import { useState, useEffect, Suspense, lazy, memo } from "react";
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
const TableDataTab = lazy(() =>
  import("@/components/views/TableDataTab").then((m) => ({
    default: m.TableDataTab,
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
            profileId={tab.meta?.profileId ?? ""}
            database={tab.meta?.database}
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

function tabIcon(type: EditorTab["type"], isActive: boolean) {
  const cls = cn(
    "w-3.5 h-3.5 shrink-0",
    isActive ? "text-primary" : "text-muted-foreground/60",
  );
  switch (type) {
    case "sql":
      return <Terminal className={cls} />;
    case "database-view":
      return <Database className={cls} />;
    case "table-designer":
      return <Table2 className={cls} />;
    case "table-data":
      return <Rows3 className={cls} />;
    case "models":
      return <Boxes className={cls} />;
    case "tasks":
      return <ListChecks className={cls} />;
    default:
      return <FileText className={cls} />;
  }
}

export function EditorNode({ tree }: { tree: SplitTree }) {
  const resizeNode = useLayoutStore((s) => s.resizeNode);
  const openTab = useLayoutStore((s) => s.openTab);
  const closeTab = useLayoutStore((s) => s.closeTab);
  const closeOtherTabs = useLayoutStore((s) => s.closeOtherTabs);
  const closeTabsToRight = useLayoutStore((s) => s.closeTabsToRight);
  const closeAllTabs = useLayoutStore((s) => s.closeAllTabs);
  const splitLeaf = useLayoutStore((s) => s.splitLeaf);
  const closeLeaf = useLayoutStore((s) => s.closeLeaf);
  const setActiveLeaf = useLayoutStore((s) => s.setActiveLeaf);
  const setActiveTab = useLayoutStore((s) => s.setActiveTab);
  const connectedProfiles = useSchemaStore((s) => s.connectedProfiles);
  const activeLeafId = useLayoutStore((s) => s.activeLeafId);
  const isSplit = useLayoutStore((s) => s.editorTree.type !== "leaf");

  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    tabId: string;
  } | null>(null);

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
    return (
      <div
        className={cn(
          "flex-1 w-full h-full bg-background border rounded-sm overflow-hidden flex flex-col transition-colors",
          isLeafActive && isSplit ? "border-primary/50" : "border-border"
        )}
        onClickCapture={() => setActiveLeaf(tree.id)}
      >
        {/* Tab bar */}
        <div
          className="shrink-0 relative border-b bg-muted/30"
          style={{ height: 29 }}
        >
          <div className="absolute inset-0 flex items-end overflow-x-auto overflow-y-hidden">
            {tree.tabs.map((tab) => {
              const isActive = tab.id === tree.activeTabId;
              return (
                <div
                  key={tab.id}
                  className={cn(
                    "group flex items-center gap-1 h-full px-2 text-xs cursor-pointer select-none shrink-0 transition-all border-b-2",
                    isActive
                      ? "border-primary bg-background text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground hover:bg-accent/40",
                  )}
                  onClick={() => setActiveTab(tab.id, tree.id)}
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
                  <span className="truncate max-w-30">{tab.title}</span>
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
                </div>
              );
            })}
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
            >
              <Plus className="w-3.5 h-3.5" />
            </button>

            {/* Spacer to push actions to the right */}
            <div className="flex-1 min-w-[20px]" />

            {/* Pane Actions (always visible on hover of the tab bar, or just keep them subtle) */}
            <div className="flex items-center px-2 py-1 gap-1 shrink-0">
              <button
                onClick={() => splitLeaf(tree.id, "horizontal")}
                className="p-1 rounded text-muted-foreground/60 hover:text-foreground hover:bg-accent/60 transition-colors"
                title="Split Right"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2" /><line x1="15" x2="15" y1="3" y2="21" /></svg>
              </button>
              <button
                onClick={() => splitLeaf(tree.id, "vertical")}
                className="p-1 rounded text-muted-foreground/60 hover:text-foreground hover:bg-accent/60 transition-colors"
                title="Split Down"
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
            <button
              className="w-full text-left px-2 py-1.5 hover:bg-accent rounded text-foreground flex justify-between items-center"
              onClick={() => {
                const tab = tree.tabs.find(t => t.id === contextMenu.tabId);
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
}
