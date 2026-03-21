import type { ThemeManifest, ThemeTokenColor, ColorTransform } from "./types";
import { TOKEN_TO_CSS_VAR } from "./tokens";

// ─── Color transform helpers ──────────────────────────────────────────────────

function parseHex(hex: string): { r: number; g: number; b: number } | null {
  const clean = hex.trim().replace(/^#/, "");
  if (clean.length === 3) {
    return {
      r: parseInt(clean[0] + clean[0], 16),
      g: parseInt(clean[1] + clean[1], 16),
      b: parseInt(clean[2] + clean[2], 16),
    };
  }
  if (clean.length === 6) {
    return {
      r: parseInt(clean.slice(0, 2), 16),
      g: parseInt(clean.slice(2, 4), 16),
      b: parseInt(clean.slice(4, 6), 16),
    };
  }
  return null;
}

function toHex(r: number, g: number, b: number): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return `#${clamp(r).toString(16).padStart(2, "0")}${clamp(g).toString(16).padStart(2, "0")}${clamp(b).toString(16).padStart(2, "0")}`;
}

function resolveColorTransform(baseHex: string, transform: ColorTransform): string | null {
  const base = parseHex(baseHex);
  if (!base) return null;
  const { fn, amount } = transform;

  if (fn === "transparent") {
    const opacity = Math.max(0, Math.min(1, 1 - amount));
    return `rgba(${base.r}, ${base.g}, ${base.b}, ${opacity.toFixed(3)})`;
  }

  if (fn === "darken") {
    const f = 1 - Math.max(0, Math.min(1, amount));
    return toHex(base.r * f, base.g * f, base.b * f);
  }

  if (fn === "lighten") {
    const f = Math.max(0, Math.min(1, amount));
    return toHex(base.r + (255 - base.r) * f, base.g + (255 - base.g) * f, base.b + (255 - base.b) * f);
  }

  if (fn === "mix" && transform.mixWith) {
    const target = parseHex(transform.mixWith);
    if (!target) return null;
    const t = Math.max(0, Math.min(1, amount));
    return toHex(
      base.r + (target.r - base.r) * t,
      base.g + (target.g - base.g) * t,
      base.b + (target.b - base.b) * t,
    );
  }

  return null;
}

// ─── Apply Theme to DOM ───────────────────────────────────────────────────────

/**
 * Applies a ThemeManifest to the document root by setting CSS custom properties.
 * Also toggles the `dark` / `light` class on <html> so Tailwind's dark-mode
 * variant and the existing `color-scheme` declaration keep working.
 *
 * Safe to call on every theme change — idempotent.
 */
export function applyTheme(manifest: ThemeManifest): void {
  const root = document.documentElement;

  // Toggle dark/light class for Tailwind
  root.classList.remove("dark", "light");
  root.classList.add(manifest.type);

  // Apply each color token to its mapped CSS variable
  for (const [token, cssVar] of Object.entries(TOKEN_TO_CSS_VAR)) {
    const value = manifest.colors[token];
    if (value) {
      root.style.setProperty(cssVar, value);
    }
  }

  // Apply any unknown tokens the theme defines that aren't in the standard map.
  // They are stored as --wgs-<token-slug> so custom themes can define new vars
  // and components can consume them without breaking the mapping table.
  for (const [token, value] of Object.entries(manifest.colors)) {
    if (value && !(token in TOKEN_TO_CSS_VAR)) {
      const cssVar = "--wgs-" + token.replace(/\./g, "-").replace(/[^a-zA-Z0-9-]/g, "");
      root.style.setProperty(cssVar, value);
    }
  }

  // Resolve and apply transforms (derived colors) defined in the theme manifest.
  if (manifest.transforms) {
    for (const [tokenKey, transform] of Object.entries(manifest.transforms)) {
      const baseValue = manifest.colors[transform.base];
      if (!baseValue) continue;
      const derived = resolveColorTransform(baseValue, transform);
      if (!derived) continue;
      const cssVar = TOKEN_TO_CSS_VAR[tokenKey] ?? `--wgs-${tokenKey.replace(/\./g, "-").replace(/[^a-zA-Z0-9-]/g, "")}`;
      root.style.setProperty(cssVar, derived);
    }
  }
}

// ─── CodeMirror 6 Theme Bridge ────────────────────────────────────────────────
//
// Returns a plain object describing the CM6 theme. When CodeMirror 6 is added
// to the project, pass this config to `EditorView.theme()` and the highlight
// style builder.  For now it is exported so the future CM6 integration can
// consume it without touching this file.

export interface Cm6ThemeConfig {
  /** EditorView.theme() styles: selector → CSS rule map */
  editorStyles: Record<string, Record<string, string>>;
  /** Highlight style tag entries: scope → CSS color/fontStyle */
  tokenStyles: Array<{ scope: string; color?: string; fontStyle?: string }>;
}

export function buildCm6ThemeConfig(manifest: ThemeManifest): Cm6ThemeConfig {
  const c = manifest.colors;

  const editorStyles: Record<string, Record<string, string>> = {
    "&": {
      color:           c["editor.foreground"] ?? "inherit",
      backgroundColor: c["editor.background"] ?? "transparent",
    },
    ".cm-content": {
      caretColor: c["editorCursor.foreground"] ?? "auto",
    },
    ".cm-cursor, .cm-dropCursor": {
      borderLeftColor: c["editorCursor.foreground"] ?? "auto",
    },
    "&.cm-focused .cm-selectionBackground, ::selection": {
      backgroundColor: c["editor.selectionBackground"] ?? "#264f78",
    },
    ".cm-selectionBackground": {
      backgroundColor: c["editor.inactiveSelectionBackground"] ?? "#3a3d41",
    },
    ".cm-activeLine": {
      backgroundColor: c["editor.lineHighlightBackground"] ?? "transparent",
    },
    ".cm-gutters": {
      backgroundColor: c["editorGutter.background"] ?? c["editor.background"] ?? "transparent",
      color:           c["editorLineNumber.foreground"] ?? "#858585",
      border:          "none",
    },
    ".cm-activeLineGutter": {
      backgroundColor: c["editor.lineHighlightBackground"] ?? "transparent",
      color:           c["editorLineNumber.activeForeground"] ?? "#c6c6c6",
    },
    ".cm-indentMark": {
      borderLeft: `1px solid ${c["editorIndentGuide.background"] ?? "#404040"}`,
    },
  };

  const tokenStyles = flattenTokenColors(manifest.tokenColors);

  return { editorStyles, tokenStyles };
}

/** Flatten an array of ThemeTokenColor entries into a simple scope → style map */
function flattenTokenColors(
  tokenColors: ThemeTokenColor[],
): Array<{ scope: string; color?: string; fontStyle?: string }> {
  const result: Array<{ scope: string; color?: string; fontStyle?: string }> = [];
  for (const entry of tokenColors) {
    const scopes = Array.isArray(entry.scope) ? entry.scope : [entry.scope];
    for (const scope of scopes) {
      result.push({
        scope,
        color:     entry.settings.foreground,
        fontStyle: entry.settings.fontStyle,
      });
    }
  }
  return result;
}
