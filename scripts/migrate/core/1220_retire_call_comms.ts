import { sql } from "drizzle-orm";
import { db } from "../../../server/storage/db";
import { registerMigration, type Migration } from "../../../server/services/migration-runner";

async function up(): Promise<void> {
  // One statement is one transaction even on a replay. Locks cover the counts
  // through both drops; never delete parents, convert records, or use CASCADE.
  try {
    await db.execute(sql`
    DO $$
    DECLARE
      interaction_children bigint := 0;
      interaction_parents bigint := 0;
    BEGIN
      SET LOCAL lock_timeout = '10s';
      IF to_regclass('public.comm') IS NOT NULL THEN
        LOCK TABLE public.comm IN ACCESS EXCLUSIVE MODE;
        SELECT count(*) INTO interaction_parents FROM public.comm WHERE medium = 'interaction';
      END IF;
      IF to_regclass('public.comm_interaction') IS NOT NULL THEN
        LOCK TABLE public.comm_interaction IN ACCESS EXCLUSIVE MODE;
        SELECT count(*) INTO interaction_children FROM public.comm_interaction;
      END IF;
      IF interaction_children <> 0 OR interaction_parents <> 0 THEN
        RAISE EXCEPTION 'Refusing to retire call comms: interaction_children=%, interaction_parents=%. No tables or records were removed.',
          interaction_children, interaction_parents;
      END IF;
      DROP TABLE IF EXISTS public.comm_interaction;
      DROP TABLE IF EXISTS public.options_call_reason;
    END $$;
    `);
  } catch (error) {
    // Drizzle's outer message contains SQL, not PostgreSQL's refusal counts.
    // Surface only our own aggregate-only exception to the migration runner.
    const cause = error instanceof Error ? error.cause : undefined;
    if (cause instanceof Error && cause.message.startsWith("Refusing to retire call comms:")) {
      throw new Error(cause.message, { cause: error });
    }
    throw error;
  }
}

const migration: Migration = {
  version: 1220,
  name: "retire_call_comms",
  description: "Refuse unexpected interaction records, then drop the retired call child and reason tables.",
  up,
};
registerMigration(migration);
export default migration;
