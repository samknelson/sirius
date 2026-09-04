import { db } from "../../../../server/db";
import { sql } from "drizzle-orm";
import { registerComponentMigration, type Migration } from "../../../../server/services/migration-runner";

const migration: Migration = {
  version: 1145,
  name: "case_status_lapse",
  description: "Add the optional status reached when a BAO case deadline lapses.",
  async up() {
    await db.execute(sql`
      ALTER TABLE options_bao_case_status
      ADD COLUMN IF NOT EXISTS lapse_status_id varchar
    `);
    await db.execute(sql`
      DO $$ BEGIN
        ALTER TABLE options_bao_case_status
        ADD CONSTRAINT options_bao_case_status_lapse_status_id_fkey
        FOREIGN KEY (lapse_status_id) REFERENCES options_bao_case_status(id) ON DELETE RESTRICT;
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$
    `);
  },
};
registerComponentMigration("sitespecific.bao", migration);
export default migration;