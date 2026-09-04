/**
 * The migration time-zone contract — the ONE place the S1→S2 pipeline decides
 * what zone it is allowed to run in, and the evidence every run carries.
 *
 * WHY A PINNED ZONE
 *
 * S2 stores its core timestamps in `timestamp without time zone` columns. The
 * wall clock in such a column MEANS whatever zone the writing/reading process
 * runs in (`server/config/system-timezone.ts`): the app applies `TZ` at boot,
 * `pg` serializes every JS Date in that zone, and the pool aligns each DB
 * session to it so `now()` defaults agree. A loader is just another writer of
 * those columns — so a loader running in a different zone from the app writes
 * every migrated instant (payment dates, ledger dates, comm/note timestamps,
 * last-login, cardcheck signatures) 7–8 hours away from where the app will
 * read it. Nothing throws; the rows simply mean something else.
 *
 * The agreed S2 system zone for this fund is `America/Los_Angeles` — the same
 * zone S1's Drupal ran in (`date_default_timezone`, 06 §5), so an S1 "LA wall
 * time" value and an S2 stored wall clock are the same kind of thing. That
 * pin is a fund decision recorded in RUNBOOK §1 and 03-transformations; it is
 * not a per-run option and there is deliberately NO override flag here.
 *
 * WHAT THE CONTRACT SAYS (per S1 date category — 06 §5 rulings unchanged)
 *
 *   date-only (dob, coverage start/end, policy/rate effective dates …)
 *     → a `YYYY-MM-DD` STRING end to end (`toYmd`); no Date ever touches it,
 *       so no zone can move it onto the day before/after.
 *   LA wall clock (`tz_handling: none`, e.g. payperiod date_start)
 *     → read literally (`yearMonthOf`, `toYmd`); the calendar fields ARE the
 *       answer. Never parsed with `new Date("YYYY-MM-DD HH:MM:SS")`, which
 *       would interpret them in the host zone.
 *   UTC-stored (`tz_handling: site`, e.g. payment datetime_created)
 *     → parsed as an explicit UTC instant (`parseUtcInstant`, trailing `Z`)
 *       and handed to storage as a Date; pg then stores its LA wall clock,
 *       which the LA-pinned app reads back as the same instant.
 *   epoch seconds (node.created/changed, ledger_ts, user login …)
 *     → an instant (`new Date(epoch * 1000)`) when the target is a timestamp
 *       column; an LA calendar date (`epochToLaYmd`/`laStatementYmd`) when the
 *       target is a fund-calendar bucket; a UTC date (`epochToYmd`) ONLY for
 *       the documented end-dating conventions that were ruled that way.
 *
 * SYSTEM zone vs USER zone: S2 also has per-user display zones (see
 * `shared/utils/timezone.ts`). Those are a DISPLAY concern only. The staged
 * S1 `users.timezone` column is carried as source data and validated as an
 * IANA name for the report, but no loader reads it and nothing here consults
 * it — the ETL and every fund-calendar computation use the pinned system
 * zone and nothing else (a test enforces the "no loader reads it" half).
 *
 * THE GATE
 *
 * `assertMigrationTimeZone()` resolves the zone EXACTLY the way the app boots
 * (deployment `TZ` wins, else the target's stored `ENV_TZ` override row),
 * applies it to this process, and then refuses to continue unless the runtime
 * zone, the target's stored override (if any) and the database SESSION zone
 * all equal the pinned zone. It runs from `ensureStagingSchema()` — the first
 * call of every stage/loader/verify/sync entrypoint — so no migration process
 * touches the target before the zone is proven. The evidence it returns is
 * aggregate runtime facts only (zone names, offsets, versions) and is
 * embedded in every loader envelope and the sync aggregate report so a
 * mismatched historical run can be diagnosed from `s1_staging.runs` alone.
 */
import { sql } from "drizzle-orm";
import { db } from "../../../server/storage/db";
import { applySystemTimeZone } from "../../../server/config/system-timezone";
import { getEnvironmentVariable, isEnvironmentVariableSetInProcess } from "../../../server/config/env-registry";
import { peekEnvOverride } from "../../../server/services/env-overrides";
import {
  getRuntimeTimeZone,
  getTimeZoneOffsetMinutes,
  isValidTimeZone,
} from "../../../shared/utils/timezone";

import { MIGRATION_SYSTEM_TIME_ZONE } from "./timezone-pin";

