import { db } from "../../../server/db";
import { sql } from "drizzle-orm";
import { registerMigration, type Migration } from "../../../server/services/migration-runner";
import { logger } from "../../../server/logger";

async function tableExists(name: string): Promise<boolean> {
  const result = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = ${name}
    )
  `);
  return result.rows?.[0]?.exists === true || result.rows?.[0]?.exists === 't';
}

async function up(): Promise<void> {
  // Base table: fields common to every plugin kind's configuration row.
  if (!(await tableExists("plugin_configs"))) {
    await db.execute(sql`
      CREATE TABLE plugin_configs (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        plugin_type varchar NOT NULL,
        plugin_id text NOT NULL,
        enabled boolean NOT NULL DEFAULT false,
        name text,
        ordering integer NOT NULL DEFAULT 0,
        data jsonb DEFAULT '{}',
        created_at timestamp NOT NULL DEFAULT now(),
        updated_at timestamp NOT NULL DEFAULT now()
      )
    `);
    logger.info("Created plugin_configs table", { service: "migration-1015" });
  } else {
    logger.info("plugin_configs table already exists, skipping", { service: "migration-1015" });
  }

  // Charge subsidiary (scope / employer / account).
  if (!(await tableExists("plugin_configs_charge"))) {
    await db.execute(sql`
      CREATE TABLE plugin_configs_charge (
        id varchar PRIMARY KEY REFERENCES plugin_configs(id) ON DELETE CASCADE,
        scope varchar NOT NULL,
        employer_id varchar REFERENCES employers(id) ON DELETE CASCADE,
        account varchar REFERENCES ledger_accounts(id) ON DELETE SET NULL
      )
    `);
    logger.info("Created plugin_configs_charge table", { service: "migration-1015" });
  } else {
    logger.info("plugin_configs_charge table already exists, skipping", { service: "migration-1015" });
  }

  // NOTE: the `plugin_configs_benefit_eligibility` (trust.benefits) and
  // `plugin_configs_dispatch` (dispatch) subsidiaries used to be created here.
  // They are now component-owned — created by component schema-push on first
  // enable and populated by per-component migrations under
  // scripts/migrate/components/{trust.benefits,dispatch}/. Core no longer
  // touches them, so a fresh deployment with those components disabled never
  // creates them.
}

const migration: Migration = {
  version: 1015,
  name: "create_plugin_configs",
  description:
    "Create the unified plugin config base table (plugin_configs) and its core charge subsidiary (plugin_configs_charge) — additive foundation, no data migrated. The benefit-eligibility and dispatch subsidiaries are component-owned and created on enable.",
  up,
};

registerMigration(migration);

export default migration;
