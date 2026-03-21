// ─── Keybinding Engine Types ─────────────────────────────────────────────────

/**
 * All registered command IDs.
 * Adding a new command: extend this union and add a handler registration
 * in the relevant component via useCommand().
 */
export type CommandId =
  // Layout
  | "layout.toggleSidebar"
  | "layout.togglePanel"
  | "layout.toggleSecondarySidebar"
  | "layout.focusEditor"
  // Tabs
  | "tab.newSqlQuery"
  | "tab.close"
  | "tab.reopenClosed"
  | "tab.nextTab"
  | "tab.prevTab"
  // Query
  | "query.execute"
  | "query.executeAll"
  | "query.format"
  | "query.explain"
  // Editor
  | "editor.find"
  | "editor.selectAll"
  // App
  | "app.commandPalette"
  | "app.openSettings"
  | "app.showShortcuts"
  // Connection
  | "connection.connect"
  | "connection.disconnect"
  | "connection.reconnect"
  // Export
  | "data.exportCsv"
  | "data.exportJson"
  | "data.exportSql"
  // Allow extension commands via string namespace
  | `ext.${string}`;

/** A single resolved keybinding entry */
export interface KeybindingEntry {
  /** The command to fire */
  command: CommandId | string;
  /**
   * Key chord string. Uses the format:
   *   - Modifier keys: Ctrl, Shift, Alt, Meta (use Meta for Cmd on macOS)
   *   - Separator: +
   *   - Chord: two chords separated by a space (e.g. "Ctrl+K Ctrl+S")
   * Examples: "Ctrl+Enter", "Ctrl+Shift+P", "Ctrl+K Ctrl+0"
   */
  key: string;
  /**
   * Optional context expression. If omitted the binding fires in any context.
   * Supported atoms: identifiers from WhenContext keys.
   * Logical operators: &&, ||, !
   * Equality: ==, !=
   * Examples:
   *   "editorFocus"
   *   "editorFocus && !inputFocus"
   *   "activeTabType == 'sql'"
   */
  when?: string;
  /** Pre-compiled evaluator for `when`. Built at load time from `when` string. */
  whenFn?: (ctx: WhenContext) => boolean;
  /** If true this is a default binding that can be overridden by the user file */
  isDefault?: boolean;
}

/** Live context map — evaluated against `when` expressions */
export interface WhenContext {
  editorFocus: boolean;
  inputFocus: boolean;
  sidebarVisible: boolean;
  panelVisible: boolean;
  activeTabType: string;
  hasActiveConnection: boolean;
  commandPaletteOpen: boolean;
  modalOpen: boolean;
  [key: string]: boolean | string | number;
}

/** A command handler function registered by a component */
export type CommandHandler = (event?: KeyboardEvent) => void;