/** The agreed S2 system zone for this fund (RUNBOOK §1, 03-transformations). */
export { MIGRATION_SYSTEM_TIME_ZONE };

/**
 * Two fixed instants — deep standard time and deep daylight time — whose
 * offsets fingerprint the zone's DST rules. "America/Los_Angeles",
 * "PST8PDT", "Etc/GMT+8" and "America/Phoenix" all LOOK Pacific-ish on the
 * wrong day of the year; the pair tells them apart in a report.
 */
export const OFFSET_PROBES = {
  standard: "2026-01-15T12:00:00Z",
  daylight: "2026-07-15T12:00:00Z",
} as const;

export type TimeZoneSource = "environment" | "override" | "unset";

/** Aggregate runtime evidence — zone names, offsets, versions. Never data. */
export interface TimeZoneEvidence {
  /** The pinned zone every check compares against. */
  expected: string;
  /** What `Intl` says this process is running in (after the apply step). */
  runtimeTimeZone: string;
  /** Where the configured zone came from — deployment env, the target's stored
   * override row, or nowhere (container default). */
  source: TimeZoneSource;
  /** The configured value as supplied (may be an alias or garbage — that is
   * what the report needs to show). Null when nothing configured it. */
  configured: string | null;
  /** The target's `ENV_TZ` override row: the zone the APP would boot into on
   * this database when its deployment does not set TZ. Null = no row. */
  storedOverride: string | null;
  /** `current_setting('TimeZone')` on a pool session (the pool's checkout
   * hook is supposed to have aligned it). Null = not probed. */
  dbSessionTimeZone: string | null;
  /** Offset (minutes east of UTC) of the RUNTIME zone at each probe. */
  runtimeOffsets: { standard: number; daylight: number };
  /** Offset of the EXPECTED zone at each probe — the values a healthy run
   * shows, so a report is self-describing. */
  expectedOffsets: { standard: number; daylight: number };
  node: string;
  icu: string | null;
  tz: string | null; // Node's bundled tzdata version
}

/** A gate failure. Named so callers/operators can tell it from a DB error. */
export class MigrationTimeZoneError extends Error {
  constructor(
    public readonly violations: string[],
    public readonly evidence: TimeZoneEvidence,
  ) {
    super(
      `S1 migration time zone gate FAILED (nothing was written):\n` +
        violations.map((v) => `  - ${v}`).join("\n") +
        `\n  evidence: ${JSON.stringify(evidence)}` +
        `\n  Fix: pin TZ=${evidence.expected} for this process (RUNBOOK §1 "Time zone pin") and re-run.`,
    );
    this.name = "MigrationTimeZoneError";
  }
}

function offsetsOf(zone: string): { standard: number; daylight: number } {
  return {
    standard: getTimeZoneOffsetMinutes(zone, new Date(OFFSET_PROBES.standard)),
    daylight: getTimeZoneOffsetMinutes(zone, new Date(OFFSET_PROBES.daylight)),
  };
}

/**
 * PURE verdict over collected evidence. Kept separate from collection so the
 * rejection rules are unit-testable with fabricated evidence (a deliberately
 * wrong runtime zone, a stale override row, a session the hook missed).
 *
 * Every rule is an equality against the pin — no alias tolerance. "US/Pacific"
 * resolves to the same rules today, but a report reader should never have to
 * know that, and `Intl` reports the canonical name for the runtime anyway.
 */
export function evaluateTimeZoneEvidence(e: TimeZoneEvidence): string[] {
  const v: string[] = [];
  if (e.runtimeTimeZone !== e.expected) {
    v.push(
      `process is running in "${e.runtimeTimeZone}" (configured: ${e.configured ?? "nothing"} via ${e.source}); ` +
        `the S2 system zone is pinned to "${e.expected}"`,
    );
  }
  if (e.source === "unset") {
    v.push(
      `no time zone is configured — the zone must be pinned EXPLICITLY (TZ in the environment or the target's ENV_TZ row), ` +
        `never inherited from the container`,
    );
  }
  if (e.storedOverride != null && e.storedOverride !== e.expected) {
    v.push(
      `the target database carries an ENV_TZ override of "${e.storedOverride}" — the app would boot into that zone on this ` +
        `database and read every migrated timestamp shifted; clear or correct the row before loading`,
    );
  }
  if (e.dbSessionTimeZone != null && e.dbSessionTimeZone !== e.expected) {
    v.push(
      `database session TimeZone is "${e.dbSessionTimeZone}", not "${e.expected}" — column defaults (now()) would land ` +
        `offset from loader-written timestamps (pool checkout hook did not align the session)`,
    );
  }
  if (
    e.runtimeOffsets.standard !== e.expectedOffsets.standard ||
    e.runtimeOffsets.daylight !== e.expectedOffsets.daylight
  ) {
    v.push(
      `runtime DST fingerprint ${JSON.stringify(e.runtimeOffsets)} differs from the pinned zone's ` +
        `${JSON.stringify(e.expectedOffsets)} — the runtime's tz database does not agree with the pin`,
    );
  }
  return v;
}

