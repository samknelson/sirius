/**
 * When a dispatch job counts as already started.
 *
 * The job's start moment lives in two naive columns — a date and an optional
 * wall-clock time — which mean whatever the process time zone says they mean.
 * Every way of getting this wrong is quiet: reading them as UTC still produces
 * a plausible instant, still type-checks, and only misjudges the cut-off by the
 * site's offset, which is invisible unless a test pins the two interpretations
 * against each other. So the expectations below are written as relations
 * between instants the suite builds locally, never as absolute timestamps, and
 * they hold under whatever zone the suite runs in.
 */
import { describe, expect, it } from "vitest";

import {
  dispatchStartedPlugin,
  hasJobStartMomentPassed,
} from "../../server/plugins/dispatch/eligibility/plugins/started";
import type { EligibilityQueryContext } from "../../server/plugins/dispatch/eligibility/registry";

function hasPassed(params: {
  startYmd?: string | Date | null;
  startTime?: string | null;
  gracePeriodMinutes?: number;
  missingStartTime?: "start_of_day" | "end_of_day";
  now: Date;
}): boolean {
  return hasJobStartMomentPassed({
    startYmd: params.startYmd === undefined ? "2026-03-10" : params.startYmd,
    startTime: params.startTime === undefined ? "08:00:00" : params.startTime,
    gracePeriodMinutes: params.gracePeriodMinutes ?? 0,
    missingStartTime: params.missingStartTime ?? "end_of_day",
    now: params.now,
  });
}

/** The job's wall clock as an instant in the zone the process runs in. */
function localMoment(hours: number, minutes = 0, seconds = 0, ms = 0): Date {
  return new Date(2026, 2, 10, hours, minutes, seconds, ms);
}

describe("the start moment itself", () => {
  it("has not passed a moment before the start time", () => {
    expect(hasPassed({ now: new Date(localMoment(8).getTime() - 1) })).toBe(false);
  });

  it("has passed exactly at the start time", () => {
    expect(hasPassed({ now: localMoment(8) })).toBe(true);
  });

  it("stays passed afterwards", () => {
    expect(hasPassed({ now: localMoment(23, 59) })).toBe(true);
  });

  it("reads a start date supplied as a Date or an ISO-ish string, not just a Ymd", () => {
    for (const startYmd of [
      new Date(2026, 2, 10, 0, 0, 0, 0),
      "2026-03-10T00:00:00.000Z",
      "2026-03-10 00:00:00",
    ] as Array<string | Date>) {
      expect(hasPassed({ startYmd, now: new Date(localMoment(8).getTime() - 1) })).toBe(false);
      expect(hasPassed({ startYmd, now: localMoment(8) })).toBe(true);
    }
  });

  it("stays out of the way when there is no usable start date", () => {
    expect(hasPassed({ startYmd: null, now: localMoment(23, 59) })).toBe(false);
  });
});

describe("the grace period", () => {
  it("keeps the job open for that many minutes after it starts", () => {
    const grace = 30;
    expect(hasPassed({ gracePeriodMinutes: grace, now: localMoment(8, 29, 59) })).toBe(false);
    expect(hasPassed({ gracePeriodMinutes: grace, now: localMoment(8, 30) })).toBe(true);
  });

  it("closes the job early when it is negative", () => {
    const grace = -15;
    expect(hasPassed({ gracePeriodMinutes: grace, now: localMoment(7, 44, 59) })).toBe(false);
    expect(hasPassed({ gracePeriodMinutes: grace, now: localMoment(7, 45) })).toBe(true);
  });
});

describe("a job with no start time", () => {
  it("stays open all day when time-less jobs mean end of day", () => {
    expect(
      hasPassed({ startTime: null, missingStartTime: "end_of_day", now: localMoment(23, 59, 59, 998) }),
    ).toBe(false);
    expect(
      hasPassed({ startTime: null, missingStartTime: "end_of_day", now: localMoment(23, 59, 59, 999) }),
    ).toBe(true);
  });

  it("is closed from midnight when time-less jobs mean start of day", () => {
    expect(
      hasPassed({ startTime: null, missingStartTime: "start_of_day", now: new Date(localMoment(0).getTime() - 1) }),
    ).toBe(false);
    expect(
      hasPassed({ startTime: null, missingStartTime: "start_of_day", now: localMoment(0) }),
    ).toBe(true);
  });
});

describe("which zone the naive columns are read in", () => {
  it("judges the moment in system time, so a UTC reading of 08:00 does not decide it", () => {
    const systemBoundary = localMoment(8);
    // What the cut-off would be if the naive columns were read as UTC. On any
    // site whose zone is not UTC these two instants differ, and the probes at
    // the UTC one are exactly where a UTC misreading would answer differently.
    const utcBoundary = new Date(Date.UTC(2026, 2, 10, 8, 0, 0, 0));

    for (const now of [
      new Date(systemBoundary.getTime() - 1),
      systemBoundary,
      new Date(utcBoundary.getTime() - 1),
      utcBoundary,
    ]) {
      expect(hasPassed({ now })).toBe(now.getTime() >= systemBoundary.getTime());
    }
  });
});

describe("what the plugin contributes to the query", () => {
  function conditionFor(job: { startYmd: string; startTime: string | null }, config: Record<string, unknown>) {
    const context = { job } as unknown as EligibilityQueryContext;
    return dispatchStartedPlugin.getEligibilityCondition(context, config);
  }

  it("contributes nothing while the job is still open", () => {
    expect(conditionFor({ startYmd: "2999-01-01", startTime: "08:00:00" }, {})).toBeNull();
  });

  it("contributes a condition naming the configured grace period once it has started", () => {
    const condition = conditionFor({ startYmd: "2000-01-01", startTime: "08:00:00" }, {
      gracePeriodMinutes: 30,
    });
    expect(condition).toMatchObject({
      type: "exists",
      failureMessage: "The job's start time (with a grace period of 30 minutes) has passed",
    });
  });
});
