import { NavLink, Outlet, Link } from "react-router-dom";

const NAV_LINKS = [
  { to: "/docs", label: "Docs" },
  { to: "/downloads", label: "Downloads" },
  { to: "/changelog", label: "Changelog" },
  { to: "/about", label: "About" },
  { to: "/contact", label: "Contact" },
];

export function Layout() {
  return (
    <div className="app-shell">
      <div className="grid-overlay" aria-hidden="true" />
      <div className="orb orb-one" aria-hidden="true" />
      <div className="orb orb-two" aria-hidden="true" />

      <div className="container">
        <header className="site-header">
          <Link to="/" className="brand" aria-label="WorkGrid Studio — Home">
            <img
              src="/favicon-32x32.png"
              alt="WorkGrid Studio logo"
              className="brand-mark"
              width="48"
              height="48"
            />
            <div className="brand-copy">
              <strong>WorkGrid Studio</strong>
              <span>Database Workbench</span>
            </div>
          </Link>

          <nav className="site-nav" aria-label="Main navigation">
            {NAV_LINKS.map(({ to, label }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) => (isActive ? "nav-active" : "")}
              >
                {label}
              </NavLink>
            ))}
          </nav>

          <a
            href="https://github.com/eru123/workgrid-studio/releases/latest"
            className="header-cta"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Download WorkGrid Studio"
          >
            Download
          </a>
        </header>
      </div>

      <main>
        <Outlet />
      </main>

      <div className="container">
        <footer className="site-footer">
          <Link to="/" className="footer-brand">
            <img
              src="/favicon-32x32.png"
              alt=""
              className="footer-mark"
              width="24"
              height="24"
              aria-hidden="true"
            />
            <span>WorkGrid Studio</span>
          </Link>
          <span>
            Built by{" "}
            <a
              href="https://skiddph.com"
              target="_blank"
              rel="noopener noreferrer"
            >
              SKIDDPH
            </a>{" "}
            &mdash; Open source on{" "}
            <a
              href="https://github.com/eru123/workgrid-studio"
              target="_blank"
              rel="noopener noreferrer"
            >
              GitHub
            </a>
          </span>
        </footer>
      </div>
    </div>
  );
}
