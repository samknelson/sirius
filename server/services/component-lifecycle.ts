import { db } from "../db";
import { storage } from "../storage";
import { sql } from "drizzle-orm";
import {
  getComponentById,
  getComponentSchemaStateVariableName,
  computeSqlChecksum,
  ComponentSchemaState,
  ComponentTableState,
  ComponentSchemaDrift,
  ComponentDefinition,
} from "../../shared/components";

export interface SchemaOperationResult {
  success: boolean;
  tableName: string;
  operation: "create" | "drop";
  error?: string;
}

export interface ComponentLifecycleResult {
  success: boolean;
  componentId: string;
  schemaOperations: SchemaOperationResult[];
  schemaState: ComponentSchemaState | null;
  error?: string;
}

export interface DriftCheckResult {
  componentId: string;
  drift: ComponentSchemaDrift;
  schemaState: ComponentSchemaState | null;
}

async function tableExists(tableName: string): Promise<boolean> {
  const result = await db.execute(sql`
    SELECT EXISTS (
      SELECT FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name = ${tableName}
    ) as exists
  `);
  return result.rows[0]?.exists === true;
}

async function getSchemaState(componentId: string): Promise<ComponentSchemaState | null> {
  const variableName = getComponentSchemaStateVariableName(componentId);
  const variable = await storage.variables.getByName(variableName);
  if (!variable) {
    return null;
  }
  return variable.value as ComponentSchemaState;
}

async function saveSchemaState(componentId: string, state: ComponentSchemaState): Promise<void> {
  const variableName = getComponentSchemaStateVariableName(componentId);
  const existingVariable = await storage.variables.getByName(variableName);
  
  if (existingVariable) {
    await storage.variables.update(existingVariable.id, {
      name: variableName,
      value: state,
    });
  } else {
    await storage.variables.create({
      name: variableName,
      value: state,
    });
  }
}

async function deleteSchemaState(componentId: string): Promise<void> {
  const variableName = getComponentSchemaStateVariableName(componentId);
  const existingVariable = await storage.variables.getByName(variableName);
  
  if (existingVariable) {
    await storage.variables.delete(existingVariable.id);
  }
}

export async function enableComponentSchema(componentId: string): Promise<ComponentLifecycleResult> {
  const component = getComponentById(componentId);
  
  if (!component) {
    return {
      success: false,
      componentId,
      schemaOperations: [],
      schemaState: null,
      error: `Component not found: ${componentId}`,
    };
  }

  if (!component.managesSchema || !component.schemaManifest) {
    return {
      success: true,
      componentId,
      schemaOperations: [],
      schemaState: null,
    };
  }

  const operations: SchemaOperationResult[] = [];
  const tableStates: ComponentTableState[] = [];
  const now = new Date().toISOString();
  let hasError = false;

  for (const tableManifest of component.schemaManifest.tables) {
    try {
      const exists = await tableExists(tableManifest.tableName);
      
      if (!exists) {
        await db.execute(sql.raw(tableManifest.createSql));
      }
      
      operations.push({
        success: true,
        tableName: tableManifest.tableName,
        operation: "create",
      });

      tableStates.push({
        tableName: tableManifest.tableName,
        status: "active",
        appliedAt: now,
        droppedAt: null,
        checksum: computeSqlChecksum(tableManifest.createSql),
      });
    } catch (error) {
      hasError = true;
      const errorMessage = error instanceof Error ? error.message : String(error);
      operations.push({
        success: false,
        tableName: tableManifest.tableName,
        operation: "create",
        error: errorMessage,
      });
    }
  }

  const allSuccessful = !hasError;
  
  if (allSuccessful) {
    const schemaState: ComponentSchemaState = {
      manifestVersion: component.schemaManifest.version ?? 1,
      lastSyncedAt: now,
      tables: tableStates,
      drift: null,
    };
    await saveSchemaState(componentId, schemaState);
    
    return {
      success: true,
      componentId,
      schemaOperations: operations,
      schemaState,
    };
  }

  return {
    success: false,
    componentId,
    schemaOperations: operations,
    schemaState: null,
    error: "Some schema operations failed - state not saved",
  };
}

