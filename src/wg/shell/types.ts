// Shared types for the React shell parts. These describe the data the shell
// renders — they are NOT backend types. The host maps its backend
// (WorkbenchBackend) into these view-models, or passes them directly as props.

import type { TreeNode } from '../backend/BackendAdapter.js';
import type { IBackendDiagnostic } from '../editor/providers.js';

//  ------ Activity bar

export interface ActivityBarItem {
	readonly id: string;
	/** Codicon id, e.g. 'files', 'search', 'source-control', 'debug', 'extensions'. */
	readonly icon: string;
	readonly title: string;
	/** Optional badge (count or dot). */
	readonly badge?: { readonly text: string; readonly kind?: 'default' | 'error' | 'warning' };
	/** Which sidebar view container this item toggles. */
	readonly viewContainerId?: string;
}

//  ------ Sidebar / view panes

export interface ViewPaneContainerDescriptor {
	readonly id: string;
	readonly title: string;
	readonly icon?: string;
	readonly panes: readonly ViewPaneDescriptor[];
}

export interface ViewPaneDescriptor {
	readonly id: string;
	readonly title: string;
	/** Optional tree data source for this pane. */
	readonly tree?: import('../backend/BackendAdapter.js').TreeBackend;
	/** Optional custom render (host provides React nodes for non-tree panes). */
	readonly render?: () => import('react').ReactNode;
	readonly initiallyCollapsed?: boolean;
}

//  ------ Editor area / tabs

export interface EditorTab {
	readonly id: string;
	readonly label: string;
	readonly icon?: string;
	readonly resource?: string;
	readonly language?: string;
	readonly dirty?: boolean;
	readonly preview?: boolean;
	/** The editor kind: a Monaco text editor, a diff, or a custom host view. */
	readonly kind: 'text' | 'diff' | 'custom';
	/** For 'text'/'diff': the initial contents. */
	readonly value?: string;
	/** For 'diff': the original contents. */
	readonly original?: string;
	/** For 'custom': host-provided React node. */
	readonly render?: () => import('react').ReactNode;
	readonly diagnostics?: readonly IBackendDiagnostic[];
}

export interface EditorGroup {
	readonly id: string;
	readonly tabs: readonly EditorTab[];
	readonly activeTabId?: string;
	readonly orientation: 'horizontal' | 'vertical';
	/** Child groups forming a split. Empty for a leaf group. */
	readonly children?: readonly EditorGroup[];
	/** Active split sizes (px or %), parallel to children. */
	readonly sizes?: readonly number[];
}

/** Data props for the tab strip (the Tabs component). */
export interface TabsProps {
	readonly tabs: readonly EditorTab[];
	readonly activeTabId?: string;
}

export interface BreadcrumbItem {
	readonly label: string;
	readonly icon?: string;
	readonly tooltip?: string;
	/** Payload passed back on click. */
	readonly data?: unknown;
}

//  ------ Status bar

export interface StatusBarItem {
	readonly id: string;
	readonly text: string;
	readonly tooltip?: string;
	readonly icon?: string;
	readonly alignment: 'left' | 'right';
	/** Higher = further from the edge within its alignment. */
	readonly priority: number;
	readonly kind?: 'default' | 'error' | 'warning' | 'info';
	readonly commandId?: string;
}

//  ------ Panel (bottom)

export interface PanelTab {
	readonly id: string;
	readonly label: string;
	readonly icon?: string;
	readonly render?: () => import('react').ReactNode;
}

//  ------ Command palette

export interface CommandPaletteItem {
	readonly id: string;
	readonly label: string;
	readonly category?: string;
	readonly keybinding?: string;
	readonly icon?: string;
	readonly detail?: string;
}

//  ------ Notifications

export type NotificationSeverity = 'info' | 'warning' | 'error';

export interface NotificationItem {
	readonly id: string;
	readonly severity: NotificationSeverity;
	readonly message: string;
	readonly source?: string;
	readonly actions?: readonly { readonly id: string; readonly label: string }[];
	readonly sticky?: boolean;
}

//  ------ Context menu

export interface ContextMenuItem {
	readonly id: string;
	readonly label: string;
	readonly icon?: string;
	readonly kind?: 'default' | 'separator' | 'checkbox' | 'radio';
	readonly checked?: boolean;
	readonly disabled?: boolean;
	readonly submenu?: readonly ContextMenuItem[];
	readonly accelerator?: string;
}

//  ------ Tree (re-exported for host convenience)

export type { TreeNode } from '../backend/BackendAdapter.js';
