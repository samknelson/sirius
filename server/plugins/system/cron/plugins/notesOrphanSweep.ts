import { storage } from "../../../../storage";
import { listEntityNoteContexts } from "../../../../services/entity-notes/registry";
import { deleteNotesByIds } from "../../../../services/entity-notes/cleanup";
import { isNoteContextAvailable } from "../../../../storage/entity-notes-context-tables";
import { registerCronPlugin } from "../registry";
import type { CronJobContext, CronJobResult } from "../types";

/** Max orphans removed per record type per run, so one sweep can't run long. */
const BATCH_LIMIT = 500;

/**
 * `notes_orphan_sweep` cron — deletes notes whose parent record is gone.
 *
 * `entity_notes.context_id` / `entity_id` are a polymorphic pair with no FK,
 * so deleting a worker, employer or provider leaves its notes behind. This job
 * runs one anti-join per registered note context
 * (`server/modules/entity-notes-contexts.ts`) and hard-deletes what it finds.
 * Because it iterates the registry, a newly note-able record type is swept
 * automatically — nothing to add here. In `test` mode it reports what it would
 * delete without writing.
 *
 * This is the SECOND of the two cleanup layers. The first removes a record's
 * notes the moment it is deleted (see
 * `server/services/entity-notes/delete-cleanup.ts`); this sweep catches what
 * that missed — a crash, a handler error, a delete path that predates the
 * event. Both go through the same routine
 * (`server/services/entity-notes/cleanup.ts`), which removes notes ONE AT A
 * TIME through the logged single-note delete, so every removal shows up in the
 * admin log viewer naming the record it belonged to.
 *
 * Contexts an operator has switched OFF are still swept: their notes are still
 * stored, and a deleted record's notes should not survive because the area is
 * currently hidden.
 *
 * A record type owned by a disabled component (grievances, say) has no table
 * to join against, so it is SKIPPED rather than swept, and named in the run
 * summary. Its notes survive until the component is switched back on — the
 * conservative choice, since "the table is missing" is not evidence that the
 * records are gone.
 */
registerCronPlugin({
  metadata: {
    id: "notes_orphan_sweep",
    name: "Notes Orphan Sweep",
    description:
      "Daily sweep that deletes notes whose parent record (worker, employer, trust provider, …) no longer exists.",
    singleton: true,
  },
  defaultSchedule: "45 3 * * *", // Daily at 03:45
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

    for (const noteContext of listEntityNoteContexts()) {
      if (!isNoteContextAvailable(noteContext.id)) {
        skipped.push(noteContext.id);
        continue;
      }

      const orphanIds = await storage.entityNotes.findOrphanIds(noteContext.id, BATCH_LIMIT);
      totalFound += orphanIds.length;

      let deleted = 0;
      let failed = 0;
      if (context.mode === "live" && orphanIds.length > 0) {
        const result = await deleteNotesByIds(orphanIds);
        deleted = result.deleted;
        failed = result.failed.length;
        totalDeleted += deleted;
        totalFailed += failed;
      }
      perContext.push({ contextId: noteContext.id, orphans: orphanIds.length, deleted, failed });
    }

    const verb = context.mode === "live" ? "Deleted" : "Would delete";
    const count = context.mode === "live" ? totalDeleted : totalFound;
    const skipNote = skipped.length > 0 ? `; skipped ${skipped.join(", ")} (feature not enabled)` : "";
    const failNote = totalFailed > 0 ? `; ${totalFailed} could not be deleted` : "";
    return {
      message: `${verb} ${count} orphaned note${count === 1 ? "" : "s"} across ${perContext.length} record type${perContext.length === 1 ? "" : "s"}${failNote}${skipNote}`,
      metadata: { totalFound, totalDeleted, totalFailed, perContext, skipped },
    };
  },
});
