/**
 * Backfill Active Work Status for Workers
 * 
 * This script connects to the database and ensures every worker has at least
 * one work status history entry. For workers without any history, it creates
 * an "Active" status entry with effective date 2010-01-01.
 * 
 * Usage:
 *   npx tsx scripts/backfill-worker-wsh-active.ts [--dry-run]
 * 
 * Options:
 *   --dry-run  Show what would be done without making changes
 * 
 * The script is idempotent - running it multiple times will not create duplicates.
 */

import { db } from "../server/db";
import { storage } from "../server/storage";
import { workers, workerWsh, optionsWorkerWs } from "../shared/schema";
import { eq, sql, isNull, notInArray } from "drizzle-orm";

const ACTIVE_STATUS_ID = "ws-active";
const ACTIVE_STATUS_NAME = "Active";
const EFFECTIVE_DATE = "2010-01-01";

async function ensureActiveStatusExists(): Promise<string> {
  const existing = await db
    .select()
    .from(optionsWorkerWs)
    .where(eq(optionsWorkerWs.id, ACTIVE_STATUS_ID));

  if (existing.length > 0) {
    console.log(`[OK] Active status already exists: ${ACTIVE_STATUS_ID}`);
    return ACTIVE_STATUS_ID;
  }

  console.log(`[CREATE] Creating Active work status option...`);
  const [created] = await db
    .insert(optionsWorkerWs)
    .values({
      id: ACTIVE_STATUS_ID,
      name: ACTIVE_STATUS_NAME,
      description: "Active work status",
      sequence: 0,
    })
    .returning();

  console.log(`[OK] Created Active status: ${created.id}`);
  return created.id;
}

async function getWorkersWithoutHistory(): Promise<{ id: string; siriusId: number | null }[]> {
  const workersWithHistory = db
    .selectDistinct({ workerId: workerWsh.workerId })
    .from(workerWsh);

  const workersWithoutHistory = await db
    .select({
      id: workers.id,
      siriusId: workers.siriusId,
    })
    .from(workers)
    .where(
      notInArray(workers.id, workersWithHistory)
    );

  return workersWithoutHistory;
}

async function backfillWorkerWsh(dryRun: boolean): Promise<void> {
  console.log("=".repeat(60));
  console.log("Backfill Active Work Status History");
  console.log("=".repeat(60));
  console.log(`Mode: ${dryRun ? "DRY RUN (no changes will be made)" : "LIVE"}`);
  console.log(`Effective Date: ${EFFECTIVE_DATE}`);
  console.log("");

  const activeStatusId = await ensureActiveStatusExists();

  const workersNeedingHistory = await getWorkersWithoutHistory();
  
  console.log(`\n[INFO] Found ${workersNeedingHistory.length} workers without work status history\n`);

  if (workersNeedingHistory.length === 0) {
    console.log("[OK] All workers already have work status history. Nothing to do.");
    return;
  }

  let created = 0;
  let errors = 0;

  for (const worker of workersNeedingHistory) {
    const label = worker.siriusId ? `Worker #${worker.siriusId}` : worker.id;

    if (dryRun) {
      console.log(`[DRY-RUN] Would create Active status for ${label}`);
      created++;
      continue;
    }

    try {
      await storage.workerWsh.createWorkerWsh({
        workerId: worker.id,
        date: EFFECTIVE_DATE,
        wsId: activeStatusId,
      });
      console.log(`[OK] Created Active status for ${label}`);
      created++;
    } catch (error) {
      console.error(`[ERROR] Failed to create status for ${label}:`, error);
      errors++;
    }
  }

  console.log("\n" + "=".repeat(60));
  console.log("Summary");
  console.log("=".repeat(60));
  console.log(`Workers processed: ${workersNeedingHistory.length}`);
  console.log(`Entries created: ${created}`);
  console.log(`Errors: ${errors}`);

  if (dryRun) {
    console.log("\n[INFO] This was a dry run. No changes were made.");
    console.log("[INFO] Run without --dry-run to apply changes.");
  }
}

async function verifyResults(): Promise<void> {
  console.log("\n" + "=".repeat(60));
  console.log("Verification");
  console.log("=".repeat(60));

  const totalWorkers = await db.select({ count: sql<number>`count(*)` }).from(workers);
  const workersWithHistory = await db
    .selectDistinct({ workerId: workerWsh.workerId })
    .from(workerWsh);

  const totalCount = Number(totalWorkers[0]?.count || 0);
  const withHistoryCount = workersWithHistory.length;

  console.log(`Total workers: ${totalCount}`);
  console.log(`Workers with history: ${withHistoryCount}`);
  console.log(`Workers without history: ${totalCount - withHistoryCount}`);

  if (totalCount === withHistoryCount) {
    console.log("\n[SUCCESS] All workers now have work status history!");
  } else {
    console.log("\n[WARNING] Some workers still don't have work status history.");
  }

  const sample = await db
    .select({
      workerId: workerWsh.workerId,
      date: workerWsh.date,
      wsId: workerWsh.wsId,
      wsName: optionsWorkerWs.name,
    })
    .from(workerWsh)
    .leftJoin(optionsWorkerWs, eq(workerWsh.wsId, optionsWorkerWs.id))
    .limit(5);

  console.log("\nSample work status history entries:");
  for (const entry of sample) {
    console.log(`  - Worker ${entry.workerId}: ${entry.wsName} (${entry.date})`);
  }
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");

  try {
    await backfillWorkerWsh(dryRun);

    if (!dryRun) {
      await verifyResults();
    }

    process.exit(0);
  } catch (error) {
    console.error("\n[FATAL] Script failed:", error);
    process.exit(1);
  }
}

main();
