// Minimal, DI-free reimplementation of vs/platform/theme/common/colorUtils.
//
// The original delegates `registerColor` to a singleton `colorRegistry` wired
// into the platform `IRegistry` + a JSON-schema contribution pipeline. That
// pipeline is service-layer machinery the UI library does not ship, so this
// shim keeps the *public API surface* the colors/*.ts files depend on
// (registerColor, transparent, darken, lighten, lessProminent,
// ifDefinedThenElse, oneOf, ColorTransformType, resolveColorValue,
// asCssVariable*) but stores contributions in a local Map and resolves
// ColorValue/ColorTransform against a plain IColorTheme using the already-
// ported Color class from base/common/color. No ServicesAccessor, no
// createDecorator, no IRegistry.

import { assertNever } from '../base/common/assert.js';
import { Color } from '../base/common/color.js';

//  ------ API types

export type ColorIdentifier = string;

export interface ColorContribution {
	readonly id: ColorIdentifier;
	readonly description: string;
	readonly defaults: ColorDefaults | ColorValue | null;
	readonly needsTransparency: boolean;
	readonly deprecationMessage: string | undefined;
}

export interface ColorDefaults {
	light: ColorValue | null;
	dark: ColorValue | null;
	hcDark: ColorValue | null;
	hcLight: ColorValue | null;
}

export function isColorDefaults(value: unknown): value is ColorDefaults {
	return value !== null && typeof value === 'object' && 'light' in value && 'dark' in value;
}

/**
 * A Color Value is either a color literal, a reference to another color, or a
 * derived color (transform).
 */
export type ColorValue = Color | string | ColorIdentifier | ColorTransform;

export const enum ColorTransformType {
	Darken,
	Lighten,
	Transparent,
	Opaque,
	OneOf,
	LessProminent,
	IfDefinedThenElse,
	Mix,
}

export type ColorTransform =
	| { op: ColorTransformType.Darken; value: ColorValue; factor: number }
	| { op: ColorTransformType.Lighten; value: ColorValue; factor: number }
	| { op: ColorTransformType.Transparent; value: ColorValue; factor: number }
	| { op: ColorTransformType.Opaque; value: ColorValue; background: ColorValue }
	| { op: ColorTransformType.OneOf; values: readonly ColorValue[] }
	| { op: ColorTransformType.LessProminent; value: ColorValue; background: ColorValue; factor: number; transparency: number }
	| { op: ColorTransformType.IfDefinedThenElse; if: ColorIdentifier; then: ColorValue; else: ColorValue }
	| { op: ColorTransformType.Mix; color: ColorValue; with: ColorValue; ratio?: number };

//  ------ CSS variable helpers

/**
 * Returns the css variable name for the given color identifier. Dots (`.`) are
 * replaced with hyphens (`-`) and everything is prefixed with `--wg-`.
 *
 * @sample `editorSuggestWidget.background` is `--wg-editorSuggestWidget-background`.
 */
export function asCssVariableName(colorIdent: ColorIdentifier): string {
	return `--wg-${colorIdent.replace(/\./g, '-')}`;
}

export function asCssVariable(color: ColorIdentifier): string {
	return `var(${asCssVariableName(color)})`;
}

export function asCssVariableWithDefault(color: ColorIdentifier, defaultCssValue: string): string {
	return `var(${asCssVariableName(color)}, ${defaultCssValue})`;
}

//  ------ Color transform constructors

export function darken(colorValue: ColorValue, factor: number): ColorTransform {
	return { op: ColorTransformType.Darken, value: colorValue, factor };
}

export function lighten(colorValue: ColorValue, factor: number): ColorTransform {
	return { op: ColorTransformType.Lighten, value: colorValue, factor };
}

export function transparent(colorValue: ColorValue, factor: number): ColorTransform {
	return { op: ColorTransformType.Transparent, value: colorValue, factor };
}

export function oneOf(...colorValues: ColorValue[]): ColorTransform {
	return { op: ColorTransformType.OneOf, values: colorValues };
}

export function ifDefinedThenElse(ifArg: ColorIdentifier, thenArg: ColorValue, elseArg: ColorValue): ColorTransform {
	return { op: ColorTransformType.IfDefinedThenElse, if: ifArg, then: thenArg, else: elseArg };
}

export function lessProminent(colorValue: ColorValue, backgroundColorValue: ColorValue, factor: number, transparency: number): ColorTransform {
	return { op: ColorTransformType.LessProminent, value: colorValue, background: backgroundColorValue, factor, transparency };
}

//  ------ Color registry (local Map, no DI)

