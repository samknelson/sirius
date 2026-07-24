import { storage } from "../../server/storage/database";

const KAISER_BENEFIT_ID = "b30b66ff-c52c-41a3-a0e3-e7fd20394f75";
const EMPLOYER_ID = "3f8047ed-ec51-4bfd-b57d-7d54139a967c"; // TEST EVENT CENTER

const WORKERS = [
  { id: "e6c932e7-e247-4e58-a7cb-8cf110280b03", name: "Alice Alvarez" },
  { id: "f5e22d09-7a9d-44ab-b2e5-e0ab55068def", name: "Ben Booker" },
  { id: "931879b1-3d15-4a27-a09c-967a705f730c", name: "Diego Dominguez" },
];

const MONTHS: Array<{ year: number; month: number }> = [
  { year: 2026, month: 4 },
  { year: 2026, month: 5 },
  { year: 2026, month: 6 },
  { year: 2026, month: 7 },
];

async function main() {
  for (const worker of WORKERS) {
    const existing = await storage.trust.wmb.getWorkerBenefits(worker.id);
    for (const { year, month } of MONTHS) {
      const dupe = existing.find(
        (r) => r.benefitId === KAISER_BENEFIT_ID && r.year === year && r.month === month,
      );
      if (dupe) {
        console.log(`skip ${worker.name} ${year}-${month} (exists)`);
        continue;
      }
      const row = await storage.trust.wmb.createWorkerBenefit({
        workerId: worker.id,
        month,
        year,
        employerId: EMPLOYER_ID,
        benefitId: KAISER_BENEFIT_ID,
      });
      console.log(`created ${worker.name} ${year}-${month} wmb=${row.id}`);
    }
  }
  console.log("done");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
