// Context menu — overlay primitive. The original contextMenuService.ts is
// DI-coupled (backed by IContextMenuService + IMenuService for action
// contributions). This is the rendering layer: items are passed as props,
// including separators, checkboxes, and submenus. No action registry.

import { useEffect, useRef, useState } from 'react';
import { codiconClass } from './icon.js';
import type { ContextMenuItem } from './types.js';

export interface ContextMenuProps {
	/** Anchor position in viewport coordinates. */
	anchor: { x: number; y: number };
	items: readonly ContextMenuItem[];
	onClose?: () => void;
	onSelect?: (item: ContextMenuItem) => void;
}

export function ContextMenu({ anchor, items, onClose, onSelect }: ContextMenuProps) {
	const ref = useRef<HTMLDivElement>(null);
	const [submenuOpen, setSubmenuOpen] = useState<string | null>(null);

	useEffect(() => {
		const onDown = (e: MouseEvent) => {
			if (ref.current && !ref.current.contains(e.target as Node)) {
				onClose?.();
			}
		};
		const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { onClose?.(); } };
		window.addEventListener('pointerdown', onDown, true);
		window.addEventListener('keydown', onKey);
		return () => {
			window.removeEventListener('pointerdown', onDown, true);
			window.removeEventListener('keydown', onKey);
		};
	}, [onClose]);

	// Clamp to viewport so the menu doesn't overflow.
	const style = {
		left: Math.min(anchor.x, (typeof window !== 'undefined' ? window.innerWidth : 9999) - 220),
		top: Math.min(anchor.y, (typeof window !== 'undefined' ? window.innerHeight : 9999) - items.length * 26 - 16),
	};

	return (
		<div className="wg-contextmenu" ref={ref} style={style} role="menu">
			{items.map((item, i) => {
				if (item.kind === 'separator') {
					return <div key={i} className="wg-contextmenu-separator" role="separator" />;
				}
				const hasSubmenu = item.submenu && item.submenu.length > 0;
				return (
					<div
						key={i}
						className="wg-contextmenu-item"
						data-disabled={item.disabled ?? false}
						role="menuitem"
						aria-disabled={item.disabled ?? false}
						onMouseEnter={() => setSubmenuOpen(hasSubmenu ? item.id : null)}
						onClick={() => {
							if (item.disabled) { return; }
							if (hasSubmenu) { return; }
							onSelect?.(item);
							onClose?.();
						}}
					>
						{item.kind === 'checkbox' || item.kind === 'radio' ? (
							<span className={`wg-contextmenu-item-check ${codiconClass('check')}`} style={{ visibility: item.checked ? 'visible' : 'hidden' }} />
						) : (
							<span className={`wg-contextmenu-item-icon ${item.icon ? codiconClass(item.icon) : ''}`} />
						)}
						<span className="wg-contextmenu-item-label">{item.label}</span>
						{item.accelerator && <span className="wg-contextmenu-item-accelerator">{item.accelerator}</span>}
						{hasSubmenu && <span className={`wg-contextmenu-item-submenu-indicator ${codiconClass('chevron-right')}`} />}
						{hasSubmenu && submenuOpen === item.id && (
							<div style={{ position: 'absolute', left: '100%', top: 0 }}>
								<ContextMenu
									anchor={{ x: 0, y: 0 }}
									items={item.submenu!}
									onClose={onClose}
									onSelect={onSelect}
								/>
							</div>
						)}
					</div>
				);
			})}
		</div>
	);
}
