import { useEffect, useState } from "react";
import {
  Workbench,
  Welcome,
  type ActivityBarItem,
  type EditorGroup,
  type PanelTab,
  type StatusBarItem,
  type ViewPaneContainerDescriptor,
  type TreeNode,
  applyTheme,
} from "@/wg";
import "./App.css";

// WorkGrid Studio — UI shell. The default editor content is the Welcome
// screen. Backend (Rust IPC) is not wired yet; the explorer tree uses a small
// mock so the shell is visually complete and interactive.

const EXPLORER_VIEW: ViewPaneContainerDescriptor = {
  id: "explorer",
  title: "Explorer",
  icon: "files",
  panes: [
    {
      id: "connections",
      title: "Connections",
      initiallyCollapsed: false,
      tree: {
        getRoots: () => [
          { id: "r1", label: "localhost (MySQL 8.0)", icon: "server", collapsible: true, data: { kind: "server" } },
          { id: "r2", label: "prod-db (PostgreSQL 16)", icon: "server", collapsible: true, data: { kind: "server" } },
        ],
        getChildren: (node: TreeNode) => {
          if (node.id === "r1") {
            return [
              { id: "r1-db1", label: "workgrid", icon: "database", collapsible: true, badges: [{ text: "12" }] },
            ];
          }
          if (node.id === "r1-db1") {
            return [
              { id: "r1-db1-t1", label: "users", icon: "table", badges: [{ text: "1.2k" }] },
              { id: "r1-db1-t2", label: "sessions", icon: "table" },
              { id: "r1-db1-v1", label: "active_users", icon: "symbol-enum" },
            ];
          }
          return [];
        },
        onActivate: (node: TreeNode) => {
          // Backend will open the table in the editor area.
          void node;
        },
      },
    },
  ],
};

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

const EDITOR_GROUP: EditorGroup = {
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
          recent={[
            { label: "localhost (MySQL 8.0)", description: "workgrid · 5 min ago", icon: "server" },
            { label: "prod-db (PostgreSQL 16)", description: "analytics · 2 days ago", icon: "server" },
          ]}
          onAction={(actionId) => {
            // Backend wires these later.
            void actionId;
          }}
        />
      ),
    },
  ],
};

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
    render: () => <pre style={{ padding: 8, fontFamily: "var(--wg-editor-font-family, monospace)", fontSize: 12 }}>workgrid: ready{"\n"}backend: not connected (ui-only)</pre>,
  },
  {
    id: "terminal",
    label: "Terminal",
    icon: "terminal",
    render: () => <div style={{ padding: 8, fontFamily: "monospace", fontSize: 12 }}>Terminal UI shell — backend not wired.</div>,
  },
];

const STATUS_ITEMS: StatusBarItem[] = [
  { id: "s1", text: "", icon: "remote", alignment: "left", priority: 1, tooltip: "Not connected" },
  { id: "s2", text: "No connection", alignment: "left", priority: 0 },
  { id: "s3", text: "UI shell", alignment: "right", priority: 100 },
  { id: "s4", text: "UTF-8", alignment: "right", priority: 98 },
  { id: "s5", text: "●", alignment: "right", priority: 96, tooltip: "Ready" },
];

function App() {
  const [activeView, setActiveView] = useState("explorer");

  // Apply the dark theme on mount. This resolves every registered color token
  // and writes the --wg-* CSS variables the shell reads.
  useEffect(() => {
    applyTheme("dark");
  }, []);

  const sidebar =
    activeView === "explorer"
      ? EXPLORER_VIEW
      : {
          id: activeView,
          title: activeView.charAt(0).toUpperCase() + activeView.slice(1),
          icon: "info",
          panes: [],
        };

  return (
    <Workbench
      title="WorkGrid Studio"
      activityItems={ACTIVITY_ITEMS}
      activityActions={ACTIVITY_ACTIONS}
      activeViewContainerId={activeView}
      onActivitySelect={(item) => setActiveView(item.viewContainerId ?? activeView)}
      sidebar={sidebar}
      editorGroup={EDITOR_GROUP}
      panelTabs={PANEL_TABS}
      statusBarItems={STATUS_ITEMS}
    />
  );
}

export default App;
