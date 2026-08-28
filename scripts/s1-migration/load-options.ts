/**
 * T4 loader — staged taxonomy terms → S2 options_* tables. Load-order step 1.
 *
 * Dispositions per 02-mapping / 06 v5:
 *   - grievance_industry      → options type `industry`             (naming trap: these are industries)
 *   - sirius_member_status    → options type `worker-ms`            (N12: mechanical by-tid remap)
 *   - sirius_payment_type     → options type `ledger-payment-type`
 *   - sirius_reltype          → options type `worker-relation-type`
 *   - sirius_work_status      → NOT migrated (06 §4.8a — vestigial; employment status derives from hour types)
 *   - sirius_hour_type        → NOT migrated as options; VERIFIED against options_employment_status
 *                               (T20's tid→name mapping must resolve for every live 1600-series tid + 1544)
 *   - sirius_election_type    → NOT an options table; T16 consumes term names as a coded remap
 *   - anything else           → counted as unhandled_vocabulary (fail-loud, never silent)
 *
 * Upsert semantics (no storage-level upsert-by-siriusId exists):
 *   1. match existing row by siriusId == tid                  → update name/sequence if drifted
 *   2. else match by name (case-insensitive; adopts seeded dev rows) → stamp siriusId + sequence
 *   3. else create {name, siriusId, sequence, description}
 * Every migrated term is recorded in s1_staging.id_map (entity `term`, s1_id = tid).
 *
 * Sync semantics (Task 292 — RUNBOOK §10): this loader is RECONCILING by
 * design. Mapped terms whose staged content_hash matches the consumed
 * fingerprint in id_map (same logic version) are skipped cheaply — no
 * storage reads. S1 edits and logic-version bumps reprocess exactly the
 * affected rows; --force-reconcile reprocesses everything. A deletion sweep
 * reports mapped terms that vanished from staging (report-only policy:
 * options rows may be FK-referenced by S2 data, so S1 deletions need an
 * operator ruling — acknowledge per run via --allow-findings deleted_in_s1).
 *
 * Usage: npx tsx scripts/s1-migration/load-options.ts [--dry-run]
 *          [--force-reconcile] [--allow-findings deleted_in_s1]
 * Output is aggregates + term names (taxonomy labels, not PII).
 */
import { db } from "../../server/storage/db";
import { sql } from "drizzle-orm";
import { createUnifiedOptionsStorage, type OptionsTypeName } from "../../server/storage/unified-options";
import { withNotificationsSuppressed } from "../../server/middleware/request-context";
import { ensureStagingSchema, recordRun } from "./lib/staging";
import { ensureIdMap, getMappings, putMapping, advanceFingerprints } from "./lib/idmap";
import {
  decodeThresholdFromTermName,
  mergeOptionData,
  readWorkerMsThreshold,
  thresholdPatch,
} from "../../shared/worker-ms-threshold";
import {
  buildLoaderResult,
  classifyRow,
  emitLoaderResult,
  emptySummary,
  loaderExitCode,
  parseAllowedFindings,
  parseForceReconcile,
  sweepDeletions,
  type RowDisposition,
  type SyncFinding,
} from "./lib/sync";

const DRY_RUN = process.argv.includes("--dry-run");
const LOADER = "t4-options";
/** Loader logic version — BUMP whenever transform logic changes so unchanged
 * S1 terms reprocess into the corrected S2 shape on their next run.
 * v2 (Task 415): decode the worker-ms hours threshold from the term name and
 * write it to data.sitespecific.bao.threshold (create AND already-mapped). */
const LOGIC_VERSION = 2;
const FORCE_RECONCILE = parseForceReconcile();
const ALLOWED_FINDINGS = parseAllowedFindings();
/** Dev-only: synthetic member-status terms stage no industry field. In
 * production every term must resolve (Q37) — without this flag, unresolved
 * industries fail the run. */
const ALLOW_UNRESOLVED_INDUSTRY = process.argv.includes("--allow-unresolved-industry");
/** Dev-only: `--fallback-industry <name>` assigns worker-ms terms whose
 * industry cannot be resolved (synthetic terms stage no fields) to the named
 * EXISTING options_industries row so downstream T6 is exercisable. NEVER for
 * production — prod terms all carry field_sirius_industry (Q37). */
const FALLBACK_INDUSTRY_NAME: string | null = (() => {
  const i = process.argv.indexOf("--fallback-industry");
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
})();

