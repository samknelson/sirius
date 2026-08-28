/**
 * Smoke test for the T29 enrollment-packet-tag loader (contact-level grain,
 * Task 293 sync semantics).
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
 *   - idempotent re-run: fingerprint fast path (summary.unchanged, zero
 *     creates, zero storage writes);
 *   - crash repair: deleting an id_map row and re-running re-adopts the
 *     existing comm by contact provenance, never duplicates;
 *   - SYNC UPDATE: a contact re-resolution (id_map rekey) fingerprints as
 *     changed and retargets the comm's contactId in place (sole reference) —
 *     date FROZEN;
 *   - SYNC DELETE: keep-tag removed in S1 → mapping swept, comm kept while
 *     another live node still shares it; node deleted in S1 → comm deleted;
 *   - SHARED-COMM SPLIT: repointing ONE of two nodes sharing a comm must
 *     never hijack the shared comm in place — the changed node moves to its
 *     own comm (created for its new contact), the untouched node keeps the
 *     original; repointing the second node too converges both onto the
 *     existing comm and deletes the emptied original;
 *   - DELETE-FAILURE RETRY: when the emptied old comm can't be deleted
 *     (forced via a temporary BEFORE DELETE trigger), the run rejects
 *     update_failed and exits 1 (gate-visible), the mapping and comm stay
 *     intact, and the next unblocked run retries the split to convergence;
 *   - preflight: a keep-tag-NAMED term staged under a foreign vocabulary
 *     aborts the run (exit 1) before any write.
 * Cleanup removes every fake staged row, term, id_map entry, and comm.
 *
 * Run: npx tsx scripts/oneoffs/s1-t29-packet-tag-smoke.ts
 */
