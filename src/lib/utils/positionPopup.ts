// ─── Viewport-aware popup positioning ────────────────────────────────────────
//
// Pure utility — no DOM side-effects. Given the anchor rect, popup dimensions,
// and viewport dimensions, returns a {top, left} that keeps the popup on-screen
// by flipping above/below and left/right when needed.

export interface PopupPosition {
  top: number;
  left: number;
}

export interface PopupSize {
  w: number;
  h: number;
}

export interface Viewport {
  w: number;
  h: number;
}

/**
 * Compute the best {top, left} for a popup anchored to `anchor`.
 *
 * Default placement: below-and-right of the cursor.
 * Flips above  when there is not enough space below.
 * Flips left   when there is not enough space to the right.
 *
 * @param anchor      - DOMRect of the anchor element (or mouse point)
 * @param popupSize   - The popup's width and height (measure before calling)
 * @param viewport    - Usually { w: window.innerWidth, h: window.innerHeight }
 * @param gap         - Extra gap between anchor and popup (default 4px)
 */
export function positionPopup(
  anchor: DOMRect,
  popupSize: PopupSize,
  viewport: Viewport,
  gap = 4,
): PopupPosition {
  const EDGE_MARGIN = 8;

  // ── Horizontal ────────────────────────────────────────────────────────────
  // Prefer right-aligned to anchor.left; flip if it would clip the right edge.
  let left = anchor.left;
  if (left + popupSize.w + EDGE_MARGIN > viewport.w) {
    left = anchor.right - popupSize.w;
  }
  left = Math.max(EDGE_MARGIN, left);

  // ── Vertical ──────────────────────────────────────────────────────────────
  // Prefer below anchor.bottom; flip above if not enough space.
  let top = anchor.bottom + gap;
  if (top + popupSize.h + EDGE_MARGIN > viewport.h) {
    top = anchor.top - popupSize.h - gap;
  }
  top = Math.max(EDGE_MARGIN, top);

  return { top, left };
}

/**
 * Convenience overload for context menus triggered by a mouse event.
 * Uses the event coordinates as a zero-size anchor point.
 */
export function positionContextMenu(
  mouseX: number,
  mouseY: number,
  popupSize: PopupSize,
  viewport: Viewport = { w: window.innerWidth, h: window.innerHeight },
): PopupPosition {
  const pointRect = {
    left: mouseX,
    right: mouseX,
    top: mouseY,
    bottom: mouseY,
    width: 0,
    height: 0,
    x: mouseX,
    y: mouseY,
    toJSON() { return this; },
  } as DOMRect;
  return positionPopup(pointRect, popupSize, viewport, 0);
}
