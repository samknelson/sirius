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

  // Trust benefit eligibility subsidiary (policy / benefit / applies_to).
  if (!(await tableExists("plugin_configs_benefit_eligibility"))) {
    await db.execute(sql`
      CREATE TABLE plugin_configs_benefit_eligibility (
        id varchar PRIMARY KEY REFERENCES plugin_configs(id) ON DELETE CASCADE,
        policy varchar REFERENCES policies(id) ON DELETE CASCADE,
        benefit varchar REFERENCES trust_benefits(id) ON DELETE CASCADE,
        applies_to varchar
      )
    `);
    logger.info("Created plugin_configs_benefit_eligibility table", { service: "migration-1015" });
  } else {
    logger.info("plugin_configs_benefit_eligibility table already exists, skipping", { service: "migration-1015" });
  }

  // Dispatch eligibility subsidiary (job_type).
  if (!(await tableExists("plugin_configs_dispatch"))) {
    await db.execute(sql`
      CREATE TABLE plugin_configs_dispatch (
        id varchar PRIMARY KEY REFERENCES plugin_configs(id) ON DELETE CASCADE,
        job_type varchar REFERENCES options_dispatch_job_type(id) ON DELETE CASCADE
      )
    `);
    logger.info("Created plugin_configs_dispatch table", { service: "migration-1015" });
  } else {
    logger.info("plugin_configs_dispatch table already exists, skipping", { service: "migration-1015" });
  }
}

const migration: Migration = {
  version: 1015,
  name: "create_plugin_configs",
  description:
    "Create the unified plugin config base table (plugin_configs) and its per-kind subsidiary tables (charge, benefit eligibility, dispatch) — additive foundation, no data migrated",
  up,
};

registerMigration(migration);

export default migration;
