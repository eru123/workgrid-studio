import {
  useState,
  useRef,
  useCallback,
  useEffect,
  useMemo,
  createContext,
  useContext,
} from "react";
import { cn } from "@/lib/utils/cn";
import { ChevronRight, Loader2 } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TreeNodeDecoration {
  /** Badge shown as a pill on the right (count or short label) */
  badge?: number | string;
  /** Color of the badge pill */
  badgeColor?: "blue" | "red" | "green" | "yellow" | "muted";
  /** Small dot shown before the label (e.g. connection status) */
  statusDot?: "connected" | "error" | "warning" | "idle";
  /** Override the node label color */
  labelColor?: string;
}

export interface TreeNode {
  id: string;
  label: string;
  /** Lucide icon or any ReactNode */
  icon?: React.ReactNode;
  /** Static children. Provide either this or loadChildren, not both. */
  children?: TreeNode[];
  /** Async children loader — called on first expand */
  loadChildren?: () => Promise<TreeNode[]>;
  /** Whether this node can be expanded (shows chevron even if children not loaded yet) */
  expandable?: boolean;
  /** Visual decorations: badge, status dot, label color */
  decorations?: TreeNodeDecoration;
  /** Right-click context menu items */
  contextMenu?: ContextMenuItem[];
  /** Whether this node should be un-selectable (group/separator) */
  disabled?: boolean;
  /** Arbitrary metadata for the consumer */
  data?: unknown;
  /** Optional trailing content rendered after the badge (icons, buttons, badges) */
  suffix?: React.ReactNode;
}

export interface ContextMenuItem {
  label: string;
  icon?: React.ReactNode;
  onClick: (node: TreeNode) => void;
  danger?: boolean;
  separator?: boolean;
}

export interface TreeViewProps {
  nodes: TreeNode[];
  /** IDs of currently expanded nodes */
  expandedIds?: Set<string>;
  /** Controlled expanded state — if provided, toggleExpand must update it */
  onExpandedChange?: (ids: Set<string>) => void;
  /** ID of the currently selected node */
  selectedId?: string | null;
  onSelect?: (node: TreeNode) => void;
  /** Double-click / Enter on a node */
  onActivate?: (node: TreeNode) => void;
  className?: string;
  /** Indentation per level in pixels (default: 12) */
  indent?: number;
}

// ─── Tree Context ─────────────────────────────────────────────────────────────

interface TreeCtx {
  selectedId: string | null;
  expandedIds: Set<string>;
  loadingIds: Set<string>;
  cachedChildren: Map<string, TreeNode[]>;
  indent: number;
  onSelect?: (node: TreeNode) => void;
  onActivate?: (node: TreeNode) => void;
  toggleExpand: (node: TreeNode) => void;
  contextMenuState: ContextMenuState | null;
  setContextMenuState: (s: ContextMenuState | null) => void;
}

const TreeCtx = createContext<TreeCtx | null>(null);

function useTreeCtx(): TreeCtx {
  const ctx = useContext(TreeCtx);
  if (!ctx) throw new Error("useTreeCtx must be inside <TreeView>");
  return ctx;
}

// ─── Context Menu State ───────────────────────────────────────────────────────

interface ContextMenuState {
  node: TreeNode;
  x: number;
  y: number;
}

// ─── TreeView ─────────────────────────────────────────────────────────────────

