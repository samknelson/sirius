import { storage } from "../../server/storage/database";

const KAISER_BENEFIT_ID = "b30b66ff-c52c-41a3-a0e3-e7fd20394f75";
const WORKER_IDS = [
  "e6c932e7-e247-4e58-a7cb-8cf110280b03",
  "f5e22d09-7a9d-44ab-b2e5-e0ab55068def",
  "931879b1-3d15-4a27-a09c-967a705f730c",
];

async function main() {
  await import("../../server/plugins/ledger/charge/plugins/sitespecific-bao-premium");
  const { executeChargePlugins, TriggerType } = await import(
    "../../server/plugins/ledger/charge"
  );

  for (const workerId of WORKER_IDS) {
    const wmbs = await storage.trust.wmb.getWorkerBenefits(workerId);
    for (const wmb of wmbs) {
      if (wmb.benefitId !== KAISER_BENEFIT_ID || wmb.year !== 2026) continue;
      const result = await executeChargePlugins({
        trigger: TriggerType.WMB_SAVED,
        wmbId: wmb.id,
        workerId,
        employerId: wmb.employerId,
        benefitId: wmb.benefitId,
        year: wmb.year,
        month: wmb.month,
      });
      console.log(
        `${workerId} ${wmb.year}-${wmb.month}: ${result.totalTransactions.length} entries`,
        result.executed.map((e) => `${e.pluginId}:${e.success ? "ok" : e.error}`).join(","),
      );
    }
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
