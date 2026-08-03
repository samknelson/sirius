import { db } from "../../../server/db";
import { sql } from "drizzle-orm";
import { registerMigration, type Migration } from "../../../server/services/migration-runner";
import { logger } from "../../../server/logger";

const SERVICE = "migration-1055";

async function columnExists(column: string): Promise<boolean> {
  const result = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'files' AND column_name = ${column}
    ) AS exists
  `);
  const v = result.rows[0]?.exists;
  return v === true || v === "t";
}

async function up(): Promise<void> {
  // 1. file_system_id — add, backfill every existing row to "legacy"
  //    (operators point "legacy" at the pre-existing Replit bucket via the
  //    FILESYSTEMS environment variable), then enforce NOT NULL.
  if (!(await columnExists("file_system_id"))) {
    await db.execute(sql`ALTER TABLE files ADD COLUMN file_system_id varchar`);
    logger.info("Added files.file_system_id", { service: SERVICE });
  }
  await db.execute(sql`UPDATE files SET file_system_id = 'legacy' WHERE file_system_id IS NULL`);
  await db.execute(sql`ALTER TABLE files ALTER COLUMN file_system_id SET NOT NULL`);

  // 2. status — live | missing | pending_delete.
  if (!(await columnExists("status"))) {
    await db.execute(sql`ALTER TABLE files ADD COLUMN status varchar NOT NULL DEFAULT 'live'`);
    logger.info("Added files.status", { service: SERVICE });
  }

  // 3. Unique (file_system_id, storage_path) — duplicate-check first so the
  //    failure mode is an actionable error, not a bare constraint violation.
  const dupes = await db.execute(sql`
    SELECT file_system_id, storage_path, count(*) AS n
    FROM files
    GROUP BY file_system_id, storage_path
    HAVING count(*) > 1
    LIMIT 20
  `);
  if (dupes.rows.length > 0) {
    const sample = dupes.rows
      .map((r: any) => `${r.file_system_id}:${r.storage_path} (x${r.n})`)
      .join(", ");
    throw new Error(
      `Cannot add unique (file_system_id, storage_path) to files — duplicate storage paths exist: ${sample}. ` +
        `Resolve the duplicate rows (delete or repoint them) and re-run migrations.`,
    );
  }
  const constraintCheck = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = 'files_file_system_id_storage_path_unique'
    ) AS exists
  `);
  const hasConstraint =
    constraintCheck.rows[0]?.exists === true || constraintCheck.rows[0]?.exists === "t";
  if (!hasConstraint) {
    await db.execute(sql`
      ALTER TABLE files
      ADD CONSTRAINT files_file_system_id_storage_path_unique
      UNIQUE (file_system_id, storage_path)
    `);
    logger.info("Added unique (file_system_id, storage_path) to files", { service: SERVICE });
  }

  // 4. Drop the replaced access_level column.
  if (await columnExists("access_level")) {
    await db.execute(sql`ALTER TABLE files DROP COLUMN access_level`);
    logger.info("Dropped files.access_level", { service: SERVICE });
  }
}

const migration: Migration = {
  version: 1115,
  name: "files_file_system_id",
  description:
    "Replace files.access_level with file_system_id (backfilled to 'legacy') + status (live/missing/pending_delete), and add a unique (file_system_id, storage_path) constraint after a duplicate check.",
  up,
};

registerMigration(migration);
