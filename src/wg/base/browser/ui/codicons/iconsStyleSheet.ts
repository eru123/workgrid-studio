// Runtime codicon glyph stylesheet.
//
// codicon.css ships only @font-face + the base `.codicon` rule. The per-glyph
// rules (`.codicon-<id>::before { content: '\xxxx' }`) are generated from the
// icon registry, mirroring VS Code's iconsStyleSheet.ts. Without them every
// `codicon-<name>` span renders empty even though the font loads.

import { getCodiconFontCharacters } from '../../../common/codiconsUtil.js';

// Importing the library runs the `register(...)` calls that populate the
// font-character map as a side effect. Kept explicit so this module is
// self-contained regardless of import order.
import '../../../common/codiconsLibrary.js';

let injected = false;

/**
 * Inject a `<style>` with `.codicon-<id>::before { content: '\xxxx' }` rules
 * for every registered codicon. Idempotent; injects at most once.
 */
export function ensureCodiconIconsStyleSheet(): void {
	if (injected || typeof document === 'undefined') {
		return;
	}
	injected = true;

	const chars = getCodiconFontCharacters();
	let css = '';
	for (const id in chars) {
		const hex = chars[id].toString(16);
		css += `.codicon-${id}::before{content:'\\${hex}'}`;
	}

	const style = document.createElement('style');
	style.className = 'codicon-icons-stylesheet';
	style.textContent = css;
	document.head.appendChild(style);
}

ensureCodiconIconsStyleSheet();
