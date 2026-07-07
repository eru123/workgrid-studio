// A React tree view. VS Code's tree widgets (vs/base/browser/ui/tree/*) are
// imperative, service-light but DOM-heavy widgets with their own virtualization.
// For the shell's sidebar views this lightweight declarative tree is enough;
// it lazily loads children via the TreeBackend seam. The ported tree widgets
// remain available (base/browser/ui/tree) for hosts that need their
// virtualization/features — import them directly.

import { useCallback, useEffect, useState } from 'react';
import type { TreeBackend, TreeNode } from '../backend/BackendAdapter.js';
import { codiconClass } from './icon.js';

export interface TreeProps {
	backend?: TreeBackend;
	/** If provided, used as the roots instead of calling backend.getRoots(). */
	rootNodes?: readonly TreeNode[];
}

interface NodeState {
	expanded: boolean;
	children: readonly TreeNode[];
	loading: boolean;
}

export function Tree({ backend, rootNodes }: TreeProps) {
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

	const renderNode = (node: TreeNode, depth: number): React.ReactNode => {
		const state = states.get(node.id);
		const expanded = state?.expanded ?? false;
		const children = state?.children ?? [];
		const loading = state?.loading ?? false;
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
					<span className="wg-tree-node-label">{node.label}</span>
					{node.description && <span className="wg-tree-node-description">{node.description}</span>}
					{node.badges?.map((b, i) => (
						<span key={i} className="wg-tree-node-badge" title={b.tooltip}>{b.text}</span>
					))}
				</div>
				{expanded && children.length > 0 && (
					<ul role="group" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
						{children.map((child) => renderNode(child, depth + 1))}
					</ul>
				)}
			</li>
		);
	};

	return (
		<ul className="wg-tree" role="tree" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
			{roots.map((node) => renderNode(node, 0))}
		</ul>
	);
}
