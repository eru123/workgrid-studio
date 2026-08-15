import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Workbench,
  Welcome,
  ConnectModal,
  type ActivityBarItem,
  type EditorGroup,
  type PanelTab,
  type StatusBarItem,
  type ViewPaneContainerDescriptor,
  type ConnectionHandle,
  applyTheme,
  Codicon,
  CredentialsEditor,
} from "@/wg";
import { CommandPalette, type CommandPaletteItem, type ContextMenuItem } from "@/wg";
import { ContextMenu } from "@/wg/shell/ContextMenu";
import {
  createWorkbenchBackend,
  createCredentialsTreeBackend,
} from "@/wg";
import { dbDisconnect } from "@/wg";
import { credentialsCreateFolder, credentialsCopyNode, credentialsDeleteNode, credentialsMoveNode, credentialsReorderNode, credentialsRenameNode, credentialsGetTree, credentialsUpsertEntry, credentialsSetExpanded } from "@/wg/backend/ipc";
import type { CredentialNodeDto } from "@/wg/backend/types";
import { Tree, TREE_DRAG_MIME, type TreeEditingState } from "@/wg/shell/Tree";
import type { TreeNode } from "@/wg/backend/BackendAdapter";
import { iconForKind, type CredentialsTreeBackend, type CredentialsTreeNode } from "@/wg/backend/credentialsTreeBackend";
import {
  resolveVaultCreatePath,
  findFolderChild,
  childrenOf,
  findNodeById,
  displayNameOf,
  ensureStoreSuffix,
  vaultNameClashes,
} from "@/wg/shell/credentials/vaultNaming";
import "./App.css";
import { codiconClass } from "@/wg/shell/icon";

// ---------------------------------------------------------------------------
// Activity bar items
// ---------------------------------------------------------------------------

const ACTIVITY_ITEMS: ActivityBarItem[] = [
  { id: "dashboard", icon: Codicon.preview.id, title: "Dashboard", viewContainerId: "dashboard" },
  { id: "servers", icon: Codicon.server.id, title: "Servers", viewContainerId: "servers" },
  { id: "ssh", icon: Codicon.remote.id, title: "SSH", viewContainerId: "ssh" },
  { id: "credentials", icon: Codicon.key.id, title: "Credentials", viewContainerId: "credentials" },
  { id: "providers", icon: Codicon.hubot.id, title: "Providers", viewContainerId: "providers" },
  { id: "settings", icon: Codicon.settingsGear.id, title: "Settings", viewContainerId: "settings", group: "bottom" },
];

const PLACEHOLDER_SESSIONS = Array.from({ length: 10 }).map((_, i) => ({
  id: `s${i + 1}`,
  icon: (i % 2 === 0 ? Codicon.database : Codicon.server).id,
  title: `s${i + 1}`,
  viewContainerId: `session-${i + 1}`,
  group: "sessions" as ActivityBarItem["group"],
} satisfies ActivityBarItem));

const PANEL_TABS: PanelTab[] = [
  {
    id: "problems",
    label: "Problems",
    icon: Codicon.error.id,
    render: () => <div style={{ padding: 8, color: "var(--wg-descriptionForeground)" }}>No problems detected.</div>,
  },
  {
    id: "output",
    label: "Output",
    icon: Codicon.output.id,
    render: () => (
      <pre style={{ padding: 8, fontFamily: "var(--wg-editor-font-family, monospace)", fontSize: 12 }}>
        workgrid: ready
      </pre>
    ),
  },
  {
    id: "terminal",
    label: "Terminal",
    icon: Codicon.terminal.id,
    render: () => (
      <div style={{ padding: 8, fontFamily: "monospace", fontSize: 12 }}>Terminal UI shell — backend not wired.</div>
    ),
  },
];

// ---------------------------------------------------------------------------
// Main app
// ---------------------------------------------------------------------------

/** Human-readable message from a thrown value. Tauri command errors arrive
 *  as plain objects ({kind, message}), which String() renders as
 *  "[object Object]" — extract the message instead. */
function errorMessageOf(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  if (e && typeof e === 'object' && 'message' in e) return String((e as { message: unknown }).message);
  return 'Something went wrong.';
}

