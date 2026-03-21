import { useState, useEffect, useMemo, useCallback, useRef, memo } from "react";
import {
  dbGetCollations,
  dbExecuteQuery,
  dbListTables,
  dbQuery,
} from "@/lib/db";
import {
  Plus,
  Trash2,
  ArrowUp,
  ArrowDown,
  Table2,
  Settings,
  Zap,
  Link2,
  CheckCircle,
  Circle,
  Code,
  Loader2,
  Undo,
  Redo,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { AutocompleteInput } from "@/components/ui/AutocompleteInput";
import { ContextSubmenu } from "@/components/views/ContextSubmenu";
import { highlightSQL } from "@/lib/sqlHighlight";
import { notifyError } from "@/lib/notifications";
import { useLayoutStore } from "@/state/layoutStore";
import { useSchemaStore } from "@/state/schemaStore";

// ═══════════════════════════════════════════════════════════════════════
//  Types
// ═══════════════════════════════════════════════════════════════════════

const MYSQL_DATA_TYPES = [
  // Numeric
  "TINYINT",
  "SMALLINT",
  "MEDIUMINT",
  "INT",
  "BIGINT",
  "DECIMAL",
  "FLOAT",
  "DOUBLE",
  "BIT",
  // String
  "CHAR",
  "VARCHAR",
  "TINYTEXT",
  "TEXT",
  "MEDIUMTEXT",
  "LONGTEXT",
  "BINARY",
  "VARBINARY",
  "TINYBLOB",
  "BLOB",
  "MEDIUMBLOB",
  "LONGBLOB",
  "ENUM",
  "SET",
  // Date/Time
  "DATE",
  "DATETIME",
  "TIMESTAMP",
  "TIME",
  "YEAR",
  // Spatial
  "GEOMETRY",
  "POINT",
  "LINESTRING",
  "POLYGON",
  // JSON
  "JSON",
];

const ENGINES = [
  "<Server default>",
  "InnoDB",
  "MyISAM",
  "MEMORY",
  "CSV",
  "ARCHIVE",
  "BLACKHOLE",
  "MRG_MYISAM",
  "PERFORMANCE_SCHEMA",
];
const ROW_FORMATS = [
  "DEFAULT",
  "DYNAMIC",
  "FIXED",
  "COMPRESSED",
  "REDUNDANT",
  "COMPACT",
];
const INSERT_METHODS = ["", "NO", "FIRST", "LAST"];
const VIRTUALITY_OPTIONS = ["", "VIRTUAL", "STORED"];
const ON_UPDATE_DELETE = [
  "RESTRICT",
  "CASCADE",
  "SET NULL",
  "NO ACTION",
  "SET DEFAULT",
];
const INDEX_TYPES = ["PRIMARY", "UNIQUE", "INDEX", "FULLTEXT", "SPATIAL"];
const INDEX_ALGORITHMS = ["", "BTREE", "HASH"];

interface ColumnDef {
  id: string;
  name: string;
  datatype: string;
  length: string;
  unsigned: boolean;
  allowNull: boolean;
  zerofill: boolean;
  defaultVal: string;
  comment: string;
  collation: string;
  expression: string;
  virtuality: string;
}

interface DisplayColumnDef extends ColumnDef {
  _diffState?: "added" | "modified" | "deleted";
}

interface IndexDef {
  id: string;
  name: string;
  type: string; // PRIMARY, UNIQUE, INDEX, FULLTEXT, SPATIAL
  columns: string[];
  algorithm: string;
  comment: string;
}

interface ForeignKeyDef {
  id: string;
  name: string;
  columns: string[];
  refTable: string;
  refColumns: string[];
  onUpdate: string;
  onDelete: string;
}

interface CheckConstraintDef {
  id: string;
  name: string;
  expression: string;
}

interface TableOptions {
  engine: string;
  collation: string;
  autoIncrement: string;
  avgRowLength: string;
  maxRows: string;
  checksum: boolean;
  rowFormat: string;
  insertMethod: string;
  comment: string;
}

type SubTab =
  | "basic"
  | "options"
  | "indexes"
  | "foreign-keys"
  | "check-constraints"
  | "partitions"
  | "create-code";

const EMPTY_TABLE_OPTIONS: TableOptions = {
  engine: "<Server default>",
  collation: "",
  autoIncrement: "",
  avgRowLength: "",
  maxRows: "",
  checksum: false,
  rowFormat: "DEFAULT",
  insertMethod: "",
  comment: "",
};

interface TableDesignerSnapshot {
  name: string;
  tableComment: string;
  columns: ColumnDef[];
  indexes: IndexDef[];
  foreignKeys: ForeignKeyDef[];
  checkConstraints: CheckConstraintDef[];
  options: TableOptions;
}

// ═══════════════════════════════════════════════════════════════════════
//  Helper
// ═══════════════════════════════════════════════════════════════════════

function uid() {
  return crypto.randomUUID().slice(0, 8);
}

function newColumn(): ColumnDef {
  return {
    id: uid(),
    name: "",
    datatype: "INT",
    length: "",
    unsigned: false,
    allowNull: true,
    zerofill: false,
    defaultVal: "",
    comment: "",
    collation: "",
    expression: "",
    virtuality: "",
  };
}

function newIndex(): IndexDef {
  return {
    id: uid(),
    name: "",
    type: "INDEX",
    columns: [],
    algorithm: "",
    comment: "",
  };
}

function newForeignKey(): ForeignKeyDef {
  return {
    id: uid(),
    name: "",
    columns: [],
    refTable: "",
    refColumns: [],
    onUpdate: "RESTRICT",
    onDelete: "RESTRICT",
  };
}

function newCheckConstraint(): CheckConstraintDef {
  return { id: uid(), name: "", expression: "" };
}

function escapeIdentifier(value: string): string {
  return `\`${value.replace(/`/g, "``")}\``;
}

function escapeSqlString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function sanitizeToken(value: string): string | null {
  const token = value.trim();
  return /^[A-Za-z0-9_]+$/.test(token) ? token : null;
}

function isNumericLiteral(value: string): boolean {
  return /^-?\d+(\.\d+)?$/.test(value);
}

function formatDefaultValue(value: string): string {
  const trimmed = value.trim();
  const upper = trimmed.toUpperCase();
  if (/^'.*'$/.test(trimmed)) return trimmed;
  if (/^".*"$/.test(trimmed)) {
    return `'${escapeSqlString(trimmed.slice(1, -1))}'`;
  }
  if (
    upper === "NULL" ||
    upper === "CURRENT_TIMESTAMP" ||
    upper === "CURRENT_TIMESTAMP()" ||
    upper === "CURRENT_DATE" ||
    upper === "CURRENT_DATE()" ||
    upper === "CURDATE()" ||
    upper === "CURRENT_TIME" ||
    upper === "CURRENT_TIME()" ||
    upper === "CURTIME()" ||
    upper === "NOW()" ||
    upper === "LOCALTIME" ||
    upper === "LOCALTIME()" ||
    upper === "LOCALTIMESTAMP" ||
    upper === "LOCALTIMESTAMP()" ||
    upper === "TRUE" ||
    upper === "FALSE" ||
    /^b'[01]+'$/i.test(trimmed) ||
    /^[A-Za-z_][A-Za-z0-9_]*\(.*\)$/.test(trimmed) ||
    trimmed.startsWith("(") ||
    isNumericLiteral(trimmed)
  ) {
    return trimmed;
  }
  return `'${escapeSqlString(trimmed)}'`;
}

function normalizeDatatype(raw: string): string {
  return raw.trim().toUpperCase();
}

function buildDefaultValueSuggestions(col: ColumnDef): string[] {
  const datatype = normalizeDatatype(col.datatype);
  const length = col.length.trim();
  const query = col.defaultVal.trim().toLowerCase();

  const numericTypes = new Set([
    "TINYINT",
    "SMALLINT",
    "MEDIUMINT",
    "INT",
    "INTEGER",
    "BIGINT",
    "DECIMAL",
    "NUMERIC",
    "FLOAT",
    "DOUBLE",
    "REAL",
  ]);
  const stringTypes = new Set([
    "CHAR",
    "VARCHAR",
    "TINYTEXT",
    "TEXT",
    "MEDIUMTEXT",
    "LONGTEXT",
    "ENUM",
    "SET",
  ]);
  const temporalTypes = new Set(["DATE", "DATETIME", "TIMESTAMP", "TIME"]);
  const isBoolean =
    datatype === "BOOL" ||
    datatype === "BOOLEAN" ||
    (datatype === "TINYINT" && length === "1");

  const out: string[] = [];
  const seen = new Set<string>();
  const add = (candidate: string) => {
    if (!candidate || seen.has(candidate)) return;
    if (query && !candidate.toLowerCase().includes(query)) return;
    seen.add(candidate);
    out.push(candidate);
  };

  if (col.allowNull) add("NULL");
  if (isBoolean) {
    add("0");
    add("1");
  } else if (numericTypes.has(datatype)) {
    add("0");
    add("1");
    add("-1");
  }

  if (temporalTypes.has(datatype)) {
    if (datatype === "DATE") {
      add("CURRENT_DATE");
      add("CURDATE()");
    } else if (datatype === "TIME") {
      add("CURRENT_TIME");
      add("CURTIME()");
    } else {
      add("CURRENT_TIMESTAMP");
      add("CURRENT_TIMESTAMP()");
      add("NOW()");
    }
  }

  if (stringTypes.has(datatype)) {
    add("''");
    if (datatype === "CHAR" || datatype === "VARCHAR") {
      add("(UUID())");
    }
  }

  if (datatype === "JSON") {
    add("(JSON_OBJECT())");
    add("(JSON_ARRAY())");
  }
  if (datatype === "BIT") {
    add("b'0'");
    add("b'1'");
  }

  return out.slice(0, 10);
}

function effectiveComment(tableComment: string, options: TableOptions): string {
  return (tableComment || options.comment).trim();
}

function makeSnapshot(data: {
  name: string;
  tableComment: string;
  columns: ColumnDef[];
  indexes: IndexDef[];
  foreignKeys: ForeignKeyDef[];
  checkConstraints: CheckConstraintDef[];
  options: TableOptions;
}): TableDesignerSnapshot {
  return {
    name: data.name,
    tableComment: data.tableComment,
    columns: data.columns.map((c) => ({ ...c })),
    indexes: data.indexes.map((i) => ({ ...i, columns: [...i.columns] })),
    foreignKeys: data.foreignKeys.map((f) => ({
      ...f,
      columns: [...f.columns],
      refColumns: [...f.refColumns],
    })),
    checkConstraints: data.checkConstraints.map((c) => ({ ...c })),
    options: { ...data.options },
  };
}

function snapshotSignature(snapshot: TableDesignerSnapshot): string {
  return JSON.stringify(snapshot);
}

function parseColumnType(type: string): {
  datatype: string;
  length: string;
  unsigned: boolean;
  zerofill: boolean;
} {
  const unsigned = /\bunsigned\b/i.test(type);
  const zerofill = /\bzerofill\b/i.test(type);
  const cleaned = type
    .replace(/\bunsigned\b/gi, "")
    .replace(/\bzerofill\b/gi, "")
    .trim();
  const m = cleaned.match(/^([A-Za-z0-9_]+)\s*(?:\((.*)\))?$/);
  if (!m) {
    return {
      datatype: normalizeDatatype(cleaned || "INT"),
      length: "",
      unsigned,
      zerofill,
    };
  }
  return {
    datatype: normalizeDatatype(m[1]),
    length: (m[2] || "").trim(),
    unsigned,
    zerofill,
  };
}

