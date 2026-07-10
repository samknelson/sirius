import { registerDenormPlugin } from "../registry";
import type { DenormPlugin } from "../types";
import {
  EventType,
  type TosAbsenceReminderPayload,
} from "../../../../services/event-bus";
import { storage } from "../../../../storage";

/** Prefix + entity-type for this plugin's synthetic denorm entities. */
const ENTITY_TYPE = "tos-reminder";
const PLUGIN_ID = "tos_absence_reminder";

/** Default reminder offsets (days after absence start) when unconfigured. */
const DEFAULT_OFFSETS = [1, 3, 11];

/**
 * How long after `sendOn` a reminder stays deliverable. If the EBS pump has not
 * fired the event by then (e.g. the app was down, or the reminder was scheduled
 * retroactively for a long-past absence), the pump records it `expired` instead
 * of blasting a stale notice.
 */
const DONT_SEND_AFTER_DAYS = 2;

/**
 * Denorm payload for one scheduled TOS/absence reminder. `event` is the exact
 * event-bus payload the EBS pump will emit; `sendOn` / `dontSendAfter` become
 * the `ebs_denorm` scheduling columns. The whole thing is written by `write`
 * via `storage.ebs.replaceForEntity`.
 */
export interface TosAbsenceReminderDenormPayload {
  event: TosAbsenceReminderPayload;
  sendOn: Date;
  dontSendAfter: Date;
}

/** `tos-reminder:<tosId>:<offset>` — the synthetic denorm entity id. */
function makeUniqueId(tosId: string, offset: number): string {
  return `${ENTITY_TYPE}:${tosId}:${offset}`;
}

/** Parse a `tos-reminder:<tosId>:<offset>` entity id. */
function parseUniqueId(entityId: string): { tosId: string; offset: number } | null {
  const parts = entityId.split(":");
  if (parts.length !== 3 || parts[0] !== ENTITY_TYPE) return null;
  const tosId = parts[1];
  const offset = Number(parts[2]);
  if (!tosId || !Number.isFinite(offset)) return null;
  return { tosId, offset };
}

/** Read the configured offsets off the plugin's own config `data.offsets`. */
async function resolveOffsets(): Promise<number[]> {
  const configs = await storage.pluginConfigs.getByKindAndPlugin("denorm", PLUGIN_ID);
  const data = (configs[0]?.data ?? {}) as Record<string, unknown>;
  const raw = data.offsets;
  if (!Array.isArray(raw)) return DEFAULT_OFFSETS;
  const offsets = raw
    .map((v) => Number(v))
    .filter((n) => Number.isFinite(n) && n >= 0);
  return offsets.length > 0 ? offsets : DEFAULT_OFFSETS;
}

/** Midnight (local) of `date` plus `days` whole days. */
function midnightPlusDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + days);
  return d;
}

/**
 * `tos_absence_reminder` denorm plugin — schedules the TOS/absence reminders
 * that the generic EBS pump later fires. Gated by the `worker.tos` component.
 *
 * Unlike the event-driven denorm plugins, this one has NO `eventHandlers`: there
 * is no "TOS saved" bus event, so it relies entirely on the hourly denorm
 * backfill + recompute cycle. `backfill` enumerates one synthetic denorm entity
 * per (open absence × configured offset); `compute` prices each one into a
 * concrete `ebs_denorm` row (send date = absence start midnight + offset days);
 * `findWidows` removes entities whose absence has ended or been deleted (the FK
 * cascade drops the `ebs_denorm` row too). The decoupled `ebs_status` record a
 * fired reminder leaves behind survives that widow deletion, so an ended-then-
 * reopened absence never re-fires an already-sent reminder.
 */
const tosAbsenceReminderPlugin: DenormPlugin<TosAbsenceReminderDenormPayload> = {
  metadata: {
    id: PLUGIN_ID,
    name: "TOS Absence Reminders",
    description:
      "Schedules absence reminders that fire a configurable number of days after a worker's absence start date (default 1, 3, 11).",
    requiredComponent: "worker.tos",
    singleton: true,
  },
  entityType: ENTITY_TYPE,

  async compute(entityId: string): Promise<TosAbsenceReminderDenormPayload> {
    const parsed = parseUniqueId(entityId);
    if (!parsed) {
      throw new Error(`Invalid TOS reminder entity id: ${entityId}`);
    }
    const { tosId, offset } = parsed;

    const tos = await storage.workerTos.get(tosId);
    // A missing or ended absence has no live reminder — throw so the row is
    // flagged and the next widow sweep removes it (findWidows is the real
    // cleanup path; this guards the race where an absence ends between backfill
    // and recompute).
    if (!tos) {
      throw new Error(`TOS ${tosId} no longer exists`);
    }
    if (tos.endDate) {
      throw new Error(`TOS ${tosId} has ended; no reminder to schedule`);
    }

    const worker = await storage.workers.getWorker(tos.workerId);
    const contactId = worker?.contactId ?? null;

    const startDate = new Date(tos.startDate);
    const sendOn = midnightPlusDays(startDate, offset);
    const dontSendAfter = midnightPlusDays(sendOn, DONT_SEND_AFTER_DAYS);

    const event: TosAbsenceReminderPayload = {
      tosId,
      workerId: tos.workerId,
      contactId,
      offset,
      absenceStartDate: startDate.toISOString().slice(0, 10),
    };

    return { event, sendOn, dontSendAfter };
  },

  async backfill(configId: string, limit: number): Promise<string[]> {
    const offsets = await resolveOffsets();
    const active = await storage.workerTos.listActive();
    const candidates: string[] = [];
    for (const tos of active) {
      for (const offset of offsets) {
        candidates.push(makeUniqueId(tos.id, offset));
      }
    }
    if (candidates.length === 0) return [];

    const existing = new Set(
      await storage.denorm.existingEntityIdsForConfig(configId, candidates),
    );
    const missing: string[] = [];
    for (const id of candidates) {
      if (!existing.has(id)) {
        missing.push(id);
        if (missing.length >= limit) break;
      }
    }
    return missing;
  },

  async findWidows(configId: string, limit: number): Promise<string[]> {
    const entityIds = await storage.denorm.listEntityIdsForConfig(configId, limit);
    if (entityIds.length === 0) return [];

    // Map each scheduled entity back to its TOS id, dropping any unparseable id
    // (treated as a widow so a malformed row is cleaned rather than stranded).
    const tosIdByEntity = new Map<string, string | null>();
    const tosIds = new Set<string>();
    for (const entityId of entityIds) {
      const parsed = parseUniqueId(entityId);
      tosIdByEntity.set(entityId, parsed?.tosId ?? null);
      if (parsed?.tosId) tosIds.add(parsed.tosId);
    }

    const openIds = new Set(await storage.workerTos.getOpenIdsIn([...tosIds]));
    const widows: string[] = [];
    for (const entityId of entityIds) {
      const tosId = tosIdByEntity.get(entityId) ?? null;
      if (!tosId || !openIds.has(tosId)) widows.push(entityId);
    }
    return widows;
  },

  async write(
    entityId: string,
    payload: TosAbsenceReminderDenormPayload,
    denormRowId: string,
  ): Promise<void> {
    await storage.ebs.replaceForEntity({
      denormId: denormRowId,
      uniqueId: entityId,
      pluginId: PLUGIN_ID,
      eventType: EventType.TOS_ABSENCE_REMINDER,
      payload: payload.event,
      sendOn: payload.sendOn,
      dontSendAfter: payload.dontSendAfter,
    });
  },
};

registerDenormPlugin(tosAbsenceReminderPlugin);
