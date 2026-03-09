import React, { useState, useEffect, useRef, useMemo } from "react";
import { Search, Server, Database, Table, Terminal, X } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { useProfilesStore } from "@/state/profilesStore";
import { useSchemaStore } from "@/state/schemaStore";
import { useAppStore } from "@/state/appStore";
import { useLayoutStore } from "@/state/layoutStore";

type SearchItem = {
    id: string;
    type: "server" | "database" | "table";
    name: string;
    description: string;
    profileId: string;
    database?: string;
    color?: string;
};

export const CommandPalette: React.FC = () => {
    const isOpen = useAppStore((s) => s.isCommandPaletteOpen);
    const setOpen = useAppStore((s) => s.setCommandPaletteOpen);
    const profiles = useProfilesStore((s) => s.profiles);
    const openTab = useLayoutStore((s) => s.openTab);

    const [query, setQuery] = useState("");
    const [selectedIndex, setSelectedIndex] = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);
    const scrollRef = useRef<HTMLDivElement>(null);

    // Flatten all searchable items
    const allItems = useMemo(() => {
        const items: SearchItem[] = [];

        // Servers
        profiles.forEach((p) => {
            items.push({
                id: `server-${p.id}`,
                type: "server",
                name: p.name,
                description: `${p.type} • ${p.host}`,
                profileId: p.id,
                color: p.color,
            });

            // Databases for this server
            const dbs = useSchemaStore.getState().databases[p.id] || [];
            dbs.forEach((db) => {
                items.push({
                    id: `db-${p.id}-${db}`,
                    type: "database",
                    name: db,
                    description: `Database on ${p.name}`,
                    profileId: p.id,
                    database: db,
                });

                // Tables for this database
                const tables = useSchemaStore.getState().tables[`${p.id}::${db}`] || [];
                tables.forEach((table) => {
                    items.push({
                        id: `table-${p.id}-${db}-${table}`,
                        type: "table",
                        name: table,
                        description: `Table in ${p.name} / ${db}`,
                        profileId: p.id,
                        database: db,
                    });
                });
            });
        });

        return items;
    }, [profiles, isOpen]); // Refresh when open to get latest schema data

    const filteredItems = useMemo(() => {
        if (!query.trim()) return allItems.slice(0, 10);
        const q = query.toLowerCase();
        return allItems
            .filter((i) => i.name.toLowerCase().includes(q) || i.description.toLowerCase().includes(q))
            .slice(0, 50);
    }, [allItems, query]);

    useEffect(() => {
        if (isOpen) {
            setQuery("");
            setSelectedIndex(0);
            setTimeout(() => inputRef.current?.focus(), 10);
        }
    }, [isOpen]);

    const handleSelect = (item: SearchItem) => {
        if (item.type === "table") {
            openTab({
                type: "table-data",
                title: item.name,
                meta: {
                    profileId: item.profileId,
                    database: item.database!,
                    tableName: item.name,
                },
            });
        }
        // Could add navigation for servers/databases too
        setOpen(false);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "ArrowDown") {
            e.preventDefault();
            setSelectedIndex((prev) => (prev + 1) % filteredItems.length);
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setSelectedIndex((prev) => (prev - 1 + filteredItems.length) % filteredItems.length);
        } else if (e.key === "Enter") {
            e.preventDefault();
            if (filteredItems[selectedIndex]) {
                handleSelect(filteredItems[selectedIndex]);
            }
        } else if (e.key === "Escape") {
            setOpen(false);
        }
    };

    // Auto scroll to selected item
    useEffect(() => {
        const el = scrollRef.current?.children[selectedIndex] as HTMLElement;
        if (el) {
            el.scrollIntoView({ block: "nearest" });
        }
    }, [selectedIndex]);

    if (!isOpen) return null;

    return (
        <div
            className="fixed inset-0 z-[1000] flex items-start justify-center pt-[15vh] bg-black/40 backdrop-blur-[2px] animate-in fade-in duration-200"
            onClick={() => setOpen(false)}
        >
            <div
                className="w-full max-w-xl bg-popover border rounded-xl shadow-2xl overflow-hidden flex flex-col animate-in zoom-in-95 slide-in-from-top-4 duration-200"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Search Header */}
                <div className="flex items-center gap-3 px-4 py-3 border-b bg-muted/30">
                    <Search className="w-4 h-4 text-muted-foreground" />
                    <input
                        ref={inputRef}
                        type="text"
                        className="flex-1 bg-transparent border-none outline-none text-sm placeholder:text-muted-foreground/50"
                        placeholder="Search for servers, databases, or tables..."
                        value={query}
                        onChange={(e) => {
                            setQuery(e.target.value);
                            setSelectedIndex(0);
                        }}
                        onKeyDown={handleKeyDown}
                    />
                    <div className="flex items-center gap-1.5 px-1.5 py-0.5 border rounded text-[10px] text-muted-foreground bg-muted/50 font-mono">
                        <span className="text-[12px] opacity-70">ESC</span>
                    </div>
                </div>

                {/* Results List */}
                <div
                    ref={scrollRef}
                    className="max-h-[400px] overflow-y-auto p-1.5 custom-scrollbar"
                >
                    {filteredItems.length === 0 ? (
                        <div className="py-12 text-center text-muted-foreground flex flex-col items-center gap-2">
                            <X className="w-8 h-8 opacity-10" />
                            <p className="text-sm">No matches found for "{query}"</p>
                        </div>
                    ) : (
                        filteredItems.map((item, idx) => {
                            const isSelected = idx === selectedIndex;
                            const Icon = item.type === "server" ? Server : item.type === "database" ? Database : Table;

                            return (
                                <button
                                    key={item.id}
                                    className={cn(
                                        "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-all",
                                        isSelected ? "bg-primary text-primary-foreground shadow-lg" : "hover:bg-accent group"
                                    )}
                                    onClick={() => handleSelect(item)}
                                >
                                    <div className={cn(
                                        "w-8 h-8 rounded shrink-0 flex items-center justify-center",
                                        isSelected ? "bg-white/20" : "bg-muted group-hover:bg-muted-foreground/10"
                                    )}>
                                        <Icon className="w-4 h-4" />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2">
                                            <span className="text-sm font-medium truncate">{item.name}</span>
                                            {item.type === "server" && item.color && (
                                                <div
                                                    className="w-1.5 h-1.5 rounded-full"
                                                    style={{ backgroundColor: item.color }}
                                                />
                                            )}
                                        </div>
                                        <p className={cn(
                                            "text-[10px] truncate",
                                            isSelected ? "text-primary-foreground/70" : "text-muted-foreground"
                                        )}>
                                            {item.description}
                                        </p>
                                    </div>
                                    {isSelected && (
                                        <div className="shrink-0 flex items-center gap-1 text-[10px] text-primary-foreground font-medium pr-1">
                                            <span>Enter</span>
                                            <Terminal className="w-3 h-3" />
                                        </div>
                                    )}
                                </button>
                            );
                        })
                    )}
                </div>

                {/* Footer */}
                <div className="px-4 py-2 bg-muted/30 border-t flex items-center gap-4 text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">
                    <div className="flex items-center gap-1.5">
                        <span className="px-1 py-0.5 border rounded bg-muted/50 text-[12px] opacity-70">↑↓</span>
                        Navigate
                    </div>
                    <div className="flex items-center gap-1.5">
                        <span className="px-1 py-0.5 border rounded bg-muted/50 text-[12px] opacity-70">⏎</span>
                        Open Table
                    </div>
                </div>
            </div>
        </div>
    );
};
