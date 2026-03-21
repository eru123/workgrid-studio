// ─── SQL Formatter wrapper ────────────────────────────────────────────────────
// Lazy-loads sql-formatter so it doesn't bloat the initial bundle.

let _modulePromise: Promise<typeof import("sql-formatter")> | null = null;

function getSqlFormatter(): Promise<typeof import("sql-formatter")> {
  if (!_modulePromise) {
    _modulePromise = import("sql-formatter");
  }
  return _modulePromise;
}

/**
 * Format a SQL string using sql-formatter with the MySQL dialect.
 * Async because the formatter module is lazy-loaded on first call.
 */
export async function formatSql(sql: string, language: "mysql" | "postgresql" | "sqlite" = "mysql"): Promise<string> {
  const { format } = await getSqlFormatter();
  return format(sql, { language });
}
