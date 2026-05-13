import { getComponentById } from "../../shared/components";
import { storage } from "../storage";
import {
  tableExists,
  getTableColumnInfo,
  getTableConstraintInfo,
  getTableIndexInfo,
} from "../storage/utils";
import * as mainSchema from "../../shared/schema";
import { PgDialect } from "drizzle-orm/pg-core";
import { is, SQL } from "drizzle-orm";

const dialect = new PgDialect();

const NAME_SYM = "drizzle:Name";
const COLUMNS_SYM = "drizzle:Columns";
const EXTRA_CONFIG_COLS_SYM = "drizzle:ExtraConfigColumns";
const EXTRA_CONFIG_BUILDER_SYM = "drizzle:ExtraConfigBuilder";
const INLINE_FKS_SYM = "drizzle:PgInlineForeignKeys";

interface PendingStatement {
  kind: "create_type" | "create_table" | "create_index";
  sql: string;
  key?: string;
}

export interface SchemaDriftReport {
  tableName: string;
  missingColumns: string[];
  typeMismatches: string[];
  missingConstraints: string[];
  missingIndexes: string[];
}

export class ComponentSchemaDriftError extends Error {
  reports: SchemaDriftReport[];
  constructor(reports: SchemaDriftReport[]) {
    super(formatDriftMessage(reports));
    this.name = "ComponentSchemaDriftError";
    this.reports = reports;
  }
}

function formatDriftMessage(reports: SchemaDriftReport[]): string {
  const lines: string[] = ["Schema drift detected:"];
  for (const r of reports) {
    lines.push(`  Table ${r.tableName}:`);
    if (r.missingColumns.length) lines.push(`    - missing columns: ${r.missingColumns.join(", ")}`);
    for (const m of r.typeMismatches) lines.push(`    - type mismatch: ${m}`);
    if (r.missingConstraints.length) lines.push(`    - missing constraints: ${r.missingConstraints.join(", ")}`);
    if (r.missingIndexes.length) lines.push(`    - missing indexes: ${r.missingIndexes.join(", ")}`);
  }
  return lines.join("\n");
}

export async function pushComponentSchema(componentId: string): Promise<void> {
  const component = getComponentById(componentId);

  if (!component) {
    throw new Error(`Component not found: ${componentId}`);
  }

  if (!component.managesSchema || !component.schemaManifest) {
    throw new Error(`Component ${componentId} does not manage a schema`);
  }

  let schemaModule: Record<string, unknown>;
  try {
    schemaModule = await loadSchemaModule(component.schemaManifest.schemaPath);
  } catch {
    schemaModule = mainSchema as unknown as Record<string, unknown>;
  }

  const enumsInModule = collectPgEnums(schemaModule);
  const enumsInMain = collectPgEnums(mainSchema as unknown as Record<string, unknown>);
  const allEnums = new Map<string, string[]>([...enumsInMain, ...enumsInModule]);

  const emittedEnumTypes = new Set<string>();
  const driftReports: SchemaDriftReport[] = [];

  for (const tableName of component.schemaManifest.tables) {
    const exists = await tableExists(tableName);

    let tableSchema = findTableInModule(schemaModule, tableName);
    if (!tableSchema) {
      tableSchema = findTableInModule(mainSchema as unknown as Record<string, unknown>, tableName);
    }
    if (!tableSchema) {
      throw new Error(`Table ${tableName} not found in schema module`);
    }

    if (!exists) {
      const statements = generateCreateStatements(tableSchema, tableName, allEnums, emittedEnumTypes);
      for (const stmt of statements) {
        if (stmt.kind === "create_type" && stmt.key) {
          if (emittedEnumTypes.has(stmt.key)) continue;
          emittedEnumTypes.add(stmt.key);
        }
        console.log(`[component-schema-push] ${stmt.kind} for ${tableName}`);
        await storage.rawSql.execute(stmt.sql);
      }
      console.log(`Table ${tableName} created successfully.`);
    } else {
      const report = await detectSchemaDrift(tableSchema, tableName);
      if (
        report.missingColumns.length ||
        report.typeMismatches.length ||
        report.missingConstraints.length ||
        report.missingIndexes.length
      ) {
        driftReports.push(report);
      } else {
        console.log(`Table ${tableName} already exists and matches schema.`);
      }
    }
  }

  if (driftReports.length > 0) {
    throw new ComponentSchemaDriftError(driftReports);
  }
}

