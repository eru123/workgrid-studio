import { useRef, useState, useCallback, useEffect } from "react";
import { cn } from "@/lib/utils/cn";
import { X, Pin, PinOff, ChevronLeft, ChevronRight } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Tab {
  id: string;
  label: string;
  /** Lucide icon component or any ReactNode */
  icon?: React.ReactNode;
  /** Whether the tab has unsaved changes */
  dirty?: boolean;
  /** Pinned tabs cannot be closed and always appear first */
  pinned?: boolean;
  /** Optional tooltip for the tab label */
  title?: string;
}

export interface TabContextMenuItem {
  label: string;
  onClick: (tabId: string) => void;
  /** Render a separator line before this item */
  separator?: boolean;
}

export interface TabContainerProps {
  tabs: Tab[];
  activeTabId: string | null;
  onTabClick: (id: string) => void;
  onTabClose?: (id: string) => void;
  onTabPin?: (id: string, pinned: boolean) => void;
  /** Called with [draggedId, targetId] when a tab is dropped onto another */
  onTabReorder?: (draggedId: string, targetId: string) => void;
  /** Called when a tab drag begins — use to set cross-pane drag payload */
  onTabDragStart?: (tabId: string) => void;
  /** Called when a tab drag ends (drop or cancel) */
  onTabDragEnd?: () => void;
  /** Called on double-click of the tab label area */
  onTabDoubleClick?: (tabId: string) => void;
  /** Called on middle-click (aux button 1) of the tab */
  onTabAuxClick?: (tabId: string) => void;
  /** Extra items appended to the context menu after the default Pin item */
  contextMenuItems?: TabContextMenuItem[];
  /**
   * Custom label renderer. Return a ReactNode to replace the default label
   * (e.g. an inline rename input). Return null/undefined to use the default.
   */
  renderLabel?: (tab: Tab) => React.ReactNode;
  /** Extra className for the tab bar root element */
  className?: string;
  /** Render an element in the right side of the tab bar (e.g. split button) */
  actions?: React.ReactNode;
}

// ─── Context Menu ─────────────────────────────────────────────────────────────

interface ContextMenuState {
  tabId: string;
  x: number;
  y: number;
}

// ─── TabContainer ─────────────────────────────────────────────────────────────

