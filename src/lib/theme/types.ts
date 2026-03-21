// ─── Theme Manifest Types ────────────────────────────────────────────────────
//
// A theme is a plain JSON file loaded at runtime. It contains two sections:
//   - colors: semantic UI tokens mapped to hex/rgba values
//   - tokenColors: syntax-highlighting rules consumed by the CM6 bridge
//
// The JSON format is intentionally close to VSCode's theme format so that
// existing VSCode themes can be adapted with minimal effort.

export interface ThemeTokenColor {
  /** A single scope string or an array of scope strings (e.g. "keyword", ["keyword.control", "keyword.other"]) */
  scope: string | string[];
  settings: {
    foreground?: string;
    /** Space-separated font style flags: "bold", "italic", "underline", "strikethrough" */
    fontStyle?: string;
  };
}

/**
 * The full set of UI color tokens.
 * Keys follow the `namespace.property` convention used by VSCode.
 * Values must be valid CSS color strings (hex, rgb, rgba, hsl).
 */
export interface ThemeColors {
  // ── Editor ─────────────────────────────────────────────────────────
  "editor.background"?: string;
  "editor.foreground"?: string;
  "editor.lineHighlightBackground"?: string;
  "editor.selectionBackground"?: string;
  "editor.inactiveSelectionBackground"?: string;
  "editorCursor.foreground"?: string;
  "editorLineNumber.foreground"?: string;
  "editorLineNumber.activeForeground"?: string;
  "editorGutter.background"?: string;
  "editorIndentGuide.background"?: string;
  "editorIndentGuide.activeBackground"?: string;

  // ── Activity Bar ────────────────────────────────────────────────────
  "activityBar.background"?: string;
  "activityBar.foreground"?: string;
  "activityBar.inactiveForeground"?: string;
  "activityBar.activeBorder"?: string;
  "activityBar.border"?: string;

  // ── Side Bar ────────────────────────────────────────────────────────
  "sideBar.background"?: string;
  "sideBar.foreground"?: string;
  "sideBar.border"?: string;
  "sideBarTitle.foreground"?: string;
  "sideBarSectionHeader.background"?: string;
  "sideBarSectionHeader.foreground"?: string;
  "sideBarSectionHeader.border"?: string;

  // ── Tabs ────────────────────────────────────────────────────────────
  "tab.activeBackground"?: string;
  "tab.activeForeground"?: string;
  "tab.activeBorderTop"?: string;
  "tab.inactiveBackground"?: string;
  "tab.inactiveForeground"?: string;
  "tab.border"?: string;
  "tab.hoverBackground"?: string;
  "tab.unfocusedActiveBackground"?: string;
  "editorGroupHeader.tabsBackground"?: string;
  "editorGroupHeader.tabsBorder"?: string;

  // ── Status Bar ──────────────────────────────────────────────────────
  "statusBar.background"?: string;
  "statusBar.foreground"?: string;
  "statusBar.border"?: string;
  "statusBar.hoverBackground"?: string;
  "statusBar.itemHoverBackground"?: string;

  // ── Panel (bottom) ──────────────────────────────────────────────────
  "panel.background"?: string;
  "panel.border"?: string;
  "panelTitle.activeForeground"?: string;
  "panelTitle.inactiveForeground"?: string;
  "panelTitle.activeBorder"?: string;

  // ── Input Controls ──────────────────────────────────────────────────
  "input.background"?: string;
  "input.foreground"?: string;
  "input.border"?: string;
  "input.placeholderForeground"?: string;
  "inputOption.activeBorder"?: string;

  // ── Buttons ─────────────────────────────────────────────────────────
  "button.background"?: string;
  "button.foreground"?: string;
  "button.hoverBackground"?: string;
  "button.secondaryBackground"?: string;
  "button.secondaryForeground"?: string;
  "button.secondaryHoverBackground"?: string;

  // ── Dropdowns / Selects ─────────────────────────────────────────────
  "dropdown.background"?: string;
  "dropdown.foreground"?: string;
  "dropdown.border"?: string;

  // ── Lists & Trees ────────────────────────────────────────────────────
  "list.hoverBackground"?: string;
  "list.hoverForeground"?: string;
  "list.activeSelectionBackground"?: string;
  "list.activeSelectionForeground"?: string;
  "list.inactiveSelectionBackground"?: string;
  "list.inactiveSelectionForeground"?: string;
  "list.focusBackground"?: string;
  "list.focusForeground"?: string;
  "tree.indentGuidesStroke"?: string;

  // ── Badges ──────────────────────────────────────────────────────────
  "badge.background"?: string;
  "badge.foreground"?: string;

  // ── Scrollbar ───────────────────────────────────────────────────────
  "scrollbarSlider.background"?: string;
  "scrollbarSlider.hoverBackground"?: string;
  "scrollbarSlider.activeBackground"?: string;

  // ── Popover / Menu ──────────────────────────────────────────────────
  "menu.background"?: string;
  "menu.foreground"?: string;
  "menu.selectionBackground"?: string;
  "menu.selectionForeground"?: string;
  "menu.separatorBackground"?: string;
  "menu.border"?: string;

  // ── General / Shared ────────────────────────────────────────────────
  "focusBorder"?: string;
  "foreground"?: string;
  "widget.shadow"?: string;
  "selection.background"?: string;

  // ── Data Grid ────────────────────────────────────────────────────────
  "dataGrid.background"?: string;
  "dataGrid.headerBackground"?: string;
  "dataGrid.headerForeground"?: string;
  "dataGrid.rowHoverBackground"?: string;
  "dataGrid.selectedRowBackground"?: string;
  "dataGrid.selectedRowForeground"?: string;
  "dataGrid.gridLine"?: string;
  "dataGrid.nullForeground"?: string;
  "dataGrid.blobForeground"?: string;

  // Allow arbitrary additional tokens for custom themes / extensions
  [token: string]: string | undefined;
}

/**
 * A derived color computed from a base token at theme-apply time.
 * Avoids duplicating hover/active/disabled variants in the JSON.
 */
export interface ColorTransform {
  /** The base color token key — must exist in `colors` */
  base: string;
  /** Transform to apply to the base color */
  fn: "transparent" | "darken" | "lighten" | "mix";
  /** Amount in range 0–1. For transparent/darken/lighten: blend strength. For mix: ratio toward mixWith. */
  amount: number;
  /** For fn="mix": the target color to blend toward (hex or CSS color string) */
  mixWith?: string;
}

export interface ThemeManifest {
  /** Display name shown in the theme picker */
  name: string;
  /** Used to set the CSS `color-scheme` and default Tailwind `.dark` class */
  type: "dark" | "light";
  /** UI color tokens */
  colors: ThemeColors;
  /** Syntax highlighting rules for the code editor */
  tokenColors: ThemeTokenColor[];
  /**
   * Derived color tokens computed at apply time.
   * Keys are token names (same namespace as `colors`); values are transforms.
   * Applied after base colors so they can reference any base token.
   */
  transforms?: Record<string, ColorTransform>;
}
