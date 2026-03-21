// ─── Token → CSS Variable Mapping ────────────────────────────────────────────
//
// Maps every ThemeColors token key to the CSS custom property it controls.
// applyTheme() iterates this map and calls setProperty() on :root.
//
// The CSS variable names on the right intentionally match the existing
// globals.css custom properties so that Tailwind utilities keep working
// without modification.

export const TOKEN_TO_CSS_VAR: Record<string, string> = {
  // Editor
  "editor.background":                  "--color-background",
  "editor.foreground":                  "--color-foreground",
  "editor.lineHighlightBackground":     "--color-editor-line-highlight",
  "editor.selectionBackground":         "--color-editor-selection",
  "editor.inactiveSelectionBackground": "--color-editor-inactive-selection",
  "editorCursor.foreground":            "--color-editor-cursor",
  "editorLineNumber.foreground":        "--color-editor-line-number",
  "editorLineNumber.activeForeground":  "--color-editor-line-number-active",
  "editorGutter.background":            "--color-editor-gutter",
  "editorIndentGuide.background":       "--color-editor-indent-guide",
  "editorIndentGuide.activeBackground": "--color-editor-indent-guide-active",

  // Activity Bar
  "activityBar.background":             "--color-activity-bar",
  "activityBar.foreground":             "--color-activity-bar-foreground",
  "activityBar.inactiveForeground":     "--color-activity-bar-inactive",
  "activityBar.activeBorder":           "--color-activity-bar-active-border",
  "activityBar.border":                 "--color-activity-bar-border",

  // Side Bar
  "sideBar.background":                 "--color-secondary",
  "sideBar.foreground":                 "--color-secondary-foreground",
  "sideBar.border":                     "--color-border",
  "sideBarTitle.foreground":            "--color-sidebar-title",
  "sideBarSectionHeader.background":    "--color-sidebar-section-header",
  "sideBarSectionHeader.foreground":    "--color-sidebar-section-header-foreground",
  "sideBarSectionHeader.border":        "--color-sidebar-section-header-border",

  // Tabs
  "tab.activeBackground":               "--color-tab-active",
  "tab.activeForeground":               "--color-tab-active-foreground",
  "tab.activeBorderTop":                "--color-tab-active-border",
  "tab.inactiveBackground":             "--color-tab-inactive",
  "tab.inactiveForeground":             "--color-tab-inactive-foreground",
  "tab.border":                         "--color-tab-border",
  "tab.hoverBackground":                "--color-tab-hover",
  "tab.unfocusedActiveBackground":      "--color-tab-unfocused",
  "editorGroupHeader.tabsBackground":   "--color-tab-bar",
  "editorGroupHeader.tabsBorder":       "--color-tab-bar-border",

  // Status Bar
  "statusBar.background":               "--color-status-bar",
  "statusBar.foreground":               "--color-status-bar-foreground",
  "statusBar.border":                   "--color-status-bar-border",
  "statusBar.hoverBackground":          "--color-status-bar-hover",
  "statusBar.itemHoverBackground":      "--color-status-bar-item-hover",

  // Panel
  "panel.background":                   "--color-panel",
  "panel.border":                       "--color-panel-border",
  "panelTitle.activeForeground":        "--color-panel-title-active",
  "panelTitle.inactiveForeground":      "--color-panel-title-inactive",
  "panelTitle.activeBorder":            "--color-panel-title-border",

  // Input
  "input.background":                   "--color-input",
  "input.foreground":                   "--color-foreground",
  "input.border":                       "--color-border",
  "input.placeholderForeground":        "--color-muted-foreground",
  "inputOption.activeBorder":           "--color-ring",

  // Buttons
  "button.background":                  "--color-primary",
  "button.foreground":                  "--color-primary-foreground",
  "button.hoverBackground":             "--color-primary-hover",
  "button.secondaryBackground":         "--color-secondary",
  "button.secondaryForeground":         "--color-secondary-foreground",
  "button.secondaryHoverBackground":    "--color-secondary-hover",

  // Dropdown
  "dropdown.background":                "--color-popover",
  "dropdown.foreground":                "--color-popover-foreground",
  "dropdown.border":                    "--color-border",

  // Lists & Trees
  "list.hoverBackground":               "--color-accent",
  "list.hoverForeground":               "--color-accent-foreground",
  "list.activeSelectionBackground":     "--color-primary",
  "list.activeSelectionForeground":     "--color-primary-foreground",
  "list.inactiveSelectionBackground":   "--color-accent",
  "list.inactiveSelectionForeground":   "--color-accent-foreground",
  "list.focusBackground":               "--color-accent",
  "list.focusForeground":               "--color-accent-foreground",
  "tree.indentGuidesStroke":            "--color-tree-indent",

  // Badges
  "badge.background":                   "--color-badge",
  "badge.foreground":                   "--color-badge-foreground",

  // Scrollbar
  "scrollbarSlider.background":         "--color-scrollbar",
  "scrollbarSlider.hoverBackground":    "--color-scrollbar-hover",
  "scrollbarSlider.activeBackground":   "--color-scrollbar-active",

  // Menu / Popover
  "menu.background":                    "--color-popover",
  "menu.foreground":                    "--color-popover-foreground",
  "menu.selectionBackground":           "--color-accent",
  "menu.selectionForeground":           "--color-accent-foreground",
  "menu.separatorBackground":           "--color-border",
  "menu.border":                        "--color-border",

  // Shared
  "focusBorder":                        "--color-ring",
  "foreground":                         "--color-foreground",
  "widget.shadow":                      "--color-shadow",
  "selection.background":               "--color-editor-selection",

  // Data Grid
  "dataGrid.background":                "--color-data-grid",
  "dataGrid.headerBackground":          "--color-data-grid-header",
  "dataGrid.headerForeground":          "--color-data-grid-header-foreground",
  "dataGrid.rowHoverBackground":        "--color-data-grid-row-hover",
  "dataGrid.selectedRowBackground":     "--color-data-grid-row-selected",
  "dataGrid.selectedRowForeground":     "--color-data-grid-row-selected-foreground",
  "dataGrid.gridLine":                  "--color-data-grid-line",
  "dataGrid.nullForeground":            "--color-data-grid-null",
  "dataGrid.blobForeground":            "--color-data-grid-blob",
};
