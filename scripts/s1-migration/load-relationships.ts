/**
 * T15 loader — sirius_contact_relationship → worker_relations. Milestone 3.
 *
 * Resolution (03-transformations T15, 02-mapping §4):
 *   - worker_1 = OWNING worker: `field_sirius_contact` (contact nid) →
 *     the worker node referencing that contact → worker id_map.
 *     Q13 closed: production has the owning field on ALL 35,774 nodes. The
 *     synthetic DB stages it on NONE (field gap), so dev runs need
 *     `--allow-rejects owner_missing`.
 *   - worker_2 = `field_sirius_contact_alt` contact → its worker if one
 *     exists, else CREATE A SHELL WORKER for that contact (S2 relations join
 *     workers, not contacts — same approach S2's DP/COBRA flows use).
 *     Shells: no S1 worker nid → serial sirius_id (post-setval, above the
 *     migrated field_sirius_id / assigned range — T1 ruling 2026-08-06),
 *     data.migrationShell=true, id_map entity "shell-worker" keyed by
 *     the CONTACT nid (idempotency). Shells are created ONLY after every
 *     other resolution/validation for the row has passed, so a reject can't
 *     leave an orphan shell behind.
 *   - relation_type: reltype tid → term id_map (T4) → fallback
 *     options_worker_relation_type.sirius_id.
 *   - start/end: field_sirius_date_start/_date_end date-cast. The S2 relations
 *     storage REQUIRES a start date, forbids future start dates, and requires
 *     end >= start. N26 ruling (2026-08-05): rows with NO start date load
 *     with defaults (start 2000-01-01; end keeps a real S1 end, else
 *     2000-01-02; data.datesDefaulted=true) — prod measured 115 such rows.
 *     The 2 future-start rows were fixed in S1 by the fund; future_start_date
 *     stays a fatal tripwire (expect 0 in prod), as do bad_start_date
 *     (present but unparseable), bad_end_date, and end_before_start.
 *     Active=No with no end date end-dates from node.changed (documented
 *     convention; defaulted rows always carry an end already).
 *   - field_sirius_count → data.sequence (ordering, not a quantity — Q14).
 *
 * REJECT POLICY (fail loud): every reject reason present in the run must be
 * explicitly allowed via `--allow-rejects r1,r2,...` or the run exits 1
 * (after the full report, so the operator sees complete counts). Dev:
 * `--allow-rejects owner_missing`. Production: run with NO allowances first;
 * every allowance must be a conscious ruling.
 *
 * Writes go through workerRelations storage under notification suppression.
 * Idempotent via id_map entity "relation"; matched rows drift-reconcile
 * dates/type/sequence. Create/update failures are reported as SANITIZED codes
 * (validation_<field> / storage_error) — never raw error text (HIPAA).
 *
 * Usage:
 *   npx tsx scripts/s1-migration/load-relationships.ts [--dry-run] [--allow-rejects r1,r2]
 *
 * Output is AGGREGATES ONLY (plus S1 nids / opaque ids) — safe inside the
 * HIPAA boundary.
 */
import { db } from "../../server/storage/db";
import { sql } from "drizzle-orm";
import { storage } from "../../server/storage/database";
import { WorkerRelationValidationError } from "../../server/storage/workers/relations";
import { withNotificationsSuppressed } from "../../server/middleware/request-context";
import { ensureStagingSchema, recordRun } from "./lib/staging";
import { ensureIdMap, getMappings, putMapping } from "./lib/idmap";
import { RejectLog, loadStaged, strOf, tidOf, targetNidOf, toYmd, epochToYmd, yesNo, scalarOf, defaultRelationshipDates, throttleStorageOpLogs } from "./lib/loader-utils";
import { makeProgressLogger } from "./lib/progress";

const DRY_RUN = process.argv.includes("--dry-run");
const ALLOWED_REJECTS: string[] = (() => {
  const i = process.argv.indexOf("--allow-rejects");
  return i >= 0 ? String(process.argv[i + 1] ?? "").split(",").filter(Boolean) : [];
})();
const LOADER = "t15-relationships";

/** All relationship reject reasons are row-skipping (fatal) — the verify pass
 * skips exactly these. Kept explicit so a future annotation-style reason
 * can't silently widen the verify allowlist. */
const FATAL_REASONS = [
  "owner_missing",
  "alt_missing",
  "owner_equals_alt",
  "owner_has_no_worker",
  "owner_worker_unmapped",
  "alt_worker_unmapped",
  "alt_contact_unmapped",
  "reltype_unresolved",
  "bad_start_date",
  "future_start_date",
  "bad_end_date",
  "end_before_start",
  "bad_changed_epoch",
  "relation_create_failed",
  "relation_update_failed",
] as const;

