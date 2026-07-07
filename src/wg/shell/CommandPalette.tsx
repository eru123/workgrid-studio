// Command palette / quick input — the modal overlay + filtered list. The
// original quickInputService.ts is DI-coupled and backed by a command registry.
// This is the visual component only: items are passed as props, filtering is
// client-side substring match, no command registry is involved.

import { useEffect, useMemo, useRef, useState } from 'react';
import { codiconClass } from './icon.js';
import type { CommandPaletteItem } from './types.js';

export interface CommandPaletteProps {
	open: boolean;
	items: readonly CommandPaletteItem[];
	placeholder?: string;
	onClose?: () => void;
	onSelect?: (item: CommandPaletteItem) => void;
}

export function CommandPalette({ open, items, placeholder, onClose, onSelect }: CommandPaletteProps) {
	const [query, setQuery] = useState('');
	const [activeIndex, setActiveIndex] = useState(0);
	const inputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		if (open) {
			setQuery('');
			setActiveIndex(0);
			// focus on next tick so the input is mounted
			requestAnimationFrame(() => inputRef.current?.focus());
		}
	}, [open]);

	const filtered = useMemo(() => {
		if (!query) {
			return items;
		}
		const q = query.toLowerCase();
		return items.filter((item) =>
			item.label.toLowerCase().includes(q) ||
			(item.category?.toLowerCase().includes(q) ?? false)
		);
	}, [items, query]);

	useEffect(() => { setActiveIndex(0); }, [query]);

	if (!open) {
		return null;
	}

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === 'Escape') {
			e.preventDefault();
			onClose?.();
		} else if (e.key === 'ArrowDown') {
			e.preventDefault();
			setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			setActiveIndex((i) => Math.max(i - 1, 0));
		} else if (e.key === 'Enter') {
			e.preventDefault();
			const item = filtered[activeIndex];
			if (item) { onSelect?.(item); onClose?.(); }
		}
	};

	return (
		<div className="wg-quickpick-overlay" onClick={onClose}>
			<div className="wg-quickpick" onClick={(e) => e.stopPropagation()}>
				<input
					ref={inputRef}
					className="wg-quickpick-input"
					placeholder={placeholder ?? 'Type to search...'}
					value={query}
					onChange={(e) => setQuery(e.target.value)}
					onKeyDown={handleKeyDown}
					role="combobox"
					aria-expanded="true"
					aria-controls="wg-quickpick-list"
				/>
				<div className="wg-quickpick-list" id="wg-quickpick-list" role="listbox">
					{filtered.map((item, i) => (
						<div
							key={item.id}
							className="wg-quickpick-row"
							data-active={i === activeIndex}
							role="option"
							aria-selected={i === activeIndex}
							onClick={() => { onSelect?.(item); onClose?.(); }}
							onMouseEnter={() => setActiveIndex(i)}
						>
							{item.icon && <span className={`wg-quickpick-row-icon ${codiconClass(item.icon)}`} />}
							<span className="wg-quickpick-row-label">
								{item.category ? <><span style={{ opacity: 0.7 }}>{item.category}: </span>{item.label}</> : item.label}
							</span>
							{item.detail && <span className="wg-quickpick-row-detail">{item.detail}</span>}
							{item.keybinding && <span className="wg-quickpick-row-keybinding">{item.keybinding}</span>}
						</div>
					))}
					{filtered.length === 0 && (
						<div className="wg-quickpick-row" style={{ opacity: 0.6, cursor: 'default' }}>No matching commands</div>
					)}
				</div>
			</div>
		</div>
	);
}
