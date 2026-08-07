import { db } from "../../../server/db";
import { sql } from "drizzle-orm";
import { registerMigration, type Migration } from "../../../server/services/migration-runner";
import { logger } from "../../../server/logger";

/**
 * Re-apply of 1117_create_comm_interaction.
 *
 * 1117 merged from a diverged branch AFTER 1118/1119 had already been applied
 * on production, so the shared `migrations_version` counter (already at 1119)
 * silently skipped it there — prod then failed the startup drift gate with
 * `comm_interaction` and `options_call_reason` missing. This migration runs
 * the same idempotent DDL + seed under a version above the counter so prod
 * self-heals on the next deploy, while being a no-op on databases (like dev)
 * that already ran 1117.
 */
async function up(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS options_call_reason (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      name varchar(255) NOT NULL,
      description text,
      sirius_id varchar(255),
      sequence integer NOT NULL DEFAULT 0,
      data jsonb,
      CONSTRAINT options_call_reason_sirius_id_unique UNIQUE (sirius_id)
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS comm_interaction (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      comm_id varchar NOT NULL,
      channel varchar NOT NULL,
      call_reason_id varchar NOT NULL,
      notes text,
      data jsonb,
      CONSTRAINT comm_interaction_comm_id_comm_id_fk
        FOREIGN KEY (comm_id) REFERENCES comm(id) ON DELETE CASCADE,
      CONSTRAINT comm_interaction_call_reason_id_options_call_reason_id_fk
        FOREIGN KEY (call_reason_id) REFERENCES options_call_reason(id)
    )
  `);

  // Curated seed (N21 ruling) — conflict-safe, same as 1117.
  await db.execute(sql`
    INSERT INTO options_call_reason (name, description, sirius_id, sequence)
    VALUES
      ('Enrollment', 'Enrollment questions and processing', 'enrollment', 10),
      ('Enrollment follow-up', 'Follow-up on a prior enrollment interaction', 'enrollment followup', 20),
      ('Carrier/plan issue', 'Issues with a carrier or plan (medical, dental, vision, life)', 'mlk issues', 30),
      ('ID card not received', 'Member did not receive an ID card', 'id card not received', 40),
      ('Appeal', 'Appeal of a denial or other determination', 'appeal denial', 50),
      ('Other', 'Anything not covered by the other reasons', 'other', 60)
    ON CONFLICT (sirius_id) DO NOTHING
  `);

  logger.info("Re-applied 1117: options_call_reason + comm_interaction present and seeded", {
    service: "migration-1120",
  });
}

const migration: Migration = {
  version: 1120,
  name: "reapply_comm_interaction",
  description:
    "Re-apply skipped 1117 (version-counter collision on prod): idempotently create options_call_reason + comm_interaction and seed call reasons.",
  up,
};

registerMigration(migration);

export default migration;
