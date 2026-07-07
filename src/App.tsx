import { useEffect, useState } from "react";
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
} from "@/wg";
import { createWorkbenchBackend } from "@/wg/backend/workbenchBackend";
import { dbDisconnect } from "@/wg/backend/ipc";
import "./App.css";

// WorkGrid Studio app shell. Default state: Welcome screen with a "New
// Connection" action. On successful connect, the explorer tree switches to
// the real IPC-backed TreeBackend (databases → tables → columns from Rust).

const ACTIVITY_ITEMS: ActivityBarItem[] = [
  { id: "explorer", icon: "files", title: "Explorer", viewContainerId: "explorer" },
  { id: "search", icon: "search", title: "Search", viewContainerId: "search" },
  { id: "scm", icon: "source-control", title: "Source Control", viewContainerId: "scm" },
  { id: "debug", icon: "debug-alt", title: "Run and Debug", viewContainerId: "debug" },
  { id: "extensions", icon: "extensions", title: "Extensions", viewContainerId: "extensions" },
];

const ACTIVITY_ACTIONS: ActivityBarItem[] = [
  { id: "accounts", icon: "accounts", title: "Accounts" },
  { id: "settings", icon: "settings-gear", title: "Manage" },
];

const PANEL_TABS: PanelTab[] = [
  {
    id: "problems",
    label: "Problems",
    icon: "error",
    render: () => <div style={{ padding: 8, color: "var(--wg-descriptionForeground)" }}>No problems detected.</div>,
  },
  {
    id: "output",
    label: "Output",
    icon: "output",
    render: () => <pre style={{ padding: 8, fontFamily: "var(--wg-editor-font-family, monospace)", fontSize: 12 }}>workgrid: ready</pre>,
  },
  {
    id: "terminal",
    label: "Terminal",
    icon: "terminal",
    render: () => <div style={{ padding: 8, fontFamily: "monospace", fontSize: 12 }}>Terminal UI shell — backend not wired.</div>,
  },
];

function App() {
  const [activeView, setActiveView] = useState("explorer");
  const [connectOpen, setConnectOpen] = useState(false);
  const [connection, setConnection] = useState<ConnectionHandle | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    applyTheme("dark");
  }, []);

  const handleConnected = (handle: ConnectionHandle) => {
    setConnection(handle);
    setError(null);
  };

  const handleDisconnect = async () => {
    if (connection) {
      try {
        await dbDisconnect(connection.profileId);
      } catch {
        // ignore — UI should reflect disconnected regardless
      }
    }
    setConnection(null);
  };

  // Build the welcome tab (shown when not connected, or alongside).
  const welcomeTab: EditorGroup = {
    id: "g1",
    orientation: "horizontal",
    activeTabId: "welcome",
    tabs: [
      {
        id: "welcome",
        label: "Welcome",
        icon: "info",
        kind: "custom",
        render: () => (
          <Welcome
            recent={connection ? [{ label: connection.profileId, description: `${connection.dbType} · ${connection.serverVersion}`, icon: "server" }] : []}
            onAction={(actionId) => {
              if (actionId === "new-connection") {
                setConnectOpen(true);
              }
            }}
          />
        ),
      },
    ],
  };

  // Build the explorer view — real IPC-backed tree when connected, empty when not.
  const explorerView: ViewPaneContainerDescriptor = connection
    ? {
        id: "explorer",
        title: "Explorer",
        icon: "files",
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
        icon: "files",
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
      };

  const sidebar =
    activeView === "explorer"
      ? explorerView
      : {
          id: activeView,
          title: activeView.charAt(0).toUpperCase() + activeView.slice(1),
          icon: "info",
          panes: [],
        };

  // Status bar reflects connection state.
  const statusBarItems: StatusBarItem[] = connection
    ? [
        { id: "s1", text: "", icon: "remote", alignment: "left", priority: 1, tooltip: "Connected" },
        { id: "s2", text: `${connection.dbType} · ${connection.serverVersion}`, alignment: "left", priority: 0 },
        { id: "s3", text: "Connected", alignment: "right", priority: 100 },
        { id: "s4", text: "●", alignment: "right", priority: 96, tooltip: "Ready" },
      ]
    : [
        { id: "s1", text: "", icon: "remote", alignment: "left", priority: 1, tooltip: "Not connected" },
        { id: "s2", text: "No connection", alignment: "left", priority: 0 },
        { id: "s3", text: "UI shell", alignment: "right", priority: 100 },
        { id: "s4", text: "●", alignment: "right", priority: 96, tooltip: "Ready" },
      ];

  return (
    <>
      <Workbench
        title={`WorkGrid Studio${connection ? ` — ${connection.profileId}` : ""}`}
        activityItems={ACTIVITY_ITEMS}
        activityActions={ACTIVITY_ACTIONS}
        activeViewContainerId={activeView}
        onActivitySelect={(item) => setActiveView(item.viewContainerId ?? activeView)}
        sidebar={sidebar}
        editorGroup={welcomeTab}
        panelTabs={PANEL_TABS}
        statusBarItems={statusBarItems}
      />
      <ConnectModal
        open={connectOpen}
        onClose={() => setConnectOpen(false)}
        onConnected={handleConnected}
      />
    </>
  );
}

export default App;
