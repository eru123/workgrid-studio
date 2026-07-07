// Title bar — top of the workbench. The original titlebarPart.ts is
// DI-coupled (ITitleService + IMenuService for the menubar). This is a minimal
// title bar: optional menubar items + centered title. Menu dropdowns are
// rendered via the ContextMenu primitive on click.

import { useState } from 'react';
import { ContextMenu } from './ContextMenu.js';
import type { ContextMenuItem } from './types.js';

export interface TitleBarMenuItem {
	readonly label: string;
	readonly submenu: readonly ContextMenuItem[];
}

export interface TitleBarProps {
	title?: string;
	menubar?: readonly TitleBarMenuItem[];
	onMenuSelect?: (item: ContextMenuItem) => void;
}

export function TitleBar({ title, menubar, onMenuSelect }: TitleBarProps) {
	const [openMenu, setOpenMenu] = useState<number | null>(null);
	const [anchor, setAnchor] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

	const openAt = (i: number, e: React.MouseEvent) => {
		const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
		setAnchor({ x: rect.left, y: rect.bottom });
		setOpenMenu(i);
	};

	return (
		<div className="wg-titlebar">
			{menubar && menubar.length > 0 && (
				<div className="wg-titlebar-menubar">
					{menubar.map((item, i) => (
						<div
							key={i}
							className="wg-titlebar-menubar-item"
							onClick={(e) => openMenu === i ? setOpenMenu(null) : openAt(i, e)}
							onMouseEnter={(e) => { if (openMenu !== null && openMenu !== i) { openAt(i, e); } }}
						>
							{item.label}
							{openMenu === i && (
								<ContextMenu
									anchor={anchor}
									items={item.submenu}
									onClose={() => setOpenMenu(null)}
									onSelect={onMenuSelect}
								/>
							)}
						</div>
					))}
				</div>
			)}
			<div className="wg-titlebar-title">{title}</div>
		</div>
	);
}
