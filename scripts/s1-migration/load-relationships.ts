/**
 * T15 loader — sirius_contact_relationship → worker_relations. Milestone 3.
 *
 * Resolution (03-transformations T15, 02-mapping §4):
 *   - worker_1 = OWNING worker: `field_sirius_contact` (contact nid) →
 *     the worker node referencing that contact → worker id_map.
 *     Q13 closed: production has the owning field on ALL 35,774 nodes. The
 *     synthetic DB stages it on NONE (term/field gap), so missing owners are
 *     counted rejects that HARD-FAIL unless `--allow-missing-owner` (dev-only;
 *     prod run must see 0).
 *   - worker_2 = `field_sirius_contact_alt` contact → its worker if one
 *     exists, else CREATE A SHELL WORKER for that contact (S2 relations join
 *     workers, not contacts — same approach S2's DP/COBRA flows use).
 *     Shells: no S1 worker nid → serial sirius_id (post-setval, above the nid
 *     range), data.migrationShell=true, id_map entity "shell-worker" keyed by
 *     the CONTACT nid (idempotency).
 *   - relation_type: reltype tid → term id_map (T4) → fallback
 *     options_worker_relation_type.sirius_id.
 *   - start/end: field_sirius_date_start/_date_end date-cast. Active=No with
 *     no end date end-dates from node.changed (documented convention).
 *   - field_sirius_count → data.sequence (ordering, not a quantity — Q14).
 *
 * Writes go through workerRelations storage under notification suppression;
 * its own validation (duplicate/self-relation checks) turns per-row failures
 * into counted rejects, not silent skips. Idempotent via id_map entity
 * "relation".
 *
 * Usage:
 *   npx tsx scripts/s1-migration/load-relationships.ts [--dry-run] [--allow-missing-owner]
 *
 * Output is AGGREGATES ONLY (plus S1 nids / opaque ids) — safe inside the
 * HIPAA boundary.
 */
import { db } from "../../server/storage/db";
import { sql } from "drizzle-orm";
import { storage } from "../../server/storage/database";
import { withNotificationsSuppressed } from "../../server/middleware/request-context";
import { ensureStagingSchema, recordRun } from "./lib/staging";
import { ensureIdMap, getMappings, putMapping } from "./lib/idmap";
import { RejectLog, loadStaged, strOf, tidOf, targetNidOf, toYmd, epochToYmd, yesNo, scalarOf } from "./lib/loader-utils";

const DRY_RUN = process.argv.includes("--dry-run");
const ALLOW_MISSING_OWNER = process.argv.includes("--allow-missing-owner");
const LOADER = "t15-relationships";

/** Reject reasons that mean "the owning side could not be resolved" — these
 * hard-fail without --allow-missing-owner (Q13: prod has owners on ALL rows). */
const OWNER_REJECTS = ["owner_missing", "owner_has_no_worker", "owner_worker_unmapped"] as const;

