import { logger } from "../logger";
import { isMaintenanceActive } from "./maintenance-flag";

export type StartupOperation = () => Promise<void>;

const deferredOperations = new Map<string, StartupOperation>();
let draining: Promise<void> | null = null;

/**
 * Run a named boot-time database reconciliation, unless the database was
 * already placed in maintenance. Registration and other in-memory setup must
 * happen outside this boundary.
 *
 * Outside maintenance the operation is awaited normally and any failure is
 * fatal to startup. In maintenance it is retained for the live exit path and
 * also naturally retried by the next normal boot.
 */
export async function runOrDeferStartupOperation(
  name: string,
  operation: StartupOperation,
): Promise<"completed" | "deferred"> {
  if (!isMaintenanceActive()) {
    await operation();
    logger.info("Startup reconciliation completed", {
      source: "startup-reconciliation",
      operation: name,
    });
    return "completed";
  }

  deferredOperations.set(name, operation);
  logger.warn("Startup reconciliation deferred while maintenance is active", {
    source: "startup-reconciliation",
    operation: name,
    maintenanceActive: true,
  });
  return "deferred";
}

/**
 * Retry work deferred by a maintenance boot after maintenance ends.
 *
 * This runs in the system_mode onWrite path, so the administrator does not
 * need to restart the process or perform a second recovery step. Failures are
 * reported and retained for the next exit/boot; they cannot retroactively make
 * the already-committed system_mode write unsuccessful.
 */
export async function runDeferredStartupOperations(): Promise<void> {
  if (isMaintenanceActive() || deferredOperations.size === 0) return;
  if (draining) return draining;

  draining = (async () => {
    for (const [name, operation] of Array.from(deferredOperations.entries())) {
      if (isMaintenanceActive()) {
        logger.warn("Deferred startup reconciliation paused; maintenance is active again", {
          source: "startup-reconciliation",
          remainingOperations: deferredOperations.size,
        });
        break;
      }
      try {
        await operation();
        deferredOperations.delete(name);
        logger.info("Deferred startup reconciliation completed", {
          source: "startup-reconciliation",
          operation: name,
        });
      } catch (error) {
        logger.error("Deferred startup reconciliation failed", {
          source: "startup-reconciliation",
          operation: name,
          error: error instanceof Error ? error.message : String(error),
          willRetry: "next maintenance exit or normal boot",
        });
      }
    }
  })().finally(() => {
    draining = null;
  });

  return draining;
}

export function getDeferredStartupOperationNames(): string[] {
  return Array.from(deferredOperations.keys());
}

/** Test-only reset for this process-local boot queue. */
export function resetStartupDeferralsForTest(): void {
  if (draining) {
    throw new Error("Cannot reset startup deferrals while a drain is in progress");
  }
  deferredOperations.clear();
}