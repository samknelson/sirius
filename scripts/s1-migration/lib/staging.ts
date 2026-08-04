/**
 * s1_staging — lossless staging area for extracted S1 records, in the S2
 * Postgres but in its OWN schema, deliberately outside shared/schema.ts and
 * the drift gate (it is scratch space for the migration, not app schema).
 *
 * Direct db import is intentional infrastructure use: the storage layer only
 * models app tables. Loaders (next phase) read from here and write to S2
 * through the storage layer per the spec's routing rule.
 */
import { db } from "../../../server/storage/db";
import { sql } from "drizzle-orm";

export interface StagedRecord {
  bundle: string;
  nid: number;
  vid: number | null;
  title: string | null;
  uid: number | null;
  status: number | null;
  created: number | null; // raw epoch seconds — transforms happen at load time
  changed: number | null;
  fields: Record<string, unknown>;
}

export interface StagedTerm {
  tid: number;
  vocabulary: string;
  name: string;
  description: string | null;
  weight: number;
  fields: Record<string, unknown>;
}

export async function ensureStagingSchema(): Promise<void> {
  await db.execute(sql`CREATE SCHEMA IF NOT EXISTS s1_staging`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS s1_staging.records (
      bundle text NOT NULL,
      nid bigint NOT NULL,
      vid bigint,
      title text,
      uid bigint,
      status integer,
      created bigint,
      changed bigint,
      fields jsonb NOT NULL DEFAULT '{}'::jsonb,
      extracted_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (bundle, nid)
    )
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS s1_staging.terms (
      tid bigint PRIMARY KEY,
      vocabulary text NOT NULL,
      name text NOT NULL,
      description text,
      weight integer NOT NULL DEFAULT 0,
      fields jsonb NOT NULL DEFAULT '{}'::jsonb,
      extracted_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS s1_staging.runs (
      id serial PRIMARY KEY,
      started_at timestamptz NOT NULL,
      finished_at timestamptz NOT NULL DEFAULT now(),
      args jsonb NOT NULL DEFAULT '{}'::jsonb,
      report jsonb NOT NULL DEFAULT '{}'::jsonb
    )
  `);
}

/** Flush thresholds: keep single INSERT statements bounded even when field
 * payloads are large (production payperiod JSON blobs). */
const MAX_CHUNK_ROWS = 200;
const MAX_CHUNK_BYTES = 4 * 1024 * 1024;

export async function upsertRecords(rows: StagedRecord[]): Promise<void> {
  if (rows.length === 0) return;
  let chunk: Array<{ r: StagedRecord; fieldsJson: string }> = [];
  let chunkBytes = 0;
  const flush = async () => {
    if (chunk.length === 0) return;
    const values = chunk.map(
      ({ r, fieldsJson }) =>
        sql`(${r.bundle}, ${r.nid}, ${r.vid}, ${r.title}, ${r.uid}, ${r.status}, ${r.created}, ${r.changed}, ${fieldsJson}::jsonb, now())`,
    );
    await db.execute(sql`
      INSERT INTO s1_staging.records (bundle, nid, vid, title, uid, status, created, changed, fields, extracted_at)
      VALUES ${sql.join(values, sql`, `)}
      ON CONFLICT (bundle, nid) DO UPDATE SET
        vid = EXCLUDED.vid,
        title = EXCLUDED.title,
        uid = EXCLUDED.uid,
        status = EXCLUDED.status,
        created = EXCLUDED.created,
        changed = EXCLUDED.changed,
        fields = EXCLUDED.fields,
        extracted_at = EXCLUDED.extracted_at
    `);
    chunk = [];
    chunkBytes = 0;
  };
  for (const r of rows) {
    const fieldsJson = JSON.stringify(r.fields);
    chunk.push({ r, fieldsJson });
    chunkBytes += fieldsJson.length + (r.title?.length ?? 0) + 64;
    if (chunk.length >= MAX_CHUNK_ROWS || chunkBytes >= MAX_CHUNK_BYTES) await flush();
  }
  await flush();
}

export async function upsertTerms(rows: StagedTerm[]): Promise<void> {
  if (rows.length === 0) return;
  const values = rows.map(
    (r) =>
      sql`(${r.tid}, ${r.vocabulary}, ${r.name}, ${r.description}, ${r.weight}, ${JSON.stringify(r.fields)}::jsonb, now())`,
  );
  await db.execute(sql`
    INSERT INTO s1_staging.terms (tid, vocabulary, name, description, weight, fields, extracted_at)
    VALUES ${sql.join(values, sql`, `)}
    ON CONFLICT (tid) DO UPDATE SET
      vocabulary = EXCLUDED.vocabulary,
      name = EXCLUDED.name,
      description = EXCLUDED.description,
      weight = EXCLUDED.weight,
      fields = EXCLUDED.fields,
      extracted_at = EXCLUDED.extracted_at
  `);
}

/** Postgres server clock — used as the run watermark so stale-row reconciliation
 * is immune to app/DB clock skew. */
export async function stagingNow(): Promise<string> {
  const res = await db.execute(sql`SELECT now() AS ts`);
  const rows = (res as unknown as { rows: Array<{ ts: string | Date }> }).rows;
  const ts = rows[0]?.ts;
  return ts instanceof Date ? ts.toISOString() : String(ts);
}

/**
 * After a bundle extraction completes successfully, remove rows the run did
 * not touch — records that no longer exist in S1. Makes the staged set an
 * exact mirror of the current source, and makes count verification prove
 * THIS run (stale rows from prior runs can no longer mask missing ones).
 */
export async function deleteStaleRecords(bundle: string, watermark: string): Promise<number> {
  const res = await db.execute(sql`
    DELETE FROM s1_staging.records
     WHERE bundle = ${bundle} AND extracted_at < ${watermark}::timestamptz
  `);
  return Number((res as unknown as { rowCount?: number }).rowCount ?? 0);
}

export async function deleteStaleTerms(watermark: string): Promise<number> {
  const res = await db.execute(sql`
    DELETE FROM s1_staging.terms WHERE extracted_at < ${watermark}::timestamptz
  `);
  return Number((res as unknown as { rowCount?: number }).rowCount ?? 0);
}

export async function stagedCount(bundle: string): Promise<number> {
  const res = await db.execute(
    sql`SELECT COUNT(*)::int AS n FROM s1_staging.records WHERE bundle = ${bundle}`,
  );
  const rows = (res as unknown as { rows: Array<{ n: number }> }).rows;
  return Number(rows[0]?.n ?? 0);
}

export async function stagedTermCount(): Promise<number> {
  const res = await db.execute(sql`SELECT COUNT(*)::int AS n FROM s1_staging.terms`);
  const rows = (res as unknown as { rows: Array<{ n: number }> }).rows;
  return Number(rows[0]?.n ?? 0);
}

export async function recordRun(
  startedAt: Date,
  args: Record<string, unknown>,
  report: Record<string, unknown>,
): Promise<void> {
  await db.execute(sql`
    INSERT INTO s1_staging.runs (started_at, args, report)
    VALUES (${startedAt.toISOString()}::timestamptz, ${JSON.stringify(args)}::jsonb, ${JSON.stringify(report)}::jsonb)
  `);
}
