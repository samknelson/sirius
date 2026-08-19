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
import { sql, type SQL } from "drizzle-orm";
import { contentHashOf } from "./sync";

/**
 * Postgres cannot represent NUL (\u0000) in text or jsonb (error 22P05) —
 * real S1 prod data contains NUL bytes inside JSON payloads (observed:
 * sirius_log message blobs). "Verbatim" staging therefore means verbatim
 * MINUS NUL characters: they are stripped at this write boundary, counted,
 * and reported (see nulSanitizedCount / stage.ts final report). Loaders never
 * see NUL either way, so downstream behavior is unaffected.
 */
let nulSanitizedValues = 0;

/** Number of string values that had NUL characters stripped this run. */
export function nulSanitizedCount(): number {
  return nulSanitizedValues;
}

function stripNul(s: string): string {
  if (s.indexOf("\u0000") === -1) return s;
  nulSanitizedValues++;
  return s.split("\u0000").join("");
}

function stripNulNullable(s: string | null): string | null {
  return s == null ? null : stripNul(s);
}

/** Deep-sanitize NUL out of every string (values and keys) in a JSON-safe structure. */
function sanitizeNulDeep<T>(v: T): T {
  if (typeof v === "string") return stripNul(v) as unknown as T;
  if (Array.isArray(v)) return v.map(sanitizeNulDeep) as unknown as T;
  if (v !== null && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      out[stripNul(k)] = sanitizeNulDeep(val);
    }
    return out as unknown as T;
  }
  return v;
}

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
      content_hash text,
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
      content_hash text,
      extracted_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  // In-place upgrade of pre-sync staging tables (Task 292): content_hash is
  // the canonical source-content hash written at upsert time. Rows staged
  // before the upgrade keep a NULL hash (never fast-skipped) until the next
  // stage run re-upserts them.
  await db.execute(sql`ALTER TABLE s1_staging.records ADD COLUMN IF NOT EXISTS content_hash text`);
  await db.execute(sql`ALTER TABLE s1_staging.terms ADD COLUMN IF NOT EXISTS content_hash text`);
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

/**
 * Canonical hash input for a staged record: source content ONLY (scalars +
 * sanitized fields), never extraction metadata (extracted_at). Exported so
 * smokes/backfills can recompute what upsert would store. Callers must pass
 * the SANITIZED row (NUL-stripped) — upsert hashes exactly what it writes.
 */
export function stagedRecordHashInput(r: StagedRecord): Record<string, unknown> {
  return {
    bundle: r.bundle,
    nid: r.nid,
    vid: r.vid ?? null,
    title: r.title ?? null,
    uid: r.uid ?? null,
    status: r.status ?? null,
    created: r.created ?? null,
    changed: r.changed ?? null,
    fields: r.fields,
  };
}

export function stagedTermHashInput(t: StagedTerm): Record<string, unknown> {
  return {
    tid: t.tid,
    vocabulary: t.vocabulary,
    name: t.name,
    description: t.description ?? null,
    weight: t.weight,
    fields: t.fields,
  };
}

export async function upsertRecords(rows: StagedRecord[]): Promise<void> {
  if (rows.length === 0) return;
  let chunk: Array<{ r: StagedRecord; fieldsJson: string; hash: string }> = [];
  let chunkBytes = 0;
  const flush = async () => {
    if (chunk.length === 0) return;
    const values = chunk.map(
      ({ r, fieldsJson, hash }) =>
        sql`(${r.bundle}, ${r.nid}, ${r.vid}, ${r.title}, ${r.uid}, ${r.status}, ${r.created}, ${r.changed}, ${fieldsJson}::jsonb, ${hash}, now())`,
    );
    await db.execute(sql`
      INSERT INTO s1_staging.records (bundle, nid, vid, title, uid, status, created, changed, fields, content_hash, extracted_at)
      VALUES ${sql.join(values, sql`, `)}
      ON CONFLICT (bundle, nid) DO UPDATE SET
        vid = EXCLUDED.vid,
        title = EXCLUDED.title,
        uid = EXCLUDED.uid,
        status = EXCLUDED.status,
        created = EXCLUDED.created,
        changed = EXCLUDED.changed,
        fields = EXCLUDED.fields,
        content_hash = EXCLUDED.content_hash,
        extracted_at = EXCLUDED.extracted_at
    `);
    chunk = [];
    chunkBytes = 0;
  };
  for (const raw of rows) {
    // Sanitize ONCE into a clean row used for both the INSERT values and the
    // content hash — the hash covers exactly what lands in staging, and the
    // NUL counter increments exactly once per dirty value.
    const r: StagedRecord = {
      bundle: stripNul(raw.bundle),
      nid: raw.nid,
      vid: raw.vid,
      title: stripNulNullable(raw.title),
      uid: raw.uid,
      status: raw.status,
      created: raw.created,
      changed: raw.changed,
      fields: sanitizeNulDeep(raw.fields),
    };
    const fieldsJson = JSON.stringify(r.fields);
    chunk.push({ r, fieldsJson, hash: contentHashOf(stagedRecordHashInput(r)) });
    chunkBytes += fieldsJson.length + (r.title?.length ?? 0) + 64;
    if (chunk.length >= MAX_CHUNK_ROWS || chunkBytes >= MAX_CHUNK_BYTES) await flush();
  }
  await flush();
}

export async function upsertTerms(rows: StagedTerm[]): Promise<void> {
  if (rows.length === 0) return;
  const values = rows.map((raw) => {
    const r: StagedTerm = {
      tid: raw.tid,
      vocabulary: stripNul(raw.vocabulary),
      name: stripNul(raw.name),
      description: stripNulNullable(raw.description),
      weight: raw.weight,
      fields: sanitizeNulDeep(raw.fields),
    };
    return sql`(${r.tid}, ${r.vocabulary}, ${r.name}, ${r.description}, ${r.weight}, ${JSON.stringify(r.fields)}::jsonb, ${contentHashOf(stagedTermHashInput(r))}, now())`;
  });
  await db.execute(sql`
    INSERT INTO s1_staging.terms (tid, vocabulary, name, description, weight, fields, content_hash, extracted_at)
    VALUES ${sql.join(values, sql`, `)}
    ON CONFLICT (tid) DO UPDATE SET
      vocabulary = EXCLUDED.vocabulary,
      name = EXCLUDED.name,
      description = EXCLUDED.description,
      weight = EXCLUDED.weight,
      fields = EXCLUDED.fields,
      content_hash = EXCLUDED.content_hash,
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
    VALUES (${startedAt.toISOString()}::timestamptz, ${JSON.stringify(sanitizeNulDeep(args))}::jsonb, ${JSON.stringify(sanitizeNulDeep(report))}::jsonb)
  `);
}

// ---------------------------------------------------------------------------
// Raw (non-node) S1 tables. sirius_ledger_ar is the only in-scope one (T18):
// the AR ledger is a bare MariaDB table, not a node bundle, so it gets its
// own lossless staging table with the same watermark/stale-delete semantics.
// ---------------------------------------------------------------------------

export interface RawLedgerRow {
  ledgerId: number;
  amount: string | null; // decimal(10,2) staged VERBATIM as text (lossless)
  status: string | null;
  account: number | null; // nid → sirius_ledger_account
  participant: number | null; // nid → worker/contact/employer
  reference: number | null; // nid → charged-for entity (grant, election, ...)
  ts: number | null; // epoch seconds
  memo: string | null;
  key: string | null;
  json: string | null; // longtext staged verbatim
  /** Canonical source-content hash written at staging upsert time; null for
   * rows staged before the sync upgrade. Populated on READS (loadRawLedger /
   * pagedRawLedger); extract writers never set it — upsertRawLedger computes
   * it from rawLedgerHashInput. */
  contentHash?: string | null;
}

export async function ensureRawLedgerTable(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS s1_staging.raw_ledger_ar (
      ledger_id bigint PRIMARY KEY,
      ledger_amount text,
      ledger_status text,
      ledger_account bigint,
      ledger_participant bigint,
      ledger_reference bigint,
      ledger_ts bigint,
      ledger_memo text,
      ledger_key text,
      ledger_json text,
      content_hash text,
      extracted_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`ALTER TABLE s1_staging.raw_ledger_ar ADD COLUMN IF NOT EXISTS content_hash text`);
}

/** Canonical hash input for a raw AR row (source content only). */
export function rawLedgerHashInput(r: RawLedgerRow): Record<string, unknown> {
  return {
    ledgerId: r.ledgerId,
    amount: r.amount ?? null,
    status: r.status ?? null,
    account: r.account ?? null,
    participant: r.participant ?? null,
    reference: r.reference ?? null,
    ts: r.ts ?? null,
    memo: r.memo ?? null,
    key: r.key ?? null,
    json: r.json ?? null,
  };
}

export async function upsertRawLedger(rows: RawLedgerRow[]): Promise<void> {
  if (rows.length === 0) return;
  let chunk: RawLedgerRow[] = [];
  let chunkBytes = 0;
  const flush = async () => {
    if (chunk.length === 0) return;
    const values = chunk.map((raw) => {
      const r: RawLedgerRow = {
        ...raw,
        amount: stripNulNullable(raw.amount),
        status: stripNulNullable(raw.status),
        memo: stripNulNullable(raw.memo),
        key: stripNulNullable(raw.key),
        json: stripNulNullable(raw.json),
      };
      return sql`(${r.ledgerId}, ${r.amount}, ${r.status}, ${r.account}, ${r.participant}, ${r.reference}, ${r.ts}, ${r.memo}, ${r.key}, ${r.json}, ${contentHashOf(rawLedgerHashInput(r))}, now())`;
    });
    await db.execute(sql`
      INSERT INTO s1_staging.raw_ledger_ar
        (ledger_id, ledger_amount, ledger_status, ledger_account, ledger_participant, ledger_reference, ledger_ts, ledger_memo, ledger_key, ledger_json, content_hash, extracted_at)
      VALUES ${sql.join(values, sql`, `)}
      ON CONFLICT (ledger_id) DO UPDATE SET
        ledger_amount = EXCLUDED.ledger_amount,
        ledger_status = EXCLUDED.ledger_status,
        ledger_account = EXCLUDED.ledger_account,
        ledger_participant = EXCLUDED.ledger_participant,
        ledger_reference = EXCLUDED.ledger_reference,
        ledger_ts = EXCLUDED.ledger_ts,
        ledger_memo = EXCLUDED.ledger_memo,
        ledger_key = EXCLUDED.ledger_key,
        ledger_json = EXCLUDED.ledger_json,
        content_hash = EXCLUDED.content_hash,
        extracted_at = EXCLUDED.extracted_at
    `);
    chunk = [];
    chunkBytes = 0;
  };
  for (const r of rows) {
    chunk.push(r);
    chunkBytes += (r.json?.length ?? 0) + (r.memo?.length ?? 0) + 128;
    if (chunk.length >= MAX_CHUNK_ROWS || chunkBytes >= MAX_CHUNK_BYTES) await flush();
  }
  await flush();
}

export async function deleteStaleRawLedger(watermark: string): Promise<number> {
  const res = await db.execute(
    sql`DELETE FROM s1_staging.raw_ledger_ar WHERE extracted_at < ${watermark}::timestamptz`,
  );
  return (res as unknown as { rowCount?: number }).rowCount ?? 0;
}

export async function stagedRawLedgerCount(): Promise<number> {
  const res = await db.execute(sql`SELECT count(*)::int AS n FROM s1_staging.raw_ledger_ar`);
  return Number((res as unknown as { rows: Array<{ n: number }> }).rows[0]?.n ?? 0);
}

/** T18 read path: all staged AR rows ordered by ledger_id. Prefer
 * pagedRawLedger for production-size sets. */
export async function loadRawLedger(): Promise<RawLedgerRow[]> {
  const res = await db.execute(sql`
    SELECT ledger_id, ledger_amount, ledger_status, ledger_account, ledger_participant,
           ledger_reference, ledger_ts, ledger_memo, ledger_key, ledger_json, content_hash
      FROM s1_staging.raw_ledger_ar ORDER BY ledger_id
  `);
  return (res as unknown as { rows: Array<Record<string, unknown>> }).rows.map(mapRawLedgerRow);
}

function mapRawLedgerRow(r: Record<string, unknown>): RawLedgerRow {
  return {
    ledgerId: Number(r.ledger_id),
    amount: r.ledger_amount == null ? null : String(r.ledger_amount),
    status: r.ledger_status == null ? null : String(r.ledger_status),
    account: r.ledger_account == null ? null : Number(r.ledger_account),
    participant: r.ledger_participant == null ? null : Number(r.ledger_participant),
    reference: r.ledger_reference == null ? null : Number(r.ledger_reference),
    ts: r.ledger_ts == null ? null : Number(r.ledger_ts),
    memo: r.ledger_memo == null ? null : String(r.ledger_memo),
    key: r.ledger_key == null ? null : String(r.ledger_key),
    json: r.ledger_json == null ? null : String(r.ledger_json),
    contentHash: r.content_hash == null ? null : String(r.content_hash),
  };
}

/**
 * Keyset-paged raw AR read (Track C): yields pages of at most `pageSize`
 * rows in ascending ledger_id order — memory stays bounded at production
 * volume (large ledger_json payloads never materialize all at once).
 */
export async function* pagedRawLedger(pageSize: number): AsyncGenerator<RawLedgerRow[]> {
  let last = -1;
  for (;;) {
    const res = await db.execute(sql`
      SELECT ledger_id, ledger_amount, ledger_status, ledger_account, ledger_participant,
             ledger_reference, ledger_ts, ledger_memo, ledger_key, ledger_json, content_hash
        FROM s1_staging.raw_ledger_ar WHERE ledger_id > ${last}
       ORDER BY ledger_id LIMIT ${pageSize}
    `);
    const rows = (res as unknown as { rows: Array<Record<string, unknown>> }).rows.map(mapRawLedgerRow);
    if (rows.length === 0) return;
    last = rows[rows.length - 1].ledgerId;
    yield rows;
    if (rows.length < pageSize) return;
  }
}

// ---------------------------------------------------------------------------
// T20 hours provenance sidecar. worker_hours has no provenance column, so the
// hours loader records every (worker, employer, year, month) key it writes in
// s1_staging.hours_keys. That makes stale-row cleanup safe by construction:
// only keys THIS loader stamped can ever be deleted, so operator-entered
// hours rows (never stamped) are untouchable. A run stamps last_seen_at on
// every key it (re)writes; keys with last_seen_at older than the run
// watermark are no longer backed by any staged payperiod → stale.
// ---------------------------------------------------------------------------

export interface HoursKey {
  workerId: string;
  employerId: string;
  year: number;
  month: number;
}

export async function ensureHoursKeysTable(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS s1_staging.hours_keys (
      worker_id varchar NOT NULL,
      employer_id varchar NOT NULL,
      year integer NOT NULL,
      month integer NOT NULL,
      last_seen_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (worker_id, employer_id, year, month)
    )
  `);
}

/** Stamp keys as seen by the current run (insert or refresh last_seen_at). */
export async function upsertHoursKeys(keys: HoursKey[]): Promise<void> {
  for (let i = 0; i < keys.length; i += 500) {
    const batch = keys.slice(i, i + 500);
    const values = batch.map(
      (k) => sql`(${k.workerId}, ${k.employerId}, ${k.year}, ${k.month}, now())`,
    );
    await db.execute(sql`
      INSERT INTO s1_staging.hours_keys (worker_id, employer_id, year, month, last_seen_at)
      VALUES ${sql.join(values, sql`, `)}
      ON CONFLICT (worker_id, employer_id, year, month)
      DO UPDATE SET last_seen_at = EXCLUDED.last_seen_at
    `);
  }
}

/**
 * Keyset-paged stream of keys NOT stamped by the current run (stale).
 * Async generator so the caller processes (and deletes) one page before the
 * next is fetched — a large first reconciliation or broad S1 deletion must
 * never materialize the whole sidecar in memory. Deleting the yielded page's
 * rows between iterations is safe: they sort at or before the cursor.
 */
export async function* pagedStaleHoursKeys(
  watermark: string,
  pageSize: number,
): AsyncGenerator<HoursKey[]> {
  let last: HoursKey | null = null;
  for (;;) {
    const after: SQL = last
      ? sql`AND (worker_id, employer_id, year, month) > (${last.workerId}, ${last.employerId}, ${last.year}, ${last.month})`
      : sql``;
    const res: unknown = await db.execute(sql`
      SELECT worker_id, employer_id, year, month
        FROM s1_staging.hours_keys
       WHERE last_seen_at < ${watermark}::timestamptz ${after}
       ORDER BY worker_id, employer_id, year, month
       LIMIT ${pageSize}
    `);
    const rows: HoursKey[] = (res as { rows: Array<Record<string, unknown>> }).rows.map((r) => ({
      workerId: String(r.worker_id),
      employerId: String(r.employer_id),
      year: Number(r.year),
      month: Number(r.month),
    }));
    if (rows.length === 0) break;
    yield rows;
    last = rows[rows.length - 1];
    if (rows.length < pageSize) break;
  }
}

export async function deleteHoursKeys(keys: HoursKey[]): Promise<void> {
  for (let i = 0; i < keys.length; i += 500) {
    const batch = keys.slice(i, i + 500);
    const tuples = batch.map((k) => sql`(${k.workerId}, ${k.employerId}, ${k.year}, ${k.month})`);
    await db.execute(sql`
      DELETE FROM s1_staging.hours_keys
       WHERE (worker_id, employer_id, year, month) IN (${sql.join(tuples, sql`, `)})
    `);
  }
}

/** One-time adoption for targets loaded before the sidecar existed: seed keys
 * from existing day=1 worker_hours rows whose worker AND employer both map in
 * id_map (i.e. migration-covered pairs), with an epoch last_seen_at so the
 * very next run must re-stamp them or they count as stale. PRECONDITION
 * (operator-verified): every day=1 hours row for mapped pairs on the target
 * was written by this loader — do NOT run after manual hours entry for
 * migrated employers. */
export async function adoptHoursKeysFromWorkerHours(): Promise<number> {
  const res = await db.execute(sql`
    INSERT INTO s1_staging.hours_keys (worker_id, employer_id, year, month, last_seen_at)
    SELECT wh.worker_id, wh.employer_id, wh.year, wh.month, to_timestamp(0)
      FROM worker_hours wh
     WHERE wh.day = 1
       AND EXISTS (SELECT 1 FROM s1_staging.id_map mw
                    WHERE mw.entity = 'worker' AND mw.s2_id = wh.worker_id)
       AND EXISTS (SELECT 1 FROM s1_staging.id_map me
                    WHERE me.entity = 'employer' AND me.s2_id = wh.employer_id)
    ON CONFLICT (worker_id, employer_id, year, month) DO NOTHING
  `);
  return Number((res as unknown as { rowCount?: number }).rowCount ?? 0);
}

// ---------------------------------------------------------------------------
// Raw Drupal user tables (T27) — `users`, `users_roles`, `role`, `authmap`
// are core tables, not node bundles, so (like raw_ledger_ar) they get their
// own lossless staging tables with watermark/stale-delete + count-verify
// semantics. `pass`/`tfa_*` are NEVER staged (dropped at extraction, by
// design — S2 is Okta-only).
// ---------------------------------------------------------------------------

export interface RawUserRow {
  uid: number;
  name: string | null;
  mail: string | null;
  created: number | null; // epoch seconds
  access: number | null;
  login: number | null;
  status: number; // 1 = active, 0 = blocked
  timezone: string | null;
  data: string | null; // serialized D7 blob staged verbatim (profile extras)
}

export interface RawUserRoleRow {
  uid: number;
  rid: number;
}

export interface RawRoleRow {
  rid: number;
  name: string | null;
  weight: number | null;
}

export interface RawAuthmapRow {
  aid: number;
  uid: number;
  authname: string | null;
  module: string | null;
}

/** S1 user↔contact association: `field_data_field_sirius_contact` rows with
 * `entity_type='user'` (deleted=0). The authoritative ownership signal for
 * shared email addresses — both the contacts and the users loaders resolve
 * shared addresses through it, so the contact carrying an email and the
 * worker a login resolves to are the same person. */
export interface RawUserContactRow {
  uid: number;
  delta: number;
  contactNid: number;
}

export async function ensureRawUserTables(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS s1_staging.raw_users (
      uid bigint PRIMARY KEY,
      name text,
      mail text,
      created bigint,
      access bigint,
      login bigint,
      status int NOT NULL DEFAULT 0,
      timezone text,
      data text,
      content_hash text,
      extracted_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS s1_staging.raw_users_roles (
      uid bigint NOT NULL,
      rid bigint NOT NULL,
      content_hash text,
      extracted_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (uid, rid)
    )
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS s1_staging.raw_roles (
      rid bigint PRIMARY KEY,
      name text,
      weight int,
      content_hash text,
      extracted_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS s1_staging.raw_authmap (
      aid bigint PRIMARY KEY,
      uid bigint NOT NULL,
      authname text,
      module text,
      content_hash text,
      extracted_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS s1_staging.raw_user_contact (
      uid bigint NOT NULL,
      delta int NOT NULL,
      contact_nid bigint NOT NULL,
      content_hash text,
      extracted_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (uid, delta)
    )
  `);
  for (const table of RAW_USER_TABLES) {
    await db.execute(sql.raw(`ALTER TABLE s1_staging.${table} ADD COLUMN IF NOT EXISTS content_hash text`));
  }
}

/** Canonical hash inputs for the raw user tables (source content only). */
export function rawUserHashInput(r: RawUserRow): Record<string, unknown> {
  return {
    uid: r.uid,
    name: r.name ?? null,
    mail: r.mail ?? null,
    created: r.created ?? null,
    access: r.access ?? null,
    login: r.login ?? null,
    status: r.status,
    timezone: r.timezone ?? null,
    data: r.data ?? null,
  };
}
export function rawUserRoleHashInput(r: RawUserRoleRow): Record<string, unknown> {
  return { uid: r.uid, rid: r.rid };
}
export function rawRoleHashInput(r: RawRoleRow): Record<string, unknown> {
  return { rid: r.rid, name: r.name ?? null, weight: r.weight ?? null };
}
export function rawAuthmapHashInput(r: RawAuthmapRow): Record<string, unknown> {
  return { aid: r.aid, uid: r.uid, authname: r.authname ?? null, module: r.module ?? null };
}
export function rawUserContactHashInput(r: RawUserContactRow): Record<string, unknown> {
  return { uid: r.uid, delta: r.delta, contactNid: r.contactNid };
}

export async function upsertRawUsers(rows: RawUserRow[]): Promise<void> {
  if (rows.length === 0) return;
  for (let i = 0; i < rows.length; i += MAX_CHUNK_ROWS) {
    const chunk = rows.slice(i, i + MAX_CHUNK_ROWS);
    const values = chunk.map((raw) => {
      const r: RawUserRow = {
        ...raw,
        name: stripNulNullable(raw.name),
        mail: stripNulNullable(raw.mail),
        timezone: stripNulNullable(raw.timezone),
        data: stripNulNullable(raw.data),
      };
      return sql`(${r.uid}, ${r.name}, ${r.mail}, ${r.created}, ${r.access}, ${r.login}, ${r.status}, ${r.timezone}, ${r.data}, ${contentHashOf(rawUserHashInput(r))}, now())`;
    });
    await db.execute(sql`
      INSERT INTO s1_staging.raw_users (uid, name, mail, created, access, login, status, timezone, data, content_hash, extracted_at)
      VALUES ${sql.join(values, sql`, `)}
      ON CONFLICT (uid) DO UPDATE SET
        name = EXCLUDED.name, mail = EXCLUDED.mail, created = EXCLUDED.created,
        access = EXCLUDED.access, login = EXCLUDED.login, status = EXCLUDED.status,
        timezone = EXCLUDED.timezone, data = EXCLUDED.data,
        content_hash = EXCLUDED.content_hash, extracted_at = EXCLUDED.extracted_at
    `);
  }
}

export async function upsertRawUsersRoles(rows: RawUserRoleRow[]): Promise<void> {
  if (rows.length === 0) return;
  for (let i = 0; i < rows.length; i += MAX_CHUNK_ROWS) {
    const chunk = rows.slice(i, i + MAX_CHUNK_ROWS);
    const values = chunk.map((r) => sql`(${r.uid}, ${r.rid}, ${contentHashOf(rawUserRoleHashInput(r))}, now())`);
    await db.execute(sql`
      INSERT INTO s1_staging.raw_users_roles (uid, rid, content_hash, extracted_at)
      VALUES ${sql.join(values, sql`, `)}
      ON CONFLICT (uid, rid) DO UPDATE SET
        content_hash = EXCLUDED.content_hash, extracted_at = EXCLUDED.extracted_at
    `);
  }
}

export async function upsertRawRoles(rows: RawRoleRow[]): Promise<void> {
  if (rows.length === 0) return;
  const values = rows.map((raw) => {
    const r: RawRoleRow = { ...raw, name: stripNulNullable(raw.name) };
    return sql`(${r.rid}, ${r.name}, ${r.weight}, ${contentHashOf(rawRoleHashInput(r))}, now())`;
  });
  await db.execute(sql`
    INSERT INTO s1_staging.raw_roles (rid, name, weight, content_hash, extracted_at)
    VALUES ${sql.join(values, sql`, `)}
    ON CONFLICT (rid) DO UPDATE SET
      name = EXCLUDED.name, weight = EXCLUDED.weight,
      content_hash = EXCLUDED.content_hash, extracted_at = EXCLUDED.extracted_at
  `);
}

export async function upsertRawAuthmap(rows: RawAuthmapRow[]): Promise<void> {
  if (rows.length === 0) return;
  for (let i = 0; i < rows.length; i += MAX_CHUNK_ROWS) {
    const chunk = rows.slice(i, i + MAX_CHUNK_ROWS);
    const values = chunk.map((raw) => {
      const r: RawAuthmapRow = { ...raw, authname: stripNulNullable(raw.authname), module: stripNulNullable(raw.module) };
      return sql`(${r.aid}, ${r.uid}, ${r.authname}, ${r.module}, ${contentHashOf(rawAuthmapHashInput(r))}, now())`;
    });
    await db.execute(sql`
      INSERT INTO s1_staging.raw_authmap (aid, uid, authname, module, content_hash, extracted_at)
      VALUES ${sql.join(values, sql`, `)}
      ON CONFLICT (aid) DO UPDATE SET
        uid = EXCLUDED.uid, authname = EXCLUDED.authname, module = EXCLUDED.module,
        content_hash = EXCLUDED.content_hash, extracted_at = EXCLUDED.extracted_at
    `);
  }
}

export async function upsertRawUserContacts(rows: RawUserContactRow[]): Promise<void> {
  if (rows.length === 0) return;
  for (let i = 0; i < rows.length; i += MAX_CHUNK_ROWS) {
    const chunk = rows.slice(i, i + MAX_CHUNK_ROWS);
    const values = chunk.map((r) => sql`(${r.uid}, ${r.delta}, ${r.contactNid}, ${contentHashOf(rawUserContactHashInput(r))}, now())`);
    await db.execute(sql`
      INSERT INTO s1_staging.raw_user_contact (uid, delta, contact_nid, content_hash, extracted_at)
      VALUES ${sql.join(values, sql`, `)}
      ON CONFLICT (uid, delta) DO UPDATE SET
        contact_nid = EXCLUDED.contact_nid,
        content_hash = EXCLUDED.content_hash, extracted_at = EXCLUDED.extracted_at
    `);
  }
}

const RAW_USER_TABLES = ["raw_users", "raw_users_roles", "raw_roles", "raw_authmap", "raw_user_contact"] as const;
export type RawUserTable = (typeof RAW_USER_TABLES)[number];

export async function deleteStaleRawUserTable(table: RawUserTable, watermark: string): Promise<number> {
  const res = await db.execute(
    sql`DELETE FROM ${sql.raw(`s1_staging.${table}`)} WHERE extracted_at < ${watermark}::timestamptz`,
  );
  return (res as unknown as { rowCount?: number }).rowCount ?? 0;
}

export async function stagedRawUserTableCount(table: RawUserTable): Promise<number> {
  const res = await db.execute(sql`SELECT count(*)::int AS n FROM ${sql.raw(`s1_staging.${table}`)}`);
  return Number((res as unknown as { rows: Array<{ n: number }> }).rows[0]?.n ?? 0);
}

/** T27 read path: staged users ordered by uid (keyset-paged). */
export async function* pagedRawUsers(pageSize: number): AsyncGenerator<RawUserRow[]> {
  let last = -1;
  for (;;) {
    const res = await db.execute(sql`
      SELECT uid, name, mail, created, access, login, status, timezone, data
        FROM s1_staging.raw_users WHERE uid > ${last}
       ORDER BY uid LIMIT ${pageSize}
    `);
    const rows = (res as unknown as { rows: Array<Record<string, unknown>> }).rows.map((r) => ({
      uid: Number(r.uid),
      name: r.name == null ? null : String(r.name),
      mail: r.mail == null ? null : String(r.mail),
      created: r.created == null ? null : Number(r.created),
      access: r.access == null ? null : Number(r.access),
      login: r.login == null ? null : Number(r.login),
      status: Number(r.status ?? 0),
      timezone: r.timezone == null ? null : String(r.timezone),
      data: r.data == null ? null : String(r.data),
    }));
    if (rows.length === 0) return;
    last = rows[rows.length - 1].uid;
    yield rows;
    if (rows.length < pageSize) return;
  }
}

export async function loadRawUsersRoles(): Promise<RawUserRoleRow[]> {
  const res = await db.execute(sql`SELECT uid, rid FROM s1_staging.raw_users_roles ORDER BY uid, rid`);
  return (res as unknown as { rows: Array<Record<string, unknown>> }).rows.map((r) => ({
    uid: Number(r.uid),
    rid: Number(r.rid),
  }));
}

export async function loadRawRoles(): Promise<RawRoleRow[]> {
  const res = await db.execute(sql`SELECT rid, name, weight FROM s1_staging.raw_roles ORDER BY rid`);
  return (res as unknown as { rows: Array<Record<string, unknown>> }).rows.map((r) => ({
    rid: Number(r.rid),
    name: r.name == null ? null : String(r.name),
    weight: r.weight == null ? null : Number(r.weight),
  }));
}

/** Full user↔contact association read (small: at most one row per S1 user). */
export async function loadRawUserContacts(): Promise<RawUserContactRow[]> {
  const res = await db.execute(
    sql`SELECT uid, delta, contact_nid FROM s1_staging.raw_user_contact ORDER BY uid, delta`,
  );
  return (res as unknown as { rows: Array<Record<string, unknown>> }).rows.map((r) => ({
    uid: Number(r.uid),
    delta: Number(r.delta),
    contactNid: Number(r.contact_nid),
  }));
}

/** Lightweight uid→mail read for shared-email ownership resolution (the
 * contacts loader needs mails only — never pages the full user shape). */
export async function loadRawUserMails(): Promise<Array<{ uid: number; mail: string | null; status: number }>> {
  const res = await db.execute(sql`SELECT uid, mail, status FROM s1_staging.raw_users ORDER BY uid`);
  return (res as unknown as { rows: Array<Record<string, unknown>> }).rows.map((r) => ({
    uid: Number(r.uid),
    mail: r.mail == null ? null : String(r.mail),
    status: Number(r.status ?? 0),
  }));
}

export async function loadRawAuthmap(): Promise<RawAuthmapRow[]> {
  const res = await db.execute(sql`SELECT aid, uid, authname, module FROM s1_staging.raw_authmap ORDER BY aid`);
  return (res as unknown as { rows: Array<Record<string, unknown>> }).rows.map((r) => ({
    aid: Number(r.aid),
    uid: Number(r.uid),
    authname: r.authname == null ? null : String(r.authname),
    module: r.module == null ? null : String(r.module),
  }));
}
