/**
 * Sync foundation for the S1→S2 dual-run (Task 292 — RUNBOOK §10).
 *
 * S1 stays live and authoritative for ~1 month after the initial production
 * load, with roughly daily S1→S2 re-syncs. Staging already mirrors S1 exactly
 * (upsert + watermark stale-delete); this module gives loaders what staging
 * alone cannot:
 *
 *   - Canonical content hashing (stable across jsonb key reordering) so a
 *     staged row carries a source-content fingerprint (`content_hash`).
 *   - VERSIONED consumed fingerprints on id_map: a loader records what it
 *     consumed (staged hash, or a combined hash for composite inputs) plus
 *     its own LOGIC VERSION. A staged hash alone is insufficient — when
 *     transform logic changes, unchanged S1 rows must be reprocessed into
 *     the corrected S2 shape, so bumping the loader's logic version makes
 *     every affected row reconcile on its next run.
 *   - Change classification (new / changed / unchanged) so re-runs skip
 *     unchanged rows cheaply — no per-row storage reads.
 *   - `--force-reconcile`: explicit operational escape hatch that ignores
 *     matching fingerprints for one run (emergency repair / validation)
 *     without changing source data or mappings.
 *   - A generic deletion sweep: id_map entries whose S1 source vanished from
 *     staging get a per-entity policy applied (hard-delete through storage /
 *     deactivate / report-only) with typed findings for the orchestrator.
 *   - The standard aggregates-only loader result contract (summary counters,
 *     reject-gate status, verify status, blocking findings).
 *
 * Conflict policy during the dual-run: S2 is shadow/read-only, so S1 WINS —
 * converted loaders overwrite migration-owned rows unconditionally when the
 * source changed. Output stays AGGREGATES ONLY (HIPAA boundary).
 *
 * Import direction (no cycles): staging.ts → sync.ts → idmap.ts/loader-utils.
 */
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { db } from "../../../server/storage/db";
import { sql, type SQL } from "drizzle-orm";
import { deleteMapping, getMappings, markSourceDeleted, type MappingInfo } from "./idmap";
import type { RejectLog } from "./loader-utils";

// ---------------------------------------------------------------------------
// Canonical hashing
// ---------------------------------------------------------------------------

/**
 * Deterministic JSON serialization: object keys recursively sorted, arrays
 * kept in order, `undefined` treated like JSON.stringify does (dropped in
 * objects, null in arrays). Postgres jsonb REORDERS object keys, so any
 * hash meant to survive a store/read round-trip must canonicalize first.
 */
export function canonicalJson(v: unknown): string {
  if (v === undefined) return "null";
  if (v === null || typeof v !== "object") {
    const s = JSON.stringify(v);
    return s === undefined ? "null" : s; // functions/symbols → null (never staged)
  }
  if (Array.isArray(v)) return `[${v.map((x) => canonicalJson(x === undefined ? null : x)).join(",")}]`;
  const o = v as Record<string, unknown>;
  const parts: string[] = [];
  for (const k of Object.keys(o).sort()) {
    if (o[k] === undefined) continue;
    parts.push(`${JSON.stringify(k)}:${canonicalJson(o[k])}`);
  }
  return `{${parts.join(",")}}`;
}

