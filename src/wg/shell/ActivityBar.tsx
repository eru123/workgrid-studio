// Activity bar — the icon strip. Uses codicon glyphs (the ported codicon font)
// for icons. The original activitybarPart.ts is a DI-coupled Part; this is the
// React equivalent taking plain view-model props.

import { codiconClass } from './icon.js';
import type { ActivityBarItem } from './types.js';

export interface ActivityBarProps {
	items: readonly ActivityBarItem[];
	activeViewContainerId?: string;
	onSelect?: (item: ActivityBarItem) => void;
}

export function ActivityBar({ items, activeViewContainerId, onSelect }: ActivityBarProps) {
	const top = items.filter((item) => item.group !== 'sessions' && item.group !== 'bottom');
	const sessions = items.filter((item) => item.group === 'sessions');
	const bottom = items.filter((item) => item.group === 'bottom');

	return (
		<div className="wg-activitybar" role="navigation" aria-label="Activity Bar">
			<div className="wg-activitybar-top">
				{top.map((item) => (
					<ActivityItem
						key={item.id}
						item={item}
						active={item.viewContainerId === activeViewContainerId}
						onClick={() => onSelect?.(item)}
					/>
				))}
			</div>
			{sessions.length > 0 && <div className="wg-activitybar-divider" />}
			<div className="wg-activitybar-sessions">
				{sessions.map((item) => (
					<ActivityItem
						key={item.id}
						item={item}
						active={item.viewContainerId === activeViewContainerId}
						onClick={() => onSelect?.(item)}
					/>
				))}
			</div>
			{bottom.length > 0 && <div className="wg-activitybar-divider" />}
			<div className="wg-activitybar-bottom">
				{bottom.map((item) => (
					<ActivityItem
						key={item.id}
						item={item}
						active={false}
						onClick={() => onSelect?.(item)}
					/>
				))}
			</div>
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