export function TreeView({
  nodes,
  expandedIds: controlledExpandedIds,
  onExpandedChange,
  selectedId: controlledSelectedId,
  onSelect,
  onActivate,
  className,
  indent = 12,
}: TreeViewProps) {
  const [internalExpanded, setInternalExpanded] = useState<Set<string>>(new Set());
  const [internalSelected, setInternalSelected] = useState<string | null>(null);
  const [loadingIds, setLoadingIds] = useState<Set<string>>(new Set());
  const [cachedChildren, setCachedChildren] = useState<Map<string, TreeNode[]>>(new Map());
  const [contextMenuState, setContextMenuState] = useState<ContextMenuState | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const expandedIds = controlledExpandedIds ?? internalExpanded;
  const selectedId = controlledSelectedId !== undefined ? controlledSelectedId : internalSelected;

  const setExpanded = useCallback((ids: Set<string>) => {
    if (onExpandedChange) {
      onExpandedChange(ids);
    } else {
      setInternalExpanded(ids);
    }
  }, [onExpandedChange]);

  const toggleExpand = useCallback((node: TreeNode) => {
    const hasChildren = (node.children && node.children.length > 0) ||
      node.loadChildren ||
      node.expandable;
    if (!hasChildren) return;

    const next = new Set(expandedIds);
    if (next.has(node.id)) {
      next.delete(node.id);
    } else {
      next.add(node.id);
      // Load async children on first expand
      if (node.loadChildren && !cachedChildren.has(node.id)) {
        setLoadingIds((prev) => new Set(prev).add(node.id));
        node.loadChildren().then((children) => {
          setCachedChildren((prev) => new Map(prev).set(node.id, children));
          setLoadingIds((prev) => {
            const next = new Set(prev);
            next.delete(node.id);
            return next;
          });
        }).catch(() => {
          setLoadingIds((prev) => {
            const next = new Set(prev);
            next.delete(node.id);
            return next;
          });
        });
      }
    }
    setExpanded(next);
  }, [expandedIds, cachedChildren, setExpanded]);

  const handleSelect = useCallback((node: TreeNode) => {
    if (node.disabled) return;
    if (!controlledSelectedId) setInternalSelected(node.id);
    onSelect?.(node);
  }, [controlledSelectedId, onSelect]);

  // ── Keyboard navigation ───────────────────────────────────────────────────
  // Build a flat list of visible nodes for arrow key navigation
  const flatNodes = useMemo(() => flattenVisible(nodes, expandedIds, cachedChildren), [nodes, expandedIds, cachedChildren]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    const currentIdx = flatNodes.findIndex((n) => n.id === selectedId);

    if (e.key === "ArrowDown") {
      e.preventDefault();
      const next = flatNodes[currentIdx + 1];
      if (next) handleSelect(next);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const prev = flatNodes[currentIdx - 1];
      if (prev) handleSelect(prev);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      const node = flatNodes[currentIdx];
      if (node) toggleExpand(node);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      const node = flatNodes[currentIdx];
      if (node && expandedIds.has(node.id)) {
        toggleExpand(node);
      }
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      const node = flatNodes[currentIdx];
      if (node) {
        if (e.key === " ") toggleExpand(node);
        else onActivate?.(node);
      }
    }
  }, [flatNodes, selectedId, handleSelect, toggleExpand, expandedIds, onActivate]);

  // Dismiss context menu on outside click
  useEffect(() => {
    if (!contextMenuState) return;
    const dismiss = () => setContextMenuState(null);
    window.addEventListener("mousedown", dismiss);
    return () => window.removeEventListener("mousedown", dismiss);
  }, [contextMenuState]);

  return (
    <TreeCtx.Provider value={{
      selectedId: selectedId ?? null,
      expandedIds,
      loadingIds,
      cachedChildren,
      indent,
      onSelect: handleSelect,
      onActivate,
      toggleExpand,
      contextMenuState,
      setContextMenuState,
    }}>
      <div
        ref={containerRef}
        role="tree"
        tabIndex={0}
        onKeyDown={handleKeyDown}
        className={cn("outline-none select-none text-xs", className)}
      >
        {nodes.map((node) => (
          <TreeNodeRow key={node.id} node={node} depth={0} />
        ))}
      </div>

      {/* Context menu */}
      {contextMenuState && (
        <TreeContextMenu
          node={contextMenuState.node}
          x={contextMenuState.x}
          y={contextMenuState.y}
          onDismiss={() => setContextMenuState(null)}
        />
      )}
    </TreeCtx.Provider>
  );
}

// ─── TreeNodeRow ──────────────────────────────────────────────────────────────

