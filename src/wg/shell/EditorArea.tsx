// Editor area — the tab strip + editor body. The original editorPart.ts /
// editorGroupView.ts / editorTabsControl.ts are heavily DI-coupled. This is a
// React equivalent rendering tabs, breadcrumbs, and either a Monaco editor
// (text/diff), or a host-provided custom view. Splits are supported via the
// recursive EditorGroup tree.

import { useMemo } from 'react';
import { DiffEditor } from '@monaco-editor/react';
import { MonacoEditor } from '../editor/MonacoEditor.js';
import { codiconClass } from './icon.js';
import type { BreadcrumbItem, EditorGroup as EditorGroupModel, EditorTab, TabsProps } from './types.js';

export interface EditorAreaProps {
	group: EditorGroupModel;
	onActivateTab?: (groupId: string, tabId: string) => void;
	onCloseTab?: (groupId: string, tabId: string) => void;
}

export function EditorArea(props: EditorAreaProps) {
	return (
		<div className="wg-editor-area">
			<EditorGroupView group={props.group} onActivateTab={props.onActivateTab} onCloseTab={props.onCloseTab} />
		</div>
	);
}

function EditorGroupView({
	group,
	onActivateTab,
	onCloseTab,
}: {
	group: EditorGroupModel;
	onActivateTab?: (groupId: string, tabId: string) => void;
	onCloseTab?: (groupId: string, tabId: string) => void;
}) {
	// Leaf group: render tabs + body.
	if (!group.children || group.children.length === 0) {
		const activeTab = group.tabs.find((t) => t.id === group.activeTabId) ?? group.tabs[0];
		return (
			<div className="wg-editor-group">
				{group.tabs.length > 0 && (
					<Tabs
						tabs={group.tabs}
						activeTabId={activeTab?.id}
						onActivate={(tabId) => onActivateTab?.(group.id, tabId)}
						onClose={(tabId) => onCloseTab?.(group.id, tabId)}
					/>
				)}
				{activeTab && <EditorBody tab={activeTab} />}
			</div>
		);
	}

	// Split group: render children with sash dividers between them.
	const orientation = group.orientation;
	return (
		<div className="wg-editor-split" data-orientation={orientation}>
			{group.children.map((child, i) => (
				<div key={child.id} style={{ flex: group.sizes?.[i] ?? 1, display: 'flex', minWidth: 0, minHeight: 0 }}>
					<EditorGroupView group={child} onActivateTab={onActivateTab} onCloseTab={onCloseTab} />
				</div>
			))}
		</div>
	);
}

export function Tabs({ tabs, activeTabId, onActivate, onClose }: TabsProps & {
	onActivate: (tabId: string) => void;
	onClose: (tabId: string) => void;
}) {
	return (
		<div className="wg-tabs" role="tablist">
			{tabs.map((tab) => (
				<Tab key={tab.id} tab={tab} active={tab.id === activeTabId} onClick={() => onActivate(tab.id)} onClose={() => onClose(tab.id)} />
			))}
		</div>
	);
}

function Tab({ tab, active, onClick, onClose }: { tab: EditorTab; active: boolean; onClick: () => void; onClose: () => void }) {
	return (
		<div
			className="wg-tab"
			data-active={active}
			data-dirty={tab.dirty ?? false}
			data-preview={tab.preview ?? false}
			role="tab"
			tabIndex={0}
			onClick={onClick}
			onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
			onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); onClose(); } }}
		>
			{tab.icon && <span className={`wg-tab-icon ${codiconClass(tab.icon)}`} />}
			<span className="wg-tab-label">{tab.label}</span>
			<span
				className="wg-tab-close"
				title="Close"
				onClick={(e) => { e.stopPropagation(); onClose(); }}
			>
				<span className={codiconClass('close')} />
			</span>
		</div>
	);
}

export function Breadcrumbs({ items, onSelect }: { items: readonly BreadcrumbItem[]; onSelect?: (item: BreadcrumbItem) => void }) {
	return (
		<div className="wg-breadcrumbs" role="navigation" aria-label="Breadcrumbs">
			{items.map((item, i) => (
				<span key={i} style={{ display: 'inline-flex', alignItems: 'center' }}>
					<span className="wg-breadcrumb" title={item.tooltip} onClick={() => onSelect?.(item)}>
						{item.icon && <span className={codiconClass(item.icon)} />}
						<span>{item.label}</span>
					</span>
					{i < items.length - 1 && <span className="wg-breadcrumb-separator">›</span>}
				</span>
			))}
		</div>
	);
}

function EditorBody({ tab }: { tab: EditorTab }) {
	const editor = useMemo(() => {
		if (tab.kind === 'custom' && tab.render) {
			return <div style={{ height: '100%' }}>{tab.render()}</div>;
		}
		if (tab.kind === 'diff') {
			// Diff editor — @monaco-editor/react's DiffEditor takes original +
			// modified. We render it directly (no wrapper mode preset needed).
			return (
				<div style={{ height: '100%' }}>
					<DiffEditor
						height="100%"
						original={tab.original ?? ''}
						modified={tab.value ?? ''}
						language={tab.language}
					/>
				</div>
			);
		}
		return (
			<MonacoEditor
				value={tab.value ?? ''}
				language={tab.language}
				mode="full"
			/>
		);
	}, [tab]);

	return <div className="wg-editor-body">{editor}</div>;
}

// Re-export the group model type for convenience.
export type { EditorGroupModel as EditorGroup };
