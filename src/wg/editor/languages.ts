// Language contribution seam for the Monaco editor.
//
// Two concerns live here:
//
//   1. registerLanguage() — forwards a language registration (id, extensions,
//      Monarch tokenizer, language configuration) to Monaco's `languages.*`
//      contribution API. This is the grammar/tokenizer registration mechanism
//      the spec requires keeping intact. SQL is an explicit use case but NO
//      dialect is hardcoded here — the host passes the grammar in.
//
//   2. registerLanguageServiceAdapters() — the integration point where a
//      future Rust IPC backend feeds language-service results (completion /
//      hover / diagnostics) into Monaco's provider APIs. This is WIRING GLUE
//      only: it delegates every request to the adapter the backend supplies
//      and maps the backend shapes onto Monaco's shapes. It produces no data
//      of its own — "don't implement the providers" means the data sources,
//      not this thin pass-through, which is exactly the adapter point the spec
//      asks us to leave open.

import type * as Monaco from 'monaco-editor';
import type {
	BackendCompletionItemKind,
	BackendMarkdownString,
	IBackendCompletionItem,
	IBackendCompletionResult,
	IBackendDiagnostic,
	IBackendHover,
	ITextModelSnapshot,
	LanguageServiceAdapters,
} from './providers.js';

export interface LanguageRegistration {
	/** Monaco language id, e.g. `'sql'`, `'json'`, `'mysql'`. */
	readonly id: string;
	/** File extensions that map to this language, e.g. `['.sql']`. */
	readonly extensions?: readonly string[];
	/** Filename globs that map to this language. */
	readonly filenames?: readonly string[];
	/** Optional alias(es) shown in the UI. */
	readonly aliases?: readonly string[];
	/**
	 * Optional Monarch tokenizer definition. Forwards to
	 * `monaco.languages.setMonarchTokensProvider(id, grammar)`.
	 */
	readonly monarchTokenizer?: unknown;
	/**
	 * Optional language configuration (brackets, auto-closing pairs, comments).
	 * Forwards to `monaco.languages.setLanguageConfiguration(id, config)`.
	 */
	readonly configuration?: Monaco.languages.LanguageConfiguration;
}

/**
 * Register a language with Monaco. Idempotent: re-registering the same id
 * updates its config/tokenizer. Safe to call before or after the editor mounts.
 *
 * Does NOT register any language-service providers (completion/hover/
 * diagnostics) — those come from `LanguageServiceAdapters` and are wired via
 * `registerLanguageServiceAdapters`.
 */
export function registerLanguage(monaco: typeof Monaco, registration: LanguageRegistration): void {
	const { id, extensions, filenames, aliases } = registration;
	monaco.languages.register({
		id,
		extensions: extensions as string[] | undefined,
		filenames: filenames as string[] | undefined,
		aliases: aliases as string[] | undefined,
	});
	if (registration.configuration) {
		monaco.languages.setLanguageConfiguration(id, registration.configuration);
	}
	if (registration.monarchTokenizer) {
		monaco.languages.setMonarchTokensProvider(id, registration.monarchTokenizer as Monaco.languages.IMonarchLanguage);
	}
}

/**
 * Wire a backend's language-service adapters into Monaco's provider APIs for
 * one language. This is the integration point the Rust IPC backend will use.
 *
 * Glue only — every request is delegated to the supplied adapter. The backend
 * implements the adapters; this function just maps shapes and registers them.
 */
export function registerLanguageServiceAdapters(monaco: typeof Monaco, adapters: LanguageServiceAdapters): void {
	const { languageId, completion, hover, diagnostics } = adapters;

	if (completion) {
		monaco.languages.registerCompletionItemProvider(languageId, {
			triggerCharacters: completion.triggerCharacters as string[] | undefined,
			provideCompletionItems: (model, position) =>
				Promise.resolve(completion.provideCompletionItems(snapshot(model), position)).then(mapCompletionResult(monaco)),
		});
	}

	if (hover) {
		monaco.languages.registerHoverProvider(languageId, {
			provideHover: (model, position) =>
				Promise.resolve(hover.provideHover(snapshot(model), position)).then(h => (h ? mapHover(monaco, h) : undefined)),
		});
	}

	if (diagnostics) {
		attachDiagnostics(monaco, languageId, diagnostics);
	}
}

//  ------ internal helpers

function snapshot(model: Monaco.editor.ITextModel): ITextModelSnapshot {
	return {
		id: model.id,
		languageId: model.getLanguageId(),
		getValue: () => model.getValue(),
		getValueInRange: (range) => model.getValueInRange(range),
		getWordUntilPosition: (pos) => model.getWordUntilPosition(pos),
	};
}