const VOCAB_TO_TYPE: Record<string, OptionsTypeName> = {
  grievance_industry: "industry", // synthetic dev DB vocab name
  sirius_industry: "industry", // production vocab name
  sirius_member_status: "worker-ms",
  sirius_payment_type: "ledger-payment-type",
  sirius_reltype: "worker-relation-type", // synthetic dev DB vocab name
  sirius_contact_relationship_types: "worker-relation-type", // production vocab name
  // Rehearsal finding 2026-08-07: empty bootstrap seeds NO options_gender
  // rows, so T3's name-match fallback resolves nothing in a real cutover.
  // Load the staged gender terms as options; T3 resolves via term id_map
  // first (its code already anticipates "sirius_gender loaded as options").
  sirius_gender: "gender",
};

/**
 * Relation types are the ONE options type whose sirius_id must carry the S1
 * LETTER CODE (term-attached `field_sirius_id`: C/SP/SC/DP/QMSCO/G/AC/RP/H),
 * not the tid — every EDI carrier plugin matches these codes. Ruling
 * (2026-08-05): S1 "ES" (Ex Spouse) is RETIRED at import and becomes "EX",
 * because carrier mappings historically treated "ES" as spouse-like and
 * ex-spouses must never emit as covered spouses. Terms staging no code
 * (synthetic dev vocab) fall back to the tid string.
 */
const RELTYPE_CODE_OVERRIDES: Record<string, string> = { ES: "EX" };

/**
 * options_gender.code is NOT NULL UNIQUE and terms stage no code, so derive
 * one deterministically at create time. The ONLY consumer of gender codes is
 * the Kaiser EDI plugin (M→01, F→02, everything else→03), so Male/Female must
 * get exactly "M"/"F"; any other term gets its name upper-cased and stripped
 * to alphanumerics (e.g. "Non-Binary" → "NONBINARY"). Fails loud on an empty
 * result; the DB unique constraint catches collisions.
 */
function genderCodeOf(name: string, tid: number): string {
  const n = name.trim().toLowerCase();
  if (n === "male" || n === "m") return "M";
  if (n === "female" || n === "f") return "F";
  const derived = name.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!derived) {
    throw new Error(`sirius_gender tid ${tid} "${name}" derives an empty code — fix the source term name`);
  }
  return derived;
}
function reltypeSiriusIdOf(t: StagedTermRow): string {
  const v = t.fields["field_sirius_id"];
  const scalar = Array.isArray(v) ? v[0] : v;
  const raw =
    typeof scalar === "string"
      ? scalar
      : scalar && typeof scalar === "object" && "value" in (scalar as any)
        ? String((scalar as any).value)
        : null;
  const code = raw?.trim() || null;
  if (!code) return String(t.tid);
  return RELTYPE_CODE_OVERRIDES[code] ?? code;
}

