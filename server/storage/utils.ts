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

export async function tableHasRows(tableName: string): Promise<boolean> {
  const client = getClient();
  const result = await client.execute(
    sql.raw(`SELECT 1 FROM "${tableName.replace(/"/g, '""')}" LIMIT 1`)
  );
  return result.rows.length > 0;
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

export interface DbColumnInfo {
  name: string;
  dataType: string;
  udtName: string;
  notNull: boolean;
}

export async function getTableColumnInfo(tableName: string): Promise<DbColumnInfo[]> {
  const client = getClient();
  const result = await client.execute(sql`
    SELECT column_name, data_type, udt_name, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = ${tableName}
  `);
  return result.rows.map((r: any) => ({
    name: r.column_name as string,
    dataType: r.data_type as string,
    udtName: r.udt_name as string,
    notNull: r.is_nullable === 'NO',
  }));
}

export interface DbConstraintInfo {
  name: string;
  type: string;
  definition: string;
  columns: string[];
  foreignTable: string | null;
  foreignColumns: string[];
}

export async function getTableConstraintInfo(tableName: string): Promise<DbConstraintInfo[]> {
  const client = getClient();
  const result = await client.execute(sql`
    SELECT
      c.conname,
      c.contype,
      pg_get_constraintdef(c.oid) AS def,
      COALESCE(
        (SELECT array_agg(a.attname::text ORDER BY u.ord)
         FROM unnest(c.conkey) WITH ORDINALITY AS u(attnum, ord)
         JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = u.attnum),
        ARRAY[]::text[]
      ) AS cols,
      CASE WHEN c.confrelid > 0 THEN c.confrelid::regclass::text ELSE NULL END AS ftable,
      COALESCE(
        (SELECT array_agg(a.attname::text ORDER BY u.ord)
         FROM unnest(c.confkey) WITH ORDINALITY AS u(attnum, ord)
         JOIN pg_attribute a ON a.attrelid = c.confrelid AND a.attnum = u.attnum),
        ARRAY[]::text[]
      ) AS fcols
    FROM pg_constraint c
    WHERE c.conrelid = ${tableName}::regclass
  `);
  return result.rows.map((r: any) => ({
    name: r.conname as string,
    type: r.contype as string,
    definition: r.def as string,
    columns: (r.cols ?? []) as string[],
    foreignTable: (r.ftable as string | null) ?? null,
    foreignColumns: (r.fcols ?? []) as string[],
  }));
}

export interface DbIndexInfo {
  name: string;
  definition: string;
  isUnique: boolean;
  method: string;
  columns: string[];
  predicate: string | null;
}

export async function getTableIndexInfo(tableName: string): Promise<DbIndexInfo[]> {
  const client = getClient();
  const result = await client.execute(sql`
    SELECT
      ic.relname AS indexname,
      pg_get_indexdef(i.indexrelid) AS indexdef,
      i.indisunique AS is_unique,
      am.amname AS method,
      pg_get_expr(i.indpred, i.indrelid) AS predicate,
      (
        SELECT array_agg(pg_get_indexdef(i.indexrelid, ord::int, true) ORDER BY ord)
        FROM unnest(i.indkey) WITH ORDINALITY AS u(k, ord)
      ) AS cols
    FROM pg_index i
    JOIN pg_class ic ON ic.oid = i.indexrelid
    JOIN pg_class tc ON tc.oid = i.indrelid
    JOIN pg_namespace n ON n.oid = tc.relnamespace
    JOIN pg_am am ON am.oid = ic.relam
    WHERE n.nspname = 'public' AND tc.relname = ${tableName}
  `);
  return result.rows.map((r: any) => ({
    name: r.indexname as string,
    definition: r.indexdef as string,
    isUnique: r.is_unique === true,
    method: r.method as string,
    columns: ((r.cols ?? []) as string[]).filter((c) => c && c !== "0"),
    predicate: (r.predicate as string | null) ?? null,
  }));
}
