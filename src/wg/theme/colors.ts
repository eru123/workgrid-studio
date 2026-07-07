// Color token definitions, adapted from VS Code's
// vs/platform/theme/common/colors/*.ts (MIT). Importing this module runs every
// `registerColor` call, populating the color registry with the full token set
// so `applyTheme` can resolve defaults for each kind.

import './colors/baseColors.js';
import './colors/editorColors.js';
import './colors/inputColors.js';
import './colors/listColors.js';
import './colors/menuColors.js';
import './colors/quickpickColors.js';
import './colors/searchColors.js';
import './colors/miscColors.js';
import './colors/chartsColors.js';
import './colors/minimapColors.js';

// Re-export the most commonly-referenced tokens so consumers can import them
// directly (e.g. `import { foreground } from '@/wg/theme/colors'`).
export * from './colors/baseColors.js';
export * from './colors/editorColors.js';
export * from './colors/inputColors.js';
export * from './colors/listColors.js';
export * from './colors/menuColors.js';
export * from './colors/quickpickColors.js';
export * from './colors/searchColors.js';
export * from './colors/miscColors.js';
export * from './colors/chartsColors.js';
export * from './colors/minimapColors.js';
