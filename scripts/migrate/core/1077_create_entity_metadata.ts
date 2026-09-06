import { db } from "../../../server/db";
import { sql } from "drizzle-orm";
import { registerMigration, type Migration } from "../../../server/services/migration-runner";
import { logger } from "../../../server/logger";

const SERVICE = "migration-1077";

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
 * One provenance row per record, for every table whose storage module emits
 * audit logs. Written in-application by the storage logging middleware — no
 * trigger, best effort by contract.
 *
 * `entity_id` is unique on its own (all ids are UUIDs) and `seq` is a second,
 * permanent sequential name for the record. `table_name` names the table the
 * record lives in and is never rewritten, so a seq keeps meaning one row in
 * one table for as long as the record exists.
 *
 * The `*_by` columns reference users and null out when a user is deleted:
 * losing the account must not lose the timestamp.
 *
 * There is no soft reference back from the owning table and no FK to it —
 * `entity_id` is polymorphic, the same convention `entity_notes` and
 * `entity_files` use. Rows are removed by the middleware when it observes a
 * logged delete.
 *
 * Idempotent.
 */
async function up(): Promise<void> {
  if (await tableExists("entity_metadata")) {
    logger.info("entity_metadata already present, nothing to create", { service: SERVICE });
    return;
  }

  await db.execute(sql`
    CREATE TABLE entity_metadata (
      "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      "seq" bigserial NOT NULL,
      "rev" integer NOT NULL DEFAULT 1,
      "table_name" varchar(255) NOT NULL,
      "entity_id" varchar NOT NULL,
      "created_date" timestamp,
      "created_by" varchar,
      "modified_date" timestamp,
      "modified_by" varchar,
      "subrecord_modified_date" timestamp,
      "subrecord_modified_by" varchar,
      CONSTRAINT entity_metadata_created_by_users_id_fk
        FOREIGN KEY ("created_by") REFERENCES users (id) ON DELETE SET NULL,
      CONSTRAINT entity_metadata_modified_by_users_id_fk
        FOREIGN KEY ("modified_by") REFERENCES users (id) ON DELETE SET NULL,
      CONSTRAINT entity_metadata_sub_modified_by_users_id_fk
        FOREIGN KEY ("subrecord_modified_by") REFERENCES users (id) ON DELETE SET NULL,
      CONSTRAINT entity_metadata_seq_unique UNIQUE ("seq"),
      CONSTRAINT entity_metadata_entity_id_unique UNIQUE ("entity_id")
    )
  `);
  await db.execute(
    sql`CREATE INDEX idx_entity_metadata_table_name ON entity_metadata (table_name)`,
  );
  logger.info("Created entity_metadata table", { service: SERVICE });
}

const migration: Migration = {
  version: 1077,
  name: "create_entity_metadata",
  description:
    "Create the entity_metadata table: one best-effort provenance row per record (table_name plus a unique entity_id, a permanent auto-increment seq, an application-maintained revision, and the created / modified / subrecord_modified date+user trios, each user column a SET NULL FK to users), maintained in-application by the storage logging middleware rather than by a database trigger.",
  up,
};

registerMigration(migration);

export default migration;