async function main() {
  const startedAt = new Date();
  await ensureStagingSchema();
  await ensureIdMap();

  const report: Record<string, unknown> = { loader: LOADER, dryRun: DRY_RUN, allowMissingOwner: ALLOW_MISSING_OWNER };
  const rejects = new RejectLog();

  const rels = await loadStaged("sirius_contact_relationship");
  const stagedWorkers = await loadStaged("sirius_worker");
  report.stagedRelationships = rels.length;

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

  const stats = { matched: 0, created: 0, shellWorkersCreated: 0, shellWorkersReused: 0, endDatedFromChanged: 0 };
  /** nid → expected row shape (for the verify pass). */
  const expected = new Map<number, { worker1: string; worker2: string; relationType: string }>();

  for (const r of rels) {
    // ---- owning side (worker_1)
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

    // ---- alt side (worker_2): worker if it exists, else shell worker
    let w2Id: string | null = null;
    const altWorkerNid = workerNidByContactNid.get(altNid);
    if (altWorkerNid != null) {
      const w2 = workerMap.get(altWorkerNid);
      if (!w2) {
        rejects.add("alt_worker_unmapped", { nid: r.nid, workerNid: altWorkerNid }, r.nid);
        continue;
      }
      w2Id = w2.s2Id;
    } else {
      const altContact = contactMap.get(altNid);
      if (!altContact) {
        rejects.add("alt_contact_unmapped", { nid: r.nid, altContactNid: altNid }, r.nid);
        continue;
      }
      const shell = shellMap.get(altNid);
      if (shell) {
        w2Id = shell.s2Id;
        stats.shellWorkersReused++;
      } else if (!DRY_RUN) {
        const created = await withNotificationsSuppressed(() =>
          storage.workers.createWorkerForMigration({
            contactId: altContact.s2Id,
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
    }

    // ---- relation type
    const tid = tidOf(r.fields, "field_sirius_contact_reltype");
    const relationType = resolveReltype(tid);
    if (!relationType) {
      rejects.add("reltype_unresolved", { nid: r.nid, tid }, r.nid);
      continue;
    }

    // ---- dates + sequence
    const startRaw = strOf(r.fields, "field_sirius_date_start");
    const endRaw = strOf(r.fields, "field_sirius_date_end");
    const startYmd = startRaw ? toYmd(startRaw) : null;
    let endYmd = endRaw ? toYmd(endRaw) : null;
    if (startRaw && !startYmd) rejects.add("bad_start_date", { nid: r.nid });
    if (endRaw && !endYmd) rejects.add("bad_end_date", { nid: r.nid });
    const active = yesNo(strOf(r.fields, "field_sirius_active"));
    if (active === false && !endYmd && r.changed != null) {
      endYmd = epochToYmd(r.changed); // end-dating convention (§4 active flag)
      stats.endDatedFromChanged++;
    }
    const seqRaw = scalarOf(r.fields["field_sirius_count"]);
    const sequence =
      typeof seqRaw === "number" ? seqRaw : typeof seqRaw === "string" && /^\d+$/.test(seqRaw) ? Number(seqRaw) : null;

    const mapped = relMap.get(r.nid);
    if (mapped) {
      stats.matched++;
      if (w2Id) expected.set(r.nid, { worker1: w1.s2Id, worker2: w2Id, relationType });
      continue;
    }

    if (DRY_RUN) {
      stats.created++;
      continue;
    }
    if (!w2Id) continue; // dry-run-only path; real run always has w2Id here

    try {
      const created = await withNotificationsSuppressed(() =>
        storage.workerRelations.create({
          worker1: w1.s2Id,
          worker2: w2Id!,
          relationType,
          startYmd,
          endYmd,
          data: sequence != null ? { sequence } : null,
        }),
      );
      const winner = await putMapping("relation", r.nid, created.id, { stub: false, loader: LOADER });
      if (winner !== created.id) {
        console.error(`RACE: relation nid ${r.nid} already mapped to ${winner}; row ${created.id} may be an orphan`);
      }
      stats.created++;
      expected.set(r.nid, { worker1: w1.s2Id, worker2: w2Id, relationType });
    } catch (err) {
      // storage validation (duplicate pair/self-relation/missing worker) —
      // surfaced as a counted reject, loader continues
      rejects.add("relation_create_failed", { nid: r.nid, message: (err as Error).message }, r.nid);
    }
  }
  report.relations = stats;

  // ---------------- verify pass ----------------
  let verifyFailures = 0;
  if (!DRY_RUN) {
    const vMap = await getMappings("relation", rels.map((r) => r.nid));
    for (const r of rels) {
      if (rejects.hasAny(r.nid)) continue;
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

  report.rejects = rejects.counts;
  report.rejectSamples = rejects.samples;
  report.verifyFailures = verifyFailures;

  const ownerRejectCount = OWNER_REJECTS.reduce((n, k) => n + (rejects.counts[k] ?? 0), 0);
  console.log(JSON.stringify(report, null, 2));
  if (!DRY_RUN) await recordRun(startedAt, { loader: LOADER, allowMissingOwner: ALLOW_MISSING_OWNER }, report);

  if (verifyFailures > 0) process.exit(1);
  if (ownerRejectCount > 0 && !ALLOW_MISSING_OWNER) {
    console.error(
      `FAIL: ${ownerRejectCount} relationship(s) with unresolvable owning side (Q13: production has owners on all rows). ` +
        `Pass --allow-missing-owner ONLY against the synthetic dev DB.`,
    );
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
