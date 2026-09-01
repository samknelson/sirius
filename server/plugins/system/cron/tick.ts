import { dateToYmd } from "@shared/utils/date";
import { EventType, type CronTickPeriod } from "../../../services/event-bus";

/**
 * The wall-clock heartbeat: what a tick is, and what it is worth relying on.
 *
 * ONE cron job (`cron-tick-emitter`) runs every ten minutes and emits a bus
 * event for each period whose boundary has just passed. Anything that needs to
 * be woken up regularly subscribes to the tick it wants instead of registering
 * a cron job of its own, so a periodic check becomes a subscription rather than
 * a new schedule an operator has to know about.
 *
 * WHAT A TICK PROMISES
 *
 * A tick is a prompt to go and look at current state. That is all it is. It
 * carries no work, no subject and no instruction, and two subscribers to the
 * same tick learn nothing about each other.
 *
 * WHAT A TICK DOES NOT PROMISE
 *
 * - Exactly-once. Overlapping runs and multi-instance deployments can each
 *   emit the same period's tick. A handler must be safe to run twice.
 * - Delivery of every boundary. Boundaries that pass while the emitter is not
 *   running produce ONE catch-up tick, not one per boundary missed. A handler
 *   must never count ticks or treat a tick as a unit of work.
 * - Punctuality. The emitter runs on a cron schedule an operator can edit, and
 *   a tick is delivered on the first run after its boundary.
 *
 * So a tick subscriber must be LEVEL-TRIGGERED and IDEMPOTENT: it observes what
 * is true now and decides for itself whether anything remains to be done. The
 * usage alert notifiers qualify — they read today's totals and their send-once
 * key absorbs a repeat.
 *
 * Work that must happen exactly once, at a moment known in advance, does NOT
 * belong on a tick. That is what the deferred event scheduler (`ebs_denorm` +
 * the EBS pump) is for: it claims its row before emitting, which is the
 * guarantee ticks deliberately do not offer.
 *
 * ALIGNMENT
 *
 * Periods are anchored at LOCAL MIDNIGHT, not at boot and not at UTC: hourly
 * means on the hour, the eight-hour tick means 00:00 / 08:00 / 16:00 local, and
 * the daily tick means local midnight. A restart therefore cannot shift the
 * phase, and two processes agree on which slot they are in without talking.
 *
 * Daylight saving moves those boundaries once each way per year. On the spring
 * forward the block containing the lost hour is short and its tick arrives at
 * the next real local time; on the fall back the repeated hour is one slot, so
 * that hour's tick fires once rather than twice. Both are accepted: a
 * level-triggered subscriber cannot tell the difference, and a subscriber that
 * could should not be on a tick.
 */

/** The bus events the emitter can emit — the tick vocabulary, as types. */
export type CronTickEventType =
  | EventType.CRON_TICK_10M
  | EventType.CRON_TICK_1H
  | EventType.CRON_TICK_2H
  | EventType.CRON_TICK_4H
  | EventType.CRON_TICK_8H
  | EventType.CRON_TICK_DAY;

/** One heartbeat period. */
export interface TickPeriodSpec {
  period: CronTickPeriod;
  event: CronTickEventType;
  /** Length of the period in minutes; also its alignment step. */
  minutes: number;
}

/**
 * Every period the emitter emits, finest first.
 *
 * Ten minutes is deliberately the finest: it is the emitter's own cadence, and
 * anything needing to react faster than that should be driven by the thing that
 * happened rather than by polling for it.
 */
export const TICK_PERIODS: readonly TickPeriodSpec[] = [
  { period: "10m", event: EventType.CRON_TICK_10M, minutes: 10 },
  { period: "1h", event: EventType.CRON_TICK_1H, minutes: 60 },
  { period: "2h", event: EventType.CRON_TICK_2H, minutes: 120 },
  { period: "4h", event: EventType.CRON_TICK_4H, minutes: 240 },
  { period: "8h", event: EventType.CRON_TICK_8H, minutes: 480 },
  { period: "day", event: EventType.CRON_TICK_DAY, minutes: 1440 },
];

/** Wall-clock minutes elapsed since the local midnight that began this day. */
function minutesSinceLocalMidnight(at: Date): number {
  return at.getHours() * 60 + at.getMinutes();
}

/**
 * Which slot of a period a moment falls in, as a string that is stable for the
 * whole slot and different in the next one.
 *
 * The local date is part of it so that a period whose slot index restarts every
 * day (all of them) cannot mistake today's first slot for yesterday's.
 */
export function tickSlotKey(at: Date, periodMinutes: number): string {
  const index = Math.floor(minutesSinceLocalMidnight(at) / periodMinutes);
  return `${dateToYmd(at)}:${index}`;
}

/** The local wall-clock moment a period's current slot began. */
export function tickSlotStart(at: Date, periodMinutes: number): Date {
  const index = Math.floor(minutesSinceLocalMidnight(at) / periodMinutes);
  const start = new Date(at);
  start.setHours(0, 0, 0, 0);
  // Field arithmetic, so the result is the right LOCAL time on a DST boundary.
  start.setMinutes(index * periodMinutes);
  return start;
}

/** A period whose boundary has passed since the emitter last ran. */
export interface DueTick {
  spec: TickPeriodSpec;
  /** Start of the slot this tick stands for. */
  slotStartedAt: Date;
}

/**
 * There is deliberately no "how late is this" count here.
 *
 * Only one catch-up tick is emitted per period however many boundaries were
 * missed, so any such number would describe skipped work that is never going
 * to be done — and a level-triggered subscriber, which is the only kind a tick
 * is for, has nothing to do with it. A subscriber that wants to know how far
 * behind a tick arrived compares `slotStartedAt` against its own clock, which
 * is exact and needs no policy about what counts as a missed slot. (An earlier
 * `late` flag computed that from a fixed number of milliseconds per period,
 * and was wrong twice a year: a local day is not always 24 hours long.)
 */

/**
 * The ticks owed right now, given when the emitter last completed a live run.
 *
 * Dueness is decided by comparing SLOTS rather than by assuming the job ran on
 * time. That is what keeps the emitter honest when its schedule has been edited
 * to something other than every ten minutes, when a run was slow, and when the
 * process was down: each period is emitted once for the slot it is now in, and
 * never twice for the same slot.
 *
 * With no previous run at all — a fresh database, or a job whose history has
 * aged out — every period is due. A first tick that fires a little early is
 * harmless to a level-triggered subscriber, and the alternative (emitting
 * nothing until a second run establishes a baseline) silently swallows the
 * coarse periods for up to a day.
 */
export function ticksDue(now: Date, lastRunAt: Date | null): DueTick[] {
  const due: DueTick[] = [];
  for (const spec of TICK_PERIODS) {
    if (lastRunAt && tickSlotKey(lastRunAt, spec.minutes) === tickSlotKey(now, spec.minutes)) {
      continue;
    }
    due.push({ spec, slotStartedAt: tickSlotStart(now, spec.minutes) });
  }
  return due;
}