/** Storage errors → sanitized report codes. NEVER store raw error text —
 * database diagnostics can embed row values (HIPAA). */
function sanitizeStorageError(err: unknown): string {
  if (err instanceof WorkerRelationValidationError) return `validation_${err.field}`;
  return "storage_error";
}

async function main() {
  const startedAt = new Date();
  await ensureStagingSchema();
  await ensureIdMap();

  const report: Record<string, unknown> = { loader: LOADER, dryRun: DRY_RUN, allowedRejects: ALLOWED_REJECTS };
  const rejects = new RejectLog();
  const todayYmd = new Date().toISOString().slice(0, 10);

  // throttle per-row storage-op logging + heartbeat (aggregates only) — from
  // process start: the staged loads below (incl. ~250k workers) are minutes
  // on the real target and must emit liveness, not silence.
  throttleStorageOpLogs();
  const progress = makeProgressLogger(LOADER, 0);
  progress.phase("pre-scan");

  const rels = await loadStaged("sirius_contact_relationship");
  const stagedWorkers = await loadStaged("sirius_worker");
  report.stagedRelationships = rels.length;
  progress.setTotal(rels.length);

  // contact nid → worker nid (owning-side + alt-side resolution)
  const workerNidByContactNid = new Map<number, number>();
  for (const w of stagedWorkers) {
    const cnid = targetNidOf(w.fields, "field_sirius_contact");
    if (cnid != null && !workerNidByContactNid.has(cnid)) workerNidByContactNid.set(cnid, w.nid);
  }

  // bulk id_map lookups
  const relMap = await getMappings("relation", rels.map((r) => r.nid));
  const contactNids = new Set<number>();
  const reltypeTids = new Set<number>();
  for (const r of rels) {
    const o = targetNidOf(r.fields, "field_sirius_contact");
    const a = targetNidOf(r.fields, "field_sirius_contact_alt");
    if (o != null) contactNids.add(o);
    if (a != null) contactNids.add(a);
    const t = tidOf(r.fields, "field_sirius_contact_reltype");
    if (t != null) reltypeTids.add(t);
  }
  const contactMap = await getMappings("contact", [...contactNids]);
  const workerNids = [...contactNids].map((c) => workerNidByContactNid.get(c)).filter((n): n is number => n != null);
  const workerMap = await getMappings("worker", workerNids);
  const shellMap = await getMappings("shell-worker", [...contactNids]);
  const termMap = await getMappings("term", [...reltypeTids]);

  // fallback: options_worker_relation_type.sirius_id (T4 adoption column)
  const rtRes = await db.execute(sql`SELECT id, sirius_id FROM options_worker_relation_type WHERE sirius_id IS NOT NULL`);
  const reltypeBySiriusId = new Map(
    (rtRes as unknown as { rows: Array<{ id: string; sirius_id: string }> }).rows.map((r) => [r.sirius_id, r.id]),
  );
  const resolveReltype = (tid: number | null): string | null => {
    if (tid == null) return null;
    return termMap.get(tid)?.s2Id ?? reltypeBySiriusId.get(String(tid)) ?? null;
  };

  const stats = { matched: 0, created: 0, updated: 0, shellWorkersCreated: 0, shellWorkersReused: 0, endDatedFromChanged: 0, datesDefaulted: 0, datesDefaultedActiveYes: 0 };
  /** nid → expected row shape (for the verify pass). */
  const expected = new Map<number, { worker1: string; worker2: string; relationType: string }>();

  progress.phase(null); // row loop
  for (const r of rels) {
    progress.add(1);
    // ---- resolve + validate EVERYTHING before any write for this row ----

    // owning side (worker_1)
    const ownerNid = targetNidOf(r.fields, "field_sirius_contact");
    if (ownerNid == null) {
      rejects.add("owner_missing", { nid: r.nid }, r.nid);
      continue;
    }
    const altNid = targetNidOf(r.fields, "field_sirius_contact_alt");
    if (altNid == null) {
      rejects.add("alt_missing", { nid: r.nid }, r.nid);
      continue;
    }
    if (ownerNid === altNid) {
      rejects.add("owner_equals_alt", { nid: r.nid }, r.nid);
      continue;
    }
    const ownerWorkerNid = workerNidByContactNid.get(ownerNid);
    if (ownerWorkerNid == null) {
      rejects.add("owner_has_no_worker", { nid: r.nid, ownerContactNid: ownerNid }, r.nid);
      continue;
    }
    const w1 = workerMap.get(ownerWorkerNid);
    if (!w1) {
      rejects.add("owner_worker_unmapped", { nid: r.nid, workerNid: ownerWorkerNid }, r.nid);
      continue;
    }

    // alt side (worker_2): existing worker, existing shell, or shell-to-create
    let w2Id: string | null = null;
    let needShellForContactId: string | null = null;
    const altWorkerNid = workerNidByContactNid.get(altNid);
    if (altWorkerNid != null) {
      const w2 = workerMap.get(altWorkerNid);
      if (!w2) {
        rejects.add("alt_worker_unmapped", { nid: r.nid, workerNid: altWorkerNid }, r.nid);
        continue;
      }
      w2Id = w2.s2Id;
    } else {
      const shell = shellMap.get(altNid);
      if (shell) {
        w2Id = shell.s2Id;
        stats.shellWorkersReused++;
      } else {
        const altContact = contactMap.get(altNid);
        if (!altContact) {
          rejects.add("alt_contact_unmapped", { nid: r.nid, altContactNid: altNid }, r.nid);
          continue;
        }
        needShellForContactId = altContact.s2Id;
      }
    }

    // relation type
    const tid = tidOf(r.fields, "field_sirius_contact_reltype");
    const relationType = resolveReltype(tid);
    if (!relationType) {
      rejects.add("reltype_unresolved", { nid: r.nid, tid }, r.nid);
      continue;
    }

    // dates — pre-validate against the storage contract (start required,
    // no future start, end >= start) so failures are dedicated rejects.
    // N26 ruling (2026-08-05): rows with NO start value load with default
    // dates instead of rejecting; a present-but-unparseable start stays
    // fatal (bad_start_date — expect 0).
    const startRaw = strOf(r.fields, "field_sirius_date_start");
    const endRaw = strOf(r.fields, "field_sirius_date_end");
    const parsedStart = startRaw ? toYmd(startRaw) : null;
    if (startRaw && !parsedStart) {
      rejects.add("bad_start_date", { nid: r.nid }, r.nid);
      continue;
    }
    let endYmd = endRaw ? toYmd(endRaw) : null;
    if (endRaw && !endYmd) {
      rejects.add("bad_end_date", { nid: r.nid }, r.nid);
      continue;
    }
    const active = yesNo(strOf(r.fields, "field_sirius_active"));
    const dated = defaultRelationshipDates(parsedStart, endYmd);
    const startYmd = dated.startYmd;
    endYmd = dated.endYmd;
    if (startYmd > todayYmd) {
      rejects.add("future_start_date", { nid: r.nid, startYmd }, r.nid);
      continue;
    }
    let endDatedFromChanged = false;
    if (active === false && !endYmd && r.changed != null) {
      // end-dating convention (§4 active flag); defaulted rows never reach
      // this branch — they always carry an end date already
      const changedYmd = epochToYmd(r.changed);
      if (!changedYmd) {
        rejects.add("bad_changed_epoch", { nid: r.nid, changed: r.changed }, r.nid);
        continue;
      }
      endYmd = changedYmd;
      endDatedFromChanged = true;
    }
    if (endYmd && endYmd < startYmd) {
      rejects.add("end_before_start", { nid: r.nid, fromChanged: endDatedFromChanged, datesDefaulted: dated.defaulted }, r.nid);
      continue;
    }
    if (dated.defaulted) {
      stats.datesDefaulted++;
      if (active === true) stats.datesDefaultedActiveYes++;
    }
    const seqRaw = scalarOf(r.fields["field_sirius_count"]);
    const sequence =
      typeof seqRaw === "number" ? seqRaw : typeof seqRaw === "string" && /^\d+$/.test(seqRaw) ? Number(seqRaw) : null;
    const dataPayload: Record<string, unknown> = {};
    if (sequence != null) dataPayload.sequence = sequence;
    if (dated.defaulted) dataPayload.datesDefaulted = true;

    // ---- matched: drift-reconcile; new: shell (if needed) + create ----

    const mapped = relMap.get(r.nid);
    if (mapped) {
      stats.matched++;
      if (w2Id) expected.set(r.nid, { worker1: w1.s2Id, worker2: w2Id, relationType });
      if (!DRY_RUN) {
        const row = await storage.workerRelations.get(mapped.s2Id);
        if (row) {
          const rowData = row.data as Record<string, unknown> | null;
          const rowSeq = rowData?.sequence ?? null;
          const rowDefaulted = rowData?.datesDefaulted === true;
          const drift =
            (row.startYmd ?? null) !== startYmd ||
            (row.endYmd ?? null) !== (endYmd ?? null) ||
            row.relationType !== relationType ||
            (sequence != null && rowSeq !== sequence) ||
            (dated.defaulted && !rowDefaulted);
          if (drift) {
            try {
              await withNotificationsSuppressed(() =>
                storage.workerRelations.update(mapped.s2Id, {
                  startYmd,
                  endYmd,
                  relationType,
                  ...(Object.keys(dataPayload).length > 0 ? { data: dataPayload } : {}),
                }),
              );
              if (endDatedFromChanged) stats.endDatedFromChanged++;
              stats.updated++;
            } catch (err) {
              rejects.add("relation_update_failed", { nid: r.nid, code: sanitizeStorageError(err) }, r.nid);
            }
          }
        }
        // structural drift (worker1/worker2) is NOT auto-fixed — verify flags it
      }
      continue;
    }

    if (DRY_RUN) {
      if (needShellForContactId) stats.shellWorkersCreated++;
      if (endDatedFromChanged) stats.endDatedFromChanged++;
      stats.created++;
      continue;
    }

    // all validation passed — safe to create the shell now
    if (needShellForContactId) {
      const created = await withNotificationsSuppressed(() =>
        storage.workers.createWorkerForMigration({
          contactId: needShellForContactId!,
          ssn: null,
          data: { migrationShell: true, s1ContactNid: altNid },
        }),
      );
      const winner = await putMapping("shell-worker", altNid, created.id, { stub: false, loader: LOADER });
      if (winner !== created.id) {
        console.error(`RACE: shell worker for contact nid ${altNid} already mapped to ${winner}; row ${created.id} may be an orphan`);
      }
      w2Id = winner;
      shellMap.set(altNid, { s2Id: winner, stub: false });
      stats.shellWorkersCreated++;
    }
    if (!w2Id) {
      // unreachable by construction (worker, shell reuse, or shell create above)
      rejects.add("alt_worker_unmapped", { nid: r.nid }, r.nid);
      continue;
    }

    try {
      const created = await withNotificationsSuppressed(() =>
        storage.workerRelations.create({
          worker1: w1.s2Id,
          worker2: w2Id!,
          relationType,
          startYmd,
          endYmd,
          data: Object.keys(dataPayload).length > 0 ? dataPayload : null,
        }),
      );
      const winner = await putMapping("relation", r.nid, created.id, { stub: false, loader: LOADER });
      if (winner !== created.id) {
        console.error(`RACE: relation nid ${r.nid} already mapped to ${winner}; row ${created.id} may be an orphan`);
      }
      if (endDatedFromChanged) stats.endDatedFromChanged++;
      stats.created++;
      expected.set(r.nid, { worker1: w1.s2Id, worker2: w2Id, relationType });
    } catch (err) {
      // storage validation — sanitized code only, never raw error text
      rejects.add("relation_create_failed", { nid: r.nid, code: sanitizeStorageError(err) }, r.nid);
    }
  }
  report.relations = stats;

  // ---------------- verify pass ----------------
  progress.phase("verify", rels.length);
  let verifyFailures = 0;
  if (!DRY_RUN) {
    const vMap = await getMappings("relation", rels.map((r) => r.nid));
    for (const r of rels) {
      progress.add(1);
      if (rejects.hasAnyIn(r.nid, FATAL_REASONS)) continue;
      const m = vMap.get(r.nid);
      if (!m) {
        console.error(`VERIFY: relation nid ${r.nid} has no id_map entry`);
        verifyFailures++;
        continue;
      }
      const row = await storage.workerRelations.get(m.s2Id);
      if (!row) {
        console.error(`VERIFY: relation nid ${r.nid} maps to missing row ${m.s2Id}`);
        verifyFailures++;
        continue;
      }
      const exp = expected.get(r.nid);
      if (exp && (row.worker1 !== exp.worker1 || row.worker2 !== exp.worker2 || row.relationType !== exp.relationType)) {
        console.error(`VERIFY: relation nid ${r.nid} row does not match expected resolution`);
        verifyFailures++;
      }
    }
  }

  progress.stop();

  report.rejects = rejects.counts;
  report.rejectSamples = rejects.samples;
  report.verifyFailures = verifyFailures;

  const disallowed = rejects.disallowedReasons(ALLOWED_REJECTS);
  console.log(JSON.stringify(report, null, 2));
  if (!DRY_RUN) await recordRun(startedAt, { loader: LOADER, allowedRejects: ALLOWED_REJECTS }, report);

  if (verifyFailures > 0) process.exit(1);
  if (disallowed.length > 0) {
    console.error(
      `FAIL: reject reason(s) not allowed for this run: ${disallowed.map((d) => `${d.reason}=${d.count}`).join(", ")}. ` +
        `Every expected reject class must be explicitly allowed via --allow-rejects (dev synthetic gap: owner_missing).`,
    );
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
