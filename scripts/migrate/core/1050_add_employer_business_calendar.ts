import { db } from "../../../server/db";
import { sql } from "drizzle-orm";
import { getMigrations, registerMigration, type Migration } from "../../../server/services/migration-runner";
import { logger } from "../../../server/logger";

async function up(): Promise<void> {
  // Both branches stamped 1049 for different work. The calendar tables mark
  // the mainline lineage; replaying its migrations there could delete cron
  // configs created after 1048, or try to add NOT NULL EBS columns to tables
  // that have since acquired rows. Only the old local lineage needs replay.
  const lineage = await db.execute(sql`
    SELECT
      to_regclass('public.business_calendars') IS NOT NULL AS calendar,
      to_regclass('public.business_calendar_manual_byday') IS NOT NULL AS byday,
      to_regclass('public.business_calendar_manual_vacation') IS NOT NULL AS vacation,
      to_regclass('public.business_calendar_manual_open') IS NOT NULL AS manual_open,
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'ebs_denorm'
          AND column_name = 'subject_id'
      ) AS ebs_subject,
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'ebs_status'
          AND column_name = 'purge_after'
      ) AS ebs_purge
  `);
  const state = lineage.rows[0];
  if (state?.calendar) {
    if (!state.byday || !state.vacation || !state.manual_open ||
        !state.ebs_subject || !state.ebs_purge) {
      throw new Error("Migration 1050 found an incomplete mainline 1043–1049 schema; refusing to skip or replay its prerequisites");
    }
  } else {
    // The old local lineage lacks the calendar tables. Its EBS tables are
    // usually absent; refuse an ambiguous partial state with live rows before
    // replaying 1045's required-column additions.
    const ebsTables = await db.execute(sql`
      SELECT to_regclass('public.ebs_denorm') IS NOT NULL AS denorm,
             to_regclass('public.ebs_status') IS NOT NULL AS status
    `);
    if (!state?.ebs_subject && ebsTables.rows[0]?.denorm) {
      const rows = await db.execute(sql`SELECT EXISTS (SELECT 1 FROM ebs_denorm) AS present`);
      if (rows.rows[0]?.present) {
        throw new Error("Migration 1050 cannot add ebs_denorm.subject_id to a populated table");
      }
    }
    if (!state?.ebs_purge && ebsTables.rows[0]?.status) {
      const rows = await db.execute(sql`SELECT EXISTS (SELECT 1 FROM ebs_status) AS present`);
      if (rows.rows[0]?.present) {
        throw new Error("Migration 1050 cannot add ebs_status.purge_after to a populated table");
      }
    }
    await replayMissingMainlineMigrations();
  }

  const columnCheck = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'employers'
        AND column_name = 'business_calendar_id'
    ) AS exists
  `);
  const exists = columnCheck.rows[0]?.exists === true || columnCheck.rows[0]?.exists === 't';
  if (exists) {
    logger.info("employers.business_calendar_id already exists, skipping", { service: "migration-1050" });
    return;
  }

  await db.execute(sql`
    ALTER TABLE employers
      ADD COLUMN business_calendar_id varchar,
      ADD CONSTRAINT employers_business_calendar_id_fkey
        FOREIGN KEY (business_calendar_id) REFERENCES business_calendars(id) ON DELETE SET NULL
  `);

  logger.info("Added employers.business_calendar_id with FK to business_calendars", { service: "migration-1050" });
}

async function replayMissingMainlineMigrations(): Promise<void> {
  const replayNames = [
    "ledger_payments_date_received_nullable",
    "create_ebs",
    "ebs_subject_and_purge",
    "add_edls_sheet_job_group_fk",
    "create_snapshots",
    "delete_legacy_cleanup_cron_configs",
    "create_business_calendars",
  ];
  const migrations = getMigrations();
  for (const name of replayNames) {
    const migration = migrations.find((m) => m.name === name);
    if (!migration) throw new Error(`Missing prerequisite migration: ${name}`);
    await migration.up();
  }
}

const migration: Migration = {
  version: 1050,
  name: "add_employer_business_calendar",
  description: "Add nullable employers.business_calendar_id FK to business_calendars (ON DELETE SET NULL)",
  up,
};

registerMigration(migration);
