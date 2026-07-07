// Tooltip / hover — shared overlay primitive. The original hoverService.ts is
// DI-coupled (IHoverService). This is a minimal controlled tooltip: the host
// tracks hover state and passes content + position.

import type { ReactNode } from 'react';

export interface TooltipProps {
	/** Anchor position in viewport coordinates. */
	anchor: { x: number; y: number };
	content: ReactNode;
	/** Preferred placement relative to the anchor. */
	placement?: 'top' | 'bottom' | 'left' | 'right';
}

export function Tooltip({ anchor, content, placement = 'bottom' }: TooltipProps) {
	const offset = 6;
	const style: React.CSSProperties = { position: 'fixed' };
	switch (placement) {
		case 'top': style.left = anchor.x; style.top = anchor.y - offset; style.transform = 'translate(-50%, -100%)'; break;
		case 'bottom': style.left = anchor.x; style.top = anchor.y + offset; style.transform = 'translateX(-50%)'; break;
		case 'left': style.left = anchor.x - offset; style.top = anchor.y; style.transform = 'translate(-100%, -50%)'; break;
		case 'right': style.left = anchor.x + offset; style.top = anchor.y; style.transform = 'translateY(-50%)'; break;
	}
	return (
		<div className="wg-tooltip" role="tooltip" style={style}>
			{content}
		</div>
	);
}
