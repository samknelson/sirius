import { db } from "../../../../server/db";
import { sql } from "drizzle-orm";
import { registerComponentMigration, type Migration } from "../../../../server/services/migration-runner";
import { logger } from "../../../../server/logger";

const COMPONENT_ID = "trust.providers.edi";
const SERVICE = "migration-trust.providers.edi-001";

async function tableExists(name: string): Promise<boolean> {
  const result = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = ${name}
    )
  `);
  return result.rows?.[0]?.exists === true || result.rows?.[0]?.exists === "t";
}

async function up(): Promise<void> {
  if (!(await tableExists("trust_provider_edi")) || !(await tableExists("sftp_client_destinations"))) {
    logger.info("trust_provider_edi or sftp_client_destinations missing; skipping", { service: SERVICE });
    return;
  }

  const colCheck = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'trust_provider_edi' AND column_name = 'sftp_client_id'
    ) AS exists
  `);
  const hasColumn = colCheck.rows[0]?.exists === true || colCheck.rows[0]?.exists === "t";
  if (!hasColumn) {
    logger.info("trust_provider_edi.sftp_client_id column missing; nothing to constrain, skipping", { service: SERVICE });
    return;
  }

  const fkCheck = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1
      FROM pg_constraint c
      JOIN pg_attribute a
        ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
      WHERE c.conrelid = 'trust_provider_edi'::regclass
        AND c.contype = 'f'
        AND c.confrelid = 'sftp_client_destinations'::regclass
        AND a.attname = 'sftp_client_id'
    ) AS exists
  `);
  const hasFk = fkCheck.rows[0]?.exists === true || fkCheck.rows[0]?.exists === "t";
  if (hasFk) {
    logger.info("trust_provider_edi.sftp_client_id FK already exists, skipping", { service: SERVICE });
    return;
  }

  // Null out any orphaned references so adding the constraint cannot fail.
  await db.execute(sql`
    UPDATE trust_provider_edi t
    SET sftp_client_id = NULL
    WHERE t.sftp_client_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM sftp_client_destinations d WHERE d.id = t.sftp_client_id)
  `);

  await db.execute(sql`
    ALTER TABLE trust_provider_edi
    ADD CONSTRAINT trust_provider_edi_sftp_client_id_fkey
    FOREIGN KEY (sftp_client_id) REFERENCES sftp_client_destinations(id) ON DELETE RESTRICT
  `);

  logger.info("Added sftp_client_id -> sftp_client_destinations FK to trust_provider_edi", { service: SERVICE });
}

const migration: Migration = {
  version: 1,
  name: "add_sftp_client_fk",
  description: "Add sftp_client_id -> sftp_client_destinations FK to trust_provider_edi",
  up,
};

registerComponentMigration(COMPONENT_ID, migration);