import { spawnSync } from "child_process";
import { readFileSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { db, pool as pgPool } from "../../server/storage/db";
import { sql } from "drizzle-orm";
import { ensureStagingSchema, upsertRecords, upsertTerms } from "../s1-migration/lib/staging";
import { ensureIdMap, getMappings, putMapping } from "../s1-migration/lib/idmap";
import { getRawProcessEnv } from "../../server/config/env-registry";

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
  ct2: 99900812, // → c2, [keep] → create; later rekeyed to c3 (update), then node-deleted (sweep)
  ct3: 99900813, // → c3, [decoy] → out of scope
  ct4: 99900814, // → c1 (duplicate node, same S2 contact) → adopts ct1's comm; later untagged (sweep keeps shared comm)
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

function runLoader(args: string[]): { status: number; result: Record<string, any> } {
  const tmp = join(tmpdir(), `t29-smoke-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  const res = spawnSync("npx", ["tsx", "scripts/s1-migration/load-enrollment-packet-tags.ts", ...args], {
    encoding: "utf8",
    timeout: 240_000,
    maxBuffer: 64 * 1024 * 1024,
    env: { ...getRawProcessEnv(), S1_RESULT_JSON_PATH: tmp },
  });
  let result: Record<string, any> = {};
  try {
    result = JSON.parse(readFileSync(tmp, "utf8"));
  } catch {
    /* result stays empty; caller's asserts will fail loudly */
  }
  try {
    unlinkSync(tmp);
  } catch {
    /* already gone */
  }
  return { status: res.status ?? -1, result };
}

async function rows<T>(q: ReturnType<typeof sql>): Promise<T[]> {
  return ((await db.execute(q)) as unknown as { rows: T[] }).rows;
}

async function commCount(): Promise<number> {
  const r = await rows<{ n: number }>(
    sql`SELECT count(*)::int AS n FROM comm WHERE data->>'s1Loader' = ${LOADER_NAME}`,
  );
  return Number(r[0]?.n ?? -1);
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
    check("t0 nothing written", (await commCount()) === 0);
    await db.execute(sql`DELETE FROM s1_staging.terms WHERE tid = ${T.foreignTag}`);

    // ---- run 1: create -------------------------------------------------------
    console.log("T29 run 1 (create):");
    const t1 = runLoader(["--allow-rejects", "contact_unmapped"]);
    check("t1 exit 0", t1.status === 0, t1.status);
    check("t1 inScope 4", t1.result.detail?.inScope === 4, t1.result.detail?.inScope);
    // mapping-grain created: 2 fresh comms + 1 duplicate-node adoption
    check("t1 summary.created 3", t1.result.summary?.created === 3, t1.result.summary);
    check("t1 commsCreated 2", t1.result.detail?.commsCreated === 2, t1.result.detail?.commsCreated);
    check("t1 duplicateContactNode 1", t1.result.detail?.duplicateContactNode === 1, t1.result.detail?.duplicateContactNode);
    check("t1 contact_unmapped 1", t1.result.rejectGate?.counts?.contact_unmapped === 1, t1.result.rejectGate?.counts);
    check("t1 verify clean", t1.result.verify?.failures === 0, t1.result.verify);

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
    const c2Comm = comms.find((c) => c.contact_id === c2);
    check("ct1 mapped to c1's comm", map1.get(N.ct1)?.s2Id === c1Comm?.id, map1.get(N.ct1)?.s2Id);
    check("ct4 duplicate mapped to SAME c1 comm", map1.get(N.ct4)?.s2Id === c1Comm?.id, map1.get(N.ct4)?.s2Id);
    check("ct2 mapped", Boolean(map1.get(N.ct2)?.s2Id));

    // ---- reject-policy gate: no allowance → exit 1 ---------------------------
    console.log("T29 run gate (disallowed reject exits 1):");
    const tg = runLoader([]);
    check("gate exit 1", tg.status === 1, tg.status);

    // ---- run 2: idempotent re-run (fingerprint fast path) --------------------
    console.log("T29 run 2 (fingerprint fast path):");
    const t2 = runLoader(["--allow-rejects", "contact_unmapped"]);
    check("t2 exit 0", t2.status === 0, t2.status);
    check("t2 created 0", t2.result.summary?.created === 0, t2.result.summary);
    check("t2 updated 0", t2.result.summary?.updated === 0, t2.result.summary);
    check("t2 unchanged 3", t2.result.summary?.unchanged === 3, t2.result.summary);
    check("t2 fastPathSkips 3", t2.result.detail?.fastPathSkips === 3, t2.result.detail?.fastPathSkips);
    check("t2 verify clean", t2.result.verify?.failures === 0, t2.result.verify);
    check("t2 still 2 comms", (await commCount()) === 2);

    // ---- run 3: crash repair (lost id_map row re-adopted by provenance) ------
    console.log("T29 run 3 (crash repair):");
    await db.execute(sql`DELETE FROM s1_staging.id_map WHERE entity = ${ENTITY} AND s1_id = ${N.ct1}`);
    const t3 = runLoader(["--allow-rejects", "contact_unmapped"]);
    check("t3 exit 0", t3.status === 0, t3.status);
    check("t3 created 1 (adoption, no new comm)", t3.result.summary?.created === 1, t3.result.summary);
    check("t3 adoptedByProvenance 1", t3.result.detail?.adoptedByProvenance === 1, t3.result.detail?.adoptedByProvenance);
    check("t3 verify clean", t3.result.verify?.failures === 0, t3.result.verify);
    const repaired = await getMappings(ENTITY, [N.ct1]);
    check("t3 id_map repaired to same comm", repaired.get(N.ct1)?.s2Id === c1Comm?.id, repaired.get(N.ct1)?.s2Id);
    check("t3 still 2 comms", (await commCount()) === 2);

    // ---- run 4: SYNC UPDATE — contact rekey retargets the comm, date frozen --
    console.log("T29 run 4 (sync update: contact re-resolution):");
    await db.execute(sql`DELETE FROM s1_staging.id_map WHERE entity = 'contact' AND s1_id = ${N.ct2}`);
    await putMapping("contact", N.ct2, c3, { stub: false, loader: "smoke" });
    const t4 = runLoader(["--allow-rejects", "contact_unmapped"]);
    check("t4 exit 0", t4.status === 0, t4.status);
    check("t4 updated 1", t4.result.summary?.updated === 1, t4.result.summary);
    check("t4 commsUpdated 1", t4.result.detail?.commsUpdated === 1, t4.result.detail?.commsUpdated);
    check("t4 created 0", t4.result.summary?.created === 0, t4.result.summary);
    const after4 = await rows<{ id: string; contact_id: string; sent: string; data: any }>(
      sql`SELECT id, contact_id, sent::text AS sent, data FROM comm WHERE id = ${c2Comm!.id}`,
    );
    check("t4 comm retargeted to c3", after4[0]?.contact_id === c3, after4[0]?.contact_id);
    check("t4 date FROZEN (still 2026-02-20)", after4[0]?.sent?.startsWith("2026-02-20"), after4[0]?.sent);
    check("t4 provenance intact", after4[0]?.data?.s1Loader === LOADER_NAME && after4[0]?.data?.s1?.nid === N.ct2, after4[0]?.data?.s1);
    check("t4 still 2 comms", (await commCount()) === 2);
    // rerun is a no-op (fp advanced)
    const t4b = runLoader(["--allow-rejects", "contact_unmapped"]);
    check("t4b unchanged 3", t4b.result.summary?.unchanged === 3, t4b.result.summary);

    // ---- run 5: SYNC DELETE — tag removed (shared comm kept) + node deleted --
    console.log("T29 run 5 (sync delete: untag ct4, hard-delete ct2's node):");
    await upsertRecords([
      { ...base, bundle: "sirius_contact", nid: N.ct4, changed: CH2, fields: { field_sirius_contact_tags: [T.decoyTag] } },
    ]);
    await db.execute(sql`DELETE FROM s1_staging.records WHERE bundle = 'sirius_contact' AND nid = ${N.ct2}`);
    const t5 = runLoader(["--allow-rejects", "contact_unmapped"]);
    check("t5 exit 0", t5.status === 0, t5.status);
    check("t5 deleted 2 (two mappings swept)", t5.result.summary?.deleted === 2, t5.result.summary);
    check("t5 commsDeleted 1", t5.result.detail?.sweep?.commsDeleted === 1, t5.result.detail?.sweep);
    check("t5 mappingsOnlyDeleted 1 (shared comm kept)", t5.result.detail?.sweep?.mappingsOnlyDeleted === 1, t5.result.detail?.sweep);
    check("t5 one comm remains", (await commCount()) === 1);
    const remaining = await rows<{ id: string; contact_id: string }>(
      sql`SELECT id, contact_id FROM comm WHERE data->>'s1Loader' = ${LOADER_NAME}`,
    );
    check("t5 survivor is c1's comm (still tagged via ct1)", remaining[0]?.id === c1Comm?.id && remaining[0]?.contact_id === c1, remaining[0]);
    const map5 = await getMappings(ENTITY, [N.ct1, N.ct2, N.ct4]);
    check("t5 ct1 mapping intact", map5.get(N.ct1)?.s2Id === c1Comm?.id);
    check("t5 ct2 mapping swept", !map5.get(N.ct2));
    check("t5 ct4 mapping swept", !map5.get(N.ct4));
    // rerun converges (nothing left to sweep)
    const t5b = runLoader(["--allow-rejects", "contact_unmapped"]);
    check("t5b deleted 0", t5b.result.summary?.deleted === 0, t5b.result.summary);
    check("t5b unchanged 1", t5b.result.summary?.unchanged === 1, t5b.result.summary);

    // ---- run 6: SHARED-COMM SPLIT — repoint one of two nodes sharing a comm --
    console.log("T29 run 6 (shared-comm split: repoint one duplicate node, other untouched):");
    // restore the shared pair: re-tag ct4 → re-adopts c1's comm by provenance
    await upsertRecords([
      { ...base, bundle: "sirius_contact", nid: N.ct4, changed: CH2, fields: { field_sirius_contact_tags: [T.keepTag] } },
    ]);
    const t6a = runLoader(["--allow-rejects", "contact_unmapped"]);
    check("t6a exit 0", t6a.status === 0, t6a.status);
    check("t6a re-adopts the shared comm (created 1, still 1 comm)", t6a.result.summary?.created === 1 && (await commCount()) === 1, t6a.result.summary);
    const map6a = await getMappings(ENTITY, [N.ct1, N.ct4]);
    check("t6a both nids share c1's comm", map6a.get(N.ct1)?.s2Id === c1Comm?.id && map6a.get(N.ct4)?.s2Id === c1Comm?.id, [map6a.get(N.ct1)?.s2Id, map6a.get(N.ct4)?.s2Id]);

    // repoint ONLY ct4's contact (S1 dedupe/repair); ct1 and the log node untouched
    await db.execute(sql`DELETE FROM s1_staging.id_map WHERE entity = 'contact' AND s1_id = ${N.ct4}`);
    await putMapping("contact", N.ct4, c2, { stub: false, loader: "smoke" });
    const t6b = runLoader(["--allow-rejects", "contact_unmapped"]);
    check("t6b exit 0", t6b.status === 0, t6b.status);
    check("t6b updated 1 via split, not in-place", t6b.result.summary?.updated === 1 && t6b.result.detail?.sharedCommSplits === 1, { summary: t6b.result.summary, splits: t6b.result.detail?.sharedCommSplits });
    check("t6b new comm created for the new contact", t6b.result.detail?.commsCreated === 1 && (await commCount()) === 2, t6b.result.detail?.commsCreated);
    const map6b = await getMappings(ENTITY, [N.ct1, N.ct4]);
    const ct4CommRows = await rows<{ id: string; contact_id: string; sent: string; data: any }>(
      sql`SELECT id, contact_id, sent::text AS sent, data FROM comm WHERE id = ${map6b.get(N.ct4)?.s2Id ?? "00000000-0000-0000-0000-000000000000"}`,
    );
    check("t6b ct1 STILL mapped to c1's comm — not hijacked", map6b.get(N.ct1)?.s2Id === c1Comm?.id, map6b.get(N.ct1)?.s2Id);
    check(
      "t6b c1's comm contact UNCHANGED",
      (await rows<{ contact_id: string }>(sql`SELECT contact_id FROM comm WHERE id = ${c1Comm!.id}`))[0]?.contact_id === c1,
    );
    check("t6b ct4 moved to its own comm on c2", map6b.get(N.ct4)?.s2Id !== c1Comm?.id && ct4CommRows[0]?.contact_id === c2, ct4CommRows[0]?.contact_id);
    check("t6b split comm dated from ct4's node changed", ct4CommRows[0]?.sent?.startsWith("2026-02-20"), ct4CommRows[0]?.sent);
    check("t6b split comm provenance", ct4CommRows[0]?.data?.s1Loader === LOADER_NAME && ct4CommRows[0]?.data?.s1?.nid === N.ct4, ct4CommRows[0]?.data?.s1);

    // convergence: repoint ct1 to c2 as well → adopts ct4's comm (no create),
    // and the emptied original comm is deleted
    await db.execute(sql`DELETE FROM s1_staging.id_map WHERE entity = 'contact' AND s1_id = ${N.ct1}`);
    await putMapping("contact", N.ct1, c2, { stub: false, loader: "smoke" });
    const t6c = runLoader(["--allow-rejects", "contact_unmapped"]);
    check("t6c exit 0", t6c.status === 0, t6c.status);
    check("t6c adopts the existing comm (updated 1, no create)", t6c.result.summary?.updated === 1 && t6c.result.detail?.commsCreated === 0, { summary: t6c.result.summary, created: t6c.result.detail?.commsCreated });
    check("t6c emptied original comm deleted", t6c.result.detail?.emptiedCommsDeleted === 1 && (await commCount()) === 1, t6c.result.detail?.emptiedCommsDeleted);
    const map6c = await getMappings(ENTITY, [N.ct1, N.ct4]);
    check("t6c both nids converged onto the c2 comm", map6c.get(N.ct1)?.s2Id === ct4CommRows[0]?.id && map6c.get(N.ct4)?.s2Id === ct4CommRows[0]?.id, [map6c.get(N.ct1)?.s2Id, map6c.get(N.ct4)?.s2Id]);
    check("t6c c1's original comm row gone", (await rows<{ id: string }>(sql`SELECT id FROM comm WHERE id = ${c1Comm!.id}`)).length === 0);
    // converged state is stable
    const t6d = runLoader(["--allow-rejects", "contact_unmapped"]);
    check("t6d rerun unchanged 2, no writes", t6d.result.summary?.unchanged === 2 && t6d.result.summary?.updated === 0 && (await commCount()) === 1, t6d.result.summary);

    // ---- run 7: DELETE-FAILURE RETRY — blocked emptied-comm delete is gate-visible, next run converges
    console.log("T29 run 7 (emptied-comm delete failure rejects loudly, then retries to convergence):");
    const k3Id = ct4CommRows[0]?.id;
    const uuidOk = typeof k3Id === "string" && /^[0-9a-f-]{36}$/i.test(k3Id);
    check("run 7 precondition: converged comm id known", uuidOk, k3Id);
    if (uuidOk) {
      // Repoint BOTH nids c2→c1 in one run. Processing order (ct1 first)
      // makes ct1 split off to a fresh c1 comm; ct4 — by then the LAST ref
      // on the c2 comm — must delete it before adopting ct1's new comm. A
      // temporary trigger blocks exactly that delete.
      await db.execute(sql`DELETE FROM s1_staging.id_map WHERE entity = 'contact' AND s1_id IN (${N.ct1}, ${N.ct4})`);
      await putMapping("contact", N.ct1, c1, { stub: false, loader: "smoke" });
      await putMapping("contact", N.ct4, c1, { stub: false, loader: "smoke" });
      await db.execute(sql.raw(
        `CREATE OR REPLACE FUNCTION t29_smoke_block_delete() RETURNS trigger AS $$
         BEGIN RAISE EXCEPTION 't29 smoke: comm delete blocked'; END $$ LANGUAGE plpgsql`,
      ));
      await db.execute(sql.raw(
        `CREATE TRIGGER t29_smoke_block_delete BEFORE DELETE ON comm FOR EACH ROW
           WHEN (OLD.id = '${k3Id}') EXECUTE FUNCTION t29_smoke_block_delete()`,
      ));
      const t7a = runLoader(["--allow-rejects", "contact_unmapped"]);
      check("t7a exits 1 — failed cleanup is gate-visible", t7a.status === 1, t7a.status);
      check(
        "t7a update_failed rejected and disallowed",
        t7a.result.rejectGate?.counts?.update_failed === 1 && t7a.result.rejectGate?.status === "fail",
        t7a.result.rejectGate,
      );
      const map7a = await getMappings(ENTITY, [N.ct1, N.ct4]);
      check("t7a ct1 split to a new c1 comm", Boolean(map7a.get(N.ct1)?.s2Id) && map7a.get(N.ct1)?.s2Id !== k3Id, map7a.get(N.ct1)?.s2Id);
      check("t7a ct4 mapping still on the old comm", map7a.get(N.ct4)?.s2Id === k3Id, map7a.get(N.ct4)?.s2Id);
      check("t7a old comm intact (delete blocked)", (await rows<{ id: string }>(sql`SELECT id FROM comm WHERE id = ${k3Id}`)).length === 1);
      // unblock and re-run: the rejected row retries the whole split
      await db.execute(sql.raw(`DROP TRIGGER IF EXISTS t29_smoke_block_delete ON comm`));
      await db.execute(sql.raw(`DROP FUNCTION IF EXISTS t29_smoke_block_delete()`));
      const t7b = runLoader(["--allow-rejects", "contact_unmapped"]);
      check("t7b exit 0", t7b.status === 0, t7b.status);
      check(
        "t7b retried: updated 1, emptied comm deleted",
        t7b.result.summary?.updated === 1 && t7b.result.detail?.emptiedCommsDeleted === 1,
        { summary: t7b.result.summary, emptied: t7b.result.detail?.emptiedCommsDeleted },
      );
      const map7b = await getMappings(ENTITY, [N.ct1, N.ct4]);
      check(
        "t7b both nids converged on ct1's c1 comm",
        map7b.get(N.ct1)?.s2Id === map7a.get(N.ct1)?.s2Id && map7b.get(N.ct4)?.s2Id === map7a.get(N.ct1)?.s2Id,
        [map7b.get(N.ct1)?.s2Id, map7b.get(N.ct4)?.s2Id],
      );
      check("t7b old comm gone", (await rows<{ id: string }>(sql`SELECT id FROM comm WHERE id = ${k3Id}`)).length === 0);
      check("t7b exactly 1 comm remains", (await commCount()) === 1);
      const t7c = runLoader(["--allow-rejects", "contact_unmapped"]);
      check("t7c stable (unchanged 2, no writes)", t7c.result.summary?.unchanged === 2 && t7c.result.summary?.updated === 0, t7c.result.summary);
    }
  } finally {
    // ---- cleanup (best-effort, loud on error) -------------------------------
    console.log("cleanup:");
    const steps: Array<[string, ReturnType<typeof sql>]> = [
      ["delete-block trigger", sql.raw(`DROP TRIGGER IF EXISTS t29_smoke_block_delete ON comm`)],
      ["delete-block function", sql.raw(`DROP FUNCTION IF EXISTS t29_smoke_block_delete()`)],
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
