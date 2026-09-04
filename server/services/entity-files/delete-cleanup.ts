import { eventBus, EventType, type EventPayloadMap } from "../event-bus";
import { logger } from "../../logger";
import { getEntityFileContext } from "./registry";
import { deleteFilesForRecord } from "./cleanup";

/**
 * Immediate attachment cleanup: when a record is deleted, remove its files.
 *
 * `entity_files` points at its parent with a plain (context_id, entity_id)
 * pair and no foreign key, so nothing in the database removes a deleted
 * record's attachments — or the bytes they point at. This subscriber is the
 * FIRST of the two layers that do: it reacts to the record's own
 * `<entity>.delete.after` event and removes the attachments right away. The
 * nightly `files_orphan_sweep` cron is the second layer, catching whatever
 * this one missed (a crash, a handler error, a delete path that predates the
 * event). Both call the same routine (./cleanup.ts), so there is one
 * definition of "remove this record's files".
 *
 * Cleanup is best effort and always after the delete committed: a failure here
 * leaves orphans for the sweep, and can never fail or roll back the delete.
 */

const SERVICE_NAME = "entity-files-delete-cleanup";

/**
 * Which file context each record-deleted event belongs to.
 *
 * Declared explicitly rather than derived from the event name: the file
 * context ids are persisted in `entity_files.context_id` and the event names
 * are subscribed to by name, so the two vocabularies are independent and the
 * mapping between them has to be written down. A record type that carries no
 * attachments maps to `null` and its event is a no-op here.
 */
const FILE_CONTEXT_BY_EVENT: ReadonlyArray<{
  event: EventType;
  /** Registered file context id, or null when this record type carries no files. */
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
  // A context that is not registered carries no attachments: nothing to remove.
  if (!getEntityFileContext(contextId)) return;
  try {
    const result = await deleteFilesForRecord(contextId, entityId);
    if (result.deleted > 0 || result.failed.length > 0) {
      logger.info("Removed file attachments for a deleted record", {
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
    logger.error("File cleanup failed for a deleted record - leaving orphans for the sweep", {
      service: SERVICE_NAME,
      contextId,
      entityId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export function initEntityFilesDeleteCleanup(): void {
  if (handlerIds.length > 0) {
    logger.warn("Entity files delete cleanup already initialized", { service: SERVICE_NAME });
    return;
  }
  for (const mapping of FILE_CONTEXT_BY_EVENT) {
    const { contextId } = mapping;
    if (!contextId) continue;
    handlerIds.push(
      eventBus.on({
        name: `entity-files-cleanup-${contextId}`,
        description: `Removes a deleted ${contextId} record's file attachments, one attachment at a time.`,
        event: mapping.event,
        handler: async (payload) => {
          await cleanUp(contextId, mapping.recordId(payload));
        },
      }),
    );
  }
  logger.info("Entity files delete cleanup initialized", {
    service: SERVICE_NAME,
    events: FILE_CONTEXT_BY_EVENT.filter((m) => m.contextId).map((m) => m.event),
  });
}
