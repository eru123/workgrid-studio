import { cn } from "@/lib/utils/cn";
import Editor from "@monaco-editor/react";

export interface CodeEditorShellProps {
    value: string;
    onChange?: (val: string) => void;
    language?: string;
    className?: string;
    readOnly?: boolean;
    minimal?: boolean;
    onMount?: (editor: any, monaco: any) => void;
}

export function CodeEditorShell({ value, onChange, language = "sql", className, readOnly, minimal, onMount }: CodeEditorShellProps) {
    return (
        <div className={cn("w-full h-full relative border rounded-md overflow-hidden", minimal && "border-none rounded-none", className)}>
            <Editor
                height="100%"
                language={language}
                value={value}
                onChange={(val) => onChange?.(val || "")}
                theme="vs-dark"
                onMount={(editor, monaco) => {
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
