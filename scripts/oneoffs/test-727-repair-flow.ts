/**
 * Task #727 smoke test: simulate a failed enable (empty drifted table left
 * behind) for the "contract" component, verify:
 *   1. enableComponentSchema fails with detailed error + driftTables info
 *   2. repairComponentSchema drops the empty drifted table and enables cleanly
 *   3. a drifted table WITH rows blocks repair
 * Cleans up after itself (drops the component tables + state again).
 */
import { storage } from "../../server/storage";
import { tableExists } from "../../server/storage/utils";
import {
  enableComponentSchema,
  repairComponentSchema,
  disableComponentSchema,
} from "../../server/services/component-lifecycle";
import { loadComponentCache, isComponentEnabledSync } from "../../server/services/component-cache";
import { getAllComponents } from "../../shared/components";

async function pickComponent(): Promise<{ id: string; tables: string[] }> {
  for (const c of getAllComponents()) {
    if (!c.managesSchema || !c.schemaManifest) continue;
    if (c.schemaManifest.dependsOnComponents?.length) continue;
    // Single-table components give a clean drift scenario (no FK creation
    // failures against the deliberately-bogus table).
    if (c.schemaManifest.tables.length !== 1) continue;
    if (isComponentEnabledSync(c.id)) continue;
    let anyExists = false;
    for (const t of c.schemaManifest.tables) {
      if (await tableExists(t)) { anyExists = true; break; }
    }
    if (anyExists) continue;
    return { id: c.id, tables: c.schemaManifest.tables };
  }
  throw new Error("No safe disabled schema-managing component found in this dev DB");
}

async function main() {
  await loadComponentCache();

  const picked = await pickComponent();
  const COMPONENT_ID = picked.id;
  const TABLES = picked.tables;
  const FIRST = TABLES[0];
  console.log(`Using component ${COMPONENT_ID}, tables: ${TABLES.join(", ")}`);

  console.log(`=== Step 1: create a drifted (wrong-shape, empty) ${FIRST} table ===`);
  await storage.rawSql.execute(`CREATE TABLE ${FIRST} (id serial PRIMARY KEY, bogus_column text)`);

  console.log("=== Step 2: enableComponentSchema should fail with drift detail ===");
  const enableResult = await enableComponentSchema(COMPONENT_ID);
  console.log("success:", enableResult.success);
  console.log("error:", enableResult.error);
  console.log("driftTables:", JSON.stringify(enableResult.driftTables, null, 2));
  console.log("failed ops:", JSON.stringify(enableResult.schemaOperations.filter(o => !o.success), null, 2));
  if (enableResult.success) throw new Error("Expected enable to fail");
  if (!enableResult.driftTables?.length) throw new Error("Expected driftTables to be populated");
  if (enableResult.driftTables.some(t => t.hasRows)) throw new Error("Expected drifted table to be empty");
  if (enableResult.error === "Schema push failed - state not saved") throw new Error("Error is still generic");

  console.log("\n=== Step 3: repairComponentSchema should drop + recreate + enable ===");
  const repairResult = await repairComponentSchema(COMPONENT_ID);
  console.log("success:", repairResult.success);
  console.log("repairedTables:", repairResult.repairedTables);
  console.log("error:", repairResult.error);
  if (!repairResult.success) throw new Error("Expected repair to succeed");
  if (!repairResult.repairedTables?.includes(FIRST)) throw new Error(`Expected ${FIRST} to be repaired`);
  for (const t of TABLES) {
    if (!(await tableExists(t))) throw new Error(`Expected ${t} to exist after repair`);
  }

  console.log("\n=== Step 4: clean up (disable with data deletion) ===");
  const disableResult = await disableComponentSchema(COMPONENT_ID, { retainData: false });
  if (!disableResult.success) throw new Error(`Cleanup disable failed: ${disableResult.error}`);

  console.log("\n=== Step 5: drifted table WITH rows must block repair ===");
  await storage.rawSql.execute(`CREATE TABLE ${FIRST} (id serial PRIMARY KEY, bogus_column text)`);
  await storage.rawSql.execute(`INSERT INTO ${FIRST} (bogus_column) VALUES ('keep me')`);
  const enable2 = await enableComponentSchema(COMPONENT_ID);
  console.log("enable success:", enable2.success, "| driftTables:", JSON.stringify(enable2.driftTables));
  if (enable2.success) throw new Error("Expected enable to fail");
  if (!enable2.driftTables?.some(t => t.hasRows)) throw new Error("Expected hasRows=true");
  const repair2 = await repairComponentSchema(COMPONENT_ID);
  console.log("repair success:", repair2.success);
  console.log("repair error:", repair2.error);
  if (repair2.success) throw new Error("Expected repair to be blocked");
  if (!/contain data/.test(repair2.error ?? "")) throw new Error("Expected 'contain data' message");
  // the row must still be there
  const stillHasRows = await (await import("../../server/storage/utils")).tableHasRows(FIRST);
  if (!stillHasRows) throw new Error("Data table was touched!");

  console.log("\n=== Step 6: final cleanup ===");
  await storage.rawSql.execute(`DROP TABLE IF EXISTS ${FIRST} CASCADE`);
  // enable never succeeded in step 5, so no schema state to clean; but be thorough:
  await disableComponentSchema(COMPONENT_ID, { retainData: false });

  console.log("\nALL CHECKS PASSED");
  process.exit(0);
}

main().catch((e) => {
  console.error("TEST FAILED:", e);
  process.exit(1);
});
