// One-off: remove the orphaned duplicate Hank->Frank spouse relation left
// behind by a deleted enrollment wizard draft (wizardId 02f7f2d0...). The
// identical relation 67483778... (owned by the still-open draft) remains.
import { storage } from "../../server/storage/database";

async function main() {
  const id = "ed8c5c8f-31c8-486d-af82-5d489f066031";
  const rel = await storage.workerRelations.get(id);
  if (!rel) {
    console.log("Already gone.");
    process.exit(0);
  }
  const deleted = await storage.workerRelations.delete(id);
  console.log("Deleted duplicate relation:", deleted);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
