import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
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
import { credentialsCreateFolder, credentialsCopyNode, credentialsDeleteNode, credentialsMoveNode, credentialsReorderNode, credentialsRenameNode, credentialsGetTree, credentialsUpsertEntry } from "@/wg/backend/ipc";
import { Tree, type TreeEditingState } from "@/wg/shell/Tree";
import type { CredentialsTreeBackend } from "@/wg/backend/credentialsTreeBackend";
import {
  resolveVaultCreatePath,
  findFolderChild,
  childrenOf,
  findNodeById,
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
  const [credentialsCtxMenu, setCredentialsCtxMenu] = useState<{ anchor: { x: number; y: number }; node: CredentialsTreeNode } | null>(null);
  const [credentialsClipboard, setCredentialsClipboard] = useState<{ nodeId: string; mode: 'copy' | 'cut' } | null>(null);
  const [credentialsEditing, setCredentialsEditing] = useState<TreeEditingState | null>(null);
  const [credentialsCollapseKey, setCredentialsCollapseKey] = useState(0);
  const [credentialsSelectedIds, setCredentialsSelectedIds] = useState<Set<string>>(new Set());
  const [credentialsSelectionAnchor, setCredentialsSelectionAnchor] = useState<string | null>(null);


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

  // Recreate the tree backend when the vault is mutated (save/delete) so the
  const credentialsTree = useMemo(
    () =>
      createCredentialsTreeBackend(
        (entryId) => {
          setCredentialsEntryId(entryId);
          setCredentialsCreating(false);
        },
        (node, anchor) => setCredentialsCtxMenu({ anchor, node }),
      ),
    [credentialsRefreshKey],
  );

  const handleNewCredential = useCallback(() => {
    // VS Code-style "New File": prefill `.store` so a credential entry is
    // created inline. The user can also type a path like `folder/hello.store`
    // to nest it under (creating the folder too).
    setCredentialsEditing({ mode: 'create', parentId: null, initialValue: '.store' });
  }, []);


  const handleRefreshCredentials = useCallback(() => {
    setCredentialsRefreshKey((k) => k + 1);
  }, []);
  const handleNewFolder = useCallback(() => {
    setCredentialsEditing({ mode: 'create', parentId: null, initialValue: '' });
  }, []);
  const handleCollapseAll = useCallback(() => {
    setCredentialsCollapseKey((k) => k + 1);
  }, []);

  // Resolve the inline create. Type comes from the final name segment
  // (`.store` → entry, else folder). A path like `folder/hello.store` creates
  // the intermediate folder `folder` (reusing it if it already exists) and
  // then the entry `hello.store` inside it. Empty input auto-resolves to an
  // "Untitled" folder at the target parent.
  //
  // Returns an error string to keep the inline input open on collision
  // (VS Code-style hard error + abort): if an intermediate segment's name is
  // taken by a non-folder, or the final name collides with a sibling, nothing
  // is created and the message surfaces in the input.
  const handleCommitCreate = useCallback(async (name: string, parentId: string | null): Promise<string | void> => {
    let tree;
    try {
      tree = await credentialsGetTree();
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
    const plan = resolveVaultCreatePath(name, tree, parentId);
    if (!plan) {
      setCredentialsEditing(null);
      return;
    }

    // Pre-flight: verify the whole path before creating anything. An
    // intermediate segment may name an existing folder (reuse) but not an
    // existing entry (hard collision). The final segment must not collide
    // with any sibling of its resolved parent.
    let preflightParentId = plan.startParentId;
    let preflightTree = tree;
    for (const seg of plan.folderSegments) {
      const parent = preflightParentId === null ? null : findNodeById(preflightTree, preflightParentId) ?? null;
      const siblings = parent ? childrenOf(parent) : preflightTree;
      const clash = siblings.find((s) => s.name === seg);
      if (clash) {
        if (clash.type === 'folder') {
          preflightParentId = clash.id;
          continue; // reuse existing folder
        }
        return `A file or folder "${seg}" already exists at this location.`;
      }
      // Not present yet — would be created. We can't know the future id, but
      // subsequent segments are checked against the *current* tree, and the
      // create loop re-fetches after each step, so this is safe.
      preflightParentId = '__pending__';
      // Fetch the tree post-create lazily: but since we haven't created yet,
      // fall back to the current tree. Real collisions surface in the loop.
      break;
    }

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
        // Hard collision with an entry (shouldn't happen after pre-flight, but
        // guard against races).
        const clash = siblings.find((s) => s.name === seg && s.type !== 'folder');
        if (clash) {
          return `A file or folder "${seg}" already exists at this location.`;
        }
        const created = await credentialsCreateFolder(currentParentId, seg);
        currentParentId = created.id;
        currentTree = await credentialsGetTree();
      }

      // Final item collision check against the resolved parent's siblings.
      const finalParent = currentParentId === null ? null : findNodeById(currentTree, currentParentId) ?? null;
      const finalSiblings = finalParent ? childrenOf(finalParent) : currentTree;
      const finalName = plan.finalItem.name;
      if (finalSiblings.some((s) => s.name === finalName)) {
        return `A file or folder "${finalName}" already exists at this location.`;
      }

      if (plan.finalItem.type === 'folder') {
        await credentialsCreateFolder(currentParentId, finalName);
      } else {
        const entry = await credentialsUpsertEntry({
          id: null,
          parentId: currentParentId,
          kind: 'login',
          name: finalName,
          fields: {},
          description: null,
        });
        setCredentialsEntryId(entry.id);
        setCredentialsCreating(true);
      }
      setCredentialsRefreshKey((k) => k + 1);
      setCredentialsEditing(null);
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
  }, []);

  const handleCommitRename = useCallback(async (nodeId: string, newName: string): Promise<string | void> => {
    try {
      await credentialsRenameNode(nodeId, newName);
      setCredentialsRefreshKey((k) => k + 1);
      setCredentialsEditing(null);
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
  }, []);

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
      window.alert(e instanceof Error ? e.message : String(e));
    }
  }, []);

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
                  <Tree
                    backend={credentialsTree}
                    editing={credentialsEditing}
                    collapseAllKey={credentialsCollapseKey}
                    selectedIds={credentialsSelectedIds}
                    onSelectChange={handleSelectChange}
                    onCommitCreate={handleCommitCreate}
                    onCommitRename={handleCommitRename}
                    onCancelEdit={() => setCredentialsEditing(null)}
                    onDropNodes={handleDropNodes}
                    descendantIdsOf={descendantIdsOf}
                  />
                ),
                headerActions: (
                  <div style={{ display: "flex", gap: 6 }}>
                    <IconButton icon="new-file" title="New File" onClick={handleNewCredential} />
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
    const node = credentialsCtxMenu?.node;
    if (!node) return;
    try {
      if (item.id === 'new-folder') {
        const ancestors = await ancestorChainOf(node.id);
        setCredentialsEditing({ mode: 'create', parentId: node.id, initialValue: '', revealAncestors: ancestors });
      } else if (item.id === 'new-credential') {
        const ancestors = await ancestorChainOf(node.id);
        setCredentialsEditing({ mode: 'create', parentId: node.id, initialValue: '.store', revealAncestors: ancestors });
      } else if (item.id === 'open') {
        setCredentialsEntryId(node.id);
        setCredentialsCreating(false);
      } else if (item.id === 'copy') {
        setCredentialsClipboard({ nodeId: node.id, mode: 'copy' });
      } else if (item.id === 'cut') {
        setCredentialsClipboard({ nodeId: node.id, mode: 'cut' });
      } else if (item.id === 'paste' && credentialsClipboard) {
        if (credentialsClipboard.mode === 'copy') {
          await credentialsCopyNode(credentialsClipboard.nodeId, node.id);
        } else {
          await credentialsMoveNode(credentialsClipboard.nodeId, node.id);
          setCredentialsClipboard(null);
        }
        setCredentialsRefreshKey((k) => k + 1);
      } else if (item.id === 'duplicate') {
        await credentialsCopyNode(node.id, node.id);
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
        // node is part of the selection.
        const targets = credentialsSelectedIds.size > 1 && credentialsSelectedIds.has(node.id)
          ? Array.from(credentialsSelectedIds)
          : [node.id];
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
      window.alert(e instanceof Error ? e.message : String(e));
      setCredentialsCtxMenu(null);
    }
  }, [credentialsClipboard, credentialsCtxMenu, credentialsSelectedIds, ancestorChainOf]);

  const editorOverride: ReactNode =
    activeView === "credentials" ? (
      credentialsEntryId || credentialsCreating ? (
        <CredentialsEditor
          entryId={credentialsEntryId}
          onSaved={() => {
            setCredentialsRefreshKey((k) => k + 1);
            setCredentialsEntryId(null);
            setCredentialsCreating(false);
          }}
          onCancel={() => {
            setCredentialsEntryId(null);
            setCredentialsCreating(false);
          }}
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
  node: CredentialsTreeNode,
  clipboard: { nodeId: string; mode: 'copy' | 'cut' } | null,
  selectedCount = 1,
): ContextMenuItem[] {
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
  items.push({ id: 'paste', label: 'Paste', icon: 'paste', disabled: !clipboard });

  if (!isFolder && !multi) {
    items.push({ kind: 'separator' });
    items.push({ id: 'duplicate', label: 'Duplicate', icon: 'copy' });
  }

  items.push({ kind: 'separator' });
  // Rename is single-selection only.
  items.push({ id: 'rename', label: 'Rename…', icon: 'edit', disabled: multi });
  items.push({
    id: 'delete',
    label: multi ? `Delete ${selectedCount} items` : 'Delete',
    icon: 'trash',
  });

  return items;
}
function toTitle(view: string): string {
  if (view.startsWith("session-")) return `Session ${view.split("-")[1] ?? view}`;
  return view
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export default App;
