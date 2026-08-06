/**
 * T29 loader — smf_worker_month "Comms: Received Enrollment Packet" tag →
 * one offline `comm` record per tagged (worker, month).
 *
 * RULING (2026-08-05, closes N24): every smf_worker_month tag stays
 * extract-and-stage only EXCEPT exactly one — "Comms: Received Enrollment
 * Packet" — which migrates into S2. All other tag terms are stale computed
 * eligibility state and must NOT load.
 *
 * S2 HOME DECISION (build-time, this loader is the record of it):
 * The N24 leading candidate was the comm + comm_interaction shape from
 * load-call-logs.ts. Investigation ruled that out: `comm_interaction`
 * requires a NOT NULL `call_reason_id` FK into the seeded MSR call reasons
 * and a channel constrained to the six call/visit channels
 * (INTERACTION_CHANNELS) — "received an enrollment packet" is not a member
 * service interaction, and forcing it in would require a fake call reason
 * plus a misused channel, polluting MSR interaction reporting. A
 * `comm_postal` child is also out: its to-address columns are NOT NULL and
 * S1 carries no packet address. The chosen home is the PARENT shape of the
 * same comm family: one plain `comm` row with
 *   medium   = 'offline'            (free-form varchar; the comm history UI
 *                                    renders unknown mediums as a plain
 *                                    capitalized label, and
 *                                    getCommWithDetails falls through with
 *                                    all child details null)
 *   status   = 'logged'             (shared/commStatus.ts)
 *   contact  = the tagged worker's contact (workers.contact_id)
 *   sent = received = first-of-month UTC of the tagged month
 *   data     = { s1Loader, kind: 'enrollment_packet_received', label,
 *                ym, s1: { nid, workerNid, tid } }
 * so the record shows up in the worker's comm history dated to the tagged
 * month, without inventing interaction or postal detail rows.
 *
 * Scope: staged `smf_worker_month` rows whose multi-value
 * `field_sirius_contact_tags` tids include the keep-tag term (resolved from
 * s1_staging.terms by normalized name in vocabulary `sirius_contact_tags`).
 * Rows with other tags / no tags are out of scope — NOT rejects, they are
 * ruled stage-only. A keep-tag-named term staged under any OTHER vocabulary
 * hard-fails the run before any write (never guess scope).
 *
 * GRAIN: one S2 record per (worker, month). Duplicate tagged worker-month
 * nodes for the same (worker, month) adopt the first node's comm (both nids
 * map to it) — counted, never duplicated.
 *
 * Idempotent via id_map entity "wm-packet" (nid → comm id); crash repair by
 * provenance: an unmapped row whose (contact, month) already has a comm
 * created by this loader (data->>'s1Loader') is re-adopted, never
 * re-created (T16/T19 pattern). Mapped rows whose comm was deleted
 * hard-reject (`mapped_comm_missing`) — repair the map, never remap
 * silently.
 *
 * Prod scale: the bundle is ~2.53M nodes / 13.57M tag field rows; the
 * loader streams staged rows via keyset paging (pagedStaged) and every
 * lookup (worker id_map, workers.contact_id, provenance prefetch, mapped
 * comm existence, verify) is a page-bounded batched IN-query.
 *
 * REJECT POLICY (fail loud): every reject reason present in the run must be
 * explicitly allowed via `--allow-rejects r1,r2,...` or the run exits 1
 * (after the full report).
 *
 * Pass --migration-mode to run every write inside a charge-plugin-suppressed
 * scope (loader convention); notification suppression always applies.
 *
 * Usage:
 *   npx tsx scripts/s1-migration/load-enrollment-packet-tags.ts \
 *     [--dry-run] [--allow-rejects r1,r2] [--migration-mode]
 *
 * Dev note: the synthetic S1 MariaDB predates the tag vocabulary (its
 * sirius_contact_tags tids are all NULL and no tag terms exist), so a dev
 * run is a documented no-op (keepTagTids=0, inScope=0). Real coverage lives
 * in scripts/oneoffs/s1-t29-packet-tag-smoke.ts (seeded fakes,
 * self-cleaning).
 *
 * Output is AGGREGATES ONLY (plus S1 nids/tids, which are opaque ids).
 */
