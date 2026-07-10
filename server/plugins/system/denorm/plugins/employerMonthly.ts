import { registerDenormPlugin } from "../registry";
import type { DenormPlugin } from "../types";
import {
  EventType,
  type EmployerMonthlyPayload,
} from "../../../../services/event-bus";
import { storage } from "../../../../storage";

/** Prefix + entity-type for this plugin's synthetic denorm entities. */
const ENTITY_TYPE = "employer-monthly";
const PLUGIN_ID = "employer_monthly";

/**
 * How many months ahead of the current month to schedule, inclusive of the
 * current month. `3` means the current month plus the next two. Hardcoded on
 * purpose — there is no admin-configurable horizon for this plugin.
 */
const HORIZON_MONTHS = 3;

/** Day-of-month the event fires on. */
const SEND_ON_DAY = 1;
/**
 * Day-of-month after which the event is no longer deliverable. If the EBS pump
 * has not fired the event by the 25th (e.g. the app was down all month), the
 * pump records it `expired` rather than firing a stale month.
 */
const DONT_SEND_AFTER_DAY = 25;

/**
 * Denorm payload for one scheduled employer-monthly event. `event` is the exact
 * event-bus payload the EBS pump will emit; `sendOn` / `dontSendAfter` become
 * the `ebs_denorm` scheduling columns. Written by `write` via
 * `storage.ebs.replaceForEntity`.
 */
export interface EmployerMonthlyDenormPayload {
  event: EmployerMonthlyPayload;
  /** Owning subject (the employer id) — persisted to `ebs_denorm.subject_id`. */
  subjectId: string;
  sendOn: Date;
  dontSendAfter: Date;
}

/** `employer-monthly:<employerId>:<YYYY-MM>` — the synthetic denorm entity id. */
function makeUniqueId(employerId: string, month: string): string {
  return `${ENTITY_TYPE}:${employerId}:${month}`;
}

/** Parse an `employer-monthly:<employerId>:<YYYY-MM>` entity id. */
function parseUniqueId(
  entityId: string,
): { employerId: string; month: string } | null {
  const parts = entityId.split(":");
  // employerId is a UUID and month is YYYY-MM — neither contains a colon — so a
  // well-formed id splits into exactly three parts.
  if (parts.length !== 3 || parts[0] !== ENTITY_TYPE) return null;
  const [, employerId, month] = parts;
  if (!employerId || !/^\d{4}-\d{2}$/.test(month)) return null;
  return { employerId, month };
}

/** Format a `YYYY-MM` string from a date's LOCAL year/month. */
function toMonthKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

/**
 * The scheduling window for one month: `sendOn` = the 1st at LOCAL midnight;
 * `dontSendAfter` = the 25th at LOCAL midnight. Built from LOCAL fields to avoid
 * a UTC off-by-one. Shared by `compute` (to price the row), `backfill` (to skip
 * months whose window is already fully past) and `findWidows` (to retire them
 * once it is).
 */
function monthWindow(month: string): { sendOn: Date; dontSendAfter: Date } {
  const [y, m] = month.split("-").map((s) => Number(s));
  const sendOn = new Date(y, m - 1, SEND_ON_DAY, 0, 0, 0, 0);
  const dontSendAfter = new Date(y, m - 1, DONT_SEND_AFTER_DAY, 0, 0, 0, 0);
  return { sendOn, dontSendAfter };
}

/**
 * The month keys inside the rolling horizon (current month + the next
 * {@link HORIZON_MONTHS} − 1), computed from LOCAL fields.
 */
function horizonMonths(now: Date): string[] {
  const baseY = now.getFullYear();
  const baseM = now.getMonth();
  const months: string[] = [];
  for (let k = 0; k < HORIZON_MONTHS; k++) {
    months.push(toMonthKey(new Date(baseY, baseM + k, 1)));
  }
  return months;
}

