/**
 * One-off: activate EDLS for ~50% of workers.
 *
 * Iterates the worker list and, for a randomly chosen ~50% of them,
 * calls `storage.workerEdls.setActive(workerId, true)`. Going through
 * the storage layer (rather than a raw DB update) means each change
 * is atomic and produces a row in the audit log via the existing
 * worker-edls logging config.
 *
 * Usage:
 *   npx tsx scripts/oneoffs/activate-edls-for-half-of-workers.ts [--dry-run] [--rate=0.5] [--seed=12345]
 *
 * Defaults: rate=0.5, no dry-run, unseeded random.
 */

import { storage } from "../../server/storage";

interface Args {
  dryRun: boolean;
  rate: number;
  seed: number | null;
}

function parseArgs(): Args {
  let dryRun = false;
  let rate = 0.5;
  let seed: number | null = null;

  for (const arg of process.argv.slice(2)) {
    if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg.startsWith("--rate=")) {
      const v = parseFloat(arg.slice("--rate=".length));
      if (!Number.isFinite(v) || v < 0 || v > 1) {
        throw new Error(`Invalid --rate value: ${arg}. Must be a number in [0, 1].`);
      }
      rate = v;
    } else if (arg.startsWith("--seed=")) {
      const v = parseInt(arg.slice("--seed=".length), 10);
      if (!Number.isFinite(v)) {
        throw new Error(`Invalid --seed value: ${arg}. Must be an integer.`);
      }
      seed = v;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return { dryRun, rate, seed };
}

// Tiny seeded RNG (mulberry32) so re-runs with the same --seed pick the same workers.
function makeRng(seed: number | null): () => number {
  if (seed === null) return Math.random;
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function main() {
  const args = parseArgs();
  const rng = makeRng(args.seed);

  console.log(
    `Activate EDLS for ~${Math.round(args.rate * 100)}% of workers ` +
      `(dryRun=${args.dryRun}, seed=${args.seed ?? "unseeded"})`
  );

  const allWorkers = await storage.workers.getAllWorkers();
  console.log(`Loaded ${allWorkers.length} workers.`);

  const selected = allWorkers.filter(() => rng() < args.rate);
  console.log(`Selected ${selected.length} workers to activate.`);

  if (args.dryRun) {
    console.log("Dry run — not writing.");
    for (const w of selected.slice(0, 10)) {
      console.log(`  would activate worker ${w.id}`);
    }
    if (selected.length > 10) {
      console.log(`  ...and ${selected.length - 10} more`);
    }
    return;
  }

  let activated = 0;
  let alreadyActive = 0;
  let reactivated = 0;
  let failed = 0;
  const errors: Array<{ workerId: string; error: string }> = [];

  for (let i = 0; i < selected.length; i++) {
    const worker = selected[i];
    try {
      const before = await storage.workerEdls.getByWorker(worker.id);
      const wasActive = before?.active === true;

      await storage.workerEdls.setActive(worker.id, true);

      if (!before) {
        activated++;
      } else if (wasActive) {
        alreadyActive++;
      } else {
        reactivated++;
      }
    } catch (err) {
      failed++;
      const msg = err instanceof Error ? err.message : String(err);
      errors.push({ workerId: worker.id, error: msg });
      console.error(`  FAILED for worker ${worker.id}: ${msg}`);
    }

    if ((i + 1) % 50 === 0) {
      console.log(`  progress: ${i + 1}/${selected.length}`);
    }
  }

  console.log("");
  console.log("=== Summary ===");
  console.log(`  Total workers in system   : ${allWorkers.length}`);
  console.log(`  Selected (~${Math.round(args.rate * 100)}%)        : ${selected.length}`);
  console.log(`  Newly activated (no row)  : ${activated}`);
  console.log(`  Reactivated (was false)   : ${reactivated}`);
  console.log(`  Already active (no-op)    : ${alreadyActive}`);
  console.log(`  Failed                    : ${failed}`);
  if (errors.length > 0) {
    console.log("First errors:");
    for (const e of errors.slice(0, 10)) {
      console.log(`  ${e.workerId}: ${e.error}`);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Script failed:", err);
    process.exit(1);
  });
