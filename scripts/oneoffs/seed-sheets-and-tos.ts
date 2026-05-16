/**
 * One-off: seed EDLS sheets, crews, assignments, and worker TOS records.
 *
 * Creates ~100 EDLS sheets dated between 2026-04-18 and 2026-06-01 for the
 * configured EDLS employer, with 1-4 crews each summing to 5-50 slots.
 * Assigns workers from the active EDLS pool with varying fill rates while
 * respecting the per-day unique worker constraint. After sheets, generates
 * worker_tos records: ~50% of workers get at least one TOS record, ~20% have
 * a currently-active (open-ended) TOS.
 *
 * Usage:
 *   npx tsx scripts/oneoffs/seed-sheets-and-tos.ts
 */

import { storage } from "../../server/storage/database";
import { db } from "../../server/storage/db";
import {
  optionsDepartment,
  workerEdls,
  workers,
  type Worker,
} from "../../shared/schema";
import { eq } from "drizzle-orm";

const SHEET_TITLES = [
  "Morning Crew", "Afternoon Crew", "Evening Crew", "Day Shift", "Night Shift",
  "Loading Detail", "Maintenance Crew", "Setup Team", "Breakdown Crew", "Logistics Detail",
  "Yard Crew", "Dock Crew", "Warehouse Detail", "Site Prep", "Cleanup Crew",
  "Special Project", "Heavy Equipment", "Light Duty", "General Labor", "Skilled Trades",
  "Event Setup", "Event Breakdown", "Stagehand Crew", "Rigging Detail", "AV Crew",
  "Security Detail", "Safety Crew", "Quality Inspection", "Material Handling", "Truck Crew",
];

const CREW_TITLES = [
  "Alpha Team", "Bravo Team", "Charlie Team", "Delta Team", "Echo Team",
  "Loading Squad", "Setup Squad", "Cleanup Squad", "Skilled Crew", "Support Crew",
  "Lead Crew", "Backup Crew", "Heavy Crew", "Light Crew", "Day Crew",
];

const LOCATIONS = [
  "North Yard", "South Yard", "East Dock", "West Dock", "Main Warehouse",
  "Loading Bay 1", "Loading Bay 2", "Site A", "Site B", "Customer Site",
  "Downtown", "Industrial Park", "Harbor", "Convention Center", "Stadium",
];

const STATUSES = ["draft", "request", "lock"] as const;

