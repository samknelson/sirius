/**
 * One-off: ensure a worker has a monthly hours total in [MIN_HOURS, MAX_HOURS]
 * for every month in an inclusive range.
 *
 * For each month in the range:
 *  - If the worker has no hours entry for that month, create one (using the
 *    employer / employment status from the worker's most recent existing
 *    entry) with a random total in range.
 *  - If the worker already has entries for that month, edit them so the
 *    month's total lands in range: the first entry is set to the random
 *    target and any additional entries for that month are zeroed.
 *
 * All database access goes through the storage layer.
 *
 * Usage: npx tsx scripts/oneoffs/seed-test-hours-range.ts
 */
import { storage } from "../../server/storage/database";

const WORKER_ID = "d6fea247-89ad-4def-b688-7401b11c2788";
const MIN_HOURS = 110;
const MAX_HOURS = 160;
const START = { year: 2025, month: 1 }; // January 2025
const END = { year: 2026, month: 4 }; // April 2026

function randomHours(): number {
  return Math.floor(Math.random() * (MAX_HOURS - MIN_HOURS + 1)) + MIN_HOURS;
}

function ymKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

async function run() {
  console.log(`Seeding test hours for worker ${WORKER_ID}`);
  console.log(
    `Range: ${ymKey(START.year, START.month)} .. ${ymKey(END.year, END.month)}, target ${MIN_HOURS}-${MAX_HOURS} hrs/month`,
  );

  const existing = await storage.workerHours.getWorkerHours(WORKER_ID);
  console.log(`Worker has ${existing.length} existing hours entries.`);

  // Group existing entries by year-month.
  const byMonth = new Map<string, Array<{ id: string }>>();
  for (const row of existing) {
    const key = ymKey(Number(row.year), Number(row.month));
    const list = byMonth.get(key) ?? [];
    list.push(row);
    byMonth.set(key, list);
  }

  // Reference employer / status / placement for months we have to create.
  // getWorkerHours is ordered year desc, month desc, so the first is most recent.
  const reference = existing[0];

  let created = 0;
  let updated = 0;
  let zeroed = 0;

  const startOrd = START.year * 12 + (START.month - 1);
  const endOrd = END.year * 12 + (END.month - 1);

  for (let ord = startOrd; ord <= endOrd; ord++) {
    const year = Math.floor(ord / 12);
    const month = (ord % 12) + 1;
    const key = ymKey(year, month);
    const target = randomHours();

    const entries = byMonth.get(key);

    if (!entries || entries.length === 0) {
      if (!reference) {
        throw new Error(
          `Cannot create hours for ${key}: worker has no existing entry to copy employer/status from.`,
        );
      }
      await storage.workerHours.createWorkerHours({
        workerId: WORKER_ID,
        year,
        month,
        day: 1,
        employerId: reference.employerId,
        employmentStatusId: reference.employmentStatusId,
        hours: target,
        home: reference.home ?? false,
        jobTitle: reference.jobTitle ?? null,
      });
      created++;
      console.log(`  ${key}: created entry with ${target} hrs`);
    } else {
      // Put the whole target on the first entry; zero out the rest so the
      // month total is exactly the target (in range).
      await storage.workerHours.updateWorkerHours(entries[0].id, { hours: target });
      updated++;
      let zeroedThisMonth = 0;
      for (let i = 1; i < entries.length; i++) {
        await storage.workerHours.updateWorkerHours(entries[i].id, { hours: 0 });
        zeroed++;
        zeroedThisMonth++;
      }
      console.log(
        `  ${key}: set ${target} hrs on 1 entry` +
          (zeroedThisMonth > 0 ? `, zeroed ${zeroedThisMonth} extra entr${zeroedThisMonth === 1 ? "y" : "ies"}` : ""),
      );
    }
  }

  console.log("\n=== Done ===");
  console.log(`Months created: ${created}`);
  console.log(`Months updated: ${updated}`);
  console.log(`Extra entries zeroed: ${zeroed}`);
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
