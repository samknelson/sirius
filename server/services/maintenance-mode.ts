/**
 * Maintenance-mode write lock (Task #999).
 *
 * When `system_mode` is "maintenance", every database connection the app
 * checks out of the pool gets `SET default_transaction_read_only = on`, so
 * ALL writes — routes, crons, the event-bus pump, background workers — fail
 * with a Postgres "cannot execute ... in a read-only transaction" error
 * (SQLSTATE 25006), enforced by the connection itself rather than per-route
 * code. Reads are unaffected, so the site stays browsable.
 *
 * Enforcement rides the pool's awaited checkout handoff, on EVERY
 * checkout (new or reused connection). The SET finishes before the client
 * is handed to whatever query triggered the checkout, so
 * each checkout reflects the CURRENT flag — including connections that were
 * checked out (and therefore untouchable) at the moment the mode changed:
 * they get corrected the next time they are acquired. A connection mid-query
 * during the transition finishes its current work in its old state; the lock
 * takes effect promptly, not atomically.
 *
 * Enforcement is armed ONLY from the shared boot path (`bootstrapApp` →
 * `armMaintenanceEnforcement`), never at db-module load. Standalone scripts
 * (`tsx scripts/...`) import `server/storage/db` directly without
 * bootstrapping, so their connections never get the read-only setting —
 * by design: maintenance mode exists precisely so operators can run major
 * imports/migrations while the app is locked.
 *
 * The ONLY sanctioned escape is `allowInMaintenanceMode` in
 * `server/storage/maintenance.ts` (SET LOCAL, scoped to one transaction).
 *
 * The write lock is only half of maintenance mode. The flag itself lives in
 * `server/services/maintenance-flag.ts` — a module with no runtime imports —
 * so the vendor wrappers can guard their outbound calls off the SAME boolean
 * without importing the connection pool. This module owns loading and
 * refreshing that flag; that module owns the refusal (Task #1338).
 */
import { registerPoolCheckoutInitializer } from "../storage/db";
import { logger } from "../logger";
import { getSystemMode, isMaintenanceMode } from "./system-mode";
import { isMaintenanceActive, setMaintenanceActive } from "./maintenance-flag";
import { readConfigurationSnapshot } from "../storage/configuration-revisions";
import { runOutsideTransaction } from "../storage/transaction-context";

let armed = false;
let generation = 0;
export function invalidateMaintenanceSnapshot(): void { generation++; }

/** Tracks the read-only state last applied to each pooled connection. */
const APPLIED_READ_ONLY = Symbol("maintenanceReadOnlyApplied");

export { isMaintenanceActive };

/** Set the in-memory flag; enforcement is applied per-checkout (see above). */
function applyMaintenanceFlag(active: boolean): void {
  if (!setMaintenanceActive(active)) return;
  logger.info(
    `Maintenance mode ${active ? "ENTERED — database writes locked, external services refused" : "exited — database writes and external services restored"}`,
    { source: "maintenance-mode" },
  );
}

/**
 * Re-read `system_mode` and apply the maintenance flag. Called from the
 * variable registry's onWrite hook after a system_mode write commits.
 */
export async function refreshMaintenanceFlag(waitForDeferred = true): Promise<void> {
  if (!armed) return; // scripts / pre-boot: enforcement not armed, nothing to apply
  const current = ++generation;
  // An outage must NEVER be interpreted as permission to exit maintenance.
  const mode = await readConfigurationSnapshot(() => getSystemMode(true));
  if (current !== generation) return;
  applyMaintenanceFlag(isMaintenanceMode(mode));
  if (!isMaintenanceActive()) {
    const { runDeferredStartupOperations } = await import("./boot/startup-deferrals");
    const deferred = runOutsideTransaction(() => runDeferredStartupOperations());
    // Deferred boot repairs are separate work, not an infrastructure poll.
    // They retain their own failure queue and cannot stall revision observation.
    if (waitForDeferred) await deferred;
    else void deferred.catch(error => logger.warn("Deferred startup retry failed", {
      source: "maintenance-mode", error: String(error),
    }));
  }
}

/**
 * Arm connection-level read-only enforcement. Called ONCE from
 * `bootstrapApp`; loads the current mode and installs the awaited checkout
 * hook. Safe to call again (no-op).
 */
export async function armMaintenanceEnforcement(): Promise<void> {
  if (armed) return;
  armed = true;

  // Every checkout: (re)apply the session default when it differs from the
  // desired state. New connections start with the server default (off), so
  // only maintenance entries/exits and fresh connections during maintenance
  // pay the extra round-trip; steady state is a no-op property check.
  registerPoolCheckoutInitializer(async (client: any) => {
    const desired = isMaintenanceActive();
    const current: boolean = client[APPLIED_READ_ONLY] ?? false;
    if (current === desired) return;
    try {
      await client.query(`SET default_transaction_read_only = ${desired ? "on" : "off"}`);
      client[APPLIED_READ_ONLY] = desired;
    } catch (error) {
      client[APPLIED_READ_ONLY] = undefined;
      // Fail the checkout and discard the connection, never lend a writable
      // client while the shared vendor-refusal flag says maintenance is on.
      throw error;
    }
  });

  const mode = await readConfigurationSnapshot(() => getSystemMode(true));
  if (isMaintenanceMode(mode)) {
    applyMaintenanceFlag(true);
  }
  logger.info("Maintenance-mode enforcement armed", {
    source: "startup",
    maintenanceActive: isMaintenanceActive(),
  });
}
