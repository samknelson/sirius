/**
 * The maintenance-mode flag, and the ONE refusal every outbound vendor call
 * goes through (Task #1338).
 *
 * Maintenance mode used to mean only "the database is read-only" (see
 * `server/services/maintenance-mode.ts`). That stops writes, but it does not
 * stop side effects that leave the building: an SMS, an email, a physical
 * letter, a metered Google geocode. None of those can be rolled back when
 * maintenance ends, so while `system_mode` is "maintenance" every server-side
 * call to Twilio, SendGrid, Lob and Google is refused before it happens.
 *
 * This module deliberately has NO runtime imports. The flag used to live next
 * to the connection-pool hook that arms the write lock; a vendor wrapper that
 * imported it from there would drag the database pool in with it. The pool
 * hook and the vendor wrappers both import the flag from here instead, so the
 * guard and the write lock are always reading the same boolean and can never
 * disagree about whether maintenance is on.
 *
 * The flag is in-memory and boot-armed: `armMaintenanceEnforcement` loads it
 * once and the `system_mode` write hook refreshes it, so entering and leaving
 * maintenance flips the refusal live, with no restart and no per-call database
 * read. Standalone scripts (`tsx scripts/...`) never arm it, so — exactly like
 * the write lock — they are unaffected.
 *
 * There is no escape hatch. `allowInMaintenanceMode` unlocks the *database*
 * for the two paths that must keep working (sessions, and the write that
 * exits maintenance); nothing unlocks an external vendor, because during
 * maintenance those services are simply unavailable.
 */
import type { Response } from "express";

/**
 * The external systems this guard covers.
 *
 * Four of them are billed, and that is the original reason for the guard: an
 * SMS, an email, a letter or a metered geocode cannot be rolled back when
 * maintenance ends. The rest are here for two other reasons.
 *
 * "Census" is free and has no side effect at all — it is named because the web
 * client framework refuses every call it is about to make through this one
 * guard, and a service the framework can name has to be a service the guard
 * knows. Keeping the two lists one list is the whole point of
 * `WcService = ExternalService`.
 *
 * The site-specific integrations are named because somebody else's system is
 * still somebody else's system: a request to it during maintenance happens
 * outside this database and does not roll back either.
 *
 * The name is what an operator reads in the refusal, so it is the system's own
 * name.
 */
export type ExternalService =
  | "Twilio"
  | "SendGrid"
  | "Lob"
  | "Google"
  | "Census"
  | "OpenStates"
  | "T631"
  | "Freeman EDLS"
  | "BTU";

let maintenanceActive = false;

/** Current in-memory maintenance flag (loaded at boot, refreshed on writes). */
export function isMaintenanceActive(): boolean {
  return maintenanceActive;
}

/**
 * Set the flag. Called ONLY by `server/services/maintenance-mode.ts`, which
 * owns loading and refreshing it. Returns true when the value changed, so the
 * caller can log the transition exactly once.
 */
export function setMaintenanceActive(active: boolean): boolean {
  if (maintenanceActive === active) return false;
  maintenanceActive = active;
  return true;
}

/**
 * "Service Unavailable" — a refusal is a temporary state of the site, not a
 * bug in the request, and not a vendor outage.
 */
export const MAINTENANCE_REFUSAL_STATUS = 503;

/**
 * The one wording. Every refusal reads the same no matter which vendor or
 * which operation was attempted, so an operator seeing it anywhere in the app
 * recognizes it immediately.
 */
export function maintenanceRefusalMessage(
  service: ExternalService,
  operation: string,
): string {
  return `${service} is unavailable: the site is in maintenance mode (attempted: ${operation}).`;
}

/**
 * The single error type a maintenance refusal throws. Distinguishable from a
 * vendor outage on purpose: callers that fall back to a local implementation
 * when the vendor is unreachable (the address validator) must re-throw this
 * rather than quietly reporting a successful local validation.
 */
export class MaintenanceModeError extends Error {
  readonly service: ExternalService;
  readonly operation: string;
  /** Read by the Express error handler (`err.status || err.statusCode`). */
  readonly status = MAINTENANCE_REFUSAL_STATUS;
  readonly statusCode = MAINTENANCE_REFUSAL_STATUS;

  constructor(service: ExternalService, operation: string) {
    super(maintenanceRefusalMessage(service, operation));
    this.name = "MaintenanceModeError";
    this.service = service;
    this.operation = operation;
  }
}

export function isMaintenanceModeError(
  error: unknown,
): error is MaintenanceModeError {
  return error instanceof MaintenanceModeError;
}

/**
 * The guard. Call it as the FIRST statement of every outbound vendor
 * operation — ahead of credential resolution, and outside the method's own
 * try/catch, so a refusal never touches a secret and never gets converted
 * into an empty list, a "not deliverable" result, or a swallowed warning.
 *
 * `operation` is what was attempted, in plain words ("send SMS",
 * "verify address"), and appears in the message.
 */
export function assertExternalServiceAllowed(
  service: ExternalService,
  operation: string,
): void {
  if (!maintenanceActive) return;
  throw new MaintenanceModeError(service, operation);
}

/**
 * Answer an HTTP request that hit a maintenance refusal, from a `catch` that
 * would otherwise report a generic 500. Returns true when it handled the
 * error, so the call site reads:
 *
 *   if (sendIfMaintenanceRefusal(res, error)) return;
 *
 * Both `message` and `error` carry the text, because the admin screens read
 * one or the other depending on the endpoint.
 */
export function sendIfMaintenanceRefusal(res: Response, error: unknown): boolean {
  if (!isMaintenanceModeError(error)) return false;
  res.status(error.statusCode).json({
    success: false,
    message: error.message,
    error: error.message,
    maintenance: true,
  });
  return true;
}
