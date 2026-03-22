import { Link } from "react-router-dom";
import { usePageTitle } from "../hooks/usePageTitle";
import { PAGE_META } from "../seo";

const sections = [
  {
    id: "getting-started",
    title: "Getting Started",
    items: [
      {
        anchor: "installation",
        title: "Installation",
        body: "Download the installer for your platform from the Downloads page or GitHub Releases. WorkGrid Studio is under 10 MB with no runtime dependencies. On Windows run the NSIS setup; on macOS open the DMG; on Linux run the AppImage (mark it executable first).",
      },
      {
        anchor: "first-connection",
        title: "Your first connection",
        body: "Launch the app and the onboarding wizard will appear. Select MySQL or MariaDB, fill in host, port, username, and optionally a password and default database, then click 'Test & Connect'. Successful connections are saved automatically.",
      },
    ],
  },
  {
    id: "connections",
    title: "Connections",
    items: [
      {
        anchor: "profiles",
        title: "Connection profiles",
        body: "Each saved connection is a profile. You can create, edit, duplicate, and delete profiles from the Servers panel (activity bar). Profile data — including encrypted credentials — is stored locally at %USERPROFILE%\\.workgrid-studio\\ (Windows) or ~/.workgrid-studio/ (macOS/Linux).",
      },
      {
        anchor: "supported-databases",
        title: "Supported databases",
        body: "MySQL 5.7+ and MariaDB 10.3+ are fully supported via the mysql_async Rust driver with rustls TLS. PostgreSQL, SQLite, and MSSQL are shown in the UI but are not yet connected to any backend — attempting to connect will show a 'not supported' message.",
      },
      {
        anchor: "ssl",
        title: "SSL / TLS",
        body: "Enable SSL on any profile. You can supply a CA certificate file, a client certificate, and a client key for mutual TLS. The 'Reject unauthorized' toggle controls whether the server certificate is strictly validated against your CA.",
      },
      {
        anchor: "ssh-tunnel",
        title: "SSH tunnel",
        body: "Enable SSH tunneling to reach databases on remote servers through a jump host. Supports password authentication and private key authentication (RSA, Ed25519, ECDSA — all OpenSSH formats). TOFU (Trust On First Use) host key verification stores fingerprints locally in known_hosts.json.",
      },
      {
        anchor: "docker-tunnel",
        title: "Docker container via SSH",
        body: "For MySQL containers with unexposed ports, enable 'Use Docker Container' within the SSH section. Enter the container name. WorkGrid SSH-execs into the container using bash's /dev/tcp device — no exposed ports, no stable internal IP needed.",
        note: "The SSH user must have permission to run docker commands without sudo. See the setup guide.",
        noteLink: { to: "/docs/ssh-docker-setup", label: "SSH + Docker permission setup →" },
      },
      {
        anchor: "auto-reconnect",
        title: "Auto-reconnect",
        body: "WorkGrid monitors active connections and will automatically attempt to reconnect if the connection drops. The reconnect attempt count is shown in the Output panel.",
      },
    ],
  },
  {
    id: "query-editor",
    title: "Query Editor",
    items: [
      {
        anchor: "sql-editor",
        title: "SQL editor",
        body: "Each tab contains a full SQL editor with syntax highlighting for MySQL/MariaDB syntax. Multiple tabs can be open simultaneously. Tabs persist in the workbench across sessions.",
      },
      {
        anchor: "autocomplete",
        title: "Autocomplete",
        body: "The editor offers schema-aware autocomplete — SQL keywords, database names, table names, and column names are suggested as you type. Autocomplete draws from the cached schema of your active connection.",
      },
      {
        anchor: "query-history",
        title: "Query history",
        body: "Every executed query is recorded in per-profile history stored on disk. Browse, search, and re-run past queries from the history panel.",
      },
      {
        anchor: "explain",
        title: "Explain Plan",
        body: "Click 'Explain' to run EXPLAIN on your query and view the execution plan in a dedicated tab. Helps identify missing indexes, full table scans, and join order issues.",
      },
    ],
  },
  {
    id: "schema-browser",
    title: "Schema Browser",
    items: [
      {
        anchor: "explorer",
        title: "Explorer tree",
        body: "The Explorer panel (activity bar, first icon) shows all databases and tables for each active connection. Click a table to open its Database View with structure, data, indexes, and foreign keys.",
      },
      {
        anchor: "table-designer",
        title: "Table Designer",
        body: "Open any table in the Table Designer tab to view and modify column definitions, data types, default values, and nullability. Changes generate and execute the appropriate ALTER TABLE statements.",
      },
      {
        anchor: "schema-diagram",
        title: "Schema Diagram",
        body: "Each database view includes a Schema Diagram tab that renders the entity-relationship diagram for the selected database based on foreign key constraints.",
      },
    ],
  },
  {
    id: "data-grid",
    title: "Data Grid",
    items: [
      {
        anchor: "browsing",
        title: "Browsing table data",
        body: "The Table Data tab paginates through rows with a virtualized grid for performance. Columns are sortable. Sticky columns keep the identifier column visible while scrolling.",
      },
      {
        anchor: "export",
        title: "Export",
        body: "Right-click the grid or use the toolbar to export result sets to JSON, CSV, or SQL INSERT statements. Exports reflect the current sort and filter state.",
      },
      {
        anchor: "csv-import",
        title: "CSV import",
        body: "Import CSV files into any table. The import is fully transactional — if any row fails validation the entire import is rolled back. Progress is shown in real time.",
      },
    ],
  },
  {
    id: "ai",
    title: "AI Features",
    items: [
      {
        anchor: "models",
        title: "Model configuration",
        body: "WorkGrid supports multiple AI providers. Configure your provider and API key in the Models page (activity bar). API keys are encrypted and stored in the OS credential store — never in plain text.",
      },
      {
        anchor: "query-generation",
        title: "AI query generation",
        body: "In any SQL editor tab, describe your intent in plain English and press the AI button. WorkGrid sends your schema context and prompt to your configured model, then inserts the generated SQL into the editor.",
      },
    ],
  },
  {
    id: "known-limitations",
    title: "Known Limitations",
    items: [
      {
        anchor: "db-support",
        title: "Only MySQL / MariaDB are supported",
        body: "PostgreSQL, SQLite, and MSSQL connection types are visible in the UI but will not connect. Backend support for these is planned for future releases.",
      },
      {
        anchor: "updater",
        title: "Auto-updater shows 'up to date' even when updates exist",
        body: "The auto-updater infrastructure is in place and working, but the current release process does not publish the update manifest files required by the Tauri updater. Until this is resolved in CI/CD, the app will always report that it is up to date. Check the Downloads page or GitHub Releases manually for new versions.",
      },
      {
        anchor: "no-tests",
        title: "No test suite",
        body: "There is currently no automated test suite. TypeScript strict mode is the primary compile-time correctness check. End-to-end and integration testing is planned.",
      },
    ],
  },
];

