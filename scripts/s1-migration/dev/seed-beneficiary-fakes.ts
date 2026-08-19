/**
 * DEV-ONLY rehearsal helper — seed FAKE beneficiary designations into staged
 * `sirius_worker` rows so the dev rehearsal exercises every
 * load-beneficiaries reject/skip class. The synthetic S1 dataset has no
 * worker-bundle `field_sirius_json` at all, so without this script the
 * loader is a documented no-op in dev.
 *
 * Unlike seed-call-log-traps this script inserts NO new staged rows — it
 * merges a `field_sirius_json` value into EXISTING staged workers' fields
 * (jsonb ||), so load-contacts-workers re-runs see exactly the same worker
 * set as before (that loader never reads field_sirius_json). The unmapped
 * trap reuses a staged worker that already has no id_map entry (the
 * synthetic set has 2, from worker_contact_unresolved) — no fake node ids.
 *
 * Trap coverage (mapped workers are picked deterministically by nid at run
 * time; the report line prints the assignment):
 *   1. shape A (object-with-value) + padded blank rows + a blank-name row
 *      carrying data + soft-invalid SSN/phone + misspelled relationship
 *      (loads verbatim; softMismatches.ssnInvalid/phoneInvalid = 1 each)
 *   2. shape B (bare scalar JSON string) — loads
 *   3. shape C (extra-delta array; first delta wins) — loads,
 *      extraDeltaArrays = 1
 *   4. bad percent sum (50 + 40) → percent_sum_mismatch
 *   5. unexpected `contingent` tier → unexpected_tier ANNOTATION (primary
 *      still loads)
 *   6. operator-owned existing list → list_exists_foreign (this script also
 *      writes the operator list through storage and deletes any
 *      bao-beneficiaries id_map authorship row so the trap holds even after
 *      a prior loader run)
 *   7. populated rows with unusable pcts (blank + repeated-dot "50..") →
 *      pct_unusable (normalization must NOT rescue "50..")
 *   8. unparseable JSON → bad_json
 *   9. out-of-range percents that still sum to 100 (150 / -50) — loads,
 *      softMismatches.percentOutOfRange = 2
 *  10. unmapped staged worker with a valid designation → worker_unmapped
 *  11. loader-OWNED stale list + staged side now contingent-only (zero
 *      populated primary) → clear sweep MUST empty the list (workersCleared)
 *      while unexpected_tier is annotated (this script writes the stale list
 *      through storage and inserts the bao-beneficiaries id_map authorship
 *      row to simulate a prior loader run)
 *  12. bao-beneficiaries AUTHORSHIP row pointing at a deleted S2 worker (no
 *      beneficiaries JSON staged) → the clear sweep must report
 *      worker_map_broken (phase "clear"), never silently skip. The broken
 *      row persists across runs by design — the loader repairs nothing.
 *  13. legacy trailing-dot whole percents ("50." / "50.") — loads as 50/50
 *      (rehearsal-discovered S1 formatting; must NOT reject)
 *  14. fractional percents ("50.5" / "49.5") — loads with decimal precision
 *      retained; participates in the 100% sum check
 *
 * The clear-WRITE failure path (write_failed, phase "clear") cannot be
 * seeded with data alone; `dev/smoke-beneficiary-clear-write-failure.ts`
 * covers it with a temporary trigger.
 *
 * Expected smoke invocation after seeding:
 *   npx tsx scripts/s1-migration/load-beneficiaries.ts \
 *     --allow-rejects worker_unmapped,percent_sum_mismatch,pct_unusable,bad_json,unexpected_tier,list_exists_foreign,worker_map_broken
 *
 * Idempotent (jsonb merge by key + storage replace-all). NOTE: a full
 * restage sweeps the merged field values — re-run this script after any
 * restage, BEFORE the beneficiaries smoke. PRODUCTION: NOT used.
 *
 * Usage: npx tsx scripts/s1-migration/dev/seed-beneficiary-fakes.ts
 */
import { db, pool } from "../../../server/storage/db";
import { sql } from "drizzle-orm";
import { storage } from "../../../server/storage/database";
import { withNotificationsSuppressed } from "../../../server/middleware/request-context";
import { ensureStagingSchema } from "../lib/staging";
import { ensureIdMap, putMapping } from "../lib/idmap";

/** Staged shape A: object-with-value (the dominant production shape). */
function shapeA(json: unknown) {
  return { value: JSON.stringify(json), format: null };
}
/** Staged shape B: bare scalar string. */
function shapeB(json: unknown) {
  return JSON.stringify(json);
}
/** Staged shape C: extra-delta array anomaly (first delta wins). */
function shapeC(json: unknown) {
  return [{ value: JSON.stringify(json), format: null }, { value: JSON.stringify({ note: "surplus delta" }), format: null }];
}

