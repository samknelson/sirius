import { storage } from "../storage";
import { tableExists } from "../storage/utils";
import {
  getComponentById,
  getComponentSchemaStateVariableName,
  ComponentSchemaState,
  ComponentTableState,
  ComponentSchemaDrift,
  ComponentDefinition,
} from "../../shared/components";

export interface SchemaOperationResult {
  success: boolean;
  tableName: string;
  operation: "create" | "drop" | "push" | "retain";
  error?: string;
  message?: string;
}

export interface ComponentLifecycleResult {
  success: boolean;
  componentId: string;
  schemaOperations: SchemaOperationResult[];
  schemaState: ComponentSchemaState | null;
  error?: string;
  message?: string;
}

export interface DriftCheckResult {
  componentId: string;
  drift: ComponentSchemaDrift;
  schemaState: ComponentSchemaState | null;
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

  try {
    const { pushComponentSchema } = await import("./component-schema-push");
    await pushComponentSchema(componentId);
    
    for (const tableName of component.schemaManifest.tables) {
      const exists = await tableExists(tableName);
      
      if (exists) {
        operations.push({
          success: true,
          tableName,
          operation: "push",
        });

        tableStates.push({
          tableName,
          status: "active",
          appliedAt: now,
          droppedAt: null,
          checksum: `v${component.schemaManifest.version ?? 1}`,
        });
      } else {
        hasError = true;
        operations.push({
          success: false,
          tableName,
          operation: "push",
          error: `Table ${tableName} was not created by schema push`,
        });
      }
    }
  } catch (error) {
    hasError = true;
    const errorMessage = error instanceof Error ? error.message : String(error);
    operations.push({
      success: false,
      tableName: component.schemaManifest.schemaPath,
      operation: "push",
      error: errorMessage,
    });
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
    error: "Schema push failed - state not saved",
  };
}

export interface DisableSchemaOptions {
  retainData?: boolean;
}

export async function disableComponentSchema(
  componentId: string,
  options: DisableSchemaOptions = {}
): Promise<ComponentLifecycleResult> {
  const { retainData = true } = options;
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

  if (retainData) {
    for (const tableName of component.schemaManifest.tables) {
      const exists = await tableExists(tableName);
      operations.push({
        success: true,
        tableName,
        operation: "retain",
        message: exists ? "Table retained" : "Table does not exist",
      });
    }
    
    return {
      success: true,
      componentId,
      schemaOperations: operations,
      schemaState: null,
      message: "Component disabled with tables retained",
    };
  }

  for (const tableName of component.schemaManifest.tables) {
    try {
      const exists = await tableExists(tableName);
      
      if (exists) {
        await storage.rawSql.execute(`DROP TABLE IF EXISTS ${tableName} CASCADE`);
      }
      
      operations.push({
        success: true,
        tableName,
        operation: "drop",
      });
    } catch (error) {
      hasError = true;
      const errorMessage = error instanceof Error ? error.message : String(error);
      operations.push({
        success: false,
        tableName,
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

  for (const tableName of component.schemaManifest.tables) {
    const exists = await tableExists(tableName);
    const stateEntry = schemaState?.tables.find(t => t.tableName === tableName);

    if (stateEntry?.status === "active" && !exists) {
      hasMissingTables = true;
      details.push(`Table ${tableName} is marked active but does not exist in database`);
    } else if ((!stateEntry || stateEntry.status === "dropped") && exists) {
      hasUnexpectedTables = true;
      details.push(`Table ${tableName} exists in database but is not tracked as active`);
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

  const tables = component.schemaManifest.tables;
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
