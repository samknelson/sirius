import { eventBus, EventType, type EventPayloadMap } from "../event-bus";
import { logger } from "../../logger";
import { getEntityNoteContext } from "./registry";
import { deleteNotesForRecord } from "./cleanup";

/**
 * Immediate notes cleanup: when a record is deleted, remove its notes.
 *
 * `entity_notes` points at its parent with a plain (context_id, entity_id)
 * pair and no foreign key, so nothing in the database removes a deleted
 * record's notes. This subscriber is the FIRST of the two layers that do:
 * it reacts to the record's own `<entity>.delete.after` event and removes the
 * notes right away. The nightly `notes_orphan_sweep` cron is the second layer,
 * catching whatever this one missed (a crash, a handler error, a delete path
 * that predates the event). Both call the same routine (./cleanup.ts), so
 * there is one definition of "remove this record's notes".
 *
 * Cleanup is best effort and always after the delete committed: a failure here
 * leaves orphans for the sweep, and can never fail or roll back the delete.
 */

const SERVICE_NAME = "entity-notes-delete-cleanup";

/**
 * Which note context each record-deleted event belongs to.
 *
 * Declared explicitly rather than derived from the event name: the note
 * context ids are persisted in `entity_notes.context_id` and the event names
 * are subscribed to by name, so the two vocabularies are independent and the
 * mapping between them has to be written down. A record type that carries no
 * notes maps to `null` and its event is a no-op here.
 */
const NOTE_CONTEXT_BY_EVENT: ReadonlyArray<{
  event: EventType;
  /** Registered note context id, or null when this record type is not note-able. */
  contextId: string | null;
  recordId: (payload: any) => string;
}> = [
  {
    event: EventType.WORKER_DELETE_AFTER,
    contextId: "worker",
    recordId: (p: EventPayloadMap[EventType.WORKER_DELETE_AFTER]) => p.workerId,
  },
  {
    event: EventType.EMPLOYER_DELETE_AFTER,
    contextId: "employer",
    recordId: (p: EventPayloadMap[EventType.EMPLOYER_DELETE_AFTER]) => p.employerId,
  },
  {
    event: EventType.TRUST_PROVIDER_DELETE_AFTER,
    contextId: "trust_provider",
    recordId: (p: EventPayloadMap[EventType.TRUST_PROVIDER_DELETE_AFTER]) => p.trustProviderId,
  },
  {
    event: EventType.GRIEVANCE_DELETE_AFTER,
    contextId: "grievance",
    recordId: (p: EventPayloadMap[EventType.GRIEVANCE_DELETE_AFTER]) => p.grievanceId,
  },
];

const handlerIds: string[] = [];

async function cleanUp(contextId: string, entityId: string): Promise<void> {
  // A context that is not registered is not note-able: nothing to remove.
  if (!getEntityNoteContext(contextId)) return;
  try {
    const result = await deleteNotesForRecord(contextId, entityId);
    if (result.deleted > 0 || result.failed.length > 0) {
      logger.info("Removed notes for a deleted record", {
        service: SERVICE_NAME,
        contextId,
        entityId,
        deleted: result.deleted,
        failed: result.failed.length,
      });
    }
  } catch (error) {
    // Best effort: the delete has already committed. Anything left behind is
    // the nightly orphan sweep's to find.
    logger.error("Notes cleanup failed for a deleted record - leaving orphans for the sweep", {
      service: SERVICE_NAME,
      contextId,
      entityId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export function initEntityNotesDeleteCleanup(): void {
  if (handlerIds.length > 0) {
    logger.warn("Entity notes delete cleanup already initialized", { service: SERVICE_NAME });
    return;
  }
  for (const mapping of NOTE_CONTEXT_BY_EVENT) {
    const { contextId } = mapping;
    if (!contextId) continue;
    handlerIds.push(
      eventBus.on({
        name: `entity-notes-cleanup-${contextId}`,
        description: `Removes a deleted ${contextId} record's notes, one note at a time.`,
        event: mapping.event,
        handler: async (payload) => {
          await cleanUp(contextId, mapping.recordId(payload));
        },
      }),
    );
  }
  logger.info("Entity notes delete cleanup initialized", {
    service: SERVICE_NAME,
    events: NOTE_CONTEXT_BY_EVENT.filter((m) => m.contextId).map((m) => m.event),
  });
}
