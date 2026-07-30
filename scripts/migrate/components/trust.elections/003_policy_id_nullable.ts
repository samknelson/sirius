import { db } from "../../../../server/db";
import { sql } from "drizzle-orm";
import { registerComponentMigration, type Migration } from "../../../../server/services/migration-runner";
import { logger } from "../../../../server/logger";

const COMPONENT_ID = "trust.elections";

/**
 * Make `worker_trust_elections.policy_id` nullable.
 *
 * The effective policy for an election is now DERIVED from the election's
 * employer's policy history as of the relevant date (see
 * server/services/policy-resolution.ts), so new elections no longer store a
 * policy. The column is kept (nullable) as a legacy/audit field so existing
 * values remain reviewable and rollback stays trivial; it is not dropped.
 *
 * Idempotent: DROP NOT NULL is a no-op when the column is already nullable.
 */
async function up(): Promise<void> {
  await db.execute(
    sql`ALTER TABLE worker_trust_elections ALTER COLUMN policy_id DROP NOT NULL`,
  );
  logger.info("Made worker_trust_elections.policy_id nullable (legacy/audit field)", {
    service: "migration-trust.elections-003",
  });
}

const migration: Migration = {
  version: 3,
  name: "policy_id_nullable",
  description:
    "Make worker_trust_elections.policy_id nullable — the effective policy is derived from employer policy history; the column is retained as a legacy/audit field. Idempotent.",
  up,
};

registerComponentMigration(COMPONENT_ID, migration);

export default migration;
