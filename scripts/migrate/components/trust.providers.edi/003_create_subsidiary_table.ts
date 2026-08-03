import { db } from "../../../../server/db";
import { sql } from "drizzle-orm";
import { registerComponentMigration, type Migration } from "../../../../server/services/migration-runner";
import { logger } from "../../../../server/logger";

const COMPONENT_ID = "trust.providers.edi";

/**
 * Create the `plugin_configs_trust_provider_edi` subsidiary table for
 * configs of the `trust-provider-edi` plugin kind. Matches the Drizzle
 * declaration in shared/schema/trust/provider-edi-schema.ts exactly
 * (explicit FK names — the auto-generated ones exceed 63 chars).
 * Idempotent via IF NOT EXISTS for deployments where a fresh component
 * enable already created it through the component schema push.
 */
async function up(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS plugin_configs_trust_provider_edi (
      id varchar PRIMARY KEY,
      provider_id varchar,
      sftp_client_id varchar,
      CONSTRAINT plugin_configs_trust_provider_edi_id_fk
        FOREIGN KEY (id) REFERENCES plugin_configs(id) ON DELETE CASCADE,
      CONSTRAINT plugin_configs_trust_provider_edi_provider_id_fk
        FOREIGN KEY (provider_id) REFERENCES trust_providers(id) ON DELETE CASCADE,
      CONSTRAINT plugin_configs_trust_provider_edi_sftp_client_id_fk
        FOREIGN KEY (sftp_client_id) REFERENCES sftp_client_destinations(id) ON DELETE RESTRICT
    )
  `);
  logger.info("Created plugin_configs_trust_provider_edi table", {
    service: "migration-trust-providers-edi-002",
  });
}

const migration: Migration = {
  version: 3,
  name: "create_subsidiary_table",
  description:
    "Create the plugin_configs_trust_provider_edi subsidiary table (provider + SFTP destination dimensions for trust-provider-edi plugin configs).",
  up,
};

registerComponentMigration(COMPONENT_ID, migration);

export default migration;
