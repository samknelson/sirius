/**
 * One-off smoke test for the EDLS sheet status-change notifier (Task #751).
 *
 * Runs the real pipeline in-process: registers the event-notifier plugins +
 * dispatcher, seeds a temporary enabled config (in-app medium), then drives
 * storage.edlsSheets.update through several status transitions and asserts
 * on the comm_inapp rows created for the sheet's supervisor/assignee/crew
 * supervisors. Cleans up the config and restores the sheet at the end.
 *
 * Run: npx tsx scripts/oneoffs/verify-edls-sheet-notifier.ts
 */
import { storage } from "../../server/storage";
import { loadComponentCache, isComponentEnabledSync } from "../../server/services/component-cache";
import "../../server/plugins/event-notifier/index";
import { initializeEventNotifierDispatcher } from "../../server/plugins/event-notifier/dispatcher";
import { createCommInappStorage } from "../../server/storage/comm";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  await loadComponentCache();
  if (!isComponentEnabledSync("edls")) {
    console.log("SKIP: edls component not enabled");
    process.exit(1);
  }
  initializeEventNotifierDispatcher();

  const sheets = await storage.edlsSheets.getAll();
  let target: { id: string; status: string } | undefined;
  let recipients: { userId: string; email: string; label: string }[] = [];
  for (const s of sheets) {
    const rel = await storage.edlsSheets.getWithRelations(s.id);
    if (!rel) continue;
    const r: { userId: string; email: string; label: string }[] = [];
    if (rel.supervisorUser) r.push({ userId: rel.supervisorUser.id, email: rel.supervisorUser.email, label: "sheet supervisor" });
    if (rel.assigneeUser) r.push({ userId: rel.assigneeUser.id, email: rel.assigneeUser.email, label: "sheet assignee" });
    const crews = await storage.edlsCrews.getBySheetIdWithRelations(s.id);
    for (const c of crews) {
      if (c.supervisorUser) r.push({ userId: c.supervisorUser.id, email: c.supervisorUser.email, label: "crew supervisor" });
    }
    if (r.length > 0 && s.status !== "trash") {
      target = { id: s.id, status: s.status };
      recipients = r;
      break;
    }
  }
  if (!target) {
    console.log("SKIP: no non-trash sheet with supervisor/assignee found");
    process.exit(1);
  }
  const uniqueUserIds = Array.from(new Set(recipients.map((r) => r.userId)));
  console.log(`Sheet ${target.id} status=${target.status}; recipients:`, recipients);

  // Trigger status = something the sheet is NOT currently in (avoid trash: it deletes assignments).
  const trigger = target.status === "lock" ? "reserved" : "lock";

  const config = await storage.pluginConfigs.create({
    pluginKind: "event-notifier",
    pluginId: "edls-sheet-status-notifier",
    name: "TEMP verify #751",
    enabled: true,
    ordering: 9999,
    data: {
      media: ["inapp"],
      statuses: [trigger],
      recipientTypes: ["sheet_supervisor", "sheet_assignee", "crew_supervisors"],
    },
  });
  await storage.pluginConfigs.upsertSubsidiary("event-notifier", { id: config.id, media: "inapp" });
  console.log(`Created temp config ${config.id}, trigger status "${trigger}"`);

  const inapp = createCommInappStorage();
  const countFor = async (userId: string) =>
    (await inapp.getCommInappsByUser(userId)).filter((a) => a.title || true).length;
  const baseline = new Map<string, number>();
  for (const uid of uniqueUserIds) baseline.set(uid, await countFor(uid));

  let failures = 0;
  const check = async (label: string, expectDelta: number) => {
    await sleep(2500);
    for (const uid of uniqueUserIds) {
      const now = await countFor(uid);
      const delta = now - (baseline.get(uid) ?? 0);
      const ok = delta === expectDelta;
      if (!ok) failures++;
      console.log(`${ok ? "PASS" : "FAIL"} [${label}] user ${uid}: delta=${delta} expected=${expectDelta}`);
      baseline.set(uid, now);
    }
  };

  try {
    // 1. Transition INTO trigger status -> everyone notified once.
    await storage.edlsSheets.update(target.id, { status: trigger });
    await check(`arrive at ${trigger}`, 1);

    // 2. No-change edit (same status) -> nobody notified.
    await storage.edlsSheets.update(target.id, { status: trigger });
    await check("no-change edit", 0);

    // 3. Transition to a NON-configured status -> nobody notified.
    await storage.edlsSheets.update(target.id, { status: "draft" });
    await check("leave to non-configured", 0);

    // 4. Re-arrive at trigger -> notified again.
    await storage.edlsSheets.update(target.id, { status: trigger });
    await check(`re-arrive at ${trigger}`, 1);
  } finally {
    await storage.edlsSheets.update(target.id, { status: target.status });
    await sleep(1500);
    await storage.pluginConfigs.delete(config.id);
    console.log("Cleaned up: restored sheet status + deleted temp config");
  }

  console.log(failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("Verification script failed:", err);
  process.exit(1);
});
