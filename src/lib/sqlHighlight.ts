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

export function tokeniseSQL(sql: string): Token[] {
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
    if ("(),;.*+-/%&|^~:[]{}".includes(ch)) {
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

export function getActiveQueryRange(
  sql: string,
  startPos: number,
  endPos: number,
): { start: number; end: number; text: string } | null {
  const tokens = tokeniseSQL(sql);
  let currentIndex = 0;

  let currentStmtStart = 0;
  let stmts: { start: number; end: number; text: string }[] = [];

  for (const token of tokens) {
    const tokenLen = token.value.length;

    if (token.type === "punctuation" && token.value === ";") {
      stmts.push({
        start: currentStmtStart,
        end: currentIndex + tokenLen,
        text: sql.slice(currentStmtStart, currentIndex + tokenLen),
      });
      currentStmtStart = currentIndex + tokenLen;
    }

    currentIndex += tokenLen;
  }

  if (currentStmtStart < sql.length) {
    const text = sql.slice(currentStmtStart);
    stmts.push({
      start: currentStmtStart,
      end: sql.length,
      text,
    });
  }

  // Find statements overlapping selection
  let activeStmts = stmts.filter((s) => {
    // Treat purely whitespace remainder as not important if selection isn't explicitly in it
    if (s.text.trim().length === 0 && startPos < s.start && endPos < s.start)
      return false;

    if (startPos === endPos) {
      return startPos >= s.start && startPos <= s.end;
    }
    // For range selection, if it intersects
    return Math.max(startPos, s.start) < Math.min(endPos, s.end);
  });

  // If we couldn't find an intersection (e.g. trailing empty space), fallback to last stmt
  if (activeStmts.length === 0 && stmts.length > 0) {
    activeStmts = [stmts[stmts.length - 1]];
  }

  // Filter out any purely whitespace statements unless it's the only one
  const nonEmptyStmts = activeStmts.filter((s) => s.text.trim().length > 0);
  if (nonEmptyStmts.length > 0) {
    activeStmts = nonEmptyStmts;
  }

  if (activeStmts.length === 0) return null;

  const start = activeStmts[0].start;
  const end = activeStmts[activeStmts.length - 1].end;
  return {
    start,
    end,
    text: sql.slice(start, end),
  };
}

export function findMatchingBrackets(
  sql: string,
  cursorPos: number,
): [number, number] | null {
  const tokens = tokeniseSQL(sql);

  let currentIndex = 0;
  const tokenPositions: {
    token: Token;
    start: number;
    end: number;
    index: number;
  }[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const len = token.value.length;
    tokenPositions.push({
      token,
      start: currentIndex,
      end: currentIndex + len,
      index: i,
    });
    currentIndex += len;
  }

  const OPEN_BRACKETS = "{[(";
  const CLOSE_BRACKETS = "}])";
  const BRACKET_PAIRS: Record<string, string> = {
    "{": "}",
    "[": "]",
    "(": ")",
    "}": "{",
    "]": "[",
    ")": "(",
  };

  let target: {
    token: Token;
    start: number;
    end: number;
    index: number;
  } | null = null;

  for (const pos of tokenPositions) {
    if (
      pos.token.type === "punctuation" &&
      pos.token.value.length === 1 &&
      (OPEN_BRACKETS.includes(pos.token.value) ||
        CLOSE_BRACKETS.includes(pos.token.value))
    ) {
      if (pos.end === cursorPos) {
        target = pos;
        break;
      }
    }
  }

  if (!target) {
    for (const pos of tokenPositions) {
      if (
        pos.token.type === "punctuation" &&
        pos.token.value.length === 1 &&
        (OPEN_BRACKETS.includes(pos.token.value) ||
          CLOSE_BRACKETS.includes(pos.token.value))
      ) {
        if (pos.start === cursorPos) {
          target = pos;
          break;
        }
      }
    }
  }

  if (!target) return null;

  const isForward = OPEN_BRACKETS.includes(target.token.value);
  const targetBracket = target.token.value;
  const matchBracket = BRACKET_PAIRS[targetBracket];

  let depth = 0;
  if (isForward) {
    for (let i = target.index + 1; i < tokenPositions.length; i++) {
      const p = tokenPositions[i];
      if (p.token.type === "punctuation") {
        if (p.token.value === targetBracket) depth++;
        else if (p.token.value === matchBracket) {
          if (depth === 0) return [target.start, p.start];
          depth--;
        }
      }
    }
  } else {
    for (let i = target.index - 1; i >= 0; i--) {
      const p = tokenPositions[i];
      if (p.token.type === "punctuation") {
        if (p.token.value === targetBracket) depth++;
        else if (p.token.value === matchBracket) {
          if (depth === 0) return [p.start, target.start];
          depth--;
        }
      }
    }
  }

  return null;
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
export function highlightSQL(
  sql: string,
  activeStart: number = 0,
  activeEnd: number = sql.length,
  matchBrackets: [number, number] | null = null,
): string {
  if (!sql) return "\n";

  const tokens = tokeniseSQL(sql);
  let html = "";
  let currentIndex = 0;
  let inActiveRegion = false;

  for (const token of tokens) {
    const tokenLen = token.value.length;

    // Check if token overlaps with the active query range
    const tokenStart = currentIndex;
    const tokenEnd = currentIndex + tokenLen;
    const isActive =
      Math.max(tokenStart, activeStart) < Math.min(tokenEnd, activeEnd) ||
      (activeStart === activeEnd &&
        activeStart >= tokenStart &&
        activeStart <= tokenEnd &&
        activeStart !== sql.length);

    // If we transition into active region, open span
    if (isActive && !inActiveRegion) {
      // Provide a distinct block-like background for the active query text
      html += `<span class="bg-primary/10 rounded-sm">`;
      inActiveRegion = true;
    } else if (!isActive && inActiveRegion) {
      // If we transition out, close span
      html += `</span>`;
      inActiveRegion = false;
    }

    const escaped = escapeHtml(token.value);
    const color = TOKEN_COLORS[token.type];

    let isMatchBracket = false;
    if (
      matchBrackets &&
      (tokenStart === matchBrackets[0] || tokenStart === matchBrackets[1])
    ) {
      isMatchBracket = true;
    }

    let innerHtml = escaped;
    if (color) {
      innerHtml = `<span style="color:${color}">${escaped}</span>`;
    }

    if (isMatchBracket) {
      html += `<span class="bg-primary/30 outline outline-primary/50 font-bold rounded-[2px]">${innerHtml}</span>`;
    } else {
      html += innerHtml;
    }

    currentIndex += tokenLen;
  }

  if (inActiveRegion) {
    html += `</span>`;
  }

  // Extra newline ensures the overlay height matches the textarea
  // (browsers add a trailing line to textareas)
  html += "\n";

  return html;
}