function attachDiagnostics(
	monaco: typeof Monaco,
	languageId: string,
	diagnostics: NonNullable<LanguageServiceAdapters['diagnostics']>
): void {
	const recompute = (model: Monaco.editor.ITextModel) => {
		Promise.resolve(diagnostics.provideDiagnostics(snapshot(model))).then(diags => {
			monaco.editor.setModelMarkers(model, languageId, diags.map(d => mapDiagnostic(monaco, d)));
		});
	};
	const ensure = (model: Monaco.editor.ITextModel) => {
		if ((model as any).__wgDiagnosticsAttached) {
			return;
		}
		(model as any).__wgDiagnosticsAttached = true;
		model.onDidChangeContent(() => recompute(model));
		recompute(model);
	};
	for (const model of monaco.editor.getModels()) {
		if (model.getLanguageId() === languageId) {
			ensure(model);
		}
	}
	monaco.editor.onDidCreateModel(model => {
		if (model.getLanguageId() === languageId) {
			ensure(model);
		}
	});
}

function mapCompletionResult(monaco: typeof Monaco) {
	return (result: IBackendCompletionResult) => ({
		suggestions: result.items.map((item: IBackendCompletionItem) => mapCompletionItem(monaco, item)),
		incomplete: result.incomplete,
	});
}

function mapCompletionItem(monaco: typeof Monaco, item: IBackendCompletionItem): Monaco.languages.CompletionItem {
	return {
		label: item.label,
		kind: item.kind ? mapCompletionItemKind(monaco, item.kind) : undefined,
		detail: item.detail,
		documentation: item.documentation,
		insertText: item.insertText,
		insertTextRules: item.insertTextRules === 'snippet'
			? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
			: monaco.languages.CompletionItemInsertTextRule.None,
		sortText: item.sortText,
		filterText: item.filterText,
		preselect: item.preselect,
		range: item.range,
	} as Monaco.languages.CompletionItem;
}

function mapCompletionItemKind(monaco: typeof Monaco, kind: BackendCompletionItemKind): Monaco.languages.CompletionItemKind {
	const K = monaco.languages.CompletionItemKind;
	const map: Record<BackendCompletionItemKind, Monaco.languages.CompletionItemKind> = {
		text: K.Text, method: K.Method, function: K.Function, constructor: K.Constructor,
		field: K.Field, variable: K.Variable, class: K.Class, struct: K.Struct,
		interface: K.Interface, module: K.Module, property: K.Property, unit: K.Unit,
		value: K.Value, enum: K.Enum, keyword: K.Keyword, snippet: K.Snippet,
		color: K.Color, file: K.File, reference: K.Reference, folder: K.Folder,
		enumMember: K.EnumMember, constant: K.Constant, type: K.TypeParameter,
		event: K.Event, operator: K.Operator, typeParameter: K.TypeParameter,
	};
	return map[kind];
}

function mapHover(monaco: typeof Monaco, hover: IBackendHover): Monaco.languages.Hover {
	const contents: Monaco.MarkedString[] = hover.contents.map((c: BackendMarkdownString) => ({
		value: c.value,
		isTrusted: c.isTrusted,
		supportThemeIcons: c.supportThemeIcons,
		supportHtml: c.supportHtml,
		baseUri: c.baseUri as unknown as Monaco.Uri,
	}));
	return { range: hover.range, contents } as Monaco.languages.Hover;
}

function mapDiagnostic(monaco: typeof Monaco, d: IBackendDiagnostic): Monaco.editor.IMarkerData {
	const S = monaco.MarkerSeverity;
	const severity = d.severity === 'error' ? S.Error
		: d.severity === 'warning' ? S.Warning
		: d.severity === 'info' ? S.Info
		: S.Hint;
	return {
		message: d.message,
		severity,
		startLineNumber: d.range.startLineNumber,
		startColumn: d.range.startColumn,
		endLineNumber: d.range.endLineNumber,
		endColumn: d.range.endColumn,
		source: d.source,
		code: d.code,
		relatedInformation: d.relatedInformation?.map(ri => ({
			resource: monaco.Uri.parse(ri.resource),
			message: ri.message,
			startLineNumber: ri.range.startLineNumber,
			startColumn: ri.range.startColumn,
			endLineNumber: ri.range.endLineNumber,
			endColumn: ri.range.endColumn,
		})),
	};
}
