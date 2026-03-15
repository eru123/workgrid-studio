const stats = [
  {
    value: "Cross-platform",
    label: "Tauri desktop workflow for Windows, macOS, and Linux.",
  },
  {
    value: "AI-aware",
    label: "Use OpenAI, Gemini, DeepSeek, or your own provider setup.",
  },
  {
    value: "Local-first",
    label: "Privacy toggles decide when AI and updater traffic are allowed.",
  },
];

const featureCards = [
  {
    eyebrow: "Workbench",
    title: "Keep schema, SQL, and results in one focused surface",
    body: "Browse servers, open query tabs, inspect tables, and move through database work without hopping between disconnected tools.",
  },
  {
    eyebrow: "AI Assist",
    title: "Draft queries from live context instead of blank prompts",
    body: "Schema-aware assistance helps you turn intent into SQL while keeping the final query review in your hands.",
  },
  {
    eyebrow: "Explain",
    title: "Check plan shape before you commit to a change",
    body: "Inspect explain output inline so tuning happens with evidence, not gut feel alone.",
  },
  {
    eyebrow: "Tasks",
    title: "Track operational follow-ups next to the database work",
    body: "Keep next steps visible in the same app where the schema, history, and SQL already live.",
  },
  {
    eyebrow: "Privacy",
    title: "Choose exactly what network traffic is permitted",
    body: "Separate controls for AI requests and update checks help the app fit stricter environments.",
  },
  {
    eyebrow: "Release Flow",
    title: "Ship updates with Cloudflare-backed delivery in the loop",
    body: "GitHub releases stay the source of truth while Cloudflare helps keep update distribution lightweight and reliable.",
  },
];

const workflowSteps = [
  {
    step: "01",
    title: "Connect with confidence",
    body: "Add profiles, browse databases, and land on the exact schema surface you need without losing orientation.",
  },
  {
    step: "02",
    title: "Shape the query",
    body: "Draft SQL, pull in AI when it actually helps, and use explain plans before you hit the path that matters.",
  },
  {
    step: "03",
    title: "Carry the work forward",
    body: "Query history, tasks, and release cadence stay close to the workflow so context does not evaporate after execution.",
  },
];

const trustCards = [
  {
    title: "Cloudflare Pages ready",
    body: "This site is configured as a static frontend build with `dist/` output for Cloudflare Pages deployments.",
  },
  {
    title: "Pointed at the production hostname",
    body: "Canonical tags, social metadata, manifest data, robots, and sitemap all use `workgrid-studio.skiddph.com`.",
  },
  {
    title: "Responsive on purpose",
    body: "The layout keeps the control-room feel on desktop while collapsing into readable, touch-friendly sections on mobile.",
  },
];