function columnDefinitionSql(col: ColumnDef): string {
  let line = `${escapeIdentifier(col.name.trim())} ${normalizeDatatype(col.datatype)}`;
  if (col.length.trim()) line += `(${col.length.trim()})`;
  if (col.unsigned) line += " UNSIGNED";
  if (col.zerofill) line += " ZEROFILL";

  const expression = col.expression.trim();
  const virtuality = col.virtuality.trim().toUpperCase();
  if (expression && (virtuality === "VIRTUAL" || virtuality === "STORED")) {
    line += ` AS (${expression}) ${virtuality}`;
  }

  if (!col.allowNull) line += " NOT NULL";
  if (col.defaultVal.trim())
    line += ` DEFAULT ${formatDefaultValue(col.defaultVal)}`;

  const collation = sanitizeToken(col.collation);
  if (collation) line += ` COLLATE ${collation}`;

  if (col.comment.trim())
    line += ` COMMENT '${escapeSqlString(col.comment.trim())}'`;
  return line;
}

function normalizedColumnSignature(col: ColumnDef): string {
  return JSON.stringify({
    name: col.name.trim(),
    datatype: normalizeDatatype(col.datatype),
    length: col.length.trim(),
    unsigned: col.unsigned,
    allowNull: col.allowNull,
    zerofill: col.zerofill,
    defaultVal: col.defaultVal.trim(),
    comment: col.comment.trim(),
    collation: col.collation.trim(),
    expression: col.expression.trim(),
    virtuality: col.virtuality.trim().toUpperCase(),
  });
}

function normalizeRule(rule: string): string {
  const v = rule.trim().toUpperCase();
  return ON_UPDATE_DELETE.includes(v) ? v : "RESTRICT";
}

function autoName(prefix: string, parts: string[]): string {
  const raw = parts
    .join("_")
    .replace(/[^A-Za-z0-9_]/g, "_")
    .replace(/_+/g, "_");
  const cleaned = raw.replace(/^_+|_+$/g, "");
  return cleaned ? `${prefix}_${cleaned}`.slice(0, 64) : `${prefix}_${uid()}`;
}

function indexNameOrFallback(idx: IndexDef): string {
  return idx.name.trim() || autoName("idx", idx.columns);
}

function indexAddClause(idx: IndexDef): string | null {
  const columns = idx.columns.map((c) => c.trim()).filter(Boolean);
  if (columns.length === 0) return null;

  if (idx.type === "PRIMARY") {
    return `ADD PRIMARY KEY (${columns.map((c) => escapeIdentifier(c)).join(", ")})`;
  }

  const type =
    idx.type === "UNIQUE"
      ? "UNIQUE "
      : idx.type === "FULLTEXT"
        ? "FULLTEXT "
        : idx.type === "SPATIAL"
          ? "SPATIAL "
          : "";

  const algorithm = sanitizeToken(idx.algorithm);
  const comment = idx.comment.trim()
    ? ` COMMENT '${escapeSqlString(idx.comment.trim())}'`
    : "";
  const using = algorithm ? ` USING ${algorithm}` : "";
  return `ADD ${type}INDEX ${escapeIdentifier(indexNameOrFallback(idx))} (${columns.map((c) => escapeIdentifier(c)).join(", ")})${using}${comment}`;
}

function normalizedIndexSignature(idx: IndexDef): string {
  return JSON.stringify({
    name: idx.name.trim(),
    type: idx.type.trim().toUpperCase(),
    columns: idx.columns.map((c) => c.trim()),
    algorithm: idx.algorithm.trim().toUpperCase(),
    comment: idx.comment.trim(),
  });
}

function fkAddClause(fk: ForeignKeyDef): string | null {
  const columns = fk.columns.map((c) => c.trim()).filter(Boolean);
  const refColumns = fk.refColumns.map((c) => c.trim()).filter(Boolean);
  const refTable = fk.refTable.trim();
  if (!columns.length || !refColumns.length || !refTable) return null;

  const pairCount = Math.min(columns.length, refColumns.length);
  const local = columns.slice(0, pairCount);
  const remote = refColumns.slice(0, pairCount);
  const name = fk.name.trim() || autoName("fk", local);
  return `ADD CONSTRAINT ${escapeIdentifier(name)} FOREIGN KEY (${local.map((c) => escapeIdentifier(c)).join(", ")}) REFERENCES ${escapeIdentifier(refTable)} (${remote.map((c) => escapeIdentifier(c)).join(", ")}) ON UPDATE ${normalizeRule(fk.onUpdate)} ON DELETE ${normalizeRule(fk.onDelete)}`;
}

function normalizedFkSignature(fk: ForeignKeyDef): string {
  return JSON.stringify({
    name: fk.name.trim(),
    columns: fk.columns.map((c) => c.trim()),
    refTable: fk.refTable.trim(),
    refColumns: fk.refColumns.map((c) => c.trim()),
    onUpdate: normalizeRule(fk.onUpdate),
    onDelete: normalizeRule(fk.onDelete),
  });
}

function checkAddClause(ch: CheckConstraintDef): string | null {
  const expr = ch.expression.trim();
  if (!expr) return null;
  if (ch.name.trim()) {
    return `ADD CONSTRAINT ${escapeIdentifier(ch.name.trim())} CHECK (${expr})`;
  }
  return `ADD CHECK (${expr})`;
}

function normalizedCheckSignature(ch: CheckConstraintDef): string {
  return JSON.stringify({
    name: ch.name.trim(),
    expression: ch.expression.trim(),
  });
}

function createTableSql(
  database: string,
  snapshot: TableDesignerSnapshot,
): string {
  const tableName = snapshot.name.trim();
  if (!tableName) return "-- Enter a table name first";

  const cols = snapshot.columns.filter((c) => c.name.trim());
  if (cols.length === 0) return "-- Add at least one column before saving";

  const lines: string[] = [];
  lines.push(
    `CREATE TABLE ${escapeIdentifier(database)}.${escapeIdentifier(tableName)} (`,
  );

  const defs: string[] = cols.map((c) => `  ${columnDefinitionSql(c)}`);

  for (const idx of snapshot.indexes) {
    const columns = idx.columns.map((c) => c.trim()).filter(Boolean);
    if (!columns.length) continue;
    if (idx.type === "PRIMARY") {
      defs.push(
        `  PRIMARY KEY (${columns.map((c) => escapeIdentifier(c)).join(", ")})`,
      );
      continue;
    }
    const type =
      idx.type === "UNIQUE"
        ? "UNIQUE "
        : idx.type === "FULLTEXT"
          ? "FULLTEXT "
          : idx.type === "SPATIAL"
            ? "SPATIAL "
            : "";
    const algorithm = sanitizeToken(idx.algorithm);
    const comment = idx.comment.trim()
      ? ` COMMENT '${escapeSqlString(idx.comment.trim())}'`
      : "";
    const using = algorithm ? ` USING ${algorithm}` : "";
    defs.push(
      `  ${type}INDEX ${escapeIdentifier(indexNameOrFallback(idx))} (${columns.map((c) => escapeIdentifier(c)).join(", ")})${using}${comment}`,
    );
  }

  for (const fk of snapshot.foreignKeys) {
    const clause = fkAddClause(fk);
    if (clause) defs.push(`  ${clause.replace(/^ADD /, "")}`);
  }

  for (const ch of snapshot.checkConstraints) {
    const clause = checkAddClause(ch);
    if (clause) defs.push(`  ${clause.replace(/^ADD /, "")}`);
  }

  lines.push(defs.join(",\n"));
  lines.push(")");

  const opts: string[] = [];
  const engine = sanitizeToken(snapshot.options.engine);
  if (engine && snapshot.options.engine !== "<Server default>") {
    opts.push(`ENGINE=${engine}`);
  }
  const collation = sanitizeToken(snapshot.options.collation);
  if (collation) {
    const charset = sanitizeToken(collation.split("_")[0]);
    if (charset) opts.push(`DEFAULT CHARSET=${charset}`);
    opts.push(`COLLATE=${collation}`);
  }
  if (
    snapshot.options.autoIncrement.trim() &&
    /^\d+$/.test(snapshot.options.autoIncrement.trim())
  ) {
    opts.push(`AUTO_INCREMENT=${snapshot.options.autoIncrement.trim()}`);
  }
  if (
    snapshot.options.avgRowLength.trim() &&
    /^\d+$/.test(snapshot.options.avgRowLength.trim())
  ) {
    opts.push(`AVG_ROW_LENGTH=${snapshot.options.avgRowLength.trim()}`);
  }
  if (
    snapshot.options.maxRows.trim() &&
    /^\d+$/.test(snapshot.options.maxRows.trim())
  ) {
    opts.push(`MAX_ROWS=${snapshot.options.maxRows.trim()}`);
  }
  if (snapshot.options.checksum) opts.push("CHECKSUM=1");
  if (
    ROW_FORMATS.includes(snapshot.options.rowFormat.trim().toUpperCase()) &&
    snapshot.options.rowFormat.trim().toUpperCase() !== "DEFAULT"
  ) {
    opts.push(`ROW_FORMAT=${snapshot.options.rowFormat.trim().toUpperCase()}`);
  }
  if (
    INSERT_METHODS.includes(
      snapshot.options.insertMethod.trim().toUpperCase(),
    ) &&
    snapshot.options.insertMethod.trim()
  ) {
    opts.push(
      `INSERT_METHOD=${snapshot.options.insertMethod.trim().toUpperCase()}`,
    );
  }
  const comment = effectiveComment(snapshot.tableComment, snapshot.options);
  if (comment) opts.push(`COMMENT='${escapeSqlString(comment)}'`);

  if (opts.length) {
    lines[lines.length - 1] += ` ${opts.join(" ")}`;
  }
  lines[lines.length - 1] += ";";
  return lines.join("\n");
}

