import { create } from "zustand";
import { readData, writeData } from "@/lib/storage";

const LAYOUT_PREFS_FILE = "layout-prefs.json";

interface LayoutPrefs {
  primarySidebarWidth: number;
  secondarySidebarWidth: number;
  bottomPanelHeight: number;
  isPrimarySidebarVisible: boolean;
  isSecondarySidebarVisible: boolean;
  isBottomPanelVisible: boolean;
  activeView?: ActivityView;
  activeLeafId?: string | null;
  editorTree?: SplitTree;
}

let prefsSaveTimer: ReturnType<typeof setTimeout> | null = null;
function debouncedSavePrefs(prefs: LayoutPrefs) {
  if (prefsSaveTimer) clearTimeout(prefsSaveTimer);
  prefsSaveTimer = setTimeout(() => {
    writeData(LAYOUT_PREFS_FILE, prefs).catch(() => {});
  }, 500);
}

function stateToPrefs(state: {
  primarySidebarWidth: number;
  secondarySidebarWidth: number;
  bottomPanelHeight: number;
  isPrimarySidebarVisible: boolean;
  isSecondarySidebarVisible: boolean;
  isBottomPanelVisible: boolean;
  activeView: ActivityView;
  activeLeafId: string | null;
  editorTree: SplitTree;
}): LayoutPrefs {
  return {
    primarySidebarWidth: state.primarySidebarWidth,
    secondarySidebarWidth: state.secondarySidebarWidth,
    bottomPanelHeight: state.bottomPanelHeight,
    isPrimarySidebarVisible: state.isPrimarySidebarVisible,
    isSecondarySidebarVisible: state.isSecondarySidebarVisible,
    isBottomPanelVisible: state.isBottomPanelVisible,
    activeView: state.activeView,
    activeLeafId: state.activeLeafId,
    editorTree: state.editorTree,
  };
}

export type SplitDirection = "horizontal" | "vertical";

export type EditorTabType =
  | "sql"
  | "schema"
  | "models"
  | "tasks"
  | "database-view"
  | "table-designer"
  | "table-data"
  | "settings"
  | "trigger"
  | "routine"
  | "view"
  | "event"
  | "users"
  | "query-builder"
  | "snippet";

export interface EditorTab {
  id: string;
  title: string;
  type: EditorTabType;
  dirty?: boolean;
  pinned?: boolean;
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

export type ActivityView = "explorer" | "servers" | "snippets" | "models" | "tasks";

interface LayoutState {
  activityBarWidth: number;
  primarySidebarWidth: number;
  secondarySidebarWidth: number;
  bottomPanelHeight: number;

  isPrimarySidebarVisible: boolean;
  isSecondarySidebarVisible: boolean;
  isBottomPanelVisible: boolean;
  isBottomPanelSplit: boolean;
  bottomPanelSplitRatio: number;

  activeView: ActivityView;
  editorTree: SplitTree;
  activeLeafId: string | null;

  loadLayoutPrefs: () => Promise<void>;
  saveLayoutPrefs: () => void;
  setActiveView: (view: ActivityView) => void;
  setActiveLeaf: (leafId: string) => void;
  setSidebarWidth: (width: number) => void;
  adjustSidebarWidth: (delta: number) => void;
  setPanelHeight: (height: number) => void;
  adjustPanelHeight: (delta: number) => void;
  toggleSidebar: () => void;
  togglePanel: () => void;
  toggleBottomPanelSplit: () => void;
  setBottomPanelSplitRatio: (ratio: number) => void;
  toggleSecondarySidebar: () => void;
  adjustSecondarySidebarWidth: (delta: number) => void;

  closedTabsStack: { tab: EditorTab; leafId: string }[];
  restoreLastClosedTab: () => void;

  // Tab dirty state
  markTabDirty: (tabId: string, dirty: boolean) => void;

  // Tab operations
  openTab: (tab: Omit<EditorTab, "id"> & { id?: string }, leafId?: string) => void;
  closeTab: (tabId: string, leafId: string) => void;
  closeOtherTabs: (tabId: string, leafId: string) => void;
  closeTabsToRight: (tabId: string, leafId: string) => void;
  closeAllTabs: (leafId: string) => void;

  setActiveTab: (tabId: string, leafId: string) => void;
  updateTab: (tabId: string, updates: Partial<Pick<EditorTab, "title" | "meta" | "dirty" | "pinned">>) => void;
  togglePinTab: (tabId: string, leafId: string) => void;

