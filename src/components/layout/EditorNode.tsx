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
} from "lucide-react";
import { useSchemaStore } from "@/state/schemaStore";
import { WelcomeTab } from "@/components/views/WelcomeTab";
import { TabContainer, Tab, TabContextMenuItem } from "@/components/ui/TabContainer";

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
const TabContent = memo(function TabContent({ tab, leafId }: { tab: EditorTab; leafId: string }) {
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
  schema: "Schema Diagram",
  "database-view": "Database View",
  "table-designer": "Table Designer",
  "table-data": "Table Data",
  models: "AI Models",
  tasks: "Tasks",
  settings: "Settings",
};

function tabIcon(type: EditorTab["type"], isActive: boolean): React.ReactNode {
  const cls = cn(
    "w-3.5 h-3.5 shrink-0",
    isActive ? "text-primary" : "text-muted-foreground/60",
  );
  switch (type) {
    case "sql":            return <Terminal className={cls} />;
    case "schema":         return <Database className={cls} />;
    case "database-view":  return <Database className={cls} />;
    case "table-designer": return <Table2 className={cls} />;
    case "table-data":     return <Rows3 className={cls} />;
    case "models":         return <Boxes className={cls} />;
    case "tasks":          return <ListChecks className={cls} />;
    default:               return <FileText className={cls} />;
  }
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

  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [isDragOverPane, setIsDragOverPane] = useState<boolean>(false);
  const [dragOverSplit, setDragOverSplit] = useState<"horizontal" | "vertical" | null>(null);
  const [renamingTabId, setRenamingTabId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  // Track any drag-in-progress globally so all panes can show edge drop zones
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

  // Shortcut for closing active tab (Ctrl+W)
  useEffect(() => {
    if (tree.type !== "leaf") return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key.toLowerCase() === "w") {
        e.preventDefault();
        if (tree.activeTabId && activeLeafId === tree.id) {
          const activeTab = tree.tabs.find((t) => t.id === tree.activeTabId);
          if (
            activeTab?.dirty &&
            !window.confirm("You have unsaved changes. Are you sure you want to close this tab?")
          ) {
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
    const dirtyCount = tabsToClose.filter((t) => t.dirty).length;
    if (dirtyCount > 0) {
      return window.confirm(
        `You have ${dirtyCount} tab(s) with unsaved changes. Are you sure you want to close them?`,
      );
    }
    return true;
  };

  if (tree.type === "leaf") {
    const isLeafActive = activeLeafId === tree.id;

    const tabItems: Tab[] = treeTabs.map((tab) => ({
      id: tab.id,
      label: tab.title,
      icon: tabIcon(tab.type, tab.id === treeActiveTabId),
      dirty: tab.dirty,
      pinned: tab.pinned,
      title: TAB_TYPE_LABELS[tab.type] ?? tab.type,
    }));

    const ctxMenuItems: TabContextMenuItem[] = [
      {
        label: "Close Others",
        onClick: (tabId) => {
          const toClose = treeTabs.filter((t) => t.id !== tabId);
          if (checkDirtyTabs(toClose)) closeOtherTabs(tabId, tree.id);
        },
      },
      {
        label: "Close to the Right",
        onClick: (tabId) => {
          const tabIndex = treeTabs.findIndex((t) => t.id === tabId);
          const toClose = treeTabs.slice(tabIndex + 1);
          if (checkDirtyTabs(toClose)) closeTabsToRight(tabId, tree.id);
        },
      },
      {
        label: "Close All",
        separator: true,
        onClick: () => {
          if (checkDirtyTabs(treeTabs)) closeAllTabs(tree.id);
        },
      },
    ];

    return (
      <div
        className={cn(
          "flex-1 w-full h-full bg-background border rounded-sm overflow-hidden flex flex-col transition-colors",
          isLeafActive && isSplit ? "border-primary/50" : "border-border",
          isDragOverPane && "ring-2 ring-primary bg-primary/5",
        )}
        onClickCapture={() => setActiveLeaf(tree.id)}
        onDragEnter={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          setIsDragOverPane(true);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) {
            setIsDragOverPane(false);
          }
        }}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragOverPane(false);
          if (activeDragPayload) {
            moveTab(activeDragPayload.tabId, activeDragPayload.sourceLeafId, tree.id);
            activeDragPayload = null;
          }
        }}
      >
        {/* Tab bar — handled by TabContainer */}
        <TabContainer
          tabs={tabItems}
          activeTabId={treeActiveTabId}
          className="shrink-0 h-[29px]"
          onTabClick={(id) => setActiveTab(id, tree.id)}
          onTabClose={(id) => {
            const tab = treeTabs.find((t) => t.id === id);
            if (
              tab?.dirty &&
              !window.confirm("You have unsaved changes. Are you sure you want to close this tab?")
            ) return;
            closeTab(id, tree.id);
          }}
          onTabPin={(id) => togglePinTab(id, tree.id)}
          onTabReorder={(draggedId, targetId) => {
            const targetIdx = treeTabs.findIndex((t) => t.id === targetId);
            const sourceLeafId = activeDragPayload?.sourceLeafId ?? tree.id;
            moveTab(draggedId, sourceLeafId, tree.id, targetIdx);
          }}
          onTabDragStart={(tabId) => {
            activeDragPayload = { tabId, sourceLeafId: tree.id };
          }}
          onTabDragEnd={() => {
            activeDragPayload = null;
            setIsDragOverPane(false);
          }}
          onTabDoubleClick={(id) => {
            const tab = treeTabs.find((t) => t.id === id);
            if (tab) {
              setRenamingTabId(id);
              setRenameValue(tab.title);
            }
          }}
          onTabAuxClick={(id) => {
            const tab = treeTabs.find((t) => t.id === id);
            if (
              tab?.dirty &&
              !window.confirm("You have unsaved changes. Are you sure you want to close this tab?")
            ) return;
            closeTab(id, tree.id);
          }}
          contextMenuItems={ctxMenuItems}
          renderLabel={(tab) => {
            if (renamingTabId !== tab.id) return null;
            return (
              <input
                autoFocus
                value={renameValue}
                className="max-w-30 bg-background border border-primary rounded px-1 text-xs outline-none"
                onChange={(e) => setRenameValue(e.target.value)}
                onBlur={() => {
                  if (renameValue.trim()) updateTab(tab.id, { title: renameValue.trim() });
                  setRenamingTabId(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    if (renameValue.trim()) updateTab(tab.id, { title: renameValue.trim() });
                    setRenamingTabId(null);
                  } else if (e.key === "Escape") {
                    setRenamingTabId(null);
                  }
                  e.stopPropagation();
                }}
                onClick={(e) => e.stopPropagation()}
              />
            );
          }}
          actions={
            <>
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
                className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-accent/40 transition-colors rounded"
                title="New SQL Query (Ctrl+N)"
                aria-label="New SQL Query (Ctrl+N)"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
              <div className="mx-1 h-4 w-px bg-border/60 shrink-0" />
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
                onClick={() => { if (checkDirtyTabs(treeTabs)) closeLeaf(tree.id); }}
                className="p-1 rounded text-muted-foreground/60 hover:text-red-400 hover:bg-red-400/10 transition-colors"
                title="Close Pane"
                aria-label="Close Pane"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </>
          }
        />

        {/* Tab content */}
        <div className="flex-1 min-w-0 overflow-hidden relative">
          {treeActiveTabId ? (
            treeTabs.map((tab) => (
              <div
                key={tab.id}
                className={cn(
                  "w-full h-full",
                  tab.id === treeActiveTabId ? "block" : "hidden",
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
                    : "bg-transparent",
                )}
                onDragEnter={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setDragOverSplit("horizontal");
                  setIsDragOverPane(false);
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  e.dataTransfer.dropEffect = "move";
                }}
                onDragLeave={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverSplit(null);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setDragOverSplit(null);
                  if (activeDragPayload) {
                    splitLeafAndMove(
                      activeDragPayload.tabId,
                      activeDragPayload.sourceLeafId,
                      tree.id,
                      "horizontal",
                    );
                    activeDragPayload = null;
                  }
                }}
              >
                {dragOverSplit === "horizontal" && (
                  <span className="text-[10px] text-primary font-semibold pointer-events-none">
                    Split Right
                  </span>
                )}
              </div>

              {/* Bottom edge → vertical split */}
              <div
                className={cn(
                  "absolute bottom-0 left-0 w-full h-[20%] z-50 flex items-center justify-center transition-colors",
                  dragOverSplit === "vertical"
                    ? "bg-primary/20 border-b-2 border-primary"
                    : "bg-transparent",
                )}
                onDragEnter={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setDragOverSplit("vertical");
                  setIsDragOverPane(false);
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  e.dataTransfer.dropEffect = "move";
                }}
                onDragLeave={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverSplit(null);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setDragOverSplit(null);
                  if (activeDragPayload) {
                    splitLeafAndMove(
                      activeDragPayload.tabId,
                      activeDragPayload.sourceLeafId,
                      tree.id,
                      "vertical",
                    );
                    activeDragPayload = null;
                  }
                }}
              >
                {dragOverSplit === "vertical" && (
                  <span className="text-[10px] text-primary font-semibold pointer-events-none">
                    Split Down
                  </span>
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
          const container = window.document.getElementById(`editor-node-${tree.id}`);
          if (!container) return;
          const totalSize = isVert ? container.clientHeight : container.clientWidth;
          if (totalSize === 0) return;
          const ratioChange = delta / totalSize;
          const newRatio = Math.min(Math.max(tree.ratio + ratioChange, 0.1), 0.9);
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