let memo: Promise<TimeZoneEvidence> | null = null;

/**
 * Resolve, apply, probe, judge. Memoized per process: the first caller (always
 * `ensureStagingSchema`) pays for the probes; later callers get the same
 * evidence. Throws {@link MigrationTimeZoneError} — callers must NOT catch it.
 */
export function assertMigrationTimeZone(): Promise<TimeZoneEvidence> {
  if (!memo) {
    memo = (async () => {
      const evidence = await collectTimeZoneEvidence();
      const violations = evaluateTimeZoneEvidence(evidence);
      if (violations.length > 0) throw new MigrationTimeZoneError(violations, evidence);
      return evidence;
    })().catch((err) => {
      memo = null; // a failed probe (DB down) must not poison a retry in-process
      throw err;
    });
  }
  return memo;
}

/**
 * The evidence for reports, or null when the gate has not run in this
 * process (dev seeds and smokes that never call ensureStagingSchema).
 * Synchronous so `buildLoaderResult` can embed it without becoming async.
 */
let lastEvidence: TimeZoneEvidence | null = null;
export function getTimeZoneEvidence(): TimeZoneEvidence | null {
  return lastEvidence;
}

async function collectTimeZoneEvidence(): Promise<TimeZoneEvidence> {
  // Source must be read BEFORE applying: the apply step plants the value into
  // the process environment either way and the distinction is gone after it.
  const fromEnvironment = isEnvironmentVariableSetInProcess("TZ");
  // The same fallback app boot uses (server/app-init.ts): a direct row read,
  // fail-soft — no row / no table / DB down all read as "no stored override".
  const storedOverride = (await peekEnvOverride("TZ"))?.trim() || null;

  let configured: string | null = null;
  let source: TimeZoneSource = "unset";
  try {
    const applied = applySystemTimeZone(() => storedOverride ?? undefined);
    if (applied.configured) {
      source = fromEnvironment ? "environment" : "override";
      configured = fromEnvironment ? readConfiguredTz() : storedOverride;
    }
  } catch (err) {
    // applySystemTimeZone throws on an unrecognised name — that IS the
    // evidence; record the bad value and let the verdict name it.
    configured = fromEnvironment ? readConfiguredTz() : storedOverride;
    source = fromEnvironment ? "environment" : storedOverride ? "override" : "unset";
    void err;
  }

  const runtimeTimeZone = getRuntimeTimeZone();
  const dbSessionTimeZone = await probeSessionTimeZone();
  const expected = MIGRATION_SYSTEM_TIME_ZONE;
  const versions = process.versions as Record<string, string | undefined>;
  const evidence: TimeZoneEvidence = {
    expected,
    runtimeTimeZone,
    source,
    configured,
    storedOverride,
    dbSessionTimeZone,
    runtimeOffsets: isValidTimeZone(runtimeTimeZone) ? offsetsOf(runtimeTimeZone) : { standard: NaN, daylight: NaN },
    expectedOffsets: offsetsOf(expected),
    node: process.version,
    icu: versions.icu ?? null,
    tz: versions.tz ?? null,
  };
  lastEvidence = evidence;
  return evidence;
}

function readConfiguredTz(): string | null {
  return getEnvironmentVariable("TZ")?.trim() || null;
}

/**
 * What a checked-out session believes its zone is. Goes through the SAME pool
 * the loaders write with, so the checkout hook that is supposed to align the
 * session has had its chance (its SET is queued ahead of this query on the
 * same client). A probe failure is a DB failure — let it surface.
 */
async function probeSessionTimeZone(): Promise<string | null> {
  const res = (await db.execute(sql`SELECT current_setting('TimeZone') AS tz`)) as unknown as {
    rows: Array<{ tz: string | null }>;
  };
  return res.rows[0]?.tz ?? null;
}
