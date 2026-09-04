import { AsyncLocalStorage } from 'async_hooks';
import { db } from './db';

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
  return transactionStorage.exit(fn);
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
  fn: () => Promise<T>
): Promise<T> {
  const existingTx = transactionStorage.getStore();
  if (existingTx) {
    // Nested call: the outermost runInTransaction owns the commit and the
    // after-commit flush. Any onAfterCommit() here enqueues onto its queue.
    return fn();
  }

  const afterCommit: Array<() => void> = [];
  const result = await afterCommitStorage.run(afterCommit, () =>
    db.transaction(async (tx) => transactionStorage.run(tx, fn))
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