function alterTableSql(
  database: string,
  before: TableDesignerSnapshot,
  after: TableDesignerSnapshot,
): string | null {
  const currentName = before.name.trim();
  const nextName = after.name.trim();
  if (!currentName || !nextName || currentName !== nextName) return null;

  const beforeCols = before.columns.filter((c) => c.name.trim());
  const afterCols = after.columns.filter((c) => c.name.trim());

  const dropConstraintClauses: string[] = [];
  const dropIndexClauses: string[] = [];
  const columnClauses: string[] = [];
  const postClauses: string[] = [];
  const optionClauses: string[] = [];

  const beforeIdxPrimary = before.indexes.find(
    (i) => i.type === "PRIMARY" && i.columns.length > 0,
  );
  const afterIdxPrimary = after.indexes.find(
    (i) => i.type === "PRIMARY" && i.columns.length > 0,
  );
  const primaryChanged =
    !!beforeIdxPrimary !== !!afterIdxPrimary ||
    (beforeIdxPrimary &&
      afterIdxPrimary &&
      normalizedIndexSignature(beforeIdxPrimary) !==
      normalizedIndexSignature(afterIdxPrimary));
  if (primaryChanged && beforeIdxPrimary)
    dropIndexClauses.push("DROP PRIMARY KEY");
  if (primaryChanged && afterIdxPrimary) {
    const clause = indexAddClause(afterIdxPrimary);
    if (clause) postClauses.push(clause);
  }

  const beforeIndexes = before.indexes.filter((i) => i.type !== "PRIMARY");
  const afterIndexes = after.indexes.filter((i) => i.type !== "PRIMARY");
  const beforeIdxById = new Map(beforeIndexes.map((i) => [i.id, i]));
  const afterIdxById = new Map(afterIndexes.map((i) => [i.id, i]));

  for (const oldIdx of beforeIndexes) {
    const nextIdx = afterIdxById.get(oldIdx.id);
    if (
      !nextIdx ||
      normalizedIndexSignature(oldIdx) !== normalizedIndexSignature(nextIdx)
    ) {
      const dropName = oldIdx.name.trim();
      if (dropName)
        dropIndexClauses.push(`DROP INDEX ${escapeIdentifier(dropName)}`);
    }
  }
  for (const nextIdx of afterIndexes) {
    const oldIdx = beforeIdxById.get(nextIdx.id);
    if (
      !oldIdx ||
      normalizedIndexSignature(oldIdx) !== normalizedIndexSignature(nextIdx)
    ) {
      const clause = indexAddClause(nextIdx);
      if (clause) postClauses.push(clause);
    }
  }

  const beforeFkById = new Map(before.foreignKeys.map((f) => [f.id, f]));
  const afterFkById = new Map(after.foreignKeys.map((f) => [f.id, f]));
  for (const oldFk of before.foreignKeys) {
    const nextFk = afterFkById.get(oldFk.id);
    if (
      !nextFk ||
      normalizedFkSignature(oldFk) !== normalizedFkSignature(nextFk)
    ) {
      if (oldFk.name.trim())
        dropConstraintClauses.push(
          `DROP FOREIGN KEY ${escapeIdentifier(oldFk.name.trim())}`,
        );
    }
  }
  for (const nextFk of after.foreignKeys) {
    const oldFk = beforeFkById.get(nextFk.id);
    if (
      !oldFk ||
      normalizedFkSignature(oldFk) !== normalizedFkSignature(nextFk)
    ) {
      const clause = fkAddClause(nextFk);
      if (clause) postClauses.push(clause);
    }
  }

  const beforeChecksById = new Map(
    before.checkConstraints.map((c) => [c.id, c]),
  );
  const afterChecksById = new Map(after.checkConstraints.map((c) => [c.id, c]));
  for (const oldCheck of before.checkConstraints) {
    const nextCheck = afterChecksById.get(oldCheck.id);
    if (
      !nextCheck ||
      normalizedCheckSignature(oldCheck) !== normalizedCheckSignature(nextCheck)
    ) {
      if (oldCheck.name.trim())
        dropConstraintClauses.push(
          `DROP CHECK ${escapeIdentifier(oldCheck.name.trim())}`,
        );
    }
  }
  for (const nextCheck of after.checkConstraints) {
    const oldCheck = beforeChecksById.get(nextCheck.id);
    if (
      !oldCheck ||
      normalizedCheckSignature(oldCheck) !== normalizedCheckSignature(nextCheck)
    ) {
      const clause = checkAddClause(nextCheck);
      if (clause) postClauses.push(clause);
    }
  }

  const beforeColsById = new Map(beforeCols.map((c) => [c.id, c]));
  const beforeColPos = new Map(beforeCols.map((c, idx) => [c.id, idx]));
  const afterColIds = new Set(afterCols.map((c) => c.id));
  for (const oldCol of beforeCols) {
    if (!afterColIds.has(oldCol.id)) {
      columnClauses.push(`DROP COLUMN ${escapeIdentifier(oldCol.name.trim())}`);
    }
  }

  for (let i = 0; i < afterCols.length; i += 1) {
    const col = afterCols[i];
    const prevCol = i > 0 ? afterCols[i - 1] : null;
    const position = prevCol
      ? ` AFTER ${escapeIdentifier(prevCol.name.trim())}`
      : " FIRST";
    const old = beforeColsById.get(col.id);
    if (!old) {
      columnClauses.push(`ADD COLUMN ${columnDefinitionSql(col)}${position}`);
      continue;
    }

    const changed =
      normalizedColumnSignature(old) !== normalizedColumnSignature(col);
    const moved = beforeColPos.get(col.id) !== i;
    if (!changed && !moved) continue;

    if (old.name.trim() !== col.name.trim()) {
      columnClauses.push(
        `CHANGE COLUMN ${escapeIdentifier(old.name.trim())} ${columnDefinitionSql(col)}${position}`,
      );
    } else {
      columnClauses.push(
        `MODIFY COLUMN ${columnDefinitionSql(col)}${position}`,
      );
    }
  }

  const beforeComment = effectiveComment(before.tableComment, before.options);
  const afterComment = effectiveComment(after.tableComment, after.options);

  if (before.options.engine !== after.options.engine) {
    const engine = sanitizeToken(after.options.engine);
    if (engine && after.options.engine !== "<Server default>")
      optionClauses.push(`ENGINE=${engine}`);
  }
  if (before.options.collation !== after.options.collation) {
    const collation = sanitizeToken(after.options.collation);
    if (collation) {
      const charset = sanitizeToken(collation.split("_")[0]);
      if (charset) optionClauses.push(`DEFAULT CHARACTER SET ${charset}`);
      optionClauses.push(`COLLATE ${collation}`);
    }
  }
  if (
    before.options.autoIncrement !== after.options.autoIncrement &&
    /^\d+$/.test(after.options.autoIncrement.trim())
  ) {
    optionClauses.push(`AUTO_INCREMENT=${after.options.autoIncrement.trim()}`);
  }
  if (
    before.options.avgRowLength !== after.options.avgRowLength &&
    /^\d+$/.test(after.options.avgRowLength.trim())
  ) {
    optionClauses.push(`AVG_ROW_LENGTH=${after.options.avgRowLength.trim()}`);
  }
  if (
    before.options.maxRows !== after.options.maxRows &&
    /^\d+$/.test(after.options.maxRows.trim())
  ) {
    optionClauses.push(`MAX_ROWS=${after.options.maxRows.trim()}`);
  }
  if (before.options.checksum !== after.options.checksum) {
    optionClauses.push(`CHECKSUM=${after.options.checksum ? 1 : 0}`);
  }
  if (
    before.options.rowFormat !== after.options.rowFormat &&
    ROW_FORMATS.includes(after.options.rowFormat.trim().toUpperCase())
  ) {
    optionClauses.push(
      `ROW_FORMAT=${after.options.rowFormat.trim().toUpperCase()}`,
    );
  }
  if (
    before.options.insertMethod !== after.options.insertMethod &&
    INSERT_METHODS.includes(after.options.insertMethod.trim().toUpperCase())
  ) {
    if (after.options.insertMethod.trim()) {
      optionClauses.push(
        `INSERT_METHOD=${after.options.insertMethod.trim().toUpperCase()}`,
      );
    }
  }
  if (beforeComment !== afterComment) {
    optionClauses.push(`COMMENT='${escapeSqlString(afterComment)}'`);
  }

  const clauses = [
    ...dropConstraintClauses,
    ...dropIndexClauses,
    ...columnClauses,
    ...postClauses,
    ...optionClauses,
  ];
  if (!clauses.length) return null;

  return `ALTER TABLE ${escapeIdentifier(database)}.${escapeIdentifier(currentName)}\n  ${clauses.join(",\n  ")};`;
}

function toText(value: unknown): string {
  if (value == null) return "";
  return String(value);
}

// ═══════════════════════════════════════════════════════════════════════
//  Main Component
// ═══════════════════════════════════════════════════════════════════════

interface Props {
  tabId?: string;
  leafId?: string;
  profileId: string;
  database: string;
  /** If provided, load existing table for editing */
  tableName?: string;
}

