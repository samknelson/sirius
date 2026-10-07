import { createInfrastructurePool, db } from "./db";
import { createAdvisoryLockStorage, type AdvisoryLockHandle } from "./advisory-lock";
import { runOutsideTransaction, runWithTransaction } from "./transaction-context";
import { sql } from "drizzle-orm";

// Session leases must not consume the connections used to save results or poll.
// Lazy creation keeps scripts that only use the engine from opening another pool.
let locks: ReturnType<typeof createAdvisoryLockStorage> | undefined;
export async function acquireWizardValidationLock(wizardId: string): Promise<AdvisoryLockHandle | null> {
  locks ??= createAdvisoryLockStorage(createInfrastructurePool({ max: 4 }));
  return locks.tryAcquireSession(`wizard-validation:${wizardId}`, { timeoutMs: 0 });
}

/** A blocked metadata UPDATE must fail, not hold the validation lease forever.
 * SET LOCAL applies only to this write's connection and rolls back on failure.
 * Do not implement this with Promise.race: the uncancelled UPDATE could still
 * commit later after the caller has reported failure or retried. */
export function withWizardValidationWrite<T>(write: () => Promise<T>, timeoutMs = 15_000): Promise<T> {
  const boundedTimeout = Math.max(1, Math.min(15_000, Math.floor(timeoutMs)));
  return runOutsideTransaction(() => db.transaction(async tx => {
    await tx.execute(sql`select set_config('statement_timeout', ${String(boundedTimeout)}, true)`);
    return runWithTransaction(tx, write);
  }));
}
