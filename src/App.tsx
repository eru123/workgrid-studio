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

// WorkGrid Studio app shell.
const PLACEHOLDER_SESSIONS: ActivityBarItem[] = [
  { id: "s1", icon: "database", title: "s1", group: "sessions" },
  { id: "s2", icon: "server", title: "s2", group: "sessions" },
  { id: "s3", icon: "server", title: "s3", group: "sessions" },
  { id: "s4", icon: "server", title: "s4", group: "sessions" },
  { id: "s5", icon: "server", title: "s5", group: "sessions" },
  { id: "s6", icon: "server", title: "s6", group: "sessions" },
  { id: "s7", icon: "server", title: "s7", group: "sessions" },
  { id: "s8", icon: "server", title: "s8", group: "sessions" },
  { id: "s9", icon: "server", title: "s9", group: "sessions" },
  { id: "s10", icon: "server", title: "s10", group: "sessions" },
];

const ACTIVITY_ITEMS: ActivityBarItem[] = [
  { id: "dashboard", icon: "preview", title: "Dashboard", viewContainerId: "dashboard" },
  { id: "servers", icon: "server", title: "Servers", viewContainerId: "servers" },
  { id: "ssh", icon: "remote", title: "SSH", viewContainerId: "ssh" },
  { id: "credentials", icon: "key", title: "Credentials", viewContainerId: "credentials" },
  { id: "providers", icon: "hubot", title: "Providers", viewContainerId: "providers" },
  ...PLACEHOLDER_SESSIONS,
  { id: "settings", icon: "settings-gear", title: "Settings", viewContainerId: "settings", group: "bottom" },
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
  const [activeView, setActiveView] = useState("dashboard");
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

  const sidebar: ViewPaneContainerDescriptor = activeView === "explorer"
    ? connection
      ? {
          id: "explorer",
          title: connection.profileId,
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
        }
    : {
        id: activeView,
        title:
          activeView === "dashboard"
            ? "Dashboard"
            : activeView === "servers"
              ? "Servers"
              : activeView === "ssh"
                ? "SSH"
                : activeView === "credentials"
                  ? "Credentials"
                  : activeView === "providers"
                    ? "Providers"
                    : activeView === "settings"
                      ? "Settings"
                      : "Sessions",
        icon: "info",
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
        activityItems={ACTIVITY_ITEMS}
        activeViewContainerId={activeView}
        onActivitySelect={(item) => setActiveView(item.viewContainerId ?? activeView)}
        sidebar={sidebar}
        editorGroup={welcomeTab}
        panelTabs={PANEL_TABS}
        statusBarItems={statusBarItems}
      />
      <ConnectModal open={connectOpen} onClose={() => setConnectOpen(false)} onConnected={handleConnected} />
    </>
  );
}

export default App;
