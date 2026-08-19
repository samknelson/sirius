/**
 * S1 → S2 migration: worker beneficiary designations → BAO beneficiaries store.
 *
 * Source (fund-verified): staged `sirius_worker` records' `field_sirius_json`
 * blob, designations at `beneficiaries.primary[]` (keys: name, ssn, phone,
 * address, relationship, pct). The data was staged verbatim but no loader has
 * ever consumed it — this loader closes that gap. Staging staleness vs live
 * S1 is accepted (out of scope by ruling).
 *
 * Target: `data.sitespecific.bao.beneficiaries` on the worker, written
 * replace-all through `storage.baoBeneficiaries.set` (storage layer only).
 *
 * Value policy:
 *   - populated row = non-empty trimmed `name`; padded blank rows are
 *     filtered (counted, and blank-name rows carrying OTHER data are counted
 *     separately for fund triage).
 *   - free text trims; empty strings → absent; `pct` → numeric `percent`.
 *   - SSN/phone values load VERBATIM as the legal designation record even
 *     when they would fail the S2 route schema — those soft mismatches are
 *     counted per field in the report (they matter because the API route
 *     re-validates on the next staff edit), never rejected or remediated.
 *
 * Idempotency & ownership: authorship is recorded in id_map (entity
 * `bao-beneficiaries`, s1_id = worker nid). A re-run refreshes loader-owned
 * lists from staging (including clearing a loader-owned list whose staged
 * side no longer has populated rows); a non-empty list the loader did not
 * write is NEVER clobbered — counted as `list_exists_foreign` and skipped.
 *
 * Sync semantics (Task 292/348 — RUNBOOK §10): the ownership mapping carries
 * a VERSIONED consumed fingerprint derived from the worker's DECODED
 * beneficiary state (never the whole staged row hash — worker rows change
 * for unrelated reasons). The fingerprint distinguishes absent / empty /
 * malformed / populated staged states, so an OWNED worker whose decoded
 * state is unchanged at the current logic version skips Pass 2 entirely —
 * no S2 read, no rewrite, and no clear-sweep read. Fingerprints advance ONLY
 * after successful write/adopt/clear verification (a failed write stays
 * retryable). Pass 1 (decode/classify/counts + annotations) always runs in
 * full — staged counts, soft mismatches, and `unexpected_tier` annotations
 * are recomputed every run. Bump LOGIC_VERSION whenever the transform
 * changes so unchanged S1 workers reprocess; `--force-reconcile` does the
 * same for one run without a code change.
 *
 * Vanished source workers: if an authored mapping's worker nid disappears
 * from staging ENTIRELY (not "present with zero designations" — that still
 * clears), the loader preserves both the S2 list and the authorship mapping
 * and emits a report-only `source_worker_missing` finding. These are signed
 * legal designations; nothing is deleted without a fund ruling. The finding
 * BLOCKS (exit 1) unless acknowledged per run via
 * `--allow-findings source_worker_missing`, and it is stop-the-line for the
 * final freeze run until explicitly ruled. A mapping whose S2 worker row is
 * missing remains the fatal `worker_map_broken` reject (repair id_map).
 *
 * Reject classes (fatal = row-skipping; every class present in a run must be
 * explicitly allowed via --allow-rejects or the run fails):
 *   bad_json              — field_sirius_json present but unparseable (worker skipped)
 *   bad_shape             — beneficiaries/primary/row structure unusable (worker skipped)
 *   worker_unmapped       — worker nid has no (non-stub) id_map row (worker skipped)
 *   pct_unusable          — a populated row's pct is missing/non-numeric (worker skipped)
 *   percent_sum_mismatch  — populated rows' percents don't sum to 100 ± epsilon
 *                           (fund: current data always totals 100 — deviations
 *                           are rejects; worker skipped)
 *   list_exists_foreign   — target worker already has a non-empty list the
 *                           loader does not own (worker skipped, list kept)
 *   worker_map_broken     — an id_map row (worker mapping on the write path,
 *                           or a bao-beneficiaries authorship row on the
 *                           clear path) points at a deleted S2 worker —
 *                           repair the map, never remap silently
 *   write_failed          — a storage read/write failed, on the write path
 *                           OR the clear sweep (sanitized code only; the
 *                           detail's `phase` distinguishes read/write/
 *                           clear-read/clear)
 *   unexpected_tier       — ANNOTATION (worker's primary tier still loads):
 *                           a sibling key under `beneficiaries` other than
 *                           `primary` exists (e.g. a contingent tier S2 does
 *                           not model) — counted per worker, never dropped
 *                           silently. Sibling-tier content is NOT part of the
 *                           consumed fingerprint (only the primary list is
 *                           owned), but the annotation re-fires every run
 *                           because Pass 1 always decodes everything.
 *
 * Pre-scan/abort: every parse/mapping-phase reject class is evaluated BEFORE
 * any write — a disallowed class aborts with nothing written (the standard
 * envelope is still emitted). Write-phase classes (list_exists_foreign,
 * worker_map_broken, write_failed) gate the exit code at the end per the
 * standard contract.
 *
 * Verify gate (built-in reconciliation): recomputes the staged-side counts
 * (workers with a `beneficiaries` key, workers with ≥1 populated row,
 * populated rows) shape-tolerantly at run time and asserts
 *   stagedPopulatedWorkers == written + adopted + fast-skipped + fatal-rejected
 *   populatedRows          == rowsWritten + rowsAdopted + rowsFastSkipped + rowsSkipped
 * plus a re-read of every written/adopted/cleared worker's EXACT list. The
 * staged counts are emitted so the fund can compare against their S1-side
 * numbers. Every fatal reason is in FATAL_REASONS — verification cannot
 * silently inflate when a new class is added (add it to BOTH lists).
 *
 * Ordering: AFTER load-contacts-workers (worker id_map).
 *
 * Output is AGGREGATES ONLY — counts, durations, reject tallies, S1 nids.
 * Never names, SSNs, phones, or any row values (S1 reporting bar).
 *
 * Usage:
 *   npx tsx scripts/s1-migration/load-beneficiaries.ts [--dry-run] \
 *     [--allow-rejects a,b] [--force-reconcile] \
 *     [--allow-findings source_worker_missing]
 */
