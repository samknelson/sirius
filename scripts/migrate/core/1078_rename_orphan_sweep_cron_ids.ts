import { db } from "../../../server/db";
import { sql } from "drizzle-orm";
import { registerMigration, type Migration } from "../../../server/services/migration-runner";
import { logger } from "../../../server/logger";

const SERVICE = "migration-1078";

/** Old cron plugin id → the `entity*` spelling it moves to. */
const RENAMES: Array<{ oldId: string; newId: string }> = [
  { oldId: "notes_orphan_sweep", newId: "entity_notes_orphan_sweep" },
  { oldId: "files_orphan_sweep", newId: "entity_files_orphan_sweep" },
];

/**
 * Rename the two polymorphic-child orphan sweeps to match the tables they
 * actually sweep (`entity_notes`, `entity_files`).
 *
 * A cron plugin's id is not just code: it is the `plugin_configs.plugin_id` of
 * the singleton row carrying the operator's schedule and enabled flag, and the
 * `cron_job_runs.job_name` of every past run. Renaming the plugin without
 * moving those leaves the operator's row an orphan the scheduler warns about
 * on every boot ("no plugin registered"), while the renamed job seeds a fresh
 * row on the default schedule and starts its run history over.
 *
 * The stored `name` is left alone: it is operator-editable, so a site that has
 * retitled the job keeps its title. The registered display name is what the
 * admin list falls back to.
 *
 * Idempotent, and tolerant of a site that has neither row yet (a fresh
 * database seeds them under the new ids on first boot). If a site somehow
 * holds BOTH spellings as cron configs, this refuses rather than guessing
 * which one carries the live schedule — merging them would silently discard an
 * operator's settings.
 */
async function up(): Promise<void> {
  for (const { oldId, newId } of RENAMES) {
    const existing = await db.execute(sql`
      SELECT plugin_id FROM plugin_configs
      WHERE plugin_kind = 'cron' AND plugin_id IN (${oldId}, ${newId})
    `);
    const held = new Set(
      (existing.rows ?? []).map((row) => String((row as Record<string, unknown>).plugin_id)),
    );

    if (held.has(oldId) && held.has(newId)) {
      throw new Error(
        `plugin_configs holds cron rows for both "${oldId}" and "${newId}" — refusing to guess which carries the live schedule. Resolve by hand before re-running.`,
      );
    }

    if (held.has(oldId)) {
      const renamed = await db.execute(sql`
        UPDATE plugin_configs SET plugin_id = ${newId}, updated_at = now()
        WHERE plugin_kind = 'cron' AND plugin_id = ${oldId}
      `);
      logger.info(`Renamed cron plugin config ${oldId} → ${newId}`, {
        service: SERVICE,
        rows: renamed.rowCount ?? 0,
      });
    }

    // The run history moves whether or not a config row existed: a site can
    // hold runs for a job whose config was deleted, and those rows are the
    // record of what actually happened under this job.
    const runs = await db.execute(sql`
      UPDATE cron_job_runs SET job_name = ${newId} WHERE job_name = ${oldId}
    `);
    if (runs.rowCount) {
      logger.info(`Carried cron run history ${oldId} → ${newId}`, {
        service: SERVICE,
        rows: runs.rowCount,
      });
    }
  }
}

const migration: Migration = {
  version: 1078,
  name: "rename_orphan_sweep_cron_ids",
  description:
    "Rename the notes_orphan_sweep and files_orphan_sweep cron jobs to entity_notes_orphan_sweep and entity_files_orphan_sweep, carrying each operator's plugin_configs row (schedule, enabled flag, settings) and its cron_job_runs history across so nothing is orphaned or reseeded. Idempotent; refuses if a site holds both spellings of a cron config.",
  up,
};

registerMigration(migration);

export default migration;
