import type { QueryResultSet } from "@/lib/db";

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function valueToXmlText(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (value instanceof Uint8Array) {
    return `[binary ${value.byteLength} bytes]`;
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

export function queryResultSetToXml(resultSet: QueryResultSet): string {
  const rows = resultSet.rows
    .map((row) => {
      const cols = resultSet.columns
        .map((column, index) => {
          const value = row[index];
          return `<col name="${escapeXml(column)}">${escapeXml(valueToXmlText(value))}</col>`;
        })
        .join("");
      return `<row>${cols}</row>`;
    })
    .join("");

  return `<resultset>${rows}</resultset>`;
}

export function queryResultSetsToXml(resultSets: QueryResultSet[]): string {
  return `<results>${resultSets.map(queryResultSetToXml).join("")}</results>`;
}
