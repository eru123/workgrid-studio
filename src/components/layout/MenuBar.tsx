import { useState, useRef, useEffect, useCallback } from "react";
import { useLayoutStore } from "@/state/layoutStore";
import { useAppStore } from "@/state/appStore";
import { cn } from "@/lib/utils/cn";
import { openUrl } from "@tauri-apps/plugin-opener";
import { exit } from "@tauri-apps/plugin-process";

type MenuAction =
  | { type: "action"; label: string; shortcut?: string; action: () => void; disabled?: boolean }
  | { type: "separator" };

interface MenuDef {
  label: string;
  items: MenuAction[];
}

interface MenuBarProps {
  onShowShortcuts: () => void;
}

function dispatchKey(key: string, modifiers: { ctrl?: boolean; shift?: boolean } = {}) {
  const target = document.activeElement ?? document.body;
  target.dispatchEvent(
    new KeyboardEvent("keydown", {
      key,
      ctrlKey: modifiers.ctrl ?? false,
      shiftKey: modifiers.shift ?? false,
      bubbles: true,
      cancelable: true,
    }),
  );
}

function MenuDropdown({
  items,
  onClose,
  onPrev,
  onNext,
}: {
  items: MenuAction[];
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [focusIdx, setFocusIdx] = useState(-1);
  const actionItems = items.filter((i): i is Extract<MenuAction, { type: "action" }> => i.type === "action");

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") { onClose(); return; }
      if (e.key === "ArrowLeft") { onPrev(); return; }
      if (e.key === "ArrowRight") { onNext(); return; }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setFocusIdx((i) => Math.min(i + 1, actionItems.length - 1));
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setFocusIdx((i) => Math.max(i - 1, 0));
      }
      if (e.key === "Enter" && focusIdx >= 0) {
        actionItems[focusIdx]?.action();
        onClose();
      }
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose, onPrev, onNext, actionItems, focusIdx]);

  useEffect(() => {
    if (focusIdx >= 0) {
      const btns = ref.current?.querySelectorAll<HTMLButtonElement>("button:not([disabled])");
      btns?.[focusIdx]?.focus();
    }
  }, [focusIdx]);

  let actionIdx = -1;

  return (
    <div
      ref={ref}
      className="absolute top-full left-0 z-[200] min-w-[220px] bg-popover border border-border rounded shadow-xl py-1 mt-0.5"
    >
      {items.map((item, i) => {
        if (item.type === "separator") {
          return <div key={i} className="my-1 h-px bg-border mx-1" />;
        }
        actionIdx++;
        const myIdx = actionIdx;
        return (
          <button
            key={i}
            onClick={() => {
              item.action();
              onClose();
            }}
            onMouseEnter={() => setFocusIdx(myIdx)}
            disabled={item.disabled}
            className={cn(
              "w-full flex items-center justify-between px-3 py-1.5 text-sm transition-colors",
              myIdx === focusIdx
                ? "bg-accent text-foreground"
                : "text-foreground hover:bg-accent/70",
              item.disabled && "opacity-40 pointer-events-none",
            )}
          >
            <span>{item.label}</span>
            {item.shortcut && (
              <span className="text-muted-foreground text-xs ml-8 shrink-0">{item.shortcut}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function MenuBar({ onShowShortcuts }: MenuBarProps) {
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const barRef = useRef<HTMLDivElement>(null);

  const openTab = useLayoutStore((s) => s.openTab);
  const toggleSidebar = useLayoutStore((s) => s.toggleSidebar);
  const togglePanel = useLayoutStore((s) => s.togglePanel);
  const toggleSecondarySidebar = useLayoutStore((s) => s.toggleSecondarySidebar);
  const setActiveView = useLayoutStore((s) => s.setActiveView);
  const setCommandPaletteOpen = useAppStore((s) => s.setCommandPaletteOpen);

  const menus: MenuDef[] = [
    {
      label: "File",
      items: [
        {
          type: "action",
          label: "New Query",
          shortcut: "Ctrl+N",
          action: () => openTab({ title: "New Query", type: "sql", meta: {} }),
        },
        { type: "separator" },
        {
          type: "action",
          label: "Settings",
          shortcut: "Ctrl+,",
          action: () => openTab({ title: "Settings", type: "settings", meta: {} }),
        },
        { type: "separator" },
        {
          type: "action",
          label: "Exit",
          action: () => void exit(0),
        },
      ],
    },
    {
      label: "Edit",
      items: [
        {
          type: "action",
          label: "Undo",
          shortcut: "Ctrl+Z",
          action: () => dispatchKey("z", { ctrl: true }),
        },
        {
          type: "action",
          label: "Redo",
          shortcut: "Ctrl+Y",
          action: () => dispatchKey("y", { ctrl: true }),
        },
        { type: "separator" },
        {
          type: "action",
          label: "Find",
          shortcut: "Ctrl+F",
          action: () => dispatchKey("f", { ctrl: true }),
        },
        { type: "separator" },
        {
          type: "action",
          label: "Select All",
          shortcut: "Ctrl+A",
          action: () => dispatchKey("a", { ctrl: true }),
        },
      ],
    },
    {
      label: "View",
      items: [
        {
          type: "action",
          label: "Explorer",
          action: () => { setActiveView("explorer"); },
        },
        {
          type: "action",
          label: "Servers",
          action: () => { setActiveView("servers"); },
        },
        {
          type: "action",
          label: "AI Models",
          action: () => { setActiveView("models"); },
        },
        {
          type: "action",
          label: "Tasks",
          action: () => { setActiveView("tasks"); },
        },
        { type: "separator" },
        {
          type: "action",
          label: "Toggle Sidebar",
          shortcut: "Ctrl+B",
          action: toggleSidebar,
        },
        {
          type: "action",
          label: "Toggle Panel",
          shortcut: "Ctrl+`",
          action: togglePanel,
        },
        {
          type: "action",
          label: "Toggle AI Chat",
          action: toggleSecondarySidebar,
        },
        { type: "separator" },
        {
          type: "action",
          label: "Command Palette",
          shortcut: "Ctrl+Shift+P",
          action: () => setCommandPaletteOpen(true),
        },
      ],
    },
    {
      label: "Terminal",
      items: [
        {
          type: "action",
          label: "New Query",
          shortcut: "Ctrl+N",
          action: () => openTab({ title: "New Query", type: "sql", meta: {} }),
        },
        { type: "separator" },
        {
          type: "action",
          label: "Clear Output",
          action: () => {
            useAppStore.getState().clearOutputEntries();
          },
        },
      ],
    },
    {
      label: "Help",
      items: [
        {
          type: "action",
          label: "Keyboard Shortcuts",
          shortcut: "Ctrl+K Ctrl+S",
          action: onShowShortcuts,
        },
        { type: "separator" },
        {
          type: "action",
          label: "Support WorkGrid Studio",
          action: () => void openUrl("https://paypal.me/ja1030"),
        },
        { type: "separator" },
        {
          type: "action",
          label: "About WorkGrid Studio",
          action: () => openTab({ title: "Settings", type: "settings", meta: {} }),
        },
      ],
    },
  ];

  const menuLabels = menus.map((m) => m.label);

  const closeMenu = useCallback(() => setOpenMenu(null), []);

  const goToPrev = useCallback(() => {
    setOpenMenu((cur) => {
      if (!cur) return null;
      const idx = menuLabels.indexOf(cur);
      return menuLabels[(idx - 1 + menuLabels.length) % menuLabels.length];
    });
  }, [menuLabels]);

  const goToNext = useCallback(() => {
    setOpenMenu((cur) => {
      if (!cur) return null;
      const idx = menuLabels.indexOf(cur);
      return menuLabels[(idx + 1) % menuLabels.length];
    });
  }, [menuLabels]);

  // Close when clicking outside the entire menu bar
  useEffect(() => {
    if (!openMenu) return;
    function handleMouseDown(e: MouseEvent) {
      if (barRef.current && !barRef.current.contains(e.target as Node)) {
        setOpenMenu(null);
      }
    }
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [openMenu]);

  // Alt key toggles menu bar focus (Windows convention)
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && openMenu) {
        setOpenMenu(null);
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [openMenu]);

  return (
    <div
      ref={barRef}
      className="h-8 flex items-center bg-muted/30 border-b border-border shrink-0 select-none px-1"
      role="menubar"
      aria-label="Application menu"
    >
      {menus.map((menu) => {
        const isOpen = openMenu === menu.label;
        return (
          <div key={menu.label} className="relative">
            <button
              role="menuitem"
              aria-haspopup="true"
              aria-expanded={isOpen}
              onClick={() => setOpenMenu(isOpen ? null : menu.label)}
              onMouseEnter={() => {
                if (openMenu !== null) setOpenMenu(menu.label);
              }}
              className={cn(
                "px-2.5 h-6 text-sm rounded transition-colors",
                isOpen
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent/50",
              )}
            >
              {menu.label}
            </button>
            {isOpen && (
              <MenuDropdown
                items={menu.items}
                onClose={closeMenu}
                onPrev={goToPrev}
                onNext={goToNext}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
