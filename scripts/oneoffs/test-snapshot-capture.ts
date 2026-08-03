import { storage } from "../../server/storage";
import { initSnapshotCapture } from "../../server/services/snapshots/capture";
import { loadComponentCache } from "../../server/services/component-cache";

async function main() {
  await loadComponentCache();
  initSnapshotCapture();

  const sheets = await storage.edlsSheets.getAll();
  const sheet = sheets[0];
  if (!sheet) {
    console.log("No EDLS sheets found; cannot test capture.");
    process.exit(1);
  }
  console.log(`Sheet ${sheet.id} status=${sheet.status}`);

  const before = await storage.snapshots.listByEntity("edls_sheet", sheet.id);
  console.log(`Snapshots before: ${before.length}`);

  const newStatus = sheet.status === "draft" ? "request" : "draft";
  await storage.edlsSheets.update(sheet.id, { status: newStatus } as any);
  console.log(`Updated status -> ${newStatus}`);

  await new Promise((r) => setTimeout(r, 2000));

  const after = await storage.snapshots.listByEntity("edls_sheet", sheet.id);
  console.log(`Snapshots after: ${after.length}`);
  if (after.length > before.length) {
    const s = after[0];
    console.log(`Captured: label="${s.label}" author=${s.authorName ?? "null"} at ${s.createdAt}`);
    const full = await storage.snapshots.get(s.id);
    const node = full!.data as any;
    console.log(`Bundle version=${node.version} crews=${node.data.crews?.length ?? 0}`);
  } else {
    console.log("NO SNAPSHOT CAPTURED — FAIL");
    process.exit(1);
  }

  // restore original status
  await storage.edlsSheets.update(sheet.id, { status: sheet.status } as any);
  await new Promise((r) => setTimeout(r, 2000));
  const final = await storage.snapshots.listByEntity("edls_sheet", sheet.id);
  console.log(`Snapshots after restore: ${final.length} (restore also captured: ${final.length > after.length})`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
