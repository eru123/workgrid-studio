// Activity bar — the icon strip. Uses codicon glyphs (the ported codicon font)
// for icons. The original activitybarPart.ts is a DI-coupled Part; this is the
// React equivalent taking plain view-model props.

import { codiconClass } from './icon.js';
import type { ActivityBarItem } from './types.js';

export interface ActivityBarProps {
	items: readonly ActivityBarItem[];
	activeViewContainerId?: string;
	actions?: readonly ActivityBarItem[];
	onSelect?: (item: ActivityBarItem) => void;
}

export function ActivityBar({ items, activeViewContainerId, actions, onSelect }: ActivityBarProps) {
	return (
		<div className="wg-activitybar" role="navigation" aria-label="Activity Bar">
			<div className="wg-activitybar-items">
				{items.map((item) => (
					<ActivityItem
						key={item.id}
						item={item}
						active={item.viewContainerId === activeViewContainerId}
						onClick={() => onSelect?.(item)}
					/>
				))}
			</div>
			{actions && actions.length > 0 && (
				<div className="wg-activitybar-actions">
					{actions.map((item) => (
						<ActivityItem
							key={item.id}
							item={item}
							active={false}
							onClick={() => onSelect?.(item)}
						/>
					))}
				</div>
			)}
		</div>
	);
}

function ActivityItem({ item, active, onClick }: { item: ActivityBarItem; active: boolean; onClick: () => void }) {
	return (
		<div
			className="wg-activity-item"
			data-active={active}
			title={item.title}
			role="button"
			tabIndex={0}
			onClick={onClick}
			onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
		>
			<span className={codiconClass(item.icon)} />
			{item.badge && (
				<span className="wg-badge" data-kind={item.badge.kind ?? 'default'}>
					{item.badge.text || '•'}
				</span>
			)}
		</div>
	);
}
