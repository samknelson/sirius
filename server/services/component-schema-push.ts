import { getComponentById } from "../../shared/components";
import { storage } from "../storage";
import { tableExists, getTableColumnNames } from "../storage/utils";
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

  for (const tableName of component.schemaManifest.tables) {
    const exists = await tableExists(tableName);

    if (!exists) {
      let tableSchema = findTableInModule(schemaModule, tableName);
      if (!tableSchema) {
        tableSchema = findTableInModule(mainSchema as unknown as Record<string, unknown>, tableName);
      }
      if (!tableSchema) {
        throw new Error(`Table ${tableName} not found in schema module`);
      }

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
      let tableSchema = findTableInModule(schemaModule, tableName);
      if (!tableSchema) {
        tableSchema = findTableInModule(mainSchema as unknown as Record<string, unknown>, tableName);
      }
      if (tableSchema) {
        const drift = await detectColumnDrift(tableSchema, tableName);
        if (drift.length > 0) {
          console.warn(
            `[component-schema-push] WARNING: table ${tableName} already exists but is missing columns: ${drift.join(", ")}. ` +
            `This push tool only creates new tables; please add the missing columns manually or drop and recreate the table.`,
          );
        } else {
          console.log(`Table ${tableName} already exists, skipping.`);
        }
      } else {
        console.log(`Table ${tableName} already exists, skipping.`);
      }
    }
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

function generateCreateStatements(
  tableSchema: any,
  tableName: string,
  allEnums: Map<string, string[]>,
  alreadyEmittedEnums: Set<string>,
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

async function detectColumnDrift(tableSchema: any, tableName: string): Promise<string[]> {
  const expectedCols = getTableColumns(tableSchema);
  const expectedNames = new Set(
    Object.entries(expectedCols).map(([key, col]: [string, any]) => col.name || key),
  );
  const actualNames = new Set(await getTableColumnNames(tableName));
  const missing: string[] = [];
  for (const name of expectedNames) {
    if (!actualNames.has(name)) missing.push(name);
  }
  return missing;
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
