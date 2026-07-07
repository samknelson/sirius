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
 * Self-heal a deployment where the `bulk` component is marked enabled (and its
 * component_schema_state_bulk variable claims its tables are active) but the
 * tables were never actually created — the pre-migration-framework build never
 * created them and never checked. The startup drift gate now refuses to boot
 * such a database.
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
    logger.info("bulk component not enabled, nothing to do", { service: "migration-1045" });
    return;
  }

  const missing: string[] = [];
  for (const t of BULK_TABLES) {
    if (!(await tableExists(t))) missing.push(t);
  }
  if (missing.length === 0) {
    logger.info("all bulk component tables present, nothing to do", { service: "migration-1045" });
    return;
  }

  logger.info("Recreating missing bulk component tables via component schema push", {
    service: "migration-1045",
    missing,
  });
  await pushComponentSchema("bulk");
  logger.info("Bulk component tables created", { service: "migration-1045" });
}

const migration: Migration = {
  version: 1045,
  name: "create_missing_bulk_component_tables",
  description:
    "Self-heal: create the bulk component's tables (empty) when the component is enabled but the tables are absent, so the startup drift gate can pass; no-op otherwise",
  up,
};

registerMigration(migration);

export default migration;
