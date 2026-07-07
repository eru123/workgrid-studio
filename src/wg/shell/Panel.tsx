// Panel (bottom) — terminal/output/problems tab shell. UI only; no terminal or
// output logic. The original panelPart.ts is a DI-coupled PaneCompositePart.

import { useState } from 'react';
import { codiconClass } from './icon.js';
import type { PanelTab } from './types.js';

export interface PanelProps {
	tabs: readonly PanelTab[];
	activeTabId?: string;
	/** Optional header actions (rendered top-right). */
	headerActions?: import('react').ReactNode;
	onTabSelect?: (tabId: string) => void;
}

export function Panel({ tabs, activeTabId, headerActions, onTabSelect }: PanelProps) {
	const [internalActive, setInternalActive] = useState<string | undefined>(activeTabId ?? tabs[0]?.id);
	const activeId = activeTabId ?? internalActive;
	const active = tabs.find((t) => t.id === activeId) ?? tabs[0];

	return (
		<div className="wg-panel">
			<div className="wg-panel-header">
				{tabs.map((tab) => (
					<div
						key={tab.id}
						className="wg-panel-tab"
						data-active={tab.id === activeId}
						role="tab"
						tabIndex={0}
						onClick={() => { setInternalActive(tab.id); onTabSelect?.(tab.id); }}
						onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setInternalActive(tab.id); onTabSelect?.(tab.id); } }}
					>
						{tab.icon && <span className={codiconClass(tab.icon)} />}
						<span>{tab.label}</span>
					</div>
				))}
				<div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center' }}>{headerActions}</div>
			</div>
			<div className="wg-panel-body">
				{active?.render?.()}
			</div>
		</div>
	);
}
