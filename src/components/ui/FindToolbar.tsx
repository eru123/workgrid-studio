import React, { useState, useEffect, useRef } from "react";
import { X, ChevronUp, ChevronDown, Search } from "lucide-react";
import { cn } from "@/lib/utils/cn";

interface FindToolbarProps {
    onSearch: (query: string) => void;
    onNext: () => void;
    onPrev: () => void;
    onClose: () => void;
    currentMatch: number;
    totalMatches: number;
    isOpen: boolean;
}

export const FindToolbar: React.FC<FindToolbarProps> = ({
    onSearch,
    onNext,
    onPrev,
    onClose,
    currentMatch,
    totalMatches,
    isOpen,
}) => {
    const [query, setQuery] = useState("");
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (isOpen && inputRef.current) {
            inputRef.current.focus();
            inputRef.current.select();
        }
    }, [isOpen]);

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter") {
            if (e.shiftKey) onPrev();
            else onNext();
        } else if (e.key === "Escape") {
            onClose();
        }
    };

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = e.target.value;
        setQuery(val);
        onSearch(val);
    };

    if (!isOpen) return null;

    return (
        <div className="absolute top-2 right-6 z-[100] flex items-center gap-1 p-1 bg-popover border rounded-md shadow-xl animate-in fade-in slide-in-from-top-1">
            <div className="relative flex items-center">
                <Search className="absolute left-2 w-3 h-3 text-muted-foreground" />
                <input
                    ref={inputRef}
                    type="text"
                    value={query}
                    onChange={handleChange}
                    onKeyDown={handleKeyDown}
                    placeholder="Find..."
                    className="h-8 w-48 pl-7 pr-20 bg-secondary/50 border-none rounded text-xs focus:ring-1 focus:ring-primary outline-none"
                />
                <div className="absolute right-2 flex items-center gap-1">
                    <span className="text-[10px] text-muted-foreground mr-1 tabular-nums">
                        {totalMatches > 0 ? `${currentMatch + 1}/${totalMatches}` : "0/0"}
                    </span>
                    <div className="w-px h-3 bg-border mx-0.5" />
                    <button
                        onClick={onPrev}
                        disabled={totalMatches === 0}
                        className="p-1 rounded hover:bg-accent disabled:opacity-30 transition-colors"
                        title="Previous Match (Shift+Enter)"
                    >
                        <ChevronUp className="w-3 h-3" />
                    </button>
                    <button
                        onClick={onNext}
                        disabled={totalMatches === 0}
                        className="p-1 rounded hover:bg-accent disabled:opacity-30 transition-colors"
                        title="Next Match (Enter)"
                    >
                        <ChevronDown className="w-3 h-3" />
                    </button>
                </div>
            </div>
            <div className="w-px h-4 bg-border mx-1" />
            <button
                onClick={onClose}
                className="p-1.5 rounded hover:bg-red-500/10 hover:text-red-500 transition-colors"
                title="Close (Esc)"
            >
                <X className="w-3.5 h-3.5" />
            </button>
        </div>
    );
};
