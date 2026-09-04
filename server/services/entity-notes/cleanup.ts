import { storage } from "../../storage";
import { logger } from "../../logger";

/**
 * Removal of notes, one note at a time — the ONE definition of "remove these
 * notes", shared by the immediate cleanup that runs when a record is deleted
 * (./delete-cleanup.ts) and by the nightly `notes_orphan_sweep` cron.
 *
 * Individual, never bulk: every removal goes through
 * `storage.entityNotes.delete`, which is the logged storage method, so the
 * admin log viewer gets one entry per note naming the record it belonged to.
 * A bulk `delete … where id in (…)` would remove the same rows and log
 * nothing.
 *
 * The notes side and the files side deliberately share no code: they are
 * separate registries with their own context ids (both spellings are
 * persisted, so neither can be renamed to unify them) and their own storage
 * methods.
 */

const SERVICE_NAME = "entity-notes-cleanup";

export interface NoteCleanupResult {
  /** Notes actually removed. */
  deleted: number;
  /** Ids that could not be removed — a throwing delete, or a note already gone. */
  failed: string[];
}

/**
 * Delete each note by id, continuing past a note that fails.
 *
 * A failure is recorded and the run continues: one unremovable note must not
 * strand the rest of a deleted record's notes, nor abort a sweep batch.
 */
export async function deleteNotesByIds(ids: string[]): Promise<NoteCleanupResult> {
  const result: NoteCleanupResult = { deleted: 0, failed: [] };
  for (const id of ids) {
    try {
      const removed = await storage.entityNotes.delete(id);
      if (removed) {
        result.deleted++;
      } else {
        // Already gone (a concurrent delete, say) — nothing removed here.
        result.failed.push(id);
      }
    } catch (error) {
      result.failed.push(id);
      logger.warn("Failed to delete note during cleanup", {
        service: SERVICE_NAME,
        noteId: id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return result;
}

/**
 * Remove every note belonging to one record, one note at a time.
 *
 * Reads the record's notes first rather than deleting by (context, entity) in
 * one statement, so each removal is an individually logged single-note delete.
 */
export async function deleteNotesForRecord(
  contextId: string,
  entityId: string,
): Promise<NoteCleanupResult> {
  const notes = await storage.entityNotes.listByEntity(contextId, entityId);
  return deleteNotesByIds(notes.map((note) => note.id));
}
