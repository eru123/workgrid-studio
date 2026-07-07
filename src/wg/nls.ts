// NLS stub for the extracted UI library.
//
// The original VS Code `vs/nls` module wires up the full localization pipeline
// (message bundles, language packs, pseudo-localization). The UI library does
// not ship any of that — it is presentation only — so we provide a passthrough
// `localize` that returns the source message with `{n}` placeholders filled in.
// Every ported base widget that touches `nls` uses only `localize` (verified:
// no `localize2` / `localizeFunc` usage in `vs/base/browser/ui/**`).

export interface ILocalizeInfo {
	key: string;
	comment: string[];
}

export interface ILocalizedString {
	original: string;
	value: string;
}

function format(message: string, args: Array<string | number | boolean | undefined | null>): string {
	if (args.length === 0) {
		return message;
	}
	return message.replace(/\{(\d+)\}/g, (_match, rest: string) => {
		const index = Number(rest[0]);
		const arg = args[index];
		if (typeof arg === 'string') {
			return arg;
		}
		if (typeof arg === 'number' || typeof arg === 'boolean' || arg === undefined || arg === null) {
			return String(arg);
		}
		return `{${index}}`;
	});
}

/**
 * Passthrough localize. Ignores the NLS key/comment info and just formats the
 * source message. Matches the VS Code call signatures:
 *   localize('key', 'message')
 *   localize('key', 'message {0} {1}', a, b)
 *   localize({ key, comment }, 'message')
 */
export function localize(
	data: ILocalizeInfo | string,
	message: string,
	...args: Array<string | number | boolean | undefined | null>
): string {
	return format(message, args);
}

/**
 * Returns a localized+original string pair. Same passthrough behavior.
 */
export function localize2(
	data: ILocalizeInfo | string,
	original: string,
	message: string,
	...args: Array<string | number | boolean | undefined | null>
): ILocalizedString {
	return { original, value: format(message, args) };
}

/** No-op; the original returns the configured NLS messages array. */
export function getNLSMessages(): string[] | undefined {
	return undefined;
}

/** No-op; the original returns the configured NLS language. */
export function getNLSLanguage(): string | undefined {
	return undefined;
}