export const Extensions = {
	ColorContribution: 'base.contributions.colors'
} as const;

export const DEFAULT_COLOR_CONFIG_VALUE = 'default';

/**
 * The minimal IColorTheme the resolution functions need. The real one in VS
 * Code is a full service-backed object; here it is just a lookup over the
 * currently-applied token map plus a `defines` predicate. `applyTheme` in
 * themeService.ts builds this from the active contribution set.
 */
export interface IColorTheme {
	readonly type: 'light' | 'dark' | 'hc' | 'hcLight';
	getColor(id: ColorIdentifier): Color | undefined;
	defines(id: ColorIdentifier): boolean;
}

class ColorRegistry {
	private readonly _contributions = new Map<ColorIdentifier, ColorContribution>();
	private readonly _onDidChange = new Set<() => void>();

	registerColor(
		id: ColorIdentifier,
		defaults: ColorDefaults | ColorValue | null,
		description: string,
		needsTransparency: boolean = false,
		deprecationMessage: string | undefined = undefined
	): ColorIdentifier {
		const contribution: ColorContribution = { id, description, defaults, needsTransparency, deprecationMessage };
		this._contributions.set(id, contribution);
		for (const cb of this._onDidChange) {
			cb();
		}
		return id;
	}

	getColors(): readonly ColorContribution[] {
		return Array.from(this._contributions.values());
	}

	getDefault(id: ColorIdentifier): ColorDefaults | ColorValue | null {
		return this._contributions.get(id)?.defaults ?? null;
	}

	onDidChangeSchema(cb: () => void): () => void {
		this._onDidChange.add(cb);
		return () => this._onDidChange.delete(cb);
	}
}

export const colorRegistry = new ColorRegistry();

export function registerColor(
	id: string,
	defaults: ColorDefaults | ColorValue | null,
	description: string,
	needsTransparency?: boolean,
	deprecationMessage?: string
): ColorIdentifier {
	return colorRegistry.registerColor(id, defaults, description, needsTransparency, deprecationMessage);
}

//  ------ Resolution

export function resolveColorValue(colorValue: ColorValue | null, theme: IColorTheme): Color | undefined {
	if (colorValue === null) {
		return undefined;
	}
	if (typeof colorValue === 'string') {
		if (colorValue[0] === '#') {
			return Color.fromHex(colorValue);
		}
		return theme.getColor(colorValue);
	}
	if (colorValue instanceof Color) {
		return colorValue;
	}
	if (typeof colorValue === 'object') {
		return executeTransform(colorValue, theme);
	}
	return undefined;
}

export function executeTransform(transform: ColorTransform, theme: IColorTheme): Color | undefined {
	switch (transform.op) {
		case ColorTransformType.Darken:
			return resolveColorValue(transform.value, theme)?.darken(transform.factor);

		case ColorTransformType.Lighten:
			return resolveColorValue(transform.value, theme)?.lighten(transform.factor);

		case ColorTransformType.Transparent:
			return resolveColorValue(transform.value, theme)?.transparent(transform.factor);

		case ColorTransformType.Mix: {
			const primaryColor = resolveColorValue(transform.color, theme) || Color.transparent;
			const otherColor = resolveColorValue(transform.with, theme) || Color.transparent;
			return primaryColor.mix(otherColor, transform.ratio);
		}

		case ColorTransformType.Opaque: {
			const backgroundColor = resolveColorValue(transform.background, theme);
			if (!backgroundColor) {
				return resolveColorValue(transform.value, theme);
			}
			return resolveColorValue(transform.value, theme)?.makeOpaque(backgroundColor);
		}

		case ColorTransformType.OneOf:
			for (const candidate of transform.values) {
				const color = resolveColorValue(candidate, theme);
				if (color) {
					return color;
				}
			}
			return undefined;

		case ColorTransformType.IfDefinedThenElse:
			return resolveColorValue(theme.defines(transform.if) ? transform.then : transform.else, theme);

		case ColorTransformType.LessProminent: {
			const from = resolveColorValue(transform.value, theme);
			if (!from) {
				return undefined;
			}
			const backgroundColor = resolveColorValue(transform.background, theme);
			if (!backgroundColor) {
				return from.transparent(transform.factor * transform.transparency);
			}
			return from.isDarkerThan(backgroundColor)
				? Color.getLighterColor(from, backgroundColor, transform.factor).transparent(transform.transparency)
				: Color.getDarkerColor(from, backgroundColor, transform.factor).transparent(transform.transparency);
		}
		default:
			throw assertNever(transform);
	}
}
