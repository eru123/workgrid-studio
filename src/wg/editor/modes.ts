// Option presets for the three Monaco usage modes the spec requires:
//   1. 'full'        — a full editor instance (e.g. a SQL editor panel).
//   2. 'inline'      — a smaller editor embedded in a modal/cell/config field.
//   3. 'single-line' — Monaco configured to behave like a text input (command
//                      bar / query input): no line numbers, no minimap, single-
//                      line constrained, syntax-aware autocomplete still on.
//
// These are starting points; the host can override any option via `options`.

import type * as Monaco from 'monaco-editor';

export type MonacoEditorMode = 'full' | 'inline' | 'single-line';

export const MODE_PRESETS: Record<MonacoEditorMode, Monaco.editor.IStandaloneEditorConstructionOptions> = {
	full: {
		minimap: { enabled: true },
		scrollBeyondLastLine: false,
		fontSize: 13,
		lineNumbers: 'on',
		renderLineHighlight: 'all',
		folding: true,
		automaticLayout: true,
		padding: { top: 12, bottom: 12 },
	},

	inline: {
		minimap: { enabled: false },
		scrollBeyondLastLine: false,
		fontSize: 13,
		lineNumbers: 'off',
		folding: false,
		overviewRulerLanes: 0,
		automaticLayout: true,
		padding: { top: 4, bottom: 4 },
		scrollbar: { vertical: 'hidden', horizontal: 'hidden' },
		contextmenu: false,
	},

	'single-line': {
		// Behaves like a syntax-aware text input.
		minimap: { enabled: false },
		scrollBeyondLastLine: false,
		fontSize: 13,
		lineNumbers: 'off',
		folding: false,
		overviewRulerLanes: 0,
		automaticLayout: true,
		padding: { top: 4, bottom: 4 },
		scrollbar: { vertical: 'hidden', horizontal: 'hidden' },
		contextmenu: false,
		wordWrap: 'on',
		lineDecorationsWidth: 0,
		lineNumbersMinChars: 0,
		glyphMargin: false,
		fixedOverflowWidgets: true,
		// Single-line constraint is enforced at runtime in the wrapper by
		// preventing newlines and trimming the model; see MonacoEditor.tsx.
	},
};

/**
 * Merge a mode preset with host overrides. Host options win.
 */
export function resolveOptions(
	mode: MonacoEditorMode,
	overrides?: Monaco.editor.IStandaloneEditorConstructionOptions
): Monaco.editor.IStandaloneEditorConstructionOptions {
	return { ...MODE_PRESETS[mode], ...overrides };
}
