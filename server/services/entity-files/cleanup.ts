import { storage } from "../../storage";
import { logger } from "../../logger";

/**
 * Removal of file attachments, one attachment at a time — the ONE definition
 * of "remove these attachments", shared by the immediate cleanup that runs
 * when a record is deleted (./delete-cleanup.ts) and by the nightly
 * `files_orphan_sweep` cron.
 *
 * Individual, never bulk: every removal goes through
 * `storage.entityFiles.deleteWithFile`, which is the logged storage method and
 * the only one that takes the `files` row and the stored bytes with the
 * attachment. The admin log viewer therefore gets one entry per attachment
 * naming the record it belonged to.
 *
 * Deliberately shares no code with the notes side: notes and files are
 * separate registries with their own context ids (both spellings are
 * persisted, so neither can be renamed to unify them) and their own storage
 * methods.
 */

const SERVICE_NAME = "entity-files-cleanup";

/** One attachment to remove: its id plus the record it hangs off. */
export interface AttachmentRef {
  id: string;
  entityId: string;
}

export interface AttachmentCleanupResult {
  /** Attachments actually removed (row, `files` row and stored bytes). */
  deleted: number;
  /** Attachment ids that could not be removed. */
  failed: string[];
}

/**
 * Delete each attachment, continuing past one that fails.
 *
 * A failure is recorded and the run continues: one unremovable attachment must
 * not strand the rest of a deleted record's files, nor abort a sweep batch.
 */
export async function deleteAttachments(
  contextId: string,
  refs: AttachmentRef[],
): Promise<AttachmentCleanupResult> {
  const result: AttachmentCleanupResult = { deleted: 0, failed: [] };
  for (const ref of refs) {
    try {
      const removed = await storage.entityFiles.deleteWithFile(contextId, ref.entityId, ref.id);
      if (removed) {
        result.deleted++;
      } else {
        // Already gone (a concurrent delete, say) — nothing removed here.
        result.failed.push(ref.id);
      }
    } catch (error) {
      result.failed.push(ref.id);
      logger.warn("Failed to delete file attachment during cleanup", {
        service: SERVICE_NAME,
        contextId,
        entityId: ref.entityId,
        attachmentId: ref.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return result;
}

/**
 * Remove every file attachment belonging to one record, one at a time.
 *
 * Reads the record's attachments first rather than deleting by
 * (context, entity) in one statement, so each removal is an individually
 * logged `deleteWithFile` — which is also what takes the stored bytes.
 */
export async function deleteFilesForRecord(
  contextId: string,
  entityId: string,
): Promise<AttachmentCleanupResult> {
  const attachments = await storage.entityFiles.list(contextId, entityId);
  return deleteAttachments(
    contextId,
    attachments.map((attachment) => ({ id: attachment.id, entityId: attachment.entityId })),
  );
}
