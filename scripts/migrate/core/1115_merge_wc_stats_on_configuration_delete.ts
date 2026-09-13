import { sql } from "drizzle-orm";
import { db } from "../../../server/db";
import { logger } from "../../../server/logger";
import {
  registerMigration,
  type Migration,
} from "../../../server/services/migration-runner";

const SERVICE = "migration-1115";

/**
 * ON DELETE SET NULL cannot by itself preserve the one-null-bucket invariant:
 * an attributed row may collide with an existing unattributed row. Merge every
 * affected count into that bucket before the referenced subsidiary row is
 * deleted, leaving the FK no rows to rewrite.
 */
async function up(): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`
      CREATE OR REPLACE FUNCTION merge_wc_stats_configuration_on_delete()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      BEGIN
        INSERT INTO wc_stats (service, request_type, configuration_id, ymd, calls)
        SELECT service, request_type, NULL, ymd, calls
        FROM wc_stats
        WHERE configuration_id = OLD.id
        ON CONFLICT (service, request_type, configuration_id, ymd)
        DO UPDATE SET calls = wc_stats.calls + EXCLUDED.calls;

        DELETE FROM wc_stats WHERE configuration_id = OLD.id;
        RETURN OLD;
      END;
      $$;
    `);
    await tx.execute(sql`
      DROP TRIGGER IF EXISTS merge_wc_stats_configuration_before_delete
      ON plugin_configs_wc_vendors
    `);
    await tx.execute(sql`
      CREATE TRIGGER merge_wc_stats_configuration_before_delete
      BEFORE DELETE ON plugin_configs_wc_vendors
      FOR EACH ROW
      EXECUTE FUNCTION merge_wc_stats_configuration_on_delete()
    `);
  });
  logger.info("Installed collision-safe WC stats configuration deletion", {
    service: SERVICE,
  });
}

const migration: Migration = {
  version: 1115,
  name: "merge_wc_stats_on_configuration_delete",
  description:
    "Merge attributed outgoing-call counts into the single historical/unattributed bucket before a WC vendor configuration is deleted, avoiding NULLS NOT DISTINCT collisions while conserving totals.",
  up,
};

registerMigration(migration);
export default migration;