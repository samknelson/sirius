import { sql } from "drizzle-orm";
import { db } from "../../../server/db";
import { logger } from "../../../server/logger";
import {
  registerMigration,
  type Migration,
} from "../../../server/services/migration-runner";

const SERVICE = "migration-1114";

async function up(): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`
      ALTER TABLE wc_stats
      ADD COLUMN IF NOT EXISTS configuration_id varchar
    `);
    await tx.execute(sql`
      ALTER TABLE wc_stats
      DROP CONSTRAINT IF EXISTS wc_stats_service_type_ymd_uniq
    `);
    await tx.execute(sql`
      ALTER TABLE wc_stats
      DROP CONSTRAINT IF EXISTS wc_stats_service_type_configuration_ymd_uniq
    `);
    await tx.execute(sql`
      ALTER TABLE wc_stats
      DROP CONSTRAINT IF EXISTS wc_stats_configuration_id_fkey
    `);
    await tx.execute(sql`
      ALTER TABLE wc_stats
      ADD CONSTRAINT wc_stats_configuration_id_fkey
      FOREIGN KEY (configuration_id)
      REFERENCES plugin_configs_wc_vendors(id)
      ON DELETE SET NULL
    `);
    await tx.execute(sql`
      ALTER TABLE wc_stats
      ADD CONSTRAINT wc_stats_service_type_configuration_ymd_uniq
      UNIQUE NULLS NOT DISTINCT (service, request_type, configuration_id, ymd)
    `);
  });
  logger.info("Added WC vendor configuration attribution to wc_stats", {
    service: SERVICE,
  });
}

const migration: Migration = {
  version: 1114,
  name: "wc_stats_configuration",
  description:
    "Attribute outgoing call counters to nullable WC vendor configurations, preserving one unattributed bucket with NULLS NOT DISTINCT and clearing attribution when a configuration is deleted.",
  up,
};

registerMigration(migration);
export default migration;