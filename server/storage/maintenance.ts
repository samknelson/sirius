/**
 * `allowInMaintenanceMode` — the ONLY sanctioned override of the
 * maintenance-mode write lock (see server/services/maintenance-mode.ts).
 *
 * Runs `fn` inside its own transaction whose FIRST statement is
 * `SET LOCAL transaction_read_only = off`, which Postgres permits even when
 * the connection's `default_transaction_read_only` is on — but only before
 * the transaction has executed any other statement. The override is scoped
 * to that one transaction; the connection returns to read-only afterwards.
 *
 * Sanctioned call sites (keep this list current):
 *   - session persistence writes (server/storage/system/sessions.ts):
 *     login, rolling expiry, logout, and session pruning keep working so
 *     admins can reach the system-mode escape route;
 *   - the system_mode variable write in the by-name PUT route
 *     (server/modules/system/variables.ts), so an admin can exit
 *     maintenance mode.
 *
 * Do NOT wrap other write paths with this helper — failing writes during
 * maintenance is the whole point.
 */
import { sql } from "drizzle-orm";
import { runInTransaction, getClient, isInTransaction } from "./transaction-context";

export async function allowInMaintenanceMode<T>(fn: () => Promise<T>): Promise<T> {
  if (isInTransaction()) {
    // Already inside a transaction: SET LOCAL would no longer be the first
    // statement (and the enclosing transaction is already read-only or was
    // itself escaped). Run as-is; the write succeeds or fails with the
    // enclosing transaction's read-only state.
    return fn();
  }
  return runInTransaction(async () => {
    await (getClient() as any).execute(sql`SET LOCAL transaction_read_only = off`);
    return fn();
  });
}
