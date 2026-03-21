import ExcelJS from "exceljs";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import type { QueryResultSet } from "@/lib/db";

function sanitizeSheetName(name: string): string {
  const cleaned = name.replace(/[\[\]:*?/\\]/g, " ").trim();
  return cleaned.slice(0, 31) || "Sheet1";
}

async function writeWorkbookToPath(workbook: ExcelJS.Workbook, filePath: string): Promise<void> {
  const buffer = await workbook.xlsx.writeBuffer();
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer as ArrayBuffer);
  await writeFile(filePath, bytes);
}

function addResultSetSheet(workbook: ExcelJS.Workbook, resultSet: QueryResultSet, index: number): void {
  const sheet = workbook.addWorksheet(
    sanitizeSheetName(resultSet.info || `Result ${index + 1}`),
  );
  sheet.columns = resultSet.columns.map((column) => ({
    header: column,
    key: column,
    width: Math.max(12, Math.min(40, column.length + 2)),
  }));

  resultSet.rows.forEach((row) => {
    const record: Record<string, unknown> = {};
    resultSet.columns.forEach((column, columnIndex) => {
      const value = row[columnIndex];
      record[column] = value ?? null;
    });
    sheet.addRow(record);
  });

  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: Math.max(1, resultSet.rows.length + 1), column: Math.max(1, resultSet.columns.length) },
  };
  sheet.getRow(1).font = { bold: true };
}

export async function exportQueryResultSetsToExcel(
  resultSets: QueryResultSet[],
  defaultFileName = "query-results.xlsx",
): Promise<string | null> {
  const filePath = await save({
    defaultPath: defaultFileName,
    filters: [{ name: "Excel Workbook", extensions: ["xlsx"] }],
  });

  if (!filePath) {
    return null;
  }

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "WorkGrid Studio";
  workbook.created = new Date();

  if (resultSets.length === 0) {
    workbook.addWorksheet("Results");
  } else {
    resultSets.forEach((resultSet, index) => addResultSetSheet(workbook, resultSet, index));
  }

  await writeWorkbookToPath(workbook, filePath);
  return filePath;
}

export async function exportQueryResultSetToExcel(
  resultSet: QueryResultSet,
  defaultFileName = "query-results.xlsx",
): Promise<string | null> {
  return exportQueryResultSetsToExcel([resultSet], defaultFileName);
}