import { db } from "../../server/storage/db";
// IMPORTANT: initialize the storage barrel BEFORE importing ./comm directly —
// importing comm.ts first creates a partial-init cycle (database.ts reads
// commLoggingConfig mid-initialization → TDZ ReferenceError at module load).
import "../../server/storage/database";
import { sql } from "drizzle-orm";
import {
  withNotificationsSuppressed,
  withChargePluginsSuppressed,
} from "../../server/middleware/request-context";
import { ensureStagingSchema, recordRun } from "./lib/staging";
import { ensureIdMap, getMappings, putMapping } from "./lib/idmap";
import { RejectLog, pagedStaged, stagedCountOf, chunk, strOf, toYmd } from "./lib/loader-utils";
import { createCommStorage } from "../../server/storage/comm";

const LOADER = "t29-enrollment-packet-tags";
const BUNDLE = "smf_worker_month";
const ID_MAP_ENTITY = "wm-packet";
const KEEP_TAG_NAME = "comms: received enrollment packet"; // normalized (TRIM/LOWER)
const KEEP_TAG_VOCABULARY = "sirius_contact_tags";
const COMM_MEDIUM = "offline";
const COMM_KIND = "enrollment_packet_received";
const COMM_LABEL = "Received Enrollment Packet";

const DRY_RUN = process.argv.includes("--dry-run");
const MIGRATION_MODE = process.argv.includes("--migration-mode");
const ALLOWED_REJECTS: string[] = (() => {
  const i = process.argv.indexOf("--allow-rejects");
  return i >= 0 ? String(process.argv[i + 1] ?? "").split(",").filter(Boolean) : [];
})();

function loaderScope<T>(fn: () => Promise<T>): Promise<T> {
  return MIGRATION_MODE
    ? withChargePluginsSuppressed(() => withNotificationsSuppressed(fn))
    : withNotificationsSuppressed(fn);
}

/** All reasons are row-skipping (fatal) — the verify pass skips exactly these. */
const FATAL_REASONS = [
  "worker_ref_missing",
  "worker_unmapped",
  "worker_row_missing",
  "date_missing",
  "bad_date",
  "create_failed",
  "mapped_comm_missing",
] as const;

/** All term-reference tids of a (possibly multi-value) staged field. NULL
 * entries (the stale synthetic dev data) are ignored. */
function tidsOf(fields: Record<string, unknown>, key: string): number[] {
  const raw = fields[key];
  const arr = Array.isArray(raw) ? raw : raw == null ? [] : [raw];
  const out: number[] = [];
  for (const v of arr) {
    if (typeof v === "number") out.push(v);
    else if (typeof v === "string" && /^\d+$/.test(v)) out.push(Number(v));
    else if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      const cand = o.tid ?? o.target_id ?? o.value;
      if (typeof cand === "number") out.push(cand);
      else if (typeof cand === "string" && /^\d+$/.test(cand)) out.push(Number(cand));
    }
  }
  return out;
}

