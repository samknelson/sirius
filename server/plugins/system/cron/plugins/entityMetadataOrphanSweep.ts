import { entityMetadataStorage } from "../../../../storage/system/entity-metadata";
import { registerCronPlugin } from "../registry";
import type { CronJobContext, CronJobResult } from "../types";

/** Max orphans removed per table per run, so one sweep can't run long. */
const BATCH_LIMIT = 500;

/**
 * `entity_metadata_orphan_sweep` cron — removes provenance rows whose record
 * is gone.
 *
 * The third of the polymorphic-child sweeps, alongside
 * `entity_notes_orphan_sweep` and `entity_files_orphan_sweep`, and a separate
 * cron plugin for the same reason they are separate from each other: a cron
 * id is persisted as a singleton config row carrying its schedule and enabled
 * flag, so folding sweeps under one id retires the operator's ability to
 * schedule and disable them independently.
 *
 * `entity_metadata.entity_id` names a record in `context_id` with no FK to it,
 * so nothing in the database removes a deleted record's provenance. The first
 * cleanup layer is the storage logging middleware, which forgets a record when
 * it observes a LOGGED single-record delete. That leaves behind everything it
 * never observed: a delete path with no logging config, a bulk delete, a
 * best-effort write that failed, rows written before a table's config existed.
 * This sweep is the second layer.
 *
 * What is at stake if it gets a table wrong is not a few stale rows but a
 * table's entire history, so every table it cannot vouch for is SKIPPED and
 * named in the run summary — see `server/storage/system/entity-metadata-tables.ts`
 * for the rule. In `test` mode it reports what it would remove without writing.
 *
 * Unlike the notes and files sweeps this one does NOT delete record by record
 * for the audit trail's sake: the metadata module sits outside the storage
 * logging wrapper (it is what logging calls), so no removal here can produce a
 * log entry. The run summary is the record of what went.
 */
registerCronPlugin({
  metadata: {
    id: "entity_metadata_orphan_sweep",
    name: "Entity Metadata Orphan Sweep",
    description:
      "Daily sweep that removes record provenance rows (created/modified stamps) whose record no longer exists, skipping any table it cannot check safely.",
    singleton: true,
  },
  defaultSchedule: "55 3 * * *", // Daily at 03:55, just after the files sweep
  defaultEnabled: true,

  async execute(context: CronJobContext): Promise<CronJobResult> {
    const perContext: Array<{ contextId: string; orphans: number; removed: number }> = [];
    const skipped: Array<{ contextId: string; reason: string }> = [];
    let totalFound = 0;
    let totalRemoved = 0;

    for (const contextId of await entityMetadataStorage.listContexts()) {
      const verdict = await entityMetadataStorage.checkContext(contextId);
      if (!verdict.sweepable) {
        skipped.push({ contextId, reason: verdict.reason });
        continue;
      }

      const orphans = await entityMetadataStorage.findOrphans(contextId, BATCH_LIMIT);
      totalFound += orphans.length;

      let removed = 0;
      if (context.mode === "live" && orphans.length > 0) {
        removed = await entityMetadataStorage.removeOrphans(contextId, orphans);
        totalRemoved += removed;
      }
      perContext.push({ contextId, orphans: orphans.length, removed });
    }

    const verb = context.mode === "live" ? "Removed" : "Would remove";
    const count = context.mode === "live" ? totalRemoved : totalFound;
    const skipNote =
      skipped.length > 0
        ? `; skipped ${skipped.map((s) => `${s.contextId} (${s.reason})`).join(", ")}`
        : "";
    return {
      message: `${verb} ${count} orphaned provenance row${count === 1 ? "" : "s"} across ${perContext.length} context${perContext.length === 1 ? "" : "s"}${skipNote}`,
      metadata: { totalFound, totalRemoved, perContext, skipped },
    };
  },
});