import { storage } from "../../server/storage/database";
import { withNotificationsSuppressed } from "../../server/middleware/request-context";
import { ensureStagingSchema, recordRun } from "./lib/staging";
import { ensureIdMap, getMappings, putMapping, advanceFingerprints } from "./lib/idmap";
import {
  RejectLog,
  pagedStaged,
  stagedCountOf,
  throttleStorageOpLogs,
} from "./lib/loader-utils";
import { makeProgressLogger } from "./lib/progress";
import {
  buildLoaderResult,
  classifyRow,
  contentHashOf,
  emitLoaderResult,
  emptySummary,
  loaderExitCode,
  parseAllowedFindings,
  parseForceReconcile,
  sweepDeletions,
  type SyncFinding,
} from "./lib/sync";
import {
  BAO_BENEFICIARY_PERCENT_EPSILON,
  type BaoBeneficiary,
  type BaoBeneficiaryList,
} from "../../shared/schema/sitespecific/bao/schema";
import { validateSSN } from "../../shared/utils/ssn";
import { parsePhoneNumber } from "libphonenumber-js";

const DRY_RUN = process.argv.includes("--dry-run");
const LOADER = "t-bao-beneficiaries";
/** id_map entity recording which workers' lists THIS loader wrote. */
const OWNERSHIP_ENTITY = "bao-beneficiaries";
/** Loader logic version — BUMP whenever the decode/normalize/write transform
 * changes so unchanged S1 workers reprocess into the corrected shape on
 * their next run (RUNBOOK §10). */
const LOGIC_VERSION = 1;
const FORCE_RECONCILE = parseForceReconcile();
const ALLOWED_FINDINGS = parseAllowedFindings();
/** An authored mapping's worker nid vanished from staging entirely. The S2
 * list and the mapping are PRESERVED (signed legal designations — deletion
 * needs a fund ruling); report-only, blocking unless explicitly allowed.
 * Distinct from the framework's deleted_in_s1 so operators rule on it as a
 * beneficiary-specific question. */
const FINDING_SOURCE_WORKER_MISSING = "source_worker_missing";
const ALLOWED_REJECTS: string[] = (() => {
  const i = process.argv.indexOf("--allow-rejects");
  return i >= 0 && process.argv[i + 1]
    ? process.argv[i + 1].split(",").map((s) => s.trim()).filter(Boolean)
    : [];
})();

/** Row-skipping (fatal) reject reasons. unexpected_tier is an ANNOTATION —
 * the worker still loads — and must stay out of this list or the clear sweep
 * wrongly preserves stale lists. Reconciliation does NOT sum these counts
 * (clear-sweep failures reject on NON-populated workers): every fatal reject
 * on the populated path also increments `populatedWorkersRejected`, which is
 * what the verify gate reconciles against. A new fatal class on the
 * populated path MUST increment that counter too, or verification fails
 * loudly (never silently inflates). */
const FATAL_REASONS = [
  "bad_json",
  "bad_shape",
  "worker_unmapped",
  "pct_unusable",
  "percent_sum_mismatch",
  "list_exists_foreign",
  "worker_map_broken",
  "write_failed",
] as const;

// ---------------------------------------------------------------------------
// field_sirius_json decoding — tolerate all three staged shapes:
// {value: "..."} object, bare scalar string, and the extra-delta array
// anomaly (first delta wins, surplus deltas are counted).
// ---------------------------------------------------------------------------

interface DecodedJson {
  present: boolean;
  parsed?: unknown;
  parseError: boolean;
  extraDeltas: boolean;
}

function decodeStagedJson(fields: Record<string, unknown>): DecodedJson {
  const raw = fields["field_sirius_json"];
  if (raw == null) return { present: false, parseError: false, extraDeltas: false };
  const isArr = Array.isArray(raw);
  const extraDeltas = isArr && (raw as unknown[]).length > 1;
  let v: unknown = isArr ? (raw as unknown[])[0] : raw;
  if (v && typeof v === "object" && "value" in (v as Record<string, unknown>)) {
    v = (v as Record<string, unknown>).value;
  }
  if (v == null) return { present: false, parseError: false, extraDeltas };
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      return { present: true, parseError: true, extraDeltas };
    }
  }
  return { present: true, parsed: v, parseError: false, extraDeltas };
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/** Trimmed non-empty string or undefined (empty → absent, per value policy). */
function trimmedOrAbsent(v: unknown): string | undefined {
  if (v == null) return undefined;
  const s = String(v).trim();
  return s.length > 0 ? s : undefined;
}

/** `pct` → number. Tolerates numeric strings, a trailing "%", and the legacy
 * whole-number-with-terminal-dot form ("50." → 50, found on real S1 rows);
 * anything else is unusable (hard reject — a designation without a share is
 * not a loadable legal record). */
function parsePct(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const s = v.trim().replace(/%$/, "").trim();
    // `\.\d*` accepts ONLY the terminal-dot legacy form ("50.") alongside
    // real decimals ("50.5"); a bare ".", repeated dots ("50.."), embedded
    // punctuation, and empty values still fall through to pct_unusable.
    if (!/^-?\d+(\.\d*)?$/.test(s)) return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Same validity checks the API route schema applies — used ONLY to count
 * soft mismatches; values load verbatim either way. */
function ssnLooksValid(ssn: string): boolean {
  try {
    return validateSSN(ssn).valid;
  } catch {
    return false;
  }
}
function phoneLooksValid(phone: string): boolean {
  try {
    const parsed = parsePhoneNumber(phone, "US");
    return !!parsed && parsed.isValid();
  } catch {
    return false;
  }
}

function rowEqual(a: BaoBeneficiary, b: BaoBeneficiary): boolean {
  const t = (v: string | undefined) => trimmedOrAbsent(v);
  return (
    t(a.name) === t(b.name) &&
    t(a.ssn) === t(b.ssn) &&
    t(a.phone) === t(b.phone) &&
    t(a.address) === t(b.address) &&
    t(a.relationship) === t(b.relationship) &&
    Number(a.percent) === Number(b.percent)
  );
}
function listsEqual(a: BaoBeneficiaryList, b: BaoBeneficiaryList): boolean {
  return a.length === b.length && a.every((r, i) => rowEqual(r, b[i]));
}

// ---------------------------------------------------------------------------
// Consumed fingerprint — derived from the DECODED beneficiary state, not the
// whole staged row (worker rows change for unrelated reasons: hours, member
// status, addresses...). Absent / empty / malformed / populated staged
// states are all distinguishable; sibling tiers are EXCLUDED (only the
// primary list is owned — annotations re-fire from Pass 1 regardless).
// NaN percents (pct_unusable placeholders) serialize as null via
// canonicalJson, so malformed-percent states fingerprint deterministically.
// ---------------------------------------------------------------------------

type FingerprintState =
  | { state: "absent" }
  | { state: "malformed"; problem: "bad_json" | "beneficiaries_not_object" | "primary_not_array" | "row_not_object" }
  | { state: "parsed"; rows: BaoBeneficiaryList };

function fingerprintOf(s: FingerprintState): string {
  return contentHashOf(s);
}

async function main() {
  const startedAt = new Date();
  await ensureStagingSchema();
  await ensureIdMap();
  throttleStorageOpLogs();

  const report: Record<string, unknown> = { loader: LOADER, dryRun: DRY_RUN, allowedRejects: ALLOWED_REJECTS };
  const rejects = new RejectLog();
  const soft = { ssnInvalid: 0, phoneInvalid: 0, percentOutOfRange: 0 };

  const stagedTotal = await stagedCountOf("sirius_worker");
  report.stagedWorkers = stagedTotal;
  const progress = makeProgressLogger(LOADER, stagedTotal);

  // ── Pass 1 (keyset-paged): decode, parse, classify, fingerprint ──────────
  interface Candidate {
    nid: number;
    rows: BaoBeneficiaryList;
  }
  const candidates: Candidate[] = [];
  /** nids whose staged side we could NOT positively parse (bad_json/bad_shape)
   * — never eligible for the loader-owned clear sweep. */
  const unparseableNids = new Set<number>();
  const allNids: number[] = [];
  /** Consumed fingerprint per staged nid — set for EVERY staged worker. */
  const fpByNid = new Map<number, string>();
  let workersWithJson = 0;
  let extraDeltaArrays = 0;
  let workersWithKey = 0;
  let workersPopulated = 0;
  let populatedRows = 0;
  let blankRowsFiltered = 0;
  let blankNameWithData = 0;
  let rowsSkipped = 0;
  /** Fatal rejects that hit a worker counted in workersPopulated (exactly one
   * per such worker — the pipeline short-circuits). Clear-sweep rejects hit
   * non-populated workers and must NOT touch this counter. */
  let populatedWorkersRejected = 0;

  for await (const page of pagedStaged("sirius_worker")) {
    for (const w of page) {
      progress.add(1);
      allNids.push(w.nid);
      const decoded = decodeStagedJson(w.fields);
      if (decoded.extraDeltas) extraDeltaArrays++;
      if (!decoded.present) {
        fpByNid.set(w.nid, fingerprintOf({ state: "absent" }));
        continue;
      }
      workersWithJson++;
      if (decoded.parseError) {
        rejects.add("bad_json", { nid: w.nid }, w.nid);
        unparseableNids.add(w.nid);
        fpByNid.set(w.nid, fingerprintOf({ state: "malformed", problem: "bad_json" }));
        continue;
      }
      if (!isPlainObject(decoded.parsed)) {
        // parseable, but no object → no beneficiaries key
        fpByNid.set(w.nid, fingerprintOf({ state: "absent" }));
        continue;
      }
      const bens = decoded.parsed["beneficiaries"];
      if (bens === undefined) {
        fpByNid.set(w.nid, fingerprintOf({ state: "absent" }));
        continue;
      }
      workersWithKey++;
      if (!isPlainObject(bens)) {
        rejects.add("bad_shape", { nid: w.nid, problem: "beneficiaries_not_object" }, w.nid);
        unparseableNids.add(w.nid);
        fpByNid.set(w.nid, fingerprintOf({ state: "malformed", problem: "beneficiaries_not_object" }));
        continue;
      }
      const tierKeys = Object.keys(bens).filter((k) => k !== "primary");
      if (tierKeys.length > 0) {
        // ANNOTATION: the primary tier still loads; the extra tier is counted
        // for fund triage, never silently dropped. Tier key names are
        // structural (e.g. "contingent"), not row values — safe to report.
        rejects.add("unexpected_tier", { nid: w.nid, tiers: tierKeys.sort() }, w.nid);
      }
      const primary = bens["primary"];
      if (primary !== undefined && !Array.isArray(primary)) {
        rejects.add("bad_shape", { nid: w.nid, problem: "primary_not_array" }, w.nid);
        unparseableNids.add(w.nid);
        fpByNid.set(w.nid, fingerprintOf({ state: "malformed", problem: "primary_not_array" }));
        continue;
      }
      const entries = (primary ?? []) as unknown[];

      let badShape = false;
      let pctBadRows = 0;
      const rows: BaoBeneficiaryList = [];
      for (const entry of entries) {
        if (!isPlainObject(entry)) {
          badShape = true;
          break;
        }
        const name = trimmedOrAbsent(entry["name"]);
        if (name === undefined) {
          blankRowsFiltered++;
          const hasOther = ["ssn", "phone", "address", "relationship", "pct"].some(
            (k) => trimmedOrAbsent(entry[k]) !== undefined,
          );
          if (hasOther) blankNameWithData++;
          continue;
        }
        const pct = parsePct(entry["pct"]);
        if (pct == null) {
          pctBadRows++;
          rows.push({ name, percent: NaN }); // placeholder — worker rejects below; keeps row counts exact
          continue;
        }
        if (pct < 0 || pct > 100) soft.percentOutOfRange++;
        const row: BaoBeneficiary = { name, percent: pct };
        const ssn = trimmedOrAbsent(entry["ssn"]);
        if (ssn !== undefined) {
          if (!ssnLooksValid(ssn)) soft.ssnInvalid++;
          row.ssn = ssn;
        }
        const phone = trimmedOrAbsent(entry["phone"]);
        if (phone !== undefined) {
          if (!phoneLooksValid(phone)) soft.phoneInvalid++;
          row.phone = phone;
        }
        const address = trimmedOrAbsent(entry["address"]);
        if (address !== undefined) row.address = address;
        const relationship = trimmedOrAbsent(entry["relationship"]);
        if (relationship !== undefined) row.relationship = relationship;
        rows.push(row);
      }
      if (badShape) {
        rejects.add("bad_shape", { nid: w.nid, problem: "row_not_object" }, w.nid);
        unparseableNids.add(w.nid);
        fpByNid.set(w.nid, fingerprintOf({ state: "malformed", problem: "row_not_object" }));
        continue;
      }
      // Fingerprint the fully-decoded state (including empty lists and
      // pct-unusable placeholders — rejected workers never ADVANCE to this
      // fingerprint, so they reprocess and re-reject until the source or the
      // transform changes).
      fpByNid.set(w.nid, fingerprintOf({ state: "parsed", rows }));
      if (rows.length === 0) continue; // key present, nothing populated → clear-sweep candidate

      workersPopulated++;
      populatedRows += rows.length;
      if (pctBadRows > 0) {
        rejects.add("pct_unusable", { nid: w.nid, badRows: pctBadRows, rows: rows.length }, w.nid);
        rowsSkipped += rows.length;
        populatedWorkersRejected++;
        continue;
      }
      const sum = rows.reduce((s, r) => s + r.percent, 0);
      if (Math.abs(sum - 100) > BAO_BENEFICIARY_PERCENT_EPSILON) {
        rejects.add(
          "percent_sum_mismatch",
          { nid: w.nid, sum: Number(sum.toFixed(2)), rows: rows.length },
          w.nid,
        );
        rowsSkipped += rows.length;
        populatedWorkersRejected++;
        continue;
      }
      candidates.push({ nid: w.nid, rows });
    }
  }

  report.workersWithJson = workersWithJson;
  report.extraDeltaArrays = extraDeltaArrays;
  report.blankRowsFiltered = blankRowsFiltered;
  report.blankNameWithData = blankNameWithData;
  // Emitted for the fund to compare against their S1-side numbers.
  report.stagedCounts = {
    workersWithBeneficiariesKey: workersWithKey,
    workersWithPopulatedRows: workersPopulated,
    populatedRows,
  };

  // ── Mapping resolution + pre-scan gate (before ANY write) ────────────────
  progress.phase("pre-scan");
  const workerMap = await getMappings("worker", candidates.map((c) => c.nid));
  const ownershipMap = await getMappings(OWNERSHIP_ENTITY, allNids);

  const writeList: Array<Candidate & { workerId: string }> = [];
  for (const c of candidates) {
    const m = workerMap.get(c.nid);
    if (!m || m.stub) {
      rejects.add("worker_unmapped", { nid: c.nid, stub: m?.stub ?? false }, c.nid);
      rowsSkipped += c.rows.length;
      populatedWorkersRejected++;
      continue;
    }
    writeList.push({ ...c, workerId: m.s2Id });
  }

  {
    const disallowed = rejects.disallowedReasons(ALLOWED_REJECTS);
    if (disallowed.length > 0) {
      report.rejects = rejects.counts;
      report.rejectSamples = rejects.samples;
      report.error =
        "pre-scan abort: disallowed parse/mapping reject class(es) — nothing was written";
      progress.stop();
      emitLoaderResult(
        buildLoaderResult({
          loader: LOADER,
          logicVersion: LOGIC_VERSION,
          dryRun: DRY_RUN,
          forceReconcile: FORCE_RECONCILE,
          summary: emptySummary(),
          rejects,
          allowedRejects: ALLOWED_REJECTS,
          verifyFailures: 0,
          detail: report,
        }),
      );
      console.error(
        `FATAL (pre-scan): reject reason(s) not allowed for this run: ` +
          `${disallowed.map((d) => `${d.reason}=${d.count}`).join(", ")}. ` +
          `Nothing was written. Triage, then re-run with --allow-rejects for the classes you have justified.`,
      );
      process.exit(1);
    }
  }

  // ── Pass 2: write (replace-all through storage; ownership via id_map) ────
  // Consumed-fingerprint fast path (Task 348): an OWNED worker whose decoded
  // staged state is unchanged at the current logic version skips WITHOUT any
  // S2 read — the previous run verified exactly this list. worker_unmapped
  // was already checked above (cheap id_map batch). A broken S2 target
  // behind an unchanged fingerprint surfaces on the next changed/forced run.
  progress.phase("write", writeList.length);
  let workersCreated = 0; // first-time writes (no prior ownership mapping)
  let workersRewritten = 0; // owned rewrites (staged content changed)
  let workersAdopted = 0;
  let rowsWritten = 0;
  let rowsAdopted = 0;
  let fastPathPopulatedSkips = 0;
  let rowsFastSkipped = 0;
  const verifyTargets: Array<{
    nid: number;
    workerId: string;
    expected: BaoBeneficiaryList;
    fingerprint: string;
  }> = [];

  for (const c of writeList) {
    progress.add(1);
    const ownership = ownershipMap.get(c.nid);
    const owned = ownership != null;
    const fp = fpByNid.get(c.nid)!;
    if (ownership && classifyRow(ownership, fp, LOGIC_VERSION, FORCE_RECONCILE) === "unchanged") {
      fastPathPopulatedSkips++;
      rowsFastSkipped += c.rows.length;
      continue;
    }
    let current: BaoBeneficiaryList;
    try {
      current = await storage.baoBeneficiaries.get(c.workerId);
    } catch (err) {
      if (err instanceof Error && err.message === "WORKER_NOT_FOUND") {
        // id_map points at a deleted S2 worker — repair the map, never remap.
        rejects.add("worker_map_broken", { nid: c.nid }, c.nid);
      } else {
        const code = err instanceof Error ? err.constructor.name : "unknown";
        rejects.add("write_failed", { nid: c.nid, phase: "read", code }, c.nid);
      }
      rowsSkipped += c.rows.length;
      populatedWorkersRejected++;
      continue;
    }
    if (current.length > 0 && !owned) {
      // Operator-entered (or otherwise foreign) list — never clobbered.
      rejects.add("list_exists_foreign", { nid: c.nid, existingRows: current.length }, c.nid);
      rowsSkipped += c.rows.length;
      populatedWorkersRejected++;
      continue;
    }
    if (owned && listsEqual(current, c.rows)) {
      workersAdopted++;
      rowsAdopted += c.rows.length;
      verifyTargets.push({ nid: c.nid, workerId: c.workerId, expected: c.rows, fingerprint: fp });
      continue;
    }
    if (DRY_RUN) {
      if (owned) workersRewritten++;
      else workersCreated++;
      rowsWritten += c.rows.length;
      continue;
    }
    try {
      await withNotificationsSuppressed(() => storage.baoBeneficiaries.set(c.workerId, c.rows));
      // Authorship only — the fingerprint advances AFTER verification (a new
      // mapping starts with a NULL consumed fingerprint until then).
      await putMapping(OWNERSHIP_ENTITY, c.nid, c.workerId, { stub: false, loader: LOADER });
      if (owned) workersRewritten++;
      else workersCreated++;
      rowsWritten += c.rows.length;
      verifyTargets.push({ nid: c.nid, workerId: c.workerId, expected: c.rows, fingerprint: fp });
    } catch (err) {
      // Sanitized: class/code only — never raw error text (S1 reporting bar).
      const code = err instanceof Error ? err.constructor.name : "unknown";
      rejects.add("write_failed", { nid: c.nid, phase: "write", code }, c.nid);
      rowsSkipped += c.rows.length;
      populatedWorkersRejected++;
    }
  }

  // ── Clear sweep: loader-owned lists whose staged side no longer has any
  // populated designation refresh to empty (replace-all semantics). Only
  // workers whose staged side positively parsed to zero populated rows are
  // eligible — bad_json/bad_shape/fatally-rejected workers keep their lists.
  // ANNOTATIONS (unexpected_tier) do NOT block clearing: a worker whose
  // staged blob now holds only an out-of-scope sibling tier has zero staged
  // primary designations, and keeping a stale loader-written primary list
  // would contradict replace-all semantics.
  // Fingerprint fast path: an owned worker whose staged state is still the
  // same absent/empty state that was verified cleared last run skips the
  // read entirely. A worker read as ALREADY empty advances its fingerprint
  // directly — the read IS the verification (this backfills fingerprints
  // for historically-cleared workers, which would otherwise re-read forever).
  const candidateNids = new Set(candidates.map((c) => c.nid));
  let workersCleared = 0;
  let workersAlreadyEmpty = 0;
  let fastPathClearSkips = 0;
  /** Advances with no verify-pass target (already-empty reads) — the read is
   * the verification; merged into the post-verify advance batch. */
  const directAdvance: Array<{ s1Id: number; fingerprint: string | null }> = [];
  {
    const clearable = allNids.filter(
      (nid) =>
        ownershipMap.has(nid) &&
        !candidateNids.has(nid) &&
        !unparseableNids.has(nid) &&
        !rejects.hasAnyIn(nid, FATAL_REASONS),
    );
    for (const nid of clearable) {
      const ownership = ownershipMap.get(nid)!;
      const fp = fpByNid.get(nid)!;
      if (classifyRow(ownership, fp, LOGIC_VERSION, FORCE_RECONCILE) === "unchanged") {
        fastPathClearSkips++;
        continue;
      }
      const workerId = ownership.s2Id;
      let current: BaoBeneficiaryList;
      try {
        current = await storage.baoBeneficiaries.get(workerId);
      } catch (err) {
        // NEVER silently skipped: a loader-owned mapping we cannot read is a
        // triage item exactly like the write-path equivalent. Row-neutral by
        // design — these workers are not in workersPopulated, so they must
        // not touch populatedWorkersRejected/rowsSkipped.
        if (err instanceof Error && err.message === "WORKER_NOT_FOUND") {
          rejects.add("worker_map_broken", { nid, phase: "clear" }, nid);
        } else {
          const code = err instanceof Error ? err.constructor.name : "unknown";
          rejects.add("write_failed", { nid, phase: "clear-read", code }, nid);
        }
        continue;
      }
      if (current.length === 0) {
        workersAlreadyEmpty++;
        if (!DRY_RUN) directAdvance.push({ s1Id: nid, fingerprint: fp });
        continue;
      }
      if (DRY_RUN) {
        workersCleared++;
        continue;
      }
      try {
        await withNotificationsSuppressed(() => storage.baoBeneficiaries.set(workerId, []));
      } catch (err) {
        // Sanitized: class/code only — never raw error text (S1 reporting bar).
        if (err instanceof Error && err.message === "WORKER_NOT_FOUND") {
          rejects.add("worker_map_broken", { nid, phase: "clear" }, nid);
        } else {
          const code = err instanceof Error ? err.constructor.name : "unknown";
          rejects.add("write_failed", { nid, phase: "clear", code }, nid);
        }
        continue;
      }
      workersCleared++;
      verifyTargets.push({ nid, workerId, expected: [], fingerprint: fp });
    }
  }

  const workersWritten = workersCreated + workersRewritten;
  report.workersWritten = workersWritten;
  report.workersCreated = workersCreated;
  report.workersRewritten = workersRewritten;
  report.workersAdopted = workersAdopted;
  report.workersCleared = workersCleared;
  report.workersAlreadyEmpty = workersAlreadyEmpty;
  report.rowsWritten = rowsWritten;
  report.rowsAdopted = rowsAdopted;
  report.rowsSkipped = rowsSkipped;
  report.rowsFastSkipped = rowsFastSkipped;
  report.fastPathSkips = fastPathPopulatedSkips + fastPathClearSkips;
  report.fastPathDetail = { populated: fastPathPopulatedSkips, clear: fastPathClearSkips };
  report.softMismatches = soft;

  // ── Verify: re-read every written/adopted/cleared list (EXACT match) ─────
  let verifyFailures = 0;
  const verifyFailedNids = new Set<number>();
  if (!DRY_RUN) {
    progress.phase("verify", verifyTargets.length);
    for (const t of verifyTargets) {
      progress.add(1);
      try {
        const got = await storage.baoBeneficiaries.get(t.workerId);
        if (!listsEqual(got, t.expected)) {
          console.error(`VERIFY: worker nid ${t.nid} list does not match the loaded designation set`);
          verifyFailures++;
          verifyFailedNids.add(t.nid);
        }
      } catch {
        console.error(`VERIFY: worker nid ${t.nid} unreadable after load`);
        verifyFailures++;
        verifyFailedNids.add(t.nid);
      }
    }
  }

  // ---- advance consumed fingerprints — ONLY after write/adopt/clear
  // verification passed (task mandate; failed rows stay retryable) ----
  if (!DRY_RUN) {
    const advance = [
      ...verifyTargets
        .filter((t) => !verifyFailedNids.has(t.nid))
        .map((t) => ({ s1Id: t.nid, fingerprint: t.fingerprint as string | null })),
      ...directAdvance,
    ];
    await advanceFingerprints(OWNERSHIP_ENTITY, advance, LOGIC_VERSION);
  }

  // ---- vanished-source sweep: authored mappings whose worker nid is gone
  // from staging ENTIRELY (distinct from "present with zero designations",
  // which clears above). Policy: report-only — list + mapping preserved;
  // stop-the-line for the final freeze run until explicitly ruled. No loader
  // filter: authorship rows seeded by dev tooling are still THIS loader's
  // ownership domain. ----
  const findings: SyncFinding[] = [];
  const sweep = await sweepDeletions({
    entity: OWNERSHIP_ENTITY,
    sourceIds: new Set(allNids),
    dryRun: DRY_RUN,
    policy: async () => ({
      action: "report-only",
      detail: {
        reason:
          "source worker vanished from staging; beneficiary designations are legal records — " +
          "S2 list and authorship mapping preserved pending a fund ruling",
      },
    }),
  });
  const summary = emptySummary();
  findings.push(...sweep.findings.map((f) => ({ ...f, kind: FINDING_SOURCE_WORKER_MISSING })));
  report.sweep = { candidates: sweep.candidates, alreadyHandled: sweep.alreadyHandled };

  // Reconciliation — every populated staged worker/row must be accounted for
  // by a write, an adopt, a fast-path skip, or a counted fatal reject on the
  // populated path (exactly one per worker by construction). Clear-sweep
  // rejects hit non-populated workers and are deliberately outside this
  // equation — they still gate the exit code via --allow-rejects like every
  // other class.
  const reconciliation = {
    stagedPopulatedWorkers: workersPopulated,
    accountedWorkers: workersWritten + workersAdopted + fastPathPopulatedSkips + populatedWorkersRejected,
    populatedWorkersRejected,
    fastPathPopulatedSkips,
    stagedPopulatedRows: populatedRows,
    accountedRows: rowsWritten + rowsAdopted + rowsFastSkipped + rowsSkipped,
    workersOk:
      workersPopulated === workersWritten + workersAdopted + fastPathPopulatedSkips + populatedWorkersRejected,
    rowsOk: populatedRows === rowsWritten + rowsAdopted + rowsFastSkipped + rowsSkipped,
  };
  report.reconciliation = reconciliation;
  if (!reconciliation.workersOk) {
    console.error(
      `VERIFY: staged populated workers (${reconciliation.stagedPopulatedWorkers}) != written+adopted+fastSkipped+rejected (${reconciliation.accountedWorkers})`,
    );
    verifyFailures++;
  }
  if (!reconciliation.rowsOk) {
    console.error(
      `VERIFY: staged populated rows (${reconciliation.stagedPopulatedRows}) != written+adopted+fastSkipped+skipped (${reconciliation.accountedRows})`,
    );
    verifyFailures++;
  }

  progress.stop();
  report.rejects = rejects.counts;
  report.rejectSamples = rejects.samples;
  report.verifyFailures = verifyFailures;
  report.elapsedSeconds = Math.round((Date.now() - startedAt.getTime()) / 1000);

  // Standard sync summary (Task 348): created = first-time writes, updated =
  // owned rewrites + clears, unchanged = adopts + fast-path skips +
  // verified-already-empty. Legacy counters remain under detail.
  summary.created = workersCreated;
  summary.updated = workersRewritten + workersCleared;
  summary.unchanged = workersAdopted + fastPathPopulatedSkips + fastPathClearSkips + workersAlreadyEmpty;
  summary.deleted = sweep.deleted;
  summary.deactivated = sweep.deactivated;
  summary.reportOnly = sweep.reportOnly;

  const result = buildLoaderResult({
    loader: LOADER,
    logicVersion: LOGIC_VERSION,
    dryRun: DRY_RUN,
    forceReconcile: FORCE_RECONCILE,
    summary,
    rejects,
    allowedRejects: ALLOWED_REJECTS,
    verifyFailures,
    findings,
    allowedFindings: ALLOWED_FINDINGS,
    detail: report,
  });
  emitLoaderResult(result);
  if (!DRY_RUN) {
    await recordRun(
      startedAt,
      { loader: LOADER, allowedRejects: ALLOWED_REJECTS, forceReconcile: FORCE_RECONCILE },
      result as unknown as Record<string, unknown>,
    );
  }

  if (result.rejectGate.status === "fail") {
    console.error(
      `FAIL: reject reason(s) not allowed for this run: ${result.rejectGate.disallowed.map((d) => `${d.reason}=${d.count}`).join(", ")}. ` +
        `Every expected reject class must be explicitly allowed via --allow-rejects.`,
    );
  }
  if (result.blockingFindings.length > 0) {
    console.error(
      `FAIL: ${result.blockingFindings.length} blocking sync finding(s) (${[...new Set(result.blockingFindings.map((f) => f.kind))].join(", ")}). ` +
        `source_worker_missing preserves the S2 list + mapping and needs a fund ruling — ` +
        `acknowledge per run via --allow-findings source_worker_missing. STOP-THE-LINE for the final freeze run.`,
    );
  }
  process.exit(loaderExitCode(result));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
