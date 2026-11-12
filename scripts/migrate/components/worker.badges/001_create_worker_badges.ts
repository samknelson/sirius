import { db } from "../../../../server/db";
import { sql } from "drizzle-orm";
import { registerComponentMigration, type Migration } from "../../../../server/services/migration-runner";

const migration: Migration = {
  version: 1,
  name: "create_worker_badges",
  description: "Create editable badge types and plugin-owned worker badge payloads with cascading foreign keys and independent worker/type and denorm uniqueness.",
  async up(): Promise<void> {
    // The runner does not wrap up(); keep both creations atomic. Existing
    // tables are verified by the normal drift gate, never dropped to repair.
    await db.transaction(async tx => {
      await tx.execute(sql`
        CREATE TABLE IF NOT EXISTS options_worker_badge_types (
          id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
          icon varchar,
          name varchar(255) NOT NULL,
          sirius_id varchar,
          description text,
          data jsonb,
          CONSTRAINT options_worker_badge_types_sirius_id_unique UNIQUE (sirius_id)
        )
      `);
      // Match enable-path FK names: its inline FKs are unnamed, and the longer
      // badge-type FK is explicitly pinned to this same short Postgres name.
      await tx.execute(sql`
        CREATE TABLE IF NOT EXISTS worker_badges_denorm (
          id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
          worker_id varchar NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
          badge_type_id varchar NOT NULL REFERENCES options_worker_badge_types(id) ON DELETE CASCADE,
          denorm_id varchar NOT NULL REFERENCES denorm(id) ON DELETE CASCADE,
          active boolean,
          granted_timestamp timestamp,
          revoked_timestamp timestamp,
          data jsonb,
          CONSTRAINT worker_badges_denorm_worker_badge_type_unique UNIQUE (worker_id, badge_type_id),
          CONSTRAINT worker_badges_denorm_denorm_id_unique UNIQUE (denorm_id)
        )
      `);
    });
  },
};

registerComponentMigration("worker.badges", migration);
export default migration;
