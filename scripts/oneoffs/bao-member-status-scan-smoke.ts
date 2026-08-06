/**
 * Smoke test for the BAO member status scan (server/services/bao-member-status-scan.ts).
 *
 * Seeds a self-contained scenario set inside a single transaction — fresh TEST
 * industries so the scan (which derives target industries from the coded
 * status options) only ever sees the seeded workers — runs test mode, live
 * mode, and a rerun, asserts the outcomes, then ROLLS BACK. No data survives.
 *
 * Run: npx tsx scripts/oneoffs/bao-member-status-scan-smoke.ts
 */
import { runInTransaction, getClient } from "../../server/storage/transaction-context";
import { scanBaoMemberStatuses } from "../../server/services/bao-member-status-scan";
import { sql } from "drizzle-orm";

class Rollback extends Error {}

let failures = 0;
function check(label: string, cond: boolean, detail?: unknown) {
  if (cond) console.log(`  PASS ${label}`);
  else {
    failures++;
    console.error(`  FAIL ${label}`, detail ?? "");
  }
}

async function one(q: ReturnType<typeof sql>): Promise<any> {
  const res = await getClient().execute(q);
  return res.rows?.[0];
}

async function main() {
  try {
    await runInTransaction(async () => {
      const c = getClient();

      // --- seed vocabularies ---
      const ecInd = (await one(sql`INSERT INTO options_industries (name, code) VALUES ('TEST Event Center', 'ZEC') RETURNING id`)).id;
      const hInd = (await one(sql`INSERT INTO options_industries (name, code) VALUES ('TEST Hospitality', 'ZH') RETURNING id`)).id;

      const opt = async (name: string, code: string, ind: string) =>
        (await one(sql`INSERT INTO options_worker_ms (name, code, industry_id) VALUES (${name}, ${code}, ${ind}) RETURNING id`)).id;
      const ec100 = await opt("TEST EC 100", "EC100", ecInd);
      const ec80 = await opt("TEST EC 80", "EC80", ecInd);
      const ec60 = await opt("TEST EC 60", "EC60", ecInd);
      const h60 = await opt("TEST H 60", "H60", hInd);
      const h40 = await opt("TEST H 40", "H40", hInd);
      await opt("TEST PA", "P100", ecInd); // manual, unheld — just must not break resolution

      const empRow = await one(sql`SELECT id FROM options_employment_status WHERE employed = true LIMIT 1`);
      const unempRow = await one(sql`SELECT id FROM options_employment_status WHERE employed = false LIMIT 1`);
      const employedEs = empRow.id;
      const unemployedEs = unempRow.id;

      const emp = async (name: string, ind: string) =>
        (await one(sql`INSERT INTO employers (name, industry_id) VALUES (${name}, ${ind}) RETURNING id`)).id;
      const ecEmp = await emp("TEST EC Employer", ecInd);
      const hEmp = await emp("TEST H Employer", hInd);

      const mkWorker = async (label: string) => {
        const contact = await one(sql`INSERT INTO contacts (given, family, display_name) VALUES ('Test', ${label}, ${"Test " + label}) RETURNING id`);
        return (await one(sql`INSERT INTO workers (contact_id) VALUES (${contact.id}) RETURNING id`)).id;
      };
      const hours = (w: string, e: string, y: number, m: number, es: string, h = 40) =>
        c.execute(sql`INSERT INTO worker_hours (year, month, day, worker_id, employer_id, employment_status_id, hours) VALUES (${y}, ${m}, 1, ${w}, ${e}, ${es}, ${h})`);
      const msh = (w: string, ind: string, ms: string, date: string) =>
        c.execute(sql`INSERT INTO worker_msh (date, worker_id, ms_id, industry_id) VALUES (${date}, ${w}, ${ms}, ${ind})`);

      // W1: new EC worker → EC100 at first-hours date (2026-03-01)
      const w1 = await mkWorker("W1");
      await hours(w1, ecEmp, 2026, 3, employedEs);
      // W2: EC since 2020-01, still employed, no status → EC100 + EC80 upgrade in one run
      const w2 = await mkWorker("W2");
      await hours(w2, ecEmp, 2020, 1, employedEs);
      await hours(w2, ecEmp, 2026, 7, employedEs);
      // W3: holds EC100 since 2020-02, still employed → upgrade to EC80 at 2025-02-01
      const w3 = await mkWorker("W3");
      await hours(w3, ecEmp, 2020, 2, employedEs);
      await hours(w3, ecEmp, 2026, 7, employedEs);
      await msh(w3, ecInd, ec100, "2020-02-01");
      // W4: holds EC100 since 2019, but latest hours NOT employed → no upgrade
      const w4 = await mkWorker("W4");
      await hours(w4, ecEmp, 2019, 5, employedEs);
      await hours(w4, ecEmp, 2024, 12, unemployedEs);
      await msh(w4, ecInd, ec100, "2019-05-01");
      // W5: grandfathered EC60 (manual) → untouched
      const w5 = await mkWorker("W5");
      await hours(w5, ecEmp, 2018, 1, employedEs);
      await hours(w5, ecEmp, 2026, 7, employedEs);
      await msh(w5, ecInd, ec60, "2018-01-01");
      // W6: new Hospitality worker → H60 at 2026-05-01
      const w6 = await mkWorker("W6");
      await hours(w6, hEmp, 2026, 5, employedEs);
      // W7: holds manual H40 → untouched
      const w7 = await mkWorker("W7");
      await hours(w7, hEmp, 2020, 1, employedEs);
      await msh(w7, hInd, h40, "2020-01-01");

      // --- test mode: reports, writes nothing ---
      const t = await scanBaoMemberStatuses("test");
      console.log("test-mode result:", JSON.stringify({ ...t, pending: t.pending }));
      check("test: 2 EC100 set", t.ec100Set === 2, t);
      check("test: 2 EC80 upgrades (W2 same-run + W3)", t.ec80Upgraded === 2, t);
      check("test: 1 H60 set", t.h60Set === 1, t);
      check("test: 2 skipped manual (W5, W7)", t.skippedManual === 2, t);
      check("test: no errors", t.errors === 0, t);
      const cnt = async () => Number((await one(sql`SELECT count(*) AS n FROM worker_msh WHERE industry_id IN (${ecInd}, ${hInd})`)).n);
      check("test: no msh rows written", (await cnt()) === 4);

      // --- live mode ---
      const l = await scanBaoMemberStatuses("live");
      check("live: 2 EC100 set", l.ec100Set === 2, l);
      check("live: 2 EC80 upgrades", l.ec80Upgraded === 2, l);
      check("live: 1 H60 set", l.h60Set === 1, l);
      check("live: no errors", l.errors === 0, l);

      const cur = async (w: string, ind: string) =>
        (await one(sql`SELECT ms_id, date FROM worker_msh WHERE worker_id = ${w} AND industry_id = ${ind} ORDER BY date DESC, created_at DESC NULLS LAST, id DESC LIMIT 1`));
      const w1s = await cur(w1, ecInd);
      check("W1 → EC100 @ 2026-03-01", w1s?.ms_id === ec100 && String(w1s.date).startsWith("2026-03-01"), w1s);
      const w2s = await cur(w2, ecInd);
      check("W2 → EC80 @ 2025-01-01 (5y anniversary)", w2s?.ms_id === ec80 && String(w2s.date).startsWith("2025-01-01"), w2s);
      const w2first = await one(sql`SELECT ms_id FROM worker_msh WHERE worker_id = ${w2} AND ms_id = ${ec100}`);
      check("W2 also has EC100 history row", !!w2first);
      const w3s = await cur(w3, ecInd);
      check("W3 → EC80 @ 2025-02-01", w3s?.ms_id === ec80 && String(w3s.date).startsWith("2025-02-01"), w3s);
      const w4s = await cur(w4, ecInd);
      check("W4 (not employed) stays EC100", w4s?.ms_id === ec100, w4s);
      const w5s = await cur(w5, ecInd);
      check("W5 keeps grandfathered EC60", w5s?.ms_id === ec60, w5s);
      const w6s = await cur(w6, hInd);
      check("W6 → H60 @ 2026-05-01", w6s?.ms_id === h60 && String(w6s.date).startsWith("2026-05-01"), w6s);
      const w7s = await cur(w7, hInd);
      check("W7 keeps manual H40", w7s?.ms_id === h40, w7s);
      const autoMarked = await one(sql`SELECT count(*) AS n FROM worker_msh WHERE industry_id IN (${ecInd}, ${hInd}) AND data->>'source' = 'auto-scan'`);
      check("all 5 written rows marked source=auto-scan", Number(autoMarked.n) === 5, autoMarked);

      // --- rerun: idempotent ---
      const before = await cnt();
      const r = await scanBaoMemberStatuses("live");
      check("rerun: nothing set", r.ec100Set === 0 && r.ec80Upgraded === 0 && r.h60Set === 0, r);
      check("rerun: no new msh rows", (await cnt()) === before);
      check("rerun: no errors", r.errors === 0, r);

      throw new Rollback();
    });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }

  console.log(failures === 0 ? "\nALL CHECKS PASSED (rolled back)" : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("Smoke test crashed:", e);
  process.exit(1);
});