function App() {
  const [activeView, setActiveView] = useState<string>("dashboard");
  const [connectOpen, setConnectOpen] = useState(false);
  const [connection, setConnection] = useState<ConnectionHandle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [editorGroups, setEditorGroups] = useState<Record<string, EditorGroup>>(() => defaultEditorGroups());
  const [credentialsRefreshKey, setCredentialsRefreshKey] = useState(0);
  const [credentialsEntryId, setCredentialsEntryId] = useState<string | null>(null);
  const [credentialsCreating, setCredentialsCreating] = useState(false);
  const [credentialsCtxMenu, setCredentialsCtxMenu] = useState<{ anchor: { x: number; y: number }; node: CredentialsTreeNode | null } | null>(null);
  const [credentialsClipboard, setCredentialsClipboard] = useState<{ nodeId: string; mode: 'copy' | 'cut' } | null>(null);
  const [credentialsEditing, setCredentialsEditing] = useState<TreeEditingState | null>(null);
  const [credentialsCollapseKey, setCredentialsCollapseKey] = useState(0);
  const [credentialsSelectedIds, setCredentialsSelectedIds] = useState<Set<string>>(new Set());
  const [credentialsSelectionAnchor, setCredentialsSelectionAnchor] = useState<string | null>(null);
  const [credentialsFilter, setCredentialsFilter] = useState('');
  const [credentialsAll, setCredentialsAll] = useState<CredentialNodeDto[]>([]);
  const [credentialsLoaded, setCredentialsLoaded] = useState(false);
  const [credentialsReveal, setCredentialsReveal] = useState<{ key: number; chain: string[] } | null>(null);
  // Editor dirty flag kept in a ref too, so tree activation callbacks (which
  // must not depend on it and re-create the backend) can still guard against
  // silently discarding unsaved changes.
  const credentialsDirtyRef = useRef(false);


  useEffect(() => {
    applyTheme("dark");
  }, []);

  const handleConnected = (handle: ConnectionHandle) => {
    setConnection(handle);
    setError(null);
  };

  const handleActivitySelect = useCallback(
    (item: ActivityBarItem) => {
      const next = item.viewContainerId ?? activeView;
      if (next === activeView) return;
      setActiveView(next);
    },
    [activeView],
  );

  // -------------------------------------------------------------------------
  // Credentials vault
  // -------------------------------------------------------------------------

  /** Confirm before an action would discard unsaved editor changes. */
  const guardOpenEntry = useCallback(() => {
    if (credentialsDirtyRef.current) {
      return window.confirm('The identity has unsaved changes. Discard them?');
    }
    return true;
  }, []);

  const handleCredentialsDirtyChange = useCallback((dirty: boolean) => {
    credentialsDirtyRef.current = dirty;
  }, []);

  // Full tree snapshot — feeds the filter list, the empty state, and
  // collapse-all persistence. Re-read on every vault mutation.
  useEffect(() => {
    let cancelled = false;
    credentialsGetTree()
      .then((nodes) => {
        if (cancelled) return;
        setCredentialsAll(nodes);
        setCredentialsLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setCredentialsLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [credentialsRefreshKey]);

  // Recreate the tree backend when the vault is mutated (save/delete) so the
  const credentialsTree = useMemo(
    () =>
      createCredentialsTreeBackend(
        (entryId) => {
          if (!guardOpenEntry()) return;
          setCredentialsEntryId(entryId);
          setCredentialsCreating(false);
        },
        (node, anchor) => setCredentialsCtxMenu({ anchor, node }),
      ),
    [credentialsRefreshKey, guardOpenEntry],
  );

  // Persisted folder expansion: seed from the vault's `expanded` flags and
  // write toggles back so the tree reopens where the user left it.
  const credentialsDefaultExpanded = useCallback(
    (node: TreeNode) => (node.data as { expanded?: boolean } | undefined)?.expanded === true,
    [],
  );
  const handleToggleExpanded = useCallback((node: TreeNode, expanded: boolean) => {
    credentialsSetExpanded(node.id, expanded).catch(() => undefined);
  }, []);

  const handleNewCredential = useCallback(() => {
    // New File: the type comes from the action, not the name — anything
    // typed becomes an entry (stored with a `.store` suffix, hidden in the
    // tree). `/` in the input nests intermediate folders.
    setCredentialsEditing({ mode: 'create', parentId: null, createType: 'file', initialValue: '' });
  }, []);


  const handleRefreshCredentials = useCallback(() => {
    setCredentialsRefreshKey((k) => k + 1);
  }, []);
  const handleNewFolder = useCallback(() => {
    // New Folder: always a folder, even if the name contains `.store`.
    setCredentialsEditing({ mode: 'create', parentId: null, createType: 'folder', initialValue: '' });
  }, []);
  const handleCollapseAll = useCallback(() => {
    setCredentialsCollapseKey((k) => k + 1);
    // Persist the collapsed state so a restart doesn't reopen the folders.
    const collapse = (nodes: CredentialNodeDto[]) => {
      for (const n of nodes) {
        if (n.type === 'folder') {
          credentialsSetExpanded(n.id, false).catch(() => undefined);
          collapse(n.children ?? []);
        }
      }
    };
    collapse(credentialsAll);
  }, [credentialsAll]);

  // Resolve the inline create. The TYPE comes from the action that opened
  // the input (`kind`): New File always creates an entry (stored as
  // `<name>.store`, displayed without the suffix), New Folder always a
  // folder. A `/`-path nests intermediate folders (created or reused) and
  // the last segment is the item itself. Empty input auto-resolves to an
  // "Untitled" name.
  //
  // Collision checks run in display space (entries hide `.store`) AND stored
  // space (a folder named `x.store` blocks a file `x`, which would store as
  // `x.store`). Returns an error string to keep the inline input open.
  const handleCommitCreate = useCallback(async (name: string, parentId: string | null, kind: 'file' | 'folder' = 'folder'): Promise<string | void> => {
    let tree;
    try {
      tree = await credentialsGetTree();
    } catch (e) {
      return errorMessageOf(e);
    }
    const plan = resolveVaultCreatePath(name, tree, parentId, kind);
    if (!plan) {
      setCredentialsEditing(null);
      return;
    }

    // Stored name for the final item: files gain exactly one `.store`
    // (never doubled); folders are stored verbatim.
    const finalDisplay = plan.finalItem.name;
    const finalStored = plan.finalItem.type === 'entry' ? ensureStoreSuffix(finalDisplay) : finalDisplay;

    // Execute the plan: walk intermediate segments, reusing or creating.
    let currentParentId = plan.startParentId;
    let currentTree = tree;
    try {
      for (const seg of plan.folderSegments) {
        const parent = currentParentId === null ? null : findNodeById(currentTree, currentParentId) ?? null;
        const siblings = parent ? childrenOf(parent) : currentTree;
        const existingFolder = findFolderChild(siblings, seg);
        if (existingFolder) {
          currentParentId = existingFolder.id;
          continue;
        }
        // Any sibling occupying the name (display or stored) blocks the path.
        const clash = siblings.find((s) => vaultNameClashes(s, seg, seg));
        if (clash) {
          return `A file or folder "${seg}" already exists at this location.`;
        }
        const created = await credentialsCreateFolder(currentParentId, seg);
        currentParentId = created.id;
        currentTree = await credentialsGetTree();
      }

      // Final item collision against the resolved parent's siblings.
      const finalParent = currentParentId === null ? null : findNodeById(currentTree, currentParentId) ?? null;
      const finalSiblings = finalParent ? childrenOf(finalParent) : currentTree;
      if (finalSiblings.some((s) => vaultNameClashes(s, finalDisplay, finalStored))) {
        return `A file or folder "${finalDisplay}" already exists at this location.`;
      }

      if (plan.finalItem.type === 'folder') {
        await credentialsCreateFolder(currentParentId, finalStored);
      } else {
        const entry = await credentialsUpsertEntry({
          id: null,
          parentId: currentParentId,
          kind: 'ssh',
          name: finalStored,
          fields: {},
          description: null,
        });
        setCredentialsEntryId(entry.id);
        setCredentialsCreating(true);
      }
      setCredentialsRefreshKey((k) => k + 1);
      setCredentialsEditing(null);
    } catch (e) {
      return errorMessageOf(e);
    }
  }, []);

  const handleCommitRename = useCallback(async (nodeId: string, newName: string): Promise<string | void> => {
    try {
      // Entries keep their `.store` on disk: re-append it unless the typed
      // name already ends with one. Folders rename verbatim.
      const node = await (credentialsTree as CredentialsTreeBackend).nodeById(nodeId);
      const isEntry = node?.data?.type === 'entry';
      const stored = isEntry ? ensureStoreSuffix(newName.trim()) : newName.trim();
      await credentialsRenameNode(nodeId, stored);
      setCredentialsRefreshKey((k) => k + 1);
      setCredentialsEditing(null);
    } catch (e) {
      return errorMessageOf(e);
    }
  }, [credentialsTree]);

  // Multi-select change from the tree (plain/Ctrl/Shift-click).
  const handleSelectChange = useCallback((ids: Set<string>, anchorId: string) => {
    setCredentialsSelectedIds(ids);
    setCredentialsSelectionAnchor(anchorId);
  }, []);

  // Descendant ids of a node, for client-side DnD cycle rejection. Uses the
  // tree backend's warm cache synchronously; returns [] when the cache isn't
  // populated yet (the backend's own cycle guard covers that case).
  const descendantIdsOf = useCallback((id: string): string[] => {
    return (credentialsTree as CredentialsTreeBackend).descendantsOfSync(id);
  }, [credentialsTree]);

  // Drop dragged nodes onto a target parent / insertion point. `reorder_node`
  // handles both reparent and positioning in one call (detach + set parent +
  // insert before `beforeId`, or append when null). Cycles are pre-rejected by
  // the Tree; the backend also guards.
  const handleDropNodes = useCallback(async (ids: string[], targetParentId: string | null, beforeId: string | null) => {
    try {
      const targetParent = targetParentId ?? 'root';
      for (const id of ids) {
        await credentialsReorderNode(id, targetParent, beforeId);
      }
      setCredentialsRefreshKey((k) => k + 1);
      setCredentialsSelectedIds(new Set());
    } catch (e) {
      window.alert(errorMessageOf(e));
    }
  }, []);

  // Blank sidebar areas (pane padding, space below the list) aren't covered
  // by the tree's own handlers — the webview default context menu leaked
  // through there, and drags onto that space missed the root drop target.
  // Handle both at document level, scoped to the sidebar while the vault is
  // the active view.
  useEffect(() => {
    if (activeView !== 'credentials') return;

    const onContextMenu = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t || !t.closest('.wg-sidebar')) return;
      if (t.closest('.wg-tree-node')) return; // rows open their own menu
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') return; // native text menu
      e.preventDefault();
      setCredentialsCtxMenu({ anchor: { x: e.clientX, y: e.clientY }, node: null });
    };

    const isVaultDrag = (e: DragEvent) =>
      Array.from(e.dataTransfer?.types ?? []).includes(TREE_DRAG_MIME);
    const inSidebarOutsideTree = (e: DragEvent) => {
      const t = e.target as HTMLElement | null;
      return !!t && !!t.closest('.wg-sidebar') && !t.closest('.wg-tree');
    };

    const onDragOver = (e: DragEvent) => {
      if (!isVaultDrag(e) || !inSidebarOutsideTree(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    };
    const onDrop = (e: DragEvent) => {
      if (!isVaultDrag(e) || !inSidebarOutsideTree(e)) return;
      const raw = e.dataTransfer?.getData(TREE_DRAG_MIME);
      if (!raw) return;
      e.preventDefault();
      let ids: string[];
      try {
        ids = JSON.parse(raw) as string[];
      } catch {
        return;
      }
      if (ids.length > 0) void handleDropNodes(ids, null, null);
    };

    document.addEventListener('contextmenu', onContextMenu);
    document.addEventListener('dragover', onDragOver);
    document.addEventListener('drop', onDrop);
    return () => {
      document.removeEventListener('contextmenu', onContextMenu);
      document.removeEventListener('dragover', onDragOver);
      document.removeEventListener('drop', onDrop);
    };
  }, [activeView, handleDropNodes]);

  // Compute the ancestor id chain (root → … → node) for deep-ancestor reveal
  // when opening an inline edit targeting a nested node. Uses the cached tree.
  const ancestorChainOf = useCallback(async (nodeId: string | null): Promise<string[]> => {
    if (!nodeId) return [];
    const backend = credentialsTree as CredentialsTreeBackend;
    // Build a child→parent map from the cache by walking from roots.
    const parentMap = new Map<string, string | null>();
    const buildMap = async (parentId: string | null) => {
      const childIds = await backend.childIdsOf(parentId);
      for (const childId of childIds) {
        parentMap.set(childId, parentId);
        await buildMap(childId);
      }
    };
    await buildMap(null);
    const chain: string[] = [];
    let cur: string | null = nodeId;
    while (cur && parentMap.has(cur)) {
      chain.unshift(cur);
      cur = parentMap.get(cur) ?? null;
    }
    return chain;
  }, [credentialsTree]);

  // ---- Filter (flat results while a query is active) ----------------------

  const credentialsFilterQuery = credentialsFilter.trim().toLowerCase();
  const credentialsHits = useMemo(() => {
    if (!credentialsFilterQuery) return null;
    const hits: { id: string; label: string; icon: string; path: string; type: 'folder' | 'entry' }[] = [];
    // Match + display in explorer space (entries hide the `.store` suffix).
    const walk = (nodes: CredentialNodeDto[], trail: string[]) => {
      for (const n of nodes) {
        const label = displayNameOf(n);
        if (label.toLowerCase().includes(credentialsFilterQuery)) {
          hits.push({
            id: n.id,
            label,
            icon: n.type === 'folder' ? 'folder' : iconForKind(n.kind),
            path: trail.join(' / '),
            type: n.type,
          });
        }
        if (n.children?.length) walk(n.children, [...trail, label]);
      }
    };
    walk(credentialsAll, []);
    return hits;
  }, [credentialsFilterQuery, credentialsAll]);

  const openVaultEntry = useCallback((entryId: string) => {
    if (!guardOpenEntry()) return;
    setCredentialsEntryId(entryId);
    setCredentialsCreating(false);
  }, [guardOpenEntry]);

  /**
   * After a mutation (paste/duplicate), make the affected node visible:
   * expand its ancestor chain, select it, and scroll it into view. The Tree
   * consumes the request after its post-refresh reload, so the reveal
   * reflects where the node actually landed.
   */
  const revealVaultNode = useCallback(async (nodeId: string, parentId: string | null) => {
    const chain = await ancestorChainOf(parentId);
    setCredentialsSelectedIds(new Set([nodeId]));
    setCredentialsReveal({ key: Date.now(), chain: [...chain, nodeId] });
  }, [ancestorChainOf]);

  /**
   * Keep only the top-most selected ids when a selection mixes a folder with
   * its own descendants — deleting a folder already removes its subtree, so
   * deleting both would fail the inner delete ("node not found"). Falls back
   * to the input when the tree snapshot isn't loaded.
   */
  const topMostSelected = useCallback((ids: string[]): string[] => {
    const idSet = new Set(ids);
    const keep: string[] = [];
    const walk = (nodes: readonly CredentialNodeDto[], selectedAncestor: boolean) => {
      for (const n of nodes) {
        const selected = idSet.has(n.id);
        if (selected && !selectedAncestor) keep.push(n.id);
        walk(n.children ?? [], selectedAncestor || selected);
      }
    };
    walk(credentialsAll, false);
    return keep.length > 0 ? keep : ids;
  }, [credentialsAll]);

  // Heading Paste: paste the clipboard at the vault root and reveal it.
  const handlePasteAtRoot = useCallback(async () => {
    if (!credentialsClipboard) return;
    try {
      if (credentialsClipboard.mode === 'copy') {
        const created = await credentialsCopyNode(credentialsClipboard.nodeId, 'root');
        await revealVaultNode(created.id, null);
      } else {
        await credentialsMoveNode(credentialsClipboard.nodeId, 'root');
        await revealVaultNode(credentialsClipboard.nodeId, null);
        setCredentialsClipboard(null);
      }
      setCredentialsRefreshKey((k) => k + 1);
    } catch (e) {
      window.alert(errorMessageOf(e));
    }
  }, [credentialsClipboard, revealVaultNode]);

  // ---- Keyboard shortcuts (explorer-style) --------------------------------

  const handleVaultKeyDown = useCallback(async (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (credentialsEditing) return;
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
    const sel = Array.from(credentialsSelectedIds);
    const mod = e.ctrlKey || e.metaKey;
    const backend = credentialsTree as CredentialsTreeBackend;

    if (e.key === 'F2' && sel.length === 1) {
      e.preventDefault();
      const node = await backend.nodeById(sel[0]);
      if (!node) return;
      const ancestors = await ancestorChainOf(node.data?.parentId ?? null);
      setCredentialsEditing({
        mode: 'rename',
        nodeId: node.id,
        parentId: node.data?.parentId ?? null,
        initialValue: node.label,
        revealAncestors: ancestors,
      });
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && sel.length > 0) {
      e.preventDefault();
      const targets = topMostSelected(sel);
      const ok = window.confirm(targets.length > 1 ? `Delete ${targets.length} items?` : 'Delete this item?');
      if (!ok) return;
      try {
        await Promise.all(targets.map((id) => credentialsDeleteNode(id)));
        setCredentialsRefreshKey((k) => k + 1);
        setCredentialsSelectedIds(new Set());
      } catch (err) {
        window.alert(errorMessageOf(err));
      }
    } else if (e.key === 'Enter' && sel.length === 1) {
      const node = await backend.nodeById(sel[0]);
      if (node?.data?.type === 'entry') {
        e.preventDefault();
        openVaultEntry(node.id);
      }
    } else if (mod && (e.key === 'c' || e.key === 'C') && sel.length === 1) {
      setCredentialsClipboard({ nodeId: sel[0], mode: 'copy' });
    } else if (mod && (e.key === 'x' || e.key === 'X') && sel.length === 1) {
      setCredentialsClipboard({ nodeId: sel[0], mode: 'cut' });
    } else if (mod && (e.key === 'v' || e.key === 'V') && credentialsClipboard) {
      e.preventDefault();
      try {
        // Paste into the selected folder; onto an entry's parent; else root.
        let targetParent = 'root';
        if (sel.length === 1) {
          const node = await backend.nodeById(sel[0]);
          if (node?.data?.type === 'folder') targetParent = node.id;
          else if (node?.data?.parentId) targetParent = node.data.parentId;
        }
        if (credentialsClipboard.mode === 'copy') {
          const created = await credentialsCopyNode(credentialsClipboard.nodeId, targetParent);
          await revealVaultNode(created.id, targetParent === 'root' ? null : targetParent);
        } else {
          await credentialsMoveNode(credentialsClipboard.nodeId, targetParent);
          await revealVaultNode(credentialsClipboard.nodeId, targetParent === 'root' ? null : targetParent);
          setCredentialsClipboard(null);
        }
        setCredentialsRefreshKey((k) => k + 1);
      } catch (err) {
        window.alert(errorMessageOf(err));
      }
    }
  }, [credentialsEditing, credentialsSelectedIds, credentialsTree, credentialsClipboard, ancestorChainOf, openVaultEntry, revealVaultNode, topMostSelected]);


  const activeEditorGroup = editorGroups[activeView] ?? defaultEditorGroups()[activeView];

  const persistEditorGroup = useCallback((view: string, group: EditorGroup) => {
    setEditorGroups((prev) => ({ ...prev, [view]: group }));
  }, []);

  const handleActivateTab = useCallback(
    (groupId: string, tabId: string) => {
      persistEditorGroup(activeView, {
        ...(activeEditorGroup ?? { id: activeView, orientation: "horizontal", tabs: [] }),
        id: groupId,
        activeTabId: tabId,
      });
    },
    [activeEditorGroup, activeView, persistEditorGroup],
  );

  const handleCloseTab = useCallback(
    (groupId: string, tabId: string) => {
      const group = activeEditorGroup;
      if (!group) return;
      const nextTabs = group.tabs.filter((tab) => tab.id !== tabId);
      const nextActiveTabId = nextTabs.find((tab) => tab.id === group.activeTabId) ? group.activeTabId : nextTabs[0]?.id;
      persistEditorGroup(activeView, { ...group, tabs: nextTabs, activeTabId: nextActiveTabId });
      if (nextTabs.length === 0) {
        setActiveView("dashboard");
      }
    },
    [activeEditorGroup, activeView, persistEditorGroup],
  );

  // -------------------------------------------------------------------------
  // Sidebar view
  // -------------------------------------------------------------------------


function IconButton({ icon, title, onClick }: { icon: string; title: string; onClick: () => void }) {
  return (
    <button
      type="button"
      title={title}
      data-wg-tip={title}
      onClick={onClick}
      style={{
        background: "transparent",
        color: "var(--wg-foreground)",
        border: "1px solid var(--wg-border, rgba(255,255,255,0.16))",
        borderRadius: 4,
        padding: "2px 6px",
        fontSize: 12,
        cursor: "pointer",
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
      }}
    >
      <span className={codiconClass(icon)} style={{ fontSize: 14 }} />
    </button>
  );
}
  const sidebar: ViewPaneContainerDescriptor =
    activeView === "explorer"
      ? connection
        ? {
            id: "explorer",
            title: connection.profileId,
            icon: Codicon.files.id,
            panes: [
              {
                id: "connections",
                title: connection.profileId,
                tree: createWorkbenchBackend(connection.profileId).tree,
              },
            ],
          }
        : {
            id: "explorer",
            title: "Explorer",
            icon: Codicon.files.id,
            panes: [
              {
                id: "empty",
                title: "No Connection",
                render: () => (
                  <div style={{ padding: 12, color: "var(--wg-descriptionForeground)", fontSize: 12 }}>
                    No database connected. Click <strong>New Connection</strong> to get started.
                  </div>
                ),
              },
            ],
          }
        : activeView === "credentials"
        ? {
            id: "credentials",
            title: "Credentials",
            icon: Codicon.key.id,
            headerActions: (
              <div style={{ display: "flex", gap: 6 }}>
                <IconButton icon="new-file" title="New File" onClick={handleNewCredential} />
                {credentialsClipboard ? (
                  <IconButton icon="insert" title={credentialsClipboard.mode === 'copy' ? 'Paste' : 'Paste (move)'} onClick={() => { void handlePasteAtRoot(); }} />
                ) : null}
                <IconButton icon="new-folder" title="New Folder" onClick={handleNewFolder} />
                <IconButton icon="refresh" title="Refresh" onClick={handleRefreshCredentials} />
                <IconButton icon="collapse-all" title="Collapse" onClick={handleCollapseAll} />
              </div>
            ),
            panes: [
              {
                id: "credentials-tree",
                title: "Vault",
                render: () => (
                  <div
                    tabIndex={0}
                    onKeyDown={(e) => { void handleVaultKeyDown(e); }}
                    // Focus the pane on tree clicks so shortcuts (F2/Del/
                    // Ctrl+C/X/V) work like the VS Code explorer. Inline
                    // inputs keep their own focus.
                    onMouseDownCapture={(e) => {
                      const t = e.target as HTMLElement;
                      if (t.tagName !== 'INPUT' && t.tagName !== 'TEXTAREA') {
                        (e.currentTarget as HTMLElement).focus();
                      }
                    }}
                    // Flex column so the tree list stretches to the pane
                    // bottom — the blank area below rows stays a valid
                    // root-drop target. Context menus are handled at the
                    // document level (blank areas outside this div included).
                    style={{ height: '100%', minHeight: '100%', display: 'flex', flexDirection: 'column', overflowY: 'auto', outline: 'none' }}
                  >
                    <div style={{ padding: '4px 8px 8px' }}>
                      <input
                        value={credentialsFilter}
                        onChange={(e) => setCredentialsFilter(e.target.value)}
                        placeholder="Filter identities…"
                        spellCheck={false}
                        style={{
                          width: '100%',
                          boxSizing: 'border-box',
                          background: 'transparent',
                          color: 'var(--wg-foreground)',
                          border: '1px solid var(--wg-border, rgba(255,255,255,0.2))',
                          borderRadius: 4,
                          padding: '3px 6px',
                          fontSize: 12,
                          outline: 'none',
                        }}
                      />
                    </div>

                    {credentialsHits ? (
                      credentialsHits.length === 0 ? (
                        <div style={{ padding: 12, color: 'var(--wg-descriptionForeground)', fontSize: 12 }}>
                          No items match “{credentialsFilter.trim()}”.
                        </div>
                      ) : (
                        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                          {credentialsHits.map((hit) => (
                            <li key={hit.id}>
                              <div
                                className="wg-tree-node"
                                style={{ paddingLeft: 8, cursor: 'pointer' }}
                                title={hit.path || undefined}
                                onClick={() => {
                                  if (hit.type === 'entry') {
                                    openVaultEntry(hit.id);
                                  } else {
                                    setCredentialsFilter('');
                                  }
                                }}
                              >
                                <span className="wg-tree-node-twisty" data-empty="true" />
                                <span className={`wg-tree-node-icon ${codiconClass(hit.icon)}`} />
                                <span className="wg-tree-node-label">{hit.label}</span>
                                {hit.path ? <span className="wg-tree-node-description">{hit.path}</span> : null}
                              </div>
                            </li>
                          ))}
                        </ul>
                      )
                    ) : credentialsLoaded && credentialsAll.length === 0 && !credentialsEditing ? (
                      <div
                        style={{
                          height: '100%',
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: 8,
                          color: 'var(--wg-descriptionForeground)',
                          fontSize: 12,
                          padding: 24,
                          textAlign: 'center',
                        }}
                      >
                        <span className={codiconClass('key')} style={{ fontSize: 28, opacity: 0.6 }} />
                        <div>No SSH identities yet</div>
                        <div style={{ opacity: 0.8 }}>
                          Store users, passwords and private keys used to connect to SSH servers.
                        </div>
                        <button
                          type="button"
                          onClick={handleNewCredential}
                          style={{
                            background: 'var(--wg-button-background, #0e639c)',
                            color: 'var(--wg-foreground)',
                            border: 'none',
                            borderRadius: 4,
                            padding: '6px 12px',
                            fontSize: 12,
                            cursor: 'pointer',
                            marginTop: 4,
                          }}
                        >
                          New identity
                        </button>
                      </div>
                    ) : (
                      <Tree
                        backend={credentialsTree}
                        editing={credentialsEditing ?? undefined}
                        collapseAllKey={credentialsCollapseKey}
                        selectedIds={credentialsSelectedIds}
                        onSelectChange={handleSelectChange}
                        onCommitCreate={handleCommitCreate}
                        onCommitRename={handleCommitRename}
                        onCancelEdit={() => setCredentialsEditing(null)}
                        onDropNodes={handleDropNodes}
                        descendantIdsOf={descendantIdsOf}
                        defaultExpandedOf={credentialsDefaultExpanded}
                        onToggleExpanded={handleToggleExpanded}
                        revealRequest={credentialsReveal ?? undefined}
                      />
                    )}
                  </div>
                ),
                headerActions: (
                  <div style={{ display: "flex", gap: 6 }}>
                    <IconButton icon="new-file" title="New File" onClick={handleNewCredential} />
                    {credentialsClipboard ? (
                      <IconButton icon="insert" title={credentialsClipboard.mode === 'copy' ? 'Paste' : 'Paste (move)'} onClick={() => { void handlePasteAtRoot(); }} />
                    ) : null}
                    <IconButton icon="new-folder" title="New Folder" onClick={handleNewFolder} />
                    <IconButton icon="refresh" title="Refresh" onClick={handleRefreshCredentials} />
                    <IconButton icon="collapse-all" title="Collapse" onClick={handleCollapseAll} />
                  </div>
                ),
              },
            ],
          }
        : {
            id: activeView,
            title: toTitle(activeView),
            icon: Codicon.info.id,
            panes: [
              {
                id: `${activeView}-placeholder`,
                title: "Coming soon",
                render: () => (
                  <div style={{ padding: 12, color: "var(--wg-descriptionForeground)", fontSize: 12 }}>
                    {activeView === "providers"
                      ? "AI features are disabled until an AI provider is configured."
                      : "This view is a placeholder."}
                  </div>
                ),
              },
            ],
          };

  const statusBarItems: StatusBarItem[] = connection
    ? [
        { id: "s1", text: "", icon: Codicon.remote.id, alignment: "left", priority: 1, tooltip: "Connected" },
        {
          id: "s2",
          text: `${connection.profileId}`,
          alignment: "left",
          priority: 0,
        },
        { id: "s8", text: "Connected", alignment: "right", priority: 100 },
        { id: "s9", text: "●", alignment: "right", priority: 96, tooltip: "Ready" },
      ]
    : [
        { id: "s1", text: "", icon: Codicon.remote.id, alignment: "left", priority: 1, tooltip: "Not connected" },
        { id: "s2", text: "No connection", alignment: "left", priority: 0 },
        { id: "s8", text: "UI shell", alignment: "right", priority: 100 },
        { id: "s9", text: "●", alignment: "right", priority: 96, tooltip: "Ready" },
      ];

  // The credentials view replaces the tabbed editor with the fixed credential
  // form. It shows when an entry is selected or a new credential is being
  // created; otherwise a prompt to pick/create an entry.

  const handleCredentialsCtxSelect = useCallback(async (item: ContextMenuItem) => {
    // `node` is null for the tree's empty area / root context menu.
    const node = credentialsCtxMenu?.node ?? null;
    try {
      if (item.id === 'new-folder') {
        const ancestors = node ? await ancestorChainOf(node.id) : [];
        setCredentialsEditing({ mode: 'create', createType: 'folder', parentId: node?.id ?? null, initialValue: '', revealAncestors: ancestors });
      } else if (item.id === 'new-credential') {
        const ancestors = node ? await ancestorChainOf(node.id) : [];
        setCredentialsEditing({ mode: 'create', createType: 'file', parentId: node?.id ?? null, initialValue: '', revealAncestors: ancestors });
      } else if (item.id === 'refresh') {
        setCredentialsRefreshKey((k) => k + 1);
      } else if (item.id === 'paste' && credentialsClipboard) {
        const targetParent = node?.id ?? 'root';
        if (credentialsClipboard.mode === 'copy') {
          const created = await credentialsCopyNode(credentialsClipboard.nodeId, targetParent);
          await revealVaultNode(created.id, node?.id ?? null);
        } else {
          await credentialsMoveNode(credentialsClipboard.nodeId, targetParent);
          await revealVaultNode(credentialsClipboard.nodeId, node?.id ?? null);
          setCredentialsClipboard(null);
        }
        setCredentialsRefreshKey((k) => k + 1);
      } else if (!node) {
        // Remaining actions require a node target.
      } else if (item.id === 'open') {
        openVaultEntry(node.id);
      } else if (item.id === 'copy') {
        setCredentialsClipboard({ nodeId: node.id, mode: 'copy' });
      } else if (item.id === 'cut') {
        setCredentialsClipboard({ nodeId: node.id, mode: 'cut' });
      } else if (item.id === 'duplicate') {
        const created = await credentialsCopyNode(node.id, node.id);
        await revealVaultNode(created.id, node.data?.parentId ?? null);
        setCredentialsRefreshKey((k) => k + 1);
      } else if (item.id === 'rename') {
        const ancestors = await ancestorChainOf(node.data?.parentId ?? null);
        setCredentialsEditing({
          mode: 'rename',
          nodeId: node.id,
          parentId: node.data?.parentId ?? null,
          initialValue: node.label,
          revealAncestors: ancestors,
        });
      } else if (item.id === 'delete') {
        // Bulk delete when multiple nodes are selected and the right-clicked
        // node is part of the selection. Prune descendants of selected
        // folders — their delete covers the subtree.
        const raw = credentialsSelectedIds.size > 1 && credentialsSelectedIds.has(node.id)
          ? Array.from(credentialsSelectedIds)
          : [node.id];
        const targets = topMostSelected(raw);
        const msg = targets.length > 1
          ? `Delete ${targets.length} items?`
          : 'Delete this item?';
        const ok = window.confirm(msg);
        if (ok) {
          await Promise.all(targets.map((id) => credentialsDeleteNode(id)));
          setCredentialsRefreshKey((k) => k + 1);
          setCredentialsSelectedIds(new Set());
        }
      }
      setCredentialsCtxMenu(null);
    } catch (e) {
      window.alert(errorMessageOf(e));
      setCredentialsCtxMenu(null);
    }
  }, [credentialsClipboard, credentialsCtxMenu, credentialsSelectedIds, ancestorChainOf, openVaultEntry, revealVaultNode, topMostSelected]);

  const editorOverride: ReactNode =
    activeView === "credentials" ? (
      credentialsEntryId || credentialsCreating ? (
        <CredentialsEditor
          entryId={credentialsEntryId}
          onSaved={() => {
            // Save closes the file, VS Code-style: the tree refreshes and
            // the editor area returns to the empty prompt.
            setCredentialsRefreshKey((k) => k + 1);
            setCredentialsEntryId(null);
            setCredentialsCreating(false);
          }}
          onCancel={() => {
            if (credentialsDirtyRef.current && !window.confirm('Discard unsaved changes?')) return;
            setCredentialsEntryId(null);
            setCredentialsCreating(false);
          }}
          onDirtyChange={handleCredentialsDirtyChange}
        />
      ) : (
        <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--wg-descriptionForeground)", fontSize: 12 }}>
          Select an entry from the vault, or click <strong style={{ margin: "0 4px" }}>New File</strong>.
        </div>
      )
    ) : undefined;

  return (
    <>
      <Workbench
        activityItems={ACTIVITY_ITEMS}
        activeViewContainerId={activeView}
        onActivitySelect={handleActivitySelect}
        sidebar={sidebar}
        editorGroup={editorOverride ? undefined : activeEditorGroup}
        editorOverride={editorOverride}
        panelTabs={PANEL_TABS}
        statusBarItems={statusBarItems}
        onStatusBarClick={(item) => {
          if (item.id === "s8" && !connection) setConnectOpen(true);
        }}
        onActivateTab={handleActivateTab}
        onCloseTab={handleCloseTab}
      />
      {credentialsCtxMenu ? (
        <ContextMenu
          anchor={credentialsCtxMenu.anchor}
          onClose={() => setCredentialsCtxMenu(null)}
          onSelect={handleCredentialsCtxSelect}
          items={buildCredentialsContextMenuItems(credentialsCtxMenu.node, credentialsClipboard, credentialsSelectedIds.size || 1)}
        />
      ) : null}
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onRun={(item) => {}}
        items={
          [
            {
              id: "new-connection",
              label: "New Connection",
              category: "Workbench",
              icon: Codicon.add.id,
            },
            {
              id: "open-command-palette",
              label: "Toggle Command Palette",
              category: "Workbench",
              icon: Codicon.terminal.id,
            },
          ] as CommandPaletteItem[]
        }
      />
      <ConnectModal open={connectOpen} onClose={() => setConnectOpen(false)} onConnected={handleConnected} />
    </>
  );
}

function defaultEditorGroups(): Record<string, EditorGroup> {
  const base: EditorGroup = {
    id: "welcome",
    orientation: "horizontal",
    activeTabId: "welcome",
    tabs: [
      {
        id: "welcome",
        label: "Welcome",
        icon: Codicon.info.id,
        kind: "custom",
        render: () => <Welcome onAction={(actionId) => {}} />,
      },
    ],
  };
  return {
    dashboard: base,
    servers: base,
    ssh: base,
    providers: base,
    settings: base,
    credentials: base,
    ...Object.fromEntries(
      PLACEHOLDER_SESSIONS.map((item) => [
        item.viewContainerId ?? item.id,
        {
          id: item.id,
          orientation: "horizontal",
          activeTabId: item.id,
          tabs: [
            {
              id: item.id,
              label: item.title,
              icon: item.icon,
              kind: "custom" as const,
              render: () => <div style={{ padding: 12, color: "var(--wg-descriptionForeground)", fontSize: 12 }}>Session placeholder.</div>,
            },
          ],
        },
      ]),
    ),
  };
}


function buildCredentialsContextMenuItems(
  node: CredentialsTreeNode | null,
  clipboard: { nodeId: string; mode: 'copy' | 'cut' } | null,
  selectedCount = 1,
): ContextMenuItem[] {
  // Empty area / root menu: creation + paste + refresh only.
  if (!node) {
    return [
      { id: 'new-credential', label: 'New File…', icon: 'new-file' },
      { id: 'new-folder', label: 'New Folder…', icon: 'new-folder' },
      { kind: 'separator' },
      { id: 'paste', label: 'Paste', icon: 'insert', accelerator: 'Ctrl+V', disabled: !clipboard },
      { kind: 'separator' },
      { id: 'refresh', label: 'Refresh', icon: 'refresh' },
    ];
  }

  const isFolder = node.data?.type === 'folder';
  const multi = selectedCount > 1;
  const items: ContextMenuItem[] = [];

  if (isFolder && !multi) {
    items.push({ id: 'new-folder', label: 'New Folder…', icon: 'new-folder' });
    items.push({ id: 'new-credential', label: 'New File…', icon: 'new-file' });
    items.push({ kind: 'separator' });
  } else if (!multi) {
    items.push({ id: 'open', label: 'Open', icon: 'go-to-file' });
    items.push({ kind: 'separator' });
  }

  if (!multi) {
    items.push({ id: 'copy', label: 'Copy', icon: 'copy', accelerator: 'Ctrl+C' });
    items.push({ id: 'cut', label: 'Cut', icon: 'copy', accelerator: 'Ctrl+X' });
  }
  items.push({ id: 'paste', label: 'Paste', icon: 'insert', accelerator: 'Ctrl+V', disabled: !clipboard });

  if (!isFolder && !multi) {
    items.push({ kind: 'separator' });
    items.push({ id: 'duplicate', label: 'Duplicate', icon: 'copy' });
  }

  items.push({ kind: 'separator' });
  // Rename is single-selection only.
  items.push({ id: 'rename', label: 'Rename…', icon: 'edit', accelerator: 'F2', disabled: multi });
  items.push({
    id: 'delete',
    label: multi ? `Delete ${selectedCount} items` : 'Delete',
    icon: 'trash',
    accelerator: 'Delete',
  });
  items.push({ kind: 'separator' });
  items.push({ id: 'refresh', label: 'Refresh', icon: 'refresh' });

  return items;
}
function toTitle(view: string): string {
  if (view.startsWith("session-")) return `Session ${view.split("-")[1] ?? view}`;
  return view
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export default App;
