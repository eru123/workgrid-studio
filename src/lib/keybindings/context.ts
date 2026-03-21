import type { WhenContext } from "./types";

// ─── When Context Store ───────────────────────────────────────────────────────

let _ctx: WhenContext = {
  editorFocus: false,
  inputFocus: false,
  sidebarVisible: true,
  panelVisible: false,
  activeTabType: "",
  hasActiveConnection: false,
  commandPaletteOpen: false,
  modalOpen: false,
};

/** Update one or more context keys. Called by components on relevant state changes. */
export function setContext(patch: Partial<WhenContext>): void {
  _ctx = { ..._ctx, ...patch } as WhenContext;
}

/** Read the current context snapshot */
export function getContext(): Readonly<WhenContext> {
  return _ctx;
}

// ─── When Expression Evaluator ────────────────────────────────────────────────
//
// Supports:
//   - bare identifier:           "editorFocus"          → ctx["editorFocus"]
//   - negation:                  "!inputFocus"           → !ctx["inputFocus"]
//   - equality:                  "activeTabType == 'sql'"
//   - inequality:                "activeTabType != 'sql'"
//   - logical AND:               "editorFocus && !inputFocus"
//   - logical OR:                "a || b"
//
// Operator precedence: ! > && > ||  (same as JS)

/**
 * Parse a `when` expression once and return a reusable evaluator function.
 * Call at registration time; store the result on the binding entry.
 */
export function compileWhen(expr: string): (ctx: Readonly<WhenContext>) => boolean {
  const trimmed = expr.trim();
  return (ctx) => evaluateWhen(trimmed, ctx);
}

export function evaluateWhen(expr: string | undefined, ctx: Readonly<WhenContext>): boolean {
  if (!expr) return true;
  return parseOr(expr.trim(), ctx);
}

function parseOr(expr: string, ctx: Readonly<WhenContext>): boolean {
  const parts = splitOn(expr, "||");
  if (parts.length > 1) return parts.some((p) => parseAnd(p.trim(), ctx));
  return parseAnd(expr, ctx);
}

function parseAnd(expr: string, ctx: Readonly<WhenContext>): boolean {
  const parts = splitOn(expr, "&&");
  if (parts.length > 1) return parts.every((p) => parseAtom(p.trim(), ctx));
  return parseAtom(expr, ctx);
}

function parseAtom(expr: string, ctx: Readonly<WhenContext>): boolean {
  expr = expr.trim();

  // Negation
  if (expr.startsWith("!")) {
    return !parseAtom(expr.slice(1).trim(), ctx);
  }

  // Parentheses
  if (expr.startsWith("(") && expr.endsWith(")")) {
    return parseOr(expr.slice(1, -1), ctx);
  }

  // Equality / inequality
  const eqMatch = expr.match(/^(\w+)\s*==\s*['"]?([^'"]+)['"]?$/);
  if (eqMatch) {
    return String(ctx[eqMatch[1]] ?? "") === eqMatch[2].trim();
  }
  const neqMatch = expr.match(/^(\w+)\s*!=\s*['"]?([^'"]+)['"]?$/);
  if (neqMatch) {
    return String(ctx[neqMatch[1]] ?? "") !== neqMatch[2].trim();
  }

  // Boolean identifier
  const value = ctx[expr];
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value.length > 0;
  if (typeof value === "number") return value !== 0;
  return false;
}

/**
 * Split `expr` on `separator` but only at the top level
 * (not inside parentheses or quotes).
 */
function splitOn(expr: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let inQuote = false;
  let quoteChar = "";
  let start = 0;

  for (let i = 0; i < expr.length; i++) {
    const ch = expr[i];
    if (inQuote) {
      if (ch === quoteChar) inQuote = false;
      continue;
    }
    if (ch === '"' || ch === "'") { inQuote = true; quoteChar = ch; continue; }
    if (ch === "(") { depth++; continue; }
    if (ch === ")") { depth--; continue; }
    if (depth === 0 && expr.slice(i, i + separator.length) === separator) {
      parts.push(expr.slice(start, i));
      i += separator.length - 1;
      start = i + 1;
    }
  }
  parts.push(expr.slice(start));
  return parts;
}
