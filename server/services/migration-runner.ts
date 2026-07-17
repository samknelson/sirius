import { storage } from "../storage";
import { logger } from "../logger";
import { getComponentSchemaStateVariableName, type ComponentSchemaState } from "../../shared/components";

export interface Migration {
  version: number;
  name: string;
  description: string;
  up: () => Promise<void>;
}

const MIGRATIONS_VARIABLE_NAME = "migrations_version";

let registeredMigrations: Migration[] = [];
const componentMigrations = new Map<string, Migration[]>();

export function registerMigration(migration: Migration): void {
  registeredMigrations.push(migration);
  registeredMigrations.sort((a, b) => a.version - b.version);
}

export function getMigrations(): Migration[] {
  return [...registeredMigrations];
}

export function registerComponentMigration(componentId: string, migration: Migration): void {
  const list = componentMigrations.get(componentId) ?? [];
  if (list.some(m => m.version === migration.version)) {
    throw new Error(
      `Duplicate component migration version ${migration.version} for component ${componentId} ` +
      `(name "${migration.name}"). Per-component migration versions must be unique within their component.`,
    );
  }
  list.push(migration);
  list.sort((a, b) => a.version - b.version);
  componentMigrations.set(componentId, list);
}

export function getComponentMigrations(componentId: string): Migration[] {
  return [...(componentMigrations.get(componentId) ?? [])];
}

export function getAllComponentMigrations(): Map<string, Migration[]> {
  const out = new Map<string, Migration[]>();
  for (const [id, list] of componentMigrations) {
    out.set(id, [...list]);
  }
  return out;
}

async function getCurrentVersion(): Promise<number> {
  const variable = await storage.variables.getByName(MIGRATIONS_VARIABLE_NAME);
  if (variable && typeof variable.value === "number") {
    return variable.value;
  }
  return 0;
}

async function setCurrentVersion(version: number): Promise<void> {
  const existingVariable = await storage.variables.getByName(MIGRATIONS_VARIABLE_NAME);
  
  if (existingVariable) {
    await storage.variables.update(existingVariable.id, {
      name: MIGRATIONS_VARIABLE_NAME,
      value: version
    });
  } else {
    await storage.variables.create({
      name: MIGRATIONS_VARIABLE_NAME,
      value: version
    });
  }
}

