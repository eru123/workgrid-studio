export type { ThemeManifest, ThemeColors, ThemeTokenColor } from "./types";
export { TOKEN_TO_CSS_VAR } from "./tokens";
export { applyTheme, buildCm6ThemeConfig } from "./applyTheme";
export type { Cm6ThemeConfig } from "./applyTheme";

import defaultDarkManifest from "./defaultDark.json";
import defaultLightManifest from "./defaultLight.json";
import type { ThemeManifest } from "./types";

export const DEFAULT_DARK_THEME = defaultDarkManifest as ThemeManifest;
export const DEFAULT_LIGHT_THEME = defaultLightManifest as ThemeManifest;

/** Returns the built-in theme manifest for a given type. */
export function getDefaultTheme(type: "dark" | "light"): ThemeManifest {
  return type === "dark" ? DEFAULT_DARK_THEME : DEFAULT_LIGHT_THEME;
}
