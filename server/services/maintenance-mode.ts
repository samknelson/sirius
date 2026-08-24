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
 * Enforcement rides the pool's `acquire` event, which fires on EVERY
 * checkout (new or reused connection). The SET issued in the handler is
 * queued on the client ahead of whatever query triggered the checkout, so
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
 */
import { pool } from "../storage/db";
import { logger } from "../logger";
import { getSystemMode, isMaintenanceMode } from "./system-mode";

let maintenanceActive = false;
let armed = false;

/** Tracks the read-only state last applied to each pooled connection. */
const APPLIED_READ_ONLY = Symbol("maintenanceReadOnlyApplied");

/** Current in-memory maintenance flag (loaded at boot, refreshed on writes). */
export function isMaintenanceActive(): boolean {
  return maintenanceActive;
}

/** Set the in-memory flag; enforcement is applied per-checkout (see above). */
function applyMaintenanceFlag(active: boolean): void {
  if (maintenanceActive === active) return;
  maintenanceActive = active;
  logger.info(
    `Maintenance mode ${active ? "ENTERED — database writes locked" : "exited — database writes restored"}`,
    { source: "maintenance-mode" },
  );
}

/**
 * Re-read `system_mode` and apply the maintenance flag. Called from the
 * variable registry's onWrite hook after a system_mode write commits.
 */
export async function refreshMaintenanceFlag(): Promise<void> {
  if (!armed) return; // scripts / pre-boot: enforcement not armed, nothing to apply
  const mode = await getSystemMode();
  applyMaintenanceFlag(isMaintenanceMode(mode));
}

/**
 * Arm connection-level read-only enforcement. Called ONCE from
 * `bootstrapApp`; loads the current mode and installs the pool `acquire`
 * hook. Safe to call again (no-op).
 */
export async function armMaintenanceEnforcement(): Promise<void> {
  if (armed) return;
  armed = true;

  // Every checkout: (re)apply the session default when it differs from the
  // desired state. New connections start with the server default (off), so
  // only maintenance entries/exits and fresh connections during maintenance
  // pay the extra round-trip; steady state is a no-op property check.
  pool.on("acquire", (client: any) => {
    const desired = maintenanceActive;
    const current: boolean = client[APPLIED_READ_ONLY] ?? false;
    if (current === desired) return;
    client[APPLIED_READ_ONLY] = desired;
    client
      .query(`SET default_transaction_read_only = ${desired ? "on" : "off"}`)
      .catch((error: unknown) => {
        // Unknown state: clear the marker so the next acquire retries.
        client[APPLIED_READ_ONLY] = undefined;
        logger.error("Failed to apply read-only state on pool checkout", {
          source: "maintenance-mode",
          desired,
          error: error instanceof Error ? error.message : String(error),
        });
      });
  });

  const mode = await getSystemMode();
  if (isMaintenanceMode(mode)) {
    applyMaintenanceFlag(true);
  }
  logger.info("Maintenance-mode enforcement armed", {
    source: "startup",
    maintenanceActive,
  });
}
