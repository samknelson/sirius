import { db } from "../../../server/db";
import { sql } from "drizzle-orm";
import { registerMigration, type Migration } from "../../../server/services/migration-runner";
import { logger } from "../../../server/logger";

// TEMPORARY (publish-migration workaround, July 2026). See the matching
// comment on `chargePluginConfigs` in shared/schema.ts. This recreates the
// legacy charge_plugin_configs table (prod shape, empty) so that:
//  - in dev, the table exists and the publish diff leaves prod's copy (and
//    its 2 live rows) alone until boot-time migration 1016 backfills them;
//  - in prod, after 1016 backfills and 1017 drops the table, this migration
//    (running later in the same startup) recreates it empty so the drift
//    gate passes.
// It is dropped again in the second step of the two-step publish.
async function up(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS charge_plugin_configs (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      plugin_id text NOT NULL,
      enabled boolean NOT NULL DEFAULT false,
      scope varchar NOT NULL,
      employer_id varchar REFERENCES employers(id) ON DELETE CASCADE,
      settings jsonb DEFAULT '{}'::jsonb,
      created_at timestamp NOT NULL DEFAULT now(),
      updated_at timestamp NOT NULL DEFAULT now(),
      CONSTRAINT charge_plugin_configs_plugin_id_scope_employer_id_unique
        UNIQUE (plugin_id, scope, employer_id)
    )
  `);
  logger.info("Ensured legacy charge_plugin_configs table exists (publish workaround)", {
    service: "migration-1044",
  });
}

const migration: Migration = {
  version: 1044,
  name: "recreate_charge_plugin_configs_for_publish",
  description:
    "TEMPORARY: recreate legacy charge_plugin_configs (prod shape, no data) so the publish diff cannot drop prod's rows before migration 1016 backfills them.",
  up,
};

registerMigration(migration);
