import { sql } from "drizzle-orm";
import { db } from "../../../server/db";
import { registerMigration, type Migration } from "../../../server/services/migration-runner";
import {
  EXCLUDED_METADATA_TABLES,
} from "../../../server/storage/system/entity-metadata-policy";
import { logger } from "../../../server/logger";

const SERVICE = "migration-1103";

async function up(): Promise<void> {
  await db.execute(sql`
    ALTER TABLE IF EXISTS snapshots
      ADD COLUMN IF NOT EXISTS captured_at timestamp NOT NULL DEFAULT now(),
      ADD COLUMN IF NOT EXISTS captured_by varchar REFERENCES users(id) ON DELETE SET NULL
  `);
  await db.execute(sql`
    ALTER TABLE IF EXISTS ledger_payments
      ADD COLUMN IF NOT EXISTS created_at timestamp NOT NULL DEFAULT now()
  `);
  await db.execute(sql`
    ALTER TABLE IF EXISTS ledger_paymentmethods
      ADD COLUMN IF NOT EXISTS created_at timestamp NOT NULL DEFAULT now()
  `);
  await db.execute(sql`
    UPDATE snapshots s
    SET captured_at = m.created_date, captured_by = m.created_by
    FROM entity_metadata m
    WHERE m.table_name = 'snapshots' AND m.entity_id = s.id AND m.created_date IS NOT NULL
  `);
  await db.execute(sql`
    UPDATE ledger_payments p
    SET created_at = m.created_date
    FROM entity_metadata m
    WHERE m.table_name = 'ledger_payments' AND m.entity_id = p.id AND m.created_date IS NOT NULL
  `);
  await db.execute(sql`
    UPDATE ledger_paymentmethods p
    SET created_at = m.created_date
    FROM entity_metadata m
    WHERE m.table_name = 'ledger_paymentmethods' AND m.entity_id = p.id AND m.created_date IS NOT NULL
  `);
  const result = await db.execute(sql`
    DELETE FROM entity_metadata
    WHERE table_name LIKE '%ledger%'
       OR table_name LIKE '%denorm%'
       OR table_name IN (${sql.join(
         EXCLUDED_METADATA_TABLES.map((tableName) => sql`${tableName}`),
         sql`, `,
       )})
  `);
  logger.info("Removed process-table entity metadata", {
    service: SERVICE,
    removed: result.rowCount ?? result.rows?.length ?? 0,
  });
}

const migration: Migration = {
  version: 1103,
  name: "remove_process_entity_metadata",
  description:
    "Remove entity metadata for ledger, denorm, logging, scheduler, delivery, authentication, snapshot, and generated history tables now excluded from record history.",
  up,
};

registerMigration(migration);

export default migration;