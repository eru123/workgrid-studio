import { useEffect, useRef } from "react";

/**
 * Global shell input guard.
 *
 * - Disables right-click / browser context menu on the workbench.
 * - Intercepts common browser/web shortcuts so the shell behaves more like a
 *   native app. Form controls, Monaco-like editors, and textareas are
 *   explicitly exempted from shortcut blocking.
 */

export interface InputGuardProps {
	/** Disable right-click on the workbench surface. Default: true */
	disableContextMenu?: boolean;
	/** Disable browser/web shortcuts globally. Default: true */
	disableBrowserShortcuts?: boolean;
	/** Allow context menu only inside these CSS selectors. When provided,
		right-click is permitted when the event target matches any selector. */
	allowedContextMenuSelectors?: readonly string[];
}

const EXEMPT_COMPONENTS = ["INPUT", "TEXTAREA"];
const EDITOR_SELECTORS = [
	".monaco-editor",
	".input",
	"react-monaco-editor-container",
	"milkdown",
	".ProseMirror",
	".tiptap",
];

function matchesAnySelector(target: HTMLElement | null, selectors: readonly string[] | undefined): boolean {
		if (!selectors || selectors.length === 0) return false;
		return selectors.some((sel) => target?.closest(sel));
	}

	function isInteractive(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) {
		return false;
	}
	if (EXEMPT_COMPONENTS.includes(target.tagName)) {
		return true;
	}
	if (target.isContentEditable) {
		return true;
	}
	if (target.closest("[contenteditable]")) {
		return true;
	}
	for (const selector of EDITOR_SELECTORS) {
		if (target.closest(selector)) {
			return true;
		}
	}
	return false;
}

function isNavigationalShortcut(e: KeyboardEvent): boolean {
	const mod = e.ctrlKey || e.metaKey;
	const alt = e.altKey;
	const shift = e.shiftKey;
	const key = e.key.toLowerCase();

	// Do not block bare Tab / arrow navigation or text-editing combos
	if (!mod && !alt && key.length === 1) {
		return false;
	}

	switch (key) {
		case "f5":
		case "r":
			return mod && !alt;
		case "n":
			return mod && !alt;
		case "t":
			return mod && !alt;
		case "w":
			return mod && !alt;
		case "l":
			return mod && !alt && !shift;
		case "u":
			return mod && !alt && !shift;
		case "i":
		case "j":
		case "c":
			return mod && shift && !alt;
		case "p":
			return mod && !alt && !shift;
		case "tab":
			return mod && !alt;
		case "arrowleft":
		case "arrowright":
			return alt && !mod;
		default:
			return false;
	}
}

export function InputGuard({
	disableContextMenu = true,
	disableBrowserShortcuts = true,
	allowedContextMenuSelectors,
}: InputGuardProps) {
	const caretakerRef = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		const onContextMenu = (event: MouseEvent) => {
			if (!disableContextMenu) {
				return;
			}
			if (isInteractive(event.target)) {
				return;
			}
			if (matchesAnySelector(event.target as HTMLElement, props.allowedContextMenuSelectors)) {
				return;
			}

			event.preventDefault();
			event.stopPropagation();
		};

		const onKeyDown = (event: KeyboardEvent) => {
			if (!disableBrowserShortcuts) {
				return;
			}
			if (isInteractive(event.target)) {
				return;
			}
			if (isNavigationalShortcut(event)) {
				event.preventDefault();
				event.stopPropagation();
			}
		};

		window.addEventListener("contextmenu", onContextMenu, true);
		window.addEventListener("keydown", onKeyDown, true);

		return () => {
			window.removeEventListener("contextmenu", onContextMenu, true);
			window.removeEventListener("keydown", onKeyDown, true);
		};
	}, [disableContextMenu, disableBrowserShortcuts]);

	return null;
}
