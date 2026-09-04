import { db } from "../../../server/db";
import { sql } from "drizzle-orm";
import { registerMigration, type Migration } from "../../../server/services/migration-runner";
import { logger } from "../../../server/logger";

const SERVICE = "migration-1140";

async function tableExists(name: string): Promise<boolean> {
  const res = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = ${name}
    ) AS exists
  `);
  return res.rows[0]?.exists === true || res.rows[0]?.exists === "t";
}

async function columnType(table: string, column: string): Promise<string | undefined> {
  const res = await db.execute(sql`
    SELECT data_type
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ${table} AND column_name = ${column}
  `);
  return res.rows[0]?.data_type as string | undefined;
}

async function constraintExists(table: string, name: string): Promise<boolean> {
  const res = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname = 'public' AND t.relname = ${table} AND c.conname = ${name}
    ) AS exists
  `);
  return res.rows[0]?.exists === true || res.rows[0]?.exists === "t";
}

/**
 * Store the outbound-call counter's day as a real date: `wc_stats.day`
 * (varchar(10)) becomes `wc_stats.ymd` (date), and the uniqueness constraint
 * that names the column is renamed with it.
 *
 * Every other date-only column in this app is a `date` named with the `ymd`
 * convention; this one was the odd one out, so a day that is not a day was
 * refused only by a zod refine and never by the database. Drizzle reads a
 * `date` column back as a `YYYY-MM-DD` string, so the day stays an `Ymd` at
 * every layer and nothing above the database changes shape.
 *
 * The constraint is also the conflict target of the insert-or-increment, and
 * the startup drift gate compares constraint names and column types against
 * the Drizzle schema, so both halves have to happen here or the next boot
 * refuses to start.
 *
 * Idempotent across the three starting states — table absent, still
 * `day varchar`, already `ymd date` — because a fresh database runs the
 * create (1139) and this conversion back to back.
 */
async function up(): Promise<void> {
  if (!(await tableExists("wc_stats"))) {
    logger.info("wc_stats table does not exist, skipping", { service: SERVICE });
    return;
  }

  const oldType = await columnType("wc_stats", "day");
  const newType = await columnType("wc_stats", "ymd");

  if (oldType && newType) {
    throw new Error(
      "wc_stats has both a `day` and an `ymd` column; resolve manually before re-running migration 1140.",
    );
  }

  if (oldType) {
    // Refuse loudly rather than let the cast decide: a value that is not a
    // day is a counted call whose day we would be destroying.
    const badRows = await db.execute(sql`
      SELECT count(*)::int AS n
      FROM wc_stats
      WHERE day !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    `);
    const bad = (badRows.rows[0]?.n as number | undefined) ?? 0;
    if (bad > 0) {
      throw new Error(
        `Cannot convert wc_stats.day to date: ${bad} row(s) hold a value that is not a YYYY-MM-DD day; resolve manually before re-running migration 1140.`,
      );
    }

    // The rename carries the dependent constraint across automatically (under
    // its old name, which is why it is renamed below).
    await db.execute(sql`ALTER TABLE wc_stats RENAME COLUMN day TO ymd`);
    await db.execute(sql`
      ALTER TABLE wc_stats ALTER COLUMN ymd TYPE date USING ymd::date
    `);
    logger.info("Renamed wc_stats.day to ymd and converted it to date", { service: SERVICE });
  } else if (newType === "date") {
    logger.info("wc_stats.ymd already a date column, skipping", { service: SERVICE });
  } else if (newType) {
    // Renamed by an earlier partial run but never cast.
    if (newType === "character varying" || newType === "text") {
      await db.execute(sql`
        ALTER TABLE wc_stats ALTER COLUMN ymd TYPE date USING ymd::date
      `);
      logger.info("Converted wc_stats.ymd from varchar to date", { service: SERVICE });
    } else {
      throw new Error(`Unexpected data_type for wc_stats.ymd: ${newType}`);
    }
  } else {
    throw new Error("wc_stats has neither a `day` nor an `ymd` column; cannot convert.");
  }

  if (await constraintExists("wc_stats", "wc_stats_service_type_day_uniq")) {
    if (await constraintExists("wc_stats", "wc_stats_service_type_ymd_uniq")) {
      throw new Error(
        "wc_stats carries both the old and the new uniqueness constraint; resolve manually before re-running migration 1140.",
      );
    }
    await db.execute(sql`
      ALTER TABLE wc_stats
      RENAME CONSTRAINT wc_stats_service_type_day_uniq TO wc_stats_service_type_ymd_uniq
    `);
    logger.info("Renamed the wc_stats uniqueness constraint to match the ymd column", {
      service: SERVICE,
    });
  } else if (!(await constraintExists("wc_stats", "wc_stats_service_type_ymd_uniq"))) {
    throw new Error(
      "wc_stats has no (service, request_type, day/ymd) uniqueness constraint to rename; the insert-or-increment has no conflict target.",
    );
  }
}

const migration: Migration = {
  version: 1140,
  name: "wc_stats_ymd",
  description:
    "Store the web client call counter's day as a real date: rename wc_stats.day to ymd, convert it from varchar(10) to date, and rename the (service, request_type, day) UNIQUE constraint to wc_stats_service_type_ymd_uniq so the drift gate and the insert-or-increment's conflict target both still match the schema. Idempotent for absent/varchar/date starting states; refuses rather than dropping a value that will not cast.",
  up,
};

registerMigration(migration);

export default migration;
