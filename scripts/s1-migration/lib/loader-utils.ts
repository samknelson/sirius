/**
 * Shared helpers for S1-migration loaders: staged-field decoding (D7 shapes),
 * value normalization transforms (T5/T14/date), and the reject log.
 *
 * Staged `fields` values arrive in three shapes depending on the D7 column:
 * `{value: ...}` objects, bare scalars (entityreference target ids, tids),
 * and arrays for multi-value fields. `scalarOf` collapses all of them.
 */
import { db } from "../../../server/storage/db";
import { sql } from "drizzle-orm";
import { setStorageLogSampling } from "../../../server/storage/middleware/logging";
import { getEnvironmentVariable } from "./script-env";

export const REJECT_SAMPLE_CAP = 25;

/**
 * Storage-operation log sampling for loader runs (S1_LOADER_LOG_SAMPLE):
 *   0   = suppress storage-op logging entirely (DEFAULT)
 *   1   = full logging (throttle disabled — dev debugging)
 *   N>1 = log the 1st call per operation, then every Nth
 *
 * Long loaders call throttleStorageOpLogs() unconditionally: per-row
 * "Storage operation" logging costs extra WAN round-trips (before-state
 * fetch + winston_logs insert) on EVERY write, and its audit value during
 * migration is redundant with id_map + s1_staging.runs provenance. The app
 * server never calls this — normal audit logging there is unchanged.
 */
export const LOADER_LOG_SAMPLE_EVERY = (() => {
  const raw = getEnvironmentVariable("S1_LOADER_LOG_SAMPLE");
  if (raw == null || raw.trim() === "") return 0; // Number("") is 0 anyway — keep intent explicit
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : 0;
})();

export function throttleStorageOpLogs(): void {
  if (LOADER_LOG_SAMPLE_EVERY === 1) {
    console.error(
      "storage-operation logging NOT throttled (S1_LOADER_LOG_SAMPLE=1) — every write logs to console + winston_logs",
    );
    return;
  }
  setStorageLogSampling(LOADER_LOG_SAMPLE_EVERY);
  console.error(
    LOADER_LOG_SAMPLE_EVERY === 0
      ? "storage-operation logging SUPPRESSED for this run (default) — winston_logs will not reflect this run; failures surface via the RejectLog/run report. Re-enable with S1_LOADER_LOG_SAMPLE=1 (full) or N>1 (sampled)"
      : `storage-operation logging throttled for this run: 1 in ${LOADER_LOG_SAMPLE_EVERY} sampled per operation — winston_logs is NOT a progress proxy; use table counts`,
  );
}

export interface StagedNode {
  nid: number;
  title: string | null;
  /** node.changed epoch seconds (end-dating conventions read this). */
  changed: number | null;
  fields: Record<string, unknown>;
  /** Canonical source-content hash written at staging upsert time; null for
   * rows staged before the sync upgrade (never fast-skipped — see lib/sync). */
  contentHash: string | null;
}

export function scalarOf(v: unknown): unknown {
  const s = Array.isArray(v) ? v[0] : v;
  if (s && typeof s === "object" && "value" in (s as Record<string, unknown>)) {
    return (s as Record<string, unknown>).value;
  }
  return s;
}

export function strOf(fields: Record<string, unknown>, key: string): string | null {
  const v = scalarOf(fields[key]);
  if (v == null) return null;
  const s = String(v).trim();
  return s.length > 0 ? s : null;
}

export function tidOf(fields: Record<string, unknown>, key: string): number | null {
  const v = scalarOf(fields[key]);
  if (typeof v === "number") return v;
  if (typeof v === "string" && /^\d+$/.test(v)) return Number(v);
  if (v && typeof v === "object" && "tid" in (v as Record<string, unknown>)) {
    return Number((v as Record<string, unknown>).tid) || null;
  }
  return null;
}

export function targetNidOf(fields: Record<string, unknown>, key: string): number | null {
  const raw = fields[key];
  const s = Array.isArray(raw) ? raw[0] : raw;
  if (typeof s === "number") return s;
  if (typeof s === "string" && /^\d+$/.test(s)) return Number(s);
  if (s && typeof s === "object") {
    const o = s as Record<string, unknown>;
    const cand = o.target_id ?? o.value;
    if (typeof cand === "number") return cand;
    if (typeof cand === "string" && /^\d+$/.test(cand)) return Number(cand);
  }
  return null;
}

/** T5: bare/formatted phone → E.164 (+1...), or null if not 10/11-leading-1 digits. */
export function toE164(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

/** T14: Yes/No text → boolean (case-insensitive), null passthrough. */
export function yesNo(v: string | null): boolean | null {
  if (v == null) return null;
  const s = v.trim().toLowerCase();
  if (s === "yes") return true;
  if (s === "no") return false;
  return null;
}

/** "1971-06-07 00:00:00" → "1971-06-07" (D7 wall-time datetimes, date-only).
 * Strict: the Y-M-D must be a real calendar date (2024-02-30 → null) — a
 * malformed source date must become a counted reject, not a normalized fiction. */
export function toYmd(raw: string): string | null {
  const m = raw.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

/** Epoch seconds → "YYYY-MM-DD" (UTC). For end-dating conventions off node.changed.
 * Strict: a non-finite or wildly out-of-range epoch (staged `changed` passes a
 * `!= null` guard but can be NaN after Number() coercion of dirty source data)
 * returns null so the caller rejects the row — never an opaque
 * `toISOString()` RangeError mid-run. Accepted range: 1970-01-01..2100-01-01. */
export function epochToYmd(epoch: number): string | null {
  if (!Number.isFinite(epoch) || epoch < 0 || epoch > 4102444800) return null;
  return new Date(epoch * 1000).toISOString().slice(0, 10);
}

type RawStagedRow = {
  nid: string | number;
  title: string | null;
  changed: string | number | null;
  fields: unknown;
  content_hash?: string | null;
};

function mapStagedRow(r: RawStagedRow): StagedNode {
  return {
    nid: Number(r.nid),
    title: r.title,
    changed: r.changed == null ? null : Number(r.changed),
    fields: (typeof r.fields === "string" ? JSON.parse(r.fields) : r.fields ?? {}) as Record<string, unknown>,
    contentHash: r.content_hash == null ? null : String(r.content_hash),
  };
}

export async function loadStaged(bundle: string): Promise<StagedNode[]> {
  const res = await db.execute(sql`
    SELECT nid, title, changed, fields, content_hash FROM s1_staging.records WHERE bundle = ${bundle} ORDER BY nid
  `);
  return (res as unknown as { rows: RawStagedRow[] }).rows.map(mapStagedRow);
}

/** Loader page size for keyset-paged staged reads (Track C production
 * hardening). Overridable per run via S1_LOADER_PAGE_SIZE. */
export const LOADER_PAGE_SIZE = (() => {
  const n = Number(getEnvironmentVariable("S1_LOADER_PAGE_SIZE") ?? "");
  return Number.isInteger(n) && n > 0 ? n : 2000;
})();

/**
 * Keyset-paged staged read: yields pages of at most `pageSize` StagedNodes in
 * ascending nid order without ever materializing the whole bundle. Memory is
 * bounded by one page of raw field payloads regardless of staged volume.
 */
export async function* pagedStaged(
  bundle: string,
  pageSize: number = LOADER_PAGE_SIZE,
): AsyncGenerator<StagedNode[]> {
  let lastNid = -1;
  for (;;) {
    const res = await db.execute(sql`
      SELECT nid, title, changed, fields, content_hash FROM s1_staging.records
       WHERE bundle = ${bundle} AND nid > ${lastNid}
       ORDER BY nid LIMIT ${pageSize}
    `);
    const rows = (res as unknown as { rows: RawStagedRow[] }).rows.map(mapStagedRow);
    if (rows.length === 0) return;
    lastNid = rows[rows.length - 1].nid;
    yield rows;
    if (rows.length < pageSize) return;
  }
}

/** Fast staged count (report header) without loading any rows. */
export async function stagedCountOf(bundle: string): Promise<number> {
  const res = await db.execute(
    sql`SELECT count(*)::int AS n FROM s1_staging.records WHERE bundle = ${bundle}`,
  );
  return Number((res as unknown as { rows: Array<{ n: number }> }).rows[0]?.n ?? 0);
}

/** Chunk helper shared by the loaders' batched IN-queries. */
export function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

export class RejectLog {
  counts: Record<string, number> = {};
  samples: Record<string, Array<Record<string, unknown>>> = {};
  /** FULL key membership per reason (verify allowlists) — samples are capped
   * for the report, but verification must never depend on the cap. */
  private keys: Record<string, Set<number>> = {};
  add(reason: string, detail: Record<string, unknown>, key?: number) {
    this.counts[reason] = (this.counts[reason] ?? 0) + 1;
    const arr = (this.samples[reason] ??= []);
    if (arr.length < REJECT_SAMPLE_CAP) arr.push(detail);
    if (key != null) (this.keys[reason] ??= new Set()).add(key);
  }
  has(reason: string, key: number): boolean {
    return this.keys[reason]?.has(key) ?? false;
  }
  /** True if nid was rejected under ANY reason (verify allowlist). */
  hasAny(key: number): boolean {
    for (const set of Object.values(this.keys)) if (set.has(key)) return true;
    return false;
  }
  /** True if nid was rejected under any of the GIVEN reasons. Verify passes
   * must gate on the row-skipping (fatal) reasons only — an annotation reject
   * (e.g. a bad phone) must NOT mask verification of a row that DID load. */
  hasAnyIn(key: number, reasons: Iterable<string>): boolean {
    for (const r of reasons) if (this.keys[r]?.has(key)) return true;
    return false;
  }
  /** Reject reasons present in this run that are NOT in the allowlist.
   * Loaders fail loud (exit non-zero) when this is non-empty: every expected
   * reject class must be explicitly allowed by the operator per run. */
  disallowedReasons(allowed: Iterable<string>): Array<{ reason: string; count: number }> {
    const allow = new Set(allowed);
    return Object.entries(this.counts)
      .filter(([r]) => !allow.has(r))
      .map(([reason, count]) => ({ reason, count }));
  }
}

/** N26 ruling (2026-08-05): relationship rows with NO start date load with
 * default dates instead of rejecting — start 2000-01-01; end keeps a real S1
 * end date when present, else defaults to 2000-01-02. A kept real end that
 * precedes the default start still fails loud downstream (end_before_start).
 * Prod measured 115 missing-start rows of 35,793 (07 §P6). */
export const N26_DEFAULT_START_YMD = "2000-01-01";
export const N26_DEFAULT_END_YMD = "2000-01-02";
export function defaultRelationshipDates(
  startYmd: string | null,
  endYmd: string | null,
): { startYmd: string; endYmd: string | null; defaulted: boolean } {
  if (startYmd) return { startYmd, endYmd, defaulted: false };
  return { startYmd: N26_DEFAULT_START_YMD, endYmd: endYmd ?? N26_DEFAULT_END_YMD, defaulted: true };
}