/** Vocabularies with an explicit non-options disposition — skipped WITHOUT alarm. */
const KNOWN_SKIPPED: Record<string, string> = {
  sirius_work_status: "not_migrated_4_8a",
  sirius_hour_type: "verify_only_employment_status",
  sirius_election_type: "consumed_by_T16_enrollment_type",
  // Production-real vocabularies whose terms are consumed straight from
  // s1_staging.terms by other loaders — no S2 options table to load into:
  grievance_contact_types: "consumed_by_T24_contact_type_names", // T24 resolves contact-type tids -> staged term names -> options_employer_contact_type
  sirius_contact_tags: "stage_only_except_T29_keep_tag", // smf_worker_month tag terms stay staged; T29 consumes ONLY "Comms: Received Enrollment Packet" straight from s1_staging.terms (N24 ruling 2026-08-05)
  // Production vocabulary name for the election-type terms (synthetic dev DB
  // named it sirius_election_type). T16 queries BOTH names (load-elections.ts).
  sirius_trust_election_type: "consumed_by_T16_enrollment_type",
  // --- Out-of-ETL-scope vocabularies observed in the real prod DB (first
  // full-data rehearsal 2026-08-07). Terms stay staged; nothing loads. ---
  // Grievance entity is DESCOPED/greenfield: prod has 0 grievance nodes
  // (06 §4.1); grievance config vocabularies have no S2 load target. Note
  // grievance_contact_types (T24) and grievance_industry (synthetic industry
  // name) are handled above — these are the remaining config vocabularies:
  grievance_alert_types: "grievance_descoped_greenfield",
  grievance_assignee_notes: "grievance_descoped_greenfield",
  grievance_broughtby: "grievance_descoped_greenfield",
  grievance_category: "grievance_descoped_greenfield",
  grievance_contract_clause_tags: "grievance_descoped_greenfield",
  grievance_contract_section_tags: "grievance_descoped_greenfield",
  grievance_department: "grievance_descoped_greenfield",
  grievance_document_types: "grievance_descoped_greenfield",
  grievance_job_classification: "grievance_descoped_greenfield",
  grievance_log_types: "grievance_descoped_greenfield",
  grievance_outcome: "grievance_descoped_greenfield",
  grievance_remedies: "grievance_descoped_greenfield",
  grievance_settlement_tags: "grievance_descoped_greenfield",
  grievance_shift: "grievance_descoped_greenfield",
  grievance_status: "grievance_descoped_greenfield",
  grievance_tags: "employer_tags_no_s2_equivalent_02_226",
  grievance_types: "grievance_descoped_greenfield",
  grievance_work_status: "grievance_descoped_greenfield",
  // Dispatch + skills out of scope (02 §8, 06 §4.7):
  sirius_dispatch_job_tags: "dispatch_out_of_scope",
  sirius_dispatch_job_type: "dispatch_out_of_scope",
  sirius_dispatch_sib: "dispatch_out_of_scope",
  sirius_worker_dispatch_status: "dispatch_out_of_scope",
  sirius_skill: "dispatch_skills_out_of_scope",
  // Events configured-but-empty in prod (0 sirius_event nodes, 06 §4.1):
  sirius_event_participant_role: "events_empty_no_etl",
  sirius_event_participant_status: "events_empty_no_etl",
  sirius_event_type: "events_empty_no_etl",
  // Benefit types resolve via sirius_trust_benefit NODES (lib/resolvers.ts),
  // never via these terms; ledger types are not consumed by T18 (raw ledger
  // stages verbatim):
  sirius_trust_benefit_type: "benefits_resolve_via_nodes_not_terms",
  sirius_ledger_type: "not_consumed_raw_ledger_verbatim",
};

/** Fallback capability check when the target table is empty (list() rows
 * otherwise reveal whether a siriusId column exists). */
const SIRIUSID_SUPPORTED = new Set<OptionsTypeName>(["industry", "worker-ms", "worker-relation-type"]);

/** Types whose table actually has a sequence column (supportsSequencing in
 * optionsMetadata); comparing/writing sequence on the others breaks idempotency. */
const SEQUENCE_SUPPORTED = new Set<OptionsTypeName>(["worker-ms", "ledger-payment-type"]);

/** T20's mapping — hour-type verify pass checks these tids resolve by name. */
const HOUR_TYPE_TID_TO_STATUS_NAME: Record<string, string> = {
  "1544": "Active", "1682": "No Charge", "1637": "Terminated", "1634": "LOA",
  "1633": "FMLA", "1632": "Disability", "1635": "Military Leave",
  "1691": "Initial Eligibility", "1662": "Deceased",
  "1701": "Event Center Hours Purchasing", "1636": "COBRA",
};

interface StagedTermRow {
  tid: number;
  vocabulary: string;
  name: string;
  description: string | null;
  weight: number;
  fields: Record<string, unknown>;
  /** Staged content_hash (consumed fingerprint source); null pre-upgrade. */
  contentHash: string | null;
}

/** Term-attached industry reference (Q37: prod member-status terms carry
 * field_sirius_industry as a tid). Handles scalar / array / wrapped shapes. */
function industryTidOf(fields: Record<string, unknown>): number | null {
  const v = fields["field_sirius_industry"];
  const scalar = Array.isArray(v) ? v[0] : v;
  if (typeof scalar === "number") return scalar;
  if (typeof scalar === "string" && /^\d+$/.test(scalar)) return Number(scalar);
  if (scalar && typeof scalar === "object" && "tid" in (scalar as any)) return Number((scalar as any).tid) || null;
  return null;
}

