// React wrapper around `@monaco-editor/react`'s `<Editor>` with the three
// usage-mode presets from `./modes.ts`. The host picks a `mode` and optionally
// overrides options; the wrapper handles single-line constraint enforcement
// for the `'single-line'` mode.
//
// The `onMonaco` callback gives the host the `monaco` namespace on first load
// so it can call `registerLanguage()` / `registerLanguageServiceAdapters()`
// from `./languages.ts` (the Rust-IPC integration point).

import { useEffect, useRef } from 'react';
import Editor, { type OnMount, type OnChange, type BeforeMount } from '@monaco-editor/react';
import type * as Monaco from 'monaco-editor';
import { resolveOptions, type MonacoEditorMode } from './modes.js';

export interface MonacoEditorProps {
	value: string;
	language?: string;
	theme?: string;
	mode?: MonacoEditorMode;
	onChange?: OnChange;
	onMount?: OnMount;
	/** Called once with the `monaco` namespace when Monaco first loads. */
	onMonaco?: (monaco: typeof Monaco) => void;
	/** Host overrides; merged on top of the mode preset. */
	options?: Monaco.editor.IStandaloneEditorConstructionOptions;
	className?: string;
	height?: string | number;
}

export function MonacoEditor({
	value,
	language = 'plaintext',
	theme,
	mode = 'full',
	onChange,
	onMount,
	onMonaco,
	options,
	className,
	height = '100%',
}: MonacoEditorProps) {
	const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
	const monacoRef = useRef<typeof Monaco | null>(null);
	const modeRef = useRef(mode);
	modeRef.current = mode;

	// Wire onMonaco once. @monaco-editor/react exposes the monaco namespace via
	// the `onMount`/`beforeMount` hooks; we use beforeMount so registration
	// (languages, providers) happens before the editor constructs.
	const handleBeforeMount: BeforeMount = (monaco) => {
		monacoRef.current = monaco;
		onMonaco?.(monaco);
	};

	const handleMount: OnMount = (editor, monaco) => {
		editorRef.current = editor;
		monacoRef.current = monaco;
		if (modeRef.current === 'single-line') {
			applySingleLineConstraints(editor, monaco);
		}
		onMount?.(editor, monaco);
	};

	// Re-apply single-line constraints if the mode changes after mount.
	useEffect(() => {
		const editor = editorRef.current;
		const monaco = monacoRef.current;
		if (!editor || !monaco) {
			return;
		}
		if (mode === 'single-line') {
			applySingleLineConstraints(editor, monaco);
		}
		editor.updateOptions(resolveOptions(mode, options));
	}, [mode, options]);

	return (
		<div className={className} style={{ height, width: '100%' }}>
			<Editor
				height="100%"
				language={language}
				value={value}
				theme={theme}
				beforeMount={handleBeforeMount}
				onMount={handleMount}
				onChange={onChange}
				options={resolveOptions(mode, options)}
			/>
		</div>
	);
}

/**
 * Force single-line behavior: block Enter, strip newlines from pasted content,
 * and keep the model on one line.
 */
function applySingleLineConstraints(editor: Monaco.editor.IStandaloneCodeEditor, monaco: typeof Monaco): void {
	// Block Enter from creating newlines.
	editor.addCommand(monaco.KeyCode.Enter, () => { /* swallow */ });

	// Strip newlines on content change.
	editor.onDidChangeModelContent(() => {
		const model = editor.getModel();
		if (!model) {
			return;
		}
		const value = model.getValue();
		if (value.indexOf('\n') >= 0 || value.indexOf('\r') >= 0) {
			const single = value.replace(/[\r\n]+/g, ' ');
			const position = editor.getPosition();
			model.applyEdits([{
				range: model.getFullModelRange(),
				text: single,
			}]);
			if (position) {
				editor.setPosition(position);
			}
		}
	});
}
