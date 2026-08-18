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
 *     they cannot load; the count is the audit trail.
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
 * Fund defect classes are surfaced as counts, never silent picks/drops:
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
 *   bad_json             — field_sirius_json present but unparseable
 *   duplicate_signed     — storage DUPLICATE_SIGNED validation (a signed
 *                          cardcheck for this worker+definition already
 *                          exists — S1-side duplicate, triage)
 *   create_failed        — storage write failed (sanitized code only)
 *
 * Reconciliation & verify gate: the staged-side per-definition × per-status
 * table is recomputed at run time and emitted (`stagedByDefinition`) so the
 * fund can diff it against their S1 baseline (Kaiser PDF 777 / Health Net
 * PDF 318 / HN arb 12 / Kaiser arb 7 — drift expected, S1 is live). Per
 * cell, staged == loaded (created+adopted) + rejected + skipped is asserted;
 * every loaded record must have an id_map entry and an existing cardchecks
 * row; every definition must resolve to exactly one S2 row.
 *
 * Idempotent: records via id_map (entity `cardcheck`, nid → S2 cardcheck
 * id — mapped rows skip); definitions via `cardcheck_definitions.sirius_id`
 * upsert (unchanged rows adopt).
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
 *   npx tsx scripts/s1-migration/load-cardchecks.ts [--dry-run] [--allow-rejects r1,r2] [--migration-mode]
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
import { ensureIdMap, getMappings, putMapping } from "./lib/idmap";
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
  "bad_json",
  "duplicate_signed",
  "create_failed",
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
}

type RawLogRow = {
  nid: string | number;
  created: string | number | null;
  changed: string | number | null;
  fields: unknown;
};

function mapLogRow(r: RawLogRow): StagedLogRow {
  return {
    nid: Number(r.nid),
    created: r.created == null ? null : Number(r.created),
    changed: r.changed == null ? null : Number(r.changed),
    fields: (typeof r.fields === "string" ? JSON.parse(r.fields) : r.fields ?? {}) as Record<string, unknown>,
  };
}

/** Keyset-paged staged read for sirius_log (nid, created, changed, fields —
 * local variant of the generic pagedStaged helper, which selects title). */
