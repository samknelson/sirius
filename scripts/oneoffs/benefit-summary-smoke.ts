/**
 * Smoke test for the Benefit Summary dashboard plugin's counting logic.
 * Runs the content resolver against real data and cross-checks each count
 * with direct SQL. Usage: npx tsx scripts/oneoffs/benefit-summary-smoke.ts
 */
import { storage } from "../../server/storage";
import { db } from "../../server/storage/db";
import { sql } from "drizzle-orm";
import { benefitSummaryPlugin } from "../../server/plugins/dashboard/plugins/benefit-summary";

async function main() {
  // Pick benefits that actually have coverage this month.
  const now = new Date();
  const m = now.getMonth() + 1;
  const y = now.getFullYear();
  const top = await db.execute(sql`
    SELECT benefit_id, count(distinct worker_id)::int AS c
    FROM trust_wmb GROUP BY benefit_id ORDER BY c DESC LIMIT 3`);
  const benefitIds = (top.rows as any[]).map((r) => r.benefit_id);
  console.log("Testing benefits:", benefitIds);

  const resolver = benefitSummaryPlugin.content as (ctx: any) => Promise<any>;
  const content = await resolver({
    settings: { benefitIds },
    storage,
  });
  console.log("months:", content.months.map((mm: any) => `${mm.key}=${mm.year}-${mm.month}`).join(" "));

  let failures = 0;
  for (const row of content.rows) {
    for (const mm of content.months) {
      const r = await db.execute(sql`
        SELECT count(distinct worker_id)::int AS c FROM trust_wmb
        WHERE benefit_id = ${row.benefitId} AND month = ${mm.month} AND year = ${mm.year}`);
      const expected = Number((r.rows[0] as any).c);
      const got = row.counts[mm.key];
      const ok = expected === got;
      if (!ok) failures++;
      console.log(`${row.benefitName} ${mm.key}: got=${got} expected=${expected} ${ok ? "OK" : "MISMATCH"}`);
    }
    const t = await db.execute(sql`
      SELECT count(distinct worker_id)::int AS c FROM trust_wmb_events
      WHERE benefit_id = ${row.benefitId} AND event_type = 'terminate' AND month = ${m} AND year = ${y}`);
    const expectedLost = Number((t.rows[0] as any).c);
    const ok = expectedLost === row.lostThisMonth;
    if (!ok) failures++;
    console.log(`${row.benefitName} lostThisMonth: got=${row.lostThisMonth} expected=${expectedLost} ${ok ? "OK" : "MISMATCH"}`);
  }

  // Empty-settings case
  const empty = await resolver({ settings: { benefitIds: [] }, storage });
  console.log("empty settings rows:", empty.rows.length, empty.rows.length === 0 ? "OK" : "MISMATCH");

  // Schema resolves with benefit enum
  const schema = await (benefitSummaryPlugin.settingsSchema as () => Promise<any>)();
  const enumLen = schema.properties.benefitIds.items.enum.length;
  console.log("schema benefit options:", enumLen, enumLen > 0 ? "OK" : "MISMATCH");

  console.log(failures === 0 ? "ALL CHECKS PASSED" : `${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