/**
 * `employer_monthly` denorm plugin — schedules one EBS (deferred event-bus)
 * event per ACTIVE employer per month, for the current month plus the next two.
 * Each event fires on the 1st of its month and stops being deliverable after
 * the 25th. It is a producer only: no consumer is registered yet (future ledger
 * interest/penalty work will subscribe), so the pump logging "No handlers" for
 * `EMPLOYER_MONTHLY` is expected.
 *
 * Core / always-on: no `requiredComponent`. Like the sibling reminder plugins it
 * has NO `eventHandlers` (there is no "month changed" bus event) and relies on
 * the hourly denorm backfill + recompute cycle for scheduling. `backfill`
 * enumerates one synthetic denorm entity per (active employer × month-in-horizon)
 * whose window has not fully passed; `compute` prices each one into a concrete
 * `ebs_denorm` row; `findWidows` removes entities whose employer was DELETED (a
 * merely-deactivated employer's already-scheduled months are intentionally left
 * to fire) and entities whose month window has fully lapsed.
 *
 * Deliberately omits `isScheduledEventLive`: per product decision the pump fires
 * every due employer-monthly event unconditionally. Deactivating an employer
 * stops NEW months from being scheduled (backfill only enumerates active
 * employers) but does not retract months already scheduled.
 */
const employerMonthlyPlugin: DenormPlugin<EmployerMonthlyDenormPayload> = {
  metadata: {
    id: PLUGIN_ID,
    name: "Employer Monthly Events",
    description:
      "Schedules a monthly event for each active employer (current month plus the next two), firing on the 1st of each month.",
    singleton: true,
  },
  entityType: ENTITY_TYPE,

  async compute(entityId: string): Promise<EmployerMonthlyDenormPayload> {
    const parsed = parseUniqueId(entityId);
    if (!parsed) {
      throw new Error(`Invalid employer monthly entity id: ${entityId}`);
    }
    const { employerId, month } = parsed;

    // Existence only — a deactivated employer's already-scheduled months still
    // fire. A deleted employer has nothing to schedule: throw so the row is
    // flagged and the next widow sweep removes it (findWidows is the real
    // cleanup path; this guards the race where an employer is deleted between
    // backfill and recompute).
    const employer = await storage.employers.getEmployer(employerId);
    if (!employer) {
      throw new Error(`Employer ${employerId} no longer exists`);
    }

    const { sendOn, dontSendAfter } = monthWindow(month);
    const event: EmployerMonthlyPayload = { employerId, month };
    return { event, subjectId: employerId, sendOn, dontSendAfter };
  },

  async backfill(configId: string, limit: number): Promise<string[]> {
    const now = new Date();
    const months = horizonMonths(now);
    const active = await storage.employers.listActive();

    // Enumerate only (active employer × month) whose window is not already fully
    // past (`dontSendAfter >= now`). The current month drops out once its 25th
    // has passed; future months are always included.
    const candidates: string[] = [];
    for (const employer of active) {
      for (const month of months) {
        if (monthWindow(month).dontSendAfter < now) continue;
        candidates.push(makeUniqueId(employer.id, month));
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

    const now = new Date();
    const parsedById = new Map<string, { employerId: string; month: string }>();
    for (const entityId of entityIds) {
      const parsed = parseUniqueId(entityId);
      if (parsed) parsedById.set(entityId, parsed);
    }

    // Which of the referenced employers still exist (active OR inactive). Only a
    // DELETED employer widows its rows; a merely-deactivated one keeps its
    // already-scheduled months.
    const employerIds = Array.from(
      new Set(Array.from(parsedById.values()).map((p) => p.employerId)),
    );
    const existing = new Set(
      (await storage.employers.getByIds(employerIds)).map((e) => e.id),
    );

    const widows: string[] = [];
    for (const entityId of entityIds) {
      const parsed = parsedById.get(entityId);
      // Unparseable id → widow (clean a malformed row rather than stranding it).
      if (!parsed) {
        widows.push(entityId);
        continue;
      }
      // Employer deleted → widow (deactivation alone does NOT widow).
      if (!existing.has(parsed.employerId)) {
        widows.push(entityId);
        continue;
      }
      // Month window fully lapsed → widow (past the rolling horizon; its
      // terminal `ebs_status` row, if any, is decoupled and survives this
      // deletion, so a re-added month never re-fires).
      if (monthWindow(parsed.month).dontSendAfter < now) {
        widows.push(entityId);
      }
    }
    return widows;
  },

  async write(
    entityId: string,
    payload: EmployerMonthlyDenormPayload,
    denormRowId: string,
  ): Promise<void> {
    await storage.ebs.replaceForEntity({
      denormId: denormRowId,
      uniqueId: entityId,
      pluginId: PLUGIN_ID,
      subjectId: payload.subjectId,
      eventType: EventType.EMPLOYER_MONTHLY,
      payload: payload.event,
      sendOn: payload.sendOn,
      dontSendAfter: payload.dontSendAfter,
    });
  },
};

registerDenormPlugin(employerMonthlyPlugin);
