import React, { useState, useRef, useMemo, useEffect } from "react";
import { cn } from "@/lib/utils/cn";

export interface TreeNode {
    id: string;
    name: string;
    isFolder: boolean;
    isOpen?: boolean;
    children?: TreeNode[];
    depth?: number; // assigned internally
}

interface FlattenedNode extends TreeNode {
    depth: number;
}

interface TreeProps {
    data: TreeNode[];
    onToggle: (id: string, isOpen: boolean) => void;
    onSelect: (node: TreeNode) => void;
    selectedId?: string;
    rowHeight?: number;
    className?: string;
}

function flattenTree(nodes: TreeNode[], depth = 0): FlattenedNode[] {
    let result: FlattenedNode[] = [];
    for (const node of nodes) {
        result.push({ ...node, depth });
        if (node.isFolder && node.isOpen && node.children) {
            result = result.concat(flattenTree(node.children, depth + 1));
        }
    }
    return result;
}

export function Tree({
    data,
    onToggle,
    onSelect,
    selectedId,
    rowHeight = 24,
    className,
}: TreeProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [scrollTop, setScrollTop] = useState(0);
    const [containerHeight, setContainerHeight] = useState(0);

    const flatData = useMemo(() => flattenTree(data), [data]);
    const totalHeight = flatData.length * rowHeight;

    // Track container height
    useEffect(() => {
        if (!containerRef.current) return;
        const observer = new ResizeObserver((entries) => {
            setContainerHeight(entries[0].contentRect.height);
        });
        observer.observe(containerRef.current);
        return () => observer.disconnect();
    }, []);

    const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
        setScrollTop(e.currentTarget.scrollTop);
    };

    const startIndex = Math.max(0, Math.floor(scrollTop / rowHeight) - 5);
    const endIndex = Math.min(
        flatData.length - 1,
        Math.ceil((scrollTop + containerHeight) / rowHeight) + 5
    );

    const visibleNodes = flatData.slice(startIndex, endIndex + 1);

    return (
        <div
            ref={containerRef}
            className={cn("w-full h-full overflow-y-auto outline-none", className)}
            onScroll={handleScroll}
            tabIndex={0}
        >
            <div style={{ height: totalHeight, position: "relative" }}>
                {visibleNodes.map((node, i) => {
                    const absoluteIndex = startIndex + i;
                    return (
                        <div
                            key={node.id}
                            className={cn(
                                "absolute left-0 right-0 flex items-center px-2 cursor-pointer text-sm hover:bg-accent hover:text-accent-foreground select-none",
                                selectedId === node.id && "bg-accent text-accent-foreground font-medium"
                            )}
                            style={{
                                top: absoluteIndex * rowHeight,
                                height: rowHeight,
                                paddingLeft: `${node.depth * 12 + 8}px`,
                            }}
                            onClick={() => {
                                if (node.isFolder) {
                                    onToggle(node.id, !node.isOpen);
                                } else {
                                    onSelect(node);
                                }
                            }}
                        >
                            {node.isFolder && (
                                <span className="mr-1 w-4 h-4 flex items-center justify-center opacity-70">
                                    {node.isOpen ? "▼" : "▶"}
                                </span>
                            )}
                            {!node.isFolder && <span className="mr-1 w-4 h-4 inline-block" />}
                            <span className="truncate">{node.name}</span>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
