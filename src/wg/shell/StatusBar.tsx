// Status bar — item rendering with hover/click. The original statusbarPart.ts
// is DI-coupled; this is the React equivalent. Items are sorted by priority
// within each alignment (higher priority = further from the edge).

import { codiconClass } from './icon.js';
import type { StatusBarItem } from './types.js';

export interface StatusBarProps {
	items: readonly StatusBarItem[];
	onClick?: (item: StatusBarItem) => void;
}

export function StatusBar({ items, onClick }: StatusBarProps) {
	const left = items.filter((i) => i.alignment === 'left').sort((a, b) => b.priority - a.priority);
	const right = items.filter((i) => i.alignment === 'right').sort((a, b) => a.priority - b.priority);
	return (
		<div className="wg-statusbar" role="status" aria-label="Status Bar">
			<div className="wg-statusbar-left">
				{left.map((item) => <StatusItem key={item.id} item={item} onClick={onClick} />)}
			</div>
			<div className="wg-statusbar-right">
				{right.map((item) => <StatusItem key={item.id} item={item} onClick={onClick} />)}
			</div>
		</div>
	);
}

function StatusItem({ item, onClick }: { item: StatusBarItem; onClick?: (item: StatusBarItem) => void }) {
	return (
		<div
			className="wg-statusbar-item"
			data-kind={item.kind ?? 'default'}
			title={item.tooltip}
			role="button"
			tabIndex={0}
			onClick={() => onClick?.(item)}
			onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick?.(item); } }}
		>
			{item.icon && <span className={codiconClass(item.icon)} />}
			<span>{item.text}</span>
		</div>
	);
}
