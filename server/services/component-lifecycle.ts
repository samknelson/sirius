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
import { runComponentMigrations, getComponentMigrations } from "./migration-runner";

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
    console.error(`Component schema push failed for ${componentId}:`, errorMessage, error instanceof Error ? error.stack : '');
    operations.push({
      success: false,
      tableName: component.schemaManifest.schemaPath,
      operation: "push",
      error: errorMessage,
    });
  }

  const allSuccessful = !hasError;
  
  if (allSuccessful) {
    // Preserve any existing migrationVersion / migrationsApplied across
    // disable→enable cycles. The state variable is only deleted by an
    // explicit non-retain disable; otherwise it remains, and we must not
    // reset its migration bookkeeping just because the user toggled the
    // component off and back on.
    const existingState = await getSchemaState(componentId);
    const schemaState: ComponentSchemaState = {
      manifestVersion: component.schemaManifest.version ?? 1,
      lastSyncedAt: now,
      tables: tableStates,
      drift: null,
      migrationVersion: existingState?.migrationVersion ?? 0,
      migrationsApplied: existingState?.migrationsApplied,
    };
    await saveSchemaState(componentId, schemaState);

    // Run any per-component migrations that have been registered but not yet
    // applied to this deployment. The runner reads/updates the same
    // component_schema_state_<id> variable we just wrote.
    if (getComponentMigrations(componentId).length > 0) {
      const result = await runComponentMigrations(componentId);
      if (result.errors.length > 0) {
        return {
          success: false,
          componentId,
          schemaOperations: operations,
          schemaState: null,
          error: `Component schema created, but migrations failed: ${result.errors.join("; ")}`,
        };
      }
    }

    const finalState = (await getSchemaState(componentId)) ?? schemaState;
    return {
      success: true,
      componentId,
      schemaOperations: operations,
      schemaState: finalState,
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

export interface PluginConfigReconcileResult {
  componentId: string;
  created: string[];
  reactivated: string[];
  disabled: string[];
}

/**
 * Materialize (enable) or deactivate (disable) the `plugin_configs` rows a
 * component owns (Task #397). Rows are keyed by their stable `siriusId`
 * (`auto.<componentId>.<localId>`):
 *
 * - enable: create the row if missing (`enabled = true`), else re-activate the
 *   existing row (`enabled = true`) WITHOUT clobbering any admin edits to
 *   name / ordering / data.
 * - disable: set `enabled = false` on existing rows and retain them, so admin
 *   edits survive a disable→enable cycle.
 *
 * Components with no `pluginConfigs` are a no-op. Safe to call repeatedly
 * (idempotent), which is what the boot-time reconcile relies on.
 */
export async function reconcileComponentPluginConfigs(
  componentId: string,
  enabled: boolean,
): Promise<PluginConfigReconcileResult> {
  const result: PluginConfigReconcileResult = {
    componentId,
    created: [],
    reactivated: [],
    disabled: [],
  };

  const component = getComponentById(componentId);
  if (!component?.pluginConfigs?.length) return result;

  for (const managed of component.pluginConfigs) {
    const existing = await storage.pluginConfigs.findBySiriusId(managed.siriusId);

    if (enabled) {
      if (!existing) {
        await storage.pluginConfigs.create({
          pluginType: managed.pluginType,
          pluginId: managed.pluginId,
          siriusId: managed.siriusId,
          name: managed.name ?? null,
          ordering: managed.ordering ?? 0,
          enabled: true,
          data: managed.data ?? {},
        });
        result.created.push(managed.siriusId);
      } else if (!existing.enabled) {
        // Re-activate only; preserve admin edits to name/ordering/data.
        await storage.pluginConfigs.update(existing.id, { enabled: true });
        result.reactivated.push(managed.siriusId);
      }
    } else if (existing && existing.enabled) {
      await storage.pluginConfigs.update(existing.id, { enabled: false });
      result.disabled.push(managed.siriusId);
    }
  }

  return result;
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
