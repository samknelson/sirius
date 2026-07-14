import { storage } from "../storage";
import { tableExists, tableHasRows } from "../storage/utils";
import { storageLogger } from "../logger";
import type { SchemaDriftReport } from "./component-schema-push";
import {
  getComponentById,
  getComponentSchemaStateVariableName,
  ComponentSchemaState,
  ComponentTableState,
  ComponentSchemaDrift,
  ComponentDefinition,
} from "../../shared/components";
import { runComponentMigrations, getComponentMigrations } from "./migration-runner";
import { isComponentEnabledSync, isCacheInitialized, loadComponentCache } from "./component-cache";

export interface SchemaOperationResult {
  success: boolean;
  tableName: string;
  operation: "create" | "drop" | "push" | "retain";
  error?: string;
  message?: string;
}

export interface MissingDependency {
  componentId: string;
  componentName: string;
  reason: "disabled" | "tables-missing";
  missingTables: string[];
}

export interface DriftedTableInfo {
  tableName: string;
  /** True when the drifted table contains rows — repair (drop/recreate) is NOT safe. */
  hasRows: boolean;
  /** Human-readable description of the drift on this table. */
  detail: string;
}

export interface ComponentLifecycleResult {
  success: boolean;
  componentId: string;
  schemaOperations: SchemaOperationResult[];
  schemaState: ComponentSchemaState | null;
  error?: string;
  message?: string;
  /** Set when enable was refused because prerequisite components are not ready. */
  missingDependencies?: MissingDependency[];
  /** Set when enable failed because existing tables drifted from the expected schema. */
  driftTables?: DriftedTableInfo[];
  /** Set by repairComponentSchema: tables that were dropped and recreated. */
  repairedTables?: string[];
}

function formatDriftReport(r: SchemaDriftReport): string {
  const parts: string[] = [];
  if (r.missingColumns.length) parts.push(`missing columns: ${r.missingColumns.join(", ")}`);
  if (r.extraColumns.length) parts.push(`extra columns: ${r.extraColumns.join(", ")}`);
  if (r.typeMismatches.length) parts.push(`type mismatches: ${r.typeMismatches.join("; ")}`);
  if (r.missingConstraints.length) parts.push(`missing constraints: ${r.missingConstraints.join("; ")}`);
  if (r.missingIndexes.length) parts.push(`missing indexes: ${r.missingIndexes.join("; ")}`);
  return parts.length ? parts.join("; ") : "unspecified drift";
}

interface DriftErrorLike extends Error {
  reports: SchemaDriftReport[];
}

/**
 * Structural check instead of `instanceof` because ComponentSchemaDriftError
 * is loaded via dynamic import (to avoid a static import cycle) and dual
 * module instances would defeat an instanceof test.
 */
function isDriftError(error: unknown): error is DriftErrorLike {
  return (
    error instanceof Error &&
    error.name === "ComponentSchemaDriftError" &&
    Array.isArray((error as DriftErrorLike).reports)
  );
}

function summarizeFailedOperations(operations: SchemaOperationResult[]): string {
  const failed = operations.filter((op) => !op.success);
  if (failed.length === 0) return "Schema push failed";
  return failed
    .map((op) => `${op.tableName}: ${op.error ?? "unknown error"}`)
    .join(" | ");
}

function logLifecycleFailure(
  operation: string,
  componentId: string,
  error: string | undefined,
  operations: SchemaOperationResult[],
  extra?: Record<string, unknown>,
): void {
  storageLogger.error(`Component ${operation} failed for ${componentId}: ${error ?? "unknown error"}`, {
    source: "components",
    module: "components",
    operation,
    entity_id: componentId,
    description: error ?? null,
    schema_operations: operations,
    ...extra,
  });
}

/**
 * Check that every component listed in `dependsOnComponents` is enabled and
 * has its tables present, so a schema push doesn't die on a raw FK error.
 */
