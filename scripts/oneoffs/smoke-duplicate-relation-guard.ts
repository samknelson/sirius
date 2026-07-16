// One-off smoke test: worker relations duplicate guard.
import { storage } from "../../server/storage/database";

const HANK = "58c8000f-ee38-49fe-85af-9fb0d62b14ae";
const FRANK = "e31ab3a4-0b88-45a8-b27e-4a83de65667c";
const SPOUSE = "2da0acf8-11ee-4145-98b3-afa340c46961";

let pass = 0, fail = 0;
function check(name: string, ok: boolean, extra?: string) {
  if (ok) { pass++; console.log("PASS:", name); }
  else { fail++; console.log("FAIL:", name, extra ?? ""); }
}

async function main() {
  // 1. Creating an exact overlapping duplicate (Hank->Frank spouse, active) must be rejected.
  try {
    const r = await storage.workerRelations.create({
      worker1: HANK, worker2: FRANK, relationType: SPOUSE,
      startYmd: "2026-07-16", endYmd: null,
    } as any);
    check("reject overlapping duplicate", false, "created " + r.id);
    await storage.workerRelations.delete(r.id);
  } catch (e: any) {
    check("reject overlapping duplicate", /already have this relationship/.test(e.message), e.message);
  }

  // 2. Non-overlapping window (ended before existing started) must be allowed.
  try {
    const r = await storage.workerRelations.create({
      worker1: HANK, worker2: FRANK, relationType: SPOUSE,
      startYmd: "2025-01-01", endYmd: "2025-02-01",
    } as any);
    check("allow non-overlapping window", true);
    await storage.workerRelations.delete(r.id);
  } catch (e: any) {
    check("allow non-overlapping window", false, e.message);
  }

  // 3. Updating the existing relation to itself (excludeId) must still work.
  const existing = await storage.workerRelations.get("67483778-528e-46ec-b219-4383046243b8");
  if (existing) {
    try {
      const u = await storage.workerRelations.update(existing.id, { startYmd: existing.startYmd } as any);
      check("update self not blocked by own row", !!u);
    } catch (e: any) {
      check("update self not blocked by own row", false, e.message);
    }
  } else {
    console.log("SKIP: relation 67483778 missing");
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
