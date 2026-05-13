import { getClient } from './transaction-context';
import { sql } from "drizzle-orm";

export async function tableExists(tableName: string): Promise<boolean> {
  const client = getClient();
  const result = await client.execute(sql`
    SELECT EXISTS (
      SELECT FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name = ${tableName}
    ) as exists
  `);
  return result.rows[0]?.exists === true;
}

export async function getTableColumnNames(tableName: string): Promise<string[]> {
  const client = getClient();
  const result = await client.execute(sql`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = ${tableName}
  `);
  return result.rows.map((r: any) => r.column_name as string);
}
