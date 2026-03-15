export type DataGridValue = string | number | null | undefined;

const NUMERIC_VALUE_RE = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i;
const DEFAULT_HEADER_FONT =
  '500 11px "Segoe UI", -apple-system, BlinkMacSystemFont, sans-serif';
const DEFAULT_CELL_FONT =
  '12px Consolas, "SFMono-Regular", Menlo, Monaco, monospace';

let measurementCanvas: HTMLCanvasElement | null = null;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function getMeasurementContext(): CanvasRenderingContext2D | null {
  if (typeof document === "undefined") return null;
  if (!measurementCanvas) {
    measurementCanvas = document.createElement("canvas");
  }
  return measurementCanvas.getContext("2d");
}

function measureTextWidth(text: string, font: string): number {
  const context = getMeasurementContext();
  if (!context) return text.length * 8;
  context.font = font;
  return context.measureText(text).width;
}

function getLongestLine(text: string): string {
  return text.split(/\r?\n/).reduce((longest, line) => {
    return line.length > longest.length ? line : longest;
  }, "");
}

export function getCanvasFontFromElement(
  element: HTMLElement | null,
  fallback: string,
): string {
  if (!element || typeof window === "undefined") return fallback;

  const styles = window.getComputedStyle(element);
  return [
    styles.fontStyle,
    styles.fontVariant,
    styles.fontWeight,
    styles.fontSize,
    styles.fontFamily,
  ]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

export function getDataGridCellText(value: DataGridValue): string {
  return value === null || value === undefined ? "NULL" : String(value);
}

export function isDataGridNumericValue(value: DataGridValue): boolean {
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "string") return false;

  const normalized = value.trim().replace(/,/g, "");
  return normalized !== "" && NUMERIC_VALUE_RE.test(normalized);
}

export function inferNumericDataGridColumn(
  values: DataGridValue[],
  sampleSize = 100,
): boolean {
  let inspected = 0;

  for (const value of values) {
    if (
      value === null ||
      value === undefined ||
      (typeof value === "string" && value.trim() === "")
    ) {
      continue;
    }

    inspected += 1;
    if (!isDataGridNumericValue(value)) return false;
    if (inspected >= sampleSize) break;
  }

  return inspected > 0;
}

export function compareDataGridValues(
  left: DataGridValue,
  right: DataGridValue,
): number {
  if (left == null && right == null) return 0;
  if (left == null) return 1;
  if (right == null) return -1;

  const leftNumeric = isDataGridNumericValue(left);
  const rightNumeric = isDataGridNumericValue(right);

  if (leftNumeric && rightNumeric) {
    const leftNumber =
      typeof left === "number" ? left : Number(left.trim().replace(/,/g, ""));
    const rightNumber =
      typeof right === "number"
        ? right
        : Number(right.trim().replace(/,/g, ""));
    return leftNumber - rightNumber;
  }

  return String(left).localeCompare(String(right), undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

export function measureDataGridColumnWidth({
  headerText,
  values,
  headerFont = DEFAULT_HEADER_FONT,
  cellFont = DEFAULT_CELL_FONT,
  minWidth = 80,
  maxWidth = 560,
  padding = 28,
  sampleSize = 250,
}: {
  headerText: string;
  values: DataGridValue[];
  headerFont?: string;
  cellFont?: string;
  minWidth?: number;
  maxWidth?: number;
  padding?: number;
  sampleSize?: number;
}): number {
  let widest = measureTextWidth(headerText, headerFont);
  let inspected = 0;

  for (const value of values) {
    const cellText = getDataGridCellText(value);
    const longestLine = getLongestLine(cellText);
    const measuredText =
      longestLine.length > 240
        ? `${longestLine.slice(0, 240)}...`
        : longestLine;

    widest = Math.max(widest, measureTextWidth(measuredText, cellFont));
    inspected += 1;
    if (inspected >= sampleSize) break;
  }

  return clamp(Math.ceil(widest + padding), minWidth, maxWidth);
}

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;

  return ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}
