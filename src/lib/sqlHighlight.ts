// ═══════════════════════════════════════════════════════════════════════
//  Lightweight SQL syntax highlighter for the query editor
//  Produces an HTML string with colored spans (VS Code Dark+ palette)
// ═══════════════════════════════════════════════════════════════════════

// ── Token types ──────────────────────────────────────────────────────

type TokenType =
  | "keyword"
  | "function"
  | "type"
  | "string"
  | "number"
  | "comment"
  | "operator"
  | "backtick"
  | "identifier"
  | "punctuation"
  | "variable"
  | "text";

interface Token {
  type: TokenType;
  value: string;
}

// ── VS Code Dark+ colour map ────────────────────────────────────────

const TOKEN_COLORS: Partial<Record<TokenType, string>> = {
  keyword: "#569CD6",
  function: "#DCDCAA",
  type: "#4EC9B0",
  string: "#CE9178",
  number: "#B5CEA8",
  comment: "#6A9955",
  backtick: "#9CDCFE",
  variable: "#9CDCFE",
  punctuation: "#808080",
  // operator & identifier use default foreground (no span needed)
};

// ── Keyword / function / type sets ───────────────────────────────────

const SQL_KEYWORDS = new Set([
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
  "GRANT",
  "REVOKE",
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
  "TEMP",
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
  "FETCH",
  "OPEN",
  "CLOSE",
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
  "SIGNAL",
  "RESIGNAL",
  "CONDITION",
  "HANDLER",
  "CONTINUE",
  "EXIT",
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
  "CURRENT_USER",
  "SCHEMA",
  "TABLES",
  "COLUMNS",
  "STATUS",
  "VARIABLES",
  "DATABASES",
  "LIKE",
  "REGEXP",
  "RLIKE",
  "SOUNDS",
  "LOCK",
  "UNLOCK",
  "READ",
  "WRITE",
  "LOCAL",
  "GLOBAL",
  "SESSION",
  "DELIMITER",
]);

const SQL_FUNCTIONS = new Set([
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
  "NVL",
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
  "FORMAT",
  "LOCATE",
  "INSTR",
  "POSITION",
  "FIELD",
  "FIND_IN_SET",
  "INET_ATON",
  "INET_NTOA",
]);

const SQL_TYPES = new Set([
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
  "REAL",
  "NUMBER",
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
  "SERIAL",
  "MONEY",
]);

// ── Tokeniser ────────────────────────────────────────────────────────