async function loadSchemaModule(schemaPath: string): Promise<Record<string, unknown>> {
  const relativePath = schemaPath.replace(/^\.\//, "");
  const moduleUrl = new URL(`../../${relativePath}`, import.meta.url);
  return await import(moduleUrl.href);
}

function getSym(obj: any, description: string): symbol | undefined {
  return Object.getOwnPropertySymbols(obj).find((s) => s.description === description);
}

function getTableName(table: any): string | null {
  const sym = getSym(table, NAME_SYM);
  return sym ? (table[sym] as string) : null;
}

function findTableInModule(module: any, tableName: string): any {
  for (const value of Object.values(module)) {
    if (value && typeof value === "object") {
      if (getTableName(value) === tableName) {
        return value;
      }
    }
  }
  return null;
}

function getTableColumns(tableSchema: any): Record<string, any> {
  const sym = getSym(tableSchema, COLUMNS_SYM);
  return sym ? tableSchema[sym] : {};
}

function getInlineForeignKeys(tableSchema: any): any[] {
  const sym = getSym(tableSchema, INLINE_FKS_SYM);
  return sym ? (tableSchema[sym] as any[]) ?? [] : [];
}

function collectPgEnums(module: Record<string, unknown>): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (const value of Object.values(module)) {
    if (value && typeof value === "function") {
      const v = value as any;
      if (typeof v.enumName === "string" && Array.isArray(v.enumValues)) {
        result.set(v.enumName, v.enumValues);
      }
    }
  }
  return result;
}

export function generateCreateStatements(
  tableSchema: any,
  tableName: string,
  allEnums: Map<string, string[]>,
  alreadyEmittedEnums: Set<string> = new Set(),
): PendingStatement[] {
  const out: PendingStatement[] = [];
  const columns = getTableColumns(tableSchema);
  const columnDefs: string[] = [];
  const tableConstraints: string[] = [];
  const postStatements: PendingStatement[] = [];
  const enumsNeeded = new Set<string>();

  for (const [colKey, col] of Object.entries(columns) as [string, any][]) {
    const colDbName = col.name || colKey;
    const sqlType = resolveSqlType(col, tableName, colKey);

    if (col.columnType === "PgEnumColumn" && col.enum?.enumName) {
      enumsNeeded.add(col.enum.enumName);
    }

    let colDef = `"${colDbName}" ${sqlType}`;

    if (col.primary) {
      colDef += " PRIMARY KEY";
    }
    if (col.notNull) {
      colDef += " NOT NULL";
    }
    if (col.hasDefault && col.default !== undefined) {
      const defaultVal = formatDefault(col.default, tableName, colKey);
      colDef += ` DEFAULT ${defaultVal}`;
    }
    if (col.isUnique) {
      const ucName = col.uniqueName || `${tableName}_${colDbName}_unique`;
      tableConstraints.push(`CONSTRAINT "${ucName}" UNIQUE ("${colDbName}")`);
    }

    columnDefs.push(colDef);
  }

  for (const fk of getInlineForeignKeys(tableSchema)) {
    tableConstraints.push(renderForeignKey(fk, tableName));
  }

  const ebSym = getSym(tableSchema, EXTRA_CONFIG_BUILDER_SYM);
  const ecSym = getSym(tableSchema, EXTRA_CONFIG_COLS_SYM);
  if (ebSym && typeof tableSchema[ebSym] === "function") {
    const ecCols = ecSym ? tableSchema[ecSym] : columns;
    const cfg = tableSchema[ebSym](ecCols);
    const items: any[] = Array.isArray(cfg) ? cfg : Object.values(cfg ?? {});
    for (const item of items) {
      if (!item) continue;
      const ctor = item.constructor?.name;
      switch (ctor) {
        case "UniqueConstraintBuilder": {
          const cols = (item.columns ?? []).map((c: any) => `"${c.name}"`).join(", ");
          const name = item.name ?? `${tableName}_unique`;
          let stmt = `CONSTRAINT "${name}" UNIQUE`;
          if (item.nullsNotDistinctConfig) stmt += " NULLS NOT DISTINCT";
          stmt += ` (${cols})`;
          tableConstraints.push(stmt);
          break;
        }
        case "PrimaryKeyBuilder": {
          const cols = (item.columns ?? []).map((c: any) => `"${c.name}"`).join(", ");
          const name = item.name ?? `${tableName}_pk`;
          tableConstraints.push(`CONSTRAINT "${name}" PRIMARY KEY (${cols})`);
          break;
        }
        case "ForeignKeyBuilder": {
          const built = item.build(tableSchema);
          tableConstraints.push(renderForeignKey(built, tableName));
          break;
        }
        case "CheckBuilder": {
          const expr = renderSql(item.value, `check ${item.name} on ${tableName}`);
          tableConstraints.push(`CONSTRAINT "${item.name}" CHECK (${expr})`);
          break;
        }
        case "IndexBuilder":
        case "UniqueIndexBuilder": {
          postStatements.push({ kind: "create_index", sql: renderIndex(item, tableName) });
          break;
        }
        default:
          throw new Error(
            `[component-schema-push] Unrecognized extra-config builder "${ctor}" on table ${tableName}. ` +
            `Please add support for it in component-schema-push.ts.`,
          );
      }
    }
  }

  for (const enumName of enumsNeeded) {
    if (alreadyEmittedEnums.has(enumName)) continue;
    const values = allEnums.get(enumName);
    if (!values) {
      throw new Error(
        `[component-schema-push] Column on table ${tableName} references pgEnum "${enumName}" which was not found in the schema module.`,
      );
    }
    out.push({
      kind: "create_type",
      key: enumName,
      sql: renderCreateEnumType(enumName, values),
    });
  }

  const allDefs = [...columnDefs, ...tableConstraints];
  out.push({
    kind: "create_table",
    sql: `CREATE TABLE IF NOT EXISTS "${tableName}" (\n  ${allDefs.join(",\n  ")}\n)`,
  });
  out.push(...postStatements);

  return out;
}

