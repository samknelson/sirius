/**
 * Concurrency smoke test for the trust-eligibility phase-conflict guard
 * (advisory lock + in-transaction re-check). Simulates two admins saving
 * simultaneously: both run "check then create" for the SAME
 * policy + plugin + benefit + phase, concurrently, using the exact same
 * storage primitives the routes use. Expected: exactly ONE config row is
 * created; the loser sees the winner's committed row in its in-transaction
 * re-check and aborts.
 *
 * Also verifies the combined "start,continue" case: a concurrent writer
 * targeting phase "continue" must collide with a combined row.
 *
 * Run: npx tsx scripts/oneoffs/test-phase-conflict-race.ts
 */
import { storage } from "../../server/storage";
import { runInTransaction } from "../../server/storage/transaction-context";

const KIND = "trust-eligibility";
const PLUGIN_ID = "__race_test_plugin__";
const LOCK_KEY = `plugin-config:trust-eligibility:${PLUGIN_ID}`;

class ConflictAbort extends Error {}

async function checkThenCreate(label: string, appliesTo: string, phasesToCheck: string[]) {
  return runInTransaction(async () => {
    await storage.pluginConfigs.acquireWriteLock(LOCK_KEY);
    for (const phase of phasesToCheck) {
      const matches = await storage.pluginConfigs.search(KIND, {
        policy: null,
        pluginId: PLUGIN_ID,
        benefit: null,
        appliesTo: phase,
      } as any);
      if (matches.length > 0) throw new ConflictAbort(`${label}: conflict on phase '${phase}'`);
    }
    // Small delay INSIDE the lock window — without the lock, both writers
    // would pass the check before either commits.
    await new Promise((r) => setTimeout(r, 150));
    const row = await storage.pluginConfigs.create({
      pluginKind: KIND,
      pluginId: PLUGIN_ID,
      name: `race test ${label}`,
      enabled: false,
      ordering: 0,
      data: { appliesTo: appliesTo.split(",") },
    } as any);
    await storage.pluginConfigs.upsertSubsidiary(KIND, {
      id: row.id,
      policy: null,
      benefit: null,
      appliesTo,
    });
    return row.id;
  });
}

async function cleanup() {
  const rows = await storage.pluginConfigs.getByKindAndPlugin(KIND, PLUGIN_ID);
  for (const r of rows) await storage.pluginConfigs.delete(r.id);
}

async function main() {
  await cleanup();

  // Race 1: two identical single-phase writers.
  const results = await Promise.allSettled([
    checkThenCreate("A", "start", ["start"]),
    checkThenCreate("B", "start", ["start"]),
  ]);
  const created = results.filter((r) => r.status === "fulfilled").length;
  const aborted = results.filter(
    (r) => r.status === "rejected" && r.reason instanceof ConflictAbort,
  ).length;
  console.log(`Race 1 (start vs start): created=${created}, aborted=${aborted}`);
  if (created !== 1 || aborted !== 1) throw new Error("FAIL: expected exactly 1 create + 1 abort");
  const after1 = await storage.pluginConfigs.getByKindAndPlugin(KIND, PLUGIN_ID);
  if (after1.length !== 1) throw new Error(`FAIL: expected 1 row, found ${after1.length}`);

  await cleanup();

  // Race 2: combined "start,continue" writer vs single "continue" writer —
  // token-aware check must make them mutually exclusive.
  const results2 = await Promise.allSettled([
    checkThenCreate("C", "start,continue", ["start", "continue"]),
    checkThenCreate("D", "continue", ["continue"]),
  ]);
  const created2 = results2.filter((r) => r.status === "fulfilled").length;
  const aborted2 = results2.filter(
    (r) => r.status === "rejected" && r.reason instanceof ConflictAbort,
  ).length;
  console.log(`Race 2 (start,continue vs continue): created=${created2}, aborted=${aborted2}`);
  if (created2 !== 1 || aborted2 !== 1) throw new Error("FAIL: expected exactly 1 create + 1 abort");
  const after2 = await storage.pluginConfigs.getByKindAndPlugin(KIND, PLUGIN_ID);
  if (after2.length !== 1) throw new Error(`FAIL: expected 1 row, found ${after2.length}`);

  await cleanup();
  console.log("PASS: advisory lock + in-transaction re-check prevents duplicates under races");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