async function main() {
  const startedAt = new Date();
  await ensureStagingSchema();
  await ensureIdMap();
  const options = createUnifiedOptionsStorage();

  const res = await db.execute(sql`
    SELECT tid, vocabulary, name, description, weight, fields, content_hash FROM s1_staging.terms ORDER BY vocabulary, weight, tid
  `);
  const terms: StagedTermRow[] = (res as unknown as { rows: Array<Record<string, unknown>> }).rows.map((t) => ({
    tid: Number(t.tid),
    vocabulary: String(t.vocabulary),
    name: String(t.name),
    description: t.description == null ? null : String(t.description),
    weight: Number(t.weight),
    fields: (typeof t.fields === "string" ? JSON.parse(t.fields) : (t.fields ?? {})) as Record<string, unknown>,
    contentHash: t.content_hash == null ? null : String(t.content_hash),
  }));

  const report: Record<string, unknown> = { stagedTerms: terms.length };
  const perVocab: Record<string, { matchedIdMap: number; matchedSiriusId: number; adoptedByName: number; adoptedByCode: number; created: number; updated: number; unchanged: number }> = {};
  const skippedVocabs: Record<string, { reason: string; terms: number }> = {};
  const unhandled: Record<string, number> = {};

  // ---- hour-type verify pass (no writes) ----
  const statusRows = await db.execute(sql`SELECT name FROM options_employment_status`);
  const statusNames = new Set(
    (statusRows as unknown as { rows: Array<{ name: string }> }).rows.map((r) => r.name.toLowerCase()),
  );
  const hourTypeMissing = Object.values(HOUR_TYPE_TID_TO_STATUS_NAME).filter(
    (n) => !statusNames.has(n.toLowerCase()),
  );
  if (hourTypeMissing.length > 0) {
    throw new Error(`hour-type verify FAILED — options_employment_status missing: ${hourTypeMissing.join(", ")}`);
  }
  report.hourTypeVerify = "ok";

  const byVocab = new Map<string, StagedTermRow[]>();
  for (const t of terms) (byVocab.get(t.vocabulary) ?? byVocab.set(t.vocabulary, []).get(t.vocabulary)!).push(t);

  const existingMap = await getMappings("term", terms.map((t) => t.tid));

  // industries first — worker-ms terms resolve their industry through them
  const vocabOrder = [...byVocab.keys()].sort((a, b) => {
    const rank = (v: string) => (VOCAB_TO_TYPE[v] === "industry" ? 0 : 1);
    return rank(a) - rank(b) || a.localeCompare(b);
  });
  /** industry term tid → S2 options_industries id (filled while loading industries) */
  const industryByTid = new Map<number, string>();
  const summary = emptySummary();
  /** rows skipped by the consumed-fingerprint fast path (subset of summary.unchanged) */
  let fastPathSkips = 0;
  /** fingerprint advances for PRE-EXISTING mappings, applied after verify —
   * NEW mappings are stamped at putMapping time (the S2 write just landed). */
  const pendingAdvance: Array<{ s1Id: number; fingerprint: string | null }> = [];
  let workerMsUnresolvedIndustry = 0;
  let workerMsFallbackIndustry = 0;
  /** worker-ms thresholds decoded from term names and written to S2 (Task 415) */
  let workerMsThresholdApplied = 0;
  /** worker-ms terms whose name carries NO decodable "- NN hours" suffix —
   * reported explicitly (e.g. "PA Worker"); the eligibility default applies. */
  const workerMsThresholdMissing: string[] = [];
  /** dedupe the missing-threshold report across reruns of the same term */
  const workerMsThresholdMissingSeen = new Set<number>();
  /** resolved lazily on first use; null = lookup failed (throws) */
  let fallbackIndustryId: string | null | undefined = undefined;
  /** synthetic-signature gate: if ANY worker-ms term stages an industry
   * field, the staging set is production-shaped and fallback is refused. */
  const anyWorkerMsHasIndustryField = terms.some(
    (t) => VOCAB_TO_TYPE[t.vocabulary] === "worker-ms" && industryTidOf(t.fields) != null,
  );
  const skippedTids = new Set<number>();

  // ---- preflight: every vocabulary needs an explicit disposition BEFORE any write ----
  for (const [vocab, vterms] of byVocab) {
    if (!VOCAB_TO_TYPE[vocab] && !KNOWN_SKIPPED[vocab]) unhandled[vocab] = vterms.length;
  }
  if (Object.keys(unhandled).length > 0) {
    throw new Error(
      `UNHANDLED VOCABULARIES (need an explicit disposition before anything loads): ${Object.keys(unhandled).join(", ")}`,
    );
  }

  for (const vocab of vocabOrder) {
    const vterms = byVocab.get(vocab)!;
    const type = VOCAB_TO_TYPE[vocab];
    if (!type) {
      skippedVocabs[vocab] = { reason: KNOWN_SKIPPED[vocab], terms: vterms.length };
      continue;
    }
    const stats = (perVocab[vocab] = { matchedIdMap: 0, matchedSiriusId: 0, adoptedByName: 0, adoptedByCode: 0, created: 0, updated: 0, unchanged: 0 });
    // Consumed-fingerprint fast path (Task 292): classify every term BEFORE
    // touching storage. An unchanged term is skipped outright — but industry
    // terms must still feed the intra-run industryByTid cache from their
    // mapping, or changed worker-ms terms would falsely fail industry
    // resolution.
    const dispositions = new Map<number, RowDisposition>();
    for (const t of vterms) {
      dispositions.set(t.tid, classifyRow(existingMap.get(t.tid), t.contentHash, LOGIC_VERSION, FORCE_RECONCILE));
    }
    const skipUnchanged = (t: StagedTermRow) => {
      stats.unchanged++;
      summary.unchanged++;
      fastPathSkips++;
      if (type === "industry") {
        const m = existingMap.get(t.tid);
        if (m) industryByTid.set(t.tid, m.s2Id);
      }
    };
    if (vterms.every((t) => dispositions.get(t.tid) === "unchanged")) {
      for (const t of vterms) skipUnchanged(t);
      continue; // whole vocabulary unchanged — no storage reads at all
    }
    const rows: Array<{ id: string; name: string; code?: string | null; siriusId?: string | null; sequence?: number | null; industryId?: string | null; data?: Record<string, unknown> | null }> =
      await options.list(type);
    const supportsSiriusId = rows.length > 0 ? "siriusId" in rows[0] : SIRIUSID_SUPPORTED.has(type);
    const supportsSequence = SEQUENCE_SUPPORTED.has(type);
    const byId = new Map(rows.map((r) => [r.id, r]));
    const bySiriusId = new Map(rows.filter((r) => r.siriusId).map((r) => [String(r.siriusId), r]));
    const byName = new Map(rows.map((r) => [r.name.toLowerCase(), r]));
    // gender only: options_gender.code is NOT NULL UNIQUE and genderCodeOf()
    // collapses punctuation/case ("Non-binary"/"Nonbinary" → NONBINARY), so
    // distinct S1 term names can derive the SAME code. Resolve by code after
    // name-adoption misses, otherwise the create path hits the unique
    // constraint (seen on the first real-data run, 2026-08-08).
    const byCode = new Map(
      type === "gender" ? rows.filter((r) => r.code).map((r) => [String(r.code), r]) : [],
    );
    const ambiguousNames = new Set<string>();
    {
      const seen = new Set<string>();
      for (const r of rows) {
        const k = r.name.toLowerCase();
        if (seen.has(k)) ambiguousNames.add(k);
        seen.add(k);
      }
    }
    /** drift = fields that differ from the staged term and are writable for this type */
    const driftOf = (row: { name: string; sequence?: number | null; industryId?: string | null; data?: Record<string, unknown> | null }, t: StagedTermRow, industryId?: string) => {
      const patch: Record<string, unknown> = {};
      if (row.name !== t.name) patch.name = t.name;
      if (supportsSequence && row.sequence !== t.weight) patch.sequence = t.weight;
      if (type === "worker-ms" && industryId && row.industryId !== industryId) patch.industryId = industryId;
      // Canonical BAO threshold (Task 415): the S1 payload encodes it ONLY in
      // the term name's "- NN hours" suffix. When decodable and different
      // from the stored value, merge it into data.sitespecific.bao.threshold
      // WITHOUT touching sibling JSON keys. A name with no decodable
      // threshold is reported (never invented, never used to erase an
      // S2-configured value — legitimate S2-only data survives reruns).
      if (type === "worker-ms") {
        const decoded = workerMsThresholdOf(t);
        if (decoded !== null && readWorkerMsThreshold(row.data) !== decoded) {
          patch.data = mergeOptionData(row.data, thresholdPatch(decoded));
          workerMsThresholdApplied++;
        }
      }
      return patch;
    };
    /** decode + missing-report bookkeeping for a worker-ms term's threshold */
    const workerMsThresholdOf = (t: StagedTermRow): number | null => {
      const decoded = decodeThresholdFromTermName(t.name);
      if (decoded === null && !workerMsThresholdMissingSeen.has(t.tid)) {
        workerMsThresholdMissingSeen.add(t.tid);
        workerMsThresholdMissing.push(`tid ${t.tid} "${t.name}"`);
      }
      return decoded;
    };

    for (const t of vterms) {
      if (dispositions.get(t.tid) === "unchanged") {
        skipUnchanged(t);
        continue;
      }
      // The sirius_id VALUE for this term: letter code for relation types
      // (EDI plugins match codes), tid string for everything else.
      const tidStr = type === "worker-relation-type" ? reltypeSiriusIdOf(t) : String(t.tid);
      // worker-ms rows REQUIRE an industry (schema NOT NULL) — resolve the
      // term-attached industry tid (Q37) through this run's industry load.
      let industryId: string | undefined;
      if (type === "worker-ms") {
        const itid = industryTidOf(t.fields);
        industryId = itid != null ? industryByTid.get(itid) : undefined;
        // Fail-closed gating for --fallback-industry (Q37): it may ONLY apply
        // to the synthetic signature — a term that stages NO
        // field_sirius_industry at all, in a staging set where NO worker-ms
        // term carries the field. A term that HAS the field but doesn't
        // resolve is a real broken reference and must never be masked.
        const fallbackApplicable =
          !industryId && FALLBACK_INDUSTRY_NAME != null && industryTidOf(t.fields) == null && !anyWorkerMsHasIndustryField;
        if (!industryId && FALLBACK_INDUSTRY_NAME && !fallbackApplicable) {
          throw new Error(
            `--fallback-industry refused: worker-ms tid ${t.tid} does not match the synthetic signature ` +
              `(field_sirius_industry present somewhere in this staging set). This flag is dev-only — ` +
              `a production term with an unresolvable industry is a broken reference, fix the source.`,
          );
        }
        if (fallbackApplicable) {
          if (fallbackIndustryId === undefined) {
            const industries: Array<{ id: string; name: string }> = await options.list("industry");
            fallbackIndustryId = industries.find((r) => r.name.toLowerCase() === FALLBACK_INDUSTRY_NAME.toLowerCase())?.id ?? null;
            if (!fallbackIndustryId) {
              throw new Error(`--fallback-industry "${FALLBACK_INDUSTRY_NAME}" matches no options_industries row — it must already exist`);
            }
          }
          industryId = fallbackIndustryId ?? undefined;
          workerMsFallbackIndustry++;
        }
        if (!industryId) {
          // Counted skip (synthetic dev terms stage no fields; production
          // terms carry field_sirius_industry — this must be 0 in prod).
          workerMsUnresolvedIndustry++;
          skippedTids.add(t.tid);
          continue;
        }
      }
      // Resolution order: id_map (authoritative crosswalk) → siriusId column
      // (where the table has one) → name adoption (seeded dev rows) → create.
      const mapped = existingMap.get(t.tid);
      let row = mapped ? byId.get(mapped.s2Id) : undefined;
      if (mapped && !row) {
        throw new Error(
          `id_map maps ${vocab} tid ${t.tid} to ${type} row ${mapped.s2Id} which no longer exists — repair id_map before re-running`,
        );
      }
      if (row || (row = bySiriusId.get(tidStr))) {
        if (mapped && byId.has(mapped.s2Id)) stats.matchedIdMap++;
        else stats.matchedSiriusId++;
        const patch: Record<string, unknown> = driftOf(row, t, industryId);
        // Heal sirius_id drift on matched rows (e.g. relation-type letter
        // codes introduced 2026-08-05, incl. the ES→EX ruling).
        if (supportsSiriusId && row.siriusId !== tidStr) patch.siriusId = tidStr;
        if (Object.keys(patch).length > 0) {
          if (!DRY_RUN) await withNotificationsSuppressed(() => options.update(type, row!.id, patch));
          stats.updated++;
        }
      } else if ((row = byName.get(t.name.toLowerCase()))) {
        if (ambiguousNames.has(t.name.toLowerCase())) {
          throw new Error(
            `${vocab} term tid ${t.tid} "${t.name}" name-matches MULTIPLE ${type} rows — ambiguous adoption, resolve manually`,
          );
        }
        if (row.siriusId && row.siriusId !== tidStr) {
          throw new Error(
            `${vocab} term tid ${t.tid} "${t.name}" name-matches ${type} row ${row.id} which already carries siriusId ${row.siriusId} — resolve manually`,
          );
        }
        stats.adoptedByName++;
        // Adopted rows get the decoded threshold too — but ONLY when the
        // stored value differs, and merged so S2-only sibling JSON survives.
        let adoptionData: Record<string, unknown> | undefined;
        if (type === "worker-ms") {
          const decoded = workerMsThresholdOf(t);
          if (decoded !== null && readWorkerMsThreshold(row.data) !== decoded) {
            adoptionData = mergeOptionData(row.data, thresholdPatch(decoded));
            workerMsThresholdApplied++;
          }
        }
        const adoptionPatch = {
          ...(supportsSequence ? { sequence: t.weight } : {}),
          ...(supportsSiriusId ? { siriusId: tidStr } : {}),
          ...(type === "worker-ms" && industryId ? { industryId } : {}),
          ...(adoptionData ? { data: adoptionData } : {}),
        };
        if (!DRY_RUN && Object.keys(adoptionPatch).length > 0) {
          await withNotificationsSuppressed(() =>
            options.update(type, row!.id, adoptionPatch),
          );
        }
      } else if (type === "gender" && (row = byCode.get(genderCodeOf(t.name, t.tid)))) {
        // Distinct S1 names collapsing to one code (e.g. "Non-binary" after a
        // "Nonbinary" row) are the SAME logical gender — adopt the existing
        // row; id_map records this tid → the shared S2 row. The existing
        // row's name wins (first term loaded).
        stats.adoptedByCode++;
        console.log(
          `${vocab} tid ${t.tid} "${t.name}" adopts existing gender row "${row.name}" (code ${genderCodeOf(t.name, t.tid)})`,
        );
      } else {
        stats.created++;
        // New worker-ms rows carry the decoded threshold from birth.
        let createData: Record<string, unknown> | undefined;
        if (type === "worker-ms") {
          const decoded = workerMsThresholdOf(t);
          if (decoded !== null) {
            createData = mergeOptionData({}, thresholdPatch(decoded));
            workerMsThresholdApplied++;
          }
        }
        if (!DRY_RUN) {
          row = await withNotificationsSuppressed(() =>
            options.create(type, {
              name: t.name,
              ...(type === "gender" ? { code: genderCodeOf(t.name, t.tid) } : {}),
              ...(supportsSequence ? { sequence: t.weight } : {}),
              ...(supportsSiriusId
                ? { siriusId: tidStr }
                : { data: { s1Tid: t.tid } }), // no sirius_id column — spec: carry S1 id in data
              ...(createData ? { data: createData } : {}),
              ...(industryId ? { industryId } : {}),
              ...(t.description ? { description: t.description } : {}),
            }),
          );
          // Register the new row in the lookup maps so a LATER term in this
          // same run that name- or code-collides adopts it instead of hitting
          // the DB unique constraint.
          const created = row!;
          byId.set(created.id, created);
          const nk = t.name.toLowerCase();
          if (byName.has(nk)) ambiguousNames.add(nk);
          else byName.set(nk, created);
          if (type === "gender") byCode.set(genderCodeOf(t.name, t.tid), created);
        }
      }
      // Feed the intra-run industry cache for EVERY resolved disposition —
      // matched, adopted, created — INCLUDING dry-run (it is in-memory state,
      // not a write): worker-ms terms later in this run resolve through it.
      // Force-reconcile + dry-run previously starved it (the only feeds were
      // the fast-path skip and the id_map block below, which is !DRY_RUN),
      // making preview runs on a loaded target falsely report every
      // member-status term as industry-unresolvable. On an EMPTY-target
      // dry-run a created industry has no id yet — that combination
      // legitimately cannot resolve and is not supported.
      if (type === "industry" && row) industryByTid.set(t.tid, row.id);
      if (!DRY_RUN && row) {
        let winnerId = row.id;
        if (!existingMap.has(t.tid)) {
          // New mapping: consumed fingerprint stamped at insert time — the S2
          // write just landed and the verify pass below re-lists the table.
          winnerId = await putMapping("term", t.tid, row.id, {
            stub: false,
            loader: LOADER,
            fingerprint: t.contentHash,
            logicVersion: LOGIC_VERSION,
          });
          if (winnerId !== row.id) {
            console.error(
              `RACE: ${vocab} tid ${t.tid} already mapped to ${winnerId}; row ${row.id} may be an orphan — clean up manually`,
            );
          }
        } else {
          // Pre-existing mapping reconciled (updated or proven drift-free):
          // advance only AFTER verify so failed writes stay retryable.
          pendingAdvance.push({ s1Id: t.tid, fingerprint: t.contentHash });
        }
        if (type === "industry") industryByTid.set(t.tid, winnerId);
      }
    }
  }

  // ---- verify: every migrated tid resolves to an existing row — via the
  // siriusId column where the table has one, else via id_map ----
  let verifyFailures = 0;
  const verifyFailedTids = new Set<number>();
  if (!DRY_RUN) {
    const finalMap = await getMappings("term", terms.map((t) => t.tid));
    for (const [vocab, vterms] of byVocab) {
      const type = VOCAB_TO_TYPE[vocab];
      if (!type) continue;
      const rows: Array<{ id: string; siriusId?: string | null }> = await options.list(type);
      const haveSiriusId = new Set(rows.map((r) => r.siriusId).filter(Boolean));
      const haveId = new Set(rows.map((r) => r.id));
      for (const t of vterms) {
        if (skippedTids.has(t.tid)) continue; // counted skip, not a verify failure
        const m = finalMap.get(t.tid);
        const expectedSid = type === "worker-relation-type" ? reltypeSiriusIdOf(t) : String(t.tid);
        const ok = haveSiriusId.has(expectedSid) || (m != null && haveId.has(m.s2Id));
        if (!ok) {
          console.error(`VERIFY: ${vocab} tid ${t.tid} "${t.name}" not resolvable in ${type} (siriusId or id_map)`);
          verifyFailures++;
          verifyFailedTids.add(t.tid);
        }
      }
    }
  }

  // ---- advance consumed fingerprints (pre-existing mappings) — only after
  // the S2 writes landed and the verify pass established the target, so
  // failed writes stay retryable on the next run ----
  if (!DRY_RUN) {
    const toAdvance = pendingAdvance.filter((p) => !verifyFailedTids.has(p.s1Id));
    await advanceFingerprints("term", toAdvance, LOGIC_VERSION);
  }

  // ---- deletion sweep: mapped terms whose staged source vanished (deleted
  // in S1). Policy: report-only — options rows may be FK-referenced by S2
  // data, so S1 term deletions need an operator ruling per finding. ----
  const findings: SyncFinding[] = [];
  const sweep = await sweepDeletions({
    entity: "term",
    loaders: [LOADER],
    sourceSql: sql`SELECT tid AS s1_id FROM s1_staging.terms`,
    dryRun: DRY_RUN,
    policy: async () => ({
      action: "report-only",
      detail: { reason: "options rows may be FK-referenced by S2 data; S1 term deletion needs an operator ruling" },
    }),
  });
  summary.deleted += sweep.deleted;
  summary.deactivated += sweep.deactivated;
  summary.reportOnly += sweep.reportOnly;
  findings.push(...sweep.findings);

  for (const s of Object.values(perVocab)) {
    summary.created += s.created;
    summary.updated += s.updated + s.adoptedByName + s.adoptedByCode;
    // matched rows whose drift patch was empty were reconciled but unchanged
    summary.unchanged += Math.max(0, s.matchedIdMap + s.matchedSiriusId - s.updated);
  }

  report.perVocab = perVocab;
  report.workerMsUnresolvedIndustry = workerMsUnresolvedIndustry;
  report.workerMsFallbackIndustry = workerMsFallbackIndustry;
  report.workerMsThresholdApplied = workerMsThresholdApplied;
  report.workerMsThresholdMissing = workerMsThresholdMissing;
  report.skippedVocabs = skippedVocabs;
  report.unhandledVocabularies = unhandled;
  report.fastPathSkips = fastPathSkips;
  report.sweep = { candidates: sweep.candidates, alreadyHandled: sweep.alreadyHandled };

  const result = buildLoaderResult({
    loader: LOADER,
    logicVersion: LOGIC_VERSION,
    dryRun: DRY_RUN,
    forceReconcile: FORCE_RECONCILE,
    summary,
    verifyFailures,
    findings,
    allowedFindings: ALLOWED_FINDINGS,
    detail: report,
  });
  emitLoaderResult(result);
  if (!DRY_RUN) {
    await recordRun(startedAt, { loader: LOADER, forceReconcile: FORCE_RECONCILE }, result as unknown as Record<string, unknown>);
  }

  if (workerMsUnresolvedIndustry > 0 && !ALLOW_UNRESOLVED_INDUSTRY) {
    console.error(
      `FAIL: ${workerMsUnresolvedIndustry} member-status terms have no resolvable industry (must be 0 in production — Q37). Dev-only override: --allow-unresolved-industry`,
    );
    process.exit(1);
  }
  if (result.blockingFindings.length > 0) {
    console.error(
      `FAIL: ${result.blockingFindings.length} blocking sync finding(s) (${[...new Set(result.blockingFindings.map((f) => f.kind))].join(", ")}). ` +
        `Resolve them or acknowledge per run via --allow-findings.`,
    );
  }
  process.exit(loaderExitCode(result));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
