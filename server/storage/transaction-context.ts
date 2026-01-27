import { AsyncLocalStorage } from 'async_hooks';
import { db } from './db';

type DrizzleTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

const transactionStorage = new AsyncLocalStorage<DrizzleTransaction>();

export type TransactionClient = DrizzleTransaction;

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
    return fn();
  }
  
  return db.transaction(async (tx) => {
    return transactionStorage.run(tx, fn);
  });
}
