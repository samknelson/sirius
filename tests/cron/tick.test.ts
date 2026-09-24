/**
 * What the wall-clock heartbeat promises, and how it would go quiet.
 *
 * The tick emitter is one cron job that everything periodic now hangs off, and
 * its only decision is which periods have just turned over. That decision is
 * made by comparing the slot the clock is in now against the slot it was in at
 * the emitter's last live run — deliberately NOT by assuming the job ran on
 * time, because the schedule is an operator-editable setting and the process
 * can be down.
 *
 * Every way of getting this wrong is silent. Anchoring a period to boot instead
 * of to local midnight makes "hourly" mean "some minute past some hour" and
 * moves after every restart. Deriving dueness from the schedule rather than the
 * clock emits a daily tick every ten minutes, or never emits it at all after a
 * gap. In each case the job's own run history says success, and the subscriber
 * that stopped hearing anything says nothing whatsoever.
 */
import { describe, expect, it } from "vitest";

import {
  TICK_PERIODS,
  ticksDue,
  tickSlotStart,
} from "../../server/plugins/system/cron/tick";

/** Local wall-clock time today, the way an operator would say it. */
function at(hours: number, minutes: number, day = 15): Date {
  return new Date(2026, 8, day, hours, minutes, 0, 0);
}

function periodsDue(now: Date, since: Date | null): string[] {
  return ticksDue(now, since).map((tick) => tick.spec.period);
}

describe("tick alignment", () => {
  it("anchors every period at local midnight, not at whenever it was asked", () => {
    for (const spec of TICK_PERIODS) {
      const start = tickSlotStart(at(13, 37), spec.minutes);
      const minutesIn = start.getHours() * 60 + start.getMinutes();
      expect(minutesIn % spec.minutes).toBe(0);
      expect(start.getSeconds()).toBe(0);
    }
  });

  it("means the obvious wall-clock boundaries", () => {
    expect(tickSlotStart(at(13, 37), 60)).toEqual(at(13, 0));
    expect(tickSlotStart(at(13, 37), 480)).toEqual(at(8, 0));
    expect(tickSlotStart(at(13, 37), 1440)).toEqual(at(0, 0));
  });
});

describe("which ticks are due", () => {
  it("emits only the ten minute tick on an ordinary run", () => {
    expect(periodsDue(at(13, 40), at(13, 30))).toEqual(["10m"]);
  });

  it("emits nothing twice for one slot, however often it is asked", () => {
    // A schedule edited to run more often than the finest period: the extra
    // runs are wasted, not doubled.
    expect(periodsDue(at(13, 35), at(13, 30))).toEqual([]);
  });

  it("emits the coarser periods only as each boundary passes", () => {
    expect(periodsDue(at(14, 0), at(13, 50))).toEqual(["10m", "1h", "2h"]);
    expect(periodsDue(at(16, 0), at(15, 50))).toEqual(["10m", "1h", "2h", "4h", "8h"]);
    expect(periodsDue(at(0, 0, 16), at(23, 50, 15))).toEqual([
      "10m",
      "1h",
      "2h",
      "4h",
      "8h",
      "day",
    ]);
  });

  it("gives one catch-up tick per period after a gap, not one per boundary", () => {
    // Down from just before midnight until mid-morning: the day turned over
    // once and eleven hours went by, and each period is owed exactly one tick.
    const due = ticksDue(at(11, 5, 16), at(23, 55, 15));
    expect(due.map((tick) => tick.spec.period)).toEqual([
      "10m",
      "1h",
      "2h",
      "4h",
      "8h",
      "day",
    ]);
  });

  it("stands for the slot it belongs to, not the moment it was worked out", () => {
    // What a catch-up tick reports is the boundary, so a subscriber recording
    // what it has done for a period is not at the mercy of when the emitter
    // got round to it.
    const [tenMinutes] = ticksDue(at(11, 5, 16), at(23, 55, 15));
    expect(tenMinutes.slotStartedAt).toEqual(at(11, 0, 16));
  });

  it("emits every period when there is no previous run to compare against", () => {
    // A fresh database, or a job whose run history has aged out. Emitting
    // nothing here would swallow the coarse periods for up to a day.
    expect(periodsDue(at(13, 37), null)).toEqual(["10m", "1h", "2h", "4h", "8h", "day"]);
  });
});
