import { db } from "../../../../server/db";
import { sql } from "drizzle-orm";
import { registerComponentMigration, type Migration } from "../../../../server/services/migration-runner";

const COMPONENT_ID = "sitespecific.bao";

// BAO migration 019 was renumbered to registered version 1145 when merged
// after another branch had already advanced this component's single version
// counter. The next runnable component version is therefore 1146, not 020.
// Using 020 here would be silently skipped on every database that applied 019.
async function up(): Promise<void> {
  await db.execute(sql`
    ALTER TABLE sitespecific_bao_case_comms
      ADD COLUMN IF NOT EXISTS notice_deadline_ymd date
  `);
}

const migration: Migration = {
  version: 1146,
  name: "case_comm_notice_deadline",
  description: "Add sitespecific_bao_case_comms.notice_deadline_ymd to preserve the deadline printed when a BAO case member notice is initiated.",
  up,
};

registerComponentMigration(COMPONENT_ID, migration);

export default migration;