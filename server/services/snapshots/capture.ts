import { eventBus, EventType, type EventPayloadMap } from "../event-bus";
import { storage } from "../../storage";
import { getRequestContext } from "../../middleware/request-context";
import { logger } from "../../logger";

const SERVICE_NAME = "snapshot-capture";

/**
 * Name of the settings variable controlling which registered capture events
 * are active. Value shape: `{ "events": { "<EventType>": boolean } }`.
 * A registered event is ACTIVE by default when the variable (or its entry)
 * is absent — the variable exists to turn capture off, not on.
 */
export const SNAPSHOTS_SETTINGS_VARIABLE = "snapshots_settings";

/**
 * One adapter per supported event: maps the event payload to the snapshot
 * to capture. This is deliberately an in-code registry (not a plugin kind):
 * capture policy is configuration on a single capture service.
 */
interface SnapshotCaptureAdapter<E extends keyof EventPayloadMap> {
  event: E;
  entityType: string;
  /** Return false to skip capture for this occurrence. */
  shouldCapture: (payload: EventPayloadMap[E]) => boolean;
  getEntityId: (payload: EventPayloadMap[E]) => string;
  getLabel: (payload: EventPayloadMap[E]) => string;
  /**
   * Produce the self-contained export bundle (a SnapshotNode). Runs inside the
   * saving transaction, so it reads the entity exactly as that save left it.
   */
  exportEntity: (payload: EventPayloadMap[E]) => Promise<unknown | undefined>;
}

const adapters: SnapshotCaptureAdapter<any>[] = [
  {
    event: EventType.EDLS_SHEET_SAVED,
    entityType: "edls_sheet",
    // Capture only on status transitions (create arrives with
    // previousStatus === null, which counts as a transition).
    shouldCapture: (payload) => payload.previousStatus !== payload.newStatus,
    getEntityId: (payload) => payload.sheetId,
    getLabel: (payload) =>
      payload.previousStatus === null
        ? `status: → ${payload.newStatus}`
        : `status: ${payload.previousStatus} → ${payload.newStatus}`,
    exportEntity: (payload) => storage.edlsSheets.export(payload.sheetId),
  },
];

/**
 * Whether capture is currently switched on for an event.
 *
 * Exported because capture being off is not only this service's business: a
 * consumer reading snapshots back as history (e.g. the EDLS worker notifier
 * diffing rosters) otherwise sees "no snapshot" and cannot tell an entity
 * with no history from a switch someone turned off. A read error answers
 * ACTIVE, matching the capture path: the setting exists to disable capture,
 * so an unreadable setting must not read as disabled.
 */
export async function isSnapshotCaptureActive(event: string): Promise<boolean> {
  try {
    const variable = await storage.variables.getByName(SNAPSHOTS_SETTINGS_VARIABLE);
    if (!variable) return true;
    const value = variable.value as { events?: Record<string, boolean> } | null;
    const flag = value?.events?.[event];
    return flag !== false;
  } catch (err) {
    logger.error(
      `Failed to read ${SNAPSHOTS_SETTINGS_VARIABLE}: ${err instanceof Error ? err.message : String(err)}`,
      { service: SERVICE_NAME },
    );
    return true;
  }
}

/**
 * Resolve the acting user from the ambient request context. The author is
 * the EFFECTIVE user (masquerade target), matching how the rest of the app
 * attributes actions performed while masquerading.
 */
async function resolveAuthor(): Promise<{ authorId: string | null; authorName: string | null }> {
  const context = getRequestContext();
  const userId = context?.userId ?? null;
  if (!userId) return { authorId: null, authorName: null };
  try {
    const user = await storage.users.getUser(userId);
    if (!user) return { authorId: userId, authorName: null };
    const name = [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email || null;
    return { authorId: userId, authorName: name };
  } catch {
    return { authorId: userId, authorName: null };
  }
}

/**
 * Capture a snapshot for a save that is HAPPENING — call this from inside the
 * saving transaction, immediately before the save's event is queued.
 *
 * Capture is deliberately part of the save rather than a reaction to it. An
 * after-commit capture answers two questions wrongly, and both failures are
 * silent:
 *
 *  - WHAT it records. It would have to re-read the entity, which by then is
 *    "the entity now": a second save committing in between gets recorded under
 *    the first save's label.
 *  - WHETHER it is there yet. Capture and the notifiers that read history back
 *    are sibling after-commit handlers of the same save, none of them awaited.
 *    A save whose snapshot had not landed yet is indistinguishable, to the next
 *    save's notifier, from a save that never had one — and for the EDLS worker
 *    notifier that means a worker is never told they came off a crew, with no
 *    later chance to recover: the next baseline no longer holds them.
 *
 * Committing the snapshot with the save settles both. History exists exactly
 * when the save it describes exists, and anything running after a save's
 * commit can see the history of every save that preceded it. The price is that
 * a failure here fails the save; that is the intended trade, because a save
 * with no history silently breaks the consumers that diff it.
 */
export async function captureEntitySnapshot<E extends keyof EventPayloadMap>(
  event: E,
  payload: EventPayloadMap[E],
): Promise<void> {
  const adapter = adapters.find((candidate) => candidate.event === event) as
    | SnapshotCaptureAdapter<E>
    | undefined;
  if (!adapter) return;
  if (!adapter.shouldCapture(payload)) return;
  if (!(await isSnapshotCaptureActive(adapter.event as string))) return;

  const entityId = adapter.getEntityId(payload);
  const bundle = await adapter.exportEntity(payload);
  if (!bundle) {
    logger.warn(
      `Snapshot capture skipped: ${adapter.entityType} ${entityId} no longer exists`,
      { service: SERVICE_NAME },
    );
    return;
  }

  const { authorId, authorName } = await resolveAuthor();
  const snapshot = await storage.snapshots.create({
    entityType: adapter.entityType,
    entityId,
    authorId,
    authorName,
    label: adapter.getLabel(payload),
    data: bundle,
  });
  logger.info(
    `Captured snapshot ${snapshot.id} of ${adapter.entityType} ${entityId} [${snapshot.label}]`,
    { service: SERVICE_NAME },
  );
}
