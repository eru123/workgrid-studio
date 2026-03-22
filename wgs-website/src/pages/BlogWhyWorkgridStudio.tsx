import { Link } from "react-router-dom";
import { usePageTitle } from "../hooks/usePageTitle";
import { PAGE_META } from "../seo";

export function BlogWhyWorkgridStudio() {
  usePageTitle(PAGE_META["/blog/why-workgrid-studio"].title);
  return (
    <div className="inner-page container">
      <div className="inner-hero fade-up">
        <p className="eyebrow">
          <Link to="/blog">Blog</Link> › Product
        </p>
        <h1 className="inner-title">
          Why WorkGrid Studio? A Case Against Proprietary Lock-In
        </h1>
        <p className="inner-lead">
          Workbench is slow. HeidiSQL is Windows-only. TablePlus costs money.
          None of them are built for how developers actually work today. Here's
          why we built something different — and why it will always be free.
        </p>
        <div className="blog-post-meta">
          <span className="blog-card-date">March 22, 2026</span>
          <span className="blog-post-author">by the WorkGrid Studio team</span>
        </div>
      </div>

      <div className="docs-layout">
        <aside className="docs-toc" aria-label="Table of contents">
          <p className="toc-heading">On this page</p>
          <nav>
            {[
              ["the-problem", "The problem"],
              ["open-forever-free", "Open &amp; forever free"],
              ["developer-for-developers", "Built for developers"],
              ["vscode-ux", "VSCode-class UX"],
              ["schema-intelligence", "Deep schema intelligence"],
              ["broad-db-support", "Broadest DB support"],
              ["optional-ai", "Optional AI"],
              ["cross-platform", "Cross-platform native"],
              ["comparison", "Feature comparison"],
            ].map(([id, label]) => (
              <a
                key={id}
                href={`#${id}`}
                className="toc-link"
                dangerouslySetInnerHTML={{ __html: label }}
              />
            ))}
          </nav>
        </aside>

        <div className="docs-content">
          {/* The problem */}
          <section id="the-problem" className="docs-section">
            <h2 className="docs-section-title">The problem with existing tools</h2>
            <div className="docs-item">
              <p className="docs-item-body">
                If you have ever used MySQL Workbench, HeidiSQL, or TablePlus,
                you already know the frustration. Workbench is slow, bloated,
                and its UI has not meaningfully evolved in a decade. HeidiSQL is
                Windows-only. TablePlus is polished but costs money, is
                closed-source, and you are one subscription lapse away from
                losing access to your workflow.
              </p>
              <p className="docs-item-body">
                None of them are designed for how developers actually work
                today. WorkGrid Studio is different — and here is why you
                should care.
              </p>
            </div>
          </section>

          {/* Open & forever free */}
          <section id="open-forever-free" className="docs-section">
            <h2 className="docs-section-title">Built in the open, forever free</h2>
            <div className="docs-item">
              <p className="docs-item-body">
                WorkGrid Studio is open source and will always be free. No
                freemium tiers. No feature gating. No subscription. Every
                capability ships to every user equally. The source code is
                yours to inspect, fork, contribute to, and trust.
              </p>
              <p className="docs-item-body">
                This matters more than it sounds. Proprietary tools can remove
                features, change pricing, sunset products, or be acquired. With
                WorkGrid Studio, the worst case is that you fork it. The code
                does not disappear.
              </p>
            </div>
          </section>

          {/* Built by a developer for developers */}
          <section id="developer-for-developers" className="docs-section">
            <h2 className="docs-section-title">Built by a developer, for developers</h2>
            <div className="docs-item">
              <p className="docs-item-body">
                This is an independent, solo-developer project. Decisions are
                driven by what makes developers more productive — not by a
                product roadmap committee, enterprise sales, or investor KPIs.
                When you report a bug or request a feature, you are talking to
                the person who wrote the code.
              </p>
            </div>
          </section>

          {/* VSCode-class UX */}
          <section id="vscode-ux" className="docs-section">
            <h2 className="docs-section-title">VSCode-class developer experience</h2>
            <div className="docs-item">
              <p className="docs-item-body">
                The design goal for WorkGrid Studio is not "another database
                GUI." It is a <strong>developer-grade workbench</strong> built
                with the same philosophy that made VSCode the world's most
                popular editor: an extensible, composable engine with
                first-class keyboard support, a fully themeable interface built
                from a JSON token system, user-configurable keybindings, and a
                UI that gets out of your way.
              </p>
              <p className="docs-item-body">
                Command palette, split panes, activity bar, resizable sidebar
                panels, a rich composable tab system, a general-purpose tree
                view, a centralized keybinding registry — these are not
                afterthoughts. They are the engine.
              </p>
            </div>
          </section>

          {/* Schema intelligence */}
          <section id="schema-intelligence" className="docs-section">
            <h2 className="docs-section-title">Deep schema awareness — no AI required</h2>
            <div className="docs-item">
              <p className="docs-item-body">
                The editor knows your database. Autocomplete surfaces real
                table names, column names, data types, and relationships pulled
                live from your connected server — not static snippets, not
                guesswork. The schema diagram, table designer, EXPLAIN plan
                viewer, and filter builder are all schema-driven from the
                engine up. You get intelligent tooling the moment you connect,
                with zero configuration and zero dependency on a third-party AI
                service.
              </p>
              <p className="docs-item-body">
                AI is available as an optional assistant on top of this
                foundation — for developers who want to generate a query from a
                natural language description or explore an unfamiliar schema
                faster. But it is a layer, not a crutch. Every feature works
                completely without it.
              </p>
            </div>
          </section>

          {/* Broadest DB support */}
          <section id="broad-db-support" className="docs-section">
            <h2 className="docs-section-title">The broadest database support of any free tool</h2>
            <div className="docs-item">
              <p className="docs-item-body">
                MySQL, PostgreSQL, SQLite, MSSQL, Redis, MongoDB, Cloudflare
                D1, Turso, PlanetScale, Aurora, TimescaleDB, Firebase,
                S3-compatible storage — WorkGrid Studio is building toward a
                single tool that covers the full modern data stack, relational
                and non-relational alike. No other free, open-source client
                comes close to this breadth.
              </p>
              <div className="docs-note docs-note-info">
                MySQL and MariaDB are fully supported today. PostgreSQL, SQLite,
                and MSSQL are actively in development for v1.0.
              </div>
            </div>
          </section>

          {/* Optional AI */}
          <section id="optional-ai" className="docs-section">
            <h2 className="docs-section-title">Optional AI, when you want it</h2>
            <div className="docs-item">
              <p className="docs-item-body">
                WorkGrid Studio ships a built-in AI chat sidebar with
                multi-provider support — OpenAI, Gemini, DeepSeek, or any
                custom OpenAI-compatible endpoint. Because AI runs on top of
                the schema engine, it receives real schema context: your actual
                tables, columns, and relationships — not a hallucinated
                approximation.
              </p>
              <p className="docs-item-body">
                AI features are opt-in, privacy-respecting, and never required
                to use the application.
              </p>
            </div>
          </section>

          {/* Cross-platform native */}
          <section id="cross-platform" className="docs-section">
            <h2 className="docs-section-title">Cross-platform and native</h2>
            <div className="docs-item">
              <p className="docs-item-body">
                Built on Tauri 2 (Rust backend + React frontend), WorkGrid
                Studio runs natively on <strong>Windows, macOS, and Linux</strong>{" "}
                from a single codebase. No Electron memory bloat. A lean, fast
                Rust core handles all database I/O, encryption, SSH tunneling,
                logging, and file persistence. The final binary weighs in under
                10 MB.
              </p>
            </div>
          </section>

          {/* Feature comparison */}
          <section id="comparison" className="docs-section">
            <h2 className="docs-section-title">Feature comparison</h2>
            <div className="docs-item">
              <p className="docs-item-body">
                Here is how WorkGrid Studio stacks up against the most popular
                alternatives today. Legend: ✅ Implemented &nbsp;·&nbsp; 🔜
                Planned for v1.0 &nbsp;·&nbsp; 📅 Planned post-v1.0 &nbsp;·&nbsp;
                ❌ Not planned.
              </p>
              <div className="blog-table-wrap">
                <table className="blog-comparison-table">
                  <thead>
                    <tr>
                      <th>Feature</th>
                      <th>MySQL Workbench</th>
                      <th>HeidiSQL</th>
                      <th>TablePlus</th>
                      <th>WorkGrid Studio</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="table-group-header">
                      <td colSpan={5}>Connection &amp; Platform</td>
                    </tr>
                    <tr><td>SSH tunnel</td><td>✅</td><td>✅</td><td>✅</td><td>✅</td></tr>
                    <tr><td>SSL/TLS</td><td>✅</td><td>✅</td><td>✅</td><td>✅</td></tr>
                    <tr><td>Connection pooling</td><td>✅</td><td>❌</td><td>❌</td><td>✅</td></tr>
                    <tr><td>Encrypted credentials</td><td>✅</td><td>✅</td><td>✅</td><td>✅</td></tr>
                    <tr><td>macOS</td><td>✅</td><td>❌</td><td>✅</td><td>✅</td></tr>
                    <tr><td>Windows</td><td>✅</td><td>✅</td><td>✅</td><td>✅</td></tr>
                    <tr><td>Linux</td><td>✅</td><td>✅</td><td>❌</td><td>✅</td></tr>
                    <tr className="table-group-header">
                      <td colSpan={5}>Query Editor</td>
                    </tr>
                    <tr><td>Syntax highlighting</td><td>✅</td><td>✅</td><td>✅</td><td>✅</td></tr>
                    <tr><td>Schema autocomplete</td><td>✅</td><td>✅</td><td>✅</td><td>✅</td></tr>
                    <tr><td>Query history</td><td>✅</td><td>✅</td><td>✅</td><td>✅</td></tr>
                    <tr><td>Multi-statement execution</td><td>✅</td><td>✅</td><td>✅</td><td>✅</td></tr>
                    <tr><td>Split-pane editor</td><td>✅</td><td>❌</td><td>✅</td><td>✅</td></tr>
                    <tr><td>Command palette</td><td>❌</td><td>❌</td><td>✅</td><td>✅</td></tr>
                    <tr className="table-group-header">
                      <td colSpan={5}>Schema &amp; Visualization</td>
                    </tr>
                    <tr><td>ER / schema diagram</td><td>✅</td><td>❌</td><td>❌</td><td>✅</td></tr>
                    <tr><td>EXPLAIN plan viewer</td><td>✅</td><td>✅</td><td>❌</td><td>✅</td></tr>
                    <tr><td>Table designer</td><td>✅</td><td>✅</td><td>✅</td><td>✅</td></tr>
                    <tr><td>Schema-aware filter builder</td><td>❌</td><td>✅</td><td>❌</td><td>✅</td></tr>
                    <tr className="table-group-header">
                      <td colSpan={5}>AI (optional)</td>
                    </tr>
                    <tr><td>AI query generation</td><td>❌</td><td>❌</td><td>❌</td><td>✅</td></tr>
                    <tr><td>Multiple AI providers</td><td>❌</td><td>❌</td><td>❌</td><td>✅</td></tr>
                    <tr><td>AI uses live schema context</td><td>❌</td><td>❌</td><td>❌</td><td>✅</td></tr>
                    <tr className="table-group-header">
                      <td colSpan={5}>Pricing &amp; Licensing</td>
                    </tr>
                    <tr><td>Free</td><td>✅</td><td>✅</td><td>❌</td><td>✅</td></tr>
                    <tr><td>Open source</td><td>✅</td><td>✅</td><td>❌</td><td>✅</td></tr>
                    <tr><td>User-defined JSON themes</td><td>❌</td><td>❌</td><td>❌</td><td>✅</td></tr>
                    <tr><td>User-defined JSON keybindings</td><td>❌</td><td>❌</td><td>❌</td><td>✅</td></tr>
                  </tbody>
                </table>
              </div>
            </div>
          </section>

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
