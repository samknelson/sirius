/**
 * Smoke test for the T29 enrollment-packet-tag loader (contact-level grain).
 *
 * The synthetic dev S1 source predates the tag vocabulary (all contact tag
 * tids are NULL, no sirius_contact_tags terms exist), so the dev loader run
 * is a documented no-op. This script seeds FULLY-POPULATED fakes — a
 * keep-tag term + decoy term (staged taxonomy) and staged sirius_contact
 * rows (nids 999008xx) mapped to real dev contacts — then runs the loader
 * as a real CLI and asserts:
 *   - scope: only keep-tagged contact rows load; decoy-tagged rows are
 *     ignored (out of scope, NOT rejects);
 *   - S2 home: one `comm` per tagged contact node — medium 'offline',
 *     status 'logged', sent/received = node `changed` date (approximate,
 *     flagged via data.dateSource/dateApproximate), provenance data;
 *   - grain: a second tagged node resolving to the SAME S2 contact adopts
 *     the first node's comm (both nids mapped, one comm);
 *   - reject policy: contact_unmapped is counted, and a run WITHOUT
 *     --allow-rejects exits 1;
 *   - idempotent re-run: alreadyMapped, zero creates;
 *   - crash repair: deleting an id_map row and re-running re-adopts the
 *     existing comm by contact provenance, never duplicates;
 *   - preflight: a keep-tag-NAMED term staged under a foreign vocabulary
 *     aborts the run (exit 1) before any write.
 * Cleanup removes every fake staged row, term, id_map entry, and comm.
 *
 * Run: npx tsx scripts/oneoffs/s1-t29-packet-tag-smoke.ts
 */
import { spawnSync } from "child_process";
import { db, pool as pgPool } from "../../server/storage/db";
import { sql } from "drizzle-orm";
import { ensureStagingSchema, upsertRecords, upsertTerms } from "../s1-migration/lib/staging";
import { ensureIdMap, getMappings, putMapping } from "../s1-migration/lib/idmap";

const LOADER_NAME = "t29-enrollment-packet-tags";
const ENTITY = "contact-packet";

// Fake S1 ids — far above any real/synthetic range.
const T = {
  keepTag: 99900801,
  decoyTag: 99900802,
  foreignTag: 99900803, // keep-tag NAME in a foreign vocabulary (preflight test)
};
const N = {
  ct1: 99900811, // → c1, [keep, decoy] → create
  ct2: 99900812, // → c2, [keep] → create
  ct3: 99900813, // → c3, [decoy] → out of scope
  ct4: 99900814, // → c1 (duplicate node, same S2 contact) → adopts ct1's comm
  ct5: 99900815, // [keep], NO contact id_map entry → contact_unmapped reject
};
// distinct changed epochs → distinct comm dates (UTC)
const CH1 = Date.UTC(2026, 0, 15) / 1000; // 2026-01-15
const CH2 = Date.UTC(2026, 1, 20) / 1000; // 2026-02-20
const EPOCH = Date.UTC(2025, 5, 1) / 1000; // node created (must NOT drive dates)

let failures = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) {
    console.log(`  ok: ${name}`);
  } else {
    failures++;
    console.error(`  FAIL: ${name}${extra !== undefined ? ` — ${JSON.stringify(extra)}` : ""}`);
  }
}