function tokeniseSQL(sql: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const len = sql.length;

  while (i < len) {
    const ch = sql[i];

    // ── Single-line comment ──
    if (ch === "-" && sql[i + 1] === "-") {
      const end = sql.indexOf("\n", i);
      const stop = end === -1 ? len : end;
      tokens.push({ type: "comment", value: sql.slice(i, stop) });
      i = stop;
      continue;
    }

    // ── Hash comment (MySQL) ──
    if (ch === "#") {
      const end = sql.indexOf("\n", i);
      const stop = end === -1 ? len : end;
      tokens.push({ type: "comment", value: sql.slice(i, stop) });
      i = stop;
      continue;
    }

    // ── Multi-line comment ──
    if (ch === "/" && sql[i + 1] === "*") {
      const end = sql.indexOf("*/", i + 2);
      const stop = end === -1 ? len : end + 2;
      tokens.push({ type: "comment", value: sql.slice(i, stop) });
      i = stop;
      continue;
    }

    // ── Single-quoted string ──
    if (ch === "'") {
      let j = i + 1;
      while (j < len) {
        if (sql[j] === "'" && sql[j + 1] === "'") {
          j += 2;
        } else if (sql[j] === "\\") {
          j += 2;
        } else if (sql[j] === "'") {
          j++;
          break;
        } else {
          j++;
        }
      }
      tokens.push({ type: "string", value: sql.slice(i, j) });
      i = j;
      continue;
    }

    // ── Double-quoted string ──
    if (ch === '"') {
      let j = i + 1;
      while (j < len) {
        if (sql[j] === "\\") {
          j += 2;
        } else if (sql[j] === '"') {
          j++;
          break;
        } else {
          j++;
        }
      }
      tokens.push({ type: "string", value: sql.slice(i, j) });
      i = j;
      continue;
    }

    // ── Backtick identifier ──
    if (ch === "`") {
      let j = i + 1;
      while (j < len) {
        if (sql[j] === "`" && sql[j + 1] === "`") {
          j += 2;
        } else if (sql[j] === "`") {
          j++;
          break;
        } else {
          j++;
        }
      }
      tokens.push({ type: "backtick", value: sql.slice(i, j) });
      i = j;
      continue;
    }

    // ── @variable / @@variable ──
    if (ch === "@") {
      let j = i + 1;
      if (j < len && sql[j] === "@") j++;
      while (j < len && /[a-zA-Z0-9_]/.test(sql[j])) j++;
      if (j > i + 1) {
        tokens.push({ type: "variable", value: sql.slice(i, j) });
        i = j;
        continue;
      }
    }

    // ── Number ──
    if (
      /[0-9]/.test(ch) ||
      (ch === "." && i + 1 < len && /[0-9]/.test(sql[i + 1]))
    ) {
      let j = i;
      // Hex literal
      if (
        ch === "0" &&
        i + 1 < len &&
        (sql[i + 1] === "x" || sql[i + 1] === "X")
      ) {
        j += 2;
        while (j < len && /[0-9a-fA-F]/.test(sql[j])) j++;
      } else {
        while (j < len && /[0-9]/.test(sql[j])) j++;
        if (j < len && sql[j] === ".") {
          j++;
          while (j < len && /[0-9]/.test(sql[j])) j++;
        }
        if (j < len && (sql[j] === "e" || sql[j] === "E")) {
          j++;
          if (j < len && (sql[j] === "+" || sql[j] === "-")) j++;
          while (j < len && /[0-9]/.test(sql[j])) j++;
        }
      }
      tokens.push({ type: "number", value: sql.slice(i, j) });
      i = j;
      continue;
    }

    // ── Word (keyword / function / type / identifier) ──
    if (/[a-zA-Z_]/.test(ch)) {
      let j = i;
      while (j < len && /[a-zA-Z0-9_]/.test(sql[j])) j++;
      const word = sql.slice(i, j);
      const upper = word.toUpperCase();

      let type: TokenType = "identifier";
      if (SQL_KEYWORDS.has(upper)) type = "keyword";
      else if (SQL_TYPES.has(upper)) type = "type";
      else if (SQL_FUNCTIONS.has(upper)) type = "function";

      tokens.push({ type, value: word });
      i = j;
      continue;
    }

    // ── Multi-char operator ──
    if ("<>=!".includes(ch)) {
      let j = i + 1;
      if (j < len && "=><".includes(sql[j])) j++;
      tokens.push({ type: "operator", value: sql.slice(i, j) });
      i = j;
      continue;
    }

    // ── Punctuation / single-char operator ──
    if ("(),;.*+-/%&|^~:".includes(ch)) {
      tokens.push({ type: "punctuation", value: ch });
      i++;
      continue;
    }

    // ── Whitespace ──
    if (/\s/.test(ch)) {
      let j = i;
      while (j < len && /\s/.test(sql[j])) j++;
      tokens.push({ type: "text", value: sql.slice(i, j) });
      i = j;
      continue;
    }

    // ── Fallback ──
    tokens.push({ type: "text", value: ch });
    i++;
  }

  return tokens;
}

// ── HTML escaping ────────────────────────────────────────────────────

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// ── Public API ───────────────────────────────────────────────────────

/**
 * Highlight a SQL string and return an HTML string suitable for
 * `dangerouslySetInnerHTML`.  The output preserves all whitespace
 * and newlines so it can be rendered inside a `<pre>`.
 */
export function highlightSQL(sql: string): string {
  if (!sql) return "\n";

  const tokens = tokeniseSQL(sql);
  let html = "";

  for (const token of tokens) {
    const escaped = escapeHtml(token.value);
    const color = TOKEN_COLORS[token.type];

    if (color) {
      html += `<span style="color:${color}">${escaped}</span>`;
    } else {
      html += escaped;
    }
  }

  // Extra newline ensures the overlay height matches the textarea
  // (browsers add a trailing line to textareas)
  html += "\n";

  return html;
}