export function Docs() {
  usePageTitle(PAGE_META["/docs"].title);
  return (
    <div className="inner-page container">
      <div className="inner-hero fade-up">
        <p className="eyebrow">
          <Link to="/blog">Blog</Link> › Documentation
        </p>
        <h1 className="inner-title">WorkGrid Studio Docs</h1>
        <p className="inner-lead">
          Everything that is currently implemented and working. For SSH + Docker
          permission setup, see the{" "}
          <Link to="/docs/ssh-docker-setup">dedicated guide</Link>.
        </p>
      </div>

      <div className="docs-layout">
        {/* Sidebar TOC */}
        <aside className="docs-toc" aria-label="Table of contents">
          <p className="toc-heading">On this page</p>
          <nav>
            {sections.map((s) => (
              <a key={s.id} href={`#${s.id}`} className="toc-link">
                {s.title}
              </a>
            ))}
          </nav>
        </aside>

        {/* Content */}
        <div className="docs-content">
          {sections.map((section) => (
            <section key={section.id} id={section.id} className="docs-section">
              <h2 className="docs-section-title">{section.title}</h2>
              {section.items.map((item) => (
                <div key={item.anchor} id={item.anchor} className="docs-item">
                  <h3 className="docs-item-title">{item.title}</h3>
                  <p className="docs-item-body">{item.body}</p>
                  {"note" in item && item.note && (
                    <div className="docs-note">
                      <strong>Note:</strong> {item.note}{" "}
                      {"noteLink" in item && item.noteLink && (
                        <Link to={item.noteLink.to}>{item.noteLink.label}</Link>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </section>
          ))}
          <div className="docs-nav-footer">
            <Link to="/blog" className="docs-back-link">
              ← Back to blog
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
