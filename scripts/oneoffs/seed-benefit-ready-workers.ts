/**
 * One-off: seed workers at each employer ("location") with enough hours
 * history to be eligible to enroll in benefits.
 *
 * Eligibility context: the "start" (enrollment) rule for every benefit is the
 * sitespecific-bao-buildup plugin configured with lagMonths=3,
 * buildupMonths=3, defaultThreshold=100. Enrolling as of July 2026 therefore
 * requires >= 100 hours in each of 3 consecutive months ending April 2026
 * (July minus 3-month lag). To be robust for any as-of month in the near
 * future, each worker gets 8 months of history (Nov 2025 .. Jun 2026) at
 * 120-160 hours/month, all above threshold.
 *
 * Creates 3 workers at each of the 3 employers, with SSN and "Active"
 * employment status. Idempotent: workers are looked up by display name and
 * reused; hours are created via upsert.
 *
 * Usage: npx tsx scripts/oneoffs/seed-benefit-ready-workers.ts
 */

import { storage } from "../../server/storage/database";

const ACTIVE_STATUS_ID = "46487fff-698d-4031-b9da-1846a09ef986"; // options_employment_status "Active"

const EMPLOYERS: { id: string; name: string; workers: string[] }[] = [
  {
    id: "3f8047ed-ec51-4bfd-b57d-7d54139a967c",
    name: "TEST EVENT CENTER",
    workers: ["Alice Alvarez", "Ben Booker", "Carla Chen"],
  },
  {
    id: "9a80c1c5-7d46-4124-adc4-4be57375c5ee",
    name: "TEST HOTEL",
    workers: ["Diego Dominguez", "Erin Edwards", "Frank Fischer"],
  },
  {
    id: "93064023-1f33-4f69-963f-4c16b52db647",
    name: "TEST IE EMPLOYER",
    workers: ["Grace Gallo", "Hank Harmon", "Isabel Ibarra"],
  },
];

// Months of hours history, oldest first: Nov 2025 .. Jun 2026.
const MONTHS: { year: number; month: number }[] = [
  { year: 2025, month: 11 },
  { year: 2025, month: 12 },
  { year: 2026, month: 1 },
  { year: 2026, month: 2 },
  { year: 2026, month: 3 },
  { year: 2026, month: 4 },
  { year: 2026, month: 5 },
  { year: 2026, month: 6 },
];

function ssnFor(index: number): string {
  // Deterministic fake SSNs, clearly test-looking but valid format.
  const serial = String(1000 + index).padStart(4, "0");
  return `520-55-${serial}`;
}

function hoursFor(workerIndex: number, monthIndex: number): number {
  // 120-160, varies a little per worker/month, always >= 100 threshold.
  return 120 + ((workerIndex * 7 + monthIndex * 5) % 41);
}

async function findOrCreateWorker(name: string): Promise<string> {
  const found = await storage.workers.searchWorkers(name, 10);
  const exact = found.workers.find((w) => w.displayName === name);
  if (exact) return exact.id;
  const created = await storage.workers.createWorker(name);
  return created.id;
}

async function main(): Promise<void> {
  let workerIndex = 0;
  for (const employer of EMPLOYERS) {
    console.log(`\n=== ${employer.name} (${employer.id}) ===`);
    for (const name of employer.workers) {
      workerIndex++;
      const workerId = await findOrCreateWorker(name);
      await storage.workers.updateWorkerSSN(workerId, ssnFor(workerIndex));

      let monthIndex = 0;
      for (const { year, month } of MONTHS) {
        monthIndex++;
        const hours = hoursFor(workerIndex, monthIndex);
        await storage.workerHours.upsertWorkerHours({
          workerId,
          year,
          month,
          employerId: employer.id,
          employmentStatusId: ACTIVE_STATUS_ID,
          hours,
          home: true,
        });
      }
      console.log(
        `  ${name} (${workerId}) — ${MONTHS.length} months of hours (Nov 2025..Jun 2026, all >= 120)`,
      );
    }
  }

  console.log(
    "\nDone. Each worker satisfies the bao-buildup start rule (3 consecutive" +
      "\nmonths >= 100 hours, lagged 3 months) for enrollments as of mid-2026.",
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
