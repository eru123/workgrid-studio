import type { ThemeManifest, ThemeTokenColor } from "./types";
import { TOKEN_TO_CSS_VAR } from "./tokens";

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
