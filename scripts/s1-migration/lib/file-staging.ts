/** Raw file inventory. Publish only a completely verified extraction. */
import type { Pool, RowDataPacket } from "mysql2/promise";
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "../../../server/storage/db";
import { contentHashOf } from "./sync";

export interface RawFile {
  fid: number; uid: number; filename: string; uri: string; filemime: string;
  filesize: number; status: number; timestamp: number; content_hash: string;
}

export async function ensureRawFileTable() {
  await db.execute(sql`CREATE TABLE IF NOT EXISTS s1_staging.raw_file_managed (
    fid bigint PRIMARY KEY, uid bigint, filename text, uri text, filemime text,
    filesize bigint, status integer, timestamp bigint, content_hash text,
    extracted_at timestamptz NOT NULL DEFAULT now()
  )`);
  await db.execute(sql`CREATE TABLE IF NOT EXISTS s1_staging.file_inventory_evidence (
    singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
    completed_at timestamptz NOT NULL, row_count bigint NOT NULL, identity_hash text NOT NULL
  )`);
  // Admission state is separate: a failed refresh must not alter published evidence.
  await db.execute(sql`CREATE TABLE IF NOT EXISTS s1_staging.file_inventory_attempt (
    singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
    status text NOT NULL
  )`);
}

export async function stageRawFiles(s1: Pool, batch: number) {
  const start = Date.now();
  await ensureRawFileTable();
  await db.execute(sql`INSERT INTO s1_staging.file_inventory_attempt VALUES(true,'pending')
    ON CONFLICT(singleton) DO UPDATE SET status='pending'`);
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const result = await extractAndPublish(s1, batch);
      return { ...result, status: "verified" as const, attempts: attempt, durationMs: Date.now() - start };
    } catch (error) {
      if (!(error instanceof InventoryChanged)) {
        throw new Error("raw_file_managed extraction failed; inventory not published");
      }
      if (attempt < 3) await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  await db.execute(sql`UPDATE s1_staging.file_inventory_attempt SET status='skipped_changing'`);
  return { table: "file_managed", status: "skipped_changing" as const, attempts: 3,
    s1Count: 0, sourceCountAfter: 0, extracted: 0, staged: 0, staleRemoved: 0,
    durationMs: Date.now() - start, identityVerified: false };
}

class InventoryChanged extends Error {}

async function extractAndPublish(s1: Pool, batch: number) {
  const count = async () => Number((await s1.query<RowDataPacket[]>(
    "SELECT COUNT(*) AS n FROM file_managed"))[0][0].n);
  const s1Count = await count();
  const inventory: RawFile[] = [];
  const hash = createHash("sha256");
  let after = -1;
    for (;;) {
      const [page] = await s1.query<RowDataPacket[]>(
        "SELECT fid,uid,filename,uri,filemime,filesize,status,timestamp FROM file_managed WHERE fid > ? ORDER BY fid LIMIT ?",
        [after, batch]);
      if (!page.length) break;
      for (const row of page) {
        const file = {
          fid: Number(row.fid), uid: Number(row.uid), filename: String(row.filename ?? "").replace(/\0/g, ""),
          uri: String(row.uri ?? "").replace(/\0/g, ""), filemime: String(row.filemime ?? "").replace(/\0/g, ""),
          filesize: Number(row.filesize), status: Number(row.status), timestamp: Number(row.timestamp),
        };
        if (!Number.isSafeInteger(file.fid) || file.fid <= after) throw new Error("inventory_order");
        after = file.fid;
        const content_hash = contentHashOf(file);
        inventory.push({ ...file, content_hash });
        hash.update(`${file.fid}:${content_hash}\n`);
      }
    }
    // A count alone cannot detect one deletion plus one insertion, or edits.
    const proof = createHash("sha256");
    after = -1;
    let verified = 0;
    for (;;) {
      const [page] = await s1.query<RowDataPacket[]>(
        "SELECT fid,uid,filename,uri,filemime,filesize,status,timestamp FROM file_managed WHERE fid > ? ORDER BY fid LIMIT ?",
        [after, batch]);
      if (!page.length) break;
      for (const row of page) {
        const file = {
          fid: Number(row.fid), uid: Number(row.uid), filename: String(row.filename ?? "").replace(/\0/g, ""),
          uri: String(row.uri ?? "").replace(/\0/g, ""), filemime: String(row.filemime ?? "").replace(/\0/g, ""),
          filesize: Number(row.filesize), status: Number(row.status), timestamp: Number(row.timestamp),
        };
        if (!Number.isSafeInteger(file.fid) || file.fid <= after) throw new Error("inventory_order");
        after = file.fid; verified++;
        proof.update(`${file.fid}:${contentHashOf(file)}\n`);
      }
    }
    const identityHash = hash.digest("hex");
    const sourceCountAfter = await count();
    if (s1Count !== inventory.length || verified !== s1Count || sourceCountAfter !== s1Count ||
        identityHash !== proof.digest("hex")) throw new InventoryChanged();
    const staleRemoved = await db.transaction(async (tx) => {
      await tx.execute(sql`LOCK TABLE s1_staging.raw_file_managed IN EXCLUSIVE MODE`);
      const watermark = (await tx.execute(sql`SELECT clock_timestamp()::text AS stamp`) as unknown as { rows: { stamp: string }[] }).rows[0].stamp;
      for (let i = 0; i < inventory.length; i += 200) {
        const values = inventory.slice(i, i + 200).map(r =>
          sql`(${r.fid},${r.uid},${r.filename},${r.uri},${r.filemime},${r.filesize},${r.status},${r.timestamp},${r.content_hash},${watermark}::timestamptz)`);
        await tx.execute(sql`INSERT INTO s1_staging.raw_file_managed
          (fid,uid,filename,uri,filemime,filesize,status,timestamp,content_hash,extracted_at)
          VALUES ${sql.join(values, sql`,`)}
          ON CONFLICT(fid) DO UPDATE SET uid=excluded.uid,filename=excluded.filename,
          uri=excluded.uri,filemime=excluded.filemime,filesize=excluded.filesize,
          status=excluded.status,timestamp=excluded.timestamp,content_hash=excluded.content_hash,extracted_at=excluded.extracted_at`);
      }
      const deleted = await tx.execute(sql`DELETE FROM s1_staging.raw_file_managed WHERE extracted_at < ${watermark}::timestamptz`);
      const actual = (await tx.execute(sql`SELECT count(*)::int AS n FROM s1_staging.raw_file_managed`) as unknown as { rows: { n: number }[] }).rows[0].n;
      if (actual !== inventory.length) throw new Error("inventory_publish_count_mismatch");
      await tx.execute(sql`INSERT INTO s1_staging.file_inventory_evidence VALUES(true,now(),${s1Count},${identityHash})
        ON CONFLICT(singleton) DO UPDATE SET completed_at=excluded.completed_at,
        row_count=excluded.row_count,identity_hash=excluded.identity_hash`);
      await tx.execute(sql`UPDATE s1_staging.file_inventory_attempt SET status='verified'`);
      return deleted.rowCount ?? 0;
    });
    return { table: "file_managed", s1Count, sourceCountAfter, extracted: inventory.length,
      staged: inventory.length, staleRemoved, identityVerified: true };
}
