/**
 * One-off smoke test for grievance timeline adjustments (Task: timeline
 * adjustments on grievance status history). Exercises:
 *  1. storage.grievanceStatusHistory.setTimelineAdjustment (set relative,
 *     set explicit, clear) — verifies data jsonb merge semantics.
 *  2. The grievance_timeline denorm plugin's compute() — verifies the
 *     adjustment shifts/overrides dueYmd and records originalDueYmd.
 *
 * Run: npx tsx scripts/oneoffs/smoke-timeline-adjustment.ts
 */
import { storage } from "../../server/storage";
import { getDenormPlugin } from "../../server/plugins/system/denorm/registry";
import "../../server/plugins/system/denorm/plugins/grievanceTimeline";
import { readTimelineAdjustment } from "../../shared/schema";

function assert(cond: unknown, msg: string): void {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`ok: ${msg}`);
}

async function main() {
  // Find a grievance with a timeline template and at least one status entry
  // that starts a step.
  const grievances = await storage.grievances.search({});
  let target: { grievanceId: string; entryId: string } | null = null;
  for (const g of grievances) {
    if (!g.timelineTemplateId) continue;
    const steps = await storage.grievanceTimelineTemplates.listSteps(g.timelineTemplateId);
    const history = await storage.grievanceStatusHistory.list(g.id);
    for (const step of steps) {
      const fromSet = new Set(step.fromStatuses);
      const start = [...history]
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
        .find((h) => fromSet.has(h.statusId));
      if (start) {
        target = { grievanceId: g.id, entryId: start.id };
        break;
      }
    }
    if (target) break;
  }
  if (!target) {
    console.log("No grievance with a started timeline step found; nothing to smoke-test against.");
    process.exit(2);
  }
  console.log(`Testing against grievance ${target.grievanceId}, entry ${target.entryId}`);

  const plugin = getDenormPlugin("grievance_timeline")!;
  const before = await plugin.compute(target.grievanceId);
  const beforeRow = (before as any).rows.find((r: any) => !r.adjustment);
  assert((before as any).rows.length > 0, "baseline compute has rows");

  // 1) relative +5
  const rel = await storage.grievanceStatusHistory.setTimelineAdjustment(
    target.grievanceId,
    target.entryId,
    { kind: "relative", days: 5 },
  );
  assert(rel, "setTimelineAdjustment(relative) returned row");
  assert(
    readTimelineAdjustment(rel!.data)?.kind === "relative",
    "adjustment persisted in data jsonb",
  );

  const after = await plugin.compute(target.grievanceId);
  const adjRow = (after as any).rows.find((r: any) => r.adjustment);
  assert(adjRow, "compute produced an adjusted row");
  assert(adjRow.originalDueYmd, `originalDueYmd recorded (${adjRow?.originalDueYmd})`);
  assert(
    adjRow.dueYmd > adjRow.originalDueYmd,
    `dueYmd shifted later (${adjRow.originalDueYmd} -> ${adjRow.dueYmd})`,
  );

  // 2) explicit date
  await storage.grievanceStatusHistory.setTimelineAdjustment(
    target.grievanceId,
    target.entryId,
    { kind: "explicit", date: "2026-12-31" },
  );
  const afterExplicit = await plugin.compute(target.grievanceId);
  const expRow = (afterExplicit as any).rows.find((r: any) => r.adjustment);
  assert(expRow?.dueYmd === "2026-12-31", `explicit date overrides dueYmd (${expRow?.dueYmd})`);
  assert(expRow?.originalDueYmd === adjRow.originalDueYmd, "originalDueYmd unchanged");

  // 3) clear
  const cleared = await storage.grievanceStatusHistory.setTimelineAdjustment(
    target.grievanceId,
    target.entryId,
    null,
  );
  assert(readTimelineAdjustment(cleared!.data) === null, "adjustment cleared from data jsonb");
  const afterClear = await plugin.compute(target.grievanceId);
  const clearedRow = (afterClear as any).rows.find((r: any) => r.adjustment);
  assert(!clearedRow, "no adjusted rows after clear");
  const restored = (afterClear as any).rows.find(
    (r: any) => r.stepId === adjRow.stepId,
  );
  assert(
    restored?.dueYmd === adjRow.originalDueYmd,
    `dueYmd reverted to original (${restored?.dueYmd})`,
  );

  console.log("\nAll smoke checks passed.");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
