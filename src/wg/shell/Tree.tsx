// A React tree view. VS Code's tree widgets (vs/base/browser/ui/tree/*) are
// imperative, service-light but DOM-heavy widgets with their own virtualization.
// For the shell's sidebar views this lightweight declarative tree is enough;
// it lazily loads children via the TreeBackend seam. The ported tree widgets
// remain available (base/browser/ui/tree) for hosts that need their
// virtualization/features — import them directly.
//
// Inline create/rename editing (VS Code explorer style), multi-select,
// drag-and-drop reparent/reorder, and deep-ancestor reveal are opt-in via the
// matching props. When omitted the tree renders read-only, exactly as before.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { TreeBackend, TreeNode } from '../backend/BackendAdapter.js';
import { codiconClass } from './icon.js';
import { validateVaultItemName } from './credentials/vaultNaming.js';

export interface TreeProps {
	backend?: TreeBackend;
	/** If provided, used as the roots instead of calling backend.getRoots(). */
	rootNodes?: readonly TreeNode[];
	/** Active inline edit session. Omit for a read-only tree. */
	editing?: TreeEditingState;
	/**
	 * Collapse-all trigger. Increment this value to collapse every expanded
	 * node (mirrors the refresh-key pattern). The value itself is arbitrary;
	 * only changes to it fire the collapse.
	 */
	collapseAllKey?: number;
	/** Currently selected node ids (multi-select). Omit for single-select-by-click. */
	selectedIds?: ReadonlySet<string>;
	/** Selection changed (plain click replaces; Ctrl toggles; Shift ranges). */
	onSelectChange?: (ids: Set<string>, anchorId: string) => void;
	/** Commit a create (inline input submitted). A returned string is an error
	 *  message shown in the input without closing it; `void`/`undefined` closes.
	 *  `kind` reports which create action opened the input ('file' | 'folder'). */
	onCommitCreate?: (name: string, parentId: string | null, kind: 'file' | 'folder') => Promise<string | void> | string | void;
	/** Commit a rename (inline input submitted). Same error-string contract. */
	onCommitRename?: (nodeId: string, newName: string) => Promise<string | void> | string | void;
	/** Cancel the active edit (Escape). */
	onCancelEdit?: () => void;
	/** Drop dragged nodes. `beforeId` inserts before that sibling; null appends. */
	onDropNodes?: (ids: string[], targetParentId: string | null, beforeId: string | null) => Promise<void> | void;
	/**
	 * Returns the ids of a node's descendants (for DnD cycle rejection).
	 * Optional; when omitted DnD still works but cycles are only caught by the
	 * backend's own guard. Recommended to supply for instant UI rejection.
	 */
	descendantIdsOf?: (id: string) => string[];
	/** Initial expansion decision for folders whose state has not been
	 *  created yet (e.g. the vault's persisted `expanded` flags). */
	defaultExpandedOf?: (node: TreeNode) => boolean;
	/** Notified on every folder toggle so hosts can persist expansion. */
	onToggleExpanded?: (node: TreeNode, expanded: boolean) => void;
	/** Context menu on the tree's empty area (below/around the nodes). */
	onEmptyContextMenu?: (anchor: { x: number; y: number }) => void;
	/**
	 * Reveal request: expand `chain` (ancestor folder ids, root → target
	 * parent, plus the node id itself) in order, then scroll the last node
	 * into view. Bump `key` to re-trigger; consumed after the next reload.
	 */
	revealRequest?: { key: number; chain: string[] };
}

/** Describes an inline edit session in the tree. */
export interface TreeEditingState {
	mode: 'create' | 'rename';
	/** For create: which action opened the input — decides the created type. */
	createType?: 'file' | 'folder';
	/** For rename: the node being renamed. For create: undefined. */
	nodeId?: string;
	/** Parent under which the item is created. `null` = vault root. */
	parentId: string | null;
	/** Initial input value (e.g. '' for a new folder, '.store' for a new entry). */
	initialValue?: string;
	/**
	 * Ancestor ids (root → … → parent) to expand + lazy-load in sequence so a
	 * deeply-nested inline edit is revealed even when all ancestors are
	 * collapsed. Optional; only needed for non-root targets.
	 */
	revealAncestors?: string[];
}

