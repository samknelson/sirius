import { AsyncLocalStorage } from 'async_hooks';
import { db, pool } from './db';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';

type DrizzleTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

const transactionStorage = new AsyncLocalStorage<DrizzleTransaction>();

/**
 * Callbacks queued via {@link onAfterCommit} for the current (outermost)
 * transaction. Flushed only after the transaction commits successfully.
 */
const afterCommitStorage = new AsyncLocalStorage<Array<() => void>>();

export type TransactionClient = DrizzleTransaction;

/**
 * Run `callback` after the current transaction commits. If there is no active
 * transaction, `callback` runs immediately. Use this for side effects that must
 * not be observed unless the write actually committed — e.g. emitting an event
 * that invalidates a cache, which would otherwise rebuild from pre-commit data
 * during the open-transaction window and persist stale state. Callbacks are
 * best-effort: a throwing callback never fails the committed transaction.
 */
export function onAfterCommit(callback: () => void): void {
  const queue = afterCommitStorage.getStore();
  if (queue) {
    queue.push(callback);
    return;
  }
  callback();
}

export function getClient(): DrizzleTransaction | typeof db {
  return transactionStorage.getStore() ?? db;
}

/**
 * Run `fn` with no ambient transaction, so `getClient()` inside it returns the
 * pool rather than the caller's transaction client.
 *
 * Needed for deferred work scheduled from inside a request: an async context
 * propagates into `setImmediate`, so a callback queued during a transaction
 * would otherwise reach for a client that has already committed — or one that
 * is read-only. Deferred work is a separate operation and must run on its own
 * connection.
 */
export function runOutsideTransaction<T>(fn: () => T): T {
  return transactionStorage.exit(() => afterCommitStorage.exit(fn));
}

/**
 * Run `fn` with `tx` as the ambient transaction.
 *
 * For code that already owns a transaction and needs `getClient()` to agree
 * with the client it is handing out — otherwise ambient callers reach for the
 * pool instead, and a transaction-level setting such as `READ ONLY` silently
 * fails to apply to them.
 */
export function runWithTransaction<T>(tx: DrizzleTransaction, fn: () => Promise<T>): Promise<T> {
  return transactionStorage.run(tx, fn);
}

export function getCurrentTransaction(): DrizzleTransaction | undefined {
  return transactionStorage.getStore();
}

export function isInTransaction(): boolean {
  return transactionStorage.getStore() !== undefined;
}

export async function runInTransaction<T>(
  fn: () => Promise<T>,
  limits?: TransactionLimits,
): Promise<T> {
  const existingTx = transactionStorage.getStore();
  if (existingTx) {
    if (limits) throw new Error("Transaction limits require a new outer transaction.");
    // Nested call: the outermost runInTransaction owns the commit and the
    // after-commit flush. Any onAfterCommit() here enqueues onto its queue.
    return fn();
  }

  const afterCommit: Array<() => void> = [];
  const result = await afterCommitStorage.run(afterCommit, () =>
    limits
      ? limitedTransaction(fn, limits)
      : db.transaction(async (tx) => transactionStorage.run(tx, fn))
  );

  // Reached only when the transaction committed (a rollback throws above).
  for (const callback of afterCommit) {
    try {
      callback();
    } catch {
      // Best-effort: an after-commit side effect must never fail a committed tx.
    }
  }
  return result;
}

export interface TransactionLimits {
  statementMs: number;
  idleMs: number;
  applicationName: string;
}

export class TransactionInterrupted extends Error {
  constructor() { super("Database transaction interrupted; partial earlier work may remain."); }
}

function isDatabaseInterruption(error: unknown): boolean {
  const seen = new Set<unknown>();
  while (error && typeof error === "object" && !seen.has(error)) {
    seen.add(error);
    const value = error as { code?: string; cause?: unknown };
    if (value.code === "57014" || value.code === "25P03" ||
        value.code?.startsWith("08") || /^57P0[123]$/.test(value.code ?? "")) return true;
    error = value.cause;
  }
  return false;
}

// Opt-in business transactions, not the short semaphore coordination deadline.
// Own the checkout so fatal errors on an idle checked-out client are handled
// (the pool's error handler only covers idle *pooled* clients).
async function limitedTransaction<T>(fn: () => Promise<T>, limits: TransactionLimits): Promise<T> {
  for (const ms of [limits.statementMs, limits.idleMs]) {
    if (!Number.isSafeInteger(ms) || ms <= 0) throw new Error("Transaction limits must be positive milliseconds.");
  }
  const client = await pool.connect();
  let failed = false;
  let released = false;
  const destroy = () => {
    if (!released) { released = true; client.release(true); }
  };
  let rejectFailure!: (error: Error) => void;
  const failure = new Promise<never>((_, reject) => { rejectFailure = reject; });
  const onError = () => {
    failed = true;
    destroy();
    rejectFailure(new TransactionInterrupted());
  };
  client.on("error", onError);
  const operation = drizzle(client).transaction(async tx => {
    await tx.execute(sql`SELECT
      set_config('statement_timeout', ${String(limits.statementMs)}, true),
      set_config('idle_in_transaction_session_timeout', ${String(limits.idleMs)}, true),
      set_config('application_name', ${limits.applicationName}, true)`);
    try {
      // Both supported drivers expose structurally compatible transactions.
      const result = await transactionStorage.run(tx as unknown as DrizzleTransaction, fn);
      if (failed) throw new TransactionInterrupted();
      return result;
    } catch (error) {
      if (isDatabaseInterruption(error)) throw new TransactionInterrupted();
      throw error;
    }
  });
  try {
    return await Promise.race([operation, failure]);
  } catch (error) {
    // Rollback/COMMIT may themselves fail. Never return an uncertain connection.
    destroy();
    if (failed || isDatabaseInterruption(error)) throw new TransactionInterrupted();
    throw error;
  } finally {
    if (!released) {
      client.removeListener("error", onError);
      released = true;
      client.release();
    }
    // Destroyed clients retain their listener to absorb late driver errors.
    // Promise.race observes the operation even if suspended JS resumes later.
  }
}

/**
 * Run one recoverable unit inside the current transaction.
 *
 * PostgreSQL aborts a transaction after any failed statement until it is
 * rolled back. A nested Drizzle transaction supplies the SAVEPOINT needed by
 * callers that intentionally catch an item-level failure and continue the
 * surrounding transaction. Deferred callbacks are isolated with the
 * savepoint too: callbacks queued by a rolled-back item are discarded, while
 * callbacks from a successful item join the outer transaction's queue.
 */
export async function runInSavepoint<T>(fn: () => Promise<T>): Promise<T> {
  const existingTx = transactionStorage.getStore();
  if (!existingTx) return runInTransaction(fn);

  const outerAfterCommit = afterCommitStorage.getStore();
  if (!outerAfterCommit) {
    throw new Error("A savepoint requires an outer transaction with after-commit tracking.");
  }

  const nestedAfterCommit: Array<() => void> = [];
  const result = await existingTx.transaction((savepoint) =>
    afterCommitStorage.run(
      nestedAfterCommit,
      () => transactionStorage.run(savepoint, fn),
    )
  );
  outerAfterCommit.push(...nestedAfterCommit);
  return result;
}
