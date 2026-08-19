/**
 * T29 loader — sirius_contact "Comms: Received Enrollment Packet" tag →
 * one offline `comm` record per tagged contact node.
 *
 * RULING (2026-08-05, closes N24; grain corrected 2026-08-11): every S1 tag
 * stays extract-and-stage only EXCEPT exactly one — "Comms: Received
 * Enrollment Packet" — which migrates into S2. All other tag terms are stale
 * computed eligibility state and must NOT load.
 *
 * GRAIN CORRECTION (2026-08-11): the original N24 ruling assumed the keep-tag
 * lived on `smf_worker_month` rows. Diagnostic queries against both
 * s1_staging.records and the live S1 MariaDB proved otherwise: the tag NEVER
 * appears on worker-month nodes (they carry only the ruled-drop stale
 * eligibility tags, e.g. tid 1578). It is a CONTACT-level tag: 14,801
 * `sirius_contact` nodes carry tid 1689; zero worker-month rows do. The prod
 * run's inScope: 0 was this loader scanning the wrong bundle. The
 * worker-month grain and first-of-month dating are therefore DEAD; this
 * loader now scopes staged `sirius_contact` rows and writes one comm per
 * tagged contact node, resolved directly through the contact id_map (no
 * worker hop, no month grain, no worker/month dedupe).
 *
 * S2 HOME DECISION (unchanged, still the record of it):
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
 *   contact  = the tagged contact (id_map entity "contact", nid → contact id)
 *   sent = received = the DATE ANCHOR ruled below
 *   data     = { s1Loader, kind: 'enrollment_packet_received', label,
 *                dateSource, dateApproximate: true, s1: { nid, tid } }
 *
 * DATE ANCHOR RULING (2026-08-11): the contact node carries NO
 * packet-received date — the only candidates are the node's `created` and
 * `changed` epochs. RULED: use node `changed`. Rationale: the tag is applied
 * by an EDIT to a contact node that almost always long predates the packet
 * (contacts are created at intake), so `created` is systematically far too
 * early; `changed` is the only timestamp guaranteed to be >= the moment the
 * tag was applied and is the closest available approximation. It is still
 * approximate (later unrelated edits move it), so the comm's `data` marks
 * dateSource: 's1_node_changed' and dateApproximate: true — consumers must
 * not treat the date as an exact packet-received date.
 *
 * DATE FREEZE (Task 293 sync ruling): on re-runs the comm date is FROZEN at
 * its first-load value. Node `changed` moves on EVERY unrelated contact edit
 * (address fix, phone change), so "reconciling" the date would drift it
 * further from the actual packet moment with each S1 edit — the opposite of
 * accuracy. The consumed fingerprint therefore deliberately EXCLUDES the
 * node hash and `changed`; it covers only what reconciliation may change:
 * the resolved S2 contact and the matched tag tid.
 *
 * Sync semantics (Task 293 — RUNBOOK §10): RECONCILING.
 *   - Unchanged mapped rows fast-path skip via the fingerprint.
 *   - Fingerprint mismatch (contact re-resolved — e.g. dedupe rekey):
 *     retarget is SHARED-COMM SAFE. Duplicate tagged nids can share one comm,
 *     so the comm's contactId is updated in place ONLY when the changed nid
 *     is the comm's sole live mapping and the new contact has no packet comm
 *     yet. Otherwise the nid's MAPPING moves — adopting the new contact's
 *     existing comm, else creating one — and the old comm stays with its
 *     remaining nids (an in-place write would silently hijack it while their
 *     fingerprints stay clean and fast-skip forever). A move that would leave
 *     the old comm with zero mappings deletes it BEFORE the mapping moves
 *     (the sweep never sees unmapped comms, so deleting after a successful
 *     move could strand an unreachable orphan): a failed delete rejects the
 *     row (update_failed — gate-visible), keeping the mapping on the intact
 *     old comm with an unadvanced fingerprint, so the next run retries the
 *     whole split via provenance adoption.
 *     data.s1.tid drift updates in place; the date stays frozen either way.
 *   - Deletion sweep: a node whose keep-tag was REMOVED in S1 (or whose node
 *     was deleted) has its mapping removed, and the comm itself is deleted
 *     once NO other live tagged node still references it (duplicate nids
 *     sharing one comm keep it alive until the last reference drops).
 *   - If NO keep-tag term exists in staging (synthetic dev source, or the
 *     vocabulary itself vanished in S1), the sweep is SKIPPED and a blocking
 *     finding `sweep_skipped_no_keep_tag_terms` is emitted — an absent
 *     vocabulary means the source cannot express the tag; mass-deleting
 *     every comm over that would be a rules change, not a reconcile. Dev
 *     full-pipeline runs allow it via --allow-findings.
 *
 * Scope: staged `sirius_contact` rows whose multi-value
 * `field_sirius_contact_tags` tids include the keep-tag term (resolved from
 * s1_staging.terms by normalized name in vocabulary `sirius_contact_tags`).
 * Rows with other tags / no tags are out of scope — NOT rejects, they are
 * ruled stage-only. A keep-tag-named term staged under any OTHER vocabulary
 * hard-fails the run before any write (never guess scope).
 *
 * GRAIN: one S2 comm per tagged contact node. Should duplicate tagged nodes
 * resolve to the SAME S2 contact (possible via contact-dedupe adoption in
 * the contacts loader), the later node adopts the first node's comm — both
 * nids map to it — counted, never duplicated.
 *
 * Idempotent via id_map entity "contact-packet" (nid → comm id); crash
 * repair by provenance: an unmapped row whose contact already has a comm
 * created by this loader (data->>'s1Loader') is re-adopted, never
 * re-created (T16/T19 pattern). Mapped rows whose comm was deleted
 * hard-reject (`mapped_comm_missing`) — repair the map, never remap
 * silently.
 *
 * Prod scale: the sirius_contact bundle is large; the loader streams staged
 * rows via keyset paging (pagedStaged) and every lookup (contact id_map,
 * contacts existence, provenance prefetch, mapped comm prefetch, verify)
 * is a page-bounded batched IN-query.
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
 *     [--dry-run] [--allow-rejects r1,r2] [--allow-findings k1,k2] \
 *     [--force-reconcile] [--migration-mode]
 *
 * Dev note: the synthetic S1 MariaDB predates the tag vocabulary (its
 * sirius_contact_tags tids are all NULL and no tag terms exist), so a dev
 * run is a documented no-op (keepTagTids=0, inScope=0, sweep skipped —
 * allow via --allow-findings sweep_skipped_no_keep_tag_terms). Real
 * coverage lives in scripts/oneoffs (seeded fakes, self-cleaning). Prod
 * expectation: inScope ≈ 14,801.
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
import { ensureIdMap, getMappings, putMapping, remapMapping, advanceFingerprints } from "./lib/idmap";
import { RejectLog, pagedStaged, stagedCountOf, chunk, epochToYmd, throttleStorageOpLogs } from "./lib/loader-utils";
import { makeProgressLogger } from "./lib/progress";
import { createCommStorage } from "../../server/storage/comm";
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

const LOADER = "t29-enrollment-packet-tags";
const BUNDLE = "sirius_contact";
const ID_MAP_ENTITY = "contact-packet";
/** BUMP whenever transform logic changes so unchanged S1 rows reprocess. */
const LOGIC_VERSION = 1;
const KEEP_TAG_NAME = "comms: received enrollment packet"; // normalized (TRIM/LOWER)
const KEEP_TAG_VOCABULARY = "sirius_contact_tags";
const COMM_MEDIUM = "offline";
const COMM_KIND = "enrollment_packet_received";
const COMM_LABEL = "Received Enrollment Packet";
const DATE_SOURCE = "s1_node_changed"; // see DATE ANCHOR RULING above