export async function checkSchemaDependencies(
  component: ComponentDefinition,
): Promise<MissingDependency[]> {
  const deps = component.schemaManifest?.dependsOnComponents ?? [];
  if (deps.length === 0) return [];

  if (!isCacheInitialized()) {
    await loadComponentCache();
  }

  const missing: MissingDependency[] = [];
  for (const depId of deps) {
    const dep = getComponentById(depId);
    const depName = dep?.name ?? depId;

    if (!isComponentEnabledSync(depId)) {
      missing.push({ componentId: depId, componentName: depName, reason: "disabled", missingTables: [] });
      continue;
    }

    const depTables = dep?.schemaManifest?.tables ?? [];
    const missingTables: string[] = [];
    for (const tableName of depTables) {
      if (!(await tableExists(tableName))) {
        missingTables.push(tableName);
      }
    }
    if (missingTables.length > 0) {
      missing.push({ componentId: depId, componentName: depName, reason: "tables-missing", missingTables });
    }
  }
  return missing;
}

function formatMissingDependencies(componentName: string, missing: MissingDependency[]): string {
  const parts = missing.map((m) =>
    m.reason === "disabled"
      ? `"${m.componentName}" (${m.componentId}) is not enabled`
      : `"${m.componentName}" (${m.componentId}) is enabled but its tables are missing: ${m.missingTables.join(", ")}`,
  );
  return (
    `Cannot enable "${componentName}" because it depends on other components that are not ready: ` +
    parts.join("; ") +
    ". Enable the prerequisite components first, then try again."
  );
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

  const missingDependencies = await checkSchemaDependencies(component);
  if (missingDependencies.length > 0) {
    return {
      success: false,
      componentId,
      schemaOperations: [],
      schemaState: null,
      missingDependencies,
      error: formatMissingDependencies(component.name, missingDependencies),
    };
  }

  const operations: SchemaOperationResult[] = [];
  const tableStates: ComponentTableState[] = [];
  const driftTables: DriftedTableInfo[] = [];
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
    if (isDriftError(error)) {
      for (const report of error.reports) {
        const detail = formatDriftReport(report);
        let hasRows = false;
        try {
          hasRows = await tableHasRows(report.tableName);
        } catch {
          // If we cannot determine emptiness, treat the table as holding data
          // so no unsafe repair is offered.
          hasRows = true;
        }
        driftTables.push({ tableName: report.tableName, hasRows, detail });
        operations.push({
          success: false,
          tableName: report.tableName,
          operation: "push",
          error: `Table exists but does not match the expected schema — ${detail}${hasRows ? " (table contains data; requires a migration)" : " (table is empty; safe to repair)"}`,
        });
      }
    } else {
      operations.push({
        success: false,
        tableName: component.schemaManifest.schemaPath,
        operation: "push",
        error: errorMessage,
      });
    }
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
        const error = `Component schema created, but migrations failed: ${result.errors.join("; ")}`;
        logLifecycleFailure("schema_enable", componentId, error, operations);
        return {
          success: false,
          componentId,
          schemaOperations: operations,
          schemaState: null,
          error,
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

  const error = `Schema push failed: ${summarizeFailedOperations(operations)}`;
  logLifecycleFailure("schema_enable", componentId, error, operations, {
    drift_tables: driftTables.length ? driftTables : undefined,
  });
  return {
    success: false,
    componentId,
    schemaOperations: operations,
    schemaState: null,
    error,
    driftTables: driftTables.length ? driftTables : undefined,
  };
}

/**
 * Repair-and-retry for a failed component enable (Task #727).
 *
 * A table left behind in a mismatched shape by a previously failed enable has
 * never been used and holds no data, so dropping and recreating it is safe.
 * This function:
 *   1. Re-runs the schema push to collect the current drift reports.
 *   2. Refuses to touch any drifted table that contains rows (those require an
 *      authored migration).
 *   3. Atomically drops each EMPTY drifted table (the emptiness check and the
 *      DROP happen in a single server-side statement, so a concurrent insert
 *      cannot slip between them).
 *   4. Re-runs the normal enable flow to recreate the tables and save state.
 *
 * Every repair action is written to the DB-backed log.
 */
export async function repairComponentSchema(componentId: string): Promise<ComponentLifecycleResult> {
  const component = getComponentById(componentId);

  if (!component || !component.managesSchema || !component.schemaManifest) {
    return {
      success: false,
      componentId,
      schemaOperations: [],
      schemaState: null,
      error: component
        ? `Component ${componentId} does not manage a schema`
        : `Component not found: ${componentId}`,
    };
  }

  const missingDependencies = await checkSchemaDependencies(component);
  if (missingDependencies.length > 0) {
    return {
      success: false,
      componentId,
      schemaOperations: [],
      schemaState: null,
      missingDependencies,
      error: formatMissingDependencies(component.name, missingDependencies),
    };
  }

  // Collect current drift reports by attempting the push.
  let reports: SchemaDriftReport[] = [];
  try {
    const { pushComponentSchema } = await import("./component-schema-push");
    await pushComponentSchema(componentId);
    // No drift — nothing to repair; fall through to the normal enable to
    // record state (and run migrations).
  } catch (error) {
    if (isDriftError(error)) {
      reports = error.reports;
    } else {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logLifecycleFailure("schema_repair", componentId, errorMessage, []);
      return {
        success: false,
        componentId,
        schemaOperations: [],
        schemaState: null,
        error: `Repair failed before any changes were made: ${errorMessage}`,
      };
    }
  }

  const blocked: string[] = [];
  for (const report of reports) {
    const hasRows = await tableHasRows(report.tableName).catch(() => true);
    if (hasRows) blocked.push(report.tableName);
  }
  if (blocked.length > 0) {
    const error =
      `Cannot repair: table(s) ${blocked.join(", ")} contain data. ` +
      `Repair only drops empty tables; tables with data require an authored migration.`;
    logLifecycleFailure("schema_repair", componentId, error, []);
    return {
      success: false,
      componentId,
      schemaOperations: [],
      schemaState: null,
      error,
    };
  }

  const repairedTables: string[] = [];
  const operations: SchemaOperationResult[] = [];
  for (const report of reports) {
    try {
      await storage.rawSql.dropTableIfEmpty(report.tableName);
      repairedTables.push(report.tableName);
      operations.push({ success: true, tableName: report.tableName, operation: "drop", message: "Dropped empty drifted table for repair" });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      operations.push({ success: false, tableName: report.tableName, operation: "drop", error: errorMessage });
      const summary = `Repair aborted while dropping ${report.tableName}: ${errorMessage}`;
      logLifecycleFailure("schema_repair", componentId, summary, operations, { repaired_tables: repairedTables });
      return {
        success: false,
        componentId,
        schemaOperations: operations,
        schemaState: null,
        error: summary,
        repairedTables,
      };
    }
  }

  storageLogger.info(
    `Component schema repair for ${componentId}: dropped ${repairedTables.length ? repairedTables.join(", ") : "no tables"}; retrying enable`,
    {
      source: "components",
      module: "components",
      operation: "schema_repair",
      entity_id: componentId,
      repaired_tables: repairedTables,
      drift_reports: reports.map((r) => ({ tableName: r.tableName, detail: formatDriftReport(r) })),
    },
  );

  const enableResult = await enableComponentSchema(componentId);
  return {
    ...enableResult,
    schemaOperations: [...operations, ...enableResult.schemaOperations],
    repairedTables,
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

  const disableError = `Some schema operations failed - state not deleted: ${summarizeFailedOperations(operations)}`;
  logLifecycleFailure("schema_disable", componentId, disableError, operations);
  return {
    success: false,
    componentId,
    schemaOperations: operations,
    schemaState: null,
    error: disableError,
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
          pluginKind: managed.pluginKind,
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