/** Entityreference target nid (single-value) — bare scalar or object shape. */
function workerNidOf(fields: Record<string, unknown>): number | null {
  const raw = fields["field_sirius_worker"];
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

const dedupeKey = (contactId: string, ym: string) => `${contactId}|${ym}`;

async function main() {
  const startedAt = new Date();
  await ensureStagingSchema();
  await ensureIdMap();

  if (MIGRATION_MODE) {
    console.error("MIGRATION MODE: charge-plugin execution is suppressed for all writes in this run.");
  }

  const report: Record<string, unknown> = { loader: LOADER, dryRun: DRY_RUN, allowedRejects: ALLOWED_REJECTS };
  const rejects = new RejectLog();

  report.staged = await stagedCountOf(BUNDLE);

  // ---- resolve the keep-tag term(s) from staged taxonomy -------------------
  // Name-normalized match across ALL vocabularies: a hit outside the expected
  // vocabulary is a scope surprise and hard-fails before any write.
  const termRes = (await db.execute(sql`
    SELECT tid, vocabulary, name FROM s1_staging.terms
     WHERE LOWER(TRIM(name)) = ${KEEP_TAG_NAME}
  `)) as unknown as { rows: Array<{ tid: string | number; vocabulary: string; name: string }> };
  const foreignVocabs = termRes.rows.filter((r) => r.vocabulary !== KEEP_TAG_VOCABULARY);
  if (foreignVocabs.length > 0) {
    throw new Error(
      `ABORTING: keep-tag term name found in unexpected vocabular(ies): ` +
        foreignVocabs.map((r) => `${r.vocabulary} (tid ${r.tid})`).join(", ") +
        `. Expected only ${KEEP_TAG_VOCABULARY}; investigate before loading. Nothing was written.`,
    );
  }
  const keepTagTids = new Set(termRes.rows.map((r) => Number(r.tid)));
  report.keepTagTids = [...keepTagTids];
  if (keepTagTids.size === 0) {
    console.error(
      `NOTE: no staged term named "${KEEP_TAG_NAME}" in ${KEEP_TAG_VOCABULARY} — ` +
        `zero rows can be in scope (expected on the synthetic dev source, which stages no tag vocabulary).`,
    );
  }

  const comms = createCommStorage();

  // ---- global counters ------------------------------------------------------
  let pages = 0;
  let inScope = 0;
  let alreadyMapped = 0;
  let created = 0;
  let adoptedByProvenance = 0;
  let duplicateWorkerMonth = 0;
  let verifyFailures = 0;
  const distinctWorkerNids = new Set<number>();
  const distinctMonths = new Set<string>();
  const verifySamples: Array<Record<string, unknown>> = [];
  /** comm ids created in THIS run (all pages) — distinguishes duplicate
   * worker-month adoption from crash-repair provenance adoption. */
  const createdThisRun = new Set<string>();

  // ---- keyset-paged pipeline: filter → resolve → write → verify per page ----
  for await (const staged of pagedStaged(BUNDLE)) {
    pages++;

    // scope filter first — at prod volume most rows carry no keep-tag.
    const scoped = keepTagTids.size === 0
      ? []
      : staged.filter((s) => tidsOf(s.fields, "field_sirius_contact_tags").some((t) => keepTagTids.has(t)));
    if (scoped.length === 0) continue;
    inScope += scoped.length;

    // ---- page-batched lookups ----
    const workerNids: number[] = [];
    for (const s of scoped) {
      const n = workerNidOf(s.fields);
      if (n != null) workerNids.push(n);
    }
    const [workerMap, idMap] = await Promise.all([
      getMappings("worker", workerNids),
      getMappings(ID_MAP_ENTITY, scoped.map((s) => s.nid)),
    ]);

    // workers.contact_id for the page's mapped workers
    const contactByWorkerId = new Map<string, string>();
    const workerIds = [...new Set([...workerMap.values()].map((v) => v.s2Id))];
    for (const ids of chunk(workerIds, 500)) {
      const res = (await db.execute(sql`
        SELECT id, contact_id FROM workers
         WHERE id IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})
      `)) as unknown as { rows: Array<{ id: string; contact_id: string }> };
      for (const r of res.rows) contactByWorkerId.set(r.id, r.contact_id);
    }

    // mapped comm existence (idempotent re-runs; broken maps hard-reject)
    const mappedCommIds = [...new Set([...idMap.values()].map((v) => v.s2Id))];
    const commExists = new Set<string>();
    for (const ids of chunk(mappedCommIds, 500)) {
      const res = (await db.execute(sql`
        SELECT id FROM comm WHERE id IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})
      `)) as unknown as { rows: Array<{ id: string }> };
      for (const r of res.rows) commExists.add(r.id);
    }

    // provenance prefetch: this loader's comms for the page's contacts,
    // keyed (contact, ym) — crash repair AND duplicate worker-month adoption.
    const provenanceByKey = new Map<string, string>(); // (contactId|ym) → comm id
    const pageContactIds = [...new Set([...contactByWorkerId.values()])];
    for (const ids of chunk(pageContactIds, 200)) {
      const res = (await db.execute(sql`
        SELECT id, contact_id, data->>'ym' AS ym FROM comm
         WHERE medium = ${COMM_MEDIUM} AND data->>'s1Loader' = ${LOADER}
           AND contact_id IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})
      `)) as unknown as { rows: Array<{ id: string; contact_id: string; ym: string | null }> };
      for (const r of res.rows) {
        if (r.ym) provenanceByKey.set(dedupeKey(r.contact_id, r.ym), r.id);
      }
    }

    // ---- resolve + write pass ----
    /** nid → expected comm id (verify pass, this page). */
    const expected = new Map<number, string>();

    for (const s of scoped) {
      const nid = s.nid;

      const mapped = idMap.get(nid);
      if (mapped) {
        if (!commExists.has(mapped.s2Id)) {
          rejects.add("mapped_comm_missing", { nid }, nid);
          continue;
        }
        alreadyMapped++;
        expected.set(nid, mapped.s2Id);
        continue;
      }

      const workerNid = workerNidOf(s.fields);
      if (workerNid == null) {
        rejects.add("worker_ref_missing", { nid }, nid);
        continue;
      }
      const workerId = workerMap.get(workerNid)?.s2Id;
      if (!workerId) {
        rejects.add("worker_unmapped", { nid, workerNid }, nid);
        continue;
      }
      const contactId = contactByWorkerId.get(workerId);
      if (!contactId) {
        rejects.add("worker_row_missing", { nid, workerNid }, nid);
        continue;
      }

      const dateRaw = strOf(s.fields, "field_sirius_date_start");
      if (!dateRaw) {
        rejects.add("date_missing", { nid }, nid);
        continue;
      }
      const ymd = toYmd(dateRaw);
      if (!ymd) {
        rejects.add("bad_date", { nid }, nid);
        continue;
      }
      const ym = ymd.slice(0, 7); // YYYY-MM (month grain)
      const [y, m] = [Number(ym.slice(0, 4)), Number(ym.slice(5, 7))];
      const monthDate = new Date(Date.UTC(y, m - 1, 1));

      distinctWorkerNids.add(workerNid);
      distinctMonths.add(ym);

      // one record per (worker, month): adopt an existing comm for the same
      // (contact, ym) — either crash repair or a duplicate tagged node.
      const key = dedupeKey(contactId, ym);
      const existing = provenanceByKey.get(key);
      if (existing) {
        // rows created earlier THIS run = duplicate worker-month node sharing
        // the comm; provenance rows preexisting the run = crash repair.
        const isDuplicateNode = createdThisRun.has(existing) || existing.startsWith("dry:");
        if (isDuplicateNode) duplicateWorkerMonth++;
        else adoptedByProvenance++;
        if (!DRY_RUN) {
          await putMapping(ID_MAP_ENTITY, nid, existing, { stub: false, loader: LOADER });
          expected.set(nid, existing);
        }
        continue;
      }

      if (DRY_RUN) {
        created++;
        provenanceByKey.set(key, `dry:${nid}`);
        continue;
      }

      const tid = tidsOf(s.fields, "field_sirius_contact_tags").find((t) => keepTagTids.has(t))!;
      try {
        const row = await loaderScope(() =>
          comms.createComm({
            medium: COMM_MEDIUM,
            contactId,
            status: "logged",
            sent: monthDate,
            received: monthDate,
            data: {
              s1Loader: LOADER,
              kind: COMM_KIND,
              label: COMM_LABEL,
              ym,
              s1: { nid, workerNid, tid },
            },
          }),
        );
        await putMapping(ID_MAP_ENTITY, nid, row.id, { stub: false, loader: LOADER });
        provenanceByKey.set(key, row.id);
        createdThisRun.add(row.id);
        expected.set(nid, row.id);
        created++;
      } catch {
        // SANITIZED: never log raw error text — driver messages can embed
        // row values (HIPAA).
        rejects.add("create_failed", { nid }, nid);
      }
    }

    // ---- verify pass (page-scoped, batched) ----
    if (!DRY_RUN && expected.size > 0) {
      const vMap = await getMappings(ID_MAP_ENTITY, [...expected.keys()]);
      const vIds = [...new Set([...vMap.values()].map((v) => v.s2Id))];
      const vExists = new Set<string>();
      for (const ids of chunk(vIds, 500)) {
        const res = (await db.execute(sql`
          SELECT id FROM comm WHERE medium = ${COMM_MEDIUM}
             AND id IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})
        `)) as unknown as { rows: Array<{ id: string }> };
        for (const r of res.rows) vExists.add(r.id);
      }
      for (const [nid] of expected) {
        if (rejects.hasAnyIn(nid, FATAL_REASONS)) continue;
        const m = vMap.get(nid);
        if (!m || !vExists.has(m.s2Id)) {
          verifyFailures++;
          if (verifySamples.length < 25) verifySamples.push({ nid });
        }
      }
    }
  }

  report.pages = pages;
  report.inScope = inScope;
  report.distinctWorkers = distinctWorkerNids.size;
  report.distinctMonths = distinctMonths.size;
  report.alreadyMapped = alreadyMapped;
  report.created = created;
  report.adoptedByProvenance = adoptedByProvenance;
  report.duplicateWorkerMonth = duplicateWorkerMonth;
  report.rejects = rejects.counts;
  report.rejectSamples = rejects.samples;
  report.verifyFailures = verifyFailures;
  if (verifySamples.length > 0) report.verifyFailureSamples = verifySamples;

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
