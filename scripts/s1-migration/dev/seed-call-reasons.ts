/**
 * DEV-ONLY rehearsal helper — re-apply migration 1117's options_call_reason
 * seed on an empty-DB-bootstrapped rehearsal target.
 *
 * ALLOW_EMPTY_DB_BOOTSTRAP=1 stamps migrations_version (1117) WITHOUT running
 * the migrations' data seeds, so the N21 call-logs loader aborts with
 * "options_call_reason is missing seeded sirius_id(s)". This INSERT is the
 * exact idempotent seed from scripts/migrate/core/1117_create_comm_interaction.ts.
 *
 * PRODUCTION: NOT used — the prod target ran migration 1117 normally.
 *
 * Usage: EXTERNAL_DATABASE_URL=<rehearsal-db> npx tsx scripts/s1-migration/dev/seed-call-reasons.ts
 */
import { db, pool } from "../../../server/storage/db";
import { sql } from "drizzle-orm";

async function main() {
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
  const r = (await db.execute(sql`SELECT count(*) n FROM options_call_reason`)) as { rows: Array<{ n: string }> };
  console.log("call reasons present:", r.rows[0].n);
  await pool.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
