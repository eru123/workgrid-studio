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
import { credentialsCreateFolder, credentialsCopyNode, credentialsDeleteNode, credentialsMoveNode, credentialsRenameNode, credentialsGetTree, credentialsUpsertEntry } from "@/wg/backend/ipc";
import { Tree, type TreeEditingState } from "@/wg/shell/Tree";
import {
  resolveVaultCreatePath,
  findFolderChild,
  childrenOf,
  findNodeById,
  nextUnusedFolderName,
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
  const handleCommitCreate = useCallback(async (name: string, parentId: string | null) => {
    try {
      const tree = await credentialsGetTree();
      const plan = resolveVaultCreatePath(name, tree, parentId);
      if (!plan) {
        setCredentialsEditing(null);
        return;
      }

      // Walk intermediate folder segments: reuse an existing same-named
      // folder, or create it (disambiguating if the name is taken by an
      // entry). Each step re-fetches the tree so newly-created folders are
      // visible for the next segment.
      let currentParentId = plan.startParentId;
      let currentTree = tree;
      for (const seg of plan.folderSegments) {
        const parent = currentParentId === null ? null : findNodeById(currentTree, currentParentId) ?? null;
        const siblings = parent ? childrenOf(parent) : currentTree;
        const existingFolder = findFolderChild(siblings, seg);
        if (existingFolder) {
          currentParentId = existingFolder.id;
          continue;
        }
        const folderName = nextUnusedFolderName(seg, siblings);
        const created = await credentialsCreateFolder(currentParentId, folderName);
        currentParentId = created.id;
        // Refresh the tree view for the next iteration's collision checks.
        currentTree = await credentialsGetTree();
      }

      // Create the final item under the resolved parent.
      const finalName = plan.finalItem.name;
      if (plan.finalItem.type === 'folder') {
        await credentialsCreateFolder(currentParentId, finalName);
      } else {
        // `.store` entry: create with default login kind, then open the editor
        // so the user fills in username/password/etc.
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
    } catch (e) {
      window.alert(e instanceof Error ? e.message : String(e));
    } finally {
      setCredentialsEditing(null);
    }
  }, []);

  const handleCommitRename = useCallback(async (nodeId: string, newName: string) => {
    try {
      await credentialsRenameNode(nodeId, newName);
      setCredentialsRefreshKey((k) => k + 1);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : String(e));
    } finally {
      setCredentialsEditing(null);
    }
  }, []);


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
                    onCommitCreate={handleCommitCreate}
                    onCommitRename={handleCommitRename}
                    onCancelEdit={() => setCredentialsEditing(null)}
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
        setCredentialsEditing({ mode: 'create', parentId: node.id, initialValue: '' });
      } else if (item.id === 'new-credential') {
        setCredentialsEditing({ mode: 'create', parentId: node.id, initialValue: '.store' });
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
        setCredentialsEditing({
          mode: 'rename',
          nodeId: node.id,
          parentId: node.data?.parentId ?? null,
          initialValue: node.label,
        });
      } else if (item.id === 'delete') {
        const ok = window.confirm('Delete this item?');
        if (ok) {
          await credentialsDeleteNode(node.id);
          setCredentialsRefreshKey((k) => k + 1);
        }
      }
      setCredentialsCtxMenu(null);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : String(e));
      setCredentialsCtxMenu(null);
    }
  }, [credentialsClipboard, credentialsCtxMenu]);

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
          items={buildCredentialsContextMenuItems(credentialsCtxMenu.node, credentialsClipboard)}
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
): ContextMenuItem[] {
  const isFolder = node.data?.type === 'folder';
  const items: ContextMenuItem[] = [];

  if (isFolder) {
    items.push({ id: 'new-folder', label: 'New Folder…', icon: 'new-folder' });
    items.push({ id: 'new-credential', label: 'New Credential…', icon: 'add' });
    items.push({ kind: 'separator' });
  } else {
    items.push({ id: 'open', label: 'Open', icon: 'go-to-file' });
    items.push({ kind: 'separator' });
  }

  items.push({ id: 'copy', label: 'Copy', icon: 'copy', accelerator: 'Ctrl+C' });
  items.push({ id: 'cut', label: 'Cut', icon: 'copy', accelerator: 'Ctrl+X' });
  items.push({ id: 'paste', label: 'Paste', icon: 'paste', disabled: !clipboard });

  if (!isFolder) {
    items.push({ kind: 'separator' });
    items.push({ id: 'duplicate', label: 'Duplicate', icon: 'copy' });
  }

  items.push({ kind: 'separator' });
  items.push({ id: 'rename', label: 'Rename…', icon: 'edit' });
  items.push({ id: 'delete', label: 'Delete', icon: 'trash' });

  return items;
}
function toTitle(view: string): string {
  if (view.startsWith("session-")) return `Session ${view.split("-")[1] ?? view}`;
  return view
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export default App;
