import type { EventPayloadMap, EventName } from "../event-bus";
import { storage } from "../../storage";
import { logger } from "../../logger";
import { isComponentEnabledSync } from "../component/cache";
import type { SnapshotNode, SnapshotRecordMetadata } from "@shared/snapshots";

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
export interface SnapshotCaptureAdapter<E extends EventName> {
  event: E;
  component?: string;
  entityType: string;
  /** Return false to skip capture for this occurrence. */
  shouldCapture: (payload: EventPayloadMap[E]) => boolean;
  getEntityId: (payload: EventPayloadMap[E]) => string;
  getLabel: (payload: EventPayloadMap[E]) => string;
  /**
   * Produce the self-contained export bundle (a SnapshotNode). Runs inside the
   * saving transaction, so it reads the entity exactly as that save left it.
   */
  exportEntity: (payload: EventPayloadMap[E]) => Promise<SnapshotNode | undefined>;
  /**
   * Read the target record's metadata for this save. This is separate from
   * exportEntity because record history is maintained by the logging layer and
   * is intentionally not part of the entity export payload.
   */
  getMetadata: (payload: EventPayloadMap[E]) => Promise<SnapshotRecordMetadata | null>;
}

const adapters = new Map<EventName, SnapshotCaptureAdapter<any>>();
let registrationClosed = false;

/** Declaration only: called during startup, never reads component tables. */
export function registerSnapshotCaptureAdapter<E extends EventName>(adapter: SnapshotCaptureAdapter<E>): void {
  if (registrationClosed) throw new Error("Snapshot capture registration is closed");
  if (adapters.has(adapter.event)) throw new Error(`Duplicate snapshot capture event '${adapter.event}'`);
  adapters.set(adapter.event, Object.freeze({ ...adapter }));
}

export function closeSnapshotCaptureRegistration(): void {
  registrationClosed = true;
}

/**
 * Whether capture is currently switched on for an event.
 *
 * Exported because capture being off is not only this service's business: a
 * consumer reading snapshots back as history (e.g. a notifier
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
 *    save's notifier, from a save that never had one. A history consumer can
 *    miss a removal permanently once its next baseline no longer holds it.
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
  const adapter = adapters.get(event) as
    | SnapshotCaptureAdapter<E>
    | undefined;
  if (!adapter) return;
  if (adapter.component && !isComponentEnabledSync(adapter.component)) return;
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

  const metadata = await adapter.getMetadata(payload);

  // The snapshot storage stamps its own capture time and effective actor (or
  // null for a system capture). This is deliberately separate from record
  // history because snapshots are process output.
  const snapshot = await storage.snapshots.create({
    entityType: adapter.entityType,
    entityId,
    label: adapter.getLabel(payload),
    data: { ...bundle, metadata },
  });
  logger.info(
    `Captured snapshot ${snapshot.id} of ${adapter.entityType} ${entityId} [${snapshot.label}]`,
    { service: SERVICE_NAME },
  );
}
