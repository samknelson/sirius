import { db } from "../../../server/db";
import { sql } from "drizzle-orm";
import { registerMigration, type Migration } from "../../../server/services/migration-runner";
import { logger } from "../../../server/logger";

async function tableExists(name: string): Promise<boolean> {
  const result = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = ${name}
    ) AS exists
  `);
  return result.rows?.[0]?.exists === true || result.rows?.[0]?.exists === "t";
}

/**
 * Quicksearch subsidiary (roles). Every quicksearch config names the roles it
 * is offered to — that role list is the access decision, so the generic search
 * inner-joins this table and a config without a row is invisible.
 *
 * Created empty: quicksearch configs are made by an administrator, and the
 * adapter's `toRows` writes the subsidiary on every create/update, so there is
 * nothing to backfill.
 *
 * `roles` is a varchar[] (an array column cannot carry an FK) — the
 * role-deletion guard lives in `storage.users.deleteRole`, the same place the
 * dashboard subsidiary's guard lives.
 */
async function up(): Promise<void> {
  if (!(await tableExists("plugin_configs_quicksearch"))) {
    await db.execute(sql`
      CREATE TABLE plugin_configs_quicksearch (
        id varchar PRIMARY KEY REFERENCES plugin_configs(id) ON DELETE CASCADE,
        roles varchar[] NOT NULL
      )
    `);
    logger.info("Created plugin_configs_quicksearch table", { service: "migration-1135" });
  } else {
    logger.info("plugin_configs_quicksearch table already exists, skipping", {
      service: "migration-1135",
    });
  }
}

const migration: Migration = {
  version: 1135,
  name: "create_plugin_configs_quicksearch",
  description:
    "Create the quicksearch subsidiary table (plugin_configs_quicksearch) holding the roles each quicksearch config is offered to.",
  up,
};

registerMigration(migration);

export default migration;