function runLoader(args: string[]): { status: number; report: Record<string, any> } {
  const res = spawnSync("npx", ["tsx", "scripts/s1-migration/load-enrollment-packet-tags.ts", ...args], {
    encoding: "utf8",
    timeout: 240_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  const out = res.stdout ?? "";
  const idx = out.indexOf("\n{");
  let report: Record<string, any> = {};
  if (idx >= 0) {
    try {
      report = JSON.parse(out.slice(idx + 1));
    } catch {
      /* report stays empty; caller's asserts will fail loudly */
    }
  }
  return { status: res.status ?? -1, report };
}

async function rows<T>(q: ReturnType<typeof sql>): Promise<T[]> {
  return ((await db.execute(q)) as unknown as { rows: T[] }).rows;
}

async function main() {
  await ensureStagingSchema();
  await ensureIdMap();

  // ---- gather real dev contacts --------------------------------------------
  const contactMaps = await rows<{ s2_id: string }>(
    sql`SELECT m.s2_id FROM s1_staging.id_map m JOIN contacts c ON c.id = m.s2_id
        WHERE m.entity = 'contact' ORDER BY m.s1_id LIMIT 3`,
  );
  if (contactMaps.length < 3) {
    console.error("SETUP FAIL: dev DB is missing mapped contacts — run the contacts/workers loader first.");
    process.exit(1);
  }
  const [c1, c2, c3] = contactMaps.map((r) => r.s2_id);

  try {
    // ---- seed staged fakes ---------------------------------------------------
    await upsertTerms([
      { tid: T.keepTag, vocabulary: "sirius_contact_tags", name: "Comms: Received Enrollment Packet", description: null, weight: 0, fields: {} },
      { tid: T.decoyTag, vocabulary: "sirius_contact_tags", name: "Comms: Returned Mail", description: null, weight: 0, fields: {} },
    ]);
    // contact id_map entries for the fake nids (ct4 duplicates c1 — the
    // duplicate-node-same-contact adoption case; ct5 stays unmapped).
    await putMapping("contact", N.ct1, c1, { stub: false, loader: "smoke" });
    await putMapping("contact", N.ct2, c2, { stub: false, loader: "smoke" });
    await putMapping("contact", N.ct3, c3, { stub: false, loader: "smoke" });
    await putMapping("contact", N.ct4, c1, { stub: false, loader: "smoke" });

    const base = { vid: null as number | null, uid: 1, status: 1, created: EPOCH, title: null as string | null };
    await upsertRecords([
      { ...base, bundle: "sirius_contact", nid: N.ct1, changed: CH1, fields: { field_sirius_contact_tags: [T.keepTag, T.decoyTag] } },
      { ...base, bundle: "sirius_contact", nid: N.ct2, changed: CH2, fields: { field_sirius_contact_tags: [T.keepTag] } },
      { ...base, bundle: "sirius_contact", nid: N.ct3, changed: CH1, fields: { field_sirius_contact_tags: [T.decoyTag] } },
      { ...base, bundle: "sirius_contact", nid: N.ct4, changed: CH2, fields: { field_sirius_contact_tags: [T.keepTag] } },
      { ...base, bundle: "sirius_contact", nid: N.ct5, changed: CH1, fields: { field_sirius_contact_tags: [T.keepTag] } },
    ]);

    // ---- run 0: foreign-vocabulary preflight hard-fail ----------------------
    console.log("T29 run 0 (keep-tag name in foreign vocabulary aborts before any write):");
    await upsertTerms([
      { tid: T.foreignTag, vocabulary: "sirius_member_status", name: "Comms: Received Enrollment Packet", description: null, weight: 0, fields: {} },
    ]);
    const t0 = runLoader(["--allow-rejects", "contact_unmapped"]);
    check("t0 exit 1", t0.status === 1, t0.status);
    const t0comms = await rows<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM comm WHERE data->>'s1Loader' = ${LOADER_NAME}`,
    );
    check("t0 nothing written", Number(t0comms[0]?.n) === 0, t0comms[0]);
    await db.execute(sql`DELETE FROM s1_staging.terms WHERE tid = ${T.foreignTag}`);

    // ---- run 1: create -------------------------------------------------------
    console.log("T29 run 1 (create):");
    const t1 = runLoader(["--allow-rejects", "contact_unmapped"]);
    check("t1 exit 0", t1.status === 0, t1.status);
    check("t1 inScope 4", t1.report.inScope === 4, t1.report.inScope);
    check("t1 created 2", t1.report.created === 2, t1.report.created);
    check("t1 duplicateContactNode 1", t1.report.duplicateContactNode === 1, t1.report.duplicateContactNode);
    check("t1 contact_unmapped 1", t1.report.rejects?.contact_unmapped === 1, t1.report.rejects);
    check("t1 verify clean", t1.report.verifyFailures === 0, t1.report.verifyFailures);

    const comms = await rows<{ id: string; contact_id: string; medium: string; status: string; sent: string; received: string; data: any }>(
      sql`SELECT id, contact_id, medium, status, sent::text AS sent, received::text AS received, data
            FROM comm WHERE data->>'s1Loader' = ${LOADER_NAME} ORDER BY sent`,
    );
    check("one comm per tagged contact: 2 comms", comms.length === 2, comms.length);
    check("comms belong to c1+c2", new Set(comms.map((c) => c.contact_id)).size === 2 && comms.every((c) => [c1, c2].includes(c.contact_id)), comms.map((c) => c.contact_id));
    check("no comm for decoy-only contact", !comms.some((c) => c.contact_id === c3));
    check("medium offline", comms.every((c) => c.medium === "offline"), comms.map((c) => c.medium));
    check("status logged", comms.every((c) => c.status === "logged"), comms.map((c) => c.status));
    check("c1 comm dated from node changed (2026-01-15)", comms[0]?.sent?.startsWith("2026-01-15"), comms[0]?.sent);
    check("c2 comm dated from node changed (2026-02-20)", comms[1]?.sent?.startsWith("2026-02-20"), comms[1]?.sent);
    check("received mirrors sent", comms.every((c) => c.received === c.sent));
    check("data kind", comms.every((c) => c.data?.kind === "enrollment_packet_received"));
    check("data label", comms.every((c) => c.data?.label === "Received Enrollment Packet"));
    check("data dateSource s1_node_changed", comms.every((c) => c.data?.dateSource === "s1_node_changed"), comms.map((c) => c.data?.dateSource));
    check("data dateApproximate true", comms.every((c) => c.data?.dateApproximate === true), comms.map((c) => c.data?.dateApproximate));

    const map1 = await getMappings(ENTITY, [N.ct1, N.ct2, N.ct4]);
    const c1Comm = comms.find((c) => c.contact_id === c1);
    check("ct1 mapped to c1's comm", map1.get(N.ct1)?.s2Id === c1Comm?.id, map1.get(N.ct1)?.s2Id);
    check("ct4 duplicate mapped to SAME c1 comm", map1.get(N.ct4)?.s2Id === c1Comm?.id, map1.get(N.ct4)?.s2Id);
    check("ct2 mapped", Boolean(map1.get(N.ct2)?.s2Id));

    // ---- reject-policy gate: no allowance → exit 1 ---------------------------
    console.log("T29 run gate (disallowed reject exits 1):");
    const tg = runLoader([]);
    check("gate exit 1", tg.status === 1, tg.status);

    // ---- run 2: idempotent re-run --------------------------------------------
    console.log("T29 run 2 (idempotent adopt):");
    const t2 = runLoader(["--allow-rejects", "contact_unmapped"]);
    check("t2 exit 0", t2.status === 0, t2.status);
    check("t2 created 0", t2.report.created === 0, t2.report.created);
    check("t2 alreadyMapped 3", t2.report.alreadyMapped === 3, t2.report.alreadyMapped);
    check("t2 verify clean", t2.report.verifyFailures === 0, t2.report.verifyFailures);
    const commCount2 = await rows<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM comm WHERE data->>'s1Loader' = ${LOADER_NAME}`,
    );
    check("t2 still 2 comms", Number(commCount2[0]?.n) === 2, commCount2[0]);

    // ---- run 3: crash repair (lost id_map row re-adopted by provenance) ------
    console.log("T29 run 3 (crash repair):");
    await db.execute(sql`DELETE FROM s1_staging.id_map WHERE entity = ${ENTITY} AND s1_id = ${N.ct1}`);
    const t3 = runLoader(["--allow-rejects", "contact_unmapped"]);
    check("t3 exit 0", t3.status === 0, t3.status);
    check("t3 created 0 (no duplicate)", t3.report.created === 0, t3.report.created);
    check("t3 adoptedByProvenance 1", t3.report.adoptedByProvenance === 1, t3.report.adoptedByProvenance);
    check("t3 verify clean", t3.report.verifyFailures === 0, t3.report.verifyFailures);
    const repaired = await getMappings(ENTITY, [N.ct1]);
    check("t3 id_map repaired to same comm", repaired.get(N.ct1)?.s2Id === c1Comm?.id, repaired.get(N.ct1)?.s2Id);
    const commCount3 = await rows<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM comm WHERE data->>'s1Loader' = ${LOADER_NAME}`,
    );
    check("t3 still 2 comms", Number(commCount3[0]?.n) === 2, commCount3[0]);
  } finally {
    // ---- cleanup (best-effort, loud on error) -------------------------------
    console.log("cleanup:");
    const steps: Array<[string, ReturnType<typeof sql>]> = [
      ["comm fakes", sql`DELETE FROM comm WHERE data->>'s1Loader' = ${LOADER_NAME}`],
      ["staged fakes", sql`DELETE FROM s1_staging.records WHERE bundle = 'sirius_contact' AND nid BETWEEN 99900810 AND 99900819`],
      ["term fakes", sql`DELETE FROM s1_staging.terms WHERE tid BETWEEN 99900800 AND 99900809`],
      ["id_map packet fakes", sql`DELETE FROM s1_staging.id_map WHERE entity = ${ENTITY} AND s1_id BETWEEN 99900810 AND 99900819`],
      ["id_map contact fakes", sql`DELETE FROM s1_staging.id_map WHERE entity = 'contact' AND s1_id BETWEEN 99900810 AND 99900819`],
    ];
    for (const [name, q] of steps) {
      try {
        await db.execute(q);
        console.log(`  cleaned: ${name}`);
      } catch (e) {
        failures++;
        console.error(`  CLEANUP FAIL: ${name} — ${(e as Error).message}`);
      }
    }
  }

  await pgPool.end();
  console.log(failures === 0 ? "SMOKE PASS" : `SMOKE FAIL (${failures} failed checks)`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