export async function disableComponentSchema(componentId: string): Promise<ComponentLifecycleResult> {
  const component = getComponentById(componentId);
  
  if (!component) {
    return {
      success: false,
      componentId,
      schemaOperations: [],
      schemaState: null,
      error: `Component not found: ${componentId}`,
    };
  }

  if (!component.managesSchema || !component.schemaManifest) {
    return {
      success: true,
      componentId,
      schemaOperations: [],
      schemaState: null,
    };
  }

  const operations: SchemaOperationResult[] = [];
  let hasError = false;

  for (const tableManifest of component.schemaManifest.tables) {
    try {
      const exists = await tableExists(tableManifest.tableName);
      
      if (exists) {
        await db.execute(sql.raw(tableManifest.dropSql));
      }
      
      operations.push({
        success: true,
        tableName: tableManifest.tableName,
        operation: "drop",
      });
    } catch (error) {
      hasError = true;
      const errorMessage = error instanceof Error ? error.message : String(error);
      operations.push({
        success: false,
        tableName: tableManifest.tableName,
        operation: "drop",
        error: errorMessage,
      });
    }
  }

  if (!hasError) {
    await deleteSchemaState(componentId);
    return {
      success: true,
      componentId,
      schemaOperations: operations,
      schemaState: null,
    };
  }

  return {
    success: false,
    componentId,
    schemaOperations: operations,
    schemaState: null,
    error: "Some schema operations failed - state not deleted",
  };
}

export async function checkComponentSchemaDrift(componentId: string): Promise<DriftCheckResult> {
  const component = getComponentById(componentId);
  const now = new Date().toISOString();
  
  if (!component || !component.managesSchema || !component.schemaManifest) {
    return {
      componentId,
      drift: {
        lastCheckAt: now,
        hasUnexpectedTables: false,
        hasMissingTables: false,
        details: [],
      },
      schemaState: null,
    };
  }

  const schemaState = await getSchemaState(componentId);
  const details: string[] = [];
  let hasUnexpectedTables = false;
  let hasMissingTables = false;

  for (const tableManifest of component.schemaManifest.tables) {
    const exists = await tableExists(tableManifest.tableName);
    const stateEntry = schemaState?.tables.find(t => t.tableName === tableManifest.tableName);

    if (stateEntry?.status === "active" && !exists) {
      hasMissingTables = true;
      details.push(`Table ${tableManifest.tableName} is marked active but does not exist in database`);
    } else if ((!stateEntry || stateEntry.status === "dropped") && exists) {
      hasUnexpectedTables = true;
      details.push(`Table ${tableManifest.tableName} exists in database but is not tracked as active`);
    }
  }

  const drift: ComponentSchemaDrift = {
    lastCheckAt: now,
    hasUnexpectedTables,
    hasMissingTables,
    details,
  };

  if (schemaState) {
    const updatedState: ComponentSchemaState = {
      ...schemaState,
      drift,
    };
    await saveSchemaState(componentId, updatedState);
    return { componentId, drift, schemaState: updatedState };
  }

  return { componentId, drift, schemaState };
}

export async function getComponentSchemaInfo(component: ComponentDefinition): Promise<{
  hasSchema: boolean;
  tables: string[];
  schemaState: ComponentSchemaState | null;
  tablesExist: boolean[];
}> {
  if (!component.managesSchema || !component.schemaManifest) {
    return {
      hasSchema: false,
      tables: [],
      schemaState: null,
      tablesExist: [],
    };
  }

  const tables = component.schemaManifest.tables.map(t => t.tableName);
  const schemaState = await getSchemaState(component.id);
  const tablesExist: boolean[] = [];

  for (const tableName of tables) {
    const exists = await tableExists(tableName);
    tablesExist.push(exists);
  }

  return {
    hasSchema: true,
    tables,
    schemaState,
    tablesExist,
  };
}
