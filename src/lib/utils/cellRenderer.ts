export type CellKind = "null" | "json" | "binary" | "date" | "number" | "text";

function isBufferLike(value: unknown): value is Uint8Array {
  if (value instanceof Uint8Array) {
    return true;
  }

  const bufferCtor = (globalThis as { Buffer?: { isBuffer?: (input: unknown) => boolean } }).Buffer;
  return Boolean(bufferCtor?.isBuffer?.(value));
}

function isIsoDateString(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:?\d{2})?)?$/.test(value)) {
    return false;
  }

  return !Number.isNaN(Date.parse(value));
}

function isNumericString(value: string): boolean {
  return /^-?(?:\d+\.?\d*|\d*\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim());
}

function isJsonString(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }

  if (
    !(
      trimmed.startsWith("{") ||
      trimmed.startsWith("[") ||
      trimmed === "true" ||
      trimmed === "false" ||
      trimmed === "null"
    )
  ) {
    return false;
  }

  try {
    const parsed = JSON.parse(trimmed);
    return parsed !== null && typeof parsed === "object";
  } catch {
    return false;
  }
}

export function classifyCell(value: unknown): CellKind {
  if (value === null || value === undefined) {
    return "null";
  }

  if (isBufferLike(value)) {
    return "binary";
  }

  if (value instanceof Date) {
    return "date";
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? "number" : "text";
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return "text";
    }
    if (isNumericString(trimmed)) {
      return "number";
    }
    if (isIsoDateString(trimmed)) {
      return "date";
    }
    if (isJsonString(trimmed)) {
      return "json";
    }
    return "text";
  }

  if (typeof value === "boolean") {
    return "text";
  }

  return "text";
}

export function toCellText(value: unknown): string {
  if (value === null || value === undefined) {
    return "NULL";
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (isBufferLike(value)) {
    return `BLOB (${value.byteLength} bytes)`;
  }

  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  return String(value);
}

export function toHexDump(value: Uint8Array): string {
  const bytes = Array.from(value);
  return bytes
    .map((byte, index) => {
      const hex = byte.toString(16).padStart(2, "0");
      return index % 16 === 15 ? `${hex}\n` : `${hex} `;
    })
    .join("")
    .trim();
}

export function prettyJson(value: unknown): string {
  try {
    return JSON.stringify(
      typeof value === "string" ? JSON.parse(value) : value,
      null,
      2,
    );
  } catch {
    return typeof value === "string" ? value : String(value);
  }
}
