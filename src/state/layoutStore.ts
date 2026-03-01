import { create } from "zustand";

export type SplitDirection = "horizontal" | "vertical";

export type EditorTabType = "sql" | "results" | "schema" | "models" | "tasks" | "database-view" | "table-designer";

export interface EditorTab {
    id: string;
    title: string;
    type: EditorTabType;
    dirty?: boolean;
    /** Arbitrary metadata for domain-specific tabs */
    meta?: Record<string, string>;
}

export interface SplitLeaf {
    type: "leaf";
    id: string;
    tabs: EditorTab[];
    activeTabId: string | null;
}

export interface SplitNode {
    type: "node";
    id: string;
    direction: SplitDirection;
    ratio: number;
    a: SplitTree;
    b: SplitTree;
}

export type SplitTree = SplitLeaf | SplitNode;

export type ActivityView = "explorer" | "servers" | "models" | "tasks";

interface LayoutState {
    activityBarWidth: number;
    primarySidebarWidth: number;
    secondarySidebarWidth: number;
    bottomPanelHeight: number;

    isPrimarySidebarVisible: boolean;
    isSecondarySidebarVisible: boolean;
    isBottomPanelVisible: boolean;

    activeView: ActivityView;
    editorTree: SplitTree;

    setActiveView: (view: ActivityView) => void;
    setSidebarWidth: (width: number) => void;
    adjustSidebarWidth: (delta: number) => void;
    setPanelHeight: (height: number) => void;
    adjustPanelHeight: (delta: number) => void;
    toggleSidebar: () => void;
    togglePanel: () => void;

    // Tab operations
    openTab: (tab: Omit<EditorTab, "id">, leafId?: string) => void;
    closeTab: (tabId: string, leafId: string) => void;
    closeOtherTabs: (tabId: string, leafId: string) => void;
    closeTabsToRight: (tabId: string, leafId: string) => void;
    closeAllTabs: (leafId: string) => void;

    setActiveTab: (tabId: string, leafId: string) => void;
    updateTab: (tabId: string, updates: Partial<Pick<EditorTab, "title" | "meta">>) => void;

    // Editor tree operations
    splitLeaf: (leafId: string, direction: SplitDirection) => void;
    closeLeaf: (leafId: string) => void;
    resizeNode: (nodeId: string, newRatio: number) => void;
}

// Find the first leaf in the tree
function findFirstLeaf(tree: SplitTree): SplitLeaf {
    if (tree.type === "leaf") return tree;
    return findFirstLeaf(tree.a);
}

// Update a specific leaf in the tree
function updateLeaf(tree: SplitTree, leafId: string, updater: (leaf: SplitLeaf) => SplitLeaf): SplitTree {
    if (tree.type === "leaf") {
        return tree.id === leafId ? updater(tree) : tree;
    }
    return {
        ...tree,
        a: updateLeaf(tree.a, leafId, updater),
        b: updateLeaf(tree.b, leafId, updater),
    };
}

