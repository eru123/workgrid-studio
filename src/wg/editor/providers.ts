// Monaco provider-adapter interfaces — the seams where a future Rust IPC
// backend feeds language-service results into Monaco.
//
// These are TYPES ONLY. Nothing here calls `monaco.languages.register*` or
// constructs a real provider. The host (or the Rust IPC layer) implements
// these adapters and hands them to the MonacoEditor wrapper / a registration
// helper (to be added when the backend is wired) which then calls
// `monaco.languages.registerCompletionItemProvider(languageId, adapter)` etc.
//
// Design intent: keep the Monaco provider-API surface intact and reachable so
// wiring real LSP results later is a matter of implementing these interfaces,
// NOT re-architecting the editor. We deliberately mirror Monaco's own shapes
// (position, range, model) loosely so an implementer can map IPC payloads
// directly without a second translation layer.

/**
 * A text position, mirroring `monaco.Position`. 1-based line/column.
 */
export interface IPosition {
	readonly lineNumber: number;
	readonly column: number;
}

/**
 * A text range, mirroring `monaco.Range`. 1-based, inclusive.
 */
export interface IRange {
	readonly startLineNumber: number;
	readonly startColumn: number;
	readonly endLineNumber: number;
	readonly endColumn: number;
}

/**
 * A read-only view of the model the editor is asking about. The Rust backend
 * normally only needs the text up to the cursor (for completion) or the text
 * of a range (for hover/diagnostics), so this is intentionally minimal.
 */
export interface ITextModelSnapshot {
	readonly id: string;
	readonly languageId: string;
	getValue(): string;
	getValueInRange(range: IRange): string;
	getWordUntilPosition(position: IPosition): IRange;
}

/**
 * A completion item, mirroring the subset of `monaco.languages.CompletionItem`
 * a backend typically produces. The adapter is responsible for mapping this to
 * the full Monaco shape (incl. `kind` enum, `insertTextRules`, etc.) at
 * registration time.
 */
export interface IBackendCompletionItem {
	readonly label: string;
	readonly kind?: BackendCompletionItemKind;
	readonly detail?: string;
	readonly documentation?: string;
	readonly insertText: string;
	readonly insertTextRules?: 'plainText' | 'snippet';
	readonly sortText?: string;
	readonly filterText?: string;
	readonly preselect?: boolean;
	readonly range?: IRange;
}

export type BackendCompletionItemKind =
	| 'text' | 'method' | 'function' | 'constructor' | 'field' | 'variable'
	| 'class' | 'struct' | 'interface' | 'module' | 'property' | 'unit'
	| 'value' | 'enum' | 'keyword' | 'snippet' | 'color' | 'file' | 'reference'
	| 'folder' | 'enumMember' | 'constant' | 'type' | 'event' | 'operator' | 'typeParameter';

export interface IBackendCompletionResult {
	readonly items: readonly IBackendCompletionItem[];
	readonly incomplete?: boolean;
}

/**
 * Adapter contract for completion. The backend implements this; a future
 * registration helper wraps it in `monaco.languages.CompletionItemProvider`.
 */
export interface CompletionProviderAdapter {
	readonly triggerCharacters?: readonly string[];
	provideCompletionItems(model: ITextModelSnapshot, position: IPosition): Promise<IBackendCompletionResult> | IBackendCompletionResult;
}

/**
 * A hover, mirroring `monaco.languages.Hover`.
 */
export interface IBackendHover {
	readonly range?: IRange;
	readonly contents: readonly BackendMarkdownString[];
}

export interface BackendMarkdownString {
	readonly value: string;
	readonly isTrusted?: boolean;
	readonly supportThemeIcons?: boolean;
	readonly supportHtml?: boolean;
	readonly baseUri?: string;
}

export interface HoverProviderAdapter {
	provideHover(model: ITextModelSnapshot, position: IPosition): Promise<IBackendHover | undefined> | IBackendHover | undefined;
}

/**
 * A diagnostic, mirroring `monaco.editor.IMarkerData`.
 */
export interface IBackendDiagnostic {
	readonly message: string;
	readonly severity: 'error' | 'warning' | 'info' | 'hint';
	readonly range: IRange;
	readonly source?: string;
	readonly code?: string | number;
	readonly relatedInformation?: readonly {
		readonly resource: string;
		readonly message: string;
		readonly range: IRange;
	}[];
}

export interface DiagnosticsAdapter {
	/**
	 * Returns the current diagnostics for a model. Called whenever the model
	 * changes (the registration helper wires `model.onDidChangeContent`).
	 */
	provideDiagnostics(model: ITextModelSnapshot): Promise<readonly IBackendDiagnostic[]> | readonly IBackendDiagnostic[];
}

/**
 * Aggregates all the language-service adapters for one language. The host
 * builds this per language and passes it to a registration helper (TBD with
 * the backend) which calls the Monaco `register*` APIs.
 */
export interface LanguageServiceAdapters {
	readonly languageId: string;
	readonly completion?: CompletionProviderAdapter;
	readonly hover?: HoverProviderAdapter;
	readonly diagnostics?: DiagnosticsAdapter;
}
