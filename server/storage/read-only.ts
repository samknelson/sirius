import { db } from './db';
import { sql } from 'drizzle-orm';

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
        return queryFn(tx);
      });
    },
  };
}