interface NodeState {
	expanded: boolean;
	children: readonly TreeNode[];
	loading: boolean;
}

/** Drop position computed from the pointer Y within a node row. */
type DropPos = 'before' | 'into' | 'after';

/** MIME type carrying dragged node ids (also used by document-level
 *  fallback handlers in hosts, e.g. root drops on blank sidebar areas). */
export const TREE_DRAG_MIME = 'application/x-wg-tree-ids';
const DRAG_MIME = TREE_DRAG_MIME;

export function Tree({
	backend,
	rootNodes,
	editing,
	collapseAllKey,
	selectedIds,
	onSelectChange,
	onCommitCreate,
	onCommitRename,
	onCancelEdit,
	onDropNodes,
	descendantIdsOf,
	defaultExpandedOf,
	onToggleExpanded,
	onEmptyContextMenu,
	revealRequest,
}: TreeProps) {
	const [roots, setRoots] = useState<readonly TreeNode[]>(rootNodes ?? []);
	const [states, setStates] = useState<Map<string, NodeState>>(new Map());
	const [activeId, setActiveId] = useState<string | undefined>();
	const [dragOver, setDragOver] = useState<{ id: string | null; pos: DropPos } | null>(null);
	const selectionAnchor = useRef<string | null>(null);
	// Fresh-read mirrors for async loops (reveal) without stale closures.
	const statesRef = useRef(states);
	useEffect(() => { statesRef.current = states; }, [states]);
	const rootsRef = useRef(roots);
	useEffect(() => { rootsRef.current = roots; }, [roots]);
	const listRef = useRef<HTMLUListElement>(null);
	// Generation guard: a backend swap invalidates in-flight reveals.
	const revealGen = useRef(0);
	const firstLoad = useRef(true);
	const revealReqRef = useRef(revealRequest);
	useEffect(() => { revealReqRef.current = revealRequest; }, [revealRequest]);
	const lastRevealKey = useRef(-1);

	/**
	 * Recursively expand + lazy-load every folder matching `pred` (used to
	 * restore persisted expansion and to preserve expansion across backend
	 * reloads). `gen` aborts when a newer reveal/reload supersedes this one.
	 * `ignoreLoaded` skips the "already expanded + loaded" shortcut — required
	 * right after a state clear, where the states ref still holds the stale
	 * pre-clear entries and the shortcut would silently drop the expansion.
	 */
	const reveal = useCallback(async (nodes: readonly TreeNode[], pred: (n: TreeNode) => boolean, visited: Set<string>, gen: number, ignoreLoaded = false) => {
		if (!backend) return;
		for (const node of nodes) {
			if (gen !== revealGen.current) return;
			if (!node.collapsible || visited.has(node.id)) continue;
			visited.add(node.id);
			if (!ignoreLoaded) {
				const already = statesRef.current.get(node.id);
				if (already?.expanded && already.children.length > 0) {
					await reveal(already.children, pred, visited, gen, ignoreLoaded);
					continue;
				}
			}
			if (!pred(node)) continue;
			setStates((prev) => {
				const n = new Map(prev);
				const cur = n.get(node.id) ?? { expanded: false, children: [] as readonly TreeNode[], loading: false };
				n.set(node.id, { ...cur, expanded: true, loading: true });
				return n;
			});
			const children = await Promise.resolve(backend.getChildren(node));
			if (gen !== revealGen.current) return;
			setStates((prev) => {
				const n = new Map(prev);
				const cur = n.get(node.id) ?? { expanded: true, children: [] as readonly TreeNode[], loading: false };
				n.set(node.id, { ...cur, children, loading: false });
				return n;
			});
			await reveal(children, pred, visited, gen, ignoreLoaded);
		}
	}, [backend]);

	/**
	 * Scroll a rendered node row into view (nearest scrollable ancestor).
	 * No-op when the row is not (yet) rendered.
	 */
	const scrollNodeIntoView = useCallback((nodeId: string) => {
		requestAnimationFrame(() => {
			listRef.current
				?.querySelector(`[data-node-id="${CSS.escape(nodeId)}"]`)
				?.scrollIntoView({ block: 'nearest' });
		});
	}, []);

	/** Expand `chain` and scroll its last node into view. */
	const runRevealRequest = useCallback(async (req: { key: number; chain: string[] }, nodes: readonly TreeNode[]) => {
		lastRevealKey.current = req.key;
		const gen = ++revealGen.current;
		const chain = new Set(req.chain);
		// ignoreLoaded: runs may race a just-cleared state map (post-reload).
		await reveal(nodes, (n) => chain.has(n.id), new Set(), gen, true);
		const lastId = req.chain[req.chain.length - 1];
		if (lastId) scrollNodeIntoView(lastId);
	}, [reveal, scrollNodeIntoView]);

	// (Re)load roots when the backend/rootNodes change. On a backend swap the
	// previously expanded ids are captured and re-revealed after the reload so
	// mutations don't collapse the user's tree; first load restores persisted
	// defaults via `defaultExpandedOf`. A pending `revealRequest` (e.g. reveal
	// the pasted node) is consumed here so it runs against fresh data.
	const loadedBackendRef = useRef<TreeBackend | null>(null);
	useEffect(() => {
		if (rootNodes) {
			setRoots(rootNodes);
			return;
		}
		if (!backend) {
			setRoots([]);
			return;
		}
		let cancelled = false;
		const isFirst = firstLoad.current;
		firstLoad.current = false;
		const gen = ++revealGen.current;
		const prevStates = isFirst ? null : statesRef.current;
		(async () => {
			const expandedIds = new Set<string>();
			if (prevStates) {
				for (const [id, st] of prevStates) {
					if (st.expanded) expandedIds.add(id);
				}
			}
			const fresh = await Promise.resolve(backend.getRoots());
			if (cancelled) return;
			loadedBackendRef.current = backend;
			setRoots(fresh);
			setStates(new Map());
			const pred = (n: TreeNode) => expandedIds.has(n.id) || (defaultExpandedOf?.(n) ?? false);
			if (expandedIds.size > 0 || defaultExpandedOf) {
				// ignoreLoaded: the states ref still holds pre-clear entries.
				await reveal(fresh, pred, new Set(), gen, true);
			}
			const pending = revealReqRef.current;
			if (pending && pending.key !== lastRevealKey.current) {
				await runRevealRequest(pending, rootsRef.current);
			}
		})();
		return () => { cancelled = true; };
	}, [backend, rootNodes, defaultExpandedOf, reveal, runRevealRequest]);

	// Reveal requests that arrive without a backend swap run immediately
	// against the current roots — but only once this backend's roots are
	// loaded; otherwise the post-swap reload above consumes the request.
	useEffect(() => {
		if (!revealRequest || revealRequest.key === lastRevealKey.current) return;
		if (!backend || backend !== loadedBackendRef.current) return;
		void runRevealRequest(revealRequest, rootsRef.current);
	}, [revealRequest, backend, runRevealRequest]);

	// Lazy-load children for a node id (used by toggle + reveal). Resolves the
	// parent TreeNode from the current rendered tree so the backend seam works.
	const loadChildren = useCallback(async (parentId: string) => {
		if (!backend) return;
		const parent = findRenderedNode(roots, states, parentId);
		if (!parent) return;
		const children = await Promise.resolve(backend.getChildren(parent));
		setStates((p) => {
			const n = new Map(p);
			const existing = n.get(parentId) ?? { expanded: false, children: [], loading: false };
			n.set(parentId, { ...existing, children, loading: false, expanded: true });
			return n;
		});
	}, [backend, roots, states]);

	const toggle = useCallback((node: TreeNode) => {
		if (!node.collapsible) {
			return;
		}
		const cur = statesRef.current.get(node.id);
		const curExpanded = cur?.expanded ?? defaultExpandedOf?.(node) ?? false;
		const willExpand = !curExpanded;
		onToggleExpanded?.(node, willExpand);
		if (willExpand && (cur?.children.length ?? 0) === 0 && backend) {
			setStates((prev) => {
				const next = new Map(prev);
				const existing = next.get(node.id) ?? { expanded: false, children: [] as readonly TreeNode[], loading: false };
				next.set(node.id, { ...existing, expanded: true, loading: true });
				return next;
			});
			Promise.resolve(backend.getChildren(node)).then((children) => {
				setStates((p) => {
					const n = new Map(p);
					const existing = n.get(node.id);
					if (!existing) return p;
					n.set(node.id, { ...existing, children, loading: false });
					return n;
				});
			});
		} else {
			setStates((prev) => {
				const next = new Map(prev);
				const existing = next.get(node.id) ?? { expanded: false, children: [] as readonly TreeNode[], loading: false };
				next.set(node.id, { ...existing, expanded: willExpand });
				return next;
			});
		}
	}, [backend, defaultExpandedOf, onToggleExpanded]);

	// Deep-ancestor reveal: expand + lazy-load the full chain in order so an
	// inline edit targeting a deeply-nested collapsed folder is visible.
	useEffect(() => {
		if (!editing || !editing.revealAncestors || editing.revealAncestors.length === 0) {
			return;
		}
		let cancelled = false;
		(async () => {
			for (const ancestorId of editing.revealAncestors!) {
				if (cancelled) return;
				const cur = states.get(ancestorId);
				if (cur && cur.expanded && cur.children.length > 0) {
					continue;
				}
				// Expand synchronously (optimistic) then load.
				setStates((prev) => {
					const n = new Map(prev);
					const existing = n.get(ancestorId) ?? { expanded: false, children: [], loading: false };
					n.set(ancestorId, { ...existing, expanded: true, loading: existing.children.length === 0 });
					return n;
				});
				await loadChildren(ancestorId);
			}
		})();
		return () => { cancelled = true; };
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [editing?.revealAncestors]);

	// Collapse every expanded node when `collapseAllKey` changes.
	useEffect(() => {
		if (collapseAllKey === undefined) {
			return;
		}
		setStates((prev) => {
			if (prev.size === 0) {
				return prev;
			}
			const next = new Map<string, NodeState>();
			for (const [id, st] of prev) {
				if (st.expanded || st.children.length > 0) {
					next.set(id, { ...st, expanded: false, children: [], loading: false });
				}
			}
			return next;
		});
	}, [collapseAllKey]);

	// Sibling name set for collision validation of an inline edit.
	const siblingNamesFor = useCallback((parentId: string | null, excludeNodeId?: string): Set<string> => {
		const siblings = parentId === null
			? roots
			: (states.get(parentId)?.children ?? []);
		const names = new Set<string>();
		for (const s of siblings) {
			if (excludeNodeId !== undefined && s.id === excludeNodeId) {
				continue;
			}
			names.add(s.label);
		}
		return names;
	}, [roots, states]);

	// Flattened visible node order (for Shift-click range selection).
	const visibleOrder = useMemo(() => collectVisibleIds(roots, states), [roots, states]);

	const handleNodeClick = useCallback((node: TreeNode, e: React.MouseEvent) => {
		if (node.collapsible && !(e.metaKey || e.ctrlKey || e.shiftKey)) {
			toggle(node);
		}
		setActiveId(node.id);
		backend?.onActivate?.(node);
		if (!onSelectChange) return;
		if (e.shiftKey && selectionAnchor.current) {
			const a = visibleOrder.indexOf(selectionAnchor.current);
			const b = visibleOrder.indexOf(node.id);
			if (a >= 0 && b >= 0) {
				const [lo, hi] = a < b ? [a, b] : [b, a];
				const range = new Set(visibleOrder.slice(lo, hi + 1));
				onSelectChange(range, selectionAnchor.current);
			} else {
				onSelectChange(new Set([node.id]), node.id);
				selectionAnchor.current = node.id;
			}
		} else if (e.metaKey || e.ctrlKey) {
			const next = new Set(selectedIds ?? []);
			if (next.has(node.id)) next.delete(node.id); else next.add(node.id);
			onSelectChange(next, node.id);
			selectionAnchor.current = node.id;
		} else {
			onSelectChange(new Set([node.id]), node.id);
			selectionAnchor.current = node.id;
		}
	}, [backend, toggle, onSelectChange, selectedIds, visibleOrder]);

	// ---- Drag & drop -------------------------------------------------------
	const handleDragStart = useCallback((e: React.DragEvent, node: TreeNode) => {
		// Drag the current selection if it includes the dragged node, else just
		// the dragged node.
		const sel = selectedIds && selectedIds.has(node.id) && selectedIds.size > 0
			? Array.from(selectedIds)
			: [node.id];
		e.dataTransfer.setData(DRAG_MIME, JSON.stringify(sel));
		e.dataTransfer.effectAllowed = 'move';
		// Custom drag chip (VS Code-style) — the browser's default snapshot of
		// the whole row anchors poorly in WebKitGTK. The ghost is off-screen
		// while captured and removed once the drag ends.
		const ghost = document.createElement('div');
		ghost.className = 'wg-tree-drag-ghost';
		ghost.textContent = sel.length > 1 ? `${node.label} (+${sel.length - 1} more)` : node.label;
		document.body.appendChild(ghost);
		e.dataTransfer.setDragImage(ghost, 12, 10);
		const cleanup = () => ghost.remove();
		(e.currentTarget as HTMLElement).addEventListener('dragend', cleanup, { once: true });
		window.setTimeout(cleanup, 10000);
	}, [selectedIds]);

	const computeDropPos = (e: React.DragEvent, el: HTMLElement): DropPos => {
		const rect = el.getBoundingClientRect();
		const y = e.clientY - rect.top;
		const h = rect.height;
		if (y < h * 0.25) return 'before';
		if (y > h * 0.75) return 'after';
		return 'into';
	};

	const handleDragOver = useCallback((e: React.DragEvent, node: TreeNode | null) => {
		if (!onDropNodes) return;
		e.preventDefault();
		e.dataTransfer.dropEffect = 'move';
		const el = (e.currentTarget as HTMLElement);
		const pos: DropPos = node === null ? 'after' : computeDropPos(e, el);
		const id = node?.id ?? null;
		setDragOver((prev) => (prev && prev.id === id && prev.pos === pos) ? prev : { id, pos });
	}, [onDropNodes]);

	const handleDragLeave = useCallback(() => {
		setDragOver(null);
	}, []);

	const resolveDrop = useCallback((node: TreeNode | null, pos: DropPos): { targetParentId: string | null; beforeId: string | null } => {
		if (node === null) {
			// Root drop (empty space).
			return { targetParentId: null, beforeId: null };
		}
		if (pos === 'into' && node.collapsible) {
			return { targetParentId: node.id, beforeId: null };
		}
		// before/after: sibling of the node, under the node's parent.
		const parentId = (node.data as { parentId?: string | null } | undefined)?.parentId ?? null;
		const siblings = parentId === null ? roots : (states.get(parentId)?.children ?? []);
		const idx = siblings.findIndex((s) => s.id === node.id);
		const beforeId = pos === 'after'
			? (idx + 1 < siblings.length ? siblings[idx + 1].id : null)
			: node.id;
		return { targetParentId: parentId, beforeId };
	}, [roots, states]);

	const handleDrop = useCallback(async (e: React.DragEvent, node: TreeNode | null) => {
		if (!onDropNodes) return;
		e.preventDefault();
		e.stopPropagation();
		setDragOver(null);
		const raw = e.dataTransfer.getData(DRAG_MIME);
		if (!raw) return;
		let ids: string[];
		try { ids = JSON.parse(raw) as string[]; } catch { return; }
		if (ids.length === 0) return;
		const pos: DropPos = node === null ? 'after' : computeDropPos(e, e.currentTarget as HTMLElement);
		const { targetParentId, beforeId } = resolveDrop(node, pos);
		// Cycle rejection: drop is invalid if the target parent is a descendant
		// of (or equal to) any dragged node.
		if (targetParentId !== null && descendantIdsOf) {
			for (const draggedId of ids) {
				const desc = descendantIdsOf(draggedId);
				if (draggedId === targetParentId || desc.includes(targetParentId)) {
					return; // reject silently; backend also guards
				}
			}
		}
		await Promise.resolve(onDropNodes(ids, targetParentId, beforeId));
	}, [onDropNodes, resolveDrop, descendantIdsOf]);

	const renderNode = (node: TreeNode, depth: number): React.ReactNode => {
		const state = states.get(node.id);
		const expanded = state?.expanded ?? false;
		const children = state?.children ?? [];
		const loading = state?.loading ?? false;
		const isRenaming = editing?.mode === 'rename' && editing.nodeId === node.id;
		const isSelected = selectedIds?.has(node.id) ?? false;
		const dropHint = dragOver?.id === node.id ? dragOver.pos : null;
		return (
			<li key={node.id} role="treeitem" aria-expanded={node.collapsible ? expanded : undefined}>
				<div
					className="wg-tree-node"
					data-node-id={node.id}
					data-active={activeId === node.id}
					data-selected={isSelected || undefined}
					data-dropping={dropHint ?? undefined}
					draggable={!!onDropNodes}
					style={{ paddingLeft: 8 + depth * 12 }}
					onClick={(e) => handleNodeClick(node, e)}
					onContextMenu={(e) => { e.preventDefault(); backend?.onContextMenu?.(node, { x: e.clientX, y: e.clientY }); }}
					onDragStart={onDropNodes ? (e) => handleDragStart(e, node) : undefined}
					onDragOver={onDropNodes ? (e) => handleDragOver(e, node) : undefined}
					onDragLeave={onDropNodes ? handleDragLeave : undefined}
					onDrop={onDropNodes ? (e) => { void handleDrop(e, node); } : undefined}
					title={node.tooltip}
				>
					<span className="wg-tree-node-twisty" data-empty={!node.collapsible}>
						{node.collapsible && (loading ? <span className={codiconClass('loading')} /> : <span className={codiconClass(expanded ? 'chevron-down' : 'chevron-right')} />)}
					</span>
					{node.icon && <span className={`wg-tree-node-icon ${codiconClass(node.icon)}`} />}
					{isRenaming ? (
						<InlineInput
							initialValue={editing!.initialValue ?? node.label}
							siblingNames={siblingNamesFor((node.data as { parentId?: string | null } | undefined)?.parentId ?? null, node.id)}
							excludeName={node.label}
							onSubmit={(name) => onCommitRename?.(node.id, name)}
							onCancel={onCancelEdit}
						/>
					) : (
						<span className="wg-tree-node-label">{node.label}</span>
					)}
					{!isRenaming && node.description && <span className="wg-tree-node-description">{node.description}</span>}
					{!isRenaming && node.badges?.map((b, i) => (
						<span key={i} className="wg-tree-node-badge" title={b.tooltip}>{b.text}</span>
					))}
				</div>
				{expanded && (
					<ul role="group" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
						{editing && editing.mode === 'create' && editing.parentId === node.id ? (
						<InlineInputRow
							depth={depth + 1}
							initialValue={editing.initialValue ?? ''}
							siblingNames={siblingNamesFor(node.id)}
							onSubmit={(name) => onCommitCreate?.(name, node.id, editing.createType ?? 'folder')}
							onCancel={onCancelEdit}
						/>
						) : null}
						{children.map((child) => renderNode(child, depth + 1))}
					</ul>
				)}
			</li>
		);
	};

	return (
		<ul
			ref={listRef}
			className="wg-tree"
			role="tree"
			data-drag-over-root={dragOver?.id === null ? '' : undefined}
			// Stretch to fill the host pane so the blank area below the last
			// row is a valid "drop at root" target (VS Code explorer parity).
			style={{ listStyle: 'none', padding: 0, margin: 0, minHeight: 24, flex: '1 1 auto' }}
			onDragOver={onDropNodes ? (e) => handleDragOver(e, null) : undefined}
			onDrop={onDropNodes ? (e) => { void handleDrop(e, null); } : undefined}
			onContextMenu={onEmptyContextMenu ? (e) => {
				// Only the tree's own empty area — node rows bubble up with
				// themselves as the target and keep their own menu.
				if (e.target === e.currentTarget) {
					e.preventDefault();
					onEmptyContextMenu({ x: e.clientX, y: e.clientY });
				}
			} : undefined}
		>
			{editing && editing.mode === 'create' && editing.parentId === null ? (
				<InlineInputRow
					depth={0}
					initialValue={editing.initialValue ?? ''}
					siblingNames={siblingNamesFor(null)}
					onSubmit={(name) => onCommitCreate?.(name, null, editing.createType ?? 'folder')}
					onCancel={onCancelEdit}
				/>
			) : null}
			{roots.map((node) => renderNode(node, 0))}
		</ul>
	);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Find a rendered TreeNode by id (searches roots + expanded children). */
function findRenderedNode(
	roots: readonly TreeNode[],
	states: Map<string, NodeState>,
	id: string,
): TreeNode | undefined {
	const search = (nodes: readonly TreeNode[]): TreeNode | undefined => {
		for (const n of nodes) {
			if (n.id === id) return n;
			const kids = states.get(n.id)?.children;
			if (kids) {
				const found = search(kids);
				if (found) return found;
			}
		}
		return undefined;
	};
	return search(roots);
}

/** Flatten the currently-visible (expanded) nodes into an ordered id list. */
function collectVisibleIds(roots: readonly TreeNode[], states: Map<string, NodeState>): string[] {
	const out: string[] = [];
	const walk = (nodes: readonly TreeNode[]) => {
		for (const n of nodes) {
			out.push(n.id);
			if (states.get(n.id)?.expanded) {
				walk(states.get(n.id)?.children ?? []);
			}
		}
	};
	walk(roots);
	return out;
}

// ---------------------------------------------------------------------------
// Inline input (create + rename share this control)
// ---------------------------------------------------------------------------

interface InlineInputProps {
	initialValue: string;
	siblingNames: ReadonlySet<string>;
	/** For rename: the node's own current name (skipped during collision check). */
	excludeName?: string;
	onSubmit: (name: string) => Promise<string | void> | string | void;
	onCancel?: () => void;
}

function InlineInput({ initialValue, siblingNames, excludeName, onSubmit, onCancel }: InlineInputProps) {
	const [value, setValue] = useState(initialValue);
	const [error, setError] = useState<string | null>(null);
	const [submitting, setSubmitting] = useState(false);
	const ref = useRef<HTMLInputElement>(null);

	// Auto-focus + select-all on mount (VS Code selects the whole name on rename).
	useEffect(() => {
		const el = ref.current;
		if (el) {
			el.focus();
			el.select();
		}
	}, []);

	const validate = (next: string): string | null => {
		return validateVaultItemName(next, siblingNames, excludeName);
	};

	const commit = useCallback(async () => {
		const err = validate(value);
		if (err) {
			setError(err);
			return; // blocked — keep the input open
		}
		setSubmitting(true);
		try {
			const result = await onSubmit(value.trim());
			// A returned string is a host-side error (e.g. path collision):
			// surface it and keep the input open. `void`/`undefined` closes it.
			if (typeof result === 'string') {
				setError(result);
			}
		} finally {
			setSubmitting(false);
		}
	}, [value, excludeName, siblingNames, onSubmit]);

	const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
		if (e.key === 'Enter') {
			e.preventDefault();
			void commit();
		} else if (e.key === 'Escape') {
			e.preventDefault();
			onCancel?.();
		}
	};

	return (
		<span className="wg-tree-node-input-wrap">
			<input
				ref={ref}
				className="wg-tree-node-input"
				data-invalid={error ? 'true' : 'false'}
				value={value}
				disabled={submitting}
				onChange={(e) => { setValue(e.target.value); setError(validate(e.target.value)); }}
				onKeyDown={handleKeyDown}
				onBlur={() => { if (!submitting) void commit(); }}
				spellCheck={false}
			/>
			{error ? <span className="wg-tree-node-input-error">{error}</span> : null}
		</span>
	);
}

/** An inline input rendered as its own tree row (used for create). */
function InlineInputRow(
	props: InlineInputProps & { depth: number },
) {
	const { depth, ...input } = props;
	return (
		<li role="treeitem" className="wg-tree-node-input-row">
			<div className="wg-tree-node" style={{ paddingLeft: 8 + depth * 12 }}>
				<span className="wg-tree-node-twisty" data-empty="true" />
				<InlineInput {...input} />
			</div>
		</li>
	);
}
