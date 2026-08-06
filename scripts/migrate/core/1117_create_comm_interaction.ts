import { db } from "../../../server/db";
import { sql } from "drizzle-orm";
import { registerMigration, type Migration } from "../../../server/services/migration-runner";
import { logger } from "../../../server/logger";

/**
 * N21 (Option A): structured member-interaction ("call log") records.
 *
 * Creates:
 *  - options_call_reason: curated call-reason list. `sirius_id` carries the
 *    normalized S1 `field_sirius_type` string so the S1 loader
 *    (scripts/s1-migration/load-call-logs.ts) can key seeded reasons by it.
 *  - comm_interaction: comm-medium child table (channel × reason × notes),
 *    following the comm_sms pattern.
 *
 * Seeds the curated reasons idempotently (ON CONFLICT (sirius_id) DO NOTHING).
 * Alias S1 type strings (kaiser issues, dyntl, ...) are mapped loader-side to
 * these primary sirius_ids — sirius_id is unique so aliases cannot live here.
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

  // Curated seed (N21 ruling). sequence has no ties (stable ordering).
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

  logger.info("Created options_call_reason + comm_interaction and seeded call reasons", {
    service: "migration-1117",
  });
}

const migration: Migration = {
  version: 1117,
  name: "create_comm_interaction",
  description:
    "N21 Option A: create options_call_reason (seeded curated reasons with S1 sirius_ids) and the comm_interaction medium child table (channel, reason, notes).",
  up,
};

registerMigration(migration);

export default migration;
