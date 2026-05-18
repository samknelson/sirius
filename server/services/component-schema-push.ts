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
  /** Columns present in the live DB but not in the Drizzle schema. */
  extraColumns: string[];
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
  // Always render every drift category (with "(none)" when empty) so a future
  // debugger can tell at a glance that a "missing column didn't auto-apply"
  // failure has no hidden constraint/index drift behind it.
  const lines: string[] = ["Schema drift detected:"];
  for (const r of reports) {
    lines.push(`  Table ${r.tableName}:`);
    lines.push(
      `    - missing columns: ${r.missingColumns.length ? r.missingColumns.join(", ") : "(none)"}`,
    );
    lines.push(
      `    - extra columns: ${r.extraColumns.length ? r.extraColumns.join(", ") : "(none)"}`,
    );
    lines.push(
      `    - type mismatches: ${r.typeMismatches.length ? r.typeMismatches.join("; ") : "(none)"}`,
    );
    lines.push(
      `    - missing constraints: ${r.missingConstraints.length ? r.missingConstraints.join("; ") : "(none)"}`,
    );
    lines.push(
      `    - missing indexes: ${r.missingIndexes.length ? r.missingIndexes.join("; ") : "(none)"}`,
    );
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
      // First-time table creation from the Drizzle definition. This is the
      // ONLY remaining write path in this module — schema changes to
      // existing tables MUST be expressed as per-component migrations under
      // `scripts/migrate/components/<componentId>/`. The previous additive
      // ALTER path (auto-adding missing columns) has been intentionally
      // retired; any drift on an existing table now throws.
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
    const fragment = buildColumnFragment(col, colKey, tableName, enumsNeeded);
    columnDefs.push(fragment.def);
    if (fragment.uniqueConstraint) {
      tableConstraints.push(fragment.uniqueConstraint);
    }
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

function buildColumnFragment(
  col: any,
  colKey: string,
  tableName: string,
  enumsNeeded: Set<string>,
): { def: string; uniqueConstraint?: string; colDbName: string } {
  const colDbName = col.name || colKey;
  const sqlType = resolveSqlType(col, tableName, colKey);

  collectEnumsFromColumn(col, enumsNeeded);

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

  let uniqueConstraint: string | undefined;
  if (col.isUnique) {
    const ucName = col.uniqueName || `${tableName}_${colDbName}_unique`;
    uniqueConstraint = `CONSTRAINT "${ucName}" UNIQUE ("${colDbName}")`;
  }

  return { def: colDef, uniqueConstraint, colDbName };
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

function collectEnumsFromColumn(col: any, enumsNeeded: Set<string>): void {
  if (!col) return;
  if (col.columnType === "PgEnumColumn" && col.enum?.enumName) {
    enumsNeeded.add(col.enum.enumName);
  }
  if (col.baseColumn) {
    collectEnumsFromColumn(col.baseColumn, enumsNeeded);
  }
}

function renderSql(value: any, context: string): string {
  if (!is(value, SQL)) {
    throw new Error(`[component-schema-push] Expected a Drizzle SQL expression for ${context}`);
  }
  const q = dialect.sqlToQuery(value as SQL);
  if (!q.params || q.params.length === 0) return q.sql;
  // Inline parameters as SQL literals so the rendered DDL is self-contained.
  // Postgres uses $1, $2, ... placeholders.
  let out = q.sql;
  for (let i = q.params.length - 1; i >= 0; i--) {
    const literal = sqlLiteral(q.params[i], `${context} param $${i + 1}`);
    out = out.replace(new RegExp(`\\$${i + 1}\\b`, "g"), () => literal);
  }
  return out;
}

function sqlLiteral(v: unknown, context: string): string {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "string") return `'${v.replace(/'/g, "''")}'`;
  if (typeof v === "number" || typeof v === "bigint") return String(v);
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (v instanceof Date) return `'${v.toISOString()}'`;
  throw new Error(
    `[component-schema-push] Unsupported parameter type ${typeof v} for ${context}; ` +
    `inline a primitive literal in your sql\`...\` expression instead.`,
  );
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

// Drift comparison normalizes types to their base name (precision/scale and
// length modifiers stripped). For example, `numeric(10,2)` and `numeric(12,2)`
// are treated as equivalent, as are `varchar(50)` and `varchar(100)`. This is
// intentional: width-only changes are not currently flagged as drift. If
// stricter precision/scale enforcement is required later, extend `parseTypeBase`
// to retain the modifier and compare it.
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
  const expectedColNames = new Set<string>();

  for (const [key, col] of Object.entries(expectedCols) as [string, any][]) {
    const dbName = col.name || key;
    expectedColNames.add(dbName);
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

  // Columns present in the live DB but not in the Drizzle schema. Reported
  // (and gated on at boot) but never auto-dropped — drops are destructive
  // and must be authored as an explicit migration.
  const extraColumns: string[] = [];
  for (const actual of actualCols) {
    if (!expectedColNames.has(actual.name)) extraColumns.push(actual.name);
  }

  // Compare FKs/uniques/checks structurally (Drizzle's auto-names rarely match Postgres' auto-names).
  interface ExpectedFk { cols: string[]; ftable: string; fcols: string[]; name?: string; onDelete?: string; onUpdate?: string }
  interface ExpectedUnique { cols: string[]; name?: string }
  const expectedFks: ExpectedFk[] = [];
  const expectedUniques: ExpectedUnique[] = [];
  const expectedCheckNames = new Set<string>();
  const expectedPks: { cols: string[]; name?: string }[] = [];

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
      } else if (ctor === "PrimaryKeyBuilder") {
        expectedPks.push({
          cols: (item.columns ?? []).map((c: any) => c.name as string),
          name: item.name,
        });
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
        if (item.name) expectedCheckNames.add(item.name);
      } else if (ctor === "IndexBuilder" || ctor === "UniqueIndexBuilder") {
        // handled in the index-drift block below
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
    if (col.primary) {
      const dbName = col.name || key;
      expectedPks.push({ cols: [dbName] });
    }
  }

  const actualConstraints = await getTableConstraintInfo(tableName);
  const actualFks = actualConstraints.filter((c) => c.type === "f");
  const actualUniques = actualConstraints.filter((c) => c.type === "u");
  const actualNamedConstraints = new Set(actualConstraints.map((c) => c.name));

  const stripSchema = (t: string) => t.replace(/^"?public"?\./, "").replace(/^"|"$/g, "");
  const sigFk = (cols: string[], ftable: string, fcols: string[]) =>
    `${cols.join(",")}->${stripSchema(ftable)}(${fcols.join(",")})`;
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
      // Skip FKs whose target table isn't present in the live DB. The owning
      // component is presumably not enabled on this deployment; if it gets
      // enabled later, its tables will be created and a follow-up baseline /
      // migration can install the FK. Without this, a perpetually-disabled
      // dependency would block the drift gate forever.
      if (!(await tableExists(fk.ftable))) continue;
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

  // Primary key drift: compare by column set (PK names rarely match Drizzle's auto-names).
  const actualPks = actualConstraints.filter((c) => c.type === "p");
  const actualPkColSets = new Set(actualPks.map((c) => c.columns.slice().sort().join(",")));
  for (const pk of expectedPks) {
    if (!actualPkColSets.has(pk.cols.slice().sort().join(","))) {
      missingConstraints.push(`PRIMARY KEY ${pk.name ?? "(unnamed)"}: (${pk.cols.join(",")})`);
    }
  }

  // Index drift: compare structurally (uniqueness, method, columns, predicate) - NOT by SQL string.
  interface ExpectedIndex {
    name: string;
    isUnique: boolean;
    method: string;
    columns: string[];
    predicate: string | null;
  }
  const expectedIndexes: ExpectedIndex[] = [];
  if (ebSym && typeof tableSchema[ebSym] === "function") {
    const ecCols = ecSym ? tableSchema[ecSym] : expectedCols;
    const cfg = tableSchema[ebSym](ecCols);
    const items: any[] = Array.isArray(cfg) ? cfg : Object.values(cfg ?? {});
    for (const item of items) {
      const ctor = item?.constructor?.name;
      if ((ctor === "IndexBuilder" || ctor === "UniqueIndexBuilder") && item.config?.name) {
        const c = item.config;
        const cols: string[] = (c.columns ?? []).map((col: any) => {
          if (col?.name) return col.name as string;
          if (is(col, SQL)) return normalizeIndexExpr(renderSql(col, `index column on ${tableName}`));
          throw new Error(`[component-schema-push] Unsupported index column on ${tableName}`);
        });
        expectedIndexes.push({
          name: c.name,
          isUnique: ctor === "UniqueIndexBuilder" || !!c.unique,
          method: (c.method ?? "btree").toLowerCase(),
          columns: cols,
          predicate: c.where ? normalizeIndexExpr(renderSql(c.where, `index WHERE on ${tableName}`)) : null,
        });
      }
    }
  }
  const actualIndexes = await getTableIndexInfo(tableName);
  const actualIndexByName = new Map(actualIndexes.map((i) => [i.name, i] as const));
  const missingIndexes: string[] = [];
  for (const exp of expectedIndexes) {
    const actual = actualIndexByName.get(exp.name);
    if (!actual) {
      missingIndexes.push(exp.name);
      continue;
    }
    const mismatches: string[] = [];
    if (exp.isUnique !== actual.isUnique) {
      mismatches.push(`unique: expected ${exp.isUnique}, found ${actual.isUnique}`);
    }
    if (exp.method !== actual.method.toLowerCase()) {
      mismatches.push(`method: expected ${exp.method}, found ${actual.method}`);
    }
    const actualCols = actual.columns.map((c) => normalizeIndexExpr(c));
    if (exp.columns.length !== actualCols.length || exp.columns.some((c, i) => c !== actualCols[i])) {
      mismatches.push(`columns: expected [${exp.columns.join(", ")}], found [${actualCols.join(", ")}]`);
    }
    const expPred = exp.predicate;
    const actPred = actual.predicate ? normalizeIndexExpr(actual.predicate) : null;
    if ((expPred ?? "") !== (actPred ?? "")) {
      mismatches.push(`predicate: expected ${expPred ?? "(none)"}, found ${actPred ?? "(none)"}`);
    }
    if (mismatches.length) {
      missingIndexes.push(`${exp.name} mismatch: ${mismatches.join("; ")}`);
    }
  }

  return { tableName, missingColumns, extraColumns, typeMismatches, missingConstraints, missingIndexes };
}

function normalizeIndexExpr(s: string): string {
  // Normalize for comparison: strip schema/table qualification, surrounding quotes,
  // outer parentheses, and collapse whitespace. Keep semantic content (column names,
  // operator classes, expression bodies).
  let out = s.toLowerCase().trim();
  out = out.replace(/\bpublic\./g, "");
  // Strip "tablename"."col" or tablename.col qualifications - keep just the column name
  out = out.replace(/"([a-z_][a-z0-9_]*)"\."([a-z_][a-z0-9_]*)"/g, "$2");
  out = out.replace(/\b([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)\b/g, "$2");
  out = out.replace(/\s+/g, " ");
  // Strip leading/trailing parens that pg_get_indexdef wraps expressions in
  while (out.startsWith("(") && out.endsWith(")")) {
    let depth = 0, balanced = true;
    for (let i = 0; i < out.length; i++) {
      if (out[i] === "(") depth++;
      else if (out[i] === ")") { depth--; if (depth === 0 && i < out.length - 1) { balanced = false; break; } }
    }
    if (!balanced) break;
    out = out.slice(1, -1).trim();
  }
  // Strip surrounding double quotes
  if (out.startsWith('"') && out.endsWith('"') && !out.slice(1, -1).includes('"')) {
    out = out.slice(1, -1);
  }
  return out;
}

/**
 * Generate idempotent ALTER TABLE / CREATE INDEX statements that, when run
 * in order against the live DB, will fix any structural drift between the
 * given Drizzle table definition and the actual table. The drift is
 * detected via `detectSchemaDrift`; this helper then synthesizes DDL to
 * close each gap.
 *
 * Constraint adds are wrapped in DO/EXCEPTION blocks so a duplicate name
 * (e.g. from a prior partial baseline run) is silently tolerated.
 * Index creates and column adds use native IF NOT EXISTS.
 *
 * Intended for use by baseline scripts — NOT for normal schema management.
 */
export async function generateDriftFixStatements(
  tableSchema: any,
  tableName: string,
): Promise<string[]> {
  const stmts: string[] = [];
  const drift = await detectSchemaDrift(tableSchema, tableName);

  // ----- Type mismatches -----
  const expectedCols = getTableColumns(tableSchema);
  for (const entry of drift.typeMismatches) {
    // Entries look like: `<colName> expected <expectedType>, found <actualType>`
    const m = /^(\S+)\s+expected\s+(.+?),\s+found\s+/.exec(entry);
    if (!m) continue;
    const [, colName, expectedType] = m;
    let col: any;
    for (const [k, c] of Object.entries(expectedCols) as [string, any][]) {
      if ((c.name || k) === colName) { col = c; break; }
    }
    if (!col) continue;
    // USING clause: cast via text to safely coerce most types.
    stmts.push(
      `ALTER TABLE "${tableName}" ALTER COLUMN "${colName}" TYPE ${expectedType} USING "${colName}"::text::${expectedType}`,
    );
  }

  // ----- Missing columns -----
  const enumsNeeded = new Set<string>();
  for (const colName of drift.missingColumns) {
    let key: string | undefined;
    let col: any;
    for (const [k, c] of Object.entries(expectedCols) as [string, any][]) {
      if ((c.name || k) === colName) { key = k; col = c; break; }
    }
    if (!key) continue;
    const frag = buildColumnFragment(col, key, tableName, enumsNeeded);
    stmts.push(`ALTER TABLE "${tableName}" ADD COLUMN IF NOT EXISTS ${frag.def}`);
  }

  // ----- Build name maps for missing-constraint synthesis -----
  const missingSet = new Set(drift.missingConstraints);
  const wrapDo = (sql: string) =>
    `DO $$ BEGIN ${sql}; EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; END $$`;

  // ----- Column-level FKs and uniques -----
  for (const fk of getInlineForeignKeys(tableSchema)) {
    const ref = fk.reference();
    const ftName = getTableName(ref.foreignTable);
    if (!ftName) continue;
    const cols = ref.columns.map((c: any) => c.name as string);
    const fcols = ref.foreignColumns.map((c: any) => c.name as string);
    const tag = `FK ${fk.name ?? ref.name ?? "(unnamed)"}: ${cols.join(",")} -> ${ftName}(${fcols.join(",")})`;
    if (!missingSet.has(tag)) continue;
    const name = fk.name ?? ref.name ?? `${tableName}_${cols.join("_")}_fkey`;
    const colsQ = cols.map((c) => `"${c}"`).join(", ");
    const fcolsQ = fcols.map((c) => `"${c}"`).join(", ");
    let s = `ALTER TABLE "${tableName}" ADD CONSTRAINT "${name}" FOREIGN KEY (${colsQ}) REFERENCES "${ftName}" (${fcolsQ})`;
    if (fk.onDelete) s += ` ON DELETE ${fk.onDelete.toUpperCase()}`;
    if (fk.onUpdate) s += ` ON UPDATE ${fk.onUpdate.toUpperCase()}`;
    stmts.push(wrapDo(s));
  }
  for (const [colKey, col] of Object.entries(expectedCols) as [string, any][]) {
    if (!col.isUnique) continue;
    const dbName = col.name || colKey;
    const ucName = col.uniqueName || `${tableName}_${dbName}_unique`;
    const tag = `UNIQUE ${ucName}: (${dbName})`;
    if (!missingSet.has(tag)) continue;
    stmts.push(wrapDo(`ALTER TABLE "${tableName}" ADD CONSTRAINT "${ucName}" UNIQUE ("${dbName}")`));
  }

  // ----- Table-level FKs, uniques, checks (from extra-config builder) -----
  const ebSym = getSym(tableSchema, EXTRA_CONFIG_BUILDER_SYM);
  const ecSym = getSym(tableSchema, EXTRA_CONFIG_COLS_SYM);
  if (ebSym && typeof tableSchema[ebSym] === "function") {
    const ecCols = ecSym ? tableSchema[ecSym] : expectedCols;
    const cfg = tableSchema[ebSym](ecCols);
    const items: any[] = Array.isArray(cfg) ? cfg : Object.values(cfg ?? {});
    for (const item of items) {
      if (!item) continue;
      const ctor = item.constructor?.name;
      if (ctor === "UniqueConstraintBuilder") {
        const cols = (item.columns ?? []).map((c: any) => c.name as string);
        const name = item.name ?? `${tableName}_${cols.join("_")}_unique`;
        const tag = `UNIQUE ${item.name ?? "(unnamed)"}: (${cols.join(",")})`;
        if (!missingSet.has(tag)) continue;
        const colsQ = cols.map((c) => `"${c}"`).join(", ");
        let s = `ALTER TABLE "${tableName}" ADD CONSTRAINT "${name}" UNIQUE`;
        if (item.nullsNotDistinctConfig) s += " NULLS NOT DISTINCT";
        s += ` (${colsQ})`;
        stmts.push(wrapDo(s));
      } else if (ctor === "ForeignKeyBuilder") {
        const built = item.build(tableSchema);
        const ref = built.reference();
        const ftName = getTableName(ref.foreignTable);
        if (!ftName) continue;
        const cols = ref.columns.map((c: any) => c.name as string);
        const fcols = ref.foreignColumns.map((c: any) => c.name as string);
        const tag = `FK ${built.name ?? ref.name ?? "(unnamed)"}: ${cols.join(",")} -> ${ftName}(${fcols.join(",")})`;
        if (!missingSet.has(tag)) continue;
        const name = built.name ?? ref.name ?? `${tableName}_${cols.join("_")}_fkey`;
        const colsQ = cols.map((c) => `"${c}"`).join(", ");
        const fcolsQ = fcols.map((c) => `"${c}"`).join(", ");
        let s = `ALTER TABLE "${tableName}" ADD CONSTRAINT "${name}" FOREIGN KEY (${colsQ}) REFERENCES "${ftName}" (${fcolsQ})`;
        if (built.onDelete) s += ` ON DELETE ${built.onDelete.toUpperCase()}`;
        if (built.onUpdate) s += ` ON UPDATE ${built.onUpdate.toUpperCase()}`;
        stmts.push(wrapDo(s));
      } else if (ctor === "CheckBuilder") {
        if (!item.name) continue;
        const tag = `CHECK ${item.name}`;
        if (!missingSet.has(tag)) continue;
        const expr = renderSql(item.value, `check ${item.name} on ${tableName}`);
        stmts.push(wrapDo(`ALTER TABLE "${tableName}" ADD CONSTRAINT "${item.name}" CHECK (${expr})`));
      } else if (ctor === "PrimaryKeyBuilder") {
        const cols = (item.columns ?? []).map((c: any) => c.name as string);
        const tag = `PRIMARY KEY ${item.name ?? "(unnamed)"}: (${cols.join(",")})`;
        if (!missingSet.has(tag)) continue;
        const name = item.name ?? `${tableName}_pk`;
        const colsQ = cols.map((c) => `"${c}"`).join(", ");
        stmts.push(wrapDo(`ALTER TABLE "${tableName}" ADD CONSTRAINT "${name}" PRIMARY KEY (${colsQ})`));
      } else if (ctor === "IndexBuilder" || ctor === "UniqueIndexBuilder") {
        const name = item.config?.name;
        if (!name) continue;
        // missingIndexes entries are either the bare name or "<name> mismatch: ..."
        if (!drift.missingIndexes.some((e) => e === name || e.startsWith(`${name} `))) continue;
        stmts.push(renderIndex(item, tableName));
      }
    }
  }

  return stmts;
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