  // Editor tree operations
  splitLeaf: (leafId: string, direction: SplitDirection) => void;
  splitLeafAndMove: (tabId: string, sourceLeafId: string, targetLeafId: string, direction: SplitDirection) => void;
  closeLeaf: (leafId: string) => void;
  resizeNode: (nodeId: string, newRatio: number) => void;
  moveTab: (
    tabId: string,
    sourceLeafId: string,
    targetLeafId: string,
    targetIndex?: number,
  ) => void;
}

// Update a specific leaf in the tree
function updateLeaf(
  tree: SplitTree,
  leafId: string,
  updater: (leaf: SplitLeaf) => SplitLeaf,
): SplitTree {
  if (tree.type === "leaf") {
    return tree.id === leafId ? updater(tree) : tree;
  }
  return {
    ...tree,
    a: updateLeaf(tree.a, leafId, updater),
    b: updateLeaf(tree.b, leafId, updater),
  };
}

function isEditorTab(value: unknown): value is EditorTab {
  if (!value || typeof value !== "object") return false;
  const tab = value as Partial<EditorTab>;
  return (
    typeof tab.id === "string" &&
    typeof tab.title === "string" &&
    typeof tab.type === "string"
  );
}

function isSplitTree(value: unknown): value is SplitTree {
  if (!value || typeof value !== "object") return false;

  const tree = value as Partial<SplitTree>;
  if (tree.type === "leaf") {
    return (
      typeof tree.id === "string" &&
      Array.isArray(tree.tabs) &&
      tree.tabs.every(isEditorTab) &&
      (typeof tree.activeTabId === "string" || tree.activeTabId === null)
    );
  }

  if (tree.type === "node") {
    return (
      typeof tree.id === "string" &&
      (tree.direction === "horizontal" || tree.direction === "vertical") &&
      typeof tree.ratio === "number" &&
      isSplitTree(tree.a) &&
      isSplitTree(tree.b)
    );
  }

  return false;
}

export const useLayoutStore = create<LayoutState>((set) => ({
  activityBarWidth: 48,
  primarySidebarWidth: 260,
  secondarySidebarWidth: 300,
  bottomPanelHeight: 300,

  isPrimarySidebarVisible: true,
  isSecondarySidebarVisible: false,
  isBottomPanelVisible: true,
  isBottomPanelSplit: false,
  bottomPanelSplitRatio: 0.5,

  activeView: "servers",
  editorTree: {
    type: "leaf",
    id: "leaf-main",
    tabs: [],
    activeTabId: null,
  },
  activeLeafId: "leaf-main",
  closedTabsStack: [],

  loadLayoutPrefs: async () => {
    try {
      const prefs = await readData<LayoutPrefs>(LAYOUT_PREFS_FILE, {} as LayoutPrefs);
      const updates: Partial<LayoutState> = {};
      if (prefs.primarySidebarWidth) updates.primarySidebarWidth = prefs.primarySidebarWidth;
      if (prefs.secondarySidebarWidth) updates.secondarySidebarWidth = prefs.secondarySidebarWidth;
      if (prefs.bottomPanelHeight) updates.bottomPanelHeight = prefs.bottomPanelHeight;
      if (prefs.isPrimarySidebarVisible !== undefined) updates.isPrimarySidebarVisible = prefs.isPrimarySidebarVisible;
      if (prefs.isSecondarySidebarVisible !== undefined) updates.isSecondarySidebarVisible = prefs.isSecondarySidebarVisible;
      if (prefs.isBottomPanelVisible !== undefined) updates.isBottomPanelVisible = prefs.isBottomPanelVisible;
      if (prefs.activeView) updates.activeView = prefs.activeView;
      if (prefs.activeLeafId !== undefined) updates.activeLeafId = prefs.activeLeafId;
      if (prefs.editorTree && isSplitTree(prefs.editorTree)) updates.editorTree = prefs.editorTree;
      if (Object.keys(updates).length > 0) set(updates);
    } catch {
      // Ignore — defaults apply
    }
  },

  saveLayoutPrefs: () => {
    const state = useLayoutStore.getState();
    debouncedSavePrefs(stateToPrefs(state));
  },

  setActiveView: (view) =>
    set((state) => ({
      activeView: view,
      isPrimarySidebarVisible:
        state.activeView === view && state.isPrimarySidebarVisible
          ? false
          : true,
    })),

  setActiveLeaf: (leafId) => set({ activeLeafId: leafId }),

  setSidebarWidth: (width) => {
    const w = Math.max(180, Math.min(width, 600));
    set((state) => { debouncedSavePrefs({ ...stateToPrefs(state), primarySidebarWidth: w }); return { primarySidebarWidth: w }; });
  },
  adjustSidebarWidth: (delta) =>
    set((state) => {
      const w = Math.max(180, Math.min(state.primarySidebarWidth + delta, 600));
      debouncedSavePrefs({ ...stateToPrefs(state), primarySidebarWidth: w });
      return { primarySidebarWidth: w };
    }),
  setPanelHeight: (height) => {
    const h = Math.max(100, Math.min(height, 600));
    set((state) => { debouncedSavePrefs({ ...stateToPrefs(state), bottomPanelHeight: h }); return { bottomPanelHeight: h }; });
  },
  adjustPanelHeight: (delta) =>
    set((state) => {
      const h = Math.max(100, Math.min(state.bottomPanelHeight + delta, 600));
      debouncedSavePrefs({ ...stateToPrefs(state), bottomPanelHeight: h });
      return { bottomPanelHeight: h };
    }),

  toggleSidebar: () =>
    set((state) => {
      const next = !state.isPrimarySidebarVisible;
      debouncedSavePrefs({ ...stateToPrefs(state), isPrimarySidebarVisible: next });
      return { isPrimarySidebarVisible: next };
    }),
  togglePanel: () =>
    set((state) => {
      const next = !state.isBottomPanelVisible;
      debouncedSavePrefs({ ...stateToPrefs(state), isBottomPanelVisible: next });
      return { isBottomPanelVisible: next };
    }),
  toggleBottomPanelSplit: () =>
    set((state) => ({ isBottomPanelSplit: !state.isBottomPanelSplit })),
  setBottomPanelSplitRatio: (ratio) =>
    set({ bottomPanelSplitRatio: Math.max(0.1, Math.min(ratio, 0.9)) }),
  toggleSecondarySidebar: () =>
    set((state) => {
      const next = !state.isSecondarySidebarVisible;
      debouncedSavePrefs({ ...stateToPrefs(state), isSecondarySidebarVisible: next });
      return { isSecondarySidebarVisible: next };
    }),
  adjustSecondarySidebarWidth: (delta) =>
    set((state) => {
      const w = Math.max(250, Math.min(state.secondarySidebarWidth + delta, 600));
      debouncedSavePrefs({ ...stateToPrefs(state), secondarySidebarWidth: w });
      return { secondarySidebarWidth: w };
    }),

  markTabDirty: (tabId, dirty) =>
    set((state) => ({
      editorTree: updateTabInTree(state.editorTree, tabId, { dirty }),
    })),

  openTab: (tabData, leafId) =>
    set((state) => {
      let targetLeaf = null;
      if (leafId) {
        targetLeaf = findLeafById(state.editorTree, leafId);
      } else if (state.activeLeafId) {
        targetLeaf = findLeafById(state.editorTree, state.activeLeafId);
      }
      if (!targetLeaf) {
        targetLeaf = findFirstLeaf(state.editorTree);
      }
      if (!targetLeaf) return state;

      // Build a dedup key: for database-view tabs, use profileId+database;
      // for others, don't dedup
      let existing: EditorTab | undefined;
      if (tabData.type === "database-view" && tabData.meta) {
        const key = `${tabData.meta.profileId}::${tabData.meta.database}`;
        existing = targetLeaf.tabs.find(
          (t) =>
            t.type === "database-view" &&
            t.meta &&
            `${t.meta.profileId}::${t.meta.database}` === key,
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

      const newTab: EditorTab = {
        ...tabData,
        id: tabData.id ?? `tab-${crypto.randomUUID()}`,
      };
      return {
        editorTree: updateLeaf(state.editorTree, targetLeaf.id, (leaf) => ({
          ...leaf,
          tabs: [...leaf.tabs, newTab],
          activeTabId: newTab.id,
        })),
      };
    }),

  closeTab: (tabId, leafId) =>
    set((state) => {
      const leaf = findLeafById(state.editorTree, leafId);
      if (!leaf) return state;
      const tabToClose = leaf.tabs.find((t) => t.id === tabId);
      if (!tabToClose || tabToClose.pinned) return state;

      const newStack = [{ tab: tabToClose, leafId }, ...state.closedTabsStack].slice(0, 20);

      return {
        closedTabsStack: newStack,
        editorTree: updateLeaf(state.editorTree, leafId, (l) => {
          const newTabs = l.tabs.filter((t) => t.id !== tabId);
          const newActiveId =
            l.activeTabId === tabId
              ? newTabs.length > 0
                ? newTabs[newTabs.length - 1].id
                : null
              : l.activeTabId;
          return { ...l, tabs: newTabs, activeTabId: newActiveId };
        }),
      };
    }),

  restoreLastClosedTab: () =>
    set((state) => {
      if (state.closedTabsStack.length === 0) return state;
      const [last, ...nextStack] = state.closedTabsStack;

      // Check if leaf still exists
      let targetLeaf = findLeafById(state.editorTree, last.leafId);
      if (!targetLeaf) {
        targetLeaf = findFirstLeaf(state.editorTree);
      }
      if (!targetLeaf) return { closedTabsStack: nextStack };

      return {
        closedTabsStack: nextStack,
        editorTree: updateLeaf(state.editorTree, targetLeaf.id, (leaf) => ({
          ...leaf,
          tabs: [...leaf.tabs, last.tab],
          activeTabId: last.tab.id,
        }))
      };
    }),

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

  togglePinTab: (tabId, _leafId) =>
    set((state) => ({
      editorTree: updateTabInTree(state.editorTree, tabId, {
        pinned: !findTabInTree(state.editorTree, tabId)?.pinned,
      }),
    })),

  moveTab: (tabId, sourceLeafId, targetLeafId, targetIndex) =>
    set((state) => {
      const sourceLeaf = findLeafById(state.editorTree, sourceLeafId);
      const targetLeaf = findLeafById(state.editorTree, targetLeafId);
      if (!sourceLeaf || !targetLeaf) return state;

      const tabIndex = sourceLeaf.tabs.findIndex((t) => t.id === tabId);
      if (tabIndex === -1) return state;
      const tab = sourceLeaf.tabs[tabIndex];

      if (sourceLeafId === targetLeafId) {
        // Same leaf reorder
        const newTabs = [...sourceLeaf.tabs];
        newTabs.splice(tabIndex, 1);
        if (targetIndex !== undefined) {
          // Since we removed an element, if we dropped past the removed index, we need to adjust
          const dropIndex = targetIndex > tabIndex ? targetIndex - 1 : targetIndex;
          newTabs.splice(dropIndex, 0, tab);
        } else {
          newTabs.push(tab);
        }
        return {
          editorTree: updateLeaf(state.editorTree, sourceLeafId, (l) => ({
            ...l,
            tabs: newTabs,
          })),
        };
      } else {
        // Different leaf move
        const newSourceTabs = sourceLeaf.tabs.filter((t) => t.id !== tabId);
        const newSourceActiveId =
          sourceLeaf.activeTabId === tabId
            ? newSourceTabs.length > 0
              ? newSourceTabs[newSourceTabs.length - 1].id
              : null
            : sourceLeaf.activeTabId;

        const newTargetTabs = [...targetLeaf.tabs];
        let dropIndex = targetIndex !== undefined ? targetIndex : newTargetTabs.length;
        newTargetTabs.splice(dropIndex, 0, tab);

        let newTree = updateLeaf(state.editorTree, sourceLeafId, (l) => ({
          ...l,
          tabs: newSourceTabs,
          activeTabId: newSourceActiveId,
        }));
        newTree = updateLeaf(newTree, targetLeafId, (l) => ({
          ...l,
          tabs: newTargetTabs,
          activeTabId: tab.id,
        }));

        return {
          editorTree: newTree,
          activeLeafId: targetLeafId,
        };
      }
    }),

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

  splitLeafAndMove: (tabId, sourceLeafId, targetLeafId, direction) =>
    set((state) => {
      const sourceLeaf = findLeafById(state.editorTree, sourceLeafId);
      const targetLeaf = findLeafById(state.editorTree, targetLeafId);
      if (!sourceLeaf || !targetLeaf) return state;

      const tab = sourceLeaf.tabs.find((t) => t.id === tabId);
      if (!tab) return state;

      const newLeafId = `leaf-${crypto.randomUUID()}`;

      // Step 1: split the target leaf; new empty leaf goes into the `b` slot
      let newTree = replaceNode(state.editorTree, targetLeafId, (oldLeaf) => ({
        type: "node",
        id: `node-${crypto.randomUUID()}`,
        direction,
        ratio: 0.5,
        a: oldLeaf,
        b: { type: "leaf", id: newLeafId, tabs: [], activeTabId: null },
      }));

      // Step 2: remove tab from source leaf
      const updatedSourceTabs = sourceLeaf.tabs.filter((t) => t.id !== tabId);
      const updatedSourceActiveId =
        sourceLeaf.activeTabId === tabId
          ? updatedSourceTabs.length > 0
            ? updatedSourceTabs[updatedSourceTabs.length - 1].id
            : null
          : sourceLeaf.activeTabId;
      newTree = updateLeaf(newTree, sourceLeafId, (l) => ({
        ...l,
        tabs: updatedSourceTabs,
        activeTabId: updatedSourceActiveId,
      }));

      // Step 3: place tab into the new leaf
      newTree = updateLeaf(newTree, newLeafId, (l) => ({
        ...l,
        tabs: [tab],
        activeTabId: tab.id,
      }));

      return { editorTree: newTree, activeLeafId: newLeafId };
    }),

  closeLeaf: (leafId) =>
    set((state) => {
      // If the tree is just the leaf itself, simply clear its tabs
      if (state.editorTree.type === "leaf" && state.editorTree.id === leafId) {
        return {
          editorTree: { ...state.editorTree, tabs: [], activeTabId: null },
        };
      }

      // Helper to traverse and remove the leaf, pulling up the sibling
      function removeLeaf(tree: SplitTree): SplitTree | null {
        if (tree.type === "leaf") {
          return tree.id === leafId ? null : tree;
        }

        const nextA = removeLeaf(tree.a);
        const nextB = removeLeaf(tree.b);

        // If left was removed, return right (merging right child up)
        if (!nextA && nextB) return nextB;
        // If right was removed, return left (merging left child up)
        if (!nextB && nextA) return nextA;
        // If both were removed (shouldn't happen), return null
        if (!nextA && !nextB) return null;

        // Neither removed directly below this node, just update children
        return { ...tree, a: nextA as SplitTree, b: nextB as SplitTree };
      }

      const newTree = removeLeaf(state.editorTree);
      const updates: Partial<LayoutState> = {};
      if (newTree) {
        updates.editorTree = newTree;
      }
      if (state.activeLeafId === leafId) {
        updates.activeLeafId = null;
      }
      return updates;
    }),

  resizeNode: (nodeId, newRatio) =>
    set((state) => ({
      editorTree: updateNode(state.editorTree, nodeId, { ratio: newRatio }),
    })),
}));

// Helper: find a leaf by ID
function findLeafById(tree: SplitTree, id: string | null): SplitLeaf | null {
  if (!id) return null;
  if (tree.type === "leaf") return tree.id === id ? tree : null;
  return findLeafById(tree.a, id) || findLeafById(tree.b, id);
}

// Helper: find the first leaf in the tree
function findFirstLeaf(tree: SplitTree): SplitLeaf {
  if (tree.type === "leaf") return tree;
  return findFirstLeaf(tree.a);
}

// Helper: replace a leaf node
function replaceNode(
  tree: SplitTree,
  targetId: string,
  replacer: (leaf: SplitLeaf) => SplitTree,
): SplitTree {
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
function updateNode(
  tree: SplitTree,
  targetId: string,
  updates: Partial<SplitNode>,
): SplitTree {
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

// Helper: find a tab by id across the entire tree
function findTabInTree(tree: SplitTree, tabId: string): EditorTab | undefined {
  if (tree.type === "leaf") return tree.tabs.find((t) => t.id === tabId);
  return findTabInTree(tree.a, tabId) ?? findTabInTree(tree.b, tabId);
}

// Helper: update a tab's properties across the entire tree
function updateTabInTree(
  tree: SplitTree,
  tabId: string,
  updates: Partial<Pick<EditorTab, "title" | "meta" | "dirty" | "pinned">>,
): SplitTree {
  if (tree.type === "leaf") {
    const hasTab = tree.tabs.some((t) => t.id === tabId);
    if (!hasTab) return tree;
    return {
      ...tree,
      tabs: tree.tabs.map((t) =>
        t.id === tabId
          ? {
            ...t,
            ...updates,
            dirty: updates.dirty !== undefined ? updates.dirty : t.dirty,
            meta: updates.meta ? { ...t.meta, ...updates.meta } : t.meta,
          }
          : t,
      ),
    };
  }
  return {
    ...tree,
    a: updateTabInTree(tree.a, tabId, updates),
    b: updateTabInTree(tree.b, tabId, updates),
  };
}