const DRY_RUN = process.argv.includes("--dry-run");
const MIGRATION_MODE = process.argv.includes("--migration-mode");
const ALLOWED_REJECTS: string[] = (() => {
  const i = process.argv.indexOf("--allow-rejects");
  return i >= 0 ? String(process.argv[i + 1] ?? "").split(",").filter(Boolean) : [];
})();
const FORCE_RECONCILE = parseForceReconcile();
const ALLOWED_FINDINGS = parseAllowedFindings();

function loaderScope<T>(fn: () => Promise<T>): Promise<T> {
  return MIGRATION_MODE
    ? withChargePluginsSuppressed(() => withNotificationsSuppressed(fn))
    : withNotificationsSuppressed(fn);
}

/** All reasons are row-skipping (fatal) — verify/advance skip exactly these. */
const FATAL_REASONS = [
  "contact_unmapped",
  "contact_row_missing",
  "date_missing",
  "bad_date",
  "create_failed",
  "update_failed",
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

async function main() {
  const startedAt = new Date();
  await ensureStagingSchema();
  await ensureIdMap();

  if (MIGRATION_MODE) {
    console.error("MIGRATION MODE: charge-plugin execution is suppressed for all writes in this run.");
  }

  const report: Record<string, unknown> = {};
  const rejects = new RejectLog();
  const summary = emptySummary();
  const findings: SyncFinding[] = [];
  let fastPathSkips = 0;
  const pendingAdvance: Array<{ s1Id: number; fingerprint: string | null }> = [];
  const verifyFailedNids = new Set<number>();

  report.staged = await stagedCountOf(BUNDLE);

  // throttle per-row storage-op logging + heartbeat. done= counts staged
  // rows SCANNED (most are out of scope at prod volume — the scan itself is
  // the long pole); aggregates only.
  throttleStorageOpLogs();
  const progress = makeProgressLogger(LOADER, report.staged as number);
  progress.phase("pre-scan");

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

  /** Node `changed` epoch → frozen comm date (ruled anchor), or the reject
   * reason when it can't be derived. */
  const commDateOf = (changed: number | null): Date | "date_missing" | "bad_date" => {
    if (changed == null) return "date_missing";
    const ymd = epochToYmd(changed);
    if (!ymd) return "bad_date";
    return new Date(`${ymd}T00:00:00.000Z`);
  };
  const createPacketComm = (contactId: string, date: Date, nid: number, tid: number) =>
    loaderScope(() =>
      comms.createComm({
        medium: COMM_MEDIUM,
        contactId,
        status: "logged",
        sent: date,
        received: date,
        data: {
          s1Loader: LOADER,
          kind: COMM_KIND,
          label: COMM_LABEL,
          dateSource: DATE_SOURCE,
          dateApproximate: true,
          s1: { nid, tid },
        },
      }),
    );

  // ---- global counters ------------------------------------------------------
  let pages = 0;
  let inScope = 0;
  let commsCreated = 0;
  let commsUpdated = 0;
  let adoptedByProvenance = 0;
  let duplicateContactNode = 0;
  let sharedCommSplits = 0;
  let emptiedCommsDeleted = 0;
  let verifyFailures = 0;
  const distinctContactIds = new Set<string>();
  const verifySamples: Array<Record<string, unknown>> = [];
  /** Every nid seen carrying the keep-tag THIS run — the sweep source set.
   * Built across the FULL pagination, so nodes deleted in S1 and nodes whose
   * tag was removed both fall out of it. */
  const sourceNids = new Set<number>();
  /** comm ids created in THIS run (all pages) — distinguishes
   * duplicate-node adoption from crash-repair provenance adoption. */
  const createdThisRun = new Set<string>();

  // ---- keyset-paged pipeline: filter → resolve → write → verify per page ----
  for await (const staged of pagedStaged(BUNDLE)) {
    pages++;
    progress.phase(null);
    progress.add(staged.length); // scan progress (in-scope writes are page-bounded)

    // scope filter first — at prod volume most rows carry no keep-tag.
    const scoped = keepTagTids.size === 0
      ? []
      : staged.filter((s) => tidsOf(s.fields, "field_sirius_contact_tags").some((t) => keepTagTids.has(t)));
    if (scoped.length === 0) continue;
    inScope += scoped.length;
    for (const s of scoped) sourceNids.add(s.nid);

    // ---- page-batched lookups ----
    const [contactMap, idMap] = await Promise.all([
      getMappings("contact", scoped.map((s) => s.nid)),
      getMappings(ID_MAP_ENTITY, scoped.map((s) => s.nid)),
    ]);

    // contact row existence for the page's mapped contacts
    const contactExists = new Set<string>();
    const pageContactIds = [...new Set([...contactMap.values()].map((v) => v.s2Id))];
    for (const ids of chunk(pageContactIds, 500)) {
      const res = (await db.execute(sql`
        SELECT id FROM contacts WHERE id IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})
      `)) as unknown as { rows: Array<{ id: string }> };
      for (const r of res.rows) contactExists.add(r.id);
    }

    // mapped comm prefetch (idempotent re-runs; broken maps hard-reject;
    // reconcile reads contact_id + data for the drift-update path)
    const mappedCommIds = [...new Set([...idMap.values()].map((v) => v.s2Id))];
    const commById = new Map<string, { contactId: string | null; data: Record<string, unknown> }>();
    for (const ids of chunk(mappedCommIds, 500)) {
      const res = (await db.execute(sql`
        SELECT id, contact_id, data FROM comm WHERE id IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})
      `)) as unknown as { rows: Array<{ id: string; contact_id: string | null; data: Record<string, unknown> | null }> };
      for (const r of res.rows) commById.set(r.id, { contactId: r.contact_id, data: r.data ?? {} });
    }

    // Live reference map for this page's mapped comms: ALL non-stub nids
    // (from ANY page) mapping to each comm. Retarget safety depends on it —
    // duplicate tagged nids legitimately share one comm, and only a sole
    // reference may be retargeted in place. Maintained live within the page
    // as mappings move.
    const refsByComm = new Map<string, Set<number>>();
    for (const ids of chunk(mappedCommIds, 500)) {
      const res = (await db.execute(sql`
        SELECT s1_id, s2_id FROM s1_staging.id_map
         WHERE entity = ${ID_MAP_ENTITY} AND NOT stub
           AND s2_id IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})
      `)) as unknown as { rows: Array<{ s1_id: string | number; s2_id: string }> };
      for (const r of res.rows) {
        const set = refsByComm.get(r.s2_id) ?? new Set<number>();
        set.add(Number(r.s1_id));
        refsByComm.set(r.s2_id, set);
      }
    }

    // provenance prefetch: this loader's comms for the page's contacts,
    // keyed by contact id — crash repair AND duplicate-node adoption.
    const provenanceByContact = new Map<string, string>(); // contactId → comm id
    for (const ids of chunk(pageContactIds, 200)) {
      const res = (await db.execute(sql`
        SELECT id, contact_id FROM comm
         WHERE medium = ${COMM_MEDIUM} AND data->>'s1Loader' = ${LOADER}
           AND contact_id IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})
      `)) as unknown as { rows: Array<{ id: string; contact_id: string }> };
      for (const r of res.rows) provenanceByContact.set(r.contact_id, r.id);
    }

    // ---- resolve + write pass ----
    /** nid → expected comm id (verify pass, this page). */
    const expected = new Map<number, string>();

    for (const s of scoped) {
      const nid = s.nid;

      const contactId = contactMap.get(nid)?.s2Id;
      const matchedTid = tidsOf(s.fields, "field_sirius_contact_tags").find((t) => keepTagTids.has(t))!;
      // Consumed fingerprint: resolution outcome only — the comm date is
      // FROZEN by ruling (see DATE FREEZE above), so `changed` is excluded.
      const fp = contentHashOf({ contact: contactId ?? "unresolved", tid: matchedTid });

      const mapped = idMap.get(nid);
      if (mapped) {
        const cur = commById.get(mapped.s2Id);
        if (!cur) {
          rejects.add("mapped_comm_missing", { nid }, nid);
          continue;
        }
        if (classifyRow(mapped, fp, LOGIC_VERSION, FORCE_RECONCILE) === "unchanged") {
          summary.unchanged++;
          fastPathSkips++;
          continue;
        }
        // Drift update: retarget contact / refresh tag tid; date frozen.
        if (!contactId) {
          rejects.add("contact_unmapped", { nid }, nid);
          continue;
        }
        if (!contactExists.has(contactId)) {
          rejects.add("contact_row_missing", { nid }, nid);
          continue;
        }
        const curS1 = (cur.data as any)?.s1 ?? {};
        const retarget = cur.contactId !== contactId;
        if (retarget) {
          // SHARED-COMM-SAFE retarget (see docstring): in place only when
          // this nid is the comm's sole live mapping AND the new contact has
          // no packet comm yet; otherwise MOVE this nid's mapping and leave
          // the comm to its remaining refs. Refs that are dead in S1 are the
          // sweep's job — it deletes the old comm once no live tagged node
          // references it.
          const refs = refsByComm.get(mapped.s2Id) ?? new Set<number>();
          const soleRef = [...refs].every((n) => n === nid);
          const provTarget = provenanceByContact.get(contactId);
          const adoptTarget =
            provTarget && provTarget !== mapped.s2Id && !provTarget.startsWith("dry:") ? provTarget : null;
          if (adoptTarget || !soleRef) {
            let targetCommId = adoptTarget;
            if (!targetCommId) {
              const date = commDateOf(s.changed);
              if (typeof date === "string") {
                rejects.add(date, { nid }, nid);
                continue;
              }
              if (DRY_RUN) {
                targetCommId = `dry:${nid}`;
              } else {
                try {
                  const row = await createPacketComm(contactId, date, nid, matchedTid);
                  targetCommId = row.id;
                  createdThisRun.add(row.id);
                } catch {
                  // SANITIZED: never log raw error text (HIPAA).
                  rejects.add("create_failed", { nid }, nid);
                  continue;
                }
              }
              commsCreated++;
              provenanceByContact.set(contactId, targetCommId);
              distinctContactIds.add(contactId);
            }
            if (soleRef) {
              // The move will leave the old comm with ZERO mappings, and the
              // sweep never sees unmapped comms — so delete it BEFORE moving
              // the mapping. On failure the row rejects (gate-visible), its
              // mapping stays on the intact old comm and the fingerprint
              // does not advance, so the NEXT run retries the whole split
              // (the target comm is re-found via provenance). Deleting after
              // a successful move would strand an undeletable orphan. (A
              // crash between this delete and the remap below surfaces as a
              // mapped_comm_missing hard reject — loud, per contract.)
              if (!DRY_RUN) {
                try {
                  await loaderScope(() => comms.deleteComm(mapped.s2Id));
                } catch {
                  // SANITIZED: never log raw error text (HIPAA).
                  rejects.add("update_failed", { nid }, nid);
                  continue;
                }
              }
              emptiedCommsDeleted++;
              commById.delete(mapped.s2Id);
              if (cur.contactId && provenanceByContact.get(cur.contactId) === mapped.s2Id) {
                provenanceByContact.delete(cur.contactId);
              }
            }
            if (!DRY_RUN) await remapMapping(ID_MAP_ENTITY, nid, targetCommId, LOADER);
            refs.delete(nid);
            if (!targetCommId.startsWith("dry:")) {
              const tset = refsByComm.get(targetCommId) ?? new Set<number>();
              tset.add(nid);
              refsByComm.set(targetCommId, tset);
            }
            sharedCommSplits++;
            summary.updated++;
            pendingAdvance.push({ s1Id: nid, fingerprint: fp });
            if (!targetCommId.startsWith("dry:")) expected.set(nid, targetCommId);
            continue;
          }
          // sole ref, no competing comm → the comm follows its only source
          // node: in-place retarget below.
        }
        const needsWrite = retarget || curS1.tid !== matchedTid;
        if (needsWrite && !DRY_RUN) {
          try {
            await loaderScope(() =>
              comms.updateComm(mapped.s2Id, {
                contactId,
                data: { ...cur.data, s1: { ...curS1, nid, tid: matchedTid } },
              }),
            );
          } catch {
            // SANITIZED: never log raw error text (HIPAA).
            rejects.add("update_failed", { nid }, nid);
            continue;
          }
        }
        if (needsWrite) {
          commsUpdated++;
          summary.updated++;
          if (retarget) {
            // keep the within-page provenance index consistent with the move
            provenanceByContact.set(contactId, mapped.s2Id);
            if (cur.contactId && provenanceByContact.get(cur.contactId) === mapped.s2Id) {
              provenanceByContact.delete(cur.contactId);
            }
            distinctContactIds.add(contactId);
          }
        } else {
          summary.unchanged++; // fp stamp missing/stale only (first converted run)
        }
        pendingAdvance.push({ s1Id: nid, fingerprint: fp });
        expected.set(nid, mapped.s2Id);
        continue;
      }

      if (!contactId) {
        rejects.add("contact_unmapped", { nid }, nid);
        continue;
      }
      if (!contactExists.has(contactId)) {
        rejects.add("contact_row_missing", { nid }, nid);
        continue;
      }

      // DATE ANCHOR (ruled above): node `changed` epoch, marked approximate.
      const commDate = commDateOf(s.changed);
      if (typeof commDate === "string") {
        rejects.add(commDate, { nid }, nid);
        continue;
      }

      distinctContactIds.add(contactId);

      // one comm per contact: adopt an existing comm for the same contact —
      // either crash repair or a duplicate tagged node mapping to the same
      // S2 contact.
      const existing = provenanceByContact.get(contactId);
      if (existing) {
        // rows created earlier THIS run = duplicate node sharing the comm;
        // provenance rows preexisting the run = crash repair.
        const isDuplicateNode = createdThisRun.has(existing) || existing.startsWith("dry:");
        if (isDuplicateNode) duplicateContactNode++;
        else adoptedByProvenance++;
        summary.created++; // mapping-grain: a new nid→comm mapping either way
        if (!DRY_RUN) {
          await putMapping(ID_MAP_ENTITY, nid, existing, {
            stub: false,
            loader: LOADER,
            fingerprint: fp,
            logicVersion: LOGIC_VERSION,
          });
          expected.set(nid, existing);
        }
        continue;
      }

      if (DRY_RUN) {
        commsCreated++;
        summary.created++;
        provenanceByContact.set(contactId, `dry:${nid}`);
        continue;
      }

      try {
        const row = await createPacketComm(contactId, commDate, nid, matchedTid);
        await putMapping(ID_MAP_ENTITY, nid, row.id, {
          stub: false,
          loader: LOADER,
          fingerprint: fp,
          logicVersion: LOGIC_VERSION,
        });
        provenanceByContact.set(contactId, row.id);
        createdThisRun.add(row.id);
        expected.set(nid, row.id);
        commsCreated++;
        summary.created++;
      } catch {
        // SANITIZED: never log raw error text — driver messages can embed
        // row values (HIPAA).
        rejects.add("create_failed", { nid }, nid);
      }
    }

    // ---- verify pass (page-scoped, batched) ----
    progress.phase("verify");
    if (!DRY_RUN && expected.size > 0) {
      const vMap = await getMappings(ID_MAP_ENTITY, [...expected.keys()]);
      const vIds = [...new Set([...vMap.values()].map((v) => v.s2Id))];
      progress.phase("verify", vIds.length);
      const vExists = new Set<string>();
      for (const ids of chunk(vIds, 500)) {
        progress.add(ids.length);
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
          verifyFailedNids.add(nid);
          if (verifySamples.length < 25) verifySamples.push({ nid });
        }
      }
    }
  }

  // ---- advance consumed fingerprints (pre-existing mappings) — post-verify ----
  if (!DRY_RUN) {
    await advanceFingerprints(
      ID_MAP_ENTITY,
      pendingAdvance.filter((p) => !verifyFailedNids.has(p.s1Id) && !rejects.hasAnyIn(p.s1Id, FATAL_REASONS)),
      LOGIC_VERSION,
    );
  }

  // ---- deletion sweep: keep-tag removed in S1, or node deleted -------------
  // The comm is a SAFE CHILD ROW, but duplicate nids can share one comm —
  // delete the comm only when NO live tagged nid still references it; the
  // vanished nid's mapping is removed either way.
  let sweepCommsDeleted = 0;
  let sweepMappingsOnly = 0;
  if (keepTagTids.size === 0) {
    // No staged tag terms: the source cannot express the tag — sweeping now
    // would delete EVERY packet comm. Skip loudly (blocking finding).
    findings.push({
      kind: "sweep_skipped_no_keep_tag_terms",
      entity: ID_MAP_ENTITY,
      s1Id: 0, // run-level finding, not tied to one node
      detail: { reason: "no staged keep-tag term in " + KEEP_TAG_VOCABULARY },
    });
    report.sweep = { skipped: true, reason: "no_keep_tag_terms" };
  } else {
    // Full mapping graph for shared-comm detection (comm id → referencing nids).
    const allMapRes = (await db.execute(sql`
      SELECT s1_id, s2_id FROM s1_staging.id_map WHERE entity = ${ID_MAP_ENTITY} AND NOT stub
    `)) as unknown as { rows: Array<{ s1_id: string | number; s2_id: string }> };
    const nidsByComm = new Map<string, number[]>();
    for (const r of allMapRes.rows) {
      const arr = nidsByComm.get(r.s2_id) ?? [];
      arr.push(Number(r.s1_id));
      nidsByComm.set(r.s2_id, arr);
    }
    const deletedComms = new Set<string>();
    const sweep = await sweepDeletions({
      entity: ID_MAP_ENTITY,
      loaders: [LOADER],
      sourceIds: sourceNids,
      dryRun: DRY_RUN,
      policy: async (c) => ({
        action: "delete",
        apply: async () => {
          const refs = nidsByComm.get(c.s2Id) ?? [];
          const stillLive = refs.some((nid) => nid !== c.s1Id && sourceNids.has(nid));
          if (stillLive) {
            sweepMappingsOnly++;
            return;
          }
          if (deletedComms.has(c.s2Id)) {
            sweepMappingsOnly++; // comm already deleted for an earlier candidate
            return;
          }
          await loaderScope(() => comms.deleteComm(c.s2Id));
          deletedComms.add(c.s2Id);
          sweepCommsDeleted++;
        },
      }),
    });
    summary.deleted += sweep.deleted;
    findings.push(...sweep.findings);
    report.sweep = {
      candidates: sweep.candidates,
      deleted: sweep.deleted,
      commsDeleted: sweepCommsDeleted,
      mappingsOnlyDeleted: sweepMappingsOnly,
      alreadyHandled: sweep.alreadyHandled,
    };
  }

  progress.stop();

  report.pages = pages;
  report.inScope = inScope;
  report.distinctContacts = distinctContactIds.size;
  report.commsCreated = commsCreated;
  report.commsUpdated = commsUpdated;
  report.adoptedByProvenance = adoptedByProvenance;
  report.duplicateContactNode = duplicateContactNode;
  report.sharedCommSplits = sharedCommSplits;
  report.emptiedCommsDeleted = emptiedCommsDeleted;
  report.fastPathSkips = fastPathSkips;
  report.rejectSamples = rejects.samples;
  if (verifySamples.length > 0) report.verifyFailureSamples = verifySamples;

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
  if (!DRY_RUN) await recordRun(startedAt, { loader: LOADER, forceReconcile: FORCE_RECONCILE }, result as unknown as Record<string, unknown>);

  if (result.rejectGate.status === "fail") {
    console.error(
      `FAIL: reject reason(s) not allowed for this run: ${result.rejectGate.disallowed.map((d) => `${d.reason}=${d.count}`).join(", ")}. ` +
        `Every expected reject class must be explicitly allowed via --allow-rejects.`,
    );
  }
  if (result.blockingFindings.length > 0) {
    console.error(`FAIL: ${result.blockingFindings.length} blocking sync finding(s) — resolve or acknowledge via --allow-findings.`);
  }
  process.exit(loaderExitCode(result));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
