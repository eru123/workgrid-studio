// Public API barrel for the WorkGrid UI library.
//
// Import from the host app as:
//   import { Workbench, MonacoEditor, applyTheme, Codicon } from '@/wg';
//
// The library is split into four layers, each independently importable:
//   - theme/    : color tokens + theming runtime (applyTheme, registerColor)
//   - editor/   : Monaco wrapper (3 modes) + language/provider seams
//   - shell/    : React workbench parts (Workbench, ActivityBar, ...)
//   - backend/  : Rust-IPC seam interfaces (unimplemented)

//  ------ Theming

export {
	applyTheme,
	applyTokenMap,
	getCurrentThemeKind,
	registerColor,
	resolveColorValue,
	asCssVariable,
	asCssVariableName,
	type ThemeKind,
	type ResolvedTheme,
	type IColorTheme,
	type ColorIdentifier,
	type ColorValue,
	type ColorDefaults,
} from './theme/themeService.js';

export * from './theme/colors.js';

import './base/browser/ui/codicons/codiconStyles.js';

export { Codicon } from './base/common/codicons.js';
export { ThemeIcon } from './base/common/themables.js';

//  ------ Monaco editor

export { MonacoEditor } from './editor/MonacoEditor.js';
export type { MonacoEditorMode, MonacoEditorProps } from './editor/MonacoEditor.js';
export { registerLanguage, registerLanguageServiceAdapters } from './editor/languages.js';
export type { LanguageRegistration } from './editor/languages.js';
export type {
	CompletionProviderAdapter,
	HoverProviderAdapter,
	DiagnosticsAdapter,
	LanguageServiceAdapters,
	IBackendCompletionItem,
	IBackendCompletionResult,
	IBackendHover,
	IBackendDiagnostic,
	BackendCompletionItemKind,
} from './editor/providers.js';

//  ------ Shell

export { Workbench } from './shell/Workbench.js';
export type { WorkbenchProps } from './shell/Workbench.js';

export { Welcome } from './shell/Welcome.js';
export type { WelcomeProps } from './shell/Welcome.js';

export { ConnectModal } from './shell/ConnectModal.js';
export type { ConnectModalProps } from './shell/ConnectModal.js';

export { ActivityBar } from './shell/ActivityBar.js';
export type { ActivityBarProps } from './shell/ActivityBar.js';

export { Sidebar } from './shell/Sidebar.js';
export type { SidebarProps } from './shell/Sidebar.js';

export { ViewPane, ViewPaneContainer, PaneBody } from './shell/ViewPane.js';
export type { ViewPaneProps, ViewPaneContainerProps } from './shell/ViewPane.js';

export { EditorArea, Tabs, Breadcrumbs } from './shell/EditorArea.js';
export type { EditorGroup } from './shell/EditorArea.js';

export { StatusBar } from './shell/StatusBar.js';
export type { StatusBarProps } from './shell/StatusBar.js';

export { Panel } from './shell/Panel.js';
export type { PanelProps } from './shell/Panel.js';

export { CredentialsEditor } from './shell/credentials/CredentialsEditor.js';
export type { CredentialsEditorProps } from './shell/credentials/CredentialsEditor.js';

export { CommandPalette } from './shell/CommandPalette.js';
export type { CommandPaletteProps } from './shell/CommandPalette.js';

export { Notifications } from './shell/Notifications.js';
export type { NotificationsProps } from './shell/Notifications.js';

export { ContextMenu } from './shell/ContextMenu.js';
export type { ContextMenuProps } from './shell/ContextMenu.js';

export { Tooltip } from './shell/Tooltip.js';
export type { TooltipProps } from './shell/Tooltip.js';

export { TitleBar } from './shell/TitleBar.js';
export type { TitleBarProps, TitleBarMenuItem } from './shell/TitleBar.js';

export { Sash } from './shell/Sash.js';
export type { SashProps } from './shell/Sash.js';

export { Tree } from './shell/Tree.js';
export type { TreeProps } from './shell/Tree.js';

//  ------ Shared view-model types (shell/types.ts)

export type {
	ActivityBarItem,
	ViewPaneContainerDescriptor,
	ViewPaneDescriptor,
	EditorTab,
	BreadcrumbItem,
	StatusBarItem,
	PanelTab,
	CommandPaletteItem,
	NotificationItem,
	NotificationSeverity,
	ContextMenuItem,
} from './shell/types.js';

//  ------ Backend seams + IPC data types

export type {
	WorkbenchBackend,
	TreeBackend,
	EditorBackend,
	BackendAdapter,
	TreeNode,
	TreeBadge,
} from './backend/BackendAdapter.js';

export type {
	QueryResultSet,
	ColumnInfo,
	TableInfo,
	DatabaseInfo,
	ConnectParams,
	ConnectionHandle,
} from './backend/types.js';

export {
	createCredentialsTreeBackend,
} from './backend/credentialsTreeBackend.js';
export { createWorkbenchBackend } from './backend/workbenchBackend.js';
