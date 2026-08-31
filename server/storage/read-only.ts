import { db } from './db';
import { sql } from 'drizzle-orm';
import { runWithTransaction } from './transaction-context';

type DbClient = typeof db;
type DrizzleTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface ReadOnlyStorage {
  query<T>(queryFn: (client: DbClient | DrizzleTransaction) => Promise<T>): Promise<T>;
}

export function createReadOnlyStorage(): ReadOnlyStorage {
  return {
    async query<T>(queryFn: (client: DbClient | DrizzleTransaction) => Promise<T>): Promise<T> {
      return db.transaction(async (tx) => {
        await tx.execute(sql`SET TRANSACTION READ ONLY`);
        // Bind the transaction as the ambient client too. Handing `tx` to the
        // callback only covers code that takes the client as an argument;
        // anything reached indirectly would otherwise call `getClient()`, get
        // the pool, and escape the read-only guarantee entirely.
        return runWithTransaction(tx, () => queryFn(tx));
      });
    },
  };
}
