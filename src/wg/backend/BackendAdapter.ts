// Backend seam interfaces — TYPES ONLY, no implementation.
//
// These describe where a future Rust IPC backend plugs into the UI library.
// The shell parts take these as props (or via a context) and call them for
// data; the Rust layer implements them. Nothing here is wired to real I/O.
//
// Three concerns are separated:
//   - TreeBackend   : hierarchical data for the explorer / sidebar tree views.
//   - EditorBackend : Monaco language-service feed (completion/hover/diagnostics).
//   - BackendAdapter: general backend operations (file ops, commands, etc.).
//
// The Monaco provider adapters themselves live in editor/providers.ts; this
// file gives the EditorBackend the shape the host uses to build those adapters.

import type { LanguageServiceAdapters } from '../editor/providers.js';

//  ------ Tree data source (explorer / sidebar views)

export interface TreeNode<T = unknown> {
	readonly id: string;
	readonly label: string;
	/** Codicon id (e.g. 'folder', 'database', 'symbol-method') or a ThemeIcon id. */
	readonly icon?: string;
	readonly tooltip?: string;
	readonly description?: string;
	/** Badges shown next to the label (e.g. counts, status dots). */
	readonly badges?: readonly TreeBadge[];
	/** Whether this node can have children (controls expansion affordance). */
	readonly collapsible?: boolean;
	/** Arbitrary data the host view attaches (e.g. a resource handle). */
	readonly data?: T;
}

export interface TreeBadge {
	readonly text: string;
	readonly tooltip?: string;
	readonly kind?: 'default' | 'error' | 'warning' | 'info';
}

/**
 * Tree data source. The Rust backend implements this to feed explorer-style
 * views. The sidebar's ViewPaneContainer calls `getChildren` lazily as nodes
 * are expanded.
 */
export interface TreeBackend<T = unknown> {
	/** Root nodes of the tree. */
	getRoots(): Promise<readonly TreeNode<T>[]> | readonly TreeNode<T>[];
	/** Children of a node. Called when a collapsible node is expanded. */
	getChildren(node: TreeNode<T>): Promise<readonly TreeNode<T>[]> | readonly TreeNode<T>[];
	/** Optional: called when a node is activated (single click / Enter). */
	onActivate?(node: TreeNode<T>): void;
	/** Optional: called when a node's context menu is requested. */
	onContextMenu?(node: TreeNode<T> | undefined, anchor: { x: number; y: number }): void;
}

//  ------ Editor language-service feed

/**
 * Provides `LanguageServiceAdapters` (defined in editor/providers.ts) per
 * language. The host queries this when an editor opens a model of a given
 * language; if the backend has services for it, the host registers them with
 * Monaco via `registerLanguageServiceAdapters`.
 *
 * The UI library does NOT call this itself — it exposes it as the contract the
 * Rust IPC layer implements. The host wires the call.
 */
export interface EditorBackend {
	getLanguageServices(languageId: string): Promise<LanguageServiceAdapters | undefined> | LanguageServiceAdapters | undefined;
}

//  ------ General backend operations

/**
 * General backend operations the shell may need (open file, run command, etc.).
 * Intentionally minimal — grow as the host wires real features. All methods are
 * optional so a stub backend can implement only what's needed.
 */
export interface BackendAdapter {
	/** Open a resource (e.g. a file path or URI) in the editor area. */
	openResource?(resource: string): Promise<void> | void;
	/** Read a resource's contents (for the editor to display). */
	readResource?(resource: string): Promise<string> | string;
	/** Write contents back to a resource (save). */
	writeResource?(resource: string, contents: string): Promise<void> | void;
	/** Run a command by id (the command palette calls this). */
	runCommand?(commandId: string, args?: readonly unknown[]): Promise<unknown> | unknown;
}

//  ------ Aggregated backend handle

/**
 * The full backend the Workbench shell expects. The host constructs this (with
 * real Rust IPC implementations, or stubs/mocks for demo) and passes it to
 * `<Workbench backend={...} />`. Any field may be omitted; the shell degrades
 * gracefully (e.g. a missing tree backend renders an empty tree).
 */
export interface WorkbenchBackend {
	readonly tree?: TreeBackend;
	readonly editor?: EditorBackend;
	readonly general?: BackendAdapter;
}
