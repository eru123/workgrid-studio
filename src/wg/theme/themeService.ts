// Minimal theming runtime for the extracted UI library.
//
// The original vs/platform/theme/common/themeService is a full DI service
// (IThemeService = createDecorator(...)) that coordinates color themes, file
// icon themes, product icon themes, and emits theme-change events through the
// workbench. None of that service architecture is shipped here.
//
// This module provides the only runtime behavior the UI library needs:
//   - applyTheme(kind) resolves every registered color contribution's defaults
//     for the given theme kind, writes them as CSS variables (--wg-<id>)
//     on :root, and returns the resolved IColorTheme for callers (e.g. widget
//     styles that take plain string colors) to read.
//   - applyTokenMap(tokenMap) lets a host override individual tokens with a
//     custom theme manifest (the legacy Workgrid JSON-manifest approach), in
//     which case resolution is skipped and the literal values are written.

import { Color } from '../base/common/color.js';
import {
	asCssVariableName,
	colorRegistry,
	isColorDefaults,
	resolveColorValue,
	type ColorContribution,
	type ColorDefaults,
	type ColorIdentifier,
	type ColorValue,
	type IColorTheme,
} from './colorUtils.js';

// Re-export the parts of the color API consumers expect from a theme module.
export {
	type ColorIdentifier,
	type ColorValue,
	type ColorDefaults,
	type IColorTheme,
	type ColorContribution,
} from './colorUtils.js';
export { registerColor, resolveColorValue, asCssVariable, asCssVariableName, isColorDefaults } from './colorUtils.js';

export type ThemeKind = 'light' | 'dark' | 'hc' | 'hcLight';

/**
 * Resolved theme: a lookup over the resolved color map plus a `defines`
 * predicate (a token counts as "defined" only if it resolved to a real Color).
 */
export interface ResolvedTheme extends IColorTheme {
	readonly kind: ThemeKind;
	readonly tokens: ReadonlyMap<ColorIdentifier, Color>;
}

function pickDefault(defaults: ColorDefaults | ColorValue | null, kind: ThemeKind): ColorValue | null {
	if (defaults === null || isColorDefaults(defaults)) {
		const d = defaults as ColorDefaults | null;
		if (!d) {
			return null;
		}
		switch (kind) {
			case 'light': return d.light;
			case 'dark': return d.dark;
			case 'hc': return d.hcDark;
			case 'hcLight': return d.hcLight;
		}
	}
	// A bare ColorValue (not a ColorDefaults object) applies to all kinds.
	return defaults as ColorValue;
}

function buildTheme(kind: ThemeKind, overrides?: ReadonlyMap<ColorIdentifier, ColorValue | string>): ResolvedTheme {
	const tokens = new Map<ColorIdentifier, Color>();

	// First resolve every registered contribution's default for this kind.
	const contributions: readonly ColorContribution[] = colorRegistry.getColors();
	const partial: IColorTheme = {
		type: kind,
		getColor: (id) => tokens.get(id),
		defines: (id) => tokens.has(id),
	};
	for (const c of contributions) {
		const raw = overrides?.get(c.id) ?? pickDefault(c.defaults, kind);
		const resolved = resolveColorValue(raw ?? null, partial);
		if (resolved) {
			tokens.set(c.id, resolved);
		}
	}
	// Overrides may reference tokens registered above; re-resolve any string
	// overrides that are themselves ColorIdentifiers now that the map is fuller.
	if (overrides) {
		const fuller: IColorTheme = {
			type: kind,
			getColor: (id) => tokens.get(id),
			defines: (id) => tokens.has(id),
		};
		for (const [id, raw] of overrides) {
			if (typeof raw === 'string' && raw[0] !== '#') {
				const resolved = resolveColorValue(raw, fuller);
				if (resolved) {
					tokens.set(id, resolved);
				}
			} else if (raw instanceof Color) {
				tokens.set(id, raw);
			} else if (typeof raw === 'string') {
				tokens.set(id, Color.fromHex(raw));
			}
		}
	}

	return { type: kind, kind, tokens, getColor: (id) => tokens.get(id), defines: (id) => tokens.has(id) };
}

function writeCssVars(theme: ResolvedTheme): void {
	const root = (typeof document !== 'undefined' ? document.documentElement : null) as HTMLElement | null;
	if (!root) {
		return;
	}
	for (const [id, color] of theme.tokens) {
		root.style.setProperty(asCssVariableName(id), color.toString());
	}
}

/**
 * Apply a theme by kind. Resolves all registered color contributions' defaults
 * for the given kind, writes them as `--wg-<id>` CSS variables on
 * `:root`, and returns the resolved theme (so callers reading plain-string
 * colors can do so).
 *
 * Pass `overrides` to override individual tokens with literal hex strings,
 * `Color` instances, or ColorIdentifier references (for custom theme
 * manifests).
 */
export function applyTheme(
	kind: ThemeKind,
	overrides?: ReadonlyMap<ColorIdentifier, ColorValue | string>
): ResolvedTheme {
	const theme = buildTheme(kind, overrides);
	writeCssVars(theme);
	return theme;
}

/**
 * Apply a raw token map directly, skipping default resolution. Use this when
 * the host already has a fully-resolved color map (e.g. loading a VS Code
 * color theme JSON and resolving it itself). Each value is written verbatim as
 * a CSS variable.
 */
export function applyTokenMap(kind: ThemeKind, tokenMap: ReadonlyMap<ColorIdentifier, string>): ResolvedTheme {
	const root = (typeof document !== 'undefined' ? document.documentElement : null) as HTMLElement | null;
	const tokens = new Map<ColorIdentifier, Color>();
	for (const [id, value] of tokenMap) {
		if (root) {
			root.style.setProperty(asCssVariableName(id), value);
		}
		const color = value[0] === '#' ? Color.fromHex(value) : undefined;
		if (color) {
			tokens.set(id, color);
		}
	}
	return {
		type: kind,
		kind,
		tokens,
		getColor: (id) => tokens.get(id),
		defines: (id) => tokens.has(id),
	};
}

/**
 * Read the currently-applied theme kind from the `data-theme` attribute on the
 * document root, falling back to `'dark'`. (Host sets `data-theme` when
 * `applyTheme` is called if it wants this to round-trip.)
 */
export function getCurrentThemeKind(): ThemeKind {
	const attr = (typeof document !== 'undefined' ? document.documentElement.getAttribute('data-theme') : null) as ThemeKind | null;
	return attr ?? 'dark';
}
