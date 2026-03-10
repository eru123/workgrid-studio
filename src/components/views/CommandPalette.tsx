import React, { useState, useEffect, useRef, useMemo } from "react";
import { Search, Server, Database, Table, Terminal, X, Settings, Plus, Sidebar, FileText } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { useProfilesStore } from "@/state/profilesStore";
import { useSchemaStore } from "@/state/schemaStore";
import { useAppStore } from "@/state/appStore";
import { useLayoutStore } from "@/state/layoutStore";

type ItemType = "server" | "database" | "table" | "action" | "tab";

type SearchItem = {
    id: string;
    type: ItemType;
    name: string;
    description: string;
    profileId?: string;
    database?: string;
    color?: string;
    shortcut?: string;
    action?: () => void;
};

export const CommandPalette: React.FC = () => {
    const isOpen = useAppStore((s) => s.isCommandPaletteOpen);
    const setOpen = useAppStore((s) => s.setCommandPaletteOpen);
    const profiles = useProfilesStore((s) => s.profiles);
    const openTab = useLayoutStore((s) => s.openTab);
    const setActiveView = useLayoutStore((s) => s.setActiveView);
    const toggleSidebar = useLayoutStore((s) => s.toggleSidebar);
    const editorTree = useLayoutStore((s) => s.editorTree);

    const [query, setQuery] = useState("");
    const [selectedIndex, setSelectedIndex] = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);
    const scrollRef = useRef<HTMLDivElement>(null);

    // Collect all tabs across all leaves for recently-opened tab items
    const allTabs = useMemo(() => {
        const tabs: SearchItem[] = [];
        function collectLeaves(node: typeof editorTree) {
            if (node.type === "leaf") {
                node.tabs.forEach(tab => {
                    tabs.push({
                        id: `tab-${tab.id}`,
                        type: "tab",
                        name: tab.title,
                        description: `Open tab · ${tab.type.replace("-", " ")}`,
                    });
                });
            } else {
                collectLeaves(node.a);
                collectLeaves(node.b);
            }
        }
        collectLeaves(editorTree);
        return tabs;
    }, [editorTree]);

    // Predefined keyboard/global actions
    const actionItems = useMemo((): SearchItem[] => [
        {
            id: "action-new-query",
            type: "action",
            name: "New SQL Query",
            description: "Open a new SQL editor tab",
            shortcut: "Ctrl+N",
            action: () => {
                const connectedProfiles = useSchemaStore.getState().connectedProfiles;
                const entries = Object.entries(connectedProfiles);
                const meta: Record<string, string> = {};
                if (entries.length > 0) {
                    meta.profileId = entries[0][0];
                    meta.profileName = entries[0][1].name;
                }
                openTab({ title: "New Query", type: "sql", meta });
            },
        },
        {
            id: "action-settings",
            type: "action",
            name: "Open Settings",
            description: "Open the settings page",
            action: () => openTab({ title: "Settings", type: "settings" }),
        },
        {
            id: "action-toggle-sidebar",
            type: "action",
            name: "Toggle Sidebar",
            description: "Show or hide the primary sidebar",
            shortcut: "Ctrl+B",
            action: () => toggleSidebar(),
        },
        {
            id: "action-servers",
            type: "action",
            name: "Go to Servers",
            description: "Switch to the Servers panel",
            action: () => setActiveView("servers"),
        },
        {
            id: "action-explorer",
            type: "action",
            name: "Go to Explorer",
            description: "Switch to the Explorer panel",
            action: () => setActiveView("explorer"),
        },
    ], [openTab, toggleSidebar, setActiveView]);

    // Flatten all searchable schema items
    const schemaItems = useMemo(() => {
        const items: SearchItem[] = [];
        profiles.forEach((p) => {
            items.push({
                id: `server-${p.id}`,
                type: "server",
                name: p.name,
                description: `${p.type} · ${p.host}`,
                profileId: p.id,
                color: p.color,
            });

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

                const tables = useSchemaStore.getState().tables[`${p.id}::${db}`] || [];
                tables.forEach((table) => {
                    items.push({
                        id: `table-${p.id}-${db}-${table}`,
                        type: "table",
                        name: table,
                        description: `${p.name} / ${db}`,
                        profileId: p.id,
                        database: db,
                    });
                });
            });
        });
        return items;
    }, [profiles, isOpen]);

    const allItems = useMemo(
        () => [...actionItems, ...allTabs, ...schemaItems],
        [actionItems, allTabs, schemaItems],
    );

    const filteredItems = useMemo(() => {
        if (!query.trim()) {
            // No query: show actions first, then recent tabs, then top schema items
            return [
                ...actionItems.slice(0, 5),
                ...allTabs.slice(0, 5),
                ...schemaItems.slice(0, 5),
            ].slice(0, 12);
        }
        const q = query.toLowerCase();
        return allItems
            .filter((i) => i.name.toLowerCase().includes(q) || i.description.toLowerCase().includes(q))
            .slice(0, 50);
    }, [allItems, actionItems, allTabs, schemaItems, query]);

    useEffect(() => {
        if (isOpen) {
            setQuery("");
            setSelectedIndex(0);
            setTimeout(() => inputRef.current?.focus(), 10);
        }
    }, [isOpen]);

    const handleSelect = (item: SearchItem) => {
        setOpen(false);
        if (item.action) {
            item.action();
            return;
        }
        if (item.type === "table") {
            openTab({
                type: "table-data",
                title: item.name,
                meta: {
                    profileId: item.profileId!,
                    database: item.database!,
                    tableName: item.name,
                },
            });
        } else if (item.type === "database") {
            openTab({
                type: "database-view",
                title: `Database: ${item.name}`,
                meta: {
                    profileId: item.profileId!,
                    profileName: profiles.find(p => p.id === item.profileId)?.name ?? "Server",
                    database: item.name,
                },
            });
        } else if (item.type === "server") {
            setActiveView("servers");
        }
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

    useEffect(() => {
        const el = scrollRef.current?.children[selectedIndex] as HTMLElement;
        if (el) el.scrollIntoView({ block: "nearest" });
    }, [selectedIndex]);

    if (!isOpen) return null;

    const ITEM_ICON: Record<ItemType, React.ReactNode> = {
        server: <Server className="w-4 h-4" />,
        database: <Database className="w-4 h-4" />,
        table: <Table className="w-4 h-4" />,
        action: <Terminal className="w-4 h-4" />,
        tab: <FileText className="w-4 h-4" />,
    };

    // Group label helpers
    const groupOf = (item: SearchItem): string => {
        if (item.type === "action") return "Actions";
        if (item.type === "tab") return "Open Tabs";
        if (item.type === "server") return "Servers";
        if (item.type === "database") return "Databases";
        return "Tables";
    };

    // Build grouped display
    const groups: { label: string; items: SearchItem[] }[] = [];
    filteredItems.forEach((item) => {
        const label = groupOf(item);
        const g = groups.find(g => g.label === label);
        if (g) g.items.push(item);
        else groups.push({ label, items: [item] });
    });

    let globalIdx = 0;

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
                    <Search className="w-4 h-4 text-muted-foreground shrink-0" />
                    <input
                        ref={inputRef}
                        type="text"
                        className="flex-1 bg-transparent border-none outline-none text-sm placeholder:text-muted-foreground/50"
                        placeholder="Search tables, databases, or run commands…"
                        value={query}
                        onChange={(e) => { setQuery(e.target.value); setSelectedIndex(0); }}
                        onKeyDown={handleKeyDown}
                    />
                    <kbd className="px-1.5 py-0.5 border rounded text-[10px] text-muted-foreground bg-muted/50 font-mono">ESC</kbd>
                </div>

                {/* Results List */}
                <div ref={scrollRef} className="max-h-[400px] overflow-y-auto p-1.5">
                    {filteredItems.length === 0 ? (
                        <div className="py-12 text-center text-muted-foreground flex flex-col items-center gap-2">
                            <X className="w-8 h-8 opacity-10" />
                            <p className="text-sm">No matches for "{query}"</p>
                        </div>
                    ) : (
                        groups.map((group) => (
                            <div key={group.label}>
                                <div className="px-2 py-1 text-[9px] font-bold uppercase tracking-widest text-muted-foreground/50 select-none">
                                    {group.label}
                                </div>
                                {group.items.map((item) => {
                                    const idx = globalIdx++;
                                    const isSelected = idx === selectedIndex;
                                    return (
                                        <button
                                            key={item.id}
                                            className={cn(
                                                "w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-all",
                                                isSelected
                                                    ? "bg-primary text-primary-foreground shadow-md"
                                                    : "hover:bg-accent group",
                                            )}
                                            onClick={() => handleSelect(item)}
                                        >
                                            <div className={cn(
                                                "w-7 h-7 rounded shrink-0 flex items-center justify-center",
                                                isSelected ? "bg-white/20" : "bg-muted group-hover:bg-muted-foreground/10",
                                            )}>
                                                {item.color && item.type === "server" ? (
                                                    <div className="w-3.5 h-3.5 rounded-full" style={{ backgroundColor: item.color }} />
                                                ) : ITEM_ICON[item.type]}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <div className="text-sm font-medium truncate">{item.name}</div>
                                                <p className={cn(
                                                    "text-[10px] truncate",
                                                    isSelected ? "text-primary-foreground/70" : "text-muted-foreground",
                                                )}>
                                                    {item.description}
                                                </p>
                                            </div>
                                            {item.shortcut && (
                                                <kbd className={cn(
                                                    "shrink-0 px-1.5 py-0.5 rounded border text-[9px] font-mono",
                                                    isSelected ? "bg-white/20 border-white/30 text-primary-foreground" : "bg-muted border-border text-muted-foreground",
                                                )}>
                                                    {item.shortcut}
                                                </kbd>
                                            )}
                                            {isSelected && !item.shortcut && (
                                                <span className="shrink-0 text-[10px] text-primary-foreground/70 font-medium">⏎</span>
                                            )}
                                        </button>
                                    );
                                })}
                            </div>
                        ))
                    )}
                </div>

                {/* Footer */}
                <div className="px-4 py-2 bg-muted/30 border-t flex items-center gap-4 text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">
                    <div className="flex items-center gap-1.5">
                        <kbd className="px-1 py-0.5 border rounded bg-muted/50 text-[11px]">↑↓</kbd>
                        Navigate
                    </div>
                    <div className="flex items-center gap-1.5">
                        <kbd className="px-1 py-0.5 border rounded bg-muted/50 text-[11px]">⏎</kbd>
                        Open
                    </div>
                    <div className="flex items-center gap-1.5 ml-auto">
                        <Plus className="w-3 h-3 opacity-50" />
                        <Sidebar className="w-3 h-3 opacity-50" />
                        <Settings className="w-3 h-3 opacity-50" />
                        <span className="opacity-50 text-[9px] normal-case tracking-normal">Try: "new query", "settings"</span>
                    </div>
                </div>
            </div>
        </div>
    );
};
