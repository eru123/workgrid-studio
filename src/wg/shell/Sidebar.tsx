// Sidebar — shows the active view container's panes. The original sidebarPart
// is a thin PaneCompositePart (DI-coupled); this is the React equivalent.

import { ViewPaneContainer } from './ViewPane.js';
import type { ViewPaneContainerDescriptor } from './types.js';

export interface SidebarProps {
	container?: ViewPaneContainerDescriptor;
	/** Optional header actions (rendered top-right of the sidebar header). */
	headerActions?: import('react').ReactNode;
}

export function Sidebar({ container, headerActions }: SidebarProps) {
	return (
		<div className="wg-sidebar">
			<div className="wg-sidebar-header">
				<span>{container?.title ?? ''}</span>
				<div className="wg-sidebar-actions">{headerActions}</div>
			</div>
			{container ? (
				<ViewPaneContainer container={container} />
			) : (
				<div style={{ padding: '12px', color: 'var(--wg-descriptionForeground)', fontSize: 12 }}>
					Select a view from the activity bar.
				</div>
			)}
		</div>
	);
}
