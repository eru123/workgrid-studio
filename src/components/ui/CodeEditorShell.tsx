import { cn } from "@/lib/utils/cn";
import Editor from "@monaco-editor/react";
import { useEffect, useRef } from "react";
import type { Suggestion } from "@/lib/sqlSuggestions";

export interface CodeEditorShellProps {
    value: string;
    onChange?: (val: string) => void;
    language?: string;
    className?: string;
    readOnly?: boolean;
    minimal?: boolean;
    onMount?: (editor: any, monaco: any) => void;
    provideSqlSuggestions?: (textUntilCursor: string) => Suggestion[];
}

export const modelSuggestionCallbacks = new Map<string, (text: string, monaco: any, range: any) => any>();
export let isSqlProviderRegistered = false;

export function registerSqlProviderIfNeeded(monaco: any) {
    if (isSqlProviderRegistered) return;
    isSqlProviderRegistered = true;
    
    monaco.languages.registerCompletionItemProvider('sql', {
        triggerCharacters: [' ', '.', '`', '('],
        provideCompletionItems: (model: any, position: any) => {
            const cb = modelSuggestionCallbacks.get(model.id);
            if (!cb) return { suggestions: [] };

            const word = model.getWordUntilPosition(position);
            const range = {
                startLineNumber: position.lineNumber,
                endLineNumber: position.lineNumber,
                startColumn: word.startColumn,
                endColumn: word.endColumn
            };

            const textUntilPosition = model.getValueInRange({
                startLineNumber: 1,
                startColumn: 1,
                endLineNumber: position.lineNumber,
                endColumn: position.column
            });

            return cb(textUntilPosition, monaco, range);
        }
    });
}

export function getMonacoKind(kind: string, monaco: any) {
    switch(kind) {
        case "keyword": return monaco.languages.CompletionItemKind.Keyword;
        case "function": return monaco.languages.CompletionItemKind.Function;
        case "type": return monaco.languages.CompletionItemKind.Struct;
        case "database": return monaco.languages.CompletionItemKind.Module;
        case "table": return monaco.languages.CompletionItemKind.Class;
        case "column": return monaco.languages.CompletionItemKind.Field;
        case "snippet": return monaco.languages.CompletionItemKind.Snippet;
        default: return monaco.languages.CompletionItemKind.Text;
    }
}

export function CodeEditorShell({ value, onChange, language = "sql", className, readOnly, minimal, onMount, provideSqlSuggestions }: CodeEditorShellProps) {
    const editorRef = useRef<any>(null);
    const suggestionsCallbackRef = useRef(provideSqlSuggestions);
    suggestionsCallbackRef.current = provideSqlSuggestions;

    useEffect(() => {
        return () => {
            if (editorRef.current) {
                const model = editorRef.current.getModel();
                if (model) modelSuggestionCallbacks.delete(model.id);
            }
        };
    }, []);

    return (
        <div className={cn("w-full h-full relative border rounded-md overflow-hidden", minimal && "border-none rounded-none", className)}>
            <Editor
                height="100%"
                language={language}
                value={value}
                onChange={(val) => onChange?.(val || "")}
                theme="vs-dark"
                onMount={(editor, monaco) => {
                    editorRef.current = editor;
                    if (language === "sql") {
                        registerSqlProviderIfNeeded(monaco);
                        const model = editor.getModel();
                        if (model) {
                            modelSuggestionCallbacks.set(model.id, (text: string, mon: any, range: any) => {
                                const cb = suggestionsCallbackRef.current;
                                if (!cb) return { suggestions: [] };
                                const items = cb(text);
                                return {
                                    suggestions: items.map(s => ({
                                        label: s.label,
                                        kind: getMonacoKind(s.kind, mon),
                                        detail: s.detail,
                                        insertText: s.insertText ?? s.label,
                                        range: range
                                    }))
                                };
                            });
                        }
                    }
                    onMount?.(editor, monaco);
                }}
                options={{
                    minimap: { enabled: false },
                    scrollBeyondLastLine: false,
                    fontSize: 13,
                    wordWrap: minimal ? "off" : "on",
                    padding: { top: minimal ? 4 : 12, bottom: minimal ? 4 : 12 },
                    readOnly,
                    lineNumbers: minimal ? "off" : "on",
                    folding: !minimal,
                    overviewRulerLanes: minimal ? 0 : undefined,
                    scrollbar: minimal ? { vertical: "hidden", horizontal: "hidden" } : undefined,
                    contextmenu: !minimal,
                }}
            />
        </div>
    );
}
