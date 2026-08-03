/**
 * One-time reconciliation for legacy BAO premium charges keyed to DEPENDENT
 * workers (created before the subscriber-only rework).
 *
 * For every `sitespecific-bao-premium` ledger entry whose (workerId, benefit,
 * month) corresponds to a dependent WMB row (source_relation_id set):
 *   - If the entry's month has already been swept into a premium file for
 *     that worker: report it and leave it (deleting would unbalance the
 *     settled payment) — manual review.
 *   - Otherwise: delete the dependent-keyed entry and re-fire the charge
 *     plugins for the dependent WMB row, which now recomputes the
 *     SUBSCRIBER's charge (tier from live WMB rows).
 *
 * Usage:
 *   npx tsx scripts/oneoffs/reconcile-bao-premium-dependent-charges.ts          # dry run
 *   npx tsx scripts/oneoffs/reconcile-bao-premium-dependent-charges.ts --live   # apply
 */
import { storage } from "../../server/storage/database";
import { getClient } from "../../server/storage/transaction-context";
import { sql } from "drizzle-orm";

const LIVE = process.argv.includes("--live");

async function main() {
  await import("../../server/plugins/ledger/charge/plugins/sitespecific-bao-premium");
  const { executeChargePlugins, TriggerType } = await import(
    "../../server/plugins/ledger/charge"
  );

  const client = getClient();
  // Legacy dependent-keyed charges: the charge's workerId has a dependent
  // (relation-sourced) WMB row for the same benefit/month.
  const result = await client.execute(sql`
    SELECT l.id, l.charge_plugin_key, l.ea_id, l.amount,
           l.data->>'workerId' AS worker_id,
           l.data->>'benefitId' AS benefit_id,
           (l.data->>'benefitYear')::int AS year,
           (l.data->>'benefitMonth')::int AS month,
           w.id AS wmb_id, w.employer_id, w.source_relation_id
    FROM ledger l
    JOIN trust_wmb w
      ON w.worker_id = l.data->>'workerId'
     AND w.benefit_id = l.data->>'benefitId'
     AND w.year = (l.data->>'benefitYear')::int
     AND w.month = (l.data->>'benefitMonth')::int
     AND w.source_relation_id IS NOT NULL
    WHERE l.charge_plugin = 'sitespecific-bao-premium'
    ORDER BY l.charge_plugin_key
  `);
  const rows = (result.rows ?? []) as Array<{
    id: string; charge_plugin_key: string; ea_id: string; amount: string;
    worker_id: string; benefit_id: string; year: number; month: number;
    wmb_id: string; employer_id: string; source_relation_id: string;
  }>;

  console.log(`Found ${rows.length} legacy dependent-keyed premium entries (${LIVE ? "LIVE" : "dry run"})`);

  let deleted = 0, sweptSkipped = 0;
  const refire = new Map<string, (typeof rows)[number]>();

  for (const row of rows) {
    const statementYmd = `${row.year}-${String(row.month).padStart(2, "0")}-01`;
    const swept = await storage.baoPremiumFiles.isMonthSwept(
      row.ea_id, row.worker_id, row.benefit_id, statementYmd,
    );
    if (swept) {
      sweptSkipped++;
      console.log(`SWEPT (manual review): entry ${row.id} key=${row.charge_plugin_key} amount=${row.amount}`);
      continue;
    }
    console.log(`${LIVE ? "DELETE" : "would delete"}: entry ${row.id} key=${row.charge_plugin_key} amount=${row.amount}`);
    if (LIVE) {
      await storage.ledger.entries.deleteByChargePluginKey("sitespecific-bao-premium", row.charge_plugin_key);
      deleted++;
    }
    refire.set(row.wmb_id, row);
  }

  if (LIVE) {
    // Re-fire the dependent WMB rows so the subscriber's charge is recomputed
    // (and any remaining legacy entries for other configs are self-healed).
    for (const row of refire.values()) {
      const r = await executeChargePlugins({
        trigger: TriggerType.WMB_SAVED,
        wmbId: row.wmb_id,
        workerId: row.worker_id,
        employerId: row.employer_id,
        benefitId: row.benefit_id,
        year: row.year,
        month: row.month,
        sourceRelationId: row.source_relation_id,
      });
      console.log(
        `refired wmb ${row.wmb_id}: ${r.executed.map((e: any) => `${e.pluginId}:${e.success ? "ok" : e.error}`).join(",")}`,
      );
    }
  }

  console.log(`Done. deleted=${deleted} sweptSkipped=${sweptSkipped} refired=${LIVE ? refire.size : 0}`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
