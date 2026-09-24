import { db } from "../../../../server/db";
import { sql } from "drizzle-orm";
import { registerComponentMigration, type Migration } from "../../../../server/services/migration-runner";
import { logger } from "../../../../server/logger";

const COMPONENT_ID = "trust.providers.edi";

/**
 * The bespoke `trust_provider_edi` table is replaced by plugin configs of
 * the `trust-provider-edi` kind (subsidiary table
 * `plugin_configs_trust_provider_edi`, created by the component schema
 * push). The legacy table held only test data — drop it outright.
 */
async function up(): Promise<void> {
  await db.execute(sql`DROP TABLE IF EXISTS trust_provider_edi`);
  logger.info("Dropped legacy trust_provider_edi table (replaced by plugin configs)", {
    service: "migration-trust-providers-edi-001",
  });
}

const migration: Migration = {
  version: 1,
  name: "drop_legacy_table",
  description:
    "Drop the legacy trust_provider_edi table; EDI targets now live in plugin_configs (kind trust-provider-edi). Idempotent via IF EXISTS.",
  up,
};

registerComponentMigration(COMPONENT_ID, migration);

export default migration;
