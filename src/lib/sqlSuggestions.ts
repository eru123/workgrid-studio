// ═══════════════════════════════════════════════════════════════════════
//  SQL Autocomplete suggestion engine
//  Produces ranked suggestions based on cursor context
// ═══════════════════════════════════════════════════════════════════════

export type SuggestionKind =
  | "keyword"
  | "function"
  | "type"
  | "database"
  | "table"
  | "column";

export interface Suggestion {
  label: string;
  kind: SuggestionKind;
  detail?: string;
  insertText?: string; // if different from label (e.g. backtick-wrapped)
}

// ── SQL vocabulary ───────────────────────────────────────────────────

const SQL_KEYWORDS = [
  "SELECT",
  "FROM",
  "WHERE",
  "INSERT",
  "INTO",
  "UPDATE",
  "DELETE",
  "SET",
  "CREATE",
  "ALTER",
  "DROP",
  "TABLE",
  "DATABASE",
  "INDEX",
  "VIEW",
  "JOIN",
  "INNER",
  "LEFT",
  "RIGHT",
  "OUTER",
  "CROSS",
  "FULL",
  "NATURAL",
  "ON",
  "AS",
  "AND",
  "OR",
  "NOT",
  "IN",
  "IS",
  "NULL",
  "TRUE",
  "FALSE",
  "LIKE",
  "BETWEEN",
  "EXISTS",
  "HAVING",
  "GROUP",
  "BY",
  "ORDER",
  "ASC",
  "DESC",
  "LIMIT",
  "OFFSET",
  "UNION",
  "ALL",
  "DISTINCT",
  "CASE",
  "WHEN",
  "THEN",
  "ELSE",
  "END",
  "IF",
  "BEGIN",
  "COMMIT",
  "ROLLBACK",
  "TRANSACTION",
  "PRIMARY",
  "KEY",
  "FOREIGN",
  "REFERENCES",
  "CONSTRAINT",
  "UNIQUE",
  "DEFAULT",
  "AUTO_INCREMENT",
  "CHECK",
  "VALUES",
  "USE",
  "SHOW",
  "DESCRIBE",
  "EXPLAIN",
  "WITH",
  "RECURSIVE",
  "TEMPORARY",
  "REPLACE",
  "TRUNCATE",
  "RENAME",
  "ADD",
  "COLUMN",
  "MODIFY",
  "CHANGE",
  "CASCADE",
  "RESTRICT",
  "ENGINE",
  "CHARSET",
  "COLLATE",
  "PROCEDURE",
  "FUNCTION",
  "TRIGGER",
  "EVENT",
  "DECLARE",
  "CURSOR",
  "RETURN",
  "RETURNS",
  "DETERMINISTIC",
  "WHILE",
  "DO",
  "REPEAT",
  "UNTIL",
  "LOOP",
  "LEAVE",
  "ITERATE",
  "COMMENT",
  "AFTER",
  "BEFORE",
  "EACH",
  "ROW",
  "FOR",
  "EXCEPT",
  "INTERSECT",
  "OVER",
  "PARTITION",
  "CURRENT_TIMESTAMP",
  "CURRENT_DATE",
  "CURRENT_TIME",
  "SCHEMA",
  "TABLES",
  "COLUMNS",
  "STATUS",
  "VARIABLES",
  "DATABASES",
  "LOCK",
  "UNLOCK",
  "READ",
  "WRITE",
  "LOCAL",
  "GLOBAL",
  "SESSION",
  "DELIMITER",
  "NOT NULL",
  "GROUP BY",
  "ORDER BY",
  "LEFT JOIN",
  "RIGHT JOIN",
  "INNER JOIN",
  "CROSS JOIN",
  "FULL JOIN",
  "INSERT INTO",
  "CREATE TABLE",
  "ALTER TABLE",
  "DROP TABLE",
  "IF EXISTS",
  "IF NOT EXISTS",
];

const SQL_FUNCTIONS = [
  "COUNT",
  "SUM",
  "AVG",
  "MIN",
  "MAX",
  "ABS",
  "CONCAT",
  "CONCAT_WS",
  "SUBSTRING",
  "SUBSTR",
  "TRIM",
  "LTRIM",
  "RTRIM",
  "UPPER",
  "LOWER",
  "LENGTH",
  "CHAR_LENGTH",
  "REPLACE",
  "REVERSE",
  "LPAD",
  "RPAD",
  "SPACE",
  "ROUND",
  "CEIL",
  "CEILING",
  "FLOOR",
  "MOD",
  "POWER",
  "SQRT",
  "NOW",
  "CURDATE",
  "CURTIME",
  "DATE",
  "TIME",
  "TIMESTAMP",
  "DATE_FORMAT",
  "DATE_ADD",
  "DATE_SUB",
  "DATEDIFF",
  "TIMESTAMPDIFF",
  "YEAR",
  "MONTH",
  "DAY",
  "HOUR",
  "MINUTE",
  "SECOND",
  "COALESCE",
  "NULLIF",
  "IFNULL",
  "ISNULL",
  "CAST",
  "CONVERT",
  "GROUP_CONCAT",
  "JSON_EXTRACT",
  "JSON_OBJECT",
  "ROW_NUMBER",
  "RANK",
  "DENSE_RANK",
  "LAG",
  "LEAD",
  "FIRST_VALUE",
  "LAST_VALUE",
  "IF",
  "IIF",
  "GREATEST",
  "LEAST",
  "HEX",
  "UNHEX",
  "MD5",
  "SHA1",
  "SHA2",
  "UUID",
  "FOUND_ROWS",
  "LAST_INSERT_ID",
  "ROW_COUNT",
];

const SQL_TYPES = [
  "INT",
  "INTEGER",
  "BIGINT",
  "SMALLINT",
  "TINYINT",
  "MEDIUMINT",
  "FLOAT",
  "DOUBLE",
  "DECIMAL",
  "NUMERIC",
  "CHAR",
  "VARCHAR",
  "TEXT",
  "TINYTEXT",
  "MEDIUMTEXT",
  "LONGTEXT",
  "BLOB",
  "TINYBLOB",
  "MEDIUMBLOB",
  "LONGBLOB",
  "DATE",
  "DATETIME",
  "TIMESTAMP",
  "TIME",
  "YEAR",
  "BOOLEAN",
  "BOOL",
  "BIT",
  "JSON",
  "ENUM",
  "SET",
  "BINARY",
  "VARBINARY",
  "UNSIGNED",
  "SIGNED",
];

// ── Context detection ────────────────────────────────────────────────

type SqlContext =
  | "table" // expects table name (after FROM, JOIN, UPDATE, INTO, TABLE)
  | "database" // expects database name (after USE, DATABASE) or after dot context
  | "column" // expects column name (after SELECT, WHERE, SET, ON, ORDER BY, GROUP BY etc.)
  | "dot-table" // after `dbname.` — suggest tables for that db
  | "dot-column" // after `table.` — suggest columns for that table
  | "general"; // fallback — keywords, functions, types

interface ContextInfo {
  context: SqlContext;
  prefix: string; // the partial word being typed
  dotPrefix?: string; // the word before the dot (for dotted contexts)
}

/**
 * Determine what kind of completion the user likely wants based on
 * the text before the cursor.
 */
export function detectContext(sql: string, cursorPos: number): ContextInfo {
  const before = sql.slice(0, cursorPos);

  // Check for dot notation: `something.partial`
  const dotMatch = before.match(
    /([a-zA-Z_`][a-zA-Z0-9_`]*)\.\s*([a-zA-Z_][a-zA-Z0-9_]*)?$/,
  );
  if (dotMatch) {
    const rawDot = dotMatch[1].replace(/`/g, "");
    const prefix = dotMatch[2] ?? "";
    // We don't know at this point whether `rawDot` is a database or a table —
    // the caller will try both and merge results.
    return { context: "dot-table", prefix, dotPrefix: rawDot };
  }

  // Extract the partial word being typed (at cursor)
  const wordMatch = before.match(/([a-zA-Z_][a-zA-Z0-9_]*)$/);
  const prefix = wordMatch ? wordMatch[1] : "";

  // Find the preceding non-whitespace token (skip the current word)
  const stripped = before.slice(0, before.length - prefix.length).trimEnd();

  // Grab last 1-2 tokens for context
  const tokenMatch = stripped.match(/([a-zA-Z_]+)\s+([a-zA-Z_]+)\s*$/i);
  const lastTwoTokens = tokenMatch
    ? `${tokenMatch[1].toUpperCase()} ${tokenMatch[2].toUpperCase()}`
    : null;

  const singleTokenMatch = stripped.match(/([a-zA-Z_]+)\s*$/i);
  const lastToken = singleTokenMatch ? singleTokenMatch[1].toUpperCase() : null;

  // Two-token contexts
  if (lastTwoTokens) {
    if (
      ["ORDER BY", "GROUP BY", "SORT BY"].includes(lastTwoTokens) ||
      lastTwoTokens.endsWith("BY")
    ) {
      return { context: "column", prefix };
    }
    if (
      ["INSERT INTO", "CREATE TABLE", "ALTER TABLE", "DROP TABLE"].includes(
        lastTwoTokens,
      )
    ) {
      return { context: "table", prefix };
    }
    if (["IF EXISTS", "IF NOT"].includes(lastTwoTokens)) {
      return { context: "table", prefix };
    }
  }

  // Single-token contexts
  if (lastToken) {
    if (
      [
        "FROM",
        "JOIN",
        "UPDATE",
        "INTO",
        "TABLE",
        "DESCRIBE",
        "DESC",
        "TRUNCATE",
      ].includes(lastToken)
    ) {
      return { context: "table", prefix };
    }
    if (["USE", "DATABASE", "SCHEMA"].includes(lastToken)) {
      return { context: "database", prefix };
    }
    if (
      ["SELECT", "WHERE", "SET", "ON", "HAVING", "AND", "OR", "BY"].includes(
        lastToken,
      )
    ) {
      return { context: "column", prefix };
    }
  }

  return { context: "general", prefix };
}

// ── Build suggestions ────────────────────────────────────────────────

interface SchemaInfo {
  databases: string[];
  tables: string[]; // tables in the currently selected database
  columns: Array<{ name: string; type: string; table: string }>;
  // For dot-prefix lookups
  tablesForDb: (db: string) => string[];
  columnsForTable: (table: string) => Array<{ name: string; type: string }>;
}

function needsBacktick(name: string): boolean {
  return /[^a-zA-Z0-9_]/.test(name) || /^[0-9]/.test(name);
}

function wrapIfNeeded(name: string): string {
  return needsBacktick(name) ? `\`${name}\`` : name;
}

function matchScore(label: string, prefix: string): number {
  if (!prefix) return 1;
  const ll = label.toLowerCase();
  const pl = prefix.toLowerCase();
  if (ll === pl) return 100;
  if (ll.startsWith(pl)) return 80;
  if (ll.includes(pl)) return 40;
  return 0;
}

export function getSuggestions(
  contextInfo: ContextInfo,
  schema: SchemaInfo,
  maxResults = 40,
): Suggestion[] {
  const { context, prefix, dotPrefix } = contextInfo;
  const results: Array<Suggestion & { score: number }> = [];

  const addIfMatch = (
    label: string,
    kind: SuggestionKind,
    detail?: string,
    insertText?: string,
  ) => {
    const score = matchScore(label, prefix);
    if (score > 0) {
      results.push({ label, kind, detail, insertText, score });
    }
  };

  switch (context) {
    case "dot-table":
    case "dot-column": {
      if (!dotPrefix) break;
      // Try as database → show tables
      const tablesForDot = schema.tablesForDb(dotPrefix);
      for (const t of tablesForDot) {
        addIfMatch(t, "table", `Table in ${dotPrefix}`, wrapIfNeeded(t));
      }
      // Try as table → show columns
      const colsForDot = schema.columnsForTable(dotPrefix);
      for (const c of colsForDot) {
        addIfMatch(c.name, "column", c.type, wrapIfNeeded(c.name));
      }
      break;
    }

    case "database":
      for (const db of schema.databases) {
        addIfMatch(db, "database", "Database", wrapIfNeeded(db));
      }
      break;

    case "table":
      for (const t of schema.tables) {
        addIfMatch(t, "table", "Table", wrapIfNeeded(t));
      }
      // Also offer database names (cross-database queries)
      for (const db of schema.databases) {
        addIfMatch(db, "database", "Database", wrapIfNeeded(db));
      }
      break;

    case "column":
      // Columns first
      for (const c of schema.columns) {
        addIfMatch(
          c.name,
          "column",
          `${c.type} · ${c.table}`,
          wrapIfNeeded(c.name),
        );
      }
      // Table names (for table.* or table aliases)
      for (const t of schema.tables) {
        addIfMatch(t, "table", "Table", wrapIfNeeded(t));
      }
      // Functions
      for (const f of SQL_FUNCTIONS) {
        addIfMatch(f, "function", "Function", `${f}(`);
      }
      // Keywords
      for (const kw of SQL_KEYWORDS) {
        addIfMatch(kw, "keyword", "Keyword");
      }
      break;

    case "general":
    default:
      // Keywords
      for (const kw of SQL_KEYWORDS) {
        addIfMatch(kw, "keyword", "Keyword");
      }
      // Functions
      for (const f of SQL_FUNCTIONS) {
        addIfMatch(f, "function", "Function", `${f}(`);
      }
      // Types
      for (const t of SQL_TYPES) {
        addIfMatch(t, "type", "Type");
      }
      // Tables
      for (const t of schema.tables) {
        addIfMatch(t, "table", "Table", wrapIfNeeded(t));
      }
      // Databases
      for (const db of schema.databases) {
        addIfMatch(db, "database", "Database", wrapIfNeeded(db));
      }
      // Columns
      for (const c of schema.columns) {
        addIfMatch(
          c.name,
          "column",
          `${c.type} · ${c.table}`,
          wrapIfNeeded(c.name),
        );
      }
      break;
  }

  // Deduplicate by label+kind, keeping highest score
  const seen = new Map<string, (typeof results)[number]>();
  for (const item of results) {
    const key = `${item.kind}::${item.label}`;
    const existing = seen.get(key);
    if (!existing || item.score > existing.score) {
      seen.set(key, item);
    }
  }

  return [...seen.values()]
    .sort((a, b) => {
      // Sort by score descending, then by kind priority, then alphabetically
      if (b.score !== a.score) return b.score - a.score;
      const kindOrder: Record<SuggestionKind, number> = {
        column: 0,
        table: 1,
        database: 2,
        function: 3,
        keyword: 4,
        type: 5,
      };
      const ka = kindOrder[a.kind] ?? 99;
      const kb = kindOrder[b.kind] ?? 99;
      if (ka !== kb) return ka - kb;
      return a.label.localeCompare(b.label);
    })
    .slice(0, maxResults);
}

// ── Cursor position measurement ──────────────────────────────────────

/**
 * Measures the pixel position of a cursor inside a textarea by mirroring
 * the text into a hidden div with identical styling.
 * Returns {top, left} relative to the textarea element.
 */
export function measureCursorPosition(
  textarea: HTMLTextAreaElement,
  position: number,
): { top: number; left: number } {
  const mirror = document.createElement("div");
  const style = getComputedStyle(textarea);

  // Copy all relevant styles
  const props = [
    "fontFamily",
    "fontSize",
    "fontWeight",
    "fontStyle",
    "letterSpacing",
    "textTransform",
    "wordSpacing",
    "textIndent",
    "whiteSpace",
    "wordWrap",
    "overflowWrap",
    "wordBreak",
    "lineHeight",
    "paddingTop",
    "paddingRight",
    "paddingBottom",
    "paddingLeft",
    "borderTopWidth",
    "borderRightWidth",
    "borderBottomWidth",
    "borderLeftWidth",
    "boxSizing",
  ] as const;

  mirror.style.position = "absolute";
  mirror.style.top = "-9999px";
  mirror.style.left = "-9999px";
  mirror.style.visibility = "hidden";
  mirror.style.overflow = "hidden";
  mirror.style.width = `${textarea.clientWidth}px`;

  for (const prop of props) {
    (mirror.style as unknown as Record<string, string>)[prop] =
      style.getPropertyValue(
        prop.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`),
      );
  }

  // Text up to cursor
  const textBefore = textarea.value.slice(0, position);
  const textNode = document.createTextNode(textBefore);
  mirror.appendChild(textNode);

  // Cursor marker
  const marker = document.createElement("span");
  marker.textContent = "|";
  mirror.appendChild(marker);

  document.body.appendChild(mirror);

  const markerRect = marker.getBoundingClientRect();
  const mirrorRect = mirror.getBoundingClientRect();

  const top = markerRect.top - mirrorRect.top - textarea.scrollTop;
  const left = markerRect.left - mirrorRect.left - textarea.scrollLeft;

  document.body.removeChild(mirror);

  return { top, left };
}
