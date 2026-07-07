// View pane + view pane container. The original viewPane.ts /
// viewPaneContainer.ts are DI-coupled workbench parts; these are the React
// equivalents rendering collapsible sections with optional tree bodies.

import { useState, type ReactNode } from 'react';
import { codiconClass } from './icon.js';
import { Tree } from './Tree.js';
import type { ViewPaneDescriptor, ViewPaneContainerDescriptor } from './types.js';

export interface ViewPaneProps {
	pane: ViewPaneDescriptor;
	defaultCollapsed?: boolean;
}

export function ViewPane({ pane, defaultCollapsed }: ViewPaneProps) {
	const [collapsed, setCollapsed] = useState(defaultCollapsed ?? pane.initiallyCollapsed ?? false);
	return (
		<div className="wg-viewpane" data-collapsed={collapsed}>
			<div className="wg-viewpane-header" onClick={() => setCollapsed((c) => !c)}>
				<span className={`wg-twisty ${codiconClass(collapsed ? 'chevron-right' : 'chevron-down')}`} />
				<span>{pane.title}</span>
			</div>
			<div className="wg-viewpane-body">
				{pane.render ? pane.render() : pane.tree ? <Tree backend={pane.tree} /> : null}
			</div>
		</div>
	);
}

export interface ViewPaneContainerProps {
	container: ViewPaneContainerDescriptor;
}

export function ViewPaneContainer({ container }: ViewPaneContainerProps) {
	return (
		<div className="wg-viewpane-container" role="group" aria-label={container.title}>
			{container.panes.map((pane, i) => (
				<ViewPane key={pane.id} pane={pane} defaultCollapsed={i > 0 && (pane.initiallyCollapsed ?? false)} />
			))}
		</div>
	);
}

/** Render arbitrary React children as a pane body (for host custom panes). */
export function PaneBody({ children }: { children: ReactNode }) {
	return <div className="wg-viewpane-body">{children}</div>;
}
