/**
 * Baseline script — Sirius dev Repl — 2026-07-04.
 *
 * Re-runs the structural drift fix-ups for every enabled component table and
 * every core table. After a large `git pull` merged the per-component plugin
 * config framework (migrations 1015–1041) onto a dev database that predated
 * it, the numbered migrations created/renamed the required tables but a
 * pre-existing `ledger_accounts.gateway_config_id` column caused migration
 * 1026 to skip installing its foreign key to `plugin_configs_payment_gateway`,
 * so the startup drift gate refuses to boot.
 *
 * This baseline re-applies `generateDriftFixStatements` for every relevant
 * table. The DDL it emits is idempotent (FK/UNIQUE adds are wrapped in
 * DO/EXCEPTION blocks that swallow `duplicate_object`/`duplicate_table`),
 * so re-running against an already-fixed database is a no-op.
 *
 * No `migrationVersion` stamping is needed — `sirius-dev-20260518` already
 * handles that and runs first.
 *
 * Registered as a CORE migration at version 1042 (reserved baseline range,
 * >= 1000, and above the latest numbered migration so it runs after them).
 * It runs once like any other core migration and is gated by
 * `migrations_version` afterwards.
 */
import { storage } from "../../../server/storage";
import { registerMigration, type Migration } from "../../../server/services/migration-runner";
import { getAllComponents } from "../../../shared/components";
import { isComponentEnabledSync, loadComponentCache } from "../../../server/services/component-cache";
import { generateDriftFixStatements } from "../../../server/services/component-schema-push";
import { tableExists } from "../../../server/storage/utils";
import * as mainSchema from "../../../shared/schema";
import { logger } from "../../../server/logger";

const BASELINE_VERSION = 1042;
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
          `Baseline aborted — table "${tableName}" exists in the database (listed in component "${component.id}" schema manifest) but no Drizzle schema definition could be resolved from the component's schema module or shared/schema. Cannot safely advance migrations_version while skipping unfixable tables.`,
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
  const fixes = await applyDriftFixes();

  logger.info("Baseline sirius-dev-20260704 complete", {
    service: "baseline",
    tablesFixed: fixes.tablesFixed,
    statementsRun: fixes.statementsRun,
    statementsSkipped: fixes.statementsSkipped,
  });
}

const migration: Migration = {
  version: BASELINE_VERSION,
  name: "baseline_sirius_dev_20260704",
  description:
    "Re-applies idempotent DDL fix-ups for drift between the live database and " +
    "the latest Drizzle schema (missing FKs, uniques, checks, indexes) on every " +
    "enabled component table and every core table. Required because a large merge " +
    "left ledger_accounts.gateway_config_id without its plugin_configs_payment_gateway FK.",
  up,
};

registerMigration(migration);

export default migration;
