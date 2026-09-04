import { storage } from "../storage";
import { logger } from "../logger";
import { getComponentSchemaStateVariableName, type ComponentSchemaState } from "../../shared/components";

export interface Migration {
  version: number;
  name: string;
  description: string;
  up: () => Promise<void>;
  /**
   * True for a per-deployment BASELINE script (`scripts/migrate/baseline/`).
   *
   * Baselines are registered as core migrations in the reserved `>= 1000`
   * range, but they are not part of the ordinary numbered sequence, and the
   * distinction matters at boot: the empty-database bootstrap stamps
   * `migrations_version` to the HIGHEST registered core version, so a
   * baseline numbered above the last ordinary migration would permanently
   * retire every ordinary migration between them. `assertBaselinesBelowCore`
   * refuses to start in that situation.
   */
  baseline?: boolean;
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

/** Highest version among the given migrations (0 when there are none). */
function highestVersion(list: { version: number }[]): number {
  return list.reduce((max, m) => Math.max(max, m.version), 0);
}

/** Highest registered ORDINARY (non-baseline) core migration version. */
export function getHighestCoreMigrationVersion(): number {
  return highestVersion(registeredMigrations.filter((m) => !m.baseline));
}

/** Highest registered BASELINE version (0 when none are registered). */
export function getHighestBaselineVersion(): number {
  return highestVersion(registeredMigrations.filter((m) => m.baseline));
}

/**
 * Refuse to start when a baseline script is registered ABOVE the highest
 * ordinary core migration.
 *
 * The empty-database bootstrap stamps `migrations_version` to the highest
 * registered core version. If a baseline sits above the ordinary sequence,
 * that stamp silently retires every ordinary migration below it — on a fresh
 * database the bootstrap creates the current schema so nothing breaks, but
 * the next ordinary migration added below the baseline would never run
 * anywhere, and the failure mode is a drift report with no explanation. A
 * new baseline must be numbered above the ordinary migrations that existed
 * when it was written and BELOW any that come after; in practice that means
 * bumping it whenever an ordinary migration overtakes it is wrong — renumber
 * the baseline down instead.
 */
export function assertBaselinesBelowCore(): void {
  const highestBaseline = getHighestBaselineVersion();
  const highestCore = getHighestCoreMigrationVersion();
  if (highestBaseline === 0 || highestBaseline <= highestCore) return;
  const offenders = registeredMigrations
    .filter((m) => m.baseline && m.version > highestCore)
    .map((m) => `${m.version} (${m.name})`)
    .join(", ");
  throw new Error(
    [
      `Baseline migration(s) registered above the highest ordinary core migration (${highestCore}): ${offenders}.`,
      "",
      "The empty-database bootstrap stamps `migrations_version` to the highest",
      "registered core version, so every ordinary migration below a higher-numbered",
      "baseline would be permanently skipped on a freshly created database.",
      "Renumber the baseline below the ordinary sequence (it still runs after the",
      "migrations it was written against, because it is only applied to databases",
      "whose stored version is below it).",
    ].join("\n"),
  );
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

/**
 * The one-shot recovery path for a database whose `migrations_version` is
 * stamped AHEAD of its actual schema (the empty-database bootstrap stamps
 * the highest registered version; a restored dump or a hand-edited variable
 * can do the same).
 *
 * The operator of a target with no shell can only set environment variables
 * and redeploy, so this is their only way to make guarded migrations replay.
 * It is NEVER inferred and NEVER defaulted: the variable names the exact
 * version to resume FROM, and the runner then applies every registered
 * migration above it.
 *
 * IT SETS THE STAMP IN EITHER DIRECTION, and both directions are one-shot
 * recovery actions with different risks:
 *
 *   - LOWERING is the repair for a stamp ahead of the schema. It only helps
 *     because the migrations it replays check for their own work first
 *     (`IF NOT EXISTS`, or an information_schema probe that returns early).
 *     That is a convention, not a guarantee — if one of them refuses to
 *     re-apply, the boot stops on it by name.
 *   - RAISING is the escape from exactly that situation: it declares the
 *     migrations at or below the named version already applied, so the
 *     replay resumes past the one that would not re-apply. Nothing verifies
 *     that claim, which is why it is logged as loudly as the lowering, and
 *     why the operator has to name the version themselves.
 *
 * Without the raising direction a wedged replay would need database access
 * to undo — which is the one thing the target does not have.
 */
export async function applyMigrationVersionResume(
  requestedRaw: string,
): Promise<{ requestedVersion: number; previousVersion: number; applied: boolean }> {
  const requestedVersion = Number(requestedRaw);
  if (!Number.isInteger(requestedVersion) || requestedVersion < 0) {
    throw new Error(
      `MIGRATIONS_RESUME_FROM_VERSION must be a non-negative integer (got "${requestedRaw}"). ` +
        "It names the core migration version to resume FROM: every registered migration " +
        "above it re-applies on this boot.",
    );
  }

  const previousVersion = await getCurrentVersion();
  if (previousVersion === requestedVersion) {
    logger.warn("MIGRATIONS_RESUME_FROM_VERSION matches the stored version — nothing to change", {
      service: "migration-runner",
      requestedVersion,
      previousVersion,
    });
    return { requestedVersion, previousVersion, applied: false };
  }

  const lowering = requestedVersion < previousVersion;
  await setCurrentVersion(requestedVersion);
  logger.warn(
    `ONE-SHOT RECOVERY: ${lowering ? "lowering" : "RAISING"} the stored core migration version on operator request`,
    {
      service: "migration-runner",
      source: "startup",
      requestedVersion,
      previousVersion,
      variable: "MIGRATIONS_RESUME_FROM_VERSION",
    },
  );
  console.warn(
    `[migration-runner] ONE-SHOT RECOVERY: MIGRATIONS_RESUME_FROM_VERSION=${requestedVersion} ` +
      `${lowering ? "lowered" : "RAISED"} migrations_version from ${previousVersion} to ${requestedVersion}. ` +
      (lowering
        ? "Every registered core migration above that version will re-apply on this boot. "
        : "Every registered core migration at or below that version is now treated as APPLIED and " +
          "will never run on this database — only do this for migrations whose work is verifiably " +
          "already present. ") +
      "Remove the variable once the boot succeeds, or it will set the stamp again on every restart.",
  );
  return { requestedVersion, previousVersion, applied: true };
}

/** A core migration failed. Fatal: the boot must not continue half-migrated. */
export class CoreMigrationFailedError extends Error {
  constructor(
    readonly failed: { version: number; name: string; error: string },
    readonly remaining: Migration[],
  ) {
    super(
      [
        `Core migration ${failed.version} (${failed.name}) FAILED and stopped the boot.`,
        "",
        `  error: ${failed.error}`,
        "",
        remaining.length > 0
          ? `Still pending behind it: ${remaining.map((m) => `${m.version} (${m.name})`).join(", ")}.`
          : "It was the last pending migration.",
        "The database is half-migrated; the app refuses to serve traffic against it.",
        "Fix the cause of the error above (it is the real fault — the schema drift a",
        "later gate would report is only its symptom) and redeploy.",
      ].join("\n"),
    );
    this.name = "CoreMigrationFailedError";
  }
}

export async function runMigrations(): Promise<{
  ran: number;
  skipped: number;
  errors: string[];
  /** Set when a migration threw; the boot must treat this as fatal. */
  failed?: { version: number; name: string; error: string };
  /** Pending migrations that never got a chance to run. */
  remaining: Migration[];
}> {
  const currentVersion = await getCurrentVersion();
  const pendingMigrations = registeredMigrations.filter(m => m.version > currentVersion);
  
  if (pendingMigrations.length === 0) {
    logger.debug("No pending migrations", { 
      service: "migration-runner",
      currentVersion 
    });
    return { ran: 0, skipped: registeredMigrations.length, errors: [], remaining: [] };
  }

  logger.info("Starting migrations", {
    service: "migration-runner",
    currentVersion,
    pendingCount: pendingMigrations.length
  });

  let ran = 0;
  const errors: string[] = [];
  let failed: { version: number; name: string; error: string } | undefined;

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
      failed = { version: migration.version, name: migration.name, error: errorMessage };
      
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
    errors,
    failed,
    remaining: failed
      ? pendingMigrations.filter((m) => m.version > failed!.version)
      : [],
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

/**
 * Read-only snapshot of per-component migration bookkeeping for the bring-up
 * report: which enabled schema-managing components have migrations, where
 * their stored `migrationVersion` sits, and what is pending. Writes nothing,
 * so it is safe in report-only mode. Requires the component cache.
 */
export async function collectComponentMigrationStatus(): Promise<{
  enabledCount: number;
  schemaManaging: {
    componentId: string;
    storedVersion: number | null;
    highestVersion: number;
    pending: { version: number; name: string }[];
  }[];
}> {
  const { getAllComponents } = await import("../../shared/components");
  const { isComponentEnabledSync } = await import("./component-cache");

  let enabledCount = 0;
  const schemaManaging: {
    componentId: string;
    storedVersion: number | null;
    highestVersion: number;
    pending: { version: number; name: string }[];
  }[] = [];

  for (const component of getAllComponents()) {
    if (!isComponentEnabledSync(component.id)) continue;
    enabledCount++;
    const list = componentMigrations.get(component.id) ?? [];
    if (!component.managesSchema && list.length === 0) continue;
    const { state } = await readComponentSchemaState(component.id);
    const storedVersion = state ? (state.migrationVersion ?? 0) : null;
    schemaManaging.push({
      componentId: component.id,
      storedVersion,
      highestVersion: highestVersion(list),
      pending: list
        .filter((m) => m.version > (storedVersion ?? 0))
        .map((m) => ({ version: m.version, name: m.name })),
    });
  }

  return { enabledCount, schemaManaging };
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
