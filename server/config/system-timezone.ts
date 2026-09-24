/**
 * The system time zone — the zone the server process runs in.
 *
 * WHY THIS IS A PROCESS SETTING AND NOT A PARAMETER
 *
 * The core tables store `timestamp without time zone`. That column holds a
 * wall-clock reading with no offset attached, so what it MEANS is decided
 * entirely by the zone of whatever process writes and reads it. Setting `TZ`
 * is therefore not a shortcut around a proper design — it is the mechanism the
 * existing schema already assumes. One assignment fixes day boundaries, cron
 * schedules and all server-side formatting at once, with no call-site changes
 * anywhere.
 *
 * THE COST, WHICH IS ACCEPTED
 *
 * Changing this value re-interprets every stored timestamp by the offset
 * between the old zone and the new one. Nothing is rewritten; the same wall
 * clock simply now means a different instant. That is understood and accepted
 * (owner decision) on the basis that a site sets its zone once at installation
 * and effectively never moves it. Do NOT "fix" this by converting columns to
 * `timestamptz` or threading a zone through the storage layer — that was
 * priced out and rejected.
 *
 * A second cost follows from any zone that observes DST: on the fall-back day
 * the repeated hour is stored twice with identical wall-clock values, and rows
 * written in it cannot be told apart or ordered. This recurs annually. It is
 * accepted as small here.
 *
 * THE DATABASE MUST AGREE
 *
 * A column default of `now()` is evaluated by POSTGRES, in the SESSION time
 * zone — not by Node. If the two disagree, timestamps the application writes
 * and timestamps a column default writes land in the same column offset from
 * each other, which is far nastier than both being uniformly "wrong". The pool
 * keeps every session aligned with this zone on checkout; see
 * `server/storage/db.ts`.
 */
import {
  getEnvironmentVariable,
  isEnvironmentVariableSetInProcess,
  setEnvironmentVariable,
} from "./env-registry";
import { getRuntimeTimeZone, isValidTimeZone } from "@shared/utils/timezone";

/**
 * The zone the process is ACTUALLY running in.
 *
 * Deliberately asks the runtime rather than reading the variable back: when
 * TZ is unset the honest answer is the container's zone (usually UTC), not
 * "nothing configured", and every consumer — the API response, the settings
 * screen, the database session — needs the effective answer.
 */
export function getSystemTimeZone(): string {
  return getRuntimeTimeZone();
}

export interface AppliedSystemTimeZone {
  /** The zone in force after this call. */
  zone: string;
  /** Whether a configured value was found (false = container default). */
  configured: boolean;
  /** Whether this call actually moved the process zone. */
  changed: boolean;
}

/**
 * Resolve the configured zone and apply it to the process.
 *
 * Throws on an unrecognised zone name. That is the whole point of validating:
 * Node silently ignores an invalid TZ and leaves the process on UTC, so an
 * operator who fat-fingers "America/New York" would get a working site that is
 * quietly hours out — writing every timestamp in the wrong zone for as long as
 * it takes someone to notice. A named boot failure is far cheaper than that.
 *
 * Safe to call more than once, and it is called twice on purpose: once before
 * the database is reachable, so the earliest writes already run in the right
 * zone when TZ comes from the real environment, and again once the in-app
 * override cache has loaded, since the value may live in the database.
 */
export function applySystemTimeZone(
  /**
   * Consulted only when the environment does not supply TZ, preserving the
   * registry's precedence rule that a real environment value always wins.
   * Boot passes a direct read of the stored override here, because the
   * override cache is not installed until long after the first rows are
   * written.
   */
  fallback?: () => string | undefined,
): AppliedSystemTimeZone {
  // WHICH of the two sources supplied the zone has to be carried into the
  // write, because the write itself erases the distinction: after it, TZ is in
  // the process environment either way. Asking whether the variable is set in
  // the REAL environment is the question that survives repeat calls — on the
  // second pass the value this function planted is already sitting there, and
  // a plain read would report a stored zone as a deployment one.
  const fromEnvironment = isEnvironmentVariableSetInProcess("TZ")
    ? getEnvironmentVariable("TZ")?.trim() || undefined
    : undefined;
  // Not supplied by the deployment: the zone comes from the in-app store,
  // either through the override cache (a plain read reaches it) or, at first
  // boot, through the direct row read the caller passes in.
  const fromStore = fromEnvironment
    ? undefined
    : getEnvironmentVariable("TZ")?.trim() || fallback?.()?.trim() || undefined;
  const configured = fromEnvironment ?? fromStore;

  if (!configured) {
    return { zone: getRuntimeTimeZone(), configured: false, changed: false };
  }

  if (!isValidTimeZone(configured)) {
    throw new Error(
      `TZ is set to "${configured}", which is not a time zone this runtime recognises. ` +
        `Use an IANA name such as "America/New_York" or "UTC". Refusing to start: an ` +
        `unrecognised zone is silently ignored by the runtime, which would leave the site ` +
        `running in UTC while appearing to be configured otherwise.`,
    );
  }

  const before = getRuntimeTimeZone();
  // Through the registry's sanctioned boot-time writer: only the registry
  // module may reach the process environment directly (enforced by
  // scripts/dev/check-env-registry.ts). Writing it into the environment —
  // rather than only remembering it here — is the entire mechanism: Date,
  // Intl and node-cron all read the zone from there.
  setEnvironmentVariable("TZ", configured, fromEnvironment ? "environment" : "override");
  const after = getRuntimeTimeZone();

  return { zone: after, configured: true, changed: after !== before };
}
