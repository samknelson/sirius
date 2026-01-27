import { getClient } from './transaction-context';
import { sql as drizzleSql } from "drizzle-orm";

export interface RawSqlStorage {
  execute(rawSql: string): Promise<void>;
}

export function createRawSqlStorage(): RawSqlStorage {
  return {
    async execute(rawSql: string): Promise<void> {
      const client = getClient();
      await client.execute(drizzleSql.raw(rawSql));
    },
  };
}