async function* pagedStagedLogs(
  pageSize: number = LOADER_PAGE_SIZE,
): AsyncGenerator<StagedLogRow[]> {
  let lastNid = -1;
  for (;;) {
    const res = await db.execute(sql`
      SELECT nid, created, changed, fields FROM s1_staging.records
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

/** Staged rows for a nid set, ANY bundle (handler-target / pointer-nid
 * resolution). A nid can exist under >1 bundle (PK is bundle+nid) — all are
 * returned. */
async function stagedByNid(
  nids: number[],
): Promise<Map<number, Array<{ bundle: string; title: string | null; fields: Record<string, unknown> }>>> {
  const out = new Map<number, Array<{ bundle: string; title: string | null; fields: Record<string, unknown> }>>();
  for (const part of chunk([...new Set(nids)], 500)) {
    if (part.length === 0) continue;
    const res = await db.execute(sql`
      SELECT nid, bundle, title, fields FROM s1_staging.records
       WHERE nid IN (${sql.join(part.map((n) => sql`${n}`), sql`, `)})
    `);
    for (const row of (res as unknown as {
      rows: Array<{ nid: string | number; bundle: string; title: string | null; fields: unknown }>;
    }).rows) {
      const k = Number(row.nid);
      const entry = {
        bundle: row.bundle,
        title: row.title,
        fields: (typeof row.fields === "string" ? JSON.parse(row.fields) : row.fields ?? {}) as Record<string, unknown>,
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
  const stagedDefNodes = await loadStaged("sirius_json_definition");
  const ccDefNodes = stagedDefNodes.filter(
    (d) => norm(strOf(d.fields, "field_sirius_type")) === "sirius:cardcheck",
  );

  /** definition nid → S2 definition id + title (records pass + report). */
  const defByNid = new Map<number, { s2Id: string; title: string }>();
  const defStats = { staged: ccDefNodes.length, created: 0, updated: 0, adopted: 0, skipped: 0 };

  // Resolve every pointer nid in one batch.
  const pointerNids: number[] = [];
  const defParsed = new Map<number, { decoded: DecodedJson; disclaimerNid: number | null; customfieldNid: number | null }>();
  for (const d of ccDefNodes) {
    const decoded = decodeStagedJson(d.fields);
    if (decoded.present && decoded.parseError) {
      rejects.add("definition_json_unparseable", { nid: d.nid }, d.nid);
    }
    const defRoot = isPlainObject(decoded.parsed) ? decoded.parsed["cardcheck_definition"] : undefined;
    const disclaimerNid = numOf(isPlainObject(defRoot) ? defRoot["disclaimer_nid"] : undefined);
    const customfieldNid = numOf(isPlainObject(defRoot) ? defRoot["customfield_nid"] : undefined);
    if (disclaimerNid != null) pointerNids.push(disclaimerNid);
    if (customfieldNid != null) pointerNids.push(customfieldNid);
    defParsed.set(d.nid, { decoded, disclaimerNid, customfieldNid });
  }
  const pointerRows = await stagedByNid(pointerNids);

  for (const d of ccDefNodes) {
    const { decoded, disclaimerNid, customfieldNid } = defParsed.get(d.nid)!;
    const title = d.title?.trim() || null;
    if (!title) {
      // Definition SKIPPED — a nameless definition is unusable; its records
      // reject as definition_unresolved downstream.
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
        }
        defByNid.set(d.nid, { s2Id: existing.id, title });
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
  const stats = { created: 0, alreadyMapped: 0, noWorkerHandler: 0, multiWorkerTargets: 0 };
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
    loaded: number; // created + alreadyMapped (adopted)
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

  /** nids for the verify pass (created + already-mapped). */
  const mappedNids: number[] = [];

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
      const rawStatus = norm(strOf(r.fields, "field_sirius_type"));
      const statusKey = rawStatus ?? "missing";
      const handlers = targetNidsOf(r.fields, "field_sirius_log_handler");
      const defTargets = handlers.filter((n) => defByNid.has(n));
      const defKey = defTargets.length === 1 ? String(defTargets[0]) : "unresolved";
      const cell = cellOf(defKey, statusKey);
      cell.staged++;

      if (idMap.has(r.nid)) {
        stats.alreadyMapped++;
        cell.loaded++;
        mappedNids.push(r.nid);
        continue;
      }

      const status = rawStatus != null ? STATUS_MAP[rawStatus] : undefined;
      if (!status) {
        rejects.add("status_unknown", { nid: r.nid, status: statusKey }, r.nid);
        cell.rejected++;
        continue;
      }

      if (defTargets.length === 0) {
        const notStagedCount = handlers.filter((n) => !handlerRows.has(n)).length;
        rejects.add(
          "definition_unresolved",
          { nid: r.nid, handlers, notStagedTargets: notStagedCount },
          r.nid,
        );
        cell.rejected++;
        continue;
      }
      if (defTargets.length > 1) {
        rejects.add("ambiguous_definition", { nid: r.nid, definitionNids: defTargets }, r.nid);
        cell.rejected++;
        continue;
      }
      const defNid = defTargets[0];
      const definition = defByNid.get(defNid)!;

      // Worker resolution — per-target by staged bundle, never delta order.
      const workerTargets = handlers.filter((n) =>
        (handlerRows.get(n) ?? []).some((row) => row.bundle === "sirius_worker"),
      );
      if (workerTargets.length > 1) stats.multiWorkerTargets++;
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
      if (workerId == null) {
        // Unaccounted targets: everything that is neither the resolved
        // definition nor a mapped worker.
        const leftover = handlers.filter((n) => n !== defNid);
        if (leftover.length === 0) {
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
          { nid: r.nid, handlers, definitionNid: defNid },
          r.nid,
        );
        cell.rejected++;
        continue;
      }

      // JSON payload — absent/empty tolerated (clear() wipes signed records
      // back to unsigned in place); unparseable is a fatal reject.
      const decoded = decodeStagedJson(r.fields);
      if (decoded.parseError) {
        rejects.add("bad_json", { nid: r.nid }, r.nid);
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
        stats.created++;
        cell.loaded++;
        continue;
      }

      try {
        const cardcheck = await loaderScope(() =>
          storage.cardchecks.createCardcheck({
            workerId: workerId!,
            cardcheckDefinitionId: definition.s2Id,
            status,
            signedDate,
            data: {
              s1: {
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
              },
            },
          }),
        );
        await putMapping(ID_MAP_ENTITY, r.nid, cardcheck.id, { stub: false, loader: LOADER });
        mappedNids.push(r.nid);
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

  // ── Verify pass: id_map + row existence, definitions exactly-one ─────────
  progress.phase("verify", mappedNids.length);
  if (!DRY_RUN) {
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
          continue;
        }
        if (!found.has(m.s2Id)) {
          console.error(`VERIFY: cardcheck nid ${nid} maps to missing cardchecks row ${m.s2Id}`);
          verifyFailures++;
        }
      }
    }
    // Every loaded definition resolves to exactly one S2 row by sirius_id.
    for (const [nid] of defByNid) {
      const res = await db.execute(
        sql`SELECT count(*)::int AS n FROM cardcheck_definitions WHERE sirius_id = ${String(nid)}`,
      );
      const n = Number((res as unknown as { rows: Array<{ n: number }> }).rows[0]?.n ?? 0);
      if (n !== 1) {
        console.error(`VERIFY: definition nid ${nid} resolves to ${n} cardcheck_definitions rows (expected 1)`);
        verifyFailures++;
      }
    }
  }

  progress.stop();

  report.stats = stats;
  report.defectClasses = defects;
  report.recordsWithJson = recordsWithJson;
  report.recordsWithEsig = recordsWithEsig;
  report.unresolvedHandlerNids = {
    byStagedBundle: unresolvedHandlersByBundle,
    notStaged: unresolvedHandlersNotStaged,
  };
  report.rejects = rejects.counts;
  report.rejectSamples = rejects.samples;
  report.verifyFailures = verifyFailures;
  report.elapsedSeconds = Math.round((Date.now() - startedAt.getTime()) / 1000);

  const disallowed = rejects.disallowedReasons(ALLOWED_REJECTS);
  console.log(JSON.stringify(report, null, 2));
  if (!DRY_RUN) await recordRun(startedAt, { loader: LOADER, allowedRejects: ALLOWED_REJECTS }, report);

  if (verifyFailures > 0) process.exit(1);
  if (disallowed.length > 0) {
    console.error(
      `FAIL: reject reason(s) not allowed for this run: ${disallowed.map((d) => `${d.reason}=${d.count}`).join(", ")}. ` +
        `Every expected reject class must be explicitly allowed via --allow-rejects.`,
    );
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
