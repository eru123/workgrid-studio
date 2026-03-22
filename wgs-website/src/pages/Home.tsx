import { Link } from "react-router-dom";
import { usePageTitle } from "../hooks/usePageTitle";
import { PAGE_META } from "../seo";

export function Home() {
  usePageTitle(PAGE_META["/"].title);
  return (
    <>
      {/* ── Hero ──────────────────────────────────────────────────────────── */}
      <div className="container">
        <section className="hero" aria-labelledby="hero-heading">
          <div className="hero-copy fade-up">
            <p className="eyebrow">Open Source · Free Forever</p>
            <h1 className="hero-title" id="hero-heading">
              Database work,{" "}
              <span>without the bloat</span>
            </h1>
            <p className="hero-text">
              WorkGrid Studio is a lightweight, fast database workbench built with
              Rust and Tauri. Under 10 MB. VS Code-inspired UI. MySQL and MariaDB
              support today &mdash; more coming. Actively developed and open to
              your contributions.
            </p>
            <div className="hero-actions">
              <a
                href="https://github.com/eru123/workgrid-studio/releases/latest"
                className="button-link"
                target="_blank"
                rel="noopener noreferrer"
              >
                Download Free
              </a>
              <Link to="/blog" className="ghost-link">
                Read the Blog
              </Link>
            </div>
          </div>

          <div className="hero-panel fade-up" style={{ animationDelay: "120ms" }}>
            <div className="panel-window" role="img" aria-label="WorkGrid Studio interface preview">
              <div className="panel-bar">
                <span className="status-pill">
                  <span className="status-dot" aria-hidden="true" />
                  Connected · VPS30
                </span>
                <span className="mini-chip">MySQL 8.0.36</span>
                <span className="mini-chip">&lt;&nbsp;10 MB</span>
              </div>
              <div className="panel-grid">
                <div className="terminal-card">
                  <p className="panel-label">SQL Editor</p>
                  <pre>
                    <code>{`SELECT u.id, u.name, count(o.id) AS orders
FROM users u
LEFT JOIN orders o ON o.user_id = u.id
WHERE u.created_at > '2026-01-01'
GROUP BY u.id
ORDER BY orders DESC
LIMIT 20;`}</code>
                  </pre>
                  <p className="terminal-output">
                    ✓ <code>20 rows</code> returned in <code>4 ms</code>
                  </p>
                </div>
                <div className="panel-card accent-card">
                  <h2>AI Assist</h2>
                  <p>
                    Describe what you need in plain English. WorkGrid's AI writes
                    the SQL and explains it.
                  </p>
                </div>
                <div className="panel-card">
                  <p className="panel-label">Explain Plan</p>
                  <ul className="task-list">
                    <li>Full index scan on <code>users.created_at</code></li>
                    <li>Hash join on <code>orders.user_id</code></li>
                    <li>Filesort eliminated by index</li>
                  </ul>
                </div>
              </div>
            </div>
            <div className="hero-badge" aria-hidden="true">
              <span>Built with Rust</span>
              <strong>Tauri + mysql_async</strong>
            </div>
          </div>
        </section>

        <ul
          className="stats-grid fade-up"
          style={{ animationDelay: "240ms" }}
          aria-label="Key features at a glance"
        >
          {[
            {
              value: "< 10 MB",
              label: "Installer size on all platforms. No Electron, no Node.js runtime.",
            },
            {
              value: "Rust backend",
              label: "mysql_async + Tauri. Async, memory-safe, and fast by design.",
            },
            {
              value: "VS Code UI",
              label: "Split panes, tabbed editor, activity bar — familiar from day one.",
            },
          ].map(({ value, label }) => (
            <li key={value} className="stat-card">
              <span className="stat-value">{value}</span>
              <span className="stat-label">{label}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* ── Features ──────────────────────────────────────────────────────── */}
      <section className="section" aria-labelledby="features-heading">
        <div className="container">
          <div className="section-heading">
            <p className="eyebrow">What's inside</p>
            <h2 id="features-heading">Everything you need to work with data</h2>
            <p>
              From SSH tunnels and Docker support to AI query generation and schema
              diagrams — WorkGrid Studio covers the real workflows of developers
              connecting to databases on remote servers.
            </p>
          </div>

          <div className="feature-grid">
            {[
              {
                eyebrow: "Workbench",
                title: "VS Code-like layout",
                body: "Split-pane editor, tabbed queries, resizable panels, and an activity bar — a workbench that developers already know how to use.",
              },
              {
                eyebrow: "Connections",
                title: "SSH tunnels & Docker",
                body: "Connect through SSH with password or Ed25519 key. Reach MySQL containers with unexposed ports using Docker container tunneling over SSH.",
              },
              {
                eyebrow: "Query",
                title: "Smart SQL editor",
                body: "Syntax highlighting, schema-aware autocomplete, query history, and one-click EXPLAIN plans to understand what your queries are actually doing.",
              },
              {
                eyebrow: "AI",
                title: "Plain-English queries",
                body: "Describe what you need. WorkGrid's AI turns natural language into SQL and explains the result — bring your own API key.",
              },
              {
                eyebrow: "Data",
                title: "Grid, export & import",
                body: "Browse results in a virtualized grid. Export to JSON, CSV, or SQL. Import CSV with full transactional safety and progress tracking.",
              },
              {
                eyebrow: "Security",
                title: "Local-first, encrypted",
                body: "Credentials stay on your machine, encrypted via the OS credential store. No telemetry, no cloud sync, no account required.",
              },
            ].map(({ eyebrow, title, body }) => (
              <article key={title} className="feature-card">
                <p className="eyebrow">{eyebrow}</p>
                <h3>{title}</h3>
                <p>{body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ── Workflow ──────────────────────────────────────────────────────── */}
      <section className="section" aria-labelledby="workflow-heading">
        <div className="container">
          <div className="section-heading">
            <p className="eyebrow">Getting started</p>
            <h2 id="workflow-heading">From download to connected in minutes</h2>
            <p>
              WorkGrid Studio is under 10 MB and requires no runtime, no account,
              and no configuration wizard.
            </p>
          </div>
          <div className="workflow-grid">
            {[
              {
                step: "01",
                title: "Download & install",
                body: "Grab the installer for Windows, macOS, or Linux. Under 10 MB. No Electron, no Java, no extra runtimes.",
              },
              {
                step: "02",
                title: "Add a connection",
                body: "Enter your host, user, and password — or configure SSH tunneling with your existing key. TOFU host-key verification keeps you safe.",
              },
              {
                step: "03",
                title: "Explore and query",
                body: "Browse schemas, run SQL, generate queries with AI, view explain plans, and export your results — all in one window.",
              },
            ].map(({ step, title, body }) => (
              <article key={step} className="workflow-card">
                <span className="workflow-step" aria-hidden="true">
                  {step}
                </span>
                <h3>{title}</h3>
                <p>{body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ── Open source CTA ───────────────────────────────────────────────── */}
      <section className="section" aria-labelledby="cta-heading">
        <div className="container" style={{ paddingBottom: "5rem" }}>
          <div className="cta-panel">
            <p className="eyebrow">Open source</p>
            <h2 id="cta-heading">
              Issues welcome. PRs welcome.{" "}
              <strong>Feedback always appreciated.</strong>
            </h2>
            <p>
              WorkGrid Studio is under active development. If you hit a bug or
              have a feature idea, open an issue on GitHub. The project moves
              fast and community input shapes what gets built next.
            </p>
            <div className="hero-actions" style={{ marginTop: "1.8rem" }}>
              <a
                href="https://github.com/eru123/workgrid-studio/releases/latest"
                className="button-link ghost-link-light"
                target="_blank"
                rel="noopener noreferrer"
              >
                Download latest release
              </a>
              <a
                href="https://github.com/eru123/workgrid-studio/issues"
                className="ghost-link ghost-link-light"
                target="_blank"
                rel="noopener noreferrer"
              >
                Open an issue
              </a>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
