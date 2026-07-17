import { getClient } from './transaction-context';
import { sql as drizzleSql } from "drizzle-orm";

export interface RawSqlStorage {
  execute(rawSql: string): Promise<void>;
  /**
   * Atomically drop a table only if it is empty. The row-count check and the
   * DROP run inside a single server-side DO block (one statement, one
   * implicit transaction), so a concurrent insert cannot slip in between.
   * Throws if the table contains rows.
   */
  dropTableIfEmpty(tableName: string): Promise<void>;
}

const SAFE_IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

export function createRawSqlStorage(): RawSqlStorage {
  return {
    async execute(rawSql: string): Promise<void> {
      const client = getClient();
      await client.execute(drizzleSql.raw(rawSql));
    },

    async dropTableIfEmpty(tableName: string): Promise<void> {
      if (!SAFE_IDENTIFIER.test(tableName)) {
        throw new Error(`Invalid table name: ${tableName}`);
      }
      const client = getClient();
      await client.execute(drizzleSql.raw(`DO $$
DECLARE cnt bigint;
BEGIN
  -- Take an exclusive lock FIRST so no concurrent insert can commit between
  -- the emptiness check and the drop. The DO block runs as one statement in
  -- one (implicit) transaction, so the lock is held through the DROP.
  EXECUTE format('LOCK TABLE %I IN ACCESS EXCLUSIVE MODE', '${tableName}');
  EXECUTE format('SELECT count(*) FROM %I', '${tableName}') INTO cnt;
  IF cnt > 0 THEN
    RAISE EXCEPTION 'Table ${tableName} contains % rows; refusing to drop', cnt;
  END IF;
  EXECUTE format('DROP TABLE %I CASCADE', '${tableName}');
END $$`));
    },
  };
}