export function TableDesigner({ tabId, leafId, profileId, database, tableName }: Props) {
  const isEditMode = Boolean(tableName);

  // ── State ──────────────────────────────────────────────────
  const [name, setName] = useState(tableName || "");
  const [tableComment, setTableComment] = useState("");
  const [columns, setColumns] = useState<ColumnDef[]>([]);
  const [indexes, setIndexes] = useState<IndexDef[]>([]);
  const [foreignKeys, setForeignKeys] = useState<ForeignKeyDef[]>([]);
  const [checkConstraints, setCheckConstraints] = useState<
    CheckConstraintDef[]
  >([]);
  const [options, setOptions] = useState<TableOptions>({
    ...EMPTY_TABLE_OPTIONS,
  });
  const [activeTab, setActiveTab] = useState<SubTab>("basic");
  const [selectedColumn, setSelectedColumn] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<string | null>(null);
  const [selectedFK, setSelectedFK] = useState<string | null>(null);
  const [selectedCheck, setSelectedCheck] = useState<string | null>(null);
  const [loadedSnapshot, setLoadedSnapshot] =
    useState<TableDesignerSnapshot | null>(null);
  const [loadingSchema, setLoadingSchema] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<{
    x: number;
    y: number;
    columnId: string;
  } | null>(null);
  const [showSaveModal, setShowSaveModal] = useState(false);

  // ── Undo / Redo Logic ───────────────────────────────────
  const [history, setHistory] = useState<TableDesignerSnapshot[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const isHistoryActionRef = useRef(false);
  const lastRecordedRef = useRef<string | null>(null);

  const applySnapshot = useCallback((snapshot: TableDesignerSnapshot) => {
    isHistoryActionRef.current = true;
    setName(snapshot.name);
    setTableComment(snapshot.tableComment);
    setColumns(snapshot.columns.map(c => ({ ...c })));
    setIndexes(snapshot.indexes.map(i => ({ ...i, columns: [...i.columns] })));
    setForeignKeys(snapshot.foreignKeys.map(f => ({ ...f, columns: [...f.columns], refColumns: [...f.refColumns] })));
    setCheckConstraints(snapshot.checkConstraints.map(c => ({ ...c })));
    setOptions({ ...snapshot.options });
    // Clear selection if IDs might have changed (though snapshot should keep them)
    // setSelectedColumn(snapshot.columns[0]?.id || null);

    lastRecordedRef.current = snapshotSignature(snapshot);
    setTimeout(() => {
      isHistoryActionRef.current = false;
    }, 50);
  }, []);

  const recordHistory = useCallback((snapshot: TableDesignerSnapshot) => {
    const sig = snapshotSignature(snapshot);
    if (sig === lastRecordedRef.current) return;

    setHistory((prev) => {
      const newHistory = prev.slice(0, historyIndex + 1);
      newHistory.push(snapshot);
      if (newHistory.length > 50) newHistory.shift(); // Max 50 levels
      return newHistory;
    });
    setHistoryIndex((prev) => {
      const next = prev + 1;
      return next > 49 ? 49 : next;
    });
    lastRecordedRef.current = sig;
  }, [historyIndex]);

  const undo = useCallback(() => {
    if (historyIndex <= 0) return;
    const nextIdx = historyIndex - 1;
    const snap = history[nextIdx];
    if (snap) {
      setHistoryIndex(nextIdx);
      applySnapshot(snap);
    }
  }, [history, historyIndex, applySnapshot]);

  const redo = useCallback(() => {
    if (historyIndex >= history.length - 1) return;
    const nextIdx = historyIndex + 1;
    const snap = history[nextIdx];
    if (snap) {
      setHistoryIndex(nextIdx);
      applySnapshot(snap);
    }
  }, [history, historyIndex, applySnapshot]);

  // Record initial state once loaded
  useEffect(() => {
    if (loadedSnapshot && history.length === 0) {
      setHistory([loadedSnapshot]);
      setHistoryIndex(0);
      lastRecordedRef.current = snapshotSignature(loadedSnapshot);
    } else if (!isEditMode && columns.length === 0 && history.length === 0 && !loadingSchema) {
      // For new table, record initial empty state
      const initial = makeSnapshot({
        name: "",
        tableComment: "",
        columns: [],
        indexes: [],
        foreignKeys: [],
        checkConstraints: [],
        options: { ...EMPTY_TABLE_OPTIONS }
      });
      setHistory([initial]);
      setHistoryIndex(0);
      lastRecordedRef.current = snapshotSignature(initial);
    }
  }, [loadedSnapshot, isEditMode, columns.length, history.length, loadingSchema]);

  // Debounced auto-recording
  useEffect(() => {
    if (isHistoryActionRef.current || loadingSchema) return;

    const timer = setTimeout(() => {
      const current = makeSnapshot({
        name,
        tableComment,
        columns,
        indexes,
        foreignKeys,
        checkConstraints,
        options,
      });
      recordHistory(current);
    }, 1000); // 1s debounce to avoid flooding history with every keystroke

    return () => clearTimeout(timer);
  }, [name, tableComment, columns, indexes, foreignKeys, checkConstraints, options, recordHistory, loadingSchema]);

  // Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Only handle if this tab might be focused (heuristic: check if appStore says so or just global if it's the active tab)
      // Since TableDesigner is a tab, we assume if it's rendered, it wants shortcuts, 
      // but we should check if an input is NOT focused if we want to be safe, 
      // however Ctrl+Z is usually handled by the browser/input unless we prevent default.

      const isZ = e.key.toLowerCase() === "z";
      const isY = e.key.toLowerCase() === "y";
      const isCtrl = e.ctrlKey || e.metaKey;
      const isShift = e.shiftKey;

      if (isCtrl && isZ) {
        if (isShift) {
          e.preventDefault();
          redo();
        } else {
          // If we are in a textarea/input, we might want to let the native undo happen?
          // But for schema changes (adding rows etc), native undo doesn't work.
          // For now, let's take over Ctrl+Z globally within this component.
          e.preventDefault();
          undo();
        }
      } else if (isCtrl && isY) {
        e.preventDefault();
        redo();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [undo, redo]);

  useEffect(() => {
    if (!ctxMenu) return;
    const close = () => setCtxMenu(null);
    window.addEventListener("click", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [ctxMenu]);

  const updateTab = useLayoutStore((s) => s.updateTab);
  const openTab = useLayoutStore((s) => s.openTab);
  const closeTab = useLayoutStore((s) => s.closeTab);

  // Sync dirty state
  useEffect(() => {
    const current = makeSnapshot({
      name,
      tableComment,
      columns,
      indexes,
      foreignKeys,
      checkConstraints,
      options,
    });

    let dirty = false;
    if (!loadedSnapshot) {
      if (!isEditMode) {
        // new table -> dirty if anything is touched
        dirty = name.trim() !== "" || columns.length > 0;
      }
    } else {
      dirty = snapshotSignature(current) !== snapshotSignature(loadedSnapshot);
    }

    if (tabId) {
      updateTab(tabId, { dirty });
    }
  }, [
    name,
    tableComment,
    columns,
    indexes,
    foreignKeys,
    checkConstraints,
    options,
    loadedSnapshot,
    isEditMode,
    tabId,
    updateTab
  ]);

  const handleCreateNewIndex = useCallback(
    (columnId: string, type: string) => {
      const col = columns.find((c) => c.id === columnId);
      if (!col || !col.name.trim()) return;
      const idx = newIndex();
      idx.type = type;
      idx.name = `${col.name.trim()}_${type.toLowerCase()}`;
      idx.columns = [col.name.trim()];
      setIndexes((prev) => [...prev, idx]);
      setSelectedIndex(idx.id);
      setActiveTab("indexes");
      setCtxMenu(null);
    },
    [columns],
  );

  const handleAddToIndex = useCallback(
    (columnId: string, indexId: string) => {
      const col = columns.find((c) => c.id === columnId);
      if (!col || !col.name.trim()) return;
      setIndexes((prev) =>
        prev.map((idx) => {
          if (idx.id === indexId && !idx.columns.includes(col.name.trim())) {
            return { ...idx, columns: [...idx.columns, col.name.trim()] };
          }
          return idx;
        }),
      );
      setSelectedIndex(indexId);
      setActiveTab("indexes");
      setCtxMenu(null);
    },
    [columns],
  );

  // ── Resizable split ───────────────────────────────────────
  const [splitPercent, setSplitPercent] = useState(35);
  const containerRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  const handleDragStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      draggingRef.current = true;
      const startY = e.clientY;
      const startSplit = splitPercent;

      const onMove = (ev: MouseEvent) => {
        if (!draggingRef.current || !containerRef.current) return;
        const rect = containerRef.current.getBoundingClientRect();
        // subtract the tab bar height (~33px) and bottom toolbar (~37px)
        const availHeight = rect.height;
        const deltaY = ev.clientY - startY;
        const deltaPct = (deltaY / availHeight) * 100;
        const next = Math.min(80, Math.max(10, startSplit + deltaPct));
        setSplitPercent(next);
      };

      const onUp = () => {
        draggingRef.current = false;
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };

      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
      document.body.style.cursor = "row-resize";
      document.body.style.userSelect = "none";
    },
    [splitPercent],
  );

  // ── External data ─────────────────────────────────────────
  const [collations, setCollations] = useState<string[]>([]);
  const [tables, setTables] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    dbGetCollations(profileId)
      .then((res) => {
        if (cancelled) return;
        setCollations(res.collations);
        if (!isEditMode && res.default_collation) {
          setOptions((prev) =>
            prev.collation
              ? prev
              : { ...prev, collation: res.default_collation },
          );
        }
      })
      .catch(() => { });
    dbListTables(profileId, database)
      .then((list) => {
        if (!cancelled) setTables(list);
      })
      .catch(() => { });
    return () => {
      cancelled = true;
    };
  }, [profileId, database, isEditMode]);

  useEffect(() => {
    let cancelled = false;

    if (!isEditMode || !tableName) {
      setLoadingSchema(false);
      setLoadedSnapshot(null);
      return;
    }

    const loadExistingTable = async () => {
      setLoadingSchema(true);
      setError(null);
      setSuccess(null);

      const dbLiteral = database.replace(/'/g, "''");
      const tableLiteral = tableName.replace(/'/g, "''");
      const tableRef = `${escapeIdentifier(database)}.${escapeIdentifier(tableName)}`;

      try {
        const [colRes, idxRes, fkRes, checkRes, optionRes] = await Promise.all([
          dbQuery(
            profileId,
            `SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, EXTRA, COLUMN_COMMENT, COLLATION_NAME, GENERATION_EXPRESSION
                         FROM information_schema.COLUMNS
                         WHERE TABLE_SCHEMA = '${dbLiteral}' AND TABLE_NAME = '${tableLiteral}'
                         ORDER BY ORDINAL_POSITION`,
          ),
          dbQuery(profileId, `SHOW INDEX FROM ${tableRef}`),
          dbQuery(
            profileId,
            `SELECT k.CONSTRAINT_NAME, k.COLUMN_NAME, k.REFERENCED_TABLE_NAME, k.REFERENCED_COLUMN_NAME, k.ORDINAL_POSITION, r.UPDATE_RULE, r.DELETE_RULE
                         FROM information_schema.KEY_COLUMN_USAGE k
                         JOIN information_schema.REFERENTIAL_CONSTRAINTS r
                           ON k.CONSTRAINT_SCHEMA = r.CONSTRAINT_SCHEMA
                          AND k.CONSTRAINT_NAME = r.CONSTRAINT_NAME
                          AND k.TABLE_NAME = r.TABLE_NAME
                         WHERE k.TABLE_SCHEMA = '${dbLiteral}'
                           AND k.TABLE_NAME = '${tableLiteral}'
                           AND k.REFERENCED_TABLE_NAME IS NOT NULL
                         ORDER BY k.CONSTRAINT_NAME, k.ORDINAL_POSITION`,
          ),
          dbQuery(
            profileId,
            `SELECT tc.CONSTRAINT_NAME, cc.CHECK_CLAUSE
                         FROM information_schema.TABLE_CONSTRAINTS tc
                         JOIN information_schema.CHECK_CONSTRAINTS cc
                           ON tc.CONSTRAINT_SCHEMA = cc.CONSTRAINT_SCHEMA
                          AND tc.CONSTRAINT_NAME = cc.CONSTRAINT_NAME
                         WHERE tc.CONSTRAINT_SCHEMA = '${dbLiteral}'
                           AND tc.TABLE_NAME = '${tableLiteral}'
                           AND tc.CONSTRAINT_TYPE = 'CHECK'
                         ORDER BY tc.CONSTRAINT_NAME`,
          ),
          dbQuery(
            profileId,
            `SELECT ENGINE, TABLE_COLLATION, AUTO_INCREMENT, AVG_ROW_LENGTH, CHECKSUM, ROW_FORMAT, CREATE_OPTIONS, TABLE_COMMENT
                         FROM information_schema.TABLES
                         WHERE TABLE_SCHEMA = '${dbLiteral}' AND TABLE_NAME = '${tableLiteral}'
                         LIMIT 1`,
          ),
        ]);

        if (cancelled) return;

        const colRows = colRes[0]?.rows ?? [];
        if (colRows.length === 0) {
          throw new Error(
            `Table \`${tableName}\` not found or has no readable schema.`,
          );
        }

        const loadedColumns: ColumnDef[] = colRows.map((row) => {
          const parsed = parseColumnType(toText(row[1]));
          const extra = toText(row[4]).toUpperCase();
          const virtuality = extra.includes("VIRTUAL GENERATED")
            ? "VIRTUAL"
            : extra.includes("STORED GENERATED")
              ? "STORED"
              : "";

          return {
            id: uid(),
            name: toText(row[0]).trim(),
            datatype: parsed.datatype,
            length: parsed.length,
            unsigned: parsed.unsigned,
            allowNull: toText(row[2]).toUpperCase() === "YES",
            zerofill: parsed.zerofill,
            defaultVal: toText(row[3]),
            comment: toText(row[5]),
            collation: toText(row[6]),
            expression: toText(row[7]),
            virtuality,
          };
        });

        const idxRows = idxRes[0]?.rows ?? [];
        const idxMap = new Map<
          string,
          {
            id: string;
            name: string;
            type: string;
            algorithm: string;
            comment: string;
            cols: Array<{ seq: number; name: string }>;
          }
        >();
        for (const row of idxRows) {
          const keyName = toText(row[2]).trim();
          const columnName = toText(row[4]).trim();
          if (!keyName || !columnName) continue;

          const seq = Number(row[3] ?? 0);
          const nonUnique = Number(row[1] ?? 1);
          const rawType = toText(row[10]).toUpperCase();
          const type =
            keyName.toUpperCase() === "PRIMARY"
              ? "PRIMARY"
              : rawType === "FULLTEXT"
                ? "FULLTEXT"
                : rawType === "SPATIAL"
                  ? "SPATIAL"
                  : nonUnique === 0
                    ? "UNIQUE"
                    : "INDEX";
          const algorithm =
            rawType === "BTREE" || rawType === "HASH" ? rawType : "";
          const comment = toText(row[12]).trim();

          const found = idxMap.get(keyName);
          if (found) {
            found.cols.push({ seq, name: columnName });
          } else {
            idxMap.set(keyName, {
              id: uid(),
              name: keyName,
              type,
              algorithm,
              comment,
              cols: [{ seq, name: columnName }],
            });
          }
        }
        const loadedIndexes: IndexDef[] = Array.from(idxMap.values()).map(
          (i) => ({
            id: i.id,
            name: i.name,
            type: i.type,
            columns: [...i.cols]
              .sort((a, b) => a.seq - b.seq)
              .map((c) => c.name),
            algorithm: i.algorithm,
            comment: i.comment,
          }),
        );

        const fkRows = fkRes[0]?.rows ?? [];
        const fkMap = new Map<
          string,
          {
            id: string;
            name: string;
            refTable: string;
            onUpdate: string;
            onDelete: string;
            cols: Array<{ seq: number; name: string }>;
            refCols: Array<{ seq: number; name: string }>;
          }
        >();
        for (const row of fkRows) {
          const nameKey = toText(row[0]).trim();
          if (!nameKey) continue;
          const seq = Number(row[4] ?? 0);
          const localCol = toText(row[1]).trim();
          const refTable = toText(row[2]).trim();
          const refCol = toText(row[3]).trim();
          const onUpdate = toText(row[5]).trim().toUpperCase() || "RESTRICT";
          const onDelete = toText(row[6]).trim().toUpperCase() || "RESTRICT";

          const found = fkMap.get(nameKey);
          if (found) {
            found.cols.push({ seq, name: localCol });
            found.refCols.push({ seq, name: refCol });
          } else {
            fkMap.set(nameKey, {
              id: uid(),
              name: nameKey,
              refTable,
              onUpdate,
              onDelete,
              cols: [{ seq, name: localCol }],
              refCols: [{ seq, name: refCol }],
            });
          }
        }
        const loadedFks: ForeignKeyDef[] = Array.from(fkMap.values()).map(
          (f) => ({
            id: f.id,
            name: f.name,
            columns: [...f.cols]
              .sort((a, b) => a.seq - b.seq)
              .map((c) => c.name),
            refTable: f.refTable,
            refColumns: [...f.refCols]
              .sort((a, b) => a.seq - b.seq)
              .map((c) => c.name),
            onUpdate: normalizeRule(f.onUpdate),
            onDelete: normalizeRule(f.onDelete),
          }),
        );

        const checkRows = checkRes[0]?.rows ?? [];
        const loadedChecks: CheckConstraintDef[] = checkRows.map((row) => ({
          id: uid(),
          name: toText(row[0]).trim(),
          expression: toText(row[1]).trim(),
        }));

        const optRow = optionRes[0]?.rows?.[0];
        const createOptions = toText(optRow?.[6]);
        const insertMethodMatch = createOptions.match(
          /insert_method=([A-Za-z]+)/i,
        );
        const insertMethod = insertMethodMatch
          ? insertMethodMatch[1].toUpperCase()
          : "";

        const maxRowsMatch = createOptions.match(/max_rows=(\d+)/i);
        const maxRows = maxRowsMatch ? maxRowsMatch[1] : "";

        const rowFormat = toText(optRow?.[5]).toUpperCase();
        const loadedOptions: TableOptions = {
          engine: toText(optRow?.[0]) || "<Server default>",
          collation: toText(optRow?.[1]),
          autoIncrement: toText(optRow?.[2]),
          avgRowLength: toText(optRow?.[3]),
          maxRows: maxRows,
          checksum: Number(optRow?.[4] ?? 0) > 0,
          rowFormat: ROW_FORMATS.includes(rowFormat) ? rowFormat : "DEFAULT",
          insertMethod: INSERT_METHODS.includes(insertMethod)
            ? insertMethod
            : "",
          comment: toText(optRow?.[7]),
        };
        const loadedComment = toText(optRow?.[7]);

        const snapshot = makeSnapshot({
          name: tableName,
          tableComment: loadedComment,
          columns: loadedColumns,
          indexes: loadedIndexes,
          foreignKeys: loadedFks,
          checkConstraints: loadedChecks,
          options: loadedOptions,
        });

        setName(snapshot.name);
        setTableComment(snapshot.tableComment);
        setColumns(snapshot.columns);
        setIndexes(snapshot.indexes);
        setForeignKeys(snapshot.foreignKeys);
        setCheckConstraints(snapshot.checkConstraints);
        setOptions(snapshot.options);
        setSelectedColumn(snapshot.columns[0]?.id || null);
        setSelectedIndex(snapshot.indexes[0]?.id || null);
        setSelectedFK(snapshot.foreignKeys[0]?.id || null);
        setSelectedCheck(snapshot.checkConstraints[0]?.id || null);
        setLoadedSnapshot(snapshot);
      } catch (e) {
        if (!cancelled) {
          setError(String(e));
          notifyError("Failed to Load Table", String(e));
        }
      } finally {
        if (!cancelled) {
          setLoadingSchema(false);
        }
      }
    };

    loadExistingTable();
    return () => {
      cancelled = true;
    };
  }, [profileId, database, tableName, isEditMode]);

  // ── Column CRUD ───────────────────────────────────────────
  const addColumn = useCallback(() => {
    const col = newColumn();
    setColumns((prev) => [...prev, col]);
    setSelectedColumn(col.id);
  }, []);

  const removeColumn = useCallback(() => {
    if (!selectedColumn) return;
    setColumns((prev) => {
      const idx = prev.findIndex((c) => c.id === selectedColumn);
      const next = prev.filter((c) => c.id !== selectedColumn);
      setSelectedColumn(
        next.length > 0
          ? next[Math.min(idx, next.length - 1)]?.id || null
          : null,
      );
      return next;
    });
  }, [selectedColumn]);

  const moveColumn = useCallback(
    (dir: -1 | 1) => {
      if (!selectedColumn) return;
      setColumns((prev) => {
        const idx = prev.findIndex((c) => c.id === selectedColumn);
        const newIdx = idx + dir;
        if (newIdx < 0 || newIdx >= prev.length) return prev;
        const next = [...prev];
        [next[idx], next[newIdx]] = [next[newIdx], next[idx]];
        return next;
      });
    },
    [selectedColumn],
  );

  const updateColumn = useCallback(
    (id: string, field: keyof ColumnDef, value: any) => {
      setColumns((prev) =>
        prev.map((c) => (c.id === id ? { ...c, [field]: value } : c)),
      );
    },
    [],
  );

  // ── Index CRUD ────────────────────────────────────────────
  const addIndex = useCallback(() => {
    const idx = newIndex();
    setIndexes((prev) => [...prev, idx]);
    setSelectedIndex(idx.id);
  }, []);

  const removeIndex = useCallback(() => {
    if (!selectedIndex) return;
    setIndexes((prev) => prev.filter((i) => i.id !== selectedIndex));
    setSelectedIndex(null);
  }, [selectedIndex]);

  const updateIndex = useCallback(
    (id: string, field: keyof IndexDef, value: any) => {
      setIndexes((prev) =>
        prev.map((i) => (i.id === id ? { ...i, [field]: value } : i)),
      );
    },
    [],
  );

  // ── FK CRUD ───────────────────────────────────────────────
  const addFK = useCallback(() => {
    const fk = newForeignKey();
    setForeignKeys((prev) => [...prev, fk]);
    setSelectedFK(fk.id);
  }, []);

  const removeFK = useCallback(() => {
    if (!selectedFK) return;
    setForeignKeys((prev) => prev.filter((f) => f.id !== selectedFK));
    setSelectedFK(null);
  }, [selectedFK]);

  const updateFK = useCallback(
    (id: string, field: keyof ForeignKeyDef, value: any) => {
      setForeignKeys((prev) =>
        prev.map((f) => (f.id === id ? { ...f, [field]: value } : f)),
      );
    },
    [],
  );

  // ── Check CRUD ────────────────────────────────────────────
  const addCheck = useCallback(() => {
    const ch = newCheckConstraint();
    setCheckConstraints((prev) => [...prev, ch]);
    setSelectedCheck(ch.id);
  }, []);

  const removeCheck = useCallback(() => {
    if (!selectedCheck) return;
    setCheckConstraints((prev) => prev.filter((c) => c.id !== selectedCheck));
    setSelectedCheck(null);
  }, [selectedCheck]);

  const updateCheck = useCallback(
    (id: string, field: keyof CheckConstraintDef, value: any) => {
      setCheckConstraints((prev) =>
        prev.map((c) => (c.id === id ? { ...c, [field]: value } : c)),
      );
    },
    [],
  );

  // ── SQL Generation ────────────────────────────────────────
  const currentSnapshot = useMemo(
    () =>
      makeSnapshot({
        name: name.trim(),
        tableComment,
        columns,
        indexes,
        foreignKeys,
        checkConstraints,
        options,
      }),
    [
      name,
      tableComment,
      columns,
      indexes,
      foreignKeys,
      checkConstraints,
      options,
    ],
  );

  const duplicateColumnName = useMemo(() => {
    const seen = new Set<string>();
    for (const col of columns) {
      const key = col.name.trim().toLowerCase();
      if (!key) continue;
      if (seen.has(key)) return col.name.trim();
      seen.add(key);
    }
    return "";
  }, [columns]);

  const validationError = useMemo(() => {
    if (!name.trim()) return "Table name is required.";
    const namedColumns = columns.filter((c) => c.name.trim());
    if (namedColumns.length === 0)
      return "Add at least one column before saving.";
    if (duplicateColumnName)
      return `Duplicate column name: ${duplicateColumnName}`;

    const existingCols = new Set(namedColumns.map((c) => c.name.trim()));
    for (const idx of indexes) {
      for (const col of idx.columns) {
        if (!existingCols.has(col.trim())) {
          return `Index "${idx.name || idx.type}" references missing column "${col}".`;
        }
      }
    }
    for (const fk of foreignKeys) {
      for (const col of fk.columns) {
        if (!existingCols.has(col.trim())) {
          return `Foreign key "${fk.name || "(unnamed)"}" references missing column "${col}".`;
        }
      }
    }
    return "";
  }, [name, columns, indexes, foreignKeys, duplicateColumnName]);

  const hasChanges = useMemo(() => {
    if (!isEditMode || !loadedSnapshot) return true;
    return (
      snapshotSignature(loadedSnapshot) !== snapshotSignature(currentSnapshot)
    );
  }, [isEditMode, loadedSnapshot, currentSnapshot]);

  const previewSQL = useMemo(() => {
    if (isEditMode) {
      if (!loadedSnapshot) return "-- Loading table definition...";
      const sql = alterTableSql(database, loadedSnapshot, currentSnapshot);
      return sql || "-- No schema changes";
    }
    return createTableSql(database, currentSnapshot);
  }, [isEditMode, loadedSnapshot, database, currentSnapshot]);

  // ── Save handlers ─────────────────────────────────────────
  const handleSave = () => {
    if (loadingSchema) return;

    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Table name is required.");
      return;
    }
    if (validationError) {
      setError(validationError);
      return;
    }

    const nextSnapshot = makeSnapshot({
      name: trimmedName,
      tableComment,
      columns,
      indexes,
      foreignKeys,
      checkConstraints,
      options,
    });

    if (isEditMode) {
      if (!loadedSnapshot) {
        setError("Table schema is still loading. Please wait.");
        return;
      }
      const sql = alterTableSql(database, loadedSnapshot, nextSnapshot) || "";
      if (!sql) {
        setSuccess("No changes to save.");
        return;
      }
    } else {
      const sql = createTableSql(database, nextSnapshot);
      if (sql.startsWith("--")) {
        setError(sql.replace(/^--\s*/, ""));
        return;
      }
    }

    setShowSaveModal(true);
  };

  const executeSave = async () => {
    setShowSaveModal(false);
    const trimmedName = name.trim();
    const nextSnapshot = makeSnapshot({
      name: trimmedName,
      tableComment,
      columns,
      indexes,
      foreignKeys,
      checkConstraints,
      options,
    });

    const sql = isEditMode
      ? alterTableSql(database, loadedSnapshot!, nextSnapshot) || ""
      : createTableSql(database, nextSnapshot);

    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      await dbExecuteQuery(profileId, sql);

      const tableDesignerTab = {
        title: trimmedName,
        type: "table-designer" as const,
        meta: { profileId, database, tableName: trimmedName },
      };

      // Ensure dirty flag is cleared before closing so we don't get prompted
      if (tabId && leafId) {
        updateTab(tabId, { dirty: false });
        // Small timeout ensures react renders the non-dirty state before close
        setTimeout(() => {
          openTab(tableDesignerTab, leafId);
          closeTab(tabId, leafId); // Assuming we are in the same leaf
        }, 50);
      } else {
        openTab(tableDesignerTab);
      }

      setName(trimmedName);
      if (isEditMode) {
        setLoadedSnapshot(nextSnapshot);
        setSuccess(`Table \`${trimmedName}\` updated successfully.`);
      } else {
        setSuccess(`Table \`${trimmedName}\` created successfully.`);
      }
      // Refresh schema cache and local table list
      useSchemaStore.getState().refreshTables(profileId, database);
      dbListTables(profileId, database)
        .then(setTables)
        .catch(() => { });
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  const handleDiscard = () => {
    if (isEditMode && loadedSnapshot) {
      const snap = makeSnapshot(loadedSnapshot);
      setName(snap.name);
      setTableComment(snap.tableComment);
      setColumns(snap.columns);
      setIndexes(snap.indexes);
      setForeignKeys(snap.foreignKeys);
      setCheckConstraints(snap.checkConstraints);
      setOptions(snap.options);
      setSelectedColumn(snap.columns[0]?.id || null);
      setSelectedIndex(snap.indexes[0]?.id || null);
      setSelectedFK(snap.foreignKeys[0]?.id || null);
      setSelectedCheck(snap.checkConstraints[0]?.id || null);
    } else {
      setName("");
      setTableComment("");
      setColumns([]);
      setSelectedColumn(null);
      setIndexes([]);
      setSelectedIndex(null);
      setForeignKeys([]);
      setSelectedFK(null);
      setCheckConstraints([]);
      setSelectedCheck(null);
      setOptions({
        ...EMPTY_TABLE_OPTIONS,
        collation:
          options.collation && collations.includes(options.collation)
            ? options.collation
            : EMPTY_TABLE_OPTIONS.collation,
      });
    }
    setError(null);
    setSuccess(null);
  };

  // ═══════════════════════════════════════════════════════════
  //  Render sub-tabs
  // ═══════════════════════════════════════════════════════════

  const subTabs = useMemo<
    { key: SubTab; label: string; icon: React.ReactNode; badge?: string }[]
  >(
    () => [
      {
        key: "basic",
        label: "Basic",
        icon: <Table2 className="w-3.5 h-3.5" />,
      },
      {
        key: "options",
        label: "Options",
        icon: <Settings className="w-3.5 h-3.5" />,
      },
      {
        key: "indexes",
        label: `Indexes (${indexes.length})`,
        icon: <Zap className="w-3.5 h-3.5" />,
      },
      {
        key: "foreign-keys",
        label: `Foreign keys (${foreignKeys.length})`,
        icon: <Link2 className="w-3.5 h-3.5" />,
      },
      {
        key: "check-constraints",
        label: `Check constraints (${checkConstraints.length})`,
        icon: <CheckCircle className="w-3.5 h-3.5" />,
      },
      {
        key: "partitions",
        label: "Partitions",
        icon: <Circle className="w-3.5 h-3.5" />,
      },
      {
        key: "create-code",
        label: isEditMode ? "ALTER preview" : "CREATE code",
        icon: <Code className="w-3.5 h-3.5" />,
      },
    ],
    [indexes.length, foreignKeys.length, checkConstraints.length, isEditMode],
  );

  const colNames = useMemo(
    () => columns.filter((c) => c.name.trim()).map((c) => c.name),
    [columns],
  );

  const displayColumns = useMemo<DisplayColumnDef[]>(() => {
    if (!isEditMode || !loadedSnapshot) {
      return columns.map((c) => ({ ...c, _diffState: "added" }));
    }
    const currentMap = new Map(columns.map((c) => [c.id, c]));
    const loadedMap = new Map(loadedSnapshot.columns.map((c) => [c.id, c]));

    const out: DisplayColumnDef[] = [];

    for (const col of columns) {
      let state: "added" | "modified" | undefined = undefined;
      const old = loadedMap.get(col.id);
      if (!old) {
        state = "added";
      } else if (
        normalizedColumnSignature(col) !== normalizedColumnSignature(old)
      ) {
        state = "modified";
      }
      out.push({ ...col, _diffState: state });
    }

    for (const old of loadedSnapshot.columns) {
      if (!currentMap.has(old.id)) {
        out.push({ ...old, _diffState: "deleted" });
      }
    }

    return out;
  }, [isEditMode, loadedSnapshot, columns]);
  const saveDisabled =
    saving ||
    loadingSchema ||
    !name.trim() ||
    !!validationError ||
    (isEditMode && !hasChanges);
  const saveHint = loadingSchema
    ? "Loading schema..."
    : validationError
      ? validationError
      : isEditMode && !hasChanges
        ? "No changes to save."
        : "";

  return (
    <div
      ref={containerRef}
      className="relative flex flex-col w-full h-full bg-background text-foreground text-xs overflow-hidden"
    >
      {/* ─── Sub-tab bar ─────────────────────────────── */}
      <div className="flex items-center border-b bg-muted/30 px-1 gap-0 overflow-x-auto shrink-0">
        {subTabs.map((t) => (
          <button
            key={t.key}
            className={cn(
              "flex items-center gap-1.5 px-3 py-2 text-xs transition-colors border-b-2 whitespace-nowrap",
              activeTab === t.key
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground hover:bg-accent/30",
            )}
            onClick={() => setActiveTab(t.key)}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
        <div className="flex-1" />
        <div className="flex items-center gap-1 px-2 border-l">
          <button
            title="Undo (Ctrl+Z)"
            disabled={historyIndex <= 0}
            className={cn(
              "p-1.5 rounded transition-colors",
              historyIndex <= 0
                ? "text-muted-foreground/30"
                : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
            )}
            onClick={undo}
          >
            <Undo className="w-3.5 h-3.5" />
          </button>
          <button
            title="Redo (Ctrl+Shift+Z)"
            disabled={historyIndex >= history.length - 1}
            className={cn(
              "p-1.5 rounded transition-colors",
              historyIndex >= history.length - 1
                ? "text-muted-foreground/30"
                : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
            )}
            onClick={redo}
          >
            <Redo className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {
        loadingSchema && (
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-background/70 backdrop-blur-[1px]">
            <div className="inline-flex items-center gap-2 rounded border bg-secondary/70 px-3 py-2 text-xs text-foreground">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Loading table structure...
            </div>
          </div>
        )
      }

      {/* ─── Upper area: Sub-tab content ─────────────── */}
      <div
        className="shrink-0 overflow-auto"
        style={{ height: `${splitPercent}%` }}
      >
        {/* ── Basic Tab ─────────────────────── */}
        {activeTab === "basic" && (
          <div className="px-3 pt-3 pb-2 space-y-2">
            <div className="flex items-center gap-2">
              <label className="text-xs text-muted-foreground w-17.5 shrink-0 text-right">
                Name:
              </label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={isEditMode}
                className={cn(
                  "flex-1 h-7 rounded bg-secondary/50 border px-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary font-mono",
                  isEditMode && "opacity-70 cursor-not-allowed",
                )}
                placeholder="Enter table name"
              />
            </div>
            {isEditMode && (
              <div className="pl-19.5 text-[10px] text-muted-foreground/70">
                Rename is disabled in edit mode to keep ALTER statements
                predictable.
              </div>
            )}
            <div className="flex items-start gap-2">
              <label className="text-xs text-muted-foreground w-17.5 shrink-0 text-right pt-1">
                Comment:
              </label>
              <textarea
                value={tableComment}
                onChange={(e) => setTableComment(e.target.value)}
                className="flex-1 h-14 rounded bg-secondary/50 border px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-primary font-mono resize-none"
              />
            </div>
          </div>
        )}

        {/* ── Options Tab ───────────────────── */}
        {activeTab === "options" && (
          <div className="p-3 grid grid-cols-2 gap-x-6 gap-y-2">
            <OptRow label="Auto increment:">
              <OptInput
                value={options.autoIncrement}
                onChange={(v) =>
                  setOptions((o) => ({ ...o, autoIncrement: v }))
                }
              />
            </OptRow>
            <OptRow label="Default collation:">
              <OptSelect
                value={options.collation}
                onChange={(v) => setOptions((o) => ({ ...o, collation: v }))}
                options={["", ...collations]}
              />
            </OptRow>
            <OptRow label="Average row length:">
              <OptInput
                value={options.avgRowLength}
                onChange={(v) => setOptions((o) => ({ ...o, avgRowLength: v }))}
              />
            </OptRow>
            <OptRow label="Engine:">
              <OptSelect
                value={options.engine}
                onChange={(v) => setOptions((o) => ({ ...o, engine: v }))}
                options={ENGINES}
              />
            </OptRow>
            <OptRow label="Maximum row count:">
              <OptInput
                value={options.maxRows}
                onChange={(v) => setOptions((o) => ({ ...o, maxRows: v }))}
              />
            </OptRow>
            <OptRow label="Row format:">
              <OptSelect
                value={options.rowFormat}
                onChange={(v) => setOptions((o) => ({ ...o, rowFormat: v }))}
                options={ROW_FORMATS}
              />
            </OptRow>
            <OptRow label="Checksum for rows:">
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={options.checksum}
                  onChange={(e) =>
                    setOptions((o) => ({ ...o, checksum: e.target.checked }))
                  }
                />
              </label>
            </OptRow>
            <OptRow label="INSERT method:">
              <OptSelect
                value={options.insertMethod}
                onChange={(v) => setOptions((o) => ({ ...o, insertMethod: v }))}
                options={INSERT_METHODS}
              />
            </OptRow>
          </div>
        )}

        {/* ── Indexes Tab ───────────────────── */}
        {activeTab === "indexes" && (
          <div className="flex overflow-hidden" style={{ minHeight: 120 }}>
            <div className="flex flex-col shrink-0">
              <div className="flex items-center gap-1 px-3 py-1.5 border-b">
                <ToolBtn
                  icon={<Plus className="w-3 h-3" />}
                  label="Add"
                  onClick={addIndex}
                  color="text-green-500"
                />
                <ToolBtn
                  icon={<Trash2 className="w-3 h-3" />}
                  label="Remove"
                  onClick={removeIndex}
                  color="text-red-500"
                  disabled={!selectedIndex}
                />
              </div>
              <div className="w-62.5 border-r overflow-y-auto flex-1">
                {indexes.length === 0 && (
                  <div className="p-3 text-muted-foreground/50 text-center">
                    No indexes defined
                  </div>
                )}
                {indexes.map((idx) => (
                  <div
                    key={idx.id}
                    className={cn(
                      "px-3 py-2 cursor-pointer border-b transition-colors",
                      selectedIndex === idx.id
                        ? "bg-accent/60"
                        : "hover:bg-accent/20",
                    )}
                    onClick={() => setSelectedIndex(idx.id)}
                  >
                    <div className="font-medium">{idx.name || "(unnamed)"}</div>
                    <div className="text-muted-foreground/60">
                      {idx.type} · {idx.columns.length} col(s)
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="flex-1 p-3 overflow-auto">
              {selectedIndex ? (
                (() => {
                  const idx = indexes.find((i) => i.id === selectedIndex);
                  if (!idx) return null;
                  return (
                    <div className="space-y-3">
                      <div className="flex items-center gap-2">
                        <label className="w-25 text-right text-muted-foreground shrink-0">
                          Name:
                        </label>
                        <input
                          value={idx.name}
                          onChange={(e) =>
                            updateIndex(idx.id, "name", e.target.value)
                          }
                          className="flex-1 h-7 rounded bg-secondary/50 border px-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-primary"
                        />
                      </div>
                      <div className="flex items-center gap-2">
                        <label className="w-25 text-right text-muted-foreground shrink-0">
                          Type:
                        </label>
                        <select
                          value={idx.type}
                          onChange={(e) =>
                            updateIndex(idx.id, "type", e.target.value)
                          }
                          className="h-7 rounded bg-secondary/50 border px-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                        >
                          {INDEX_TYPES.map((t) => (
                            <option key={t} value={t}>
                              {t}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="flex items-center gap-2">
                        <label className="w-25 text-right text-muted-foreground shrink-0">
                          Algorithm:
                        </label>
                        <select
                          value={idx.algorithm}
                          onChange={(e) =>
                            updateIndex(idx.id, "algorithm", e.target.value)
                          }
                          className="h-7 rounded bg-secondary/50 border px-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                        >
                          {INDEX_ALGORITHMS.map((a) => (
                            <option key={a} value={a}>
                              {a || "(default)"}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="flex items-start gap-2">
                        <label className="w-25 text-right text-muted-foreground shrink-0 pt-1">
                          Columns:
                        </label>
                        <div className="flex-1 space-y-1">
                          {colNames.map((cn) => (
                            <label
                              key={cn}
                              className="flex items-center gap-1.5 cursor-pointer"
                            >
                              <input
                                type="checkbox"
                                checked={idx.columns.includes(cn)}
                                onChange={(e) => {
                                  const next = e.target.checked
                                    ? [...idx.columns, cn]
                                    : idx.columns.filter((c) => c !== cn);
                                  updateIndex(idx.id, "columns", next);
                                }}
                              />
                              <span className="font-mono">{cn}</span>
                            </label>
                          ))}
                          {colNames.length === 0 && (
                            <span className="text-muted-foreground/50">
                              Add columns below first
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <label className="w-25 text-right text-muted-foreground shrink-0">
                          Comment:
                        </label>
                        <input
                          value={idx.comment}
                          onChange={(e) =>
                            updateIndex(idx.id, "comment", e.target.value)
                          }
                          className="flex-1 h-7 rounded bg-secondary/50 border px-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-primary"
                        />
                      </div>
                    </div>
                  );
                })()
              ) : (
                <div className="text-muted-foreground/50 text-center mt-8">
                  Select an index or add a new one
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Foreign Keys Tab ──────────────── */}
        {activeTab === "foreign-keys" && (
          <div className="flex overflow-hidden" style={{ minHeight: 120 }}>
            <div className="flex flex-col shrink-0">
              <div className="flex items-center gap-1 px-3 py-1.5 border-b">
                <ToolBtn
                  icon={<Plus className="w-3 h-3" />}
                  label="Add"
                  onClick={addFK}
                  color="text-green-500"
                />
                <ToolBtn
                  icon={<Trash2 className="w-3 h-3" />}
                  label="Remove"
                  onClick={removeFK}
                  color="text-red-500"
                  disabled={!selectedFK}
                />
              </div>
              <div className="w-62.5 border-r overflow-y-auto flex-1">
                {foreignKeys.length === 0 && (
                  <div className="p-3 text-muted-foreground/50 text-center">
                    No foreign keys defined
                  </div>
                )}
                {foreignKeys.map((fk) => (
                  <div
                    key={fk.id}
                    className={cn(
                      "px-3 py-2 cursor-pointer border-b transition-colors",
                      selectedFK === fk.id
                        ? "bg-accent/60"
                        : "hover:bg-accent/20",
                    )}
                    onClick={() => setSelectedFK(fk.id)}
                  >
                    <div className="font-medium">{fk.name || "(unnamed)"}</div>
                    <div className="text-muted-foreground/60">
                      {fk.columns.join(", ")} → {fk.refTable || "?"}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="flex-1 p-3 overflow-auto">
              {selectedFK ? (
                (() => {
                  const fk = foreignKeys.find((f) => f.id === selectedFK);
                  if (!fk) return null;
                  return (
                    <div className="space-y-3">
                      <div className="flex items-center gap-2">
                        <label className="w-27.5 text-right text-muted-foreground shrink-0">
                          Key name:
                        </label>
                        <input
                          value={fk.name}
                          onChange={(e) =>
                            updateFK(fk.id, "name", e.target.value)
                          }
                          className="flex-1 h-7 rounded bg-secondary/50 border px-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-primary"
                        />
                      </div>
                      <div className="flex items-start gap-2">
                        <label className="w-27.5 text-right text-muted-foreground shrink-0 pt-1">
                          Columns:
                        </label>
                        <div className="flex-1 space-y-1">
                          {colNames.map((cn) => (
                            <label
                              key={cn}
                              className="flex items-center gap-1.5 cursor-pointer"
                            >
                              <input
                                type="checkbox"
                                checked={fk.columns.includes(cn)}
                                onChange={(e) => {
                                  const next = e.target.checked
                                    ? [...fk.columns, cn]
                                    : fk.columns.filter((c) => c !== cn);
                                  updateFK(fk.id, "columns", next);
                                }}
                              />
                              <span className="font-mono">{cn}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <label className="w-27.5 text-right text-muted-foreground shrink-0">
                          Reference table:
                        </label>
                        <select
                          value={fk.refTable}
                          onChange={(e) =>
                            updateFK(fk.id, "refTable", e.target.value)
                          }
                          className="flex-1 h-7 rounded bg-secondary/50 border px-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                        >
                          <option value="">-- select --</option>
                          {tables.map((t) => (
                            <option key={t} value={t}>
                              {t}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="flex items-center gap-2">
                        <label className="w-27.5 text-right text-muted-foreground shrink-0">
                          Foreign col(s):
                        </label>
                        <input
                          value={fk.refColumns.join(", ")}
                          onChange={(e) =>
                            updateFK(
                              fk.id,
                              "refColumns",
                              e.target.value
                                .split(",")
                                .map((s) => s.trim())
                                .filter(Boolean),
                            )
                          }
                          className="flex-1 h-7 rounded bg-secondary/50 border px-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-primary"
                          placeholder="col1, col2"
                        />
                      </div>
                      <div className="flex items-center gap-2">
                        <label className="w-27.5 text-right text-muted-foreground shrink-0">
                          On UPDATE:
                        </label>
                        <select
                          value={fk.onUpdate}
                          onChange={(e) =>
                            updateFK(fk.id, "onUpdate", e.target.value)
                          }
                          className="h-7 rounded bg-secondary/50 border px-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                        >
                          {ON_UPDATE_DELETE.map((v) => (
                            <option key={v} value={v}>
                              {v}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="flex items-center gap-2">
                        <label className="w-27.5 text-right text-muted-foreground shrink-0">
                          On DELETE:
                        </label>
                        <select
                          value={fk.onDelete}
                          onChange={(e) =>
                            updateFK(fk.id, "onDelete", e.target.value)
                          }
                          className="h-7 rounded bg-secondary/50 border px-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                        >
                          {ON_UPDATE_DELETE.map((v) => (
                            <option key={v} value={v}>
                              {v}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  );
                })()
              ) : (
                <div className="text-muted-foreground/50 text-center mt-8">
                  Select a foreign key or add a new one
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Check Constraints Tab ─────────── */}
        {activeTab === "check-constraints" && (
          <div className="flex overflow-hidden" style={{ minHeight: 120 }}>
            <div className="flex flex-col shrink-0">
              <div className="flex items-center gap-1 px-3 py-1.5 border-b">
                <ToolBtn
                  icon={<Plus className="w-3 h-3" />}
                  label="Add"
                  onClick={addCheck}
                  color="text-green-500"
                />
                <ToolBtn
                  icon={<Trash2 className="w-3 h-3" />}
                  label="Remove"
                  onClick={removeCheck}
                  color="text-red-500"
                  disabled={!selectedCheck}
                />
              </div>
              <div className="w-62.5 border-r overflow-y-auto flex-1">
                {checkConstraints.length === 0 && (
                  <div className="p-3 text-muted-foreground/50 text-center">
                    No check constraints
                  </div>
                )}
                {checkConstraints.map((ch) => (
                  <div
                    key={ch.id}
                    className={cn(
                      "px-3 py-2 cursor-pointer border-b transition-colors",
                      selectedCheck === ch.id
                        ? "bg-accent/60"
                        : "hover:bg-accent/20",
                    )}
                    onClick={() => setSelectedCheck(ch.id)}
                  >
                    <div className="font-medium">{ch.name || "(unnamed)"}</div>
                    <div className="text-muted-foreground/60 truncate">
                      {ch.expression || "..."}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="flex-1 p-3 overflow-auto">
              {selectedCheck ? (
                (() => {
                  const ch = checkConstraints.find(
                    (c) => c.id === selectedCheck,
                  );
                  if (!ch) return null;
                  return (
                    <div className="space-y-3">
                      <div className="flex items-center gap-2">
                        <label className="w-25 text-right text-muted-foreground shrink-0">
                          Name:
                        </label>
                        <input
                          value={ch.name}
                          onChange={(e) =>
                            updateCheck(ch.id, "name", e.target.value)
                          }
                          className="flex-1 h-7 rounded bg-secondary/50 border px-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-primary"
                        />
                      </div>
                      <div className="flex items-start gap-2">
                        <label className="w-25 text-right text-muted-foreground shrink-0 pt-1">
                          Expression:
                        </label>
                        <div className="flex-1 relative h-24 rounded bg-secondary/50 border overflow-hidden">
                          {ch.expression && (
                            <pre
                              className="absolute inset-0 pointer-events-none px-2 py-1 text-xs font-mono whitespace-pre-wrap wrap-break-word text-foreground z-0 overflow-hidden"
                              dangerouslySetInnerHTML={{
                                __html: highlightSQL(ch.expression),
                              }}
                            />
                          )}
                          <textarea
                            value={ch.expression}
                            onChange={(e) =>
                              updateCheck(ch.id, "expression", e.target.value)
                            }
                            className={cn(
                              "relative w-full h-full px-2 py-1 text-xs font-mono bg-transparent border-0 resize-none outline-none z-10",
                              ch.expression
                                ? "text-transparent caret-foreground"
                                : "text-foreground",
                            )}
                            placeholder="e.g. age > 0"
                            spellCheck={false}
                          />
                        </div>
                      </div>
                    </div>
                  );
                })()
              ) : (
                <div className="text-muted-foreground/50 text-center mt-8">
                  Select a constraint or add a new one
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Partitions Tab ────────────────── */}
        {activeTab === "partitions" && (
          <div className="flex items-center justify-center p-6 text-muted-foreground/50">
            <div className="text-center">
              <Circle className="w-8 h-8 mx-auto mb-2 opacity-30" />
              <div>Partitions (coming soon)</div>
            </div>
          </div>
        )}

        {activeTab === "create-code" && (
          <div className="overflow-auto p-3">
            <pre
              className="text-[11px] bg-secondary/30 border rounded p-3 font-mono whitespace-pre-wrap text-foreground leading-relaxed min-h-25 select-text"
              dangerouslySetInnerHTML={{ __html: highlightSQL(previewSQL) }}
            />
          </div>
        )}
      </div>

      {/* ═══ Drag handle ═══════════════════════════════ */}
      <div
        className="shrink-0 border-y border-border cursor-row-resize hover:bg-primary/20 active:bg-primary/30 transition-colors group flex items-center justify-center"
        style={{ height: 5 }}
        onMouseDown={handleDragStart}
      >
        <div className="w-8 h-0.5 rounded bg-muted-foreground/20 group-hover:bg-primary/50 transition-colors" />
      </div>

      {/* ─── Columns grid — always visible ─────────────────────── */}
      <div className="flex flex-col flex-1 overflow-hidden">
        {/* Columns toolbar */}
        <div className="flex items-center gap-1 px-3 py-1.5 border-b shrink-0 bg-muted/20">
          <span className="text-xs text-muted-foreground mr-1 font-medium">
            Columns:
          </span>
          <ToolBtn
            icon={<Plus className="w-3 h-3" />}
            label="Add"
            onClick={addColumn}
            color="text-green-500"
          />
          <ToolBtn
            icon={<Trash2 className="w-3 h-3" />}
            label="Remove"
            onClick={removeColumn}
            color="text-red-500"
            disabled={columns.length === 0}
          />
          <ToolBtn
            icon={<ArrowUp className="w-3 h-3" />}
            label="Up"
            onClick={() => moveColumn(-1)}
            disabled={!selectedColumn}
          />
          <ToolBtn
            icon={<ArrowDown className="w-3 h-3" />}
            label="Down"
            onClick={() => moveColumn(1)}
            disabled={!selectedColumn}
          />
        </div>

        {/* Columns table */}
        <div className="flex-1 overflow-auto">
          <table className="w-full text-xs border-collapse min-w-225">
            <thead>
              <tr className="bg-muted/50 sticky top-0 z-10">
                <Th w={30}>#</Th>
                <Th w={140}>Name</Th>
                <Th w={120}>Datatype</Th>
                <Th w={80}>Length/Set</Th>
                <Th w={65}>Unsigned</Th>
                <Th w={75}>Allow NULL</Th>
                <Th w={60}>Zerofill</Th>
                <Th w={120}>Default</Th>
                <Th w={130}>Comment</Th>
                <Th w={130}>Collation</Th>
                <Th w={120}>Expression</Th>
                <Th w={80}>Virtuality</Th>
              </tr>
            </thead>
            <tbody>
              {displayColumns.length === 0 && (
                <tr>
                  <td
                    colSpan={12}
                    className="text-center py-6 text-muted-foreground/40"
                  >
                    No columns yet. Click <strong>Add</strong> to create one.
                  </td>
                </tr>
              )}
              {displayColumns.map((col, i) => (
                <ColumnRow
                  key={col.id}
                  col={col}
                  index={i}
                  isSelected={selectedColumn === col.id}
                  onSelect={setSelectedColumn}
                  onUpdate={updateColumn}
                  collations={collations}
                  onContextMenu={(e, colId) => {
                    e.preventDefault();
                    setSelectedColumn(colId);
                    setCtxMenu({
                      x: Math.min(e.clientX, window.innerWidth - 200),
                      y: Math.min(e.clientY, window.innerHeight - 150),
                      columnId: colId,
                    });
                  }}
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ─── Status / Error bar ──────────────────────── */}
      {
        (error || success) && (
          <div
            className={cn(
              "px-3 py-1.5 text-xs border-t shrink-0",
              error
                ? "bg-red-500/10 text-red-400"
                : "bg-green-500/10 text-green-400",
            )}
          >
            {error || success}
          </div>
        )
      }

      {/* ─── Bottom toolbar ─────────────────────────── */}
      <div className="flex items-center gap-2 px-3 py-2 border-t bg-muted/20 shrink-0">
        {saveHint && (
          <div className="text-[10px] text-muted-foreground/80 mr-2 truncate">
            {saveHint}
          </div>
        )}
        <div className="flex-1" />
        <button
          className="px-3 py-1.5 text-xs rounded border hover:bg-accent transition-colors disabled:opacity-50"
          onClick={handleDiscard}
          disabled={loadingSchema || saving}
        >
          Discard
        </button>
        <button
          className="px-3 py-1.5 text-xs rounded bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center gap-1.5"
          onClick={handleSave}
          disabled={saveDisabled}
        >
          {saving && <Loader2 className="w-3 h-3 animate-spin" />}
          {saving ? "Saving..." : "Save"}
        </button>
      </div>

      {
        ctxMenu && (
          <div
            className="fixed z-100 min-w-48 bg-popover text-popover-foreground border rounded-md shadow-md p-1 text-xs"
            style={{ top: ctxMenu.y, left: ctxMenu.x }}
          >
            <ContextSubmenu
              label="Create new index"
              icon={<Zap className="w-3.5 h-3.5" />}
            >
              {INDEX_TYPES.map((type) => (
                <button
                  key={type}
                  className="w-full text-left px-2 py-1.5 hover:bg-accent rounded flex items-center gap-2"
                  onClick={() => handleCreateNewIndex(ctxMenu.columnId, type)}
                >
                  {type}
                </button>
              ))}
            </ContextSubmenu>
            {(() => {
              const col = columns.find((c) => c.id === ctxMenu.columnId);
              const colName = col ? col.name.trim() : "";
              const availableIndexes = indexes.filter(
                (idx) => !idx.columns.includes(colName),
              );
              if (!colName || availableIndexes.length === 0) return null;
              return (
                <ContextSubmenu
                  label="Add to index"
                  icon={<Plus className="w-3.5 h-3.5" />}
                >
                  {availableIndexes.map((idx) => (
                    <button
                      key={idx.id}
                      className="w-full text-left px-2 py-1.5 hover:bg-accent rounded flex items-center gap-2"
                      onClick={() => handleAddToIndex(ctxMenu.columnId, idx.id)}
                    >
                      {idx.name || `(unnamed ${idx.type})`}
                    </button>
                  ))}
                </ContextSubmenu>
              );
            })()}
          </div>
        )
      }

      {/* ── Save Modal ── */}
      {
        showSaveModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4">
            <div className="w-[600px] max-w-full bg-popover text-popover-foreground border rounded-lg shadow-lg flex flex-col overflow-hidden">
              <div className="px-4 py-3 border-b font-medium flex items-center gap-2">
                <Code className="w-4 h-4" />
                {isEditMode
                  ? "Review schema changes"
                  : "Review complete table schema"}
              </div>
              <div className="p-4 overflow-auto max-h-[60vh] bg-secondary/20">
                <pre
                  className="text-[11px] font-mono whitespace-pre-wrap leading-relaxed select-text"
                  dangerouslySetInnerHTML={{ __html: highlightSQL(previewSQL) }}
                />
              </div>
              <div className="px-4 py-3 border-t bg-muted/40 flex justify-end gap-2">
                <button
                  className="px-4 py-2 text-xs rounded border hover:bg-accent transition-colors disabled:opacity-50"
                  onClick={() => setShowSaveModal(false)}
                  disabled={saving}
                >
                  Cancel
                </button>
                <button
                  className="px-4 py-2 text-xs rounded bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center gap-2"
                  onClick={executeSave}
                  disabled={saving}
                >
                  {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  {isEditMode ? "Apply Changes" : "Create Table"}
                </button>
              </div>
            </div>
          </div>
        )
      }
    </div >
  );
}

// ═══════════════════════════════════════════════════════════════════════
//  Reusable sub-components
// ═══════════════════════════════════════════════════════════════════════

function ToolBtn({
  icon,
  label,
  onClick,
  color,
  disabled,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  color?: string;
  disabled?: boolean;
}) {
  return (
    <button
      className={cn(
        "flex items-center gap-1 px-2 py-1 rounded hover:bg-accent transition-colors text-xs",
        color,
        disabled && "opacity-40 pointer-events-none",
      )}
      onClick={onClick}
      disabled={disabled}
    >
      {icon}
      {label}
    </button>
  );
}

function Th({ children, w }: { children: React.ReactNode; w?: number }) {
  return (
    <th
      className="text-left px-1.5 py-1.5 text-[10px] font-medium text-muted-foreground/70 tracking-wider border-b border-r bg-muted/50 whitespace-nowrap"
      style={w ? { width: w, minWidth: w } : undefined}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <td className={cn("px-1 py-0 border-r h-7", className)}>{children}</td>
  );
}

const CellInput = memo(function CellInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full h-6.5 bg-transparent border-0 outline-none text-xs font-mono px-1 focus:bg-secondary/50"
      placeholder={placeholder}
    />
  );
});

const CellSelect = memo(function CellSelect({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full h-6.5 bg-transparent border-0 outline-none text-xs font-mono px-0 focus:bg-secondary/50 cursor-pointer"
    >
      {options.map((opt) => (
        <option key={opt} value={opt}>
          {opt || "(none)"}
        </option>
      ))}
    </select>
  );
});

const CellCheckbox = memo(function CellCheckbox({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <input
      type="checkbox"
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
      className="cursor-pointer"
    />
  );
});

const ColumnRow = memo(function ColumnRow({
  col,
  index,
  isSelected,
  onSelect,
  onUpdate,
  collations,
  onContextMenu,
}: {
  col: DisplayColumnDef;
  index: number;
  isSelected: boolean;
  onSelect: (id: string) => void;
  onUpdate: (id: string, field: keyof ColumnDef, value: unknown) => void;
  collations: string[];
  onContextMenu?: (e: React.MouseEvent, colId: string) => void;
}) {
  const collationOptions = useMemo(() => ["", ...collations], [collations]);

  const handleClick = useCallback(() => onSelect(col.id), [onSelect, col.id]);
  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      if (onContextMenu) onContextMenu(e, col.id);
    },
    [onContextMenu, col.id],
  );

  const handleName = useCallback(
    (v: string) => onUpdate(col.id, "name", v),
    [onUpdate, col.id],
  );
  const handleDatatype = useCallback(
    (v: string) => onUpdate(col.id, "datatype", v),
    [onUpdate, col.id],
  );
  const handleLength = useCallback(
    (v: string) => onUpdate(col.id, "length", v),
    [onUpdate, col.id],
  );
  const handleUnsigned = useCallback(
    (v: boolean) => onUpdate(col.id, "unsigned", v),
    [onUpdate, col.id],
  );
  const handleAllowNull = useCallback(
    (v: boolean) => onUpdate(col.id, "allowNull", v),
    [onUpdate, col.id],
  );
  const handleZerofill = useCallback(
    (v: boolean) => onUpdate(col.id, "zerofill", v),
    [onUpdate, col.id],
  );
  const handleDefault = useCallback(
    (v: string) => onUpdate(col.id, "defaultVal", v),
    [onUpdate, col.id],
  );
  const defaultSuggestions = useMemo(
    () => buildDefaultValueSuggestions(col),
    [col],
  );
  const handleComment = useCallback(
    (v: string) => onUpdate(col.id, "comment", v),
    [onUpdate, col.id],
  );
  const handleCollation = useCallback(
    (v: string) => onUpdate(col.id, "collation", v),
    [onUpdate, col.id],
  );
  const handleExpression = useCallback(
    (v: string) => onUpdate(col.id, "expression", v),
    [onUpdate, col.id],
  );
  const handleVirtuality = useCallback(
    (v: string) => onUpdate(col.id, "virtuality", v),
    [onUpdate, col.id],
  );

  const isDeleted = col._diffState === "deleted";

  return (
    <tr
      className={cn(
        "border-b cursor-pointer transition-colors",
        isSelected && !isDeleted ? "bg-accent/60" : "hover:bg-accent/20",
        col._diffState === "added" && "bg-green-500/10 hover:bg-green-500/20",
        col._diffState === "modified" && "bg-blue-500/10 hover:bg-blue-500/20",
        isDeleted &&
        "bg-red-500/10 hover:bg-red-500/20 line-through opacity-60 pointer-events-none",
      )}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
    >
      <Td className="text-center text-muted-foreground/50">{index + 1}</Td>
      <Td>
        <CellInput
          value={col.name}
          onChange={handleName}
          placeholder="Column name"
        />
      </Td>
      <Td>
        <CellSelect
          value={col.datatype}
          onChange={handleDatatype}
          options={MYSQL_DATA_TYPES}
        />
      </Td>
      <Td>
        <CellInput value={col.length} onChange={handleLength} placeholder="" />
      </Td>
      <Td className="text-center">
        <CellCheckbox checked={col.unsigned} onChange={handleUnsigned} />
      </Td>
      <Td className="text-center">
        <CellCheckbox checked={col.allowNull} onChange={handleAllowNull} />
      </Td>
      <Td className="text-center">
        <CellCheckbox checked={col.zerofill} onChange={handleZerofill} />
      </Td>
      <Td>
        <AutocompleteInput
          value={col.defaultVal}
          onChange={handleDefault}
          suggestions={defaultSuggestions}
          placeholder="No default"
          maxSuggestions={7}
          inputClassName="w-full h-6.5 bg-transparent border-0 outline-none text-xs font-mono px-1 focus:bg-secondary/50"
          dropdownClassName="max-h-50 overflow-y-auto border-border/70 rounded-sm"
          highlightHtml={
            col.defaultVal ? highlightSQL(col.defaultVal) : undefined
          }
          highlightClassName="h-6.5 px-1 py-[5px] text-xs leading-[16px] font-mono"
        />
      </Td>
      <Td>
        <CellInput value={col.comment} onChange={handleComment} />
      </Td>
      <Td>
        <CellSelect
          value={col.collation}
          onChange={handleCollation}
          options={collationOptions}
        />
      </Td>
      <Td>
        <AutocompleteInput
          value={col.expression}
          onChange={handleExpression}
          suggestions={[]}
          inputClassName="w-full h-6.5 bg-transparent border-0 outline-none text-xs font-mono px-1 focus:bg-secondary/50"
          highlightHtml={
            col.expression ? highlightSQL(col.expression) : undefined
          }
          highlightClassName="h-6.5 px-1 py-[5px] text-xs leading-[16px] font-mono"
        />
      </Td>
      <Td>
        <CellSelect
          value={col.virtuality}
          onChange={handleVirtuality}
          options={VIRTUALITY_OPTIONS}
        />
      </Td>
    </tr>
  );
});

function OptRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2">
      <label className="text-xs text-muted-foreground w-35 shrink-0 text-right">
        {label}
      </label>
      {children}
    </div>
  );
}

function OptInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="flex-1 h-7 rounded bg-secondary/50 border px-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-primary"
    />
  );
}

function OptSelect({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="flex-1 h-7 rounded bg-secondary/50 border px-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
    >
      {options.map((opt) => (
        <option key={opt} value={opt}>
          {opt || "(none)"}
        </option>
      ))}
    </select>
  );
}