export function App() {
  return (
    <div className="app-shell">
      <div className="grid-overlay" aria-hidden="true" />
      <div className="orb orb-one" aria-hidden="true" />
      <div className="orb orb-two" aria-hidden="true" />

      <header className="site-header container fade-up">
        <a className="brand" href="#top" aria-label="WorkGrid Studio home">
          <img
            className="brand-mark"
            src="/icon-512x512.png"
            alt=""
            width="48"
            height="48"
          />
          <span className="brand-copy">
            <strong>WorkGrid Studio</strong>
            <span>Database work, orchestrated</span>
          </span>
        </a>

        <nav className="site-nav" aria-label="Primary">
          <a href="#features">Features</a>
          <a href="#workflow">Workflow</a>
          <a href="#trust">Trust</a>
        </nav>

        <a
          className="header-cta"
          href="https://github.com/eru123/workgrid-studio/releases"
          target="_blank"
          rel="noreferrer"
        >
          Release notes
        </a>
      </header>

      <main id="top">
        <section className="hero container">
          <div className="hero-copy fade-up" style={{ animationDelay: "80ms" }}>
            <p className="eyebrow">Desktop database client</p>
            <h1 className="hero-title">
              Calm control for <span>complex database work.</span>
            </h1>
            <p className="hero-text">
              WorkGrid Studio brings schema browsing, SQL editing, explain
              plans, operational tasks, and AI-assisted query drafting into one
              sharply tuned desktop workspace.
            </p>

            <div className="hero-actions">
              <a
                className="button-link"
                href="https://github.com/eru123/workgrid-studio"
                target="_blank"
                rel="noreferrer"
              >
                View the repo
              </a>
              <a className="ghost-link" href="#features">
                Explore the stack
              </a>
            </div>

            <ul className="stats-grid" aria-label="Product highlights">
              {stats.map((stat, index) => (
                <li
                  key={stat.value}
                  className="stat-card fade-up"
                  style={{ animationDelay: `${220 + index * 120}ms` }}
                >
                  <span className="stat-value">{stat.value}</span>
                  <span className="stat-label">{stat.label}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="hero-panel fade-up" style={{ animationDelay: "180ms" }}>
            <div className="panel-window">
              <div className="panel-bar">
                <span className="status-pill">
                  <span className="status-dot" aria-hidden="true" />
                  local workspace
                </span>
                <span className="mini-chip">Explain ready</span>
                <span className="mini-chip">AI enabled</span>
              </div>

              <div className="panel-grid">
                <section className="terminal-card">
                  <p className="panel-label">Active query</p>
                  <pre>{`SELECT status, COUNT(*) AS total
FROM orders
WHERE created_at >= CURRENT_DATE - INTERVAL 30 DAY
GROUP BY status
ORDER BY total DESC;`}</pre>
                  <p className="terminal-output">
                    EXPLAIN suggests a composite index on
                    <code> created_at, status </code>
                    before the next pass.
                  </p>
                </section>

                <section className="panel-card">
                  <p className="panel-label">AI suggestion</p>
                  <h2>Convert intent into runnable SQL</h2>
                  <p>
                    Pull schema context, generate a first draft, then review
                    every clause before execution.
                  </p>
                </section>

                <section className="panel-card accent-card">
                  <p className="panel-label">Tasks</p>
                  <ul className="task-list">
                    <li>Review index candidates for hot tables</li>
                    <li>Capture explain plan before shipping</li>
                    <li>Tag the next release build after verification</li>
                  </ul>
                </section>
              </div>
            </div>

            <div className="hero-badge">
              <span>Production host</span>
              <strong>workgrid-studio.skiddph.com</strong>
            </div>
          </div>
        </section>

        <section id="features" className="section container">
          <div className="section-heading fade-up">
            <p className="eyebrow">Inside the app</p>
            <h2>Everything the workflow needs, without the usual sprawl.</h2>
            <p>
              The product already combines the sharp edges that tend to live in
              separate tools: schema exploration, SQL authoring, explain plans,
              task tracking, update flow, and provider-based AI.
            </p>
          </div>

          <div className="feature-grid">
            {featureCards.map((card, index) => (
              <article
                key={card.title}
                className="feature-card fade-up"
                style={{ animationDelay: `${index * 100}ms` }}
              >
                <p className="eyebrow">{card.eyebrow}</p>
                <h3>{card.title}</h3>
                <p>{card.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section id="workflow" className="section container">
          <div className="section-heading fade-up">
            <p className="eyebrow">How it moves</p>
            <h2>A control-room rhythm from first connection to final change.</h2>
            <p>
              The experience is built to keep context intact: connect, shape the
              query, validate what matters, and keep the follow-up work attached
              to the same flow.
            </p>
          </div>

          <div className="workflow-grid">
            {workflowSteps.map((item, index) => (
              <article
                key={item.step}
                className="workflow-card fade-up"
                style={{ animationDelay: `${120 + index * 120}ms` }}
              >
                <span className="workflow-step">{item.step}</span>
                <h3>{item.title}</h3>
                <p>{item.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section id="trust" className="section container trust-layout">
          <div className="trust-copy fade-up">
            <p className="eyebrow">Trust surface</p>
            <h2>Fast enough for daily use. Deliberate enough for careful teams.</h2>
            <p>
              WorkGrid Studio is not trying to hide its mechanics. Privacy
              controls are visible, release delivery is explicit, and the
              website itself is a static frontend meant to deploy cleanly on
              Cloudflare Pages.
            </p>
          </div>

          <div className="trust-grid">
            {trustCards.map((card, index) => (
              <article
                key={card.title}
                className="trust-card fade-up"
                style={{ animationDelay: `${160 + index * 100}ms` }}
              >
                <h3>{card.title}</h3>
                <p>{card.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="section container">
          <div className="cta-panel fade-up">
            <p className="eyebrow">Built in the open</p>
            <h2>Follow the product as the workflow sharpens release by release.</h2>
            <p>
              The site now speaks for the product at
              <strong> workgrid-studio.skiddph.com</strong>, while the app and
              updater continue to live alongside it in this repository.
            </p>
            <div className="hero-actions">
              <a
                className="button-link"
                href="https://github.com/eru123/workgrid-studio"
                target="_blank"
                rel="noreferrer"
              >
                Open GitHub
              </a>
              <a
                className="ghost-link ghost-link-light"
                href="https://github.com/eru123/workgrid-studio/releases"
                target="_blank"
                rel="noreferrer"
              >
                Track releases
              </a>
            </div>
          </div>
        </section>
      </main>

      <footer className="site-footer container">
        <p>Static Cloudflare Pages frontend for WorkGrid Studio.</p>
        <a
          className="footer-brand"
          href="https://workgrid-studio.skiddph.com"
        >
          <img
            className="footer-mark"
            src="/icon-512x512.png"
            alt=""
            width="24"
            height="24"
          />
          <span>workgrid-studio.skiddph.com</span>
        </a>
      </footer>
    </div>
  );
}