const bene = (name: string, pct: string | number, extra: Record<string, unknown> = {}) => ({
  name,
  ssn: "",
  phone: "",
  address: "",
  relationship: "",
  pct,
  ...extra,
});
const blank = () => bene("", "");

async function main() {
  await ensureStagingSchema();
  await ensureIdMap();

  // Deterministic picks: non-user-linked staged workers first (see ORDER
  // BY note), then lowest nid, each with a non-stub worker
  // mapping (9 needed), plus one staged worker with NO mapping at all.
  const mappedRes = await db.execute(sql`
    SELECT r.nid, m.s2_id FROM s1_staging.records r
      JOIN s1_staging.id_map m ON m.entity = 'worker' AND m.s1_id = r.nid AND m.stub = false
     WHERE r.bundle = 'sirius_worker'
     -- Prefer workers whose CONTACT email is NOT a staged user's mail: the
     -- fleet-smoke delete target must carry a fake WITHOUT being user-linked,
     -- or deleting its staged row would strand a migration-owned t27 worker
     -- link ("retains stale migration-owned worker link" verify failure).
     -- Stable within each group (nid) so re-seeds stay deterministic.
     ORDER BY (EXISTS (
       SELECT 1 FROM s1_staging.records c
         JOIN s1_staging.raw_users u
           ON lower(u.mail) = lower(COALESCE(c.fields #>> '{field_sirius_email,value}',
                                             c.fields ->> 'field_sirius_email'))
        WHERE c.bundle = 'sirius_contact'
          AND c.nid = COALESCE(r.fields #>> '{field_sirius_contact,target_id}',
                               r.fields #>> '{field_sirius_contact,0,target_id}',
                               r.fields #>> '{field_sirius_contact,0}',
                               CASE WHEN jsonb_typeof(r.fields -> 'field_sirius_contact') IN ('number','string')
                                    THEN r.fields ->> 'field_sirius_contact' END)::bigint
     )) ASC, r.nid ASC LIMIT 13
  `);
  const mapped = (mappedRes as unknown as { rows: Array<{ nid: string | number; s2_id: string }> }).rows.map(
    (r) => ({ nid: Number(r.nid), workerId: r.s2_id }),
  );
  if (mapped.length < 13) {
    throw new Error(
      `ABORTING: need 13 mapped staged workers, found ${mapped.length} — run load-contacts-workers first.`,
    );
  }
  const unmappedRes = await db.execute(sql`
    SELECT r.nid FROM s1_staging.records r
      LEFT JOIN s1_staging.id_map m ON m.entity = 'worker' AND m.s1_id = r.nid
     WHERE r.bundle = 'sirius_worker' AND m.s2_id IS NULL ORDER BY r.nid LIMIT 1
  `);
  const unmappedNid = Number(
    (unmappedRes as unknown as { rows: Array<{ nid: string | number }> }).rows[0]?.nid ?? NaN,
  );
  if (!Number.isFinite(unmappedNid)) {
    throw new Error(
      "ABORTING: no unmapped staged sirius_worker found for the worker_unmapped trap — " +
        "the synthetic set normally has 2 (worker_contact_unresolved). Investigate before seeding.",
    );
  }

  const [w1, w2, w3, w4, w5, w6, w7, w8, w9, w10, w11, w12, w13] = mapped;

  const traps: Array<{ nid: number; label: string; fieldValue: unknown }> = [
    {
      nid: w1.nid,
      label: "shape A + padded blanks + soft-invalid ssn/phone",
      fieldValue: shapeA({
        beneficiaries: {
          primary: [
            bene("ALPHA PRIMARY ONE", "60", {
              ssn: "666-12-3456", // area 666 — fails route schema, loads verbatim
              phone: "555-01", // too short — fails route schema, loads verbatim
              relationship: "SPUOSE", // misspelled — loads verbatim (out of scope to clean)
              address: "1 Fake St, Los Angeles CA",
            }),
            bene("ALPHA PRIMARY TWO", 40, { relationship: "Child" }),
            blank(),
            blank(),
            blank(),
            bene(" ", "", { phone: "3105551212" }), // blank name WITH data — filtered + counted
          ],
        },
      }),
    },
    {
      nid: w2.nid,
      label: "shape B (bare scalar)",
      fieldValue: shapeB({ beneficiaries: { primary: [bene("BRAVO SOLE", "100", { relationship: "Spouse" })] } }),
    },
    {
      nid: w3.nid,
      label: "shape C (extra-delta array)",
      fieldValue: shapeC({ beneficiaries: { primary: [bene("CHARLIE SOLE", 100)] } }),
    },
    {
      nid: w4.nid,
      label: "bad percent sum (90)",
      fieldValue: shapeA({
        beneficiaries: { primary: [bene("DELTA ONE", "50"), bene("DELTA TWO", "40")] },
      }),
    },
    {
      nid: w5.nid,
      label: "unexpected contingent tier (primary loads)",
      fieldValue: shapeA({
        beneficiaries: {
          primary: [bene("ECHO PRIMARY", "100")],
          contingent: [bene("ECHO CONTINGENT", "100")],
        },
      }),
    },
    {
      nid: w6.nid,
      label: "operator-owned existing list (loader must skip)",
      fieldValue: shapeA({ beneficiaries: { primary: [bene("FOXTROT STAGED", "100")] } }),
    },
    {
      nid: w7.nid,
      label: "unusable pct on a populated row",
      fieldValue: shapeA({
        beneficiaries: {
          primary: [
            bene("GOLF NO PCT", ""),
            bene("GOLF DOUBLE DOT", "50.."), // repeated dots — must stay unusable
            bene("GOLF OK", "50"),
          ],
        },
      }),
    },
    {
      nid: w8.nid,
      label: "unparseable JSON",
      fieldValue: shapeA(null), // replaced below — raw broken string
    },
    {
      nid: w9.nid,
      label: "out-of-range percents summing to 100 (soft count)",
      fieldValue: shapeA({
        beneficiaries: { primary: [bene("INDIA HIGH", "150"), bene("INDIA LOW", "-50")] },
      }),
    },
    {
      nid: unmappedNid,
      label: "unmapped staged worker (worker_unmapped)",
      fieldValue: shapeA({ beneficiaries: { primary: [bene("JULIET UNMAPPED", "100")] } }),
    },
    {
      nid: w10.nid,
      label: "loader-owned stale list + contingent-only staging (clear sweep)",
      fieldValue: shapeA({
        beneficiaries: { primary: [], contingent: [bene("KILO CONTINGENT", "100")] },
      }),
    },
    {
      nid: w12.nid,
      label: "legacy trailing-dot whole percents (\"50.\" + \"50.\") — loads as 50/50",
      fieldValue: shapeA({
        beneficiaries: { primary: [bene("LIMA DOT ONE", "50."), bene("LIMA DOT TWO", "50.")] },
      }),
    },
    {
      nid: w13.nid,
      label: "fractional percents retain precision (50.5 + 49.5, sum check passes)",
      fieldValue: shapeA({
        beneficiaries: { primary: [bene("MIKE FRACTION HIGH", "50.5"), bene("MIKE FRACTION LOW", "49.5")] },
      }),
    },
  ];
  // w8: genuinely unparseable JSON string in the staged value slot.
  traps[7].fieldValue = { value: "{ this is not json", format: null };

  for (const t of traps) {
    await db.execute(sql`
      UPDATE s1_staging.records
         SET fields = fields || ${JSON.stringify({ field_sirius_json: t.fieldValue })}::jsonb
       WHERE bundle = 'sirius_worker' AND nid = ${t.nid}
    `);
  }

  // Operator-owned trap: write a foreign list through storage and remove any
  // loader authorship row so the loader MUST report list_exists_foreign.
  await withNotificationsSuppressed(() =>
    storage.baoBeneficiaries.set(w6.workerId, [
      { name: "OPERATOR ENTERED", relationship: "Spouse", percent: 100 },
    ]),
  );
  await db.execute(sql`
    DELETE FROM s1_staging.id_map WHERE entity = 'bao-beneficiaries' AND s1_id = ${w6.nid}
  `);

  // Clear-sweep trap: simulate a PRIOR loader run — a loader-OWNED stale list
  // whose staged side now has zero populated primary rows (contingent-only).
  // The loader must clear the list (workersCleared) despite the
  // unexpected_tier annotation.
  await withNotificationsSuppressed(() =>
    storage.baoBeneficiaries.set(w10.workerId, [{ name: "KILO STALE", percent: 100 }]),
  );
  await putMapping("bao-beneficiaries", w10.nid, w10.workerId, {
    stub: false,
    loader: "dev/seed-beneficiary-fakes",
  });

  // Clear-READ failure trap: an authorship row pointing at a deleted S2
  // worker, with NO beneficiaries JSON staged (strip defensively so the
  // worker lands on the clear sweep, not the write path). The loader must
  // report worker_map_broken (phase "clear") — never silently skip.
  await db.execute(sql`
    UPDATE s1_staging.records SET fields = fields - 'field_sirius_json'
     WHERE bundle = 'sirius_worker' AND nid = ${w11.nid}
  `);
  await putMapping("bao-beneficiaries", w11.nid, "00000000-0000-0000-0000-00000000dead", {
    stub: false,
    loader: "dev/seed-beneficiary-fakes",
  });

  for (const t of traps) console.log(`  nid ${t.nid}: ${t.label}`);
  console.log(`  nid ${w11.nid}: broken bao-beneficiaries authorship row (clear-read worker_map_broken)`);
  console.log(`seeded ${traps.length + 1} beneficiary trap(s); operator list set on worker of nid ${w6.nid}`);
  await pool.end();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