function TreeNodeRow({ node, depth }: { node: TreeNode; depth: number }) {
  const {
    selectedId,
    expandedIds,
    loadingIds,
    cachedChildren,
    indent,
    onSelect,
    onActivate,
    toggleExpand,
    setContextMenuState,
  } = useTreeCtx();

  const isSelected = node.id === selectedId;
  const isExpanded = expandedIds.has(node.id);
  const isLoading = loadingIds.has(node.id);

  const resolvedChildren = node.children ?? cachedChildren.get(node.id);
  const hasChildren = !!(resolvedChildren?.length || node.loadChildren || node.expandable);

  const handleClick = () => {
    onSelect?.(node);
    if (hasChildren) toggleExpand(node);
  };

  const handleDoubleClick = () => {
    onActivate?.(node);
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    if (!node.contextMenu?.length) return;
    e.preventDefault();
    e.stopPropagation();
    setContextMenuState({ node, x: e.clientX, y: e.clientY });
  };

  const { decorations } = node;

  return (
    <>
      <div
        role="treeitem"
        aria-selected={isSelected}
        aria-expanded={hasChildren ? isExpanded : undefined}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        onContextMenu={handleContextMenu}
        style={{ paddingLeft: depth * indent + 4 }}
        className={cn(
          "group flex items-center gap-1 h-[22px] pr-2 rounded cursor-pointer transition-colors",
          isSelected
            ? "bg-[var(--color-list-active-selection,var(--color-primary))] text-[var(--color-list-active-selection-foreground,var(--color-primary-foreground))]"
            : "hover:bg-[var(--color-list-hover,var(--color-accent))] text-[var(--color-foreground)]",
          node.disabled && "opacity-50 cursor-default",
        )}
      >
        {/* Chevron / spinner */}
        <span className="shrink-0 w-4 h-4 flex items-center justify-center">
          {isLoading ? (
            <Loader2 className="w-3 h-3 animate-spin opacity-60" />
          ) : hasChildren ? (
            <ChevronRight
              className={cn(
                "w-3 h-3 transition-transform opacity-60",
                isExpanded && "rotate-90",
              )}
            />
          ) : null}
        </span>

        {/* Status dot */}
        {decorations?.statusDot && (
          <span className={cn(
            "shrink-0 w-1.5 h-1.5 rounded-full",
            decorations.statusDot === "connected" && "bg-green-500",
            decorations.statusDot === "error"     && "bg-red-500",
            decorations.statusDot === "warning"   && "bg-yellow-500",
            decorations.statusDot === "idle"      && "bg-muted-foreground",
          )} />
        )}

        {/* Icon */}
        {node.icon && (
          <span className="shrink-0 flex items-center opacity-80">{node.icon}</span>
        )}

        {/* Label */}
        <span
          className="flex-1 truncate leading-none"
          style={decorations?.labelColor ? { color: decorations.labelColor } : undefined}
        >
          {node.label}
        </span>

        {/* Badge */}
        {decorations?.badge !== undefined && (typeof decorations.badge === "number" ? decorations.badge > 0 : !!decorations.badge) && (
          <span className={cn(
            "shrink-0 text-[10px] font-medium px-1 rounded-full min-w-[16px] text-center leading-4",
            decorations.badgeColor === "red"    ? "bg-red-500 text-white"    :
            decorations.badgeColor === "green"  ? "bg-green-600 text-white"  :
            decorations.badgeColor === "yellow" ? "bg-yellow-500 text-black" :
            decorations.badgeColor === "muted"  ? "bg-muted text-muted-foreground" :
            "bg-primary text-primary-foreground",
          )}>
            {typeof decorations.badge === "number"
              ? (decorations.badge > 99 ? "99+" : decorations.badge)
              : decorations.badge}
          </span>
        )}

        {/* Suffix */}
        {node.suffix && (
          <span className="shrink-0 flex items-center">{node.suffix}</span>
        )}
      </div>

      {/* Children */}
      {isExpanded && resolvedChildren && resolvedChildren.map((child) => (
        <TreeNodeRow key={child.id} node={child} depth={depth + 1} />
      ))}
    </>
  );
}

// ─── Context Menu ─────────────────────────────────────────────────────────────

function TreeContextMenu({
  node,
  x,
  y,
  onDismiss,
}: {
  node: TreeNode;
  x: number;
  y: number;
  onDismiss: () => void;
}) {
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

  if (!node.contextMenu?.length) return null;

  return (
    <div
      ref={menuRef}
      style={{ position: "fixed", left: pos.x, top: pos.y, zIndex: 200 }}
      className="min-w-[160px] rounded-md border border-border bg-popover text-popover-foreground shadow-lg py-1 text-xs"
      onMouseDown={(e) => e.stopPropagation()}
    >
      {node.contextMenu.map((item, i) =>
        item.separator ? (
          <div key={i} className="my-1 border-t border-border" />
        ) : (
          <button
            key={i}
            onClick={() => { item.onClick(node); onDismiss(); }}
            className={cn(
              "w-full flex items-center gap-2 px-3 py-1.5 hover:bg-accent transition-colors text-left",
              item.danger && "text-destructive",
            )}
          >
            {item.icon && <span className="shrink-0">{item.icon}</span>}
            {item.label}
          </button>
        ),
      )}
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function flattenVisible(
  nodes: TreeNode[],
  expandedIds: Set<string>,
  cachedChildren: Map<string, TreeNode[]>,
): TreeNode[] {
  const result: TreeNode[] = [];
  function walk(list: TreeNode[]) {
    for (const node of list) {
      result.push(node);
      if (expandedIds.has(node.id)) {
        const children = node.children ?? cachedChildren.get(node.id) ?? [];
        walk(children);
      }
    }
  }
  walk(nodes);
  return result;
}
