import { db } from "../../../server/db";
import { sql } from "drizzle-orm";
import { registerMigration, type Migration } from "../../../server/services/migration-runner";
import { logger } from "../../../server/logger";

async function tableExists(name: string): Promise<boolean> {
  const result = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = ${name}
    ) AS exists
  `);
  return result.rows?.[0]?.exists === true || result.rows?.[0]?.exists === "t";
}

/**
 * Deferred Event Bus (EBS) tables: `ebs_denorm` + `ebs_status`
 * (+ `ebs_delivery_status` enum).
 *
 * `ebs_denorm` is the payload table for EBS-scheduling denorm plugins: one row
 * per scheduled future event, tied to its `denorm(id)` status row via a
 * `denorm_id` FK ON DELETE CASCADE. Unique on `denorm_id` (one scheduled event
 * per denorm entity) and on `unique_id` (the scheduled-event key that joins to
 * `ebs_status`); a `send_on` index drives the due-events scan.
 *
 * `ebs_status` is the decoupled terminal delivery record (no FK) keyed by a
 * unique `unique_id` so it survives widow deletion of its `ebs_denorm` row and
 * prevents re-firing. `created_at` (default now) drives the retention purge.
 *
 * Idempotent: the enum is created only if missing (CREATE TYPE has no
 * IF NOT EXISTS), and each table + its indexes only if the table is absent.
 */
async function up(): Promise<void> {
  await db.execute(sql`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ebs_delivery_status') THEN
        CREATE TYPE ebs_delivery_status AS ENUM ('sent', 'expired');
      END IF;
    END
    $$;
  `);

  if (!(await tableExists("ebs_denorm"))) {
    await db.execute(sql`
      CREATE TABLE ebs_denorm (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        denorm_id varchar NOT NULL REFERENCES denorm(id) ON DELETE CASCADE,
        unique_id varchar NOT NULL,
        plugin_id varchar NOT NULL,
        event_type varchar NOT NULL,
        payload jsonb NOT NULL,
        send_on timestamp NOT NULL,
        dont_send_after timestamp NOT NULL
      )
    `);
    await db.execute(
      sql`CREATE UNIQUE INDEX ebs_denorm_denorm_uniq ON ebs_denorm (denorm_id)`,
    );
    await db.execute(
      sql`CREATE UNIQUE INDEX ebs_denorm_unique_id_uniq ON ebs_denorm (unique_id)`,
    );
    await db.execute(sql`CREATE INDEX ebs_denorm_send_on_idx ON ebs_denorm (send_on)`);
    logger.info("Created ebs_denorm table", { service: "migration-1044" });
  } else {
    logger.info("ebs_denorm table already exists, skipping", {
      service: "migration-1044",
    });
  }

  if (!(await tableExists("ebs_status"))) {
    await db.execute(sql`
      CREATE TABLE ebs_status (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        unique_id varchar NOT NULL,
        status ebs_delivery_status NOT NULL,
        created_at timestamp NOT NULL DEFAULT now(),
        CONSTRAINT ebs_status_unique_id_uniq UNIQUE (unique_id)
      )
    `);
    await db.execute(sql`CREATE INDEX ebs_status_created_idx ON ebs_status (created_at)`);
    logger.info("Created ebs_status table", { service: "migration-1044" });
  } else {
    logger.info("ebs_status table already exists, skipping", {
      service: "migration-1044",
    });
  }
}

const migration: Migration = {
  version: 1044,
  name: "create_ebs",
  description:
    "Create the deferred event bus (EBS) tables: ebs_denorm (payload table for EBS-scheduling denorm plugins, denorm_id FK ON DELETE CASCADE, unique on denorm_id and unique_id, send_on index) and ebs_status (decoupled terminal delivery record keyed by unique unique_id, created_at-driven purge) plus the ebs_delivery_status enum ('sent','expired').",
  up,
};

registerMigration(migration);

export default migration;