export function sha256Hex(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

/** Canonical content hash of any JSON-safe value (see canonicalJson). */
export function contentHashOf(v: unknown): string {
  return sha256Hex(canonicalJson(v));
}

// ---------------------------------------------------------------------------
// Consumed fingerprints
// ---------------------------------------------------------------------------

/**
 * Derive ONE effective consumed fingerprint from multiple staged hashes
 * (e.g. a cardcheck definition node + its disclaimer/custom-field nodes).
 * Label each part so absence is distinguishable ([["def", h1], ["disc", null]]
 * differs from [["def", h1]]). A null/undefined hash (source row absent or
 * staged before hashes existed) is a distinct sentinel — it participates in
 * the combination rather than being skipped.
 *
 * Single-source loaders should use the staged content_hash DIRECTLY as the
 * consumed fingerprint (no wrapping) — it keeps id_map values SQL-joinable
 * against staging for debugging.
 */
export function combineFingerprints(parts: Array<[label: string, hash: string | null | undefined]>): string {
  const obj: Record<string, string | null> = {};
  for (const [label, hash] of parts) {
    if (label in obj) throw new Error(`combineFingerprints: duplicate label "${label}"`);
    obj[label] = hash ?? null;
  }
  return contentHashOf(obj);
}

// ---------------------------------------------------------------------------
// Change classification
// ---------------------------------------------------------------------------

export type RowDisposition = "new" | "changed" | "unchanged";

/**
 * Classify one mapped source row for this run. "unchanged" is the cheap
 * fast path — the loader may skip the row entirely (no storage reads).
 *
 *   - no mapping                         → new
 *   - stub mapping                       → changed (real loader must enrich)
 *   - force-reconcile run                → changed (explicit escape hatch)
 *   - expected fingerprint null          → changed (row staged before hashes
 *                                          existed — never fast-skip on null)
 *   - fingerprint mismatch               → changed (S1 edited the source)
 *   - logic-version mismatch             → changed (loader transform changed)
 *   - otherwise                          → unchanged
 */
export function classifyRow(
  mapping: Pick<MappingInfo, "stub" | "consumedFingerprint" | "logicVersion"> | undefined,
  expectedFingerprint: string | null,
  logicVersion: number,
  forceReconcile: boolean,
): RowDisposition {
  if (!mapping) return "new";
  if (mapping.stub) return "changed";
  if (forceReconcile) return "changed";
  if (expectedFingerprint == null) return "changed";
  if (mapping.consumedFingerprint !== expectedFingerprint) return "changed";
  if (mapping.logicVersion !== logicVersion) return "changed";
  return "unchanged";
}

/**
 * Batch/page classification helper: classify one page of staged rows against
 * id_map without materializing anything beyond the page (getMappings chunks
 * its IN-queries). Returns the mappings too so callers resolve fast-path
 * rows (e.g. fill intra-run caches) without a second query.
 */
export async function classifyMapped(
  entity: string,
  rows: Array<{ s1Id: number; fingerprint: string | null }>,
  logicVersion: number,
  forceReconcile: boolean,
): Promise<{ dispositions: Map<number, RowDisposition>; mappings: Map<number, MappingInfo> }> {
  const mappings = await getMappings(entity, rows.map((r) => r.s1Id));
  const dispositions = new Map<number, RowDisposition>();
  for (const r of rows) {
    dispositions.set(r.s1Id, classifyRow(mappings.get(r.s1Id), r.fingerprint, logicVersion, forceReconcile));
  }
  return { dispositions, mappings };
}

// ---------------------------------------------------------------------------
// Standard CLI flags
// ---------------------------------------------------------------------------

/** `--force-reconcile`: ignore matching consumed fingerprints for this run.
 * Ordinary adoption/ownership safeguards still apply — this only disables
 * the unchanged fast path, it never changes source data or mappings. */
export function parseForceReconcile(argv: string[] = process.argv): boolean {
  return argv.includes("--force-reconcile");
}

/** `--allow-findings kind1,kind2`: per-run operator acknowledgment of typed
 * sync findings (mirrors --allow-rejects). Unacknowledged findings BLOCK. */
export function parseAllowedFindings(argv: string[] = process.argv): string[] {
  const i = argv.indexOf("--allow-findings");
  return i >= 0 && argv[i + 1] ? argv[i + 1].split(",").map((s) => s.trim()).filter(Boolean) : [];
}

// ---------------------------------------------------------------------------
// Typed sync findings
// ---------------------------------------------------------------------------

/** A mapped S1 source row vanished from staging (deleted in S1) and the
 * entity's deletion policy is report-only — needs an operator ruling. */
export const FINDING_DELETED_IN_S1 = "deleted_in_s1";

export interface SyncFinding {
  kind: string;
  entity: string;
  s1Id: number;
  s2Id?: string;
  detail?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Deletion sweep
// ---------------------------------------------------------------------------

export type DeletionDecision =
  | { action: "delete"; apply: () => Promise<void> }
  | { action: "deactivate"; apply: () => Promise<void> }
  | { action: "report-only"; detail?: Record<string, unknown> };

export interface DeletionCandidate {
  entity: string;
  s1Id: number;
  s2Id: string;
  loader: string;
}

export interface DeletionSweepOptions {
  entity: string;
  /** Restrict the sweep to mappings recorded by these loaders (id_map.loader).
   * Strongly recommended — an entity can be shared by several writers and a
   * loader must only sweep mappings whose source IT consumes. */
  loaders?: string[];
  /** SQL yielding the CURRENT staged source ids as column `s1_id` (anti-join
   * runs in the database — no whole-table materialization). */
  sourceSql?: SQL;
  /** Explicit current-source id set for composite/ruled sources (e.g. staged
   * bundle nids ∪ election-referenced nids). With BOTH given, a mapping is
   * current if it appears in EITHER. */
  sourceIds?: Set<number>;
  dryRun: boolean;
  /** Per-entity policy. `delete` = hard-delete the S2 row through storage in
   * `apply` (must be idempotent — a retry after a partial failure re-runs it);
   * the framework then removes the mapping. `deactivate` = act in `apply`;
   * the framework stamps s1_deleted_at so re-sweeps skip it (idempotent).
   * `report-only` = touch nothing, emit a typed finding EVERY run until the
   * operator resolves or allows it. */
  policy: (c: DeletionCandidate) => Promise<DeletionDecision>;
}

export interface DeletionSweepResult {
  candidates: number;
  deleted: number;
  deactivated: number;
  reportOnly: number;
  /** Previously deactivated (s1_deleted_at already stamped) — skipped. */
  alreadyHandled: number;
  findings: SyncFinding[];
}

/**
 * Find non-stub id_map entries whose S1 source is GONE from staging and apply
 * the entity's deletion policy. Stub mappings are never swept (they are
 * placeholders created by dependent loaders, not migrated rows).
 *
 * Bookkeeping per action:
 *   delete      → apply() (storage delete), then the mapping is removed —
 *                 provenance for a hard-deleted row is gone by design.
 *   deactivate  → apply(), then s1_deleted_at is stamped; the mapping and
 *                 provenance stay intact and re-sweeps count it alreadyHandled.
 *   report-only → mapping/provenance untouched; a typed finding is emitted
 *                 every run until resolved (blocking unless --allow-findings).
 */
export async function sweepDeletions(opts: DeletionSweepOptions): Promise<DeletionSweepResult> {
  if (!opts.sourceSql && !opts.sourceIds) {
    throw new Error(`sweepDeletions(${opts.entity}): one of sourceSql/sourceIds is required`);
  }
  const loaderFilter =
    opts.loaders && opts.loaders.length > 0
      ? sql` AND m.loader IN (${sql.join(opts.loaders.map((l) => sql`${l}`), sql`, `)})`
      : sql``;
  const sourceFilter = opts.sourceSql
    ? sql` AND NOT EXISTS (SELECT 1 FROM (${opts.sourceSql}) src WHERE src.s1_id = m.s1_id)`
    : sql``;
  const res = await db.execute(sql`
    SELECT m.s1_id, m.s2_id, m.loader, m.s1_deleted_at
      FROM s1_staging.id_map m
     WHERE m.entity = ${opts.entity} AND m.stub = false${loaderFilter}${sourceFilter}
     ORDER BY m.s1_id
  `);
  const rows = (res as unknown as {
    rows: Array<{ s1_id: string | number; s2_id: string; loader: string; s1_deleted_at: string | Date | null }>;
  }).rows;

  const result: DeletionSweepResult = {
    candidates: 0,
    deleted: 0,
    deactivated: 0,
    reportOnly: 0,
    alreadyHandled: 0,
    findings: [],
  };
  for (const row of rows) {
    const s1Id = Number(row.s1_id);
    if (opts.sourceIds?.has(s1Id)) continue; // still current per the explicit set
    result.candidates++;
    if (row.s1_deleted_at != null) {
      result.alreadyHandled++;
      continue;
    }
    const candidate: DeletionCandidate = { entity: opts.entity, s1Id, s2Id: row.s2_id, loader: row.loader };
    const decision = await opts.policy(candidate);
    if (decision.action === "delete") {
      if (!opts.dryRun) {
        await decision.apply();
        await deleteMapping(opts.entity, s1Id);
      }
      result.deleted++;
    } else if (decision.action === "deactivate") {
      if (!opts.dryRun) {
        await decision.apply();
        await markSourceDeleted(opts.entity, s1Id);
      }
      result.deactivated++;
    } else {
      result.reportOnly++;
      result.findings.push({
        kind: FINDING_DELETED_IN_S1,
        entity: opts.entity,
        s1Id,
        s2Id: row.s2_id,
        detail: { action: "report-only", loader: row.loader, ...decision.detail },
      });
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Standard loader result contract (aggregates only)
// ---------------------------------------------------------------------------

export interface SyncSummary {
  created: number;
  updated: number;
  unchanged: number;
  deleted: number;
  deactivated: number;
  reportOnly: number;
  rejected: number;
}

export function emptySummary(): SyncSummary {
  return { created: 0, updated: 0, unchanged: 0, deleted: 0, deactivated: 0, reportOnly: 0, rejected: 0 };
}

export interface LoaderResult {
  loader: string;
  logicVersion: number;
  dryRun: boolean;
  /** True when --force-reconcile was used — reports must say so. */
  forceReconcile: boolean;
  summary: SyncSummary;
  rejectGate: {
    status: "pass" | "fail";
    counts: Record<string, number>;
    allowed: string[];
    disallowed: Array<{ reason: string; count: number }>;
  };
  verify: { status: "pass" | "fail"; failures: number };
  findings: SyncFinding[];
  /** Findings whose kind was NOT allowed via --allow-findings. Non-empty ⇒
   * the run fails (the orchestrator makes these blocking by run mode). */
  blockingFindings: SyncFinding[];
  /** Existing domain detail (per-vocab stats, reject samples, ...) — nested,
   * never discarded. */
  detail: Record<string, unknown>;
}

export function buildLoaderResult(args: {
  loader: string;
  logicVersion: number;
  dryRun: boolean;
  forceReconcile: boolean;
  summary: SyncSummary;
  rejects?: RejectLog;
  allowedRejects?: string[];
  verifyFailures: number;
  findings?: SyncFinding[];
  allowedFindings?: string[];
  detail?: Record<string, unknown>;
}): LoaderResult {
  const counts = args.rejects?.counts ?? {};
  const allowed = args.allowedRejects ?? [];
  const disallowed = args.rejects ? args.rejects.disallowedReasons(allowed) : [];
  const findings = args.findings ?? [];
  const allowedFindings = new Set(args.allowedFindings ?? []);
  const summary = { ...args.summary, rejected: Object.values(counts).reduce((a, b) => a + b, 0) };
  return {
    loader: args.loader,
    logicVersion: args.logicVersion,
    dryRun: args.dryRun,
    forceReconcile: args.forceReconcile,
    summary,
    rejectGate: { status: disallowed.length > 0 ? "fail" : "pass", counts, allowed, disallowed },
    verify: { status: args.verifyFailures > 0 ? "fail" : "pass", failures: args.verifyFailures },
    findings,
    blockingFindings: findings.filter((f) => !allowedFindings.has(f.kind)),
    detail: args.detail ?? {},
  };
}

/**
 * Print the result (stdout JSON, aggregates only) and optionally write it to
 * S1_RESULT_JSON_PATH — a machine-readable handoff for smokes and the future
 * sync orchestrator (loader stdout also carries progress/log lines).
 */
export function emitLoaderResult(result: LoaderResult): void {
  console.log(JSON.stringify(result, null, 2));
  const p = process.env.S1_RESULT_JSON_PATH;
  if (p) writeFileSync(p, JSON.stringify(result));
}

/** Standard gate: reject-gate fail, verify fail, or blocking findings ⇒ 1. */
export function loaderExitCode(result: LoaderResult): 0 | 1 {
  if (result.rejectGate.status === "fail") return 1;
  if (result.verify.status === "fail") return 1;
  if (result.blockingFindings.length > 0) return 1;
  return 0;
}
