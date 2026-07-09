// A React tree view. VS Code's tree widgets (vs/base/browser/ui/tree/*) are
// imperative, service-light but DOM-heavy widgets with their own virtualization.
// For the shell's sidebar views this lightweight declarative tree is enough;
// it lazily loads children via the TreeBackend seam. The ported tree widgets
// remain available (base/browser/ui/tree) for hosts that need their
// virtualization/features — import them directly.
//
// Inline create/rename editing (VS Code explorer style) is opt-in via the
// `editing` / `onCommitCreate` / `onCommitRename` / `onCancelEdit` props. When
// `editing` is omitted the tree renders read-only, exactly as before.

import { useCallback, useEffect, useRef, useState } from 'react';
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
	/** Commit a create (inline input submitted). Resolve type from the name. */
	onCommitCreate?: (name: string, parentId: string | null) => Promise<void> | void;
	/** Commit a rename (inline input submitted). */
	onCommitRename?: (nodeId: string, newName: string) => Promise<void> | void;
	/** Cancel the active edit (Escape). */
	onCancelEdit?: () => void;
}

/** Describes an inline edit session in the tree. */
export interface TreeEditingState {
	mode: 'create' | 'rename';
	/** For rename: the node being renamed. For create: undefined. */
	nodeId?: string;
	/** Parent under which the item is created. `null` = vault root. */
	parentId: string | null;
	/** Initial input value (e.g. '' for a new folder, '.store' for a new entry). */
	initialValue?: string;
}

interface NodeState {
	expanded: boolean;
	children: readonly TreeNode[];
	loading: boolean;
}

export function Tree({ backend, rootNodes, editing, collapseAllKey, onCommitCreate, onCommitRename, onCancelEdit }: TreeProps) {
	const [roots, setRoots] = useState<readonly TreeNode[]>(rootNodes ?? []);
	const [states, setStates] = useState<Map<string, NodeState>>(new Map());
	const [activeId, setActiveId] = useState<string | undefined>();

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
		Promise.resolve(backend.getRoots()).then((r) => { if (!cancelled) setRoots(r); });
		return () => { cancelled = true; };
	}, [backend, rootNodes]);

	const toggle = useCallback((node: TreeNode) => {
		if (!node.collapsible) {
			return;
		}
		setStates((prev) => {
			const next = new Map(prev);
			const cur = next.get(node.id) ?? { expanded: false, children: [], loading: false };
			const willExpand = !cur.expanded;
			next.set(node.id, { ...cur, expanded: willExpand });
			if (willExpand && cur.children.length === 0 && backend) {
				next.set(node.id, { ...cur, expanded: true, loading: true });
				Promise.resolve(backend.getChildren(node)).then((children) => {
					setStates((p) => {
						const n = new Map(p);
						const existing = n.get(node.id)!;
						n.set(node.id, { ...existing, children, loading: false });
						return n;
					});
				});
			}
			return next;
		});
	}, [backend]);

	const handleActivate = useCallback((node: TreeNode) => {
		setActiveId(node.id);
		backend?.onActivate?.(node);
	}, [backend]);

	// Auto-expand + lazy-load the parent of an inline create so the input row
	// is visible. Runs when `editing` starts targeting a non-root parent.
	useEffect(() => {
		if (!editing || editing.mode !== 'create' || editing.parentId === null) {
			return;
		}
		const parentId = editing.parentId;
		setStates((prev) => {
			const cur = prev.get(parentId);
			if (!cur || cur.expanded) {
				return prev; // already expanded (or unknown — nothing to do here)
			}
			const next = new Map(prev);
			next.set(parentId, { ...cur, expanded: true, loading: cur.children.length === 0 });
			if (cur.children.length === 0 && backend) {
				const parent = roots.find((r) => r.id === parentId);
				if (parent) {
					Promise.resolve(backend.getChildren(parent)).then((children) => {
						setStates((p) => {
							const n = new Map(p);
							const existing = n.get(parentId)!;
							n.set(parentId, { ...existing, children, loading: false });
							return n;
						});
					});
				}
			}
			return next;
		});
	}, [editing, backend, roots]);

	// Collapse every expanded node when `collapseAllKey` changes. The key is
	// only a trigger — its value is meaningless; a change clears all expansion
	// state (children are dropped so a re-expand lazy-loads them again).
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

	const renderNode = (node: TreeNode, depth: number): React.ReactNode => {
		const state = states.get(node.id);
		const expanded = state?.expanded ?? false;
		const children = state?.children ?? [];
		const loading = state?.loading ?? false;
		const isRenaming = editing?.mode === 'rename' && editing.nodeId === node.id;
		return (
			<li key={node.id} role="treeitem" aria-expanded={node.collapsible ? expanded : undefined}>
				<div
					className="wg-tree-node"
					data-active={activeId === node.id}
					style={{ paddingLeft: 8 + depth * 12 }}
					onClick={() => { if (node.collapsible) toggle(node); handleActivate(node); }}
					onContextMenu={(e) => { e.preventDefault(); backend?.onContextMenu?.(node, { x: e.clientX, y: e.clientY }); }}
					title={node.tooltip}
				>
					<span className="wg-tree-node-twisty" data-empty={!node.collapsible}>
						{node.collapsible && (loading ? <span className={codiconClass('loading')} /> : <span className={codiconClass(expanded ? 'chevron-down' : 'chevron-right')} />)}
					</span>
					{node.icon && <span className={`wg-tree-node-icon ${codiconClass(node.icon)}`} />}
					{isRenaming ? (
						<InlineInput
							initialValue={editing!.initialValue ?? node.label}
							siblingNames={siblingNamesFor(node.data?.parentId ?? null, node.id)}
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
								onSubmit={(name) => onCommitCreate?.(name, node.id)}
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
		<ul className="wg-tree" role="tree" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
			{editing && editing.mode === 'create' && editing.parentId === null ? (
				<InlineInputRow
					depth={0}
					initialValue={editing.initialValue ?? ''}
					siblingNames={siblingNamesFor(null)}
					onSubmit={(name) => onCommitCreate?.(name, null)}
					onCancel={onCancelEdit}
				/>
			) : null}
			{roots.map((node) => renderNode(node, 0))}
		</ul>
	);
}

// ---------------------------------------------------------------------------
// Inline input (create + rename share this control)
// ---------------------------------------------------------------------------

interface InlineInputProps {
	initialValue: string;
	siblingNames: ReadonlySet<string>;
	/** For rename: the node's own current name (skipped during collision check). */
	excludeName?: string;
	onSubmit: (name: string) => Promise<void> | void;
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
			await onSubmit(value.trim());
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