function resolveSqlType(col: any, tableName: string, colKey: string): string {
  if (col.columnType === "PgArray" && col.baseColumn) {
    return `${resolveSqlType(col.baseColumn, tableName, colKey)}[]`;
  }
  if (typeof col.getSQLType === "function") {
    const t = col.getSQLType();
    if (typeof t === "string" && t.length > 0) return t;
  }
  throw new Error(
    `[component-schema-push] Cannot determine SQL type for column "${colKey}" on table ${tableName} ` +
    `(columnType=${col.columnType}). Add support for this Drizzle column type to component-schema-push.ts.`,
  );
}

function renderForeignKey(fk: any, tableName: string): string {
  const ref = fk.reference();
  const cols = ref.columns.map((c: any) => `"${c.name}"`).join(", ");
  const foreignTableName = getTableName(ref.foreignTable);
  if (!foreignTableName) {
    throw new Error(`[component-schema-push] Foreign key on table ${tableName} references a table with no name`);
  }
  const foreignCols = ref.foreignColumns.map((c: any) => `"${c.name}"`).join(", ");
  const name: string | undefined = fk.name ?? ref.name;
  let stmt = "";
  if (name) stmt += `CONSTRAINT "${name}" `;
  stmt += `FOREIGN KEY (${cols}) REFERENCES "${foreignTableName}" (${foreignCols})`;
  if (fk.onDelete) stmt += ` ON DELETE ${fk.onDelete.toUpperCase()}`;
  if (fk.onUpdate) stmt += ` ON UPDATE ${fk.onUpdate.toUpperCase()}`;
  return stmt;
}

function renderIndex(builder: any, tableName: string): string {
  const cfg = builder.config;
  if (!cfg) {
    throw new Error(`[component-schema-push] Index builder on table ${tableName} has no config`);
  }
  const cols = (cfg.columns ?? []).map((c: any) => {
    if (c?.name) return `"${c.name}"`;
    if (is(c, SQL)) return renderSql(c, `index column on ${tableName}`);
    throw new Error(`[component-schema-push] Unsupported index column expression on ${tableName}`);
  }).join(", ");
  const unique = cfg.unique ? "UNIQUE " : "";
  let stmt = `CREATE ${unique}INDEX IF NOT EXISTS "${cfg.name}" ON "${tableName}"`;
  if (cfg.method && cfg.method !== "btree") stmt += ` USING ${cfg.method}`;
  stmt += ` (${cols})`;
  if (cfg.where) {
    stmt += ` WHERE ${renderSql(cfg.where, `index WHERE on ${tableName}`)}`;
  }
  return stmt;
}

function renderSql(value: any, context: string): string {
  if (!is(value, SQL)) {
    throw new Error(`[component-schema-push] Expected a Drizzle SQL expression for ${context}`);
  }
  const q = dialect.sqlToQuery(value as SQL);
  if (q.params && q.params.length > 0) {
    throw new Error(
      `[component-schema-push] SQL expression for ${context} contains bound parameters; ` +
      `inline literal values instead.`,
    );
  }
  return q.sql;
}

