import { Link } from "react-router-dom";

export function NotFound() {
  return (
    <div className="inner-page container">
      <div className="inner-hero fade-up" style={{ textAlign: "center", maxWidth: "none" }}>
        <p className="eyebrow" style={{ justifyContent: "center" }}>404</p>
        <h1 className="inner-title" style={{ fontSize: "clamp(2rem, 6vw, 4rem)" }}>
          Page not found
        </h1>
        <p className="inner-lead" style={{ maxWidth: "36rem", margin: "0 auto 2rem" }}>
          The page you're looking for doesn't exist or has moved.
        </p>
        <div style={{ display: "flex", gap: "1rem", justifyContent: "center", flexWrap: "wrap" }}>
          <Link to="/" className="button-link">
            Go home
          </Link>
          <Link to="/docs" className="ghost-link">
            Read the docs
          </Link>
        </div>
      </div>
    </div>
  );
}
