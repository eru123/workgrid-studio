import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils/cn";

interface AutocompleteInputProps {
  value: string;
  onChange: (value: string) => void;
  suggestions: string[];
  placeholder?: string;
  disabled?: boolean;
  spellCheck?: boolean;
  maxSuggestions?: number;
  selectOnEnter?: boolean;
  selectOnTab?: boolean;
  onEnter?: () => void;
  inputClassName?: string;
  dropdownClassName?: string;
}

export function AutocompleteInput({
  value,
  onChange,
  suggestions,
  placeholder,
  disabled,
  spellCheck,
  maxSuggestions = 8,
  selectOnEnter = true,
  selectOnTab = false,
  onEnter,
  inputClassName,
  dropdownClassName,
}: AutocompleteInputProps) {
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);

  const visibleSuggestions = useMemo(
    () => suggestions.slice(0, maxSuggestions),
    [suggestions, maxSuggestions],
  );

  useEffect(() => {
    if (activeIdx >= visibleSuggestions.length) {
      setActiveIdx(0);
    }
  }, [activeIdx, visibleSuggestions.length]);

  const applySuggestion = (nextValue: string) => {
    onChange(nextValue);
    setOpen(false);
  };

  return (
    <div className="relative w-full">
      <input
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          // let mousedown on suggestion run first
          window.setTimeout(() => setOpen(false), 100);
        }}
        onKeyDown={(e) => {
          if (!open || visibleSuggestions.length === 0) return;

          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActiveIdx((prev) => (prev + 1) % visibleSuggestions.length);
            return;
          }
          if (e.key === "ArrowUp") {
            e.preventDefault();
            setActiveIdx((prev) =>
              prev === 0 ? visibleSuggestions.length - 1 : prev - 1,
            );
            return;
          }
          if (e.key === "Enter") {
            if (selectOnEnter && visibleSuggestions[activeIdx]) {
              e.preventDefault();
              applySuggestion(visibleSuggestions[activeIdx]);
              return;
            }
            if (onEnter) {
              e.preventDefault();
              onEnter();
            }
            return;
          }
          if (e.key === "Tab") {
            if (selectOnTab && visibleSuggestions[activeIdx]) {
              e.preventDefault();
              applySuggestion(visibleSuggestions[activeIdx]);
            }
            return;
          }
          if (e.key === "Escape") {
            e.preventDefault();
            setOpen(false);
          }
        }}
        disabled={disabled}
        spellCheck={spellCheck}
        className={inputClassName}
        placeholder={placeholder}
      />

      {open && visibleSuggestions.length > 0 && !disabled && (
        <div
          className={cn(
            "absolute z-50 mt-1 w-full rounded border bg-popover text-popover-foreground shadow-lg overflow-hidden",
            dropdownClassName,
          )}
          role="listbox"
        >
          {visibleSuggestions.map((item, idx) => (
            <button
              key={`${item}-${idx}`}
              type="button"
              className={cn(
                "w-full text-left px-2 py-1 text-xs font-mono truncate",
                idx === activeIdx ? "bg-accent text-foreground" : "hover:bg-accent/70",
              )}
              onMouseDown={(e) => {
                e.preventDefault();
                applySuggestion(item);
              }}
            >
              {item}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
