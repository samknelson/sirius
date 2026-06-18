/**
 * Baseline script — Sirius dev Repl — 2026-06-18 (part B, post-cascade).
 *
 * The companion baseline `sirius-dev-20260618` (version 1001) runs BEFORE the
 * forward migrations 1004–1031. This one runs AFTER them (version 1100) to mop
 * up the two residual drift items those migrations leave on this deployment:
 *
 *   1. `wizard_employment_status_mappings` is missing. Its creator is core
 *      migration `002_wizard_employment_status_mappings` (version 2), but this
 *      repl's `migrations_version` was already past 2 (it reached 6 via a
 *      different, locally-diverged set of core migrations), so that migration
 *      was treated as already-applied and skipped even though its table never
 *      existed here. We re-create it idempotently.
 *
 *   2. `ledger_accounts.gateway_config_id` is missing its FK to
 *      `plugin_configs_payment_gateway(id)`. The dated drift-fix baseline
 *      (1003) tried to add it but safely skipped it because
 *      `plugin_configs_payment_gateway` did not exist yet — that table is
 *      created later by migration 1026. Re-running the idempotent drift fixer
 *      now (every target table exists) adds the FK and any other constraint
 *      that only became resolvable after the forward migrations.
 *
 * Mirrors the structure of `sirius-dev-20260524`: it re-applies
 * `generateDriftFixStatements` for every enabled component table and every
 * core table. The emitted DDL is idempotent (FK/UNIQUE adds wrapped in
 * DO/EXCEPTION blocks), so re-running against an already-fixed database is a
 * no-op. Registered as a CORE migration at version 1100 (reserved baseline
 * range, >= 1000) so it runs once, after the forward migrations.
 */
import { storage } from "../../../server/storage";
import { registerMigration, type Migration } from "../../../server/services/migration-runner";
import { getAllComponents } from "../../../shared/components";
import { isComponentEnabledSync, loadComponentCache } from "../../../server/services/component-cache";
import { generateDriftFixStatements } from "../../../server/services/component-schema-push";
import { tableExists } from "../../../server/storage/utils";
import * as mainSchema from "../../../shared/schema";
import { logger } from "../../../server/logger";

const BASELINE_VERSION = 1100;
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

/**
 * Re-create the wizard_employment_status_mappings table. Copied verbatim from
 * core migration 002 (which was skipped on this repl due to the version-counter
 * collision described in the file header). CREATE TABLE IF NOT EXISTS makes
 * re-runs a no-op.
 */
async function createWizardEmploymentStatusMappings(): Promise<void> {
  await storage.rawSql.execute(`
    CREATE TABLE IF NOT EXISTS wizard_employment_status_mappings (
      id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
      employer_id VARCHAR(36) NOT NULL,
      source_status TEXT NOT NULL,
      target_status_id VARCHAR(36) NOT NULL,
      created_at TIMESTAMP DEFAULT NOW() NOT NULL,
      updated_at TIMESTAMP DEFAULT NOW() NOT NULL,
      CONSTRAINT wizard_emp_status_map_unique UNIQUE (employer_id, source_status)
    )
  `);
  logger.info("Baseline ensured wizard_employment_status_mappings exists", { service: "baseline" });
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
      logger.warn("Baseline statement skipped (missing target table)", {
        service: "baseline",
        table: tableName,
        error: r.error,
        sql,
      });
    } else {
      hardErrors.push(`[${tableName}] ${r.error} :: ${sql}`);
      logger.error("Baseline statement failed", {
        service: "baseline",
        table: tableName,
        error: r.error,
        sql,
      });
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
      if (!tableSchema) {
        throw new Error(
          `Baseline aborted — table "${tableName}" exists in the database (listed in component "${component.id}" schema manifest) but no Drizzle schema definition could be resolved.`,
        );
      }
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

async function up(): Promise<void> {
  await loadComponentCache();
  await createWizardEmploymentStatusMappings();
  const fixes = await applyDriftFixes();

  logger.info("Baseline sirius-dev-20260618b complete", {
    service: "baseline",
    tablesFixed: fixes.tablesFixed,
    statementsRun: fixes.statementsRun,
    statementsSkipped: fixes.statementsSkipped,
  });
}

const migration: Migration = {
  version: BASELINE_VERSION,
  name: "baseline_sirius_dev_20260618b",
  description:
    "Post-cascade reconciliation: re-creates the skipped wizard_employment_status_mappings " +
    "table and re-applies idempotent drift fix-ups (FKs/uniques/indexes) now that the forward " +
    "migrations 1004–1031 have created every target table.",
  up,
};

registerMigration(migration);

export default migration;
