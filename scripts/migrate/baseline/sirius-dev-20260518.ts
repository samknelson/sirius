/**
 * Baseline script — Sirius dev Repl — 2026-05-18.
 *
 * Brings this deployment's database into alignment with the per-component
 * migration framework introduced on this date. Idempotent on re-run.
 *
 * Two responsibilities:
 *   1. Apply DDL fix-ups for every enabled component table and every core
 *      table that has drifted from the latest Drizzle schema (missing
 *      columns, FKs, uniques, checks, indexes). The retired reflective
 *      auto-push closed column drift but never installed named constraints
 *      or indexes, so the live DB diverges from the Drizzle definition.
 *   2. Stamp `migrationVersion = 0` onto every existing
 *      `component_schema_state_<id>` variable so the per-component runner
 *      has a defined starting point.
 *
 * Registered as a CORE migration at the reserved baseline version range
 * (>= 1000). It runs once like any other core migration and is gated by
 * `migrations_version` afterwards.
 */
import { storage } from "../../../server/storage";
import { registerMigration, type Migration } from "../../../server/services/migration-runner";
import type { ComponentSchemaState } from "../../../shared/components";
import { getAllComponents } from "../../../shared/components";
import { isComponentEnabledSync, loadComponentCache } from "../../../server/services/component-cache";
import { generateDriftFixStatements } from "../../../server/services/component-schema-push";
import { tableExists } from "../../../server/storage/utils";
import * as mainSchema from "../../../shared/schema";
import { logger } from "../../../server/logger";

const BASELINE_VERSION = 1002;
const COMPONENT_STATE_PREFIX = "component_schema_state_";
const NAME_SYM_DESC = "drizzle:Name";

function getDrizzleTableName(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const sym = Object.getOwnPropertySymbols(value).find((s) => s.description === NAME_SYM_DESC);
  if (!sym) return null;
  const name = (value as Record<symbol, unknown>)[sym];
  return typeof name === "string" ? name : null;
}

function buildSchemaTableIndex(module: Record<string, unknown>): Map<string, any> {
  const out = new Map<string, any>();
  for (const value of Object.values(module)) {
    const name = getDrizzleTableName(value);
    if (name) out.set(name, value);
  }
  return out;
}

async function loadModule(schemaPath: string): Promise<Record<string, unknown>> {
  const rel = schemaPath.replace(/^\.\//, "");
  const url = new URL(`../../../${rel}`, import.meta.url);
  return (await import(url.href)) as Record<string, unknown>;
}

/**
 * A statement is considered "safely skippable" only when it fails because
 * its target references a relation that doesn't exist in the live DB —
 * typically a FK to a table whose owning component is not enabled on this
 * deployment. Any other failure must abort the baseline so the operator
 * sees the problem and the migration version is NOT advanced.
 */
function isSafelySkippableError(message: string): boolean {
  return /relation "[^"]+" does not exist/.test(message);
}

async function runStatement(sql: string): Promise<{ ok: boolean; skipped?: boolean; error?: string }> {
  try {
    await storage.rawSql.execute(sql);
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (isSafelySkippableError(msg)) {
      return { ok: false, skipped: true, error: msg };
    }
    return { ok: false, error: msg };
  }
}

async function applyDriftFixes(): Promise<{ tablesFixed: number; statementsRun: number; statementsSkipped: number }> {
  let tablesFixed = 0;
  let statementsRun = 0;
  let statementsSkipped = 0;
  const seen = new Set<string>();
  const hardErrors: string[] = [];
  const runOne = async (tableName: string, sql: string) => {
    const r = await runStatement(sql);
    if (r.ok) {
      statementsRun++;
    } else if (r.skipped) {
      statementsSkipped++;
      logger.warn("Baseline statement skipped (missing target table)", { service: "baseline", table: tableName, error: r.error, sql });
    } else {
      hardErrors.push(`[${tableName}] ${r.error} :: ${sql}`);
      logger.error("Baseline statement failed", { service: "baseline", table: tableName, error: r.error, sql });
    }
  };

  // ----- Enabled components -----
  for (const component of getAllComponents()) {
    if (!component.managesSchema || !component.schemaManifest) continue;
    if (!isComponentEnabledSync(component.id)) continue;

    let componentModule: Record<string, unknown>;
    try {
      componentModule = await loadModule(component.schemaManifest.schemaPath);
    } catch {
      componentModule = mainSchema as unknown as Record<string, unknown>;
    }
    const moduleIndex = buildSchemaTableIndex(componentModule);
    const mainIndex = buildSchemaTableIndex(mainSchema as unknown as Record<string, unknown>);

    for (const tableName of component.schemaManifest.tables) {
      seen.add(tableName);
      if (!(await tableExists(tableName))) continue;
      const tableSchema = moduleIndex.get(tableName) ?? mainIndex.get(tableName);
      if (!tableSchema) continue;
      const stmts = await generateDriftFixStatements(tableSchema, tableName);
      if (stmts.length === 0) continue;
      tablesFixed++;
      for (const sql of stmts) await runOne(tableName, sql);
    }
  }

  // ----- Core tables -----
  const mainIndex2 = buildSchemaTableIndex(mainSchema as unknown as Record<string, unknown>);
  for (const [tableName, tableSchema] of mainIndex2) {
    if (seen.has(tableName)) continue;
    if (!(await tableExists(tableName))) continue;
    const stmts = await generateDriftFixStatements(tableSchema, tableName);
    if (stmts.length === 0) continue;
    tablesFixed++;
    for (const sql of stmts) await runOne(tableName, sql);
  }

  if (hardErrors.length > 0) {
    throw new Error(
      `Baseline aborted — ${hardErrors.length} statement(s) failed with non-skippable errors:\n  - ${hardErrors.join("\n  - ")}`,
    );
  }

  return { tablesFixed, statementsRun, statementsSkipped };
}

async function stampMigrationVersions(): Promise<{ stamped: number; alreadyStamped: number }> {
  const all = await storage.variables.getAll();
  let stamped = 0;
  let alreadyStamped = 0;

  for (const variable of all) {
    if (!variable.name.startsWith(COMPONENT_STATE_PREFIX)) continue;
    if (!variable.value || typeof variable.value !== "object") continue;

    const state = variable.value as ComponentSchemaState;
    if (typeof state.migrationVersion === "number") {
      alreadyStamped++;
      continue;
    }

    const updated: ComponentSchemaState = {
      ...state,
      migrationVersion: 0,
      migrationsApplied: state.migrationsApplied ?? [],
    };
    await storage.variables.update(variable.id, {
      name: variable.name,
      value: updated,
    });
    stamped++;
  }

  return { stamped, alreadyStamped };
}

async function up(): Promise<void> {
  await loadComponentCache();
  const fixes = await applyDriftFixes();
  const stamps = await stampMigrationVersions();

  logger.info("Baseline sirius-dev-20260518 complete", {
    service: "baseline",
    tablesFixed: fixes.tablesFixed,
    statementsRun: fixes.statementsRun,
    stamped: stamps.stamped,
    alreadyStamped: stamps.alreadyStamped,
  });
}

const migration: Migration = {
  version: BASELINE_VERSION,
  name: "baseline_sirius_dev_20260518",
  description:
    "Applies idempotent DDL fix-ups for drift between the live database and the " +
    "latest Drizzle schema (missing FKs, uniques, checks, indexes, columns) on " +
    "every enabled component table and every core table. Then stamps " +
    "migrationVersion=0 onto every existing component_schema_state_* variable.",
  up,
};

registerMigration(migration);

export default migration;