export async function runMigrations(): Promise<{ ran: number; skipped: number; errors: string[] }> {
  const currentVersion = await getCurrentVersion();
  const pendingMigrations = registeredMigrations.filter(m => m.version > currentVersion);
  
  if (pendingMigrations.length === 0) {
    logger.debug("No pending migrations", { 
      service: "migration-runner",
      currentVersion 
    });
    return { ran: 0, skipped: registeredMigrations.length, errors: [] };
  }

  logger.info("Starting migrations", {
    service: "migration-runner",
    currentVersion,
    pendingCount: pendingMigrations.length
  });

  let ran = 0;
  const errors: string[] = [];

  for (const migration of pendingMigrations) {
    try {
      logger.info(`Running migration ${migration.version}: ${migration.name}`, {
        service: "migration-runner",
        version: migration.version,
        name: migration.name
      });
      
      await migration.up();
      await setCurrentVersion(migration.version);
      ran++;
      
      logger.info(`Migration ${migration.version} completed successfully`, {
        service: "migration-runner",
        version: migration.version,
        name: migration.name
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      errors.push(`Migration ${migration.version} (${migration.name}) failed: ${errorMessage}`);
      
      logger.error(`Migration ${migration.version} failed`, {
        service: "migration-runner",
        version: migration.version,
        name: migration.name,
        error: errorMessage
      });
      
      break;
    }
  }

  return { 
    ran, 
    skipped: registeredMigrations.length - pendingMigrations.length,
    errors 
  };
}

export async function getMigrationStatus(): Promise<{
  currentVersion: number;
  totalMigrations: number;
  pendingMigrations: Migration[];
}> {
  const currentVersion = await getCurrentVersion();
  const pendingMigrations = registeredMigrations.filter(m => m.version > currentVersion);
  
  return {
    currentVersion,
    totalMigrations: registeredMigrations.length,
    pendingMigrations
  };
}

async function readComponentSchemaState(componentId: string): Promise<{
  state: ComponentSchemaState | null;
  variableId: string | null;
}> {
  const name = getComponentSchemaStateVariableName(componentId);
  const variable = await storage.variables.getByName(name);
  if (!variable) return { state: null, variableId: null };
  return { state: variable.value as ComponentSchemaState, variableId: variable.id };
}

async function writeComponentSchemaState(
  componentId: string,
  state: ComponentSchemaState,
  existingVariableId: string | null,
): Promise<void> {
  const name = getComponentSchemaStateVariableName(componentId);
  if (existingVariableId) {
    await storage.variables.update(existingVariableId, { name, value: state });
  } else {
    await storage.variables.create({ name, value: state });
  }
}

export interface ComponentMigrationResult {
  componentId: string;
  ran: number;
  skipped: number;
  fromVersion: number;
  toVersion: number;
  errors: string[];
}

/**
 * Run all registered migrations for the given component whose version is
 * greater than the component's recorded `migrationVersion` in its
 * `component_schema_state_<id>` variable. Stops at the first failure.
 *
 * The component's schema state variable must already exist (e.g. created by
 * the enable flow when tables are created). If it does not, the caller is
 * responsible for creating it first — this function will refuse to invent
 * one because doing so would silently lose the table-state audit trail.
 */
export async function runComponentMigrations(componentId: string): Promise<ComponentMigrationResult> {
  const list = componentMigrations.get(componentId) ?? [];
  const { state, variableId } = await readComponentSchemaState(componentId);

  if (!state) {
    return {
      componentId,
      ran: 0,
      skipped: list.length,
      fromVersion: 0,
      toVersion: 0,
      errors: list.length > 0
        ? [`Component ${componentId} has ${list.length} migration(s) registered but no component_schema_state variable exists yet — enable the component first.`]
        : [],
    };
  }

  const fromVersion = state.migrationVersion ?? 0;
  const pending = list.filter(m => m.version > fromVersion);

  if (pending.length === 0) {
    return {
      componentId,
      ran: 0,
      skipped: list.length,
      fromVersion,
      toVersion: fromVersion,
      errors: [],
    };
  }

  logger.info(`Running component migrations for ${componentId}`, {
    service: "migration-runner",
    componentId,
    fromVersion,
    pendingCount: pending.length,
  });

  let ran = 0;
  let toVersion = fromVersion;
  const errors: string[] = [];
  const appliedLog = state.migrationsApplied ? [...state.migrationsApplied] : [];

  for (const migration of pending) {
    try {
      logger.info(`Running component migration ${componentId}:${migration.version} ${migration.name}`, {
        service: "migration-runner",
        componentId,
        version: migration.version,
        name: migration.name,
      });
      await migration.up();
      toVersion = migration.version;
      appliedLog.push({
        version: migration.version,
        name: migration.name,
        appliedAt: new Date().toISOString(),
      });
      const updated: ComponentSchemaState = {
        ...state,
        migrationVersion: toVersion,
        migrationsApplied: appliedLog,
      };
      await writeComponentSchemaState(componentId, updated, variableId);
      ran++;
      logger.info(`Component migration ${componentId}:${migration.version} completed`, {
        service: "migration-runner",
        componentId,
        version: migration.version,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      errors.push(`Component migration ${componentId}:${migration.version} (${migration.name}) failed: ${msg}`);
      logger.error(`Component migration failed`, {
        service: "migration-runner",
        componentId,
        version: migration.version,
        name: migration.name,
        error: msg,
      });
      break;
    }
  }

  return {
    componentId,
    ran,
    skipped: list.length - ran,
    fromVersion,
    toVersion,
    errors,
  };
}

/**
 * Run any pending per-component migrations for every component that is
 * currently enabled. Called at startup after the component cache is loaded
 * and before the drift gate runs, so a freshly-added per-component migration
 * does not block boot.
 *
 * Throws if any component reports errors — the drift gate would otherwise
 * fail anyway, and surfacing the migration error gives the operator a clearer
 * diagnostic.
 */
export async function runPendingComponentMigrationsAtStartup(): Promise<void> {
  const { getAllComponents } = await import("../../shared/components");
  const { isComponentEnabledSync } = await import("./component-cache");
  const errors: string[] = [];
  let totalRan = 0;
  for (const component of getAllComponents()) {
    if (!component.managesSchema) continue;
    if (!isComponentEnabledSync(component.id)) continue;
    if ((componentMigrations.get(component.id) ?? []).length === 0) continue;

    // A component that gains schema management while it is ALREADY enabled on a
    // deployment has no `component_schema_state_<id>` variable yet — that
    // variable is normally created by the enable flow. Without it,
    // runComponentMigrations refuses to run (by design) and boot fails. Bring
    // it up to the state the enable flow would have left it in, then let the
    // enable flow run its pending migrations. enableComponentSchema is
    // idempotent for an already-present, drift-free table: it creates-if-missing,
    // reflects table state, preserves any existing migrationVersion, and runs
    // pending migrations itself.
    const { state } = await readComponentSchemaState(component.id);
    if (!state) {
      const { enableComponentSchema } = await import("./component-lifecycle");
      let enable = await enableComponentSchema(component.id);
      if (
        !enable.success &&
        (enable.driftTables?.length ?? 0) > 0 &&
        (componentMigrations.get(component.id) ?? []).length > 0
      ) {
        // Chicken-and-egg: the component has no schema-state variable AND its
        // existing table drifts from the expected schema in exactly the way a
        // pending registered migration would fix. enableComponentSchema pushes
        // the schema BEFORE running migrations, so it fails on that drift.
        // Seed a minimal state at migrationVersion 0 (migrations are required
        // to be idempotent), run the pending migrations to bring the table up
        // to date, then retry the enable flow to reflect the now-conforming
        // table into the state variable.
        await writeComponentSchemaState(
          component.id,
          {
            manifestVersion: 0,
            lastSyncedAt: new Date().toISOString(),
            tables: [],
            drift: null,
            migrationVersion: 0,
          },
          null,
        );
        logger.info("Seeded minimal schema state to run pending migrations before enable retry", {
          service: "migration-runner",
          componentId: component.id,
        });
        const mig = await runComponentMigrations(component.id);
        totalRan += mig.ran;
        if (mig.errors.length === 0) {
          enable = await enableComponentSchema(component.id);
        } else {
          errors.push(...mig.errors);
        }
        if (mig.errors.length > 0 || !enable.success) {
          // Recovery failed — remove the seeded synthetic state so the next
          // boot re-enters this same recovery path instead of finding a
          // half-initialized state variable (manifestVersion 0, no tables)
          // and silently changing behavior. If migrations partially applied,
          // they are idempotent by contract and will be replayed safely.
          const { variableId: seededId } = await readComponentSchemaState(component.id);
          if (seededId) {
            await storage.variables.delete(seededId);
            logger.warn("Removed seeded schema state after failed startup recovery", {
              service: "migration-runner",
              componentId: component.id,
            });
          }
          if (mig.errors.length > 0) {
            continue;
          }
        }
      }
      if (enable.success) {
        logger.info("Initialized schema state for newly schema-managing enabled component at startup", {
          service: "migration-runner",
          componentId: component.id,
        });
      } else {
        errors.push(
          `Component ${component.id}: failed to initialize schema state at startup: ${enable.error ?? "unknown error"}`,
        );
      }
      continue;
    }

    const result = await runComponentMigrations(component.id);
    totalRan += result.ran;
    errors.push(...result.errors);
  }
  if (totalRan > 0) {
    logger.info("Startup component migrations applied", {
      service: "migration-runner",
      totalRan,
    });
  }
  if (errors.length > 0) {
    throw new Error(`Startup component migrations failed:\n  - ${errors.join("\n  - ")}`);
  }
}