export const useLayoutStore = create<LayoutState>((set) => ({
    activityBarWidth: 48,
    primarySidebarWidth: 260,
    secondarySidebarWidth: 200,
    bottomPanelHeight: 300,

    isPrimarySidebarVisible: true,
    isSecondarySidebarVisible: false,
    isBottomPanelVisible: false,

    activeView: "explorer",

    editorTree: {
        type: "leaf",
        id: "root-editor",
        tabs: [],
        activeTabId: null,
    },

    setActiveView: (view) =>
        set((state) => ({
            activeView: view,
            isPrimarySidebarVisible: state.activeView === view && state.isPrimarySidebarVisible
                ? false
                : true,
        })),

    setSidebarWidth: (width) => set({ primarySidebarWidth: Math.max(180, Math.min(width, 600)) }),
    adjustSidebarWidth: (delta) =>
        set((state) => ({ primarySidebarWidth: Math.max(180, Math.min(state.primarySidebarWidth + delta, 600)) })),
    setPanelHeight: (height) => set({ bottomPanelHeight: Math.max(100, Math.min(height, 600)) }),
    adjustPanelHeight: (delta) =>
        set((state) => ({ bottomPanelHeight: Math.max(100, Math.min(state.bottomPanelHeight + delta, 600)) })),

    toggleSidebar: () => set((state) => ({ isPrimarySidebarVisible: !state.isPrimarySidebarVisible })),
    togglePanel: () => set((state) => ({ isBottomPanelVisible: !state.isBottomPanelVisible })),

    openTab: (tabData, leafId) =>
        set((state) => {
            const targetLeaf = leafId
                ? findLeafById(state.editorTree, leafId)
                : findFirstLeaf(state.editorTree);
            if (!targetLeaf) return state;

            // Build a dedup key: for database-view tabs, use profileId+database;
            // for others, don't dedup
            let existing: EditorTab | undefined;
            if (tabData.type === "database-view" && tabData.meta) {
                const key = `${tabData.meta.profileId}::${tabData.meta.database}`;
                existing = targetLeaf.tabs.find(
                    (t) => t.type === "database-view" && t.meta && `${t.meta.profileId}::${t.meta.database}` === key
                );
            }

            if (existing) {
                return {
                    editorTree: updateLeaf(state.editorTree, targetLeaf.id, (leaf) => ({
                        ...leaf,
                        activeTabId: existing!.id,
                    })),
                };
            }

            const newTab: EditorTab = { ...tabData, id: `tab-${crypto.randomUUID()}` };
            return {
                editorTree: updateLeaf(state.editorTree, targetLeaf.id, (leaf) => ({
                    ...leaf,
                    tabs: [...leaf.tabs, newTab],
                    activeTabId: newTab.id,
                })),
            };
        }),

    closeTab: (tabId, leafId) =>
        set((state) => ({
            editorTree: updateLeaf(state.editorTree, leafId, (leaf) => {
                const newTabs = leaf.tabs.filter((t) => t.id !== tabId);
                const newActiveId =
                    leaf.activeTabId === tabId
                        ? newTabs.length > 0
                            ? newTabs[newTabs.length - 1].id
                            : null
                        : leaf.activeTabId;
                return { ...leaf, tabs: newTabs, activeTabId: newActiveId };
            }),
        })),

    closeOtherTabs: (tabId, leafId) =>
        set((state) => ({
            editorTree: updateLeaf(state.editorTree, leafId, (leaf) => {
                const tabToKeep = leaf.tabs.find((t) => t.id === tabId);
                if (!tabToKeep) return leaf;
                return { ...leaf, tabs: [tabToKeep], activeTabId: tabToKeep.id };
            }),
        })),

    closeTabsToRight: (tabId, leafId) =>
        set((state) => ({
            editorTree: updateLeaf(state.editorTree, leafId, (leaf) => {
                const tabIndex = leaf.tabs.findIndex((t) => t.id === tabId);
                if (tabIndex === -1) return leaf;
                const newTabs = leaf.tabs.slice(0, tabIndex + 1);
                const newActiveId = newTabs.some((t) => t.id === leaf.activeTabId)
                    ? leaf.activeTabId
                    : newTabs[newTabs.length - 1].id;
                return { ...leaf, tabs: newTabs, activeTabId: newActiveId };
            }),
        })),

    closeAllTabs: (leafId) =>
        set((state) => ({
            editorTree: updateLeaf(state.editorTree, leafId, (leaf) => ({
                ...leaf,
                tabs: [],
                activeTabId: null,
            })),
        })),

    setActiveTab: (tabId, leafId) =>
        set((state) => ({
            editorTree: updateLeaf(state.editorTree, leafId, (leaf) => ({
                ...leaf,
                activeTabId: tabId,
            })),
        })),

    updateTab: (tabId, updates) =>
        set((state) => ({
            editorTree: updateTabInTree(state.editorTree, tabId, updates),
        })),

    splitLeaf: (leafId, direction) =>
        set((state) => {
            const newTree = replaceNode(state.editorTree, leafId, (oldLeaf) => ({
                type: "node",
                id: `node-${crypto.randomUUID()}`,
                direction,
                ratio: 0.5,
                a: oldLeaf,
                b: {
                    type: "leaf",
                    id: `leaf-${crypto.randomUUID()}`,
                    tabs: [],
                    activeTabId: null,
                },
            }));
            return { editorTree: newTree };
        }),

    closeLeaf: (_leafId) => {
        // Merge neighbor logic — TODO
    },

    resizeNode: (nodeId, newRatio) =>
        set((state) => ({
            editorTree: updateNode(state.editorTree, nodeId, { ratio: newRatio }),
        })),
}));

// Helper: find a leaf by ID
function findLeafById(tree: SplitTree, id: string): SplitLeaf | null {
    if (tree.type === "leaf") return tree.id === id ? tree : null;
    return findLeafById(tree.a, id) || findLeafById(tree.b, id);
}

// Helper: replace a leaf node
function replaceNode(tree: SplitTree, targetId: string, replacer: (leaf: SplitLeaf) => SplitTree): SplitTree {
    if (tree.id === targetId && tree.type === "leaf") {
        return replacer(tree);
    }
    if (tree.type === "node") {
        return {
            ...tree,
            a: replaceNode(tree.a, targetId, replacer),
            b: replaceNode(tree.b, targetId, replacer),
        };
    }
    return tree;
}

// Helper: update a split node's properties
function updateNode(tree: SplitTree, targetId: string, updates: Partial<SplitNode>): SplitTree {
    if (tree.id === targetId && tree.type === "node") {
        return { ...tree, ...updates };
    }
    if (tree.type === "node") {
        return {
            ...tree,
            a: updateNode(tree.a, targetId, updates),
            b: updateNode(tree.b, targetId, updates),
        };
    }
    return tree;
}

// Helper: update a tab's properties across the entire tree
function updateTabInTree(tree: SplitTree, tabId: string, updates: Partial<Pick<EditorTab, "title" | "meta">>): SplitTree {
    if (tree.type === "leaf") {
        const hasTab = tree.tabs.some((t) => t.id === tabId);
        if (!hasTab) return tree;
        return {
            ...tree,
            tabs: tree.tabs.map((t) =>
                t.id === tabId
                    ? { ...t, ...updates, meta: updates.meta ? { ...t.meta, ...updates.meta } : t.meta }
                    : t
            ),
        };
    }
    return {
        ...tree,
        a: updateTabInTree(tree.a, tabId, updates),
        b: updateTabInTree(tree.b, tabId, updates),
    };
}
