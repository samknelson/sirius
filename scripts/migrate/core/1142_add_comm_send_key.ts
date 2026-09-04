import { db } from "../../../server/db";
import { sql } from "drizzle-orm";
import { registerMigration, type Migration } from "../../../server/services/migration-runner";
import { logger } from "../../../server/logger";

const SERVICE = "migration-1142";

/**
 * Send-once key on the communication record: `comm.send_key`.
 *
 * An optional, caller-supplied key that makes a send at-most-once. The
 * uniqueness tuple is (medium, contact, key) and it is a NAMED UNIQUE
 * CONSTRAINT, not a unique index — the Drizzle schema declares it with
 * `unique("comm_medium_contact_id_send_key_unique")`, and the startup drift
 * gate compares constraints and indexes separately, so an index here would
 * leave the constraint "missing" and refuse to boot.
 *
 * No partial index and no NOT NULL: Postgres treats nulls as distinct, so
 * un-keyed rows are completely unconstrained and a contact can keep receiving
 * any number of un-keyed messages. That also makes the constraint a usable
 * conflict target for the insert-or-skip claim in `createComm`.
 *
 * Idempotent: the column and the constraint are each added only if absent.
 */
async function up(): Promise<void> {
  const colCheck = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'comm' AND column_name = 'send_key'
    ) AS exists
  `);
  const hasColumn = colCheck.rows?.[0]?.exists === true || colCheck.rows?.[0]?.exists === "t";
  if (!hasColumn) {
    await db.execute(sql`ALTER TABLE comm ADD COLUMN send_key varchar`);
    logger.info("Added send_key column to comm", { service: SERVICE });
  }

  const constraintCheck = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'comm'::regclass
        AND conname = 'comm_medium_contact_id_send_key_unique'
    ) AS exists
  `);
  const hasConstraint =
    constraintCheck.rows?.[0]?.exists === true || constraintCheck.rows?.[0]?.exists === "t";
  if (!hasConstraint) {
    await db.execute(sql`
      ALTER TABLE comm
      ADD CONSTRAINT comm_medium_contact_id_send_key_unique
      UNIQUE (medium, contact_id, send_key)
    `);
    logger.info("Added unique constraint comm_medium_contact_id_send_key_unique", {
      service: SERVICE,
    });
  }
}

const migration: Migration = {
  version: 1142,
  name: "add_comm_send_key",
  description:
    "Add the optional send_key column to comm plus the named unique constraint comm_medium_contact_id_send_key_unique over (medium, contact_id, send_key). A caller that supplies a key gets at-most-once delivery: the insert of the communication row is the claim, so two racing sends cannot both win. Rows with no key are unconstrained (nulls are distinct), so un-keyed sending is unchanged.",
  up,
};

registerMigration(migration);

export default migration;
