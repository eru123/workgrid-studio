
import { cn } from "@/lib/utils/cn";

export interface CodeEditorShellProps {
    value: string;
    onChange?: (val: string) => void;
    language?: string;
    className?: string;
}

export function CodeEditorShell({ value, onChange, language = "sql", className }: CodeEditorShellProps) {
    // Skeleton for Monaco integration later
    return (
        <div className={cn("w-full h-full relative font-mono text-sm bg-background border rounded-md p-2 overflow-auto", className)}>
            <textarea
                className="w-full h-full bg-transparent resize-none outline-none text-foreground"
                value={value}
                onChange={(e) => onChange?.(e.target.value)}
                spellCheck={false}
            />
            <div className="absolute top-2 right-2 text-xs text-muted-foreground opacity-50 select-none">
                {language.toUpperCase()}
            </div>
        </div>
    );
}
