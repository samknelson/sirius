import { storage } from "../../../../storage";
import { listEntityFileContexts } from "../../../../services/entity-files/registry";
import { deleteAttachments } from "../../../../services/entity-files/cleanup";
import { isFileContextAvailable } from "../../../../storage/entity-files-context-tables";
import { registerCronPlugin } from "../registry";
import type { CronJobContext, CronJobResult } from "../types";

/** Max orphans removed per record type per run, so one sweep can't run long. */
const BATCH_LIMIT = 500;

/**
 * `files_orphan_sweep` cron — deletes file attachments whose parent record is
 * gone, taking their stored bytes with them.
 *
 * The twin of `notes_orphan_sweep`, and deliberately a SEPARATE cron plugin
 * rather than a second phase of it: a cron plugin's id is persisted as a
 * singleton config row carrying its schedule and enabled flag, so folding
 * both sweeps under one id would quietly retire the operator's ability to
 * schedule them independently.
 *
 * `entity_files.context_id` / `entity_id` are a polymorphic pair with no FK,
 * so deleting a worker, employer or provider leaves its attachments behind.
 * This job runs one anti-join per registered file context
 * (`server/modules/entity-files-contexts.ts`) and removes what it finds
 * through `deleteWithFile`, ONE attachment at a time — which is what takes the
 * `files` row and the stored object with it, and what writes the per-attachment
 * audit entry. Because it iterates the registry, a newly file-able record type
 * is swept automatically — nothing to add here. In `test` mode it reports what
 * it would delete without writing.
 *
 * This is the SECOND of the two cleanup layers. The first removes a record's
 * attachments the moment it is deleted (see
 * `server/services/entity-files/delete-cleanup.ts`); this sweep catches what
 * that missed — a crash, a handler error, a delete path that predates the
 * event. Both go through the same routine
 * (`server/services/entity-files/cleanup.ts`).
 *
 * Contexts an operator has not configured are still swept: their attachments
 * are still stored, and a deleted record's files should not survive because
 * the area is currently unconfigured.
 *
 * A record type owned by a disabled component (grievances, say) has no table
 * to join against, so it is SKIPPED rather than swept, and named in the run
 * summary. Its attachments survive until the component is switched back on —
 * the conservative choice, since "the table is missing" is not evidence that
 * the records are gone.
 *
 * Stored objects whose `entity_files` row is already gone are NOT this job's:
 * they belong to `file-consistency-sweep`, which reconciles each filesystem
 * against the `files` table.
 */
registerCronPlugin({
  metadata: {
    id: "files_orphan_sweep",
    name: "File Attachments Orphan Sweep",
    description:
      "Daily sweep that deletes file attachments whose parent record (worker, employer, trust provider, …) no longer exists, including their stored bytes.",
    singleton: true,
  },
  defaultSchedule: "50 3 * * *", // Daily at 03:50, just after the notes sweep
  defaultEnabled: true,

  async execute(context: CronJobContext): Promise<CronJobResult> {
    const perContext: Array<{
      contextId: string;
      orphans: number;
      deleted: number;
      failed: number;
    }> = [];
    const skipped: string[] = [];
    let totalDeleted = 0;
    let totalFound = 0;
    let totalFailed = 0;

    for (const fileContext of listEntityFileContexts()) {
      if (!isFileContextAvailable(fileContext.id)) {
        skipped.push(fileContext.id);
        continue;
      }

      const orphans = await storage.entityFiles.findOrphans(fileContext.id, BATCH_LIMIT);
      totalFound += orphans.length;

      let deleted = 0;
      let failed = 0;
      if (context.mode === "live" && orphans.length > 0) {
        const result = await deleteAttachments(fileContext.id, orphans);
        deleted = result.deleted;
        failed = result.failed.length;
        totalDeleted += deleted;
        totalFailed += failed;
      }
      perContext.push({ contextId: fileContext.id, orphans: orphans.length, deleted, failed });
    }

    const verb = context.mode === "live" ? "Deleted" : "Would delete";
    const count = context.mode === "live" ? totalDeleted : totalFound;
    const skipNote =
      skipped.length > 0 ? `; skipped ${skipped.join(", ")} (feature not enabled)` : "";
    const failNote = totalFailed > 0 ? `; ${totalFailed} could not be deleted` : "";
    return {
      message: `${verb} ${count} orphaned file attachment${count === 1 ? "" : "s"} across ${perContext.length} record type${perContext.length === 1 ? "" : "s"}${failNote}${skipNote}`,
      metadata: { totalFound, totalDeleted, totalFailed, perContext, skipped },
    };
  },
});