const START_DATE = new Date("2026-04-18T00:00:00Z");
const END_DATE = new Date("2026-06-01T00:00:00Z");
const NUM_SHEETS = 100;

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function ymdBetween(start: Date, end: Date): string {
  const days = Math.floor((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
  const offset = randInt(0, days);
  const d = new Date(start.getTime() + offset * 24 * 60 * 60 * 1000);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function timeStr(hour: number, minute = 0): string {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00`;
}

function partition(total: number, parts: number): number[] {
  // Random partition of `total` into `parts` positive integers (each >= 1).
  if (parts === 1) return [total];
  if (total < parts) parts = total;
  const cuts = new Set<number>();
  while (cuts.size < parts - 1) {
    cuts.add(randInt(1, total - 1));
  }
  const sorted = [...cuts].sort((a, b) => a - b);
  const result: number[] = [];
  let prev = 0;
  for (const c of sorted) {
    result.push(c - prev);
    prev = c;
  }
  result.push(total - prev);
  return result;
}

async function main() {
  console.log("=== Seeding EDLS sheets and worker TOS ===");

  const variable = await storage.variables.getByName("edls_settings");
  if (!variable?.value) {
    console.error("EDLS settings not configured. Aborting.");
    process.exit(1);
  }
  const parsedSettings = typeof variable.value === "string"
    ? JSON.parse(variable.value as string)
    : variable.value;
  const employerId: string | null = parsedSettings?.employer ?? null;
  if (!employerId) {
    console.error("EDLS settings has no employer. Aborting.");
    process.exit(1);
  }

  const employer = await storage.employers.getEmployer(employerId);
  if (!employer) {
    console.error("Configured EDLS employer not found.");
    process.exit(1);
  }
  console.log(`Employer: ${employer.name}`);

  const departments = await db.select().from(optionsDepartment);
  if (departments.length === 0) {
    console.error("No departments found.");
    process.exit(1);
  }

  // Active EDLS workers from the configured employer's pool.
  const activeRows = await db
    .select({ worker: workers })
    .from(workers)
    .innerJoin(workerEdls, eq(workerEdls.workerId, workers.id))
    .where(eq(workerEdls.active, true));
  const employerWorkers: Worker[] = activeRows
    .map((r) => r.worker)
    .filter((w) => w.denormHomeEmployerId === employer.id);
  console.log(`Active EDLS workers for employer: ${employerWorkers.length}`);

  if (employerWorkers.length === 0) {
    console.error("No active EDLS workers for this employer.");
    process.exit(1);
  }

  const allWorkers = await storage.workers.getAllWorkers();
  console.log(`All workers in system: ${allWorkers.length}`);

  // Track which workers are already assigned per date (unique-per-day constraint).
  const assignedByDate = new Map<string, Set<string>>();

  let sheetsCreated = 0;
  let crewsCreated = 0;
  let assignmentsCreated = 0;
  const usedTitles = new Set<string>();

  for (let i = 0; i < NUM_SHEETS; i++) {
    const ymd = ymdBetween(START_DATE, END_DATE);
    const status = pick(STATUSES as unknown as string[]);
    const department = pick(departments);

    let title = pick(SHEET_TITLES);
    let suffix = 1;
    while (usedTitles.has(`${title}-${ymd}`)) {
      suffix++;
      title = `${pick(SHEET_TITLES)} ${suffix}`;
    }
    usedTitles.add(`${title}-${ymd}`);

    const totalSlots = randInt(5, 50);
    const numCrews = Math.min(randInt(1, 4), totalSlots);
    const counts = partition(totalSlots, numCrews);

    const usedCrewTitles = new Set<string>();
    const crews = counts.map((workerCount) => {
      let crewTitle = pick(CREW_TITLES);
      let s = 1;
      while (usedCrewTitles.has(crewTitle)) {
        crewTitle = `${pick(CREW_TITLES)} ${s++}`;
      }
      usedCrewTitles.add(crewTitle);
      const startHour = randInt(5, 14);
      const endHour = Math.min(startHour + randInt(4, 10), 23);
      return {
        title: crewTitle,
        workerCount,
        location: Math.random() > 0.3 ? pick(LOCATIONS) : null,
        startTime: timeStr(startHour),
        endTime: timeStr(endHour),
        supervisor: null,
        taskId: null,
      };
    });

    let sheet;
    try {
      sheet = await storage.edlsSheets.create(
        {
          employerId: employer.id,
          departmentId: department.id,
          title,
          ymd,
          workerCount: totalSlots,
          status,
        },
        crews,
      );
    } catch (err) {
      console.error(`Failed to create sheet "${title}" on ${ymd}:`, err);
      continue;
    }

    sheetsCreated++;
    crewsCreated += crews.length;

    // Pick a fill rate for this sheet.
    const fillRate = Math.random() < 0.25 ? 1.0 : randInt(30, 100) / 100;

    if (!assignedByDate.has(ymd)) assignedByDate.set(ymd, new Set());
    const taken = assignedByDate.get(ymd)!;
    const available = shuffle(employerWorkers.filter((w) => !taken.has(w.id)));

    let cursor = 0;
    let sheetAssignments = 0;
    for (const crew of sheet.crews) {
      const target = Math.floor(crew.workerCount * fillRate);
      for (let k = 0; k < target && cursor < available.length; k++) {
        const worker = available[cursor++];
        try {
          await storage.edlsAssignments.create({
            crewId: crew.id,
            workerId: worker.id,
            ymd,
          });
          taken.add(worker.id);
          assignmentsCreated++;
          sheetAssignments++;
        } catch {
          // crew full, dup, etc — skip silently
        }
      }
    }

    if ((i + 1) % 10 === 0) {
      console.log(
        `  [${i + 1}/${NUM_SHEETS}] ${ymd} "${title}" (${status}) crews=${crews.length} slots=${totalSlots} filled=${sheetAssignments}`,
      );
    }
  }

  console.log("\n=== Seeding worker TOS ===");

  // TOS pass: ~50% have any TOS, ~20% are currently active.
  const today = new Date();
  const shuffled = shuffle(allWorkers);
  const totalWorkers = shuffled.length;
  const targetActive = Math.round(totalWorkers * 0.2);
  const targetAny = Math.round(totalWorkers * 0.5);

  let workersWithActive = 0;
  let workersWithAny = 0;
  let tosRecordsCreated = 0;

  // First chunk: active TOS (open record).
  const activeGroup = shuffled.slice(0, targetActive);
  // Next chunk: only historical closed records.
  const historicalGroup = shuffled.slice(targetActive, targetAny);

  for (const w of activeGroup) {
    // start: random 1-90 days ago
    const daysAgo = randInt(1, 90);
    const startDate = new Date(today.getTime() - daysAgo * 86400000);
    try {
      await storage.workerTos.create({
        workerId: w.id,
        startDate,
        endDate: null,
        description: pick(["Vacation", "Medical leave", "Personal", "Family", null]),
      });
      tosRecordsCreated++;
      workersWithActive++;
      workersWithAny++;
    } catch (err) {
      // ignore conflicts (worker already has active TOS) or constraint errors
    }
  }

  for (const w of historicalGroup) {
    const numHistorical = randInt(1, 3);
    let createdForWorker = 0;
    // generate non-overlapping past windows; walk backwards from ~30 days ago
    let cursor = new Date(today.getTime() - randInt(30, 60) * 86400000);
    for (let n = 0; n < numHistorical; n++) {
      const lengthDays = randInt(2, 30);
      const endDate = new Date(cursor);
      const startDate = new Date(endDate.getTime() - lengthDays * 86400000);
      // ensure both in the past and end > start
      if (startDate.getTime() >= endDate.getTime() || endDate.getTime() > today.getTime()) break;
      try {
        await storage.workerTos.create({
          workerId: w.id,
          startDate,
          endDate,
          description: pick(["Vacation", "Medical leave", "Personal", "Family", null]),
        });
        tosRecordsCreated++;
        createdForWorker++;
      } catch {
        // skip
      }
      // step further back with a gap
      cursor = new Date(startDate.getTime() - randInt(5, 30) * 86400000);
    }
    if (createdForWorker > 0) workersWithAny++;
  }

  console.log("\n=== Summary ===");
  console.log(`Sheets created       : ${sheetsCreated}`);
  console.log(`Crews created        : ${crewsCreated}`);
  console.log(`Assignments created  : ${assignmentsCreated}`);
  console.log(`Workers with any TOS : ${workersWithAny} / ${totalWorkers}`);
  console.log(`Workers with active  : ${workersWithActive} / ${totalWorkers}`);
  console.log(`Total TOS records    : ${tosRecordsCreated}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Script failed:", err);
    process.exit(1);
  });
