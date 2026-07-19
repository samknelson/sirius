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
  /** Produce the self-contained export bundle (a SnapshotNode). */
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

async function isEventActive(event: string): Promise<boolean> {
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

async function handleEvent<E extends keyof EventPayloadMap>(
  adapter: SnapshotCaptureAdapter<E>,
  payload: EventPayloadMap[E],
): Promise<void> {
  if (!adapter.shouldCapture(payload)) return;
  if (!(await isEventActive(adapter.event as string))) return;

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

const handlerIds: string[] = [];

export function initSnapshotCapture(): void {
  if (handlerIds.length > 0) {
    logger.warn(`Snapshot capture already initialized`, { service: SERVICE_NAME });
    return;
  }
  for (const adapter of adapters) {
    handlerIds.push(
      eventBus.on({
        name: `snapshot-capture-${adapter.entityType}`,
        description: `Captures a point-in-time snapshot of a ${adapter.entityType} when its saved event qualifies.`,
        event: adapter.event,
        handler: (payload: any) => handleEvent(adapter, payload),
      }),
    );
  }
  logger.info(`Snapshot capture initialized (${adapters.length} adapter(s))`, { service: SERVICE_NAME });
}

export function shutdownSnapshotCapture(): void {
  for (const id of handlerIds) {
    eventBus.off(id);
  }
  handlerIds.length = 0;
}