function renderCreateEnumType(name: string, values: string[]): string {
  const list = values.map((v) => `'${v.replace(/'/g, "''")}'`).join(", ");
  return `DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = '${name}') THEN
    CREATE TYPE "${name}" AS ENUM (${list});
  END IF;
END $$`;
}

function formatDefault(defaultValue: any, tableName: string, colKey: string): string {
  if (is(defaultValue, SQL)) {
    return renderSql(defaultValue, `default of ${tableName}.${colKey}`);
  }
  if (typeof defaultValue === "string") {
    return `'${defaultValue.replace(/'/g, "''")}'`;
  }
  if (typeof defaultValue === "number" || typeof defaultValue === "boolean") {
    return String(defaultValue);
  }
  if (defaultValue === null) {
    return "NULL";
  }
  if (Array.isArray(defaultValue)) {
    if (defaultValue.length === 0) return "ARRAY[]::text[]";
    const items = defaultValue.map((v) => {
      if (typeof v === "string") return `'${v.replace(/'/g, "''")}'`;
      if (typeof v === "number" || typeof v === "boolean") return String(v);
      throw new Error(
        `[component-schema-push] Unsupported array default element on ${tableName}.${colKey}`,
      );
    }).join(", ");
    return `ARRAY[${items}]`;
  }
  throw new Error(
    `[component-schema-push] Unsupported default value shape on ${tableName}.${colKey} ` +
    `(type=${typeof defaultValue}). Add support for it in component-schema-push.ts.`,
  );
}

const PG_TYPE_ALIASES: Record<string, string[]> = {
  varchar: ["character varying", "varchar"],
  "character varying": ["character varying", "varchar"],
  text: ["text"],
  integer: ["integer", "int4"],
  int: ["integer", "int4"],
  bigint: ["bigint", "int8"],
  smallint: ["smallint", "int2"],
  serial: ["integer", "int4"],
  bigserial: ["bigint", "int8"],
  boolean: ["boolean", "bool"],
  bool: ["boolean", "bool"],
  jsonb: ["jsonb"],
  json: ["json"],
  date: ["date"],
  time: ["time without time zone", "time"],
  timestamp: ["timestamp without time zone", "timestamp"],
  "timestamp with time zone": ["timestamp with time zone", "timestamptz"],
  timestamptz: ["timestamp with time zone", "timestamptz"],
  numeric: ["numeric"],
  decimal: ["numeric"],
  uuid: ["uuid"],
  bytea: ["bytea"],
  "double precision": ["double precision", "float8"],
  real: ["real", "float4"],
};

function normalizeExpectedType(sqlType: string): string {
  const lower = sqlType.toLowerCase();
  // Strip parens like numeric(10, 2) → numeric
  const base = lower.replace(/\([^)]*\)/g, "").trim();
  // Arrays handled separately
  return base.replace(/\s+/g, " ");
}

function dbTypeMatches(expected: string, actualDataType: string, actualUdt: string): boolean {
  const exp = normalizeExpectedType(expected);
  // Array case: expected ends with "[]"
  if (exp.endsWith("[]")) {
    if (actualDataType.toLowerCase() !== "array") return false;
    const expBase = exp.slice(0, -2).trim();
    const aliases = PG_TYPE_ALIASES[expBase] ?? [expBase];
    // udt_name for array elements is typically "_int4", "_text", etc.
    const udt = actualUdt.toLowerCase().replace(/^_/, "");
    return aliases.some((a) => a === actualDataType.toLowerCase() || a === udt);
  }
  // Enum: expected is the enum name → actualDataType will be USER-DEFINED with udt_name = enum name
  if (actualDataType.toLowerCase() === "user-defined") {
    return exp === actualUdt.toLowerCase();
  }
  const aliases = PG_TYPE_ALIASES[exp] ?? [exp];
  const actualLower = actualDataType.toLowerCase();
  const udtLower = actualUdt.toLowerCase();
  return aliases.includes(actualLower) || aliases.includes(udtLower);
}

