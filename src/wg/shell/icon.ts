// Shared icon resolution for shell parts. Icons are codicon ids (kebab-case,
// e.g. 'files', 'source-control', 'symbol-method'); the codicon font + CSS
// live in the ported base (base/browser/ui/codicons).

import { Codicon } from '../base/common/codicons.js';
import { ThemeIcon } from '../base/common/themables.js';

const VALID_CODICON_IDS = new Set<string>(
	Object.values(Codicon).map((icon: ThemeIcon) => icon.id)
);

/**
 * Resolve a free-form icon id to a codicon class name (e.g. 'codicon-files').
 * Falls back to 'codicon-symbol-misc' for unknown/empty ids.
 */
export function codiconClass(icon?: string): string {
	if (!icon) {
		return 'codicon-symbol-misc';
	}
	const name = icon.replace(/^codicon-/, '').replace(/^\/?[^/]+\//, '');
	return `codicon-${VALID_CODICON_IDS.has(name) ? name : (name || 'symbol-misc')}`;
}
