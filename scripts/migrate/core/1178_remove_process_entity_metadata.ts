import { sql } from "drizzle-orm";
import { db } from "../../../server/db";
import { registerMigration, type Migration } from "../../../server/services/migration-runner";
import { EXCLUDED_METADATA_TABLES } from "../../../server/storage/system/entity-metadata-policy";
import { logger } from "../../../server/logger";

const SERVICE = "migration-1103";

/**
 * Repair only databases that already ran the old provenance-retirement
 * migrations. Untouched databases already have their original local columns,
 * so this block does not add defaults or rewrite their historical values.
 *
 * The old path used `captured_*` for snapshots and `created_at` for payments.
 * Where those columns exist, rename them back to the original local names
 * before deleting the metadata rows that may be the only surviving source for
 * a previously migrated record.
 */
async function up(): Promise<void> {
  await db.execute(sql`
    DO $$
    DECLARE
      has_table boolean;
      has_old boolean;
      has_new boolean;
    BEGIN
      -- snapshots: rename old local compatibility columns, never add a
      -- now()-defaulted replacement over an intact historical column.
      SELECT to_regclass('public.snapshots') IS NOT NULL INTO has_table;
      IF has_table THEN
        SELECT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'snapshots' AND column_name = 'captured_at'
        ) INTO has_old;
        SELECT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'snapshots' AND column_name = 'created_at'
        ) INTO has_new;
        IF has_old AND NOT has_new THEN
          ALTER TABLE snapshots RENAME COLUMN captured_at TO created_at;
        END IF;

        SELECT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'snapshots' AND column_name = 'captured_by'
        ) INTO has_old;
        SELECT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'snapshots' AND column_name = 'author_id'
        ) INTO has_new;
        IF has_old AND NOT has_new THEN
          ALTER TABLE snapshots RENAME COLUMN captured_by TO author_id;
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'snapshots' AND column_name = 'author_name'
        ) THEN
          ALTER TABLE snapshots ADD COLUMN author_name text;
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'snapshots' AND column_name = 'created_at'
        ) THEN
          ALTER TABLE snapshots ADD COLUMN created_at timestamp;
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'snapshots' AND column_name = 'author_id'
        ) THEN
          ALTER TABLE snapshots ADD COLUMN author_id varchar REFERENCES users(id) ON DELETE SET NULL;
        END IF;

        UPDATE snapshots s
        SET created_at = COALESCE(s.created_at, m.created_date),
            author_id = COALESCE(s.author_id, m.created_by)
        FROM entity_metadata m
        WHERE m.table_name = 'snapshots'
          AND m.entity_id = s.id
          AND m.created_date IS NOT NULL
          AND (s.created_at IS NULL OR s.author_id IS NULL);

        UPDATE snapshots s
        SET author_name = NULLIF(
          concat_ws(
            ' ',
            NULLIF(trim(u.first_name), ''),
            NULLIF(trim(u.last_name), '')
          ),
          ''
        )
        FROM users u
        WHERE s.author_id = u.id
          AND s.author_name IS NULL;

        DROP INDEX IF EXISTS snapshots_entity_type_entity_id_idx;
        CREATE INDEX IF NOT EXISTS snapshots_entity_type_entity_id_created_at_idx
          ON snapshots (entity_type, entity_id, created_at);
      END IF;

      -- The old ledger migration moved payments to created_at. Restore the
      -- original date_created name before metadata is removed.
      SELECT to_regclass('public.ledger_payments') IS NOT NULL INTO has_table;
      IF has_table THEN
        SELECT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'ledger_payments' AND column_name = 'created_at'
        ) INTO has_old;
        SELECT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'ledger_payments' AND column_name = 'date_created'
        ) INTO has_new;
        IF has_old AND NOT has_new THEN
          UPDATE ledger_payments p
          SET created_at = m.created_date
          FROM entity_metadata m
          WHERE m.table_name = 'ledger_payments'
            AND m.entity_id = p.id
            AND m.created_date IS NOT NULL
            AND p.created_at IS NULL;
          ALTER TABLE ledger_payments RENAME COLUMN created_at TO date_created;
        ELSIF NOT has_new THEN
          ALTER TABLE ledger_payments ADD COLUMN date_created timestamp;
          UPDATE ledger_payments p
          SET date_created = m.created_date
          FROM entity_metadata m
          WHERE m.table_name = 'ledger_payments'
            AND m.entity_id = p.id
            AND m.created_date IS NOT NULL
            AND p.date_created IS NULL;
        END IF;
      END IF;

      -- Payment methods and gateway customers have always owned their local
      -- creation timestamp. Restore only when an earlier database already
      -- removed it, and leave unrecoverable rows nullable rather than inventing
      -- a historical date.
      IF to_regclass('public.ledger_paymentmethods') IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = 'ledger_paymentmethods' AND column_name = 'created_at'
         ) THEN
        ALTER TABLE ledger_paymentmethods ADD COLUMN created_at timestamp;
        UPDATE ledger_paymentmethods p
        SET created_at = m.created_date
        FROM entity_metadata m
        WHERE m.table_name = 'ledger_paymentmethods'
          AND m.entity_id = p.id
          AND m.created_date IS NOT NULL;
      END IF;

      IF to_regclass('public.ledger_gateway_customers') IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = 'ledger_gateway_customers' AND column_name = 'created_at'
         ) THEN
        ALTER TABLE ledger_gateway_customers ADD COLUMN created_at timestamp;
        UPDATE ledger_gateway_customers p
        SET created_at = m.created_date
        FROM entity_metadata m
        WHERE m.table_name = 'ledger_gateway_customers'
          AND m.entity_id = p.id
          AND m.created_date IS NOT NULL;
      END IF;

      -- These process tables had their timestamps retired without a later
      -- owning-column migration in the old sequence.
      IF to_regclass('public.auth_identities') IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = 'auth_identities' AND column_name = 'created_at'
         ) THEN
        ALTER TABLE auth_identities ADD COLUMN created_at timestamp;
        UPDATE auth_identities a
        SET created_at = m.created_date
        FROM entity_metadata m
        WHERE m.table_name = 'auth_identities'
          AND m.entity_id = a.id
          AND m.created_date IS NOT NULL;
      END IF;
      IF to_regclass('public.auth_identities') IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = 'auth_identities' AND column_name = 'updated_at'
         ) THEN
        ALTER TABLE auth_identities ADD COLUMN updated_at timestamp;
        UPDATE auth_identities a
        SET updated_at = COALESCE(m.modified_date, m.created_date)
        FROM entity_metadata m
        WHERE m.table_name = 'auth_identities'
          AND m.entity_id = a.id
          AND COALESCE(m.modified_date, m.created_date) IS NOT NULL;
      END IF;

      IF to_regclass('public.worker_msh') IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = 'worker_msh' AND column_name = 'created_at'
         ) THEN
        ALTER TABLE worker_msh ADD COLUMN created_at timestamp;
        UPDATE worker_msh w
        SET created_at = m.created_date
        FROM entity_metadata m
        WHERE m.table_name = 'worker_msh'
          AND m.entity_id = w.id
          AND m.created_date IS NOT NULL;
      END IF;
    END $$;
  `);

  const result = await db.execute(sql`
    DELETE FROM entity_metadata
    WHERE table_name IN ('ledger', 'ledger_ea', 'ledger_gateway_customers')
       OR table_name LIKE '%denorm%'
       OR table_name IN (${sql.join(
         EXCLUDED_METADATA_TABLES.map((tableName) => sql`${tableName}`),
         sql`, `,
       )})
  `);
  logger.info("Removed process-table entity metadata after local-column repair", {
    service: SERVICE,
    removed: result.rowCount ?? result.rows?.length ?? 0,
  });
}

const migration: Migration = {
  version: 1178,
  name: "remove_process_entity_metadata",
  description:
    "Safely restore local process-table provenance for databases that ran the old retirement path, then remove excluded entity metadata.",
  up,
};

registerMigration(migration);

export default migration;