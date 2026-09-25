import { db } from "../../../../server/db";
import { sql } from "drizzle-orm";
import { registerComponentMigration, type Migration } from "../../../../server/services/migration-runner";
import { logger } from "../../../../server/logger";

const COMPONENT_ID = "edls";

async function up(): Promise<void> {
  await db.execute(sql`
    DO $migration$
    DECLARE
      crew_column smallint;
      crew_id_column smallint;
      correct_constraint_exists boolean;
      constraint_name text;
    BEGIN
      ALTER TABLE public.edls_assignments
        ALTER COLUMN crew_id DROP NOT NULL;

      ALTER TABLE public.edls_assignments
        ADD COLUMN IF NOT EXISTS generation_id varchar;

      UPDATE public.edls_assignments
      SET generation_id = gen_random_uuid()::text
      WHERE crew_id IS NOT NULL AND generation_id IS NULL;

      SELECT attnum INTO crew_column
      FROM pg_attribute
      WHERE attrelid = 'public.edls_assignments'::regclass
        AND attname = 'crew_id'
        AND NOT attisdropped;

      SELECT attnum INTO crew_id_column
      FROM pg_attribute
      WHERE attrelid = 'public.edls_crews'::regclass
        AND attname = 'id'
        AND NOT attisdropped;

      SELECT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'public.edls_assignments'::regclass
          AND conname = 'edls_assignments_crew_id_edls_crews_id_fk'
          AND contype = 'f'
          AND conkey = ARRAY[crew_column]::smallint[]
          AND confrelid = 'public.edls_crews'::regclass
          AND confkey = ARRAY[crew_id_column]::smallint[]
          AND confdeltype = 'r'
          AND NOT EXISTS (
            SELECT 1
            FROM pg_constraint AS other_constraint
            WHERE other_constraint.conrelid = 'public.edls_assignments'::regclass
              AND other_constraint.contype = 'f'
              AND crew_column = ANY(other_constraint.conkey)
              AND other_constraint.conname <> 'edls_assignments_crew_id_edls_crews_id_fk'
          )
      ) INTO correct_constraint_exists;

      IF NOT correct_constraint_exists THEN
        FOR constraint_name IN
          SELECT conname
          FROM pg_constraint
          WHERE conrelid = 'public.edls_assignments'::regclass
            AND contype = 'f'
            AND crew_column = ANY(conkey)
        LOOP
          EXECUTE format(
            'ALTER TABLE public.edls_assignments DROP CONSTRAINT %I',
            constraint_name
          );
        END LOOP;

        ALTER TABLE public.edls_assignments
          ADD CONSTRAINT edls_assignments_crew_id_edls_crews_id_fk
          FOREIGN KEY (crew_id)
          REFERENCES public.edls_crews(id)
          ON DELETE RESTRICT;
      END IF;
    END
    $migration$
  `);

  logger.info("Retained EDLS assignments when deleting a crew", {
    service: "migration-edls-008",
  });
}

const migration: Migration = {
  version: 8,
  name: "retain_assignments_on_crew_delete",
  description:
    "Allow cleared assignment rows, identify each active filling, and prevent crew deletion from cascading away their metadata.",
  up,
};

registerComponentMigration(COMPONENT_ID, migration);

export default migration;