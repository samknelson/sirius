// One-off repair for wizard rows whose run-step progress was clobbered
// by the navigate endpoint's old "previous" behavior (Task #822): the
// step shows status "in_progress" even though the run already finished
// (percentComplete 100 + completedAt present). Sets those statuses back
// to "completed" so the Run/Next buttons unblock.
//
// Idempotent: re-running finds nothing to fix once repaired.
//
// Run with: npx tsx scripts/oneoffs/repair-clobbered-run-step-progress.ts

import { storage } from "../../server/storage";

async function main() {
  const rows = await storage.wizards.listAll();
  let repaired = 0;

  for (const row of rows) {
    const data: any = row.data || {};
    const progress: Record<string, any> | undefined = data.progress;
    if (!progress) continue;

    let changed = false;
    for (const [stepId, p] of Object.entries(progress)) {
      if (
        p &&
        p.status === "in_progress" &&
        p.percentComplete === 100 &&
        typeof p.completedAt === "string"
      ) {
        progress[stepId] = { ...p, status: "completed" };
        changed = true;
        console.log(
          `Repairing wizard ${row.id} (${row.type}) step '${stepId}': in_progress -> completed`,
        );
      }
    }

    if (changed) {
      await storage.wizards.update(row.id, { data });
      repaired++;
    }
  }

  console.log(`Done. Repaired ${repaired} wizard(s) out of ${rows.length}.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Repair failed:", err);
    process.exit(1);
  });
