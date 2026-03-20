import { usePageTitle } from "../hooks/usePageTitle";
import { PAGE_META } from "../seo";

export function About() {
  usePageTitle(PAGE_META["/about"].title);
  return (
    <div className="inner-page container">
      <div className="inner-hero fade-up">
        <p className="eyebrow">The project</p>
        <h1 className="inner-title">About WorkGrid Studio</h1>
        <p className="inner-lead">
          A database workbench built by a developer who got tired of slow, bloated
          tools and decided to build a better one.
        </p>
      </div>

      <div className="about-layout fade-up" style={{ animationDelay: "100ms" }}>
        {/* Origin */}
        <section className="about-section">
          <h2>Why we built this</h2>
          <p>
            WorkGrid Studio started as a personal tool. After years of working
            with MySQL and MariaDB on remote servers &mdash; juggling SSH tunnels,
            Docker containers, and heavyweight GUIs that felt like they were
            designed for a different decade &mdash; we wanted something lighter,
            faster, and more honest about what it does.
          </p>
          <p>
            We wanted a workbench that felt like VS Code: familiar layout, tabbed
            editor, split panes, keyboard-first. We wanted it to be under 10 MB,
            to start instantly, and to not require an account, a subscription, or
            a cloud sync. We wanted it to handle SSH tunnels and Docker containers
            properly &mdash; not as an afterthought.
          </p>
          <p>
            So we built it. And then we open-sourced it, because other developers
            might want the same thing.
          </p>
        </section>

        {/* What it is */}
        <section className="about-section">
          <h2>What it is today</h2>
          <ul className="about-list">
            <li>A Tauri 2 + Rust desktop app — Windows, macOS, and Linux</li>
            <li>Under 10 MB installer, no Electron, no runtime dependencies</li>
            <li>MySQL and MariaDB support via <code>mysql_async</code> with rustls TLS</li>
            <li>SSH tunneling with Ed25519, RSA, and ECDSA key support</li>
            <li>Docker container tunneling over SSH for unexposed ports</li>
            <li>VS Code-inspired workbench: split panes, tabbed SQL editor, activity bar</li>
            <li>Schema browser, table designer, and schema diagrams</li>
            <li>EXPLAIN plan viewer, query history, data export and CSV import</li>
            <li>AI query generation (bring your own API key)</li>
            <li>Credentials encrypted via the OS credential store — nothing in the cloud</li>
          </ul>
          <p>
            It is under active development. More database types, more features,
            and more polish are coming. Issues and pull requests are welcome.
          </p>
        </section>

        {/* The builder */}
        <section className="about-section">
          <h2>Behind the project</h2>
          <div className="about-card">
            <div className="about-card-header">
              <div className="about-avatar" aria-hidden="true">JA</div>
              <div>
                <strong className="about-name">Jericho Aquino</strong>
                <span className="about-handle">SKIDDPH</span>
              </div>
            </div>
            <p>
              Jericho is a senior full-stack software engineer based in Puerto
              Princesa City, Palawan, Philippines, with over 8 years of experience
              building web apps, mobile apps, desktop tools, enterprise systems,
              and cloud infrastructure.
            </p>
            <p>
              He built WorkGrid Studio as the database tool he wanted to use every
              day — lightweight, professional, and honest. SKIDDPH is his
              independent software label for projects like this one.
            </p>
            <div className="about-links">
              <a
                href="https://skiddph.com"
                target="_blank"
                rel="noopener noreferrer"
                className="about-link"
              >
                skiddph.com
              </a>
              <a
                href="https://github.com/eru123"
                target="_blank"
                rel="noopener noreferrer"
                className="about-link"
              >
                github.com/eru123
              </a>
              <a
                href="https://github.com/skiddph"
                target="_blank"
                rel="noopener noreferrer"
                className="about-link"
              >
                github.com/skiddph
              </a>
            </div>
          </div>
        </section>

        {/* Open source */}
        <section className="about-section">
          <h2>Open source</h2>
          <p>
            WorkGrid Studio is open source and free to use, forever. The source
            code is on GitHub under the{" "}
            <a
              href="https://github.com/eru123/workgrid-studio"
              target="_blank"
              rel="noopener noreferrer"
            >
              eru123/workgrid-studio
            </a>{" "}
            repository. Bug reports, feature requests, and pull requests are all
            welcome.
          </p>
          <div className="about-cta-row">
            <a
              href="https://github.com/eru123/workgrid-studio"
              className="button-link"
              target="_blank"
              rel="noopener noreferrer"
            >
              View on GitHub
            </a>
            <a
              href="https://github.com/eru123/workgrid-studio/issues"
              className="ghost-link"
              target="_blank"
              rel="noopener noreferrer"
            >
              Open an issue
            </a>
          </div>
        </section>
      </div>
    </div>
  );
}
