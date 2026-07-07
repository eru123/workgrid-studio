// A lightweight React sash (resizable divider). VS Code's sash widget
// (vs/base/browser/ui/sash) is an imperative DOM widget; this is a small
// declarative equivalent for the shell grid. It uses pointer capture + rAF
// throttling like the original, but renders as a flex item the React layout
// controls.

import { useCallback, useEffect, useRef, useState } from 'react';

export interface SashProps {
	orientation: 'vertical' | 'horizontal';
	/** Called with the delta in px (positive = grow right/down) as the user drags. */
	onResize: (delta: number) => void;
}

export function Sash({ orientation, onResize }: SashProps) {
	const [active, setActive] = useState(false);
	const startRef = useRef<{ pos: number; size: number } | null>(null);

	const onPointerDown = useCallback((e: React.PointerEvent) => {
		e.preventDefault();
		e.stopPropagation();
		(e.target as HTMLElement).setPointerCapture(e.pointerId);
		const start = orientation === 'vertical' ? e.clientX : e.clientY;
		startRef.current = { pos: start, size: 0 };
		setActive(true);
	}, [orientation]);

	const onPointerMove = useCallback((e: React.PointerEvent) => {
		if (!startRef.current) {
			return;
		}
		const current = orientation === 'vertical' ? e.clientX : e.clientY;
		const delta = current - startRef.current.pos;
		startRef.current = { pos: current, size: delta };
		onResize(delta);
	}, [orientation, onResize]);

	const onPointerUp = useCallback((e: React.PointerEvent) => {
		if (startRef.current) {
			(e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
		}
		startRef.current = null;
		setActive(false);
	}, []);

	useEffect(() => {
		// Defensive: clear active if the pointer leaves while not captured.
		return () => setActive(false);
	}, []);

	return (
		<div
			className="wg-sash"
			data-orientation={orientation}
			data-active={active}
			onPointerDown={onPointerDown}
			onPointerMove={onPointerMove}
			onPointerUp={onPointerUp}
			onPointerCancel={onPointerUp}
		/>
	);
}
