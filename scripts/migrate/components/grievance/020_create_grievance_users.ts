import { db } from "../../../../server/db";
import { sql } from "drizzle-orm";
import { registerComponentMigration, type Migration } from "../../../../server/services/migration-runner";
import { logger } from "../../../../server/logger";

const COMPONENT_ID = "grievance";

async function tableExists(table: string): Promise<boolean> {
  const result = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = ${table}
    ) AS exists
  `);
  return result.rows?.[0]?.exists === true || result.rows?.[0]?.exists === "t";
}

/**
 * Create the grievance_users join table owned by the grievance component. Each
 * row assigns a user to a grievance in a specific role; the same user may
 * appear multiple times under different roles, enforced by the unique index on
 * (grievance_id, user_id, role_id).
 *
 * The grievance FK CASCADEs on delete (an assignment is meaningless without its
 * grievance). The user FK CASCADEs on delete (assignments follow the user). The
 * role FK is ON DELETE RESTRICT so an options_grievance_roles row that is still
 * in use cannot be removed out from under live assignments.
 *
 * Idempotent: skips creation if the table already exists (the enable flow may
 * create it via component schema push first).
 */
async function up(): Promise<void> {
  if (await tableExists("grievance_users")) {
    logger.info("grievance_users table already exists, skipping creation", {
      service: "migration-grievance-020",
    });
    return;
  }

  await db.execute(sql`
    CREATE TABLE grievance_users (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      grievance_id varchar NOT NULL REFERENCES grievances(id) ON DELETE CASCADE,
      user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role_id varchar NOT NULL REFERENCES options_grievance_roles(id) ON DELETE RESTRICT,
      data jsonb
    )
  `);

  await db.execute(sql`
    CREATE UNIQUE INDEX grievance_users_grievance_user_role_unique
    ON grievance_users (grievance_id, user_id, role_id)
  `);

  logger.info("Created grievance_users table", {
    service: "migration-grievance-020",
  });
}

const migration: Migration = {
  version: 20,
  name: "create_grievance_users",
  description:
    "Create the grievance_users join table owned by the grievance component. Assigns users to a grievance per role; unique on (grievance_id, user_id, role_id) so a user may hold several roles. grievance FK and user FK CASCADE on delete; role FK is ON DELETE RESTRICT. Idempotent: skips creation if the table already exists.",
  up,
};

registerComponentMigration(COMPONENT_ID, migration);

export default migration;
