import { db } from "../../../server/db";
import { sql } from "drizzle-orm";
import { registerMigration, type Migration } from "../../../server/services/migration-runner";
import { logger } from "../../../server/logger";
import { pushComponentSchema } from "../../../server/services/component-schema-push";

const BULK_TABLES = [
  "bulk_messages",
  "bulk_messages_email",
  "bulk_messages_sms",
  "bulk_messages_postal",
  "bulk_messages_inapp",
  "bulk_participants",
];

async function tableExists(name: string): Promise<boolean> {
  const result = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = ${name}
    )
  `);
  return result.rows?.[0]?.exists === true || result.rows?.[0]?.exists === "t";
}

/**
 * Re-run of 1045: the Publish flow diffs the DEV database schema against prod
 * and applies the difference, and dev did not have the bulk tables — so the
 * publish after 1045 ran DROPPED the freshly created bulk tables from prod
 * again, and 1045 (already recorded as applied) could not re-run. Prod then
 * crash-looped on the startup drift gate.
 *
 * The durable fix is keeping the bulk tables present in dev (see
 * scripts/oneoffs/create-bulk-tables-dev.ts) so the publish diff stops
 * dropping them; this migration is the belt-and-braces self-heal for the
 * currently-broken prod database.
 *
 * Reuses the canonical pushComponentSchema path, which creates ONLY missing
 * tables from the component's Drizzle manifest and throws on drift against any
 * table that already exists.
 *
 * Idempotent: no-ops when the component is not enabled or when every manifest
 * table already exists.
 */
async function up(): Promise<void> {
  const comp = await db.execute(sql`
    SELECT (value ->> 'bulk') AS bulk FROM variables WHERE name = 'components'
  `);
  const bulkEnabled = (comp.rows?.[0] as any)?.bulk === "true";
  if (!bulkEnabled) {
    logger.info("bulk component not enabled, nothing to do", { service: "migration-1046" });
    return;
  }

  const missing: string[] = [];
  for (const t of BULK_TABLES) {
    if (!(await tableExists(t))) missing.push(t);
  }
  if (missing.length === 0) {
    logger.info("all bulk component tables present, nothing to do", { service: "migration-1046" });
    return;
  }

  logger.info("Recreating missing bulk component tables via component schema push", {
    service: "migration-1046",
    missing,
  });
  await pushComponentSchema("bulk");
  logger.info("Bulk component tables created", { service: "migration-1046" });
}

const migration: Migration = {
  version: 1046,
  name: "recreate_bulk_tables_after_publish_drop",
  description:
    "Self-heal rerun of 1045: recreate the bulk component's tables after the publish schema diff dropped them (dev lacked them); no-op when not enabled or tables present",
  up,
};

registerMigration(migration);

export default migration;
