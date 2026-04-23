import { db } from "../../server/db";
import { sql } from "drizzle-orm";
import { registerMigration, type Migration } from "../../server/services/migration-runner";
import { logger } from "../../server/logger";

async function up(): Promise<void> {
  const columns = [
    { name: "source", ddl: sql`ALTER TABLE contact_postal ADD COLUMN source text NOT NULL DEFAULT 'admin'` },
    { name: "deliverability_status", ddl: sql`ALTER TABLE contact_postal ADD COLUMN deliverability_status text NOT NULL DEFAULT 'unknown'` },
    { name: "last_verified_at", ddl: sql`ALTER TABLE contact_postal ADD COLUMN last_verified_at timestamp` },
    { name: "updated_at", ddl: sql`ALTER TABLE contact_postal ADD COLUMN updated_at timestamp NOT NULL DEFAULT now()` },
    { name: "needs_review", ddl: sql`ALTER TABLE contact_postal ADD COLUMN needs_review boolean NOT NULL DEFAULT false` },
  ];

  for (const c of columns) {
    const exists = await db.execute(sql`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'contact_postal' AND column_name = ${c.name}
      ) AS exists
    `);
    const has = exists.rows[0]?.exists === true || exists.rows[0]?.exists === 't';
    if (!has) {
      await db.execute(c.ddl);
      logger.info(`Added column ${c.name} to contact_postal`, { service: "migration-006" });
    }
  }

  const constraints = [
    {
      name: "chk_source",
      ddl: sql`ALTER TABLE contact_postal ADD CONSTRAINT chk_source CHECK (source IN ('worker_self', 'employer_feed', 'admin', 'import', 'system'))`,
    },
    {
      name: "chk_deliverability_status",
      ddl: sql`ALTER TABLE contact_postal ADD CONSTRAINT chk_deliverability_status CHECK (deliverability_status IN ('unknown', 'verified', 'undeliverable', 'vacant', 'returned_mail'))`,
    },
  ];

  for (const c of constraints) {
    const exists = await db.execute(sql`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_name = 'contact_postal' AND constraint_name = ${c.name}
      ) AS exists
    `);
    const has = exists.rows[0]?.exists === true || exists.rows[0]?.exists === 't';
    if (!has) {
      await db.execute(c.ddl);
      logger.info(`Added constraint ${c.name} to contact_postal`, { service: "migration-006" });
    }
  }

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_contact_postal_contact_primary
      ON contact_postal(contact_id, is_primary)
      WHERE is_active = true
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_contact_postal_needs_review
      ON contact_postal(needs_review)
      WHERE needs_review = true
  `);
}

const migration: Migration = {
  version: 6,
  name: "address_management",
  description: "Append-only address management: add source, deliverability_status, last_verified_at, updated_at, needs_review columns to contact_postal with constraints and partial indexes.",
  up,
};

registerMigration(migration);
