import { useState, useEffect } from "react";
import { useLayoutStore, SplitTree, EditorTab } from "@/state/layoutStore";
import { Sash } from "./Sash";
import { cn } from "@/lib/utils/cn";
import { X, Plus } from "lucide-react";
import { WelcomeTab } from "@/components/views/WelcomeTab";
import { ModelsPage } from "@/components/views/ModelsPage";
import { TasksView } from "@/components/views/TasksView";
import { DatabaseView } from "@/components/views/DatabaseView";
import { TableDesigner } from "@/components/views/TableDesigner";
import { CodeEditorShell } from "@/components/ui/CodeEditorShell";

function TabContent({ tab }: { tab: EditorTab }) {
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
                    profileId={tab.meta?.profileId ?? ""}
                    database={tab.meta?.database ?? ""}
                    tableName={tab.meta?.tableName}
                />
            );
        case "sql":
            return (
                <div className="w-full h-full p-2">
                    <CodeEditorShell value="" language="sql" />
                </div>
            );
        default:
            return (
                <div className="w-full h-full flex items-center justify-center text-muted-foreground text-sm">
                    {tab.title}
                </div>
            );
    }
}

export function EditorNode({ tree }: { tree: SplitTree }) {
    const { resizeNode, openTab, closeTab, closeOtherTabs, closeTabsToRight, closeAllTabs, setActiveTab } = useLayoutStore();

    const [contextMenu, setContextMenu] = useState<{ x: number; y: number; tabId: string } | null>(null);

    // Global click listener to close context menu
    useEffect(() => {
        const handleClick = () => setContextMenu(null);
        window.addEventListener("click", handleClick);
        return () => window.removeEventListener("click", handleClick);
    }, []);

    // Shortcut for closing active tab (Ctrl+W)
    useEffect(() => {
        if (tree.type !== "leaf") return;

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.ctrlKey && e.key.toLowerCase() === "w") {
                e.preventDefault();
                if (tree.activeTabId) {
                    closeTab(tree.activeTabId, tree.id);
                }
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [tree, closeTab]);

    if (tree.type === "leaf") {
        const activeTab = tree.tabs.find((t) => t.id === tree.activeTabId) ?? null;

        return (
            <div className="flex-1 w-full h-full bg-background border rounded-sm overflow-hidden flex flex-col">
                {/* Tab bar */}
                <div className="h-9 border-b flex items-center bg-muted/30 overflow-x-auto">
                    {tree.tabs.map((tab) => (
                        <div
                            key={tab.id}
                            className={cn(
                                "flex items-center gap-1 h-full px-3 text-xs cursor-pointer border-r select-none shrink-0 transition-colors",
                                tab.id === tree.activeTabId
                                    ? "bg-background text-foreground font-medium"
                                    : "text-muted-foreground hover:bg-background/50"
                            )}
                            onClick={() => setActiveTab(tab.id, tree.id)}
                            onContextMenu={(e) => {
                                e.preventDefault();
                                setContextMenu({ x: e.clientX, y: e.clientY, tabId: tab.id });
                            }}
                        >
                            <span className="truncate max-w-[120px]">{tab.title}</span>
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    closeTab(tab.id, tree.id);
                                }}
                                className="ml-1 p-0.5 rounded hover:bg-muted"
                            >
                                <X className="w-3 h-3" />
                            </button>
                        </div>
                    ))}
                    {/* New tab button */}
                    <button
                        onClick={() => openTab({ title: "New Query", type: "sql" }, tree.id)}
                        className="h-full px-2 text-muted-foreground hover:text-foreground hover:bg-background/50 transition-colors"
                        title="New SQL Query (Ctrl+N)"
                    >
                        <Plus className="w-3.5 h-3.5" />
                    </button>

                    {/* Context Menu Dropdown */}
                    {contextMenu && (
                        <div
                            className="fixed z-50 min-w-[160px] bg-popover text-popover-foreground border rounded-md shadow-md p-1 text-xs"
                            style={{
                                top: contextMenu.y,
                                left: contextMenu.x,
                            }}
                        >
                            <button
                                className="w-full text-left px-2 py-1.5 hover:bg-accent rounded text-foreground flex justify-between items-center"
                                onClick={() => {
                                    closeTab(contextMenu.tabId, tree.id);
                                    setContextMenu(null);
                                }}
                            >
                                <span>Close</span>
                                <span className="text-muted-foreground text-opacity-70 text-[10px]">Ctrl+W</span>
                            </button>
                            <button
                                className="w-full text-left px-2 py-1.5 hover:bg-accent rounded text-foreground"
                                onClick={() => {
                                    closeOtherTabs(contextMenu.tabId, tree.id);
                                    setContextMenu(null);
                                }}
                            >
                                Close Others
                            </button>
                            <button
                                className="w-full text-left px-2 py-1.5 hover:bg-accent rounded text-foreground"
                                onClick={() => {
                                    closeTabsToRight(contextMenu.tabId, tree.id);
                                    setContextMenu(null);
                                }}
                            >
                                Close to the Right
                            </button>
                            <div className="h-px bg-border my-1" />
                            <button
                                className="w-full text-left px-2 py-1.5 hover:bg-accent rounded text-foreground"
                                onClick={() => {
                                    closeAllTabs(tree.id);
                                    setContextMenu(null);
                                }}
                            >
                                Close All
                            </button>
                        </div>
                    )}
                </div>

                {/* Tab content */}
                <div className="flex-1 overflow-auto relative">
                    {activeTab ? (
                        <TabContent tab={activeTab} />
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
                isVert ? "flex-col" : "flex-row"
            )}
        >
            <div
                className="relative"
                style={{ [isVert ? "height" : "width"]: `${tree.ratio * 100}%` }}
            >
                <EditorNode tree={tree.a} />
            </div>

            <Sash
                className={isVert ? "h-2 w-full left-0 cursor-row-resize z-[60]" : "w-2 h-full top-0 cursor-col-resize z-[60]"}
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

            <div className="flex-1 relative">
                <EditorNode tree={tree.b} />
            </div>

            <div id={`editor-node-${tree.id}`} className="absolute inset-0 pointer-events-none z-[-1]" />
        </div>
    );
}
