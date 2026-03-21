// ─── Connection URL Parser ────────────────────────────────────────────────────
//
// Parses mysql://, postgres://, and sqlite:// connection strings into
// partial ConnectionProfile-shaped objects for auto-populating the connection form.

export interface ParsedConnectionUrl {
  type?: "mysql" | "postgres" | "sqlite" | "mariadb";
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
  /** For sqlite: the file path */
  filePath?: string;
}

/**
 * Parse a connection URL string into a partial profile config.
 * Returns `null` if the URL cannot be parsed or has an unsupported scheme.
 *
 * Supported formats:
 *   mysql://user:pass@host:port/dbname
 *   mariadb://user:pass@host:port/dbname
 *   postgres://user:pass@host:port/dbname
 *   postgresql://user:pass@host:port/dbname
 *   sqlite:///path/to/file.db
 *   sqlite://relative/path.db
 */
export function parseConnectionUrl(url: string): ParsedConnectionUrl | null {
  const trimmed = url.trim();
  if (!trimmed) return null;

  // ── SQLite ────────────────────────────────────────────────────────────────
  if (trimmed.startsWith("sqlite://")) {
    const path = trimmed.slice("sqlite://".length).replace(/^\//, "");
    if (!path) return null;
    return { type: "sqlite", filePath: "/" + path };
  }

  // ── MySQL / MariaDB / Postgres ────────────────────────────────────────────
  let scheme: string;
  let rest: string;
  try {
    const u = new URL(trimmed);
    scheme = u.protocol.replace(":", "").toLowerCase();
    rest = trimmed; // keep original for URL object access below
  } catch {
    return null;
  }

  const u = new URL(rest);

  let type: ParsedConnectionUrl["type"];
  if (scheme === "mysql") type = "mysql";
  else if (scheme === "mariadb") type = "mariadb";
  else if (scheme === "postgres" || scheme === "postgresql") type = "postgres";
  else return null;

  const result: ParsedConnectionUrl = { type };

  if (u.hostname) result.host = u.hostname;
  if (u.port)     result.port = parseInt(u.port, 10);
  if (u.username) result.user = decodeURIComponent(u.username);
  if (u.password) result.password = decodeURIComponent(u.password);

  // Path is /dbname — strip the leading slash
  const dbPath = u.pathname.replace(/^\/+/, "");
  if (dbPath) result.database = dbPath;

  return result;
}