export async function detectSchemaDrift(tableSchema: any, tableName: string): Promise<SchemaDriftReport> {
  const expectedCols = getTableColumns(tableSchema);
  const actualCols = await getTableColumnInfo(tableName);
  const actualByName = new Map(actualCols.map((c) => [c.name, c]));

  const missingColumns: string[] = [];
  const typeMismatches: string[] = [];

  for (const [key, col] of Object.entries(expectedCols) as [string, any][]) {
    const dbName = col.name || key;
    const actual = actualByName.get(dbName);
    if (!actual) {
      missingColumns.push(dbName);
      continue;
    }
    const expectedType = resolveSqlType(col, tableName, key);
    if (!dbTypeMatches(expectedType, actual.dataType, actual.udtName)) {
      typeMismatches.push(`${dbName} expected ${expectedType}, found ${actual.dataType}`);
    }
  }

  // Compare FKs/uniques/checks structurally (Drizzle's auto-names rarely match Postgres' auto-names).
  interface ExpectedFk { cols: string[]; ftable: string; fcols: string[]; name?: string; onDelete?: string; onUpdate?: string }
  interface ExpectedUnique { cols: string[]; name?: string }
  const expectedFks: ExpectedFk[] = [];
  const expectedUniques: ExpectedUnique[] = [];
  const expectedCheckNames = new Set<string>();
  const expectedNamedConstraints = new Set<string>();

  for (const fk of getInlineForeignKeys(tableSchema)) {
    const ref = fk.reference();
    const ftName = getTableName(ref.foreignTable);
    if (!ftName) continue;
    expectedFks.push({
      cols: ref.columns.map((c: any) => c.name as string),
      ftable: ftName,
      fcols: ref.foreignColumns.map((c: any) => c.name as string),
      name: fk.name ?? ref.name,
      onDelete: fk.onDelete,
      onUpdate: fk.onUpdate,
    });
  }

  const ebSym = getSym(tableSchema, EXTRA_CONFIG_BUILDER_SYM);
  const ecSym = getSym(tableSchema, EXTRA_CONFIG_COLS_SYM);
  const expectedIndexNames = new Set<string>();
  if (ebSym && typeof tableSchema[ebSym] === "function") {
    const ecCols = ecSym ? tableSchema[ecSym] : expectedCols;
    const cfg = tableSchema[ebSym](ecCols);
    const items: any[] = Array.isArray(cfg) ? cfg : Object.values(cfg ?? {});
    for (const item of items) {
      const ctor = item?.constructor?.name;
      if (ctor === "UniqueConstraintBuilder") {
        expectedUniques.push({
          cols: (item.columns ?? []).map((c: any) => c.name as string),
          name: item.name,
        });
        if (item.name) expectedNamedConstraints.add(item.name);
      } else if (ctor === "ForeignKeyBuilder") {
        const built = item.build(tableSchema);
        const ref = built.reference();
        const ftName = getTableName(ref.foreignTable);
        if (ftName) {
          expectedFks.push({
            cols: ref.columns.map((c: any) => c.name as string),
            ftable: ftName,
            fcols: ref.foreignColumns.map((c: any) => c.name as string),
            name: built.name ?? ref.name,
            onDelete: built.onDelete,
            onUpdate: built.onUpdate,
          });
        }
      } else if (ctor === "CheckBuilder") {
        if (item.name) {
          expectedCheckNames.add(item.name);
          expectedNamedConstraints.add(item.name);
        }
      } else if (ctor === "IndexBuilder" || ctor === "UniqueIndexBuilder") {
        if (item.config?.name) expectedIndexNames.add(item.config.name);
      } else {
        throw new Error(
          `[component-schema-push] Unrecognized extra-config builder "${ctor}" on table ${tableName} ` +
          `during drift check. Please add support for it in component-schema-push.ts.`,
        );
      }
    }
  }
  for (const [key, col] of Object.entries(expectedCols) as [string, any][]) {
    if (col.isUnique) {
      const dbName = col.name || key;
      expectedUniques.push({ cols: [dbName], name: col.uniqueName });
    }
  }

  const actualConstraints = await getTableConstraintInfo(tableName);
  const actualFks = actualConstraints.filter((c) => c.type === "f");
  const actualUniques = actualConstraints.filter((c) => c.type === "u");
  const actualNamedConstraints = new Set(actualConstraints.map((c) => c.name));

  const sigFk = (cols: string[], ftable: string, fcols: string[]) =>
    `${cols.join(",")}->${ftable}(${fcols.join(",")})`;
  const actualFkBySig = new Map(
    actualFks.map((c) => [sigFk(c.columns, c.foreignTable ?? "", c.foreignColumns), c] as const),
  );
  const actualUniqueSigs = new Set(actualUniques.map((c) => c.columns.slice().sort().join(",")));

  const parseFkActions = (def: string): { onDelete: string; onUpdate: string } => {
    const onDel = /ON DELETE\s+([A-Z ]+?)(?:\s+ON UPDATE|\s*$)/i.exec(def);
    const onUpd = /ON UPDATE\s+([A-Z ]+?)(?:\s+ON DELETE|\s*$)/i.exec(def);
    return {
      onDelete: (onDel?.[1] ?? "NO ACTION").trim().toUpperCase(),
      onUpdate: (onUpd?.[1] ?? "NO ACTION").trim().toUpperCase(),
    };
  };
  const normAction = (a?: string) => (a ?? "no action").trim().toUpperCase().replace(/_/g, " ");

  const missingConstraints: string[] = [];
  for (const fk of expectedFks) {
    const sig = sigFk(fk.cols, fk.ftable, fk.fcols);
    const actual = actualFkBySig.get(sig);
    if (!actual) {
      missingConstraints.push(
        `FK ${fk.name ?? "(unnamed)"}: ${fk.cols.join(",")} -> ${fk.ftable}(${fk.fcols.join(",")})`,
      );
      continue;
    }
    const expectedDel = normAction(fk.onDelete);
    const expectedUpd = normAction(fk.onUpdate);
    const actualActions = parseFkActions(actual.definition);
    if (expectedDel !== actualActions.onDelete) {
      missingConstraints.push(
        `FK ${actual.name} action mismatch: expected ON DELETE ${expectedDel}, found ${actualActions.onDelete}`,
      );
    }
    if (expectedUpd !== actualActions.onUpdate) {
      missingConstraints.push(
        `FK ${actual.name} action mismatch: expected ON UPDATE ${expectedUpd}, found ${actualActions.onUpdate}`,
      );
    }
  }
  for (const uq of expectedUniques) {
    if (!actualUniqueSigs.has(uq.cols.slice().sort().join(","))) {
      missingConstraints.push(`UNIQUE ${uq.name ?? "(unnamed)"}: (${uq.cols.join(",")})`);
    }
  }
  for (const name of expectedCheckNames) {
    if (!actualNamedConstraints.has(name)) {
      missingConstraints.push(`CHECK ${name}`);
    }
  }

  // Index drift: compare existence by name AND definition (uniqueness + columns + where + method).
  const expectedIndexDefs = new Map<string, string>();
  if (ebSym && typeof tableSchema[ebSym] === "function") {
    const ecCols = ecSym ? tableSchema[ecSym] : expectedCols;
    const cfg = tableSchema[ebSym](ecCols);
    const items: any[] = Array.isArray(cfg) ? cfg : Object.values(cfg ?? {});
    for (const item of items) {
      const ctor = item?.constructor?.name;
      if ((ctor === "IndexBuilder" || ctor === "UniqueIndexBuilder") && item.config?.name) {
        expectedIndexDefs.set(item.config.name, normalizeIndexDef(renderIndex(item, tableName)));
      }
    }
  }
  const actualIndexes = await getTableIndexInfo(tableName);
  const actualIndexByName = new Map(actualIndexes.map((i) => [i.name, i] as const));
  const missingIndexes: string[] = [];
  for (const [name, expectedDef] of expectedIndexDefs) {
    const actual = actualIndexByName.get(name);
    if (!actual) {
      missingIndexes.push(name);
      continue;
    }
    const actualDef = normalizeIndexDef(actual.definition);
    if (actualDef !== expectedDef) {
      missingIndexes.push(`${name} definition mismatch (expected: ${expectedDef} | found: ${actualDef})`);
    }
  }

  return { tableName, missingColumns, typeMismatches, missingConstraints, missingIndexes };
}

function normalizeIndexDef(def: string): string {
  return def
    .toLowerCase()
    .replace(/\bpublic\.|"/g, "")
    .replace(/if not exists\s+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export async function dropComponentSchema(componentId: string): Promise<void> {
  const component = getComponentById(componentId);

  if (!component) {
    throw new Error(`Component not found: ${componentId}`);
  }

  if (!component.managesSchema || !component.schemaManifest) {
    throw new Error(`Component ${componentId} does not manage a schema`);
  }

  for (const tableName of component.schemaManifest.tables) {
    await storage.rawSql.execute(`DROP TABLE IF EXISTS ${tableName} CASCADE`);
  }
}
