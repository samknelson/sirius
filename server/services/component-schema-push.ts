import { getComponentById } from "../../shared/components";
import { storage } from "../storage";
import { tableExists } from "../storage/utils";
import * as mainSchema from "../../shared/schema";

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
      
      const createSql = generateCreateTableSql(tableSchema, tableName);
      console.log(`Creating table ${tableName}...`);
      await storage.rawSql.execute(createSql);
      console.log(`Table ${tableName} created successfully.`);
    } else {
      console.log(`Table ${tableName} already exists, skipping.`);
    }
  }
}

async function loadSchemaModule(schemaPath: string): Promise<Record<string, unknown>> {
  const relativePath = schemaPath.replace(/^\.\//, "");
  const moduleUrl = new URL(`../../${relativePath}`, import.meta.url);
  return await import(moduleUrl.href);
}

function findTableInModule(module: any, tableName: string): any {
  for (const [key, value] of Object.entries(module)) {
    if (value && typeof value === "object") {
      const nameSymbol = Object.getOwnPropertySymbols(value).find(
        s => s.description === "drizzle:Name"
      );
      if (nameSymbol && (value as any)[nameSymbol] === tableName) {
        return value;
      }
    }
  }
  return null;
}

function getTableColumns(tableSchema: any): Map<string, any> {
  const columnsSymbol = Object.getOwnPropertySymbols(tableSchema).find(
    s => s.description === "drizzle:Columns"
  );
  if (columnsSymbol) {
    return tableSchema[columnsSymbol];
  }
  return new Map();
}

function generateCreateTableSql(tableSchema: any, tableName: string): string {
  const columns = getTableColumns(tableSchema);
  const columnDefs: string[] = [];
  const constraints: string[] = [];
  
  for (const [colName, col] of Object.entries(columns) as [string, any][]) {
    const colDbName = col.name || colName;
    let colDef = `"${colDbName}" ${getSqlType(col)}`;
    
    if (col.primary) {
      colDef += " PRIMARY KEY";
    }
    if (col.notNull) {
      colDef += " NOT NULL";
    }
    if (col.hasDefault && col.default !== undefined) {
      const defaultVal = formatDefault(col.default);
      if (defaultVal) {
        colDef += ` DEFAULT ${defaultVal}`;
      }
    }
    if (col.isUnique && col.uniqueName) {
      constraints.push(`CONSTRAINT "${col.uniqueName}" UNIQUE ("${colDbName}")`);
    }
    
    columnDefs.push(colDef);
  }

  const extraConfigSymbol = Object.getOwnPropertySymbols(tableSchema).find(
    s => s.description === "drizzle:ExtraConfigBuilder"
  );
  if (extraConfigSymbol && typeof tableSchema[extraConfigSymbol] === "function") {
    try {
      const extraConfig = tableSchema[extraConfigSymbol](tableSchema);
      if (Array.isArray(extraConfig)) {
        for (const item of extraConfig) {
          if (item && item.constructor?.name === "UniqueConstraintBuilder") {
            const ucName = item.name;
            const ucColumns = item.columns;
            if (ucName && Array.isArray(ucColumns) && ucColumns.length > 0) {
              const colNames = ucColumns.map((c: any) => `"${c.name}"`).join(", ");
              constraints.push(`CONSTRAINT "${ucName}" UNIQUE (${colNames})`);
            }
          }
        }
      }
    } catch {
    }
  }

  const allDefs = [...columnDefs, ...constraints];
  return `CREATE TABLE IF NOT EXISTS "${tableName}" (\n  ${allDefs.join(",\n  ")}\n)`;
}

function getSqlType(col: any): string {
  const columnType = col.columnType;

  if (columnType === "PgArray" && col.baseColumn) {
    return `${getSqlType(col.baseColumn)}[]`;
  }
  
  if (columnType?.includes("PgVarchar")) {
    return "VARCHAR";
  }
  if (columnType?.includes("PgText")) {
    return "TEXT";
  }
  if (columnType?.includes("PgTimestamp")) {
    return "TIMESTAMP";
  }
  if (columnType?.includes("PgInteger") || columnType?.includes("PgSerial")) {
    return "INTEGER";
  }
  if (columnType?.includes("PgBoolean")) {
    return "BOOLEAN";
  }
  if (columnType?.includes("PgJsonb")) {
    return "JSONB";
  }
  if (columnType?.includes("PgJson")) {
    return "JSON";
  }
  
  const dataType = col.dataType;
  if (dataType === "array" && col.baseColumn) return `${getSqlType(col.baseColumn)}[]`;
  if (dataType === "json") return "JSONB";
  if (dataType === "string") return "TEXT";
  if (dataType === "number") return "INTEGER";
  if (dataType === "boolean") return "BOOLEAN";
  if (dataType === "date") return "TIMESTAMP";
  
  return "TEXT";
}

function formatDefault(defaultValue: any): string | null {
  if (defaultValue === undefined || defaultValue === null) {
    return null;
  }
  
  if (typeof defaultValue === "object" && defaultValue.queryChunks) {
    const chunks = defaultValue.queryChunks;
    if (Array.isArray(chunks) && chunks.length > 0) {
      return chunks[0]?.value?.[0] || null;
    }
  }
  
  if (typeof defaultValue === "string") {
    return `'${defaultValue}'`;
  }
  
  if (typeof defaultValue === "number" || typeof defaultValue === "boolean") {
    return String(defaultValue);
  }
  
  return null;
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
