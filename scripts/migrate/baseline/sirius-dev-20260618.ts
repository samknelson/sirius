/**
 * Baseline script — Sirius dev Repl — 2026-06-18.
 *
 * Unblocks startup after a large origin/main merge by repairing two
 * deployment-specific gaps that the dated baselines (1002/1003) and the
 * per-component migration runner cannot resolve on their own:
 *
 *   1. The bulk-messaging status columns (`bulk_messages.status`,
 *      `bulk_participants.status`) are still `text` in this database, but the
 *      Drizzle schema now types them as the enums `bulk_message_status` /
 *      `bulk_participant_status`. Baseline 1002's drift fixer emits the
 *      `ALTER COLUMN ... TYPE <enum>` conversion but does NOT create the enum
 *      type first, so 1002 aborts with `type "bulk_message_status" does not
 *      exist`. This baseline creates the missing enum types (idempotently)
 *      BEFORE 1002 runs — hence the version < 1002 — so 1002's conversion
 *      succeeds. Both tables are empty, so the text -> enum cast is data-safe.
 *
 *   2. The `sitespecific.bao` component is enabled on this deployment but its
 *      schema was never initialised: there is no
 *      `component_schema_state_sitespecific.bao` variable and its table does
 *      not exist, so the startup per-component migration runner throws
 *      "enable the component first". This baseline runs the canonical enable
 *      flow (`enableComponentSchema`), which creates the table, writes the
 *      schema-state variable, and applies the component's own migrations.
 *
 * Idempotent on re-run (CREATE TYPE swallows `duplicate_object`;
 * `enableComponentSchema` skips already-created tables and preserves existing
 * migration bookkeeping). Registered as a CORE migration at version 1001 so it
 * runs ahead of the dated baselines whose bulk drift fix depends on the enum
 * types created here.
 */
import { storage } from "../../../server/storage";
import { registerMigration, type Migration } from "../../../server/services/migration-runner";
import { enableComponentSchema } from "../../../server/services/component-lifecycle";
import { loadComponentCache } from "../../../server/services/component-cache";
import { bulkMessageStatusEnum, bulkParticipantStatusEnum } from "../../../shared/schema/bulk/schema";
import { logger } from "../../../server/logger";

const BASELINE_VERSION = 1001;
const BAO_COMPONENT_ID = "sitespecific.bao";

interface PgEnumLike {
  enumName: string;
  enumValues: readonly string[];
}

async function ensureEnumType(pgEnum: PgEnumLike): Promise<void> {
  const values = pgEnum.enumValues.map((v) => `'${v.replace(/'/g, "''")}'`).join(", ");
  // CREATE TYPE has no IF NOT EXISTS; swallow duplicate_object so re-runs no-op.
  await storage.rawSql.execute(
    `DO $$ BEGIN
       CREATE TYPE "${pgEnum.enumName}" AS ENUM (${values});
     EXCEPTION WHEN duplicate_object THEN null;
     END $$;`,
  );
  logger.info("Baseline ensured enum type exists", { service: "baseline", enum: pgEnum.enumName });
}

/**
 * Convert a `text` column to the given enum type. A plain
 * `ALTER COLUMN ... TYPE <enum>` (what baseline 1002's drift fixer emits)
 * fails when the column has a literal `text` default, because Postgres cannot
 * auto-cast the default. So we drop the default, change the type, then re-add
 * the default already typed as the enum. Guarded so it only runs while the
 * column is still `text`, making re-runs a no-op once converted.
 */
async function convertTextColumnToEnum(
  table: string,
  column: string,
  enumName: string,
  defaultValue: string,
): Promise<void> {
  const def = defaultValue.replace(/'/g, "''");
  await storage.rawSql.execute(
    `DO $$ BEGIN
       IF EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_name = '${table}' AND column_name = '${column}' AND data_type = 'text'
       ) THEN
         ALTER TABLE "${table}" ALTER COLUMN "${column}" DROP DEFAULT;
         ALTER TABLE "${table}" ALTER COLUMN "${column}" TYPE "${enumName}" USING "${column}"::text::"${enumName}";
         ALTER TABLE "${table}" ALTER COLUMN "${column}" SET DEFAULT '${def}'::"${enumName}";
       END IF;
     END $$;`,
  );
  logger.info("Baseline converted column to enum", { service: "baseline", table, column, enumName });
}

async function up(): Promise<void> {
  await loadComponentCache();

  // ----- 1. Create the bulk-messaging enum types AND convert their columns -----
  // Both tables are empty, so the text -> enum cast is data-safe. We perform the
  // full conversion here (rather than leaving it to baseline 1002's drift fixer)
  // because the columns carry text defaults that the bare TYPE alter cannot cast.
  const conversions: { pgEnum: PgEnumLike; table: string; column: string; defaultValue: string }[] = [
    { pgEnum: bulkMessageStatusEnum as unknown as PgEnumLike, table: "bulk_messages", column: "status", defaultValue: "draft" },
    { pgEnum: bulkParticipantStatusEnum as unknown as PgEnumLike, table: "bulk_participants", column: "status", defaultValue: "pending" },
  ];
  for (const c of conversions) {
    await ensureEnumType(c.pgEnum);
    await convertTextColumnToEnum(c.table, c.column, c.pgEnum.enumName, c.defaultValue);
  }

  // ----- 2. Initialise the enabled sitespecific.bao component schema -----
  const result = await enableComponentSchema(BAO_COMPONENT_ID);
  if (!result.success) {
    throw new Error(
      `Baseline aborted — failed to initialise component ${BAO_COMPONENT_ID}: ${result.error}`,
    );
  }

  logger.info("Baseline sirius-dev-20260618 complete", {
    service: "baseline",
    baoSchema: result.schemaState ? "initialised" : "none",
  });
}

const migration: Migration = {
  version: BASELINE_VERSION,
  name: "baseline_sirius_dev_20260618",
  description:
    "Creates the missing bulk_message_status / bulk_participant_status enum types so the " +
    "dated baselines can convert the bulk status columns, and initialises the enabled " +
    "sitespecific.bao component schema (table + schema-state variable + component migrations).",
  up,
};

registerMigration(migration);

export default migration;
