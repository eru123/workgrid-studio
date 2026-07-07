// Theme barrel for the WorkGrid UI library.
//
// Importing this module:
//   1. registers every color token (side-effect of `./colors.js`),
//   2. imports the codicon font + CSS (side-effect of the base styles entry),
//   3. re-exports the theming runtime (`applyTheme`, `registerColor`, ...) and
//      the resolved-theme types.

import './colors.js';

// Codicon font + glyph CSS. Importing here ensures the font-face is registered
// whenever the theme module is pulled in. (The base styles entry is the single
// source of truth for the codicon CSS.)
import '../base/browser/ui/codicons/codiconStyles.js';

export {
	registerColor,
	resolveColorValue,
	asCssVariable,
	asCssVariableName,
	asCssVariableWithDefault,
	isColorDefaults,
	type ColorIdentifier,
	type ColorValue,
	type ColorDefaults,
	type ColorContribution,
	type IColorTheme,
} from './colorUtils.js';

export {
	applyTheme,
	applyTokenMap,
	getCurrentThemeKind,
	type ThemeKind,
	type ResolvedTheme,
} from './themeService.js';

export * from './colors.js';
