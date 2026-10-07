import { db } from "../../../../server/db";
import { sql } from "drizzle-orm";
import { registerComponentMigration, type Migration } from "../../../../server/services/migration-runner";

const migration: Migration = {
  version: 3,
  name: "require_user_id",
  description: "Delete anonymous session history and require a cascading user association.",
  async up(): Promise<void> {
    // Component migrations run only for enabled components after table bring-up.
    // The runner does not wrap up(); cleanup and enforcement must be atomic.
    await db.transaction(async tx => {
      await tx.execute(sql`SET LOCAL lock_timeout = '5s'`);
      // Prevent an older concurrent writer inserting NULL between cleanup and
      // constraint enforcement. The DDL needs this same lock regardless.
      await tx.execute(sql`LOCK TABLE session_history IN ACCESS EXCLUSIVE MODE`);
      await tx.execute(sql`DELETE FROM session_history WHERE user_id IS NULL`);
      await tx.execute(sql`ALTER TABLE session_history ALTER COLUMN user_id SET NOT NULL`);
    });
  },
};

registerComponentMigration("system.session_history", migration);

export default migration;
