import { useRef, useCallback } from "react";
import { cn } from "@/lib/utils/cn";

interface SashProps {
    // Matches the split direction of the panels:
    // - "horizontal": panels are side-by-side, drag on the x-axis
    // - "vertical": panels are stacked, drag on the y-axis
    direction?: "horizontal" | "vertical";
    onDrag?: (delta: number) => void;
    className?: string;
}

export function Sash({
    direction = "vertical",
    onDrag,
    className,
}: SashProps) {
    // Store callback in a ref so the pointer handlers always see the latest
    // version without needing to re-register event listeners.
    const onDragRef = useRef(onDrag);
    onDragRef.current = onDrag;

    const isDragging = useRef(false);

    const handlePointerDown = useCallback(
        (e: React.PointerEvent<HTMLDivElement>) => {
            e.preventDefault();
            e.stopPropagation();
            const target = e.currentTarget;
            target.setPointerCapture(e.pointerId);
            isDragging.current = true;

            let lastX = e.clientX;
            let lastY = e.clientY;

            const onPointerMove = (me: PointerEvent) => {
                if (!isDragging.current) return;

                const dx = me.clientX - lastX;
                const dy = me.clientY - lastY;
                lastX = me.clientX;
                lastY = me.clientY;

                // Call the latest onDrag from ref (avoids stale closure)
                // If the panels are stacked vertically (direction="vertical"), the sash is a horizontal line -> drag vertical (dy)
                if (direction === "vertical") {
                    onDragRef.current?.(dy);
                } else {
                    onDragRef.current?.(dx);
                }
            };

            const onPointerUp = (ue: PointerEvent) => {
                isDragging.current = false;
                if (target.hasPointerCapture(ue.pointerId)) {
                    target.releasePointerCapture(ue.pointerId);
                }
                window.removeEventListener("pointermove", onPointerMove);
                window.removeEventListener("pointerup", onPointerUp);
                window.removeEventListener("pointercancel", onPointerUp);
            };

            window.addEventListener("pointermove", onPointerMove);
            window.addEventListener("pointerup", onPointerUp);
            window.addEventListener("pointercancel", onPointerUp);
        },
        [direction]
    );

    return (
        <div
            onPointerDown={handlePointerDown}
            className={cn(
                "z-50 bg-transparent transition-colors",
                "hover:bg-[#0078d4]/40 active:bg-[#0078d4]/60",
                className
            )}
        />
    );
}
