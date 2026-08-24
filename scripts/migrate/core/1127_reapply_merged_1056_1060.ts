import {
  registerMigration,
  type Migration,
} from "../../../server/services/migration-runner";
import { db } from "../../../server/storage/db";
import { logger } from "../../../server/logger";
import { sql } from "drizzle-orm";

async function tableExists(table: string): Promise<boolean> {
  const result = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = ${table}
    ) AS exists
  `);
  return result.rows?.[0]?.exists === true || result.rows?.[0]?.exists === "t";
}

async function columnExists(table: string, column: string): Promise<boolean> {
  const result = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = ${table}
        AND column_name = ${column}
    ) AS exists
  `);
  return result.rows?.[0]?.exists === true || result.rows?.[0]?.exists === "t";
}

async function constraintExists(
  table: string,
  constraint: string,
): Promise<boolean> {
  const result = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = ${table}::regclass AND conname = ${constraint}
    ) AS exists
  `);
  return result.rows?.[0]?.exists === true || result.rows?.[0]?.exists === "t";
}

async function typeExists(name: string): Promise<boolean> {
  const result = await db.execute(sql`
    SELECT EXISTS (SELECT 1 FROM pg_type WHERE typname = ${name}) AS exists
  `);
  return result.rows?.[0]?.exists === true || result.rows?.[0]?.exists === "t";
}

/**
 * Reapply migrations merged below the shared migration counter.
 *
 * The target database had already advanced to 1126 when migrations 1056–1060
 * arrived from another branch, so the version-based runner correctly treated
 * those lower numbers as historical even though their effects were absent.
 * Every reused migration is idempotent.
 */
async function up(): Promise<void> {
  if (!(await tableExists("options_worker_ban_type"))) {
    await db.execute(sql`
      CREATE TABLE options_worker_ban_type (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        name text NOT NULL,
        description text,
        sirius_id text UNIQUE,
        data jsonb
      )
    `);
  }

  if (!(await tableExists("options_note_type"))) {
    await db.execute(sql`
      CREATE TABLE options_note_type (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        name text NOT NULL,
        description text,
        sirius_id text UNIQUE,
        data jsonb
      )
    `);
  }

  if (!(await tableExists("notes"))) {
    await db.execute(sql`
      CREATE TABLE notes (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        entity_type varchar NOT NULL,
        entity_id varchar NOT NULL,
        type_id varchar NOT NULL
          REFERENCES options_note_type(id) ON DELETE RESTRICT,
        subject text NOT NULL,
        body text,
        data jsonb,
        timestamp timestamp NOT NULL DEFAULT now(),
        user_id varchar REFERENCES users(id) ON DELETE SET NULL
      )
    `);
    await db.execute(
      sql`CREATE INDEX idx_notes_entity ON notes (entity_type, entity_id)`,
    );
    await db.execute(sql`CREATE INDEX idx_notes_type_id ON notes (type_id)`);
  }

  if (!(await columnExists("ledger_accounts", "sirius_id"))) {
    await db.execute(
      sql`ALTER TABLE ledger_accounts ADD COLUMN sirius_id varchar`,
    );
  }
  if (
    !(await constraintExists(
      "ledger_accounts",
      "ledger_accounts_sirius_id_unique",
    ))
  ) {
    await db.execute(sql`
      ALTER TABLE ledger_accounts
      ADD CONSTRAINT ledger_accounts_sirius_id_unique UNIQUE (sirius_id)
    `);
  }

  if (await columnExists("ws_clients", "bundle_id")) {
    await db.execute(sql`DROP INDEX IF EXISTS ws_clients_bundle_id_idx`);
    await db.execute(sql`ALTER TABLE ws_clients DROP COLUMN bundle_id`);
  }
  if (await tableExists("ws_bundles")) {
    await db.execute(sql`DROP TABLE ws_bundles`);
  }
  if (await typeExists("ws_bundle_status")) {
    await db.execute(sql`DROP TYPE ws_bundle_status`);
  }
  if (!(await tableExists("ws_client_grants"))) {
    await db.execute(sql`
      CREATE TABLE ws_client_grants (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        client_id varchar NOT NULL REFERENCES ws_clients(id) ON DELETE CASCADE,
        config_id varchar NOT NULL
          REFERENCES plugin_configs(id) ON DELETE CASCADE,
        created_at timestamp NOT NULL DEFAULT now(),
        CONSTRAINT ws_client_grants_client_config_unique
          UNIQUE (client_id, config_id)
      )
    `);
    await db.execute(sql`
      CREATE INDEX ws_client_grants_client_id_idx
      ON ws_client_grants (client_id)
    `);
    await db.execute(sql`
      CREATE INDEX ws_client_grants_config_id_idx
      ON ws_client_grants (config_id)
    `);
  }

  logger.info("Reapplied merged migrations 1056 through 1060", {
    service: "migration-1127",
  });
}

const migration: Migration = {
  version: 1127,
  name: "reapply_merged_1056_1060",
  description:
    "Reapply idempotent worker-ban options, notes, ledger Sirius ID, and web-service grants migrations skipped after a branch version-counter collision.",
  up,
};

registerMigration(migration);

export default migration;