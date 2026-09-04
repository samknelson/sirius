/**
 * S1 → S2 migration: cardcheck (signed authorization) records →
 * cardcheck_definitions + cardchecks.
 *
 * Source (fund-verified, 2026-08 note): cardchecks are staged `sirius_log`
 * rows whose `field_sirius_category` is `cardcheck` — that category filter is
 * the ONLY correct discriminator (never `field_sirius_type`, never the
 * handler). Definitions are staged `sirius_json_definition` rows with
 * `field_sirius_type = 'sirius:cardcheck'` (4 in production: two payroll
 * deduction forms, two arbitration agreements). ~1,114 records at the last
 * fund pull; cardchecks gate benefit eligibility, so fidelity and
 * reconciliation matter more than volume.
 *
 * Source semantics honored here:
 *   - `field_sirius_type` on the record IS the status (unsigned | signed |
 *     revoked), mutated in place. An `unsigned` record may be never-started
 *     or a wiped previously-signed one — no history is inferred; provenance
 *     in `data` flags current-state-only.
 *   - `field_sirius_log_handler` is ONE multi-delta reference holding BOTH
 *     the definition nid and the worker nid. Each target resolves by its
 *     staged row's bundle (`sirius_json_definition` → definition,
 *     `sirius_worker` → worker) — NEVER by delta index (S1 happens to push
 *     definition first but nothing enforces it).
 *   - Some records legitimately have no worker target (`[No Handler]`) —
 *     they are a counted, tolerated skip class (`noWorkerHandler`), never a
 *     reject and never mis-assigned. `cardchecks.worker_id` is NOT NULL, so
 *     they cannot load; the count is the audit trail. A MAPPED record whose
 *     worker handler has since vanished is different — that is the fatal
 *     `mapped_worker_lost` reject (S2 cannot follow; triage the S1 edit).
 *   - Worker resolution: S1 nid → id_map (entity `worker`, non-stub) → S2
 *     worker id. NEVER by sirius_id (not unique in S1).
 *   - `field_sirius_json` payload (`cardcheck.acceptance/.revocation/.bu/
 *     .title`, `disclaimer[nid].acceptances`, `esig`, `customfield`) lands
 *     verbatim under `cardchecks.data.s1` for audit. Offline-signing keys
 *     (zero prod rows) are tolerated + counted, never built for. Promoting
 *     esig blobs to real `esigs` rows is out of scope (S1 staff uids have no
 *     S2 user mapping).
 *
 * Status map: unsigned→pending, signed→signed, revoked→revoked. Signed date
 * comes from `cardcheck.acceptance.ts`.
 *
 * Sync semantics (Task 292/348 — RUNBOOK §10): RECONCILING loader.
 *   - RECORDS carry a versioned consumed fingerprint on id_map entity
 *     `cardcheck`: combine(staged row content_hash, resolved S2 worker id,
 *     resolved S2 definition id). A mapped record re-parses and UPDATES the
 *     S2 row through storage whenever staged payload/status, worker or
 *     definition resolution, or the loader logic version changes — in-place
 *     S1 transitions (unsigned → signed → revoked, wiped-back-to-unsigned)
 *     converge on the next sync and immediately affect eligibility reads
 *     (CARDCHECK_SAVED fires on signed-ness flips, by design). Unchanged
 *     records fast-skip without parsing or touching S2. Definition CONTENT
 *     changes do not enter record fingerprints — records embed only the
 *     definition IDENTITY (data.s1.definitionNid + cardcheck_definition_id);
 *     identity is covered via the resolved S2 definition id.
 *   - DEFINITIONS are reconciliation entities too (id_map entity
 *     `cardcheck-definition`): a COMPOSITE fingerprint over the definition
 *     node's content_hash plus its resolved disclaimer/customfield pointer
 *     nodes' content_hashes, so editing a disclaimer body re-processes the
 *     definition even though the definition node itself is untouched.
 *     Definitions-pass reject classes fire when a definition is PROCESSED;
 *     an unchanged definition fast-skips and does not re-emit them.
 *   - Fingerprints advance ONLY after verification (exact re-read for
 *     writes; the compare-read is the verification for adopts). Failed rows
 *     stay retryable. Bump LOGIC_VERSION (shared by both passes) whenever
 *     either transform changes; `--force-reconcile` reprocesses everything
 *     once without a code change.
 *   - DELETION IS REPORT-ONLY, PENDING A RETENTION RULING: mapped cardcheck
 *     nids absent from the current staged in-scope set are preserved in S2
 *     with their mappings intact and emitted as `pending_retention` findings
 *     (with per-status aggregate counts). The loader NEVER hard-deletes,
 *     revokes, or fabricates lifecycle history for a signed authorization —
 *     absence in S1 is not evidence of revocation. Blocking unless
 *     acknowledged per run via `--allow-findings pending_retention`;
 *     STOP-THE-LINE for the final freeze run until fund/legal rules on
 *     retention. Vanished definitions emit standard `deleted_in_s1`
 *     findings (also report-only).
 *
 * Fund defect classes are surfaced as counts, never silent picks/drops
 * (counted when a record is PARSED — i.e. new/changed records this run):
 *   (a) `dualAcceptanceMismatch` — `cardcheck.acceptance.ts` disagrees with
 *       `disclaimer[nid].acceptances[0]` (both kept in data, flagged);
 *   (b) `signedWithoutEsig` — signed/revoked record with no esig blob (the
 *       768-vs-770 mismatch);
 *   (c) `noWorkerHandler` — records with no worker handler target;
 *   (d) `handler_dangling` (no unresolved target staged at all — deleted S1
 *       nodes) vs `handler_unresolved` (staged but unmapped — a real gap).
 *
 * Reject classes (definitions pass — definition still upserts unless noted):
 *   definition_title_missing   — staged def node has no title (definition
 *                                SKIPPED; its records then reject)
 *   definition_json_unparseable— def's own field_sirius_json unusable (raw
 *                                string kept in data)
 *   disclaimer_missing         — disclaimer_nid points at nothing staged
 *   disclaimer_text_unlocated  — disclaimer node staged but no text found by
 *                                the shape-tolerant reader (body stays null,
 *                                raw JSON kept in data — triage the shape)
 *   customfield_missing        — customfield_nid points at nothing staged
 *   definition_write_failed    — storage write failed (sanitized code)
 *
 * Reject classes (records pass — all row-skipping/FATAL):
 *   status_unknown       — field_sirius_type is not unsigned|signed|revoked
 *   definition_unresolved— no handler target resolves to a loaded cardcheck
 *                          definition
 *   ambiguous_definition — >1 handler target resolves to a definition
 *   handler_unresolved   — worker cannot be resolved and ≥1 unresolved
 *                          target IS staged (worker staged but unmapped, or
 *                          a foreign-bundle target)
 *   handler_dangling     — worker cannot be resolved and NO unresolved
 *                          target is staged (deleted S1 nodes)
 *   mapped_worker_lost   — a MAPPED record's worker handler no longer
 *                          resolves at all (S1 wiped it); the loaded S2 row
 *                          cannot follow (worker_id NOT NULL) — triage
 *   bad_json             — field_sirius_json present but unparseable
 *   duplicate_signed     — storage DUPLICATE_SIGNED validation (a signed
 *                          cardcheck for this worker+definition already
 *                          exists — S1-side duplicate, triage; fires on
 *                          create AND on update-to-signed)
 *   create_failed        — storage create failed (sanitized code only)
 *   update_failed        — storage update failed, or the mapped S2 row is
 *                          gone (`code: "target_missing"` — repair id_map;
 *                          sanitized code only)
 *
 * Reconciliation & verify gate: the staged-side per-definition × per-status
 * table is recomputed at run time and emitted (`stagedByDefinition`) so the
 * fund can diff it against their S1 baseline (Kaiser PDF 777 / Health Net
 * PDF 318 / HN arb 12 / Kaiser arb 7 — drift expected, S1 is live). Per
 * cell, staged == loaded (created+updated+adopted+fastSkipped) + rejected +
 * skipped is asserted. Verification is EXACT, not existence-only:
 *   - every mapped nid resolves to an existing cardchecks row, and no two
 *     cardcheck mappings share an S2 row (uniqueness);
 *   - every row WRITTEN this run (created/updated) is re-read and compared
 *     field-by-field (status, signed date, worker, definition, data);
 *     adopted rows were verified by their compare-read;
 *   - every definition resolves to exactly one S2 row by sirius_id, and
 *     definitions written this run re-read with exact name/body/data;
 *   - advanced fingerprints re-read and asserted stamped.
 * Any verify mismatch exits non-zero.
 *
 * Idempotent: unchanged sources fast-skip; changed sources converge S2
 * through storage (never raw SQL).
 *
 * PREREQUISITE: the `cardcheck` component (enabledByDefault: false) must be
 * enabled on the target with its tables provisioned — the preflight fails
 * loud otherwise. Component enable + app restart is an operator step
 * (boot-time cache). Ordering: AFTER load-contacts-workers (worker id_map);
 * definitions load before records inside this loader.
 *
 * REJECT POLICY (fail loud): every reject reason present in the run must be
 * explicitly allowed via `--allow-rejects r1,r2,...` or the run exits 1
 * (after the full report).
 *
 * Pass --migration-mode to run every write inside a charge-plugin-suppressed
 * scope (loader convention); notification suppression always applies.
 *
 * Usage:
 *   npx tsx scripts/s1-migration/load-cardchecks.ts [--dry-run] \
 *     [--allow-rejects r1,r2] [--migration-mode] [--force-reconcile] \
 *     [--allow-findings pending_retention,deleted_in_s1]
 *
 * Output is AGGREGATES ONLY plus opaque S1 nids. Names, esig content, and
 * payload values are NEVER logged (S1 reporting bar). Definition titles are
 * form names (fund-published config, not member data) and appear in the
 * reconciliation table for diffability.
 */
import { db } from "../../server/storage/db";
import { storage } from "../../server/storage/database";
import { sql } from "drizzle-orm";
import {
  withNotificationsSuppressed,
  withChargePluginsSuppressed,
} from "../../server/middleware/request-context";
import { ensureStagingSchema, recordRun } from "./lib/staging";
import {
  ensureIdMap,
  getMappings,
  putMapping,
  advanceFingerprints,
  remapMapping,
} from "./lib/idmap";
import {
  RejectLog,
  strOf,
  chunk,
  loadStaged,
  throttleStorageOpLogs,
  LOADER_PAGE_SIZE,
  stagedCountOf,
} from "./lib/loader-utils";
import { makeProgressLogger } from "./lib/progress";
import {
  buildLoaderResult,
  classifyRow,
  combineFingerprints,
  emitLoaderResult,
  emptySummary,
  loaderExitCode,
  parseAllowedFindings,
  parseForceReconcile,
  sweepDeletions,
  type SyncFinding,
} from "./lib/sync";
import { DomainValidationError } from "../../server/storage/utils/validation";

const DRY_RUN = process.argv.includes("--dry-run");
const MIGRATION_MODE = process.argv.includes("--migration-mode");
const ALLOWED_REJECTS: string[] = (() => {
  const i = process.argv.indexOf("--allow-rejects");
  return i >= 0
    ? String(process.argv[i + 1] ?? "").split(",").map((s) => s.trim()).filter(Boolean)
    : [];
})();
const LOADER = "cardchecks";
const ID_MAP_ENTITY = "cardcheck";
/** Definitions are reconciliation entities too — their composite fingerprint
 * (definition node + resolved disclaimer/customfield inputs) lives here. */
const DEF_ENTITY = "cardcheck-definition";
/** Shared by the definitions AND records passes — BUMP whenever either
 * transform changes so mapped rows reconcile on their next run. */
const LOGIC_VERSION = 1;
const FORCE_RECONCILE = parseForceReconcile();
const ALLOWED_FINDINGS = parseAllowedFindings();
/** A mapped cardcheck's S1 source vanished from the staged in-scope set.
 * These are SIGNED AUTHORIZATION RECORDS: the S2 row and mapping are
 * preserved untouched, and the finding blocks until acknowledged
 * (--allow-findings pending_retention) or a fund/legal retention ruling
 * lands. Never converted into deletion or revocation. */
const FINDING_PENDING_RETENTION = "pending_retention";

function loaderScope<T>(fn: () => Promise<T>): Promise<T> {
  return MIGRATION_MODE
    ? withChargePluginsSuppressed(() => withNotificationsSuppressed(fn))
    : withNotificationsSuppressed(fn);
}

/** Row-skipping (fatal) reject reasons — the verify pass skips exactly
 * these. Definitions-pass classes are not row cells and stay out. Every new
 * record-skipping reason MUST join this list or per-cell reconciliation
 * fails loudly (never silently inflates). */
const FATAL_REASONS = [
  "status_unknown",
  "definition_unresolved",
  "ambiguous_definition",
  "handler_unresolved",
  "handler_dangling",
  "mapped_worker_lost",
  "bad_json",
  "duplicate_signed",
  "create_failed",
  "update_failed",
] as const;

const STATUS_MAP: Record<string, "pending" | "signed" | "revoked"> = {
  unsigned: "pending",
  signed: "signed",
  revoked: "revoked",
};

function norm(s: string | null): string | null {
  if (s == null) return null;
  const t = s.trim().toLowerCase();
  return t.length > 0 ? t : null;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/** number | numeric string → number, else null. */
function numOf(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && /^\d+$/.test(v.trim())) return Number(v.trim());
  return null;
}

/** Canonical (key-sorted) stringify — Postgres jsonb does not preserve key
 * order, so a plain JSON.stringify comparison of a round-tripped `data`
 * column never matches and reruns would churn `updated` instead of
 * `adopted`. */
function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  if (isPlainObject(v)) {
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify(v[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v) ?? "null";
}

/** Date/string/null → epoch ms | null (timestamp comparisons).
 * Inputs are S2 `signed_date` values (a naive `timestamp` column) coming back
 * from the driver, or the Date this loader built from an epoch. A naive column
 * read back as text is zone-less BY DEFINITION and means "wall clock in the
 * process zone" — which is exactly how `new Date(str)` reads it, and the same
 * convention pg used to write it. That equivalence holds only because the
 * gate pinned this process to the S2 system zone (lib/timezone-contract.ts);
 * never feed an S1 source string through here. */
function toEpoch(v: Date | string | null | undefined): number | null {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(v);
  const t = d.getTime();
  return Number.isNaN(t) ? null : t;
}

/** Non-empty presence check for payload blobs (esig etc.). */
function blobPresent(v: unknown): boolean {
  if (v == null) return false;
  if (typeof v === "string") return v.trim().length > 0;
  if (Array.isArray(v)) return v.length > 0;
  if (isPlainObject(v)) return Object.keys(v).length > 0;
  return true;
}

/** All entityreference target nids of a (possibly multi-value) field. */
function targetNidsOf(fields: Record<string, unknown>, key: string): number[] {
  const raw = fields[key];
  const arr = Array.isArray(raw) ? raw : raw == null ? [] : [raw];
  const out: number[] = [];
  for (const s of arr) {
    if (typeof s === "number") out.push(s);
    else if (typeof s === "string" && /^\d+$/.test(s)) out.push(Number(s));
    else if (s && typeof s === "object") {
      const o = s as Record<string, unknown>;
      const cand = o.target_id ?? o.value;
      if (typeof cand === "number") out.push(cand);
      else if (typeof cand === "string" && /^\d+$/.test(cand)) out.push(Number(cand));
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// field_sirius_json decoding — tolerate all three staged shapes:
// {value: "..."} object, bare scalar string, and the extra-delta array
// anomaly (first delta wins).
// ---------------------------------------------------------------------------

interface DecodedJson {
  present: boolean;
  parsed?: unknown;
  raw?: string;
  parseError: boolean;
}

function decodeStagedJson(fields: Record<string, unknown>): DecodedJson {
  const raw = fields["field_sirius_json"];
  if (raw == null) return { present: false, parseError: false };
  let v: unknown = Array.isArray(raw) ? (raw as unknown[])[0] : raw;
  if (v && typeof v === "object" && "value" in (v as Record<string, unknown>)) {
    v = (v as Record<string, unknown>).value;
  }
  if (v == null) return { present: false, parseError: false };
  if (typeof v === "string") {
    try {
      return { present: true, parsed: JSON.parse(v), raw: v, parseError: false };
    } catch {
      return { present: true, raw: v, parseError: true };
    }
  }
  return { present: true, parsed: v, parseError: false };
}

/** Shape-tolerant disclaimer text extraction — the exact prod shape of the
 * disclaimer node's JSON is unprofiled, so this tries the plausible spots
 * and the loader surfaces `disclaimer_text_unlocated` when none hit (raw
 * JSON is preserved in data either way — nothing is lost). */
function extractDisclaimerText(parsed: unknown): string | null {
  if (typeof parsed === "string") {
    const t = parsed.trim();
    return t.length > 0 ? t : null;
  }
  if (!isPlainObject(parsed)) return null;
  for (const key of ["disclaimer", "cardcheck_disclaimer", "definition"]) {
    if (key in parsed) {
      const t = extractDisclaimerText(parsed[key]);
      if (t) return t;
    }
  }
  for (const key of ["text", "body", "value", "markup", "content"]) {
    const v = parsed[key];
    if (typeof v === "string" && v.trim().length > 0) return v.trim();
  }
  return null;
}

// ---------------------------------------------------------------------------
// staged reads
// ---------------------------------------------------------------------------

interface StagedLogRow {
  nid: number;
  created: number | null;
  changed: number | null;
  fields: Record<string, unknown>;
  contentHash: string | null;
}

type RawLogRow = {
  nid: string | number;
  created: string | number | null;
  changed: string | number | null;
  fields: unknown;
  content_hash: string | null;
};

function mapLogRow(r: RawLogRow): StagedLogRow {
  return {
    nid: Number(r.nid),
    created: r.created == null ? null : Number(r.created),
    changed: r.changed == null ? null : Number(r.changed),
    fields: (typeof r.fields === "string" ? JSON.parse(r.fields) : r.fields ?? {}) as Record<string, unknown>,
    contentHash: r.content_hash == null ? null : String(r.content_hash),
  };
}

/** Keyset-paged staged read for sirius_log (nid, created, changed, fields,
 * content_hash — local variant of the generic pagedStaged helper, which
 * selects title). */
async function* pagedStagedLogs(
  pageSize: number = LOADER_PAGE_SIZE,
): AsyncGenerator<StagedLogRow[]> {
  let lastNid = -1;
  for (;;) {
    const res = await db.execute(sql`
      SELECT nid, created, changed, fields, content_hash FROM s1_staging.records
       WHERE bundle = 'sirius_log' AND nid > ${lastNid}
       ORDER BY nid LIMIT ${pageSize}
    `);
    const rows = (res as unknown as { rows: RawLogRow[] }).rows.map(mapLogRow);
    if (rows.length === 0) return;
    lastNid = rows[rows.length - 1].nid;
    yield rows;
    if (rows.length < pageSize) return;
  }
}

interface StagedNidRow {
  bundle: string;
  title: string | null;
  fields: Record<string, unknown>;
  contentHash: string | null;
}

/** Staged rows for a nid set, ANY bundle (handler-target / pointer-nid
 * resolution). A nid can exist under >1 bundle (PK is bundle+nid) — all are
 * returned. */
async function stagedByNid(nids: number[]): Promise<Map<number, StagedNidRow[]>> {
  const out = new Map<number, StagedNidRow[]>();
  for (const part of chunk([...new Set(nids)], 500)) {
    if (part.length === 0) continue;
    const res = await db.execute(sql`
      SELECT nid, bundle, title, fields, content_hash FROM s1_staging.records
       WHERE nid IN (${sql.join(part.map((n) => sql`${n}`), sql`, `)})
    `);
    for (const row of (res as unknown as {
      rows: Array<{ nid: string | number; bundle: string; title: string | null; fields: unknown; content_hash: string | null }>;
    }).rows) {
      const k = Number(row.nid);
      const entry: StagedNidRow = {
        bundle: row.bundle,
        title: row.title,
        fields: (typeof row.fields === "string" ? JSON.parse(row.fields) : row.fields ?? {}) as Record<string, unknown>,
        contentHash: row.content_hash == null ? null : String(row.content_hash),
      };
      const arr = out.get(k);
      if (arr) arr.push(entry);
      else out.set(k, [entry]);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// preflight — cardcheck component (enabledByDefault: false) + its tables
// ---------------------------------------------------------------------------

async function preflightCardcheckComponent(): Promise<void> {
  const componentsVar = await storage.variables.getByName("components");
  const value = componentsVar?.value;
  const comps = (typeof value === "string" ? JSON.parse(value) : value ?? {}) as Record<string, unknown>;
  if (comps["cardcheck"] !== true) {
    throw new Error(
      "ABORTING: the `cardcheck` component is NOT enabled on this target (it is enabledByDefault: false " +
        "and owns cardcheck_definitions/cardchecks). Operator step: enable it (components variable → " +
        '"cardcheck": true), provision its schema (component lifecycle), and restart the app ' +
        "(component enablement is cached at boot). Nothing was written.",
    );
  }
  const res = await db.execute(sql`
    SELECT to_regclass('public.cardcheck_definitions') AS defs, to_regclass('public.cardchecks') AS cards
  `);
  const row = (res as unknown as { rows: Array<{ defs: string | null; cards: string | null }> }).rows[0];
  if (!row?.defs || !row?.cards) {
    throw new Error(
      "ABORTING: the cardcheck component is enabled but its tables are missing " +
        `(cardcheck_definitions: ${row?.defs ? "present" : "ABSENT"}, cardchecks: ${row?.cards ? "present" : "ABSENT"}). ` +
        "Provision the component schema (enable via the component lifecycle, not a bare variable edit), then re-run. Nothing was written.",
    );
  }
}

// ---------------------------------------------------------------------------

async function main() {
  const startedAt = new Date();
  await ensureStagingSchema();
  await ensureIdMap();
  await preflightCardcheckComponent();

  if (MIGRATION_MODE) {
    console.error("MIGRATION MODE: charge-plugin execution is suppressed for all writes in this run.");
  }

  const report: Record<string, unknown> = { loader: LOADER, dryRun: DRY_RUN, allowedRejects: ALLOWED_REJECTS };
  const rejects = new RejectLog();
  throttleStorageOpLogs();

  const totalStaged = await stagedCountOf("sirius_log");
  const progress = makeProgressLogger(LOADER, totalStaged);
  progress.phase("definitions");

  // ── Definitions pass ──────────────────────────────────────────────────────
  // Staged sirius_json_definition rows with type sirius:cardcheck → upsert
  // cardcheck_definitions by sirius_id (= definition nid). Disclaimer /
  // customfield pointer nodes resolve from staging; missing targets are
  // counted reject classes (definition still upserts — records need it).
  // Composite consumed fingerprint = def node hash + resolved pointer-node
  // hashes: a disclaimer/customfield edit reprocesses the definition even
  // though the definition node itself is unchanged.
  const stagedDefNodes = await loadStaged("sirius_json_definition");
  const ccDefNodes = stagedDefNodes.filter(
    (d) => norm(strOf(d.fields, "field_sirius_type")) === "sirius:cardcheck",
  );

  /** definition nid → S2 definition id + title (records pass + report). */
  const defByNid = new Map<number, { s2Id: string; title: string }>();
  const defStats = { staged: ccDefNodes.length, created: 0, updated: 0, adopted: 0, skipped: 0, fastPathSkips: 0 };

  // Resolve every pointer nid in one batch.
  const pointerNids: number[] = [];
  const defParsed = new Map<number, { decoded: DecodedJson; disclaimerNid: number | null; customfieldNid: number | null }>();
  for (const d of ccDefNodes) {
    const decoded = decodeStagedJson(d.fields);
    const defRoot = isPlainObject(decoded.parsed) ? decoded.parsed["cardcheck_definition"] : undefined;
    const disclaimerNid = numOf(isPlainObject(defRoot) ? defRoot["disclaimer_nid"] : undefined);
    const customfieldNid = numOf(isPlainObject(defRoot) ? defRoot["customfield_nid"] : undefined);
    if (disclaimerNid != null) pointerNids.push(disclaimerNid);
    if (customfieldNid != null) pointerNids.push(customfieldNid);
    defParsed.set(d.nid, { decoded, disclaimerNid, customfieldNid });
  }
  const pointerRows = await stagedByNid(pointerNids);

  /** Composite-fingerprint part for a pointer nid: null = not configured;
   * "missing:<nid>" = configured but not staged; otherwise the chosen staged
   * node's content_hash ("staged-unhashed:<nid>" for pre-hash staging — never
   * silently equal to either other state). */
  const pointerPart = (nid: number | null): string | null => {
    if (nid == null) return null;
    const rows = pointerRows.get(nid);
    if (!rows || rows.length === 0) return `missing:${nid}`;
    const node = rows.find((r) => r.bundle === "sirius_json_definition") ?? rows[0];
    return node.contentHash ?? `staged-unhashed:${nid}`;
  };

  const defMappings = await getMappings(DEF_ENTITY, ccDefNodes.map((d) => d.nid));
  /** Definition fingerprint advances, applied only after the definition
   * verify (exactly-one + exact content for written defs) passes. */
  const pendingDefAdvance: Array<{ s1Id: number; fingerprint: string | null }> = [];
  /** Definitions WRITTEN this run (created/updated) — re-read + exact-compare
   * in verify. Adopted defs were verified by their compare-read. */
  const defExactTargets: Array<{ nid: number; name: string; body: string | null; dataCanon: string }> = [];
  const defFpByNid = new Map<number, string | null>();

  for (const d of ccDefNodes) {
    const { decoded, disclaimerNid, customfieldNid } = defParsed.get(d.nid)!;
    const defFp =
      d.contentHash == null
        ? null // never fast-skip unhashed staging
        : combineFingerprints([
            ["def", d.contentHash],
            ["disc", pointerPart(disclaimerNid)],
            ["cf", pointerPart(customfieldNid)],
          ]);
    defFpByNid.set(d.nid, defFp);
    const mapping = defMappings.get(d.nid);

    // Consumed-fingerprint fast path: unchanged definition (node + resolved
    // pointer inputs) at the current logic version resolves from the mapping
    // without an S2 read. The staged title is authoritative for the report
    // label (an unchanged content_hash implies an unchanged title).
    if (mapping && classifyRow(mapping, defFp, LOGIC_VERSION, FORCE_RECONCILE) === "unchanged") {
      defByNid.set(d.nid, { s2Id: mapping.s2Id, title: d.title?.trim() || "?" });
      defStats.fastPathSkips++;
      continue;
    }

    if (decoded.present && decoded.parseError) {
      rejects.add("definition_json_unparseable", { nid: d.nid }, d.nid);
    }
    const title = d.title?.trim() || null;
    if (!title) {
      // Definition SKIPPED — a nameless definition is unusable; its records
      // reject as definition_unresolved downstream. Never advances.
      rejects.add("definition_title_missing", { nid: d.nid }, d.nid);
      defStats.skipped++;
      continue;
    }

    let body: string | null = null;
    let disclaimerInfo: Record<string, unknown> | null = null;
    if (disclaimerNid != null) {
      const rows = pointerRows.get(disclaimerNid);
      if (!rows || rows.length === 0) {
        rejects.add("disclaimer_missing", { nid: d.nid, disclaimerNid }, d.nid);
      } else {
        // Prefer a sirius_json_definition row when the nid exists under >1 bundle.
        const node = rows.find((r) => r.bundle === "sirius_json_definition") ?? rows[0];
        const discJson = decodeStagedJson(node.fields);
        body = extractDisclaimerText(discJson.parsed ?? discJson.raw ?? null);
        disclaimerInfo = {
          nid: disclaimerNid,
          bundle: node.bundle,
          title: node.title,
          json: discJson.parsed ?? discJson.raw ?? null,
        };
        if (body == null) {
          rejects.add("disclaimer_text_unlocated", { nid: d.nid, disclaimerNid }, d.nid);
        }
      }
    }

    let customfieldInfo: Record<string, unknown> | null = null;
    if (customfieldNid != null) {
      const rows = pointerRows.get(customfieldNid);
      if (!rows || rows.length === 0) {
        rejects.add("customfield_missing", { nid: d.nid, customfieldNid }, d.nid);
      } else {
        const node = rows.find((r) => r.bundle === "sirius_json_definition") ?? rows[0];
        const cfJson = decodeStagedJson(node.fields);
        customfieldInfo = {
          nid: customfieldNid,
          bundle: node.bundle,
          title: node.title,
          json: cfJson.parsed ?? cfJson.raw ?? null,
        };
      }
    }

    const s1Data = {
      nid: d.nid,
      disclaimerNid,
      customfieldNid,
      definitionJson: decoded.parsed ?? decoded.raw ?? null,
      disclaimer: disclaimerInfo,
      customfield: customfieldInfo,
      provenance: { loader: LOADER, currentStateOnly: true },
    };

    try {
      const existing = await storage.cardcheckDefinitions.getCardcheckDefinitionBySiriusId(String(d.nid));
      if (!existing) {
        if (!DRY_RUN) {
          const created = await loaderScope(() =>
            storage.cardcheckDefinitions.createCardcheckDefinition({
              siriusId: String(d.nid),
              name: title,
              body,
              data: { s1: s1Data },
            }),
          );
          defByNid.set(d.nid, { s2Id: created.id, title });
          if (mapping && mapping.s2Id !== created.id) {
            // Mapping pointed at a vanished S2 row (out-of-band churn) — the
            // recreate is authoritative; retarget the mapping.
            await remapMapping(DEF_ENTITY, d.nid, created.id, LOADER);
          } else if (!mapping) {
            await putMapping(DEF_ENTITY, d.nid, created.id, { stub: false, loader: LOADER });
          }
          pendingDefAdvance.push({ s1Id: d.nid, fingerprint: defFp });
          defExactTargets.push({ nid: d.nid, name: title, body, dataCanon: stableStringify({ s1: s1Data }) });
        } else {
          defByNid.set(d.nid, { s2Id: `dry-run:${d.nid}`, title });
        }
        defStats.created++;
      } else {
        const existingData = isPlainObject(existing.data) ? existing.data : {};
        const nextData = { ...existingData, s1: s1Data };
        const unchanged =
          existing.name === title &&
          (existing.body ?? null) === body &&
          stableStringify(existingData) === stableStringify(nextData);
        if (unchanged) {
          defStats.adopted++;
          // The compare-read IS the adopt verification — advance post-verify.
          if (!DRY_RUN) pendingDefAdvance.push({ s1Id: d.nid, fingerprint: defFp });
        } else if (DRY_RUN) {
          defStats.updated++;
        } else {
          await loaderScope(() =>
            storage.cardcheckDefinitions.updateCardcheckDefinition(existing.id, {
              name: title,
              body,
              data: nextData,
            }),
          );
          defStats.updated++;
          pendingDefAdvance.push({ s1Id: d.nid, fingerprint: defFp });
          defExactTargets.push({ nid: d.nid, name: title, body, dataCanon: stableStringify(nextData) });
        }
        defByNid.set(d.nid, { s2Id: existing.id, title });
        if (!DRY_RUN && !mapping) {
          await putMapping(DEF_ENTITY, d.nid, existing.id, { stub: false, loader: LOADER });
        }
      }
    } catch (err) {
      // Sanitized: class name only — never raw error text.
      const code = err instanceof Error ? err.constructor.name : "unknown";
      rejects.add("definition_write_failed", { nid: d.nid, code }, d.nid);
      defStats.skipped++;
    }
  }
  report.definitions = defStats;

  // ── Records pass ──────────────────────────────────────────────────────────
  progress.phase(null);

  let stagedLogs = 0;
  let inScope = 0;
  /** Every in-scope staged nid — the current source set for the retention
   * sweep (mapped nids absent from this set are pending-retention findings). */
  const inScopeNids = new Set<number>();
  const stats = { created: 0, updated: 0, adopted: 0, fastPathSkips: 0, noWorkerHandler: 0, multiWorkerTargets: 0 };
  const defects = {
    dualAcceptanceMismatch: 0,
    signedWithoutEsig: 0,
    noWorkerHandler: 0,
    offlineKeysPresent: 0,
    acceptanceTsInvalid: 0,
  };
  let recordsWithJson = 0;
  let recordsWithEsig = 0;
  /** Distinct unresolved handler-target nids tallied by staged bundle... */
  const unresolvedHandlersByBundle: Record<string, number> = {};
  /** ...plus distinct unresolved targets absent from staging entirely. */
  let unresolvedHandlersNotStaged = 0;
  const talliedUnresolvedNids = new Set<number>();

  /** Per (definition × status) reconciliation cells. Key: `${defKey}|${status}`. */
  interface Cell {
    staged: number;
    loaded: number; // created + updated + adopted + fastSkipped
    rejected: number;
    skipped: number; // tolerated noWorkerHandler
  }
  const cells = new Map<string, Cell>();
  const cellOf = (defKey: string, status: string): Cell => {
    const k = `${defKey}|${status}`;
    let c = cells.get(k);
    if (!c) {
      c = { staged: 0, loaded: 0, rejected: 0, skipped: 0 };
      cells.set(k, c);
    }
    return c;
  };

  /** nids for the existence/uniqueness verify (fast-skipped + adopted +
   * created + updated). */
  const mappedNids: number[] = [];
  /** Record fingerprint advances — applied only after verify passes for the
   * nid (exact re-read for writes; compare-read for adopts; existence for
   * fast-skips is not needed — their fingerprints are already current). */
  const pendingRecordAdvance: Array<{ s1Id: number; fingerprint: string | null }> = [];
  /** Rows WRITTEN this run (created/updated) — exact field re-read verify. */
  interface ExactTarget {
    nid: number;
    s2Id: string;
    workerId: string;
    definitionId: string;
    status: string;
    signedEpoch: number | null;
    dataCanon: string;
  }
  const exactTargets: ExactTarget[] = [];

  for await (const page of pagedStagedLogs()) {
    stagedLogs += page.length;
    progress.add(page.length);

    const scopedPage = page.filter(
      (r) => norm(strOf(r.fields, "field_sirius_category")) === "cardcheck",
    );
    inScope += scopedPage.length;
    if (scopedPage.length === 0) continue;

    // Batch lookups for this page: id_map(cardcheck), handler-target staged
    // bundles, id_map(worker) for worker-bundle targets.
    const idMap = await getMappings(ID_MAP_ENTITY, scopedPage.map((r) => r.nid));
    const handlerNids = new Set<number>();
    for (const r of scopedPage) {
      for (const n of targetNidsOf(r.fields, "field_sirius_log_handler")) handlerNids.add(n);
    }
    const handlerRows = await stagedByNid([...handlerNids]);
    const workerNids = [...handlerNids].filter((n) =>
      (handlerRows.get(n) ?? []).some((row) => row.bundle === "sirius_worker"),
    );
    const workerMap = await getMappings("worker", workerNids);

    for (const r of scopedPage) {
      inScopeNids.add(r.nid);
      const rawStatus = norm(strOf(r.fields, "field_sirius_type"));
      const statusKey = rawStatus ?? "missing";
      const handlers = targetNidsOf(r.fields, "field_sirius_log_handler");
      const defTargets = handlers.filter((n) => defByNid.has(n));
      const defKey = defTargets.length === 1 ? String(defTargets[0]) : "unresolved";
      const cell = cellOf(defKey, statusKey);
      cell.staged++;

      // Worker resolution — per-target by staged bundle, never delta order.
      // Resolved BEFORE classification: the consumed fingerprint includes the
      // resolved worker/definition identities, so a remap (or a lost worker)
      // re-enters reconciliation even when the staged row itself is unchanged.
      const workerTargets = handlers.filter((n) =>
        (handlerRows.get(n) ?? []).some((row) => row.bundle === "sirius_worker"),
      );
      let workerNid: number | null = null;
      let workerId: string | null = null;
      for (const n of workerTargets) {
        const m = workerMap.get(n);
        if (m && !m.stub) {
          workerNid = n;
          workerId = m.s2Id;
          break;
        }
      }
      const defNidResolved = defTargets.length === 1 ? defTargets[0] : null;
      const defS2Id = defNidResolved != null ? defByNid.get(defNidResolved)!.s2Id : null;

      const mapping = idMap.get(r.nid);
      const recFp =
        r.contentHash == null
          ? null // never fast-skip unhashed staging
          : combineFingerprints([
              ["rec", r.contentHash],
              ["worker", workerId],
              ["def", defS2Id],
            ]);

      // Consumed-fingerprint fast path: mapped + unchanged (staged content,
      // resolution, logic version) → skip without parsing or touching S2.
      // Existence/uniqueness verify still covers these rows every run.
      if (mapping && classifyRow(mapping, recFp, LOGIC_VERSION, FORCE_RECONCILE) === "unchanged") {
        stats.fastPathSkips++;
        cell.loaded++;
        mappedNids.push(r.nid);
        continue;
      }

      if (workerTargets.length > 1) stats.multiWorkerTargets++;

      const status = rawStatus != null ? STATUS_MAP[rawStatus] : undefined;
      if (!status) {
        rejects.add("status_unknown", { nid: r.nid, status: statusKey, mapped: mapping != null }, r.nid);
        cell.rejected++;
        continue;
      }

      if (defTargets.length === 0) {
        const notStagedCount = handlers.filter((n) => !handlerRows.has(n)).length;
        rejects.add(
          "definition_unresolved",
          { nid: r.nid, handlers, notStagedTargets: notStagedCount, mapped: mapping != null },
          r.nid,
        );
        cell.rejected++;
        continue;
      }
      if (defTargets.length > 1) {
        rejects.add("ambiguous_definition", { nid: r.nid, definitionNids: defTargets, mapped: mapping != null }, r.nid);
        cell.rejected++;
        continue;
      }
      const defNid = defTargets[0];
      const definition = defByNid.get(defNid)!;

      if (workerId == null) {
        // Unaccounted targets: everything that is neither the resolved
        // definition nor a mapped worker.
        const leftover = handlers.filter((n) => n !== defNid);
        if (leftover.length === 0) {
          if (mapping) {
            // A LOADED record's worker handler vanished in S1. The S2 row
            // cannot follow (worker_id NOT NULL) — fatal triage class; the
            // row and mapping are preserved as-is.
            rejects.add("mapped_worker_lost", { nid: r.nid, definitionNid: defNid }, r.nid);
            cell.rejected++;
            continue;
          }
          // Legitimate no-worker record ([No Handler]) — counted, tolerated,
          // never mis-assigned. cardchecks.worker_id is NOT NULL, so it
          // cannot load; the count is the reconciliation entry.
          stats.noWorkerHandler++;
          defects.noWorkerHandler++;
          cell.skipped++;
          continue;
        }
        for (const n of leftover) {
          if (talliedUnresolvedNids.has(n)) continue;
          talliedUnresolvedNids.add(n);
          const rows = handlerRows.get(n);
          if (!rows) unresolvedHandlersNotStaged++;
          else for (const row of rows) {
            unresolvedHandlersByBundle[row.bundle] = (unresolvedHandlersByBundle[row.bundle] ?? 0) + 1;
          }
        }
        const anyStaged = leftover.some((n) => handlerRows.has(n));
        rejects.add(
          anyStaged ? "handler_unresolved" : "handler_dangling",
          { nid: r.nid, handlers, definitionNid: defNid, mapped: mapping != null },
          r.nid,
        );
        cell.rejected++;
        continue;
      }

      // JSON payload — absent/empty tolerated (clear() wipes signed records
      // back to unsigned in place); unparseable is a fatal reject.
      const decoded = decodeStagedJson(r.fields);
      if (decoded.parseError) {
        rejects.add("bad_json", { nid: r.nid, mapped: mapping != null }, r.nid);
        cell.rejected++;
        continue;
      }
      if (decoded.present) recordsWithJson++;
      const parsed = isPlainObject(decoded.parsed) ? decoded.parsed : {};
      const cc = isPlainObject(parsed["cardcheck"]) ? (parsed["cardcheck"] as Record<string, unknown>) : {};
      const acceptance = isPlainObject(cc["acceptance"]) ? (cc["acceptance"] as Record<string, unknown>) : null;
      const revocation = isPlainObject(cc["revocation"]) ? (cc["revocation"] as Record<string, unknown>) : null;
      const disclaimer = isPlainObject(parsed["disclaimer"]) ? (parsed["disclaimer"] as Record<string, unknown>) : null;
      const esig = parsed["esig"];
      const customfield = parsed["customfield"];

      // Defect (a): the duplicate acceptance record in
      // disclaimer[nid].acceptances[0] must agree with cardcheck.acceptance.ts.
      const acceptanceTsRaw = acceptance ? acceptance["ts"] : undefined;
      const acceptanceTs = numOf(acceptanceTsRaw);
      let disclaimerTs: number | null = null;
      if (disclaimer) {
        for (const v of Object.values(disclaimer)) {
          const acc0 =
            isPlainObject(v) && Array.isArray(v["acceptances"]) ? (v["acceptances"] as unknown[])[0] : undefined;
          const ts = numOf(isPlainObject(acc0) ? (acc0 as Record<string, unknown>)["ts"] : acc0);
          if (ts != null) {
            disclaimerTs = ts;
            break;
          }
        }
      }
      const dualAcceptanceMismatch =
        acceptanceTs != null && disclaimerTs != null && acceptanceTs !== disclaimerTs;
      if (dualAcceptanceMismatch) defects.dualAcceptanceMismatch++;

      // Defect (b): signed/revoked with no esig blob (768-vs-770 family).
      const esigPresent = blobPresent(esig);
      if (esigPresent) recordsWithEsig++;
      const signedWithoutEsig = (status === "signed" || status === "revoked") && !esigPresent;
      if (signedWithoutEsig) defects.signedWithoutEsig++;

      // Offline-signing keys: zero prod rows — tolerated + counted, never built for.
      const offlineKeys = acceptance != null && acceptance["offline"] != null;
      if (offlineKeys) defects.offlineKeysPresent++;

      // Signed date from cardcheck.acceptance.ts (epoch seconds, range-guarded).
      let signedDate: Date | null = null;
      let acceptanceTsInvalid = false;
      if (acceptanceTs != null && acceptanceTs > 0 && acceptanceTs <= 4102444800) {
        signedDate = new Date(acceptanceTs * 1000);
      } else if (acceptanceTsRaw != null) {
        acceptanceTsInvalid = true;
        defects.acceptanceTsInvalid++;
      }

      if (DRY_RUN) {
        // Dry runs classify but do not read/compare S2 rows: a changed
        // mapped record counts as would-update (conservative).
        if (mapping) stats.updated++;
        else stats.created++;
        cell.loaded++;
        continue;
      }

      const s1Payload = {
        nid: r.nid,
        status: rawStatus,
        definitionNid: defNid,
        workerNid,
        createdEpoch: r.created,
        changedEpoch: r.changed,
        acceptance,
        revocation,
        disclaimer,
        esig: esig ?? null,
        customfield: customfield ?? null,
        bu: cc["bu"] ?? null,
        workerTitle: cc["title"] ?? null,
        domain: strOf(r.fields, "field_sirius_domain"),
        provenance: { loader: LOADER, currentStateOnly: true },
        flags: {
          dualAcceptanceMismatch,
          signedWithoutEsig,
          offlineKeys,
          acceptanceTsInvalid,
          jsonAbsent: !decoded.present,
        },
      };

      if (!mapping) {
        // NEW record → create.
        try {
          const cardcheck = await loaderScope(() =>
            storage.cardchecks.createCardcheck({
              workerId: workerId!,
              cardcheckDefinitionId: definition.s2Id,
              status,
              signedDate,
              data: { s1: s1Payload },
            }),
          );
          // Authorship only — the fingerprint advances AFTER verification.
          await putMapping(ID_MAP_ENTITY, r.nid, cardcheck.id, { stub: false, loader: LOADER });
          mappedNids.push(r.nid);
          pendingRecordAdvance.push({ s1Id: r.nid, fingerprint: recFp });
          exactTargets.push({
            nid: r.nid,
            s2Id: cardcheck.id,
            workerId: workerId!,
            definitionId: definition.s2Id,
            status,
            signedEpoch: toEpoch(signedDate),
            dataCanon: stableStringify({ s1: s1Payload }),
          });
          stats.created++;
          cell.loaded++;
        } catch (err) {
          // SANITIZED: never log raw error text — payload values may be
          // embedded in driver/validation messages.
          if (err instanceof DomainValidationError && err.errors.some((e) => e.code === "DUPLICATE_SIGNED")) {
            rejects.add("duplicate_signed", { nid: r.nid, definitionNid: defNid }, r.nid);
          } else {
            const code = err instanceof Error ? err.constructor.name : "unknown";
            rejects.add("create_failed", { nid: r.nid, code }, r.nid);
          }
          cell.rejected++;
        }
        continue;
      }

      // CHANGED mapped record → reconcile through storage (S1 wins). Read
      // the existing row, merge migration-owned data.s1, compare, update.
      try {
        const existing = await storage.cardchecks.getCardcheckById(mapping.s2Id);
        if (!existing) {
          // Mapping points at a vanished S2 row — repair id_map; recreating
          // silently could double-load a signed authorization.
          rejects.add("update_failed", { nid: r.nid, code: "target_missing" }, r.nid);
          cell.rejected++;
          continue;
        }
        const existingData = isPlainObject(existing.data) ? existing.data : {};
        const nextData = { ...existingData, s1: s1Payload };
        const unchanged =
          existing.workerId === workerId &&
          existing.cardcheckDefinitionId === definition.s2Id &&
          existing.status === status &&
          toEpoch(existing.signedDate) === toEpoch(signedDate) &&
          stableStringify(existingData) === stableStringify(nextData);
        if (unchanged) {
          // Adopt: S2 already matches the transformed source (e.g. the
          // fingerprint was null/stale but nothing actually drifted). The
          // compare-read IS the verification — advance post-verify.
          stats.adopted++;
          cell.loaded++;
          mappedNids.push(r.nid);
          pendingRecordAdvance.push({ s1Id: r.nid, fingerprint: recFp });
          continue;
        }
        const updated = await loaderScope(() =>
          storage.cardchecks.updateCardcheck(mapping.s2Id, {
            workerId: workerId!,
            cardcheckDefinitionId: definition.s2Id,
            status,
            signedDate,
            data: nextData,
          }),
        );
        if (!updated) {
          rejects.add("update_failed", { nid: r.nid, code: "target_missing" }, r.nid);
          cell.rejected++;
          continue;
        }
        stats.updated++;
        cell.loaded++;
        mappedNids.push(r.nid);
        pendingRecordAdvance.push({ s1Id: r.nid, fingerprint: recFp });
        exactTargets.push({
          nid: r.nid,
          s2Id: mapping.s2Id,
          workerId: workerId!,
          definitionId: definition.s2Id,
          status,
          signedEpoch: toEpoch(signedDate),
          dataCanon: stableStringify(nextData),
        });
      } catch (err) {
        // SANITIZED: never log raw error text.
        if (err instanceof DomainValidationError && err.errors.some((e) => e.code === "DUPLICATE_SIGNED")) {
          // A different record for this worker+definition is already signed —
          // same S1-side duplicate family as on create, now surfaced by an
          // in-place transition. Triage; never auto-picked.
          rejects.add("duplicate_signed", { nid: r.nid, definitionNid: defNid, mapped: true }, r.nid);
        } else {
          const code = err instanceof Error ? err.constructor.name : "unknown";
          rejects.add("update_failed", { nid: r.nid, code }, r.nid);
        }
        cell.rejected++;
      }
    }
  }

  report.stagedLogs = stagedLogs;
  report.inScope = inScope;

  // ── Reconciliation: per-definition × per-status table + cell assertions ──
  let verifyFailures = 0;
  const stagedByDefinition: Record<string, Record<string, number>> = {};
  const loadedByDefinition: Record<string, Record<string, number>> = {};
  const cellMismatches: Array<Record<string, unknown>> = [];
  for (const [key, c] of [...cells.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const [defKey, status] = key.split("|");
    const label =
      defKey === "unresolved" ? "unresolved" : `${defKey} (${defByNid.get(Number(defKey))?.title ?? "?"})`;
    (stagedByDefinition[label] ??= {})[status] = c.staged;
    (loadedByDefinition[label] ??= {})[status] = c.loaded;
    if (c.staged !== c.loaded + c.rejected + c.skipped) {
      cellMismatches.push({ definition: label, status, ...c });
      console.error(
        `VERIFY: cell ${label} × ${status}: staged=${c.staged} != loaded=${c.loaded} + rejected=${c.rejected} + skipped=${c.skipped}`,
      );
      verifyFailures++;
    }
  }
  report.stagedByDefinition = stagedByDefinition;
  report.loadedByDefinition = loadedByDefinition;
  report.cellMismatches = cellMismatches;

  // ── Verify pass: existence + uniqueness + EXACT fields, defs exactly-one ─
  progress.phase("verify", mappedNids.length);
  const verifyFailedRecordNids = new Set<number>();
  const verifyFailedDefNids = new Set<number>();
  if (!DRY_RUN) {
    // (1) Every mapped nid → an existing cardchecks row.
    const vMap = await getMappings(ID_MAP_ENTITY, mappedNids);
    for (const part of chunk(mappedNids, 500)) {
      const s2Ids = part.map((n) => vMap.get(n)?.s2Id).filter((v): v is string => v != null);
      const found = new Set<string>();
      if (s2Ids.length > 0) {
        const res = await db.execute(sql`
          SELECT id FROM cardchecks WHERE id IN (${sql.join(s2Ids.map((s) => sql`${s}`), sql`, `)})
        `);
        for (const row of (res as unknown as { rows: Array<{ id: string }> }).rows) found.add(row.id);
      }
      for (const nid of part) {
        progress.add(1);
        if (rejects.hasAnyIn(nid, FATAL_REASONS)) continue;
        const m = vMap.get(nid);
        if (!m) {
          console.error(`VERIFY: cardcheck nid ${nid} has no id_map entry`);
          verifyFailures++;
          verifyFailedRecordNids.add(nid);
          continue;
        }
        if (!found.has(m.s2Id)) {
          console.error(`VERIFY: cardcheck nid ${nid} maps to missing cardchecks row ${m.s2Id}`);
          verifyFailures++;
          verifyFailedRecordNids.add(nid);
        }
      }
    }

    // (2) Mapping uniqueness — no two cardcheck nids may share an S2 row.
    const dupRes = await db.execute(sql`
      SELECT s2_id, COUNT(*)::int AS n FROM s1_staging.id_map
       WHERE entity = ${ID_MAP_ENTITY} AND stub = false
       GROUP BY s2_id HAVING COUNT(*) > 1
    `);
    for (const row of (dupRes as unknown as { rows: Array<{ s2_id: string; n: number }> }).rows) {
      console.error(`VERIFY: ${row.n} cardcheck mappings share S2 row ${row.s2_id} (uniqueness violation)`);
      verifyFailures++;
    }

    // (3) EXACT field verify for rows written this run (created/updated):
    // transformed status, signed date, worker, definition, and the full
    // migration-owned data — not mere existence.
    for (const part of chunk(exactTargets, 200)) {
      if (part.length === 0) continue;
      const res = await db.execute(sql`
        SELECT id, worker_id, cardcheck_definition_id, status, signed_date, data
          FROM cardchecks WHERE id IN (${sql.join(part.map((t) => sql`${t.s2Id}`), sql`, `)})
      `);
      const byId = new Map(
        (res as unknown as {
          rows: Array<{ id: string; worker_id: string; cardcheck_definition_id: string; status: string; signed_date: string | Date | null; data: unknown }>;
        }).rows.map((row) => [row.id, row]),
      );
      for (const t of part) {
        const row = byId.get(t.s2Id);
        const mismatches: string[] = [];
        if (!row) mismatches.push("row_missing");
        else {
          if (row.worker_id !== t.workerId) mismatches.push("worker");
          if (row.cardcheck_definition_id !== t.definitionId) mismatches.push("definition");
          if (row.status !== t.status) mismatches.push("status");
          if (toEpoch(row.signed_date) !== t.signedEpoch) mismatches.push("signed_date");
          const data = typeof row.data === "string" ? JSON.parse(row.data) : row.data;
          if (stableStringify(data) !== t.dataCanon) mismatches.push("data");
        }
        if (mismatches.length > 0) {
          console.error(`VERIFY: cardcheck nid ${t.nid} exact-field mismatch: ${mismatches.join(",")}`);
          verifyFailures++;
          verifyFailedRecordNids.add(t.nid);
        }
      }
    }

    // (4) Every loaded definition resolves to exactly one S2 row by
    // sirius_id; definitions written this run also re-read exactly.
    for (const [nid] of defByNid) {
      const res = await db.execute(
        sql`SELECT count(*)::int AS n FROM cardcheck_definitions WHERE sirius_id = ${String(nid)}`,
      );
      const n = Number((res as unknown as { rows: Array<{ n: number }> }).rows[0]?.n ?? 0);
      if (n !== 1) {
        console.error(`VERIFY: definition nid ${nid} resolves to ${n} cardcheck_definitions rows (expected 1)`);
        verifyFailures++;
        verifyFailedDefNids.add(nid);
      }
    }
    for (const t of defExactTargets) {
      const row = await storage.cardcheckDefinitions.getCardcheckDefinitionBySiriusId(String(t.nid));
      const mismatches: string[] = [];
      if (!row) mismatches.push("row_missing");
      else {
        if (row.name !== t.name) mismatches.push("name");
        if ((row.body ?? null) !== t.body) mismatches.push("body");
        if (stableStringify(isPlainObject(row.data) ? row.data : {}) !== t.dataCanon) mismatches.push("data");
      }
      if (mismatches.length > 0) {
        console.error(`VERIFY: definition nid ${t.nid} exact-field mismatch: ${mismatches.join(",")}`);
        verifyFailures++;
        verifyFailedDefNids.add(t.nid);
      }
    }
  }

  // ---- advance consumed fingerprints — only after verification passed;
  // then re-read and assert the stamps landed ----
  if (!DRY_RUN) {
    const recAdvance = pendingRecordAdvance.filter((p) => !verifyFailedRecordNids.has(p.s1Id));
    const defAdvance = pendingDefAdvance.filter((p) => !verifyFailedDefNids.has(p.s1Id));
    await advanceFingerprints(ID_MAP_ENTITY, recAdvance, LOGIC_VERSION);
    await advanceFingerprints(DEF_ENTITY, defAdvance, LOGIC_VERSION);
    const assertStamped = async (entity: string, rows: Array<{ s1Id: number; fingerprint: string | null }>) => {
      if (rows.length === 0) return;
      const m = await getMappings(entity, rows.map((r) => r.s1Id));
      for (const r of rows) {
        const got = m.get(r.s1Id);
        if (!got || got.consumedFingerprint !== r.fingerprint || got.logicVersion !== LOGIC_VERSION) {
          console.error(`VERIFY: ${entity} ${r.s1Id} fingerprint did not stamp after advance`);
          verifyFailures++;
        }
      }
    };
    await assertStamped(ID_MAP_ENTITY, recAdvance);
    await assertStamped(DEF_ENTITY, defAdvance);
  }

  // ---- deletion sweeps: REPORT-ONLY, retention ruling pending ----
  // Records: mapped cardcheck nids absent from the current staged in-scope
  // set (category=cardcheck). Signed authorization records are preserved in
  // S2 with mappings intact — absence in S1 is never converted into deletion
  // or revocation, and no lifecycle history is fabricated. Findings are
  // typed pending_retention with per-status aggregates and BLOCK the final
  // freeze until the fund/legal retention ruling lands.
  const findings: SyncFinding[] = [];
  const recSweep = await sweepDeletions({
    entity: ID_MAP_ENTITY,
    loaders: [LOADER],
    sourceIds: inScopeNids,
    dryRun: DRY_RUN,
    policy: async () => ({
      action: "report-only",
      detail: {
        reason:
          "signed authorization record vanished from the staged S1 source set — retention ruling " +
          "pending; the sync never deletes, revokes, or fabricates lifecycle history",
      },
    }),
  });
  const pendingRetentionByStatus: Record<string, number> = {};
  {
    const s2Ids = recSweep.findings.map((f) => f.s2Id).filter((v): v is string => v != null);
    const statusById = new Map<string, string>();
    for (const part of chunk(s2Ids, 500)) {
      if (part.length === 0) continue;
      const res = await db.execute(sql`
        SELECT id, status FROM cardchecks WHERE id IN (${sql.join(part.map((s) => sql`${s}`), sql`, `)})
      `);
      for (const row of (res as unknown as { rows: Array<{ id: string; status: string }> }).rows) {
        statusById.set(row.id, row.status);
      }
    }
    for (const f of recSweep.findings) {
      const status = (f.s2Id != null ? statusById.get(f.s2Id) : undefined) ?? "row_missing";
      pendingRetentionByStatus[status] = (pendingRetentionByStatus[status] ?? 0) + 1;
      findings.push({ ...f, kind: FINDING_PENDING_RETENTION, detail: { ...f.detail, status } });
    }
  }
  // Definitions: standard deleted_in_s1 report-only finding (config rows;
  // records may still reference them — nothing is deleted without a ruling).
  const defSweep = await sweepDeletions({
    entity: DEF_ENTITY,
    loaders: [LOADER],
    sourceIds: new Set(ccDefNodes.map((d) => d.nid)),
    dryRun: DRY_RUN,
    policy: async () => ({
      action: "report-only",
      detail: { reason: "cardcheck definition vanished from staging; S2 rows/records preserved pending ruling" },
    }),
  });
  findings.push(...defSweep.findings);
  report.sweep = {
    records: {
      candidates: recSweep.candidates,
      alreadyHandled: recSweep.alreadyHandled,
      pendingRetentionByStatus,
    },
    definitions: { candidates: defSweep.candidates, alreadyHandled: defSweep.alreadyHandled },
  };

  progress.stop();

  report.stats = stats;
  report.defectClasses = defects;
  report.recordsWithJson = recordsWithJson;
  report.recordsWithEsig = recordsWithEsig;
  report.unresolvedHandlerNids = {
    byStagedBundle: unresolvedHandlersByBundle,
    notStaged: unresolvedHandlersNotStaged,
  };
  report.fastPathSkips = stats.fastPathSkips + defStats.fastPathSkips;
  report.rejects = rejects.counts;
  report.rejectSamples = rejects.samples;
  report.verifyFailures = verifyFailures;
  report.elapsedSeconds = Math.round((Date.now() - startedAt.getTime()) / 1000);

  // Standard sync summary — records + definitions combined; per-domain
  // breakdowns stay under detail (stats / definitions).
  const summary = emptySummary();
  summary.created = stats.created + defStats.created;
  summary.updated = stats.updated + defStats.updated;
  summary.unchanged = stats.adopted + stats.fastPathSkips + defStats.adopted + defStats.fastPathSkips;
  summary.deleted = recSweep.deleted + defSweep.deleted;
  summary.deactivated = recSweep.deactivated + defSweep.deactivated;
  summary.reportOnly = recSweep.reportOnly + defSweep.reportOnly;

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
        `pending_retention = a mapped signed-authorization source vanished from S1; rows/mappings were preserved. ` +
        `Acknowledge per run via --allow-findings, or resolve. STOP-THE-LINE for the final freeze run until retention is ruled.`,
    );
  }
  process.exit(loaderExitCode(result));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
