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