export function TabContainer({
  tabs,
  activeTabId,
  onTabClick,
  onTabClose,
  onTabPin,
  onTabReorder,
  onTabDragStart,
  onTabDragEnd,
  onTabDoubleClick,
  onTabAuxClick,
  contextMenuItems,
  renderLabel,
  className,
  actions,
}: TabContainerProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  // ── Scroll overflow detection ─────────────────────────────────────────────
  const checkScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 0);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    checkScroll();
    const ro = new ResizeObserver(checkScroll);
    ro.observe(el);
    el.addEventListener("scroll", checkScroll, { passive: true });
    return () => {
      ro.disconnect();
      el.removeEventListener("scroll", checkScroll);
    };
  }, [checkScroll, tabs]);

  // Scroll active tab into view when it changes
  useEffect(() => {
    if (!activeTabId || !scrollRef.current) return;
    const activeEl = scrollRef.current.querySelector<HTMLElement>(`[data-tab-id="${activeTabId}"]`);
    activeEl?.scrollIntoView({ inline: "nearest", block: "nearest" });
  }, [activeTabId]);

  // ── Scroll buttons ────────────────────────────────────────────────────────
  const scrollBy = (dir: "left" | "right") => {
    scrollRef.current?.scrollBy({ left: dir === "left" ? -120 : 120, behavior: "smooth" });
  };

  // ── Drag-to-reorder ───────────────────────────────────────────────────────
  const handleDragStart = (e: React.DragEvent, id: string) => {
    e.dataTransfer.setData("wgs/tab-id", id);
    e.dataTransfer.effectAllowed = "move";
    onTabDragStart?.(id);
  };
  const handleDragOver = (e: React.DragEvent, id: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverId(id);
  };
  const handleDrop = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    const draggedId = e.dataTransfer.getData("wgs/tab-id");
    if (draggedId && draggedId !== targetId) {
      onTabReorder?.(draggedId, targetId);
    }
    setDragOverId(null);
  };
  const handleDragLeave = () => setDragOverId(null);
  const handleDragEnd = () => {
    setDragOverId(null);
    onTabDragEnd?.();
  };

  // ── Context menu ──────────────────────────────────────────────────────────
  const handleContextMenu = (e: React.MouseEvent, tabId: string) => {
    e.preventDefault();
    setContextMenu({ tabId, x: e.clientX, y: e.clientY });
  };

  useEffect(() => {
    if (!contextMenu) return;
    const dismiss = () => setContextMenu(null);
    window.addEventListener("mousedown", dismiss);
    window.addEventListener("keydown", dismiss);
    return () => {
      window.removeEventListener("mousedown", dismiss);
      window.removeEventListener("keydown", dismiss);
    };
  }, [contextMenu]);

  const ctxTab = contextMenu ? tabs.find((t) => t.id === contextMenu.tabId) : null;

  return (
    <div className={cn("flex items-stretch h-[35px] bg-[var(--color-tab-bar,var(--color-secondary))] border-b border-[var(--color-tab-bar-border,var(--color-border))] select-none", className)}>
      {/* Left scroll chevron */}
      {canScrollLeft && (
        <button
          onClick={() => scrollBy("left")}
          className="shrink-0 flex items-center justify-center w-6 text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
          aria-label="Scroll tabs left"
        >
          <ChevronLeft className="w-3 h-3" />
        </button>
      )}

      {/* Tab strip */}
      <div
        ref={scrollRef}
        className="flex-1 flex items-stretch overflow-x-auto scrollbar-none"
        style={{ scrollbarWidth: "none" }}
      >
        {tabs.map((tab) => (
          <TabItem
            key={tab.id}
            tab={tab}
            isActive={tab.id === activeTabId}
            isDragOver={tab.id === dragOverId}
            onClose={onTabClose}
            onClick={() => onTabClick(tab.id)}
            onContextMenu={(e) => handleContextMenu(e, tab.id)}
            onDragStart={(e) => handleDragStart(e, tab.id)}
            onDragOver={(e) => handleDragOver(e, tab.id)}
            onDrop={(e) => handleDrop(e, tab.id)}
            onDragLeave={handleDragLeave}
            onDragEnd={handleDragEnd}
            onDoubleClick={onTabDoubleClick ? () => onTabDoubleClick(tab.id) : undefined}
            onAuxClick={onTabAuxClick ? () => onTabAuxClick(tab.id) : undefined}
            renderLabel={renderLabel}
          />
        ))}
      </div>

      {/* Right scroll chevron */}
      {canScrollRight && (
        <button
          onClick={() => scrollBy("right")}
          className="shrink-0 flex items-center justify-center w-6 text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
          aria-label="Scroll tabs right"
        >
          <ChevronRight className="w-3 h-3" />
        </button>
      )}

      {/* Right-side actions (e.g. split pane button) */}
      {actions && (
        <div className="shrink-0 flex items-center px-1 border-l border-border">
          {actions}
        </div>
      )}

      {/* Context menu */}
      {contextMenu && ctxTab && (
        <TabContextMenu
          tab={ctxTab}
          x={contextMenu.x}
          y={contextMenu.y}
          extraItems={contextMenuItems}
          onClose={() => { onTabClose?.(ctxTab.id); setContextMenu(null); }}
          onPin={() => { onTabPin?.(ctxTab.id, !ctxTab.pinned); setContextMenu(null); }}
          onExtraItem={(idx) => { contextMenuItems?.[idx].onClick(ctxTab.id); setContextMenu(null); }}
          onDismiss={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}

// ─── Individual Tab Item ──────────────────────────────────────────────────────

function TabItem({
  tab,
  isActive,
  isDragOver,
  onClose,
  onClick,
  onContextMenu,
  onDragStart,
  onDragOver,
  onDrop,
  onDragLeave,
  onDragEnd,
  onDoubleClick,
  onAuxClick,
  renderLabel,
}: {
  tab: Tab;
  isActive: boolean;
  isDragOver: boolean;
  onClose?: (id: string) => void;
  onClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  onDragLeave: () => void;
  onDragEnd: () => void;
  onDoubleClick?: () => void;
  onAuxClick?: () => void;
  renderLabel?: (tab: Tab) => React.ReactNode;
}) {
  const customLabel = renderLabel?.(tab);

  return (
    <div
      data-tab-id={tab.id}
      role="tab"
      aria-selected={isActive}
      draggable
      onClick={onClick}
      onContextMenu={onContextMenu}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragLeave={onDragLeave}
      onDragEnd={onDragEnd}
      onAuxClick={onAuxClick ? (e) => { if (e.button === 1) { e.preventDefault(); onAuxClick(); } } : undefined}
      onMouseDown={(e) => { if (e.button === 1) e.preventDefault(); }}
      title={tab.title ?? tab.label}
      className={cn(
        "relative flex items-center gap-1.5 px-3 h-full text-xs cursor-pointer shrink-0 max-w-[180px] min-w-0 group transition-colors",
        "border-r border-[var(--color-tab-border,var(--color-border))]",
        isActive
          ? "bg-[var(--color-tab-active,var(--color-background))] text-[var(--color-tab-active-foreground,var(--color-foreground))]"
          : "bg-[var(--color-tab-inactive,var(--color-muted))] text-[var(--color-tab-inactive-foreground,var(--color-muted-foreground))] hover:bg-[var(--color-tab-hover,var(--color-accent))]",
        isDragOver && "ring-1 ring-inset ring-primary/50",
      )}
    >
      {/* Active indicator bar */}
      {isActive && (
        <span className="absolute top-0 inset-x-0 h-[2px] bg-[var(--color-tab-active-border,var(--color-primary))]" />
      )}

      {/* Icon */}
      {tab.icon && (
        <span className="shrink-0 flex items-center opacity-70">{tab.icon}</span>
      )}

      {/* Label — custom or default */}
      {customLabel != null ? (
        customLabel
      ) : (
        <span
          className="truncate leading-none"
          onDoubleClick={onDoubleClick ? (e) => { e.stopPropagation(); onDoubleClick(); } : undefined}
        >
          {tab.dirty ? `${tab.label} ●` : tab.label}
        </span>
      )}

      {/* Pin indicator */}
      {tab.pinned && (
        <Pin className="shrink-0 w-2.5 h-2.5 opacity-50" />
      )}

      {/* Close button — hidden for pinned, shown on hover for inactive */}
      {!tab.pinned && onClose && (
        <button
          onClick={(e) => { e.stopPropagation(); onClose(tab.id); }}
          className={cn(
            "shrink-0 rounded p-0.5 transition-opacity",
            isActive
              ? "opacity-60 hover:opacity-100 hover:bg-accent/50"
              : "opacity-0 group-hover:opacity-60 hover:!opacity-100 hover:bg-accent/50",
          )}
          aria-label={`Close ${tab.label}`}
        >
          <X className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}

// ─── Context Menu ─────────────────────────────────────────────────────────────

function TabContextMenu({
  tab,
  x,
  y,
  extraItems,
  onClose,
  onPin,
  onExtraItem,
  onDismiss,
}: {
  tab: Tab;
  x: number;
  y: number;
  extraItems?: TabContextMenuItem[];
  onClose: () => void;
  onPin: () => void;
  onExtraItem: (idx: number) => void;
  onDismiss: () => void;
}) {
  // Clamp menu within viewport
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });

  useEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setPos({
      x: Math.min(x, window.innerWidth  - rect.width  - 8),
      y: Math.min(y, window.innerHeight - rect.height - 8),
    });
  }, [x, y]);

  return (
    <div
      ref={menuRef}
      style={{ position: "fixed", left: pos.x, top: pos.y, zIndex: 200 }}
      className="min-w-[160px] rounded-md border border-border bg-popover text-popover-foreground shadow-lg py-1 text-xs"
      onMouseDown={(e) => e.stopPropagation()}
    >
      {!tab.pinned && (
        <MenuItem onClick={onClose} danger>
          <X className="w-3 h-3" /> Close Tab
        </MenuItem>
      )}
      <MenuItem onClick={onPin}>
        {tab.pinned
          ? <><PinOff className="w-3 h-3" /> Unpin Tab</>
          : <><Pin className="w-3 h-3" /> Pin Tab</>
        }
      </MenuItem>
      {extraItems && extraItems.length > 0 && (
        <>
          {extraItems.map((item, idx) => (
            <div key={idx}>
              {item.separator && <div className="my-1 border-t border-border" />}
              <MenuItem onClick={() => onExtraItem(idx)}>
                {item.label}
              </MenuItem>
            </div>
          ))}
        </>
      )}
      <div className="my-1 border-t border-border" />
      <MenuItem onClick={onDismiss}>
        Dismiss
      </MenuItem>
    </div>
  );
}

function MenuItem({
  children,
  onClick,
  danger,
}: {
  children: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-2 px-3 py-1.5 hover:bg-accent transition-colors text-left",
        danger && "text-destructive hover:text-destructive",
      )}
    >
      {children}
    </button>
  );
}
