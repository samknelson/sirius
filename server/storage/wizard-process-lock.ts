import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { createInfrastructurePool } from "./db";
import { acquireWizardValidationLock } from "./wizard-validation-lock";
import { runOutsideTransaction, runWithTransaction, type TransactionClient } from "./transaction-context";

let writes: ReturnType<typeof drizzle> | undefined;
export function acquireWizardProcessLock(wizardId: string) {
  // Validation and Process cannot replace one another's input snapshot.
  return acquireWizardValidationLock(wizardId);
}

/** Separate, bounded checkouts; PostgreSQL cancels blocked writes, rather than
 * abandoning a promise that could commit after terminal status. */
export function withWizardProcessWrite<T>(write: () => Promise<T>, timeoutMs = 15_000): Promise<T> {
  writes ??= drizzle(createInfrastructurePool({ max: 4 }));
  return runOutsideTransaction(() => writes!.transaction(async tx => {
    await tx.execute(sql`select set_config('statement_timeout', ${String(Math.max(1, Math.min(15_000, timeoutMs)))}, true)`);
    return runWithTransaction(tx as unknown as TransactionClient, write);
  }));
}
