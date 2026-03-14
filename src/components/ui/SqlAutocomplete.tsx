import { useEffect, useRef, useCallback } from "react";
import { cn } from "@/lib/utils/cn";
import { Database, Table2, Columns3, Braces, Type, Hash } from "lucide-react";
import type { Suggestion, SuggestionKind } from "@/lib/sqlSuggestions";

// ── Kind icons & colours ─────────────────────────────────────────────

function kindIcon(kind: SuggestionKind) {
  const base = "w-3.5 h-3.5 shrink-0";
  switch (kind) {
    case "keyword":
      return <Hash className={cn(base, "text-blue-400")} />;
    case "function":
      return <Braces className={cn(base, "text-yellow-400")} />;
    case "type":
      return <Type className={cn(base, "text-teal-400")} />;
    case "database":
      return <Database className={cn(base, "text-purple-400")} />;
    case "table":
      return <Table2 className={cn(base, "text-orange-400")} />;
    case "column":
      return <Columns3 className={cn(base, "text-sky-400")} />;
    default:
      return <Hash className={cn(base, "text-muted-foreground")} />;
  }
}

function kindLabel(kind: SuggestionKind): string {
  switch (kind) {
    case "keyword":
      return "Keyword";
    case "function":
      return "Function";
    case "type":
      return "Type";
    case "database":
      return "Database";
    case "table":
      return "Table";
    case "column":
      return "Column";
    default:
      return "";
  }
}

// ── Highlight matching text ──────────────────────────────────────────

function highlightMatch(label: string, prefix: string) {
  if (!prefix) return <>{label}</>;
  const idx = label.toLowerCase().indexOf(prefix.toLowerCase());
  if (idx === -1) return <>{label}</>;
  return (
    <>
      {label.slice(0, idx)}
      <span className="text-primary font-semibold">
        {label.slice(idx, idx + prefix.length)}
      </span>
      {label.slice(idx + prefix.length)}
    </>
  );
}

// ── Props ────────────────────────────────────────────────────────────

interface SqlAutocompleteProps {
  suggestions: Suggestion[];
  selectedIndex: number;
  prefix: string;
  position: { top: number; left: number };
  onAccept: (suggestion: Suggestion) => void;
  onSelectedIndexChange: (idx: number) => void;
  visible: boolean;
}

// ── Component ────────────────────────────────────────────────────────

export function SqlAutocomplete({
  suggestions,
  selectedIndex,
  prefix,
  position,
  onAccept,
  onSelectedIndexChange,
  visible,
}: SqlAutocompleteProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  // Scroll the selected item into view
  useEffect(() => {
    const el = itemRefs.current.get(selectedIndex);
    if (el) {
      el.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIndex]);

  const setItemRef = useCallback(
    (idx: number) => (el: HTMLDivElement | null) => {
      if (el) {
        itemRefs.current.set(idx, el);
      } else {
        itemRefs.current.delete(idx);
      }
    },
    [],
  );

  if (!visible || suggestions.length === 0) return null;

  const selected = suggestions[selectedIndex];

  return (
    <div
      className="absolute z-50 flex gap-0"
      style={{
        top: position.top,
        left: position.left,
      }}
    >
      {/* Suggestion list */}
      <div
        ref={listRef}
        className="min-w-56 max-w-80 max-h-52 bg-popover/95 backdrop-blur-sm border rounded-md shadow-lg overflow-y-auto overflow-x-hidden"
        role="listbox"
      >
        {suggestions.map((s, idx) => (
          <div
            key={`${s.kind}::${s.label}`}
            ref={setItemRef(idx)}
            role="option"
            aria-selected={idx === selectedIndex}
            className={cn(
              "flex items-center gap-2 px-2 py-1 text-xs cursor-pointer transition-colors",
              idx === selectedIndex
                ? "bg-primary/20 text-foreground"
                : "text-foreground/80 hover:bg-accent/40",
            )}
            onClick={() => onAccept(s)}
            onMouseEnter={() => onSelectedIndexChange(idx)}
          >
            {kindIcon(s.kind)}
            <span className="truncate font-mono text-[11px]">
              {highlightMatch(s.label, prefix)}
            </span>
            {s.detail && (
              <span className="ml-auto text-muted-foreground/60 text-[10px] truncate max-w-24">
                {s.detail}
              </span>
            )}
          </div>
        ))}
      </div>

      {/* Detail panel (right side, shows for the selected item) */}
      {selected && selected.detail && (
        <div className="w-44 max-h-52 bg-popover/95 backdrop-blur-sm border border-l-0 rounded-r-md shadow-lg p-2 text-[11px] overflow-y-auto">
          <div className="flex items-center gap-1.5 mb-1.5">
            {kindIcon(selected.kind)}
            <span className="font-medium text-foreground text-xs">
              {selected.label}
            </span>
          </div>
          <div className="text-muted-foreground/80 leading-relaxed">
            <span className="text-muted-foreground/50">
              {kindLabel(selected.kind)}
            </span>
            {selected.detail && (
              <span className="ml-1 text-muted-foreground/70">
                — {selected.detail}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
