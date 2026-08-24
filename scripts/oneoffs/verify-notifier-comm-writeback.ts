/**
 * One-off end-to-end verification that a notifier can record the message it
 * caused, via the framework's `onCommCreated` hook.
 *
 * Fires a real EDLS_SHEET_SAVED event through the real event bus, against real
 * sheet data and the real enabled notifier config, and checks that:
 *   1. every worker the notifier texted has the resulting comm recorded on the
 *      assignment their message linked to,
 *   2. a worker on the same sheet who was NOT texted (no active primary number,
 *      or no SMS opt-in) is left unrecorded — absence still means "we did not
 *      contact them",
 *   3. the recorded comm really is that worker's SMS, and a FAILED send is
 *      recorded too rather than skipped,
 *   4. the other notifier subscribed to this event still delivers as before,
 *   5. deleting the comm clears the link and leaves the assignment intact.
 *
 * Safety: this refuses to run unless the system is in a non-live mode AND no
 * recipient's number is allowlisted, which together mean the SMS sender stops
 * at NOT_ALLOWLISTED — it records a failed comm without ever calling the
 * provider. No real text can be sent by running this. Everything it creates is
 * deleted again at the end.
 *
 * Run: npx tsx scripts/oneoffs/verify-notifier-comm-writeback.ts
 */
import { loadComponentCache } from "../../server/services/component-cache";
import { getSystemMode } from "../../server/services/system-mode";
import { eventBus, EventType } from "../../server/services/event-bus";
import { storage, createCommSmsOptinStorage, createCommStorage } from "../../server/storage";
import type { SheetAssignmentSmsTarget } from "../../server/storage/edls/assignments";

let failures = 0;
function check(label: string, ok: boolean, detail?: string) {
  console.log(`${ok ? "PASS" : "FAIL"}: ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

const NOTIFIER_ID = "edls-sheet-worker-sms-notifier";

async function main() {
  await loadComponentCache();

  // Register the notifier plugins and subscribe the dispatcher's handlers, the
  // two things boot does that make an emitted event reach a notifier.
  const { initializeEventNotifierPluginSystem } = await import(
    "../../server/plugins/event-notifier"
  );
  const { initializeEventNotifierDispatcher } = await import(
    "../../server/plugins/event-notifier/dispatcher"
  );
  initializeEventNotifierPluginSystem();
  initializeEventNotifierDispatcher();
  // The comm senders resolve their provider from the service registry, which
  // boot populates; without this the SMS send throws before creating anything.
  const { initializeServiceProviders } = await import(
    "../../server/services/comm/providers"
  );
  initializeServiceProviders();
  // The OTHER notifier on this event composes from token templates. Without
  // the token registry its tokens resolve to "unknown" and it delivers a
  // degraded message — which would make the "unaffected" check below a lie.
  const { initializeTokenPluginSystem } = await import(
    "../../server/plugins/tokens"
  );
  initializeTokenPluginSystem();

  // ---- the config that decides whether this fires at all -------------------
  const configs = await storage.pluginConfigs.search("event-notifier", {
    enabled: true,
  });
  const notifierConfig = configs.find((c) => c.config.pluginId === NOTIFIER_ID);
  if (!notifierConfig) {
    console.log(`SKIP: no enabled config for ${NOTIFIER_ID}; nothing to verify.`);
    process.exit(0);
  }
  const configData = (notifierConfig.config.data ?? {}) as Record<string, unknown>;
  const triggerStatus = (configData.statuses as string[])?.[0];
  if (!triggerStatus) {
    console.log(`SKIP: enabled config for ${NOTIFIER_ID} has no trigger status.`);
    process.exit(0);
  }
  console.log(`Config triggers on status "${triggerStatus}".`);

  // ---- pick a sheet that cannot possibly send a real text ------------------
  const mode = await getSystemMode();
  if (mode === "live") {
    console.log(`REFUSING: system mode is "live" — a real text could be sent.`);
    process.exit(1);
  }

  // Emitting the event wakes EVERY enabled notifier subscribed to it, not just
  // the one under test. Vetting only this notifier's recipients would leave
  // the others free to email or text real people, so require that they can
  // only produce in-app messages, which stay inside the app.
  const { eventNotifierRegistry } = await import(
    "../../server/plugins/event-notifier/registry"
  );
  const bystanders = configs.filter(
    (c) =>
      c.config.pluginId !== NOTIFIER_ID &&
      eventNotifierRegistry
        .get(c.config.pluginId)
        ?.subscribedEvents.includes(EventType.EDLS_SHEET_SAVED),
  );
  const mediaOf = (c: (typeof configs)[number]): string[] => {
    const subsidiary = (c.subsidiary as { media?: string | null } | undefined)
      ?.media;
    if (subsidiary) return subsidiary.split(",").filter(Boolean);
    const legacy = (c.config.data as { media?: unknown } | null)?.media;
    return Array.isArray(legacy) ? (legacy as string[]) : [];
  };
  // Fail closed: a config whose media we cannot read is treated as able to
  // reach the outside world, because it might.
  const external = bystanders.filter((c) => {
    const media = mediaOf(c);
    return media.length === 0 || media.some((m) => m !== "inapp");
  });
  if (external.length > 0) {
    console.log(
      `REFUSING: other notifier(s) on this event may send outside the app: ${external
        .map((c) => `${c.config.pluginId} [${mediaOf(c).join(",") || "unknown"}]`)
        .join(", ")}`,
    );
    process.exit(1);
  }
  console.log(
    `${bystanders.length} other notifier(s) on this event, all in-app only: ${
      bystanders.map((c) => c.config.pluginId).join(", ") || "none"
    }`,
  );

  const optinStorage = createCommSmsOptinStorage();
  const sheets = await storage.edlsSheets.getAll();
  let chosen: { sheetId: string; title: string } | null = null;
  let expectedAssignmentIds: string[] = [];
  // The targets as they were BEFORE the send. Re-reading them afterwards
  // answers differently on purpose: a recorded message is a receipt, and the
  // read leaves out anyone holding one.
  let expectedTargets: SheetAssignmentSmsTarget[] = [];

  for (const sheet of sheets) {
    const targets = await storage.edlsAssignments.getSmsTargetsBySheetId(sheet.id);
    if (targets.length === 0) continue;

    // Mirror the notifier's own recipient rule: one text per contact, about
    // their first assignment on the sheet, opted-in numbers only — and that
    // one text is recorded on EVERY assignment of theirs it spoke for.
    const byContact = new Map<string, (typeof targets)[number][]>();
    for (const t of targets) {
      const group = byContact.get(t.contactId);
      if (group) group.push(t);
      else byContact.set(t.contactId, [t]);
    }
    const optins = await optinStorage.getSmsOptinsByPhoneNumbers(
      Array.from(byContact.values()).map((group) => group[0].phoneNumber),
    );
    const willText = Array.from(byContact.values()).filter(
      (group) => optins.get(group[0].phoneNumber)?.optin,
    );
    if (willText.length < 2) continue;
    // The safety condition: an allowlisted number in a non-live mode WOULD be
    // handed to the provider.
    if (willText.some((group) => optins.get(group[0].phoneNumber)?.allowlist)) {
      continue;
    }

    chosen = { sheetId: sheet.id, title: sheet.title };
    expectedTargets = willText.flat();
    expectedAssignmentIds = expectedTargets.map((t) => t.assignmentId);
    break;
  }

  if (!chosen) {
    console.log("SKIP: no sheet with ≥2 opted-in, non-allowlisted workers to text.");
    process.exit(0);
  }
  console.log(
    `Sheet "${chosen.title}" (${chosen.sheetId}): expecting ${expectedAssignmentIds.length} workers texted.`,
  );

  // ---- before ---------------------------------------------------------------
  const sheetStaff = await storage.edlsSheets.get(chosen.sheetId);
  if (!sheetStaff) throw new Error("sheet vanished");
  const before = await storage.edlsAssignments.getBySheetId(chosen.sheetId);
  const alreadyLinked = before.filter((a) => a.commId);
  if (alreadyLinked.length > 0) {
    // Cleanup below deletes the comms linked to this sheet. That is only safe
    // while every such link is one this run created, so refuse BEFORE writing
    // anything rather than risk deleting a real message someone sent.
    console.log(
      `REFUSING: ${alreadyLinked.length} assignment(s) on this sheet already link a message; cleanup would delete real history.`,
    );
    process.exit(1);
  }
  check("no assignment on the sheet is linked to a message yet", true);

  const commStorage = createCommStorage();
  // The other notifier on this event messages the sheet's staff in-app.
  const staffUserIds = [sheetStaff.supervisor, sheetStaff.assignee].filter(
    (id): id is string => !!id,
  );
  const inappBefore = await countInappFor(staffUserIds);

  // ---- fire the real event --------------------------------------------------
  const sheet = sheetStaff;
  // Exactly the payload the sheet storage emits after a real save commits,
  // shaped as an ARRIVAL at the trigger status (previous ≠ new).
  await eventBus.emit(EventType.EDLS_SHEET_SAVED, {
    sheetId: sheet.id,
    previousStatus: triggerStatus === "draft" ? "request" : "draft",
    newStatus: triggerStatus,
    sheet: { ...sheet, status: triggerStatus },
  });

  // ---- after ----------------------------------------------------------------
  const after = await storage.edlsAssignments.getBySheetId(chosen.sheetId);
  const linked = after.filter((a) => a.commId);
  const expected = new Set(expectedAssignmentIds);

  check(
    "every texted worker's assignment records the message",
    expectedAssignmentIds.every((id) => after.find((a) => a.id === id)?.commId),
    `${linked.length} of ${expected.size} recorded`,
  );
  check(
    "no assignment the notifier did not text was recorded",
    linked.every((a) => expected.has(a.id)),
    linked
      .filter((a) => !expected.has(a.id))
      .map((a) => a.id)
      .join(", ") || "none",
  );

  const untexted = after.filter((a) => !expected.has(a.id));
  check(
    "workers with no reachable, opted-in number stay unrecorded",
    untexted.every((a) => !a.commId),
    `${untexted.length} such assignments on this sheet`,
  );

  // The recorded comm must be that worker's own SMS, and a failure counts.
  const sampleId = expectedAssignmentIds[0];
  const sample = after.find((a) => a.id === sampleId);
  const sampleComm = sample?.commId ? await commStorage.getComm(sample.commId) : undefined;
  check("the recorded record exists", !!sampleComm, sample?.commId ?? "no link");
  check("it is an SMS", sampleComm?.medium === "sms", sampleComm?.medium);
  check(
    "it belongs to the worker who was texted",
    !!sampleComm &&
      sampleComm.contactId === contactIdForAssignment(expectedTargets, sampleId),
    sampleComm?.contactId,
  );
  check(
    "a send the provider never accepted is still recorded",
    sampleComm?.status === "failed",
    `status "${sampleComm?.status}" (expected "failed" — non-live mode, not allowlisted)`,
  );

  // ---- ordering: "most recent" means most recently SENT ----------------------
  // Two texts about the same assignment can finish their bookkeeping out of
  // order when one provider call is slower. The later message must win
  // regardless of which write lands second.
  if (sample?.commId && sampleComm) {
    const at = (offsetMs: number) =>
      new Date((sampleComm.sent ?? new Date()).getTime() + offsetMs);
    const older = await commStorage.createComm({
      medium: "sms",
      contactId: sampleComm.contactId,
      status: "failed",
      sent: at(-60_000),
      data: { verifyScript: true },
    });
    const newer = await commStorage.createComm({
      medium: "sms",
      contactId: sampleComm.contactId,
      status: "failed",
      sent: at(60_000),
      data: { verifyScript: true },
    });

    const olderWrote = await storage.edlsAssignments.setCommId(sampleId, older.id, sample.data);
    const afterOlder = await linkOf(chosen.sheetId, sampleId);
    check(
      "an earlier-sent message does not displace a later one",
      olderWrote === false && afterOlder === sample.commId,
      `wrote=${olderWrote}, link ${afterOlder === sample.commId ? "unchanged" : "CHANGED"}`,
    );

    const newerWrote = await storage.edlsAssignments.setCommId(sampleId, newer.id, sample.data);
    const afterNewer = await linkOf(chosen.sheetId, sampleId);
    check(
      "a later-sent message does displace the recorded one",
      newerWrote === true && afterNewer === newer.id,
      `wrote=${newerWrote}`,
    );

    // Put the assignment back the way the event left it. Deleting the newer
    // comm clears the column, which lets the original be recorded again.
    await commStorage.deleteComm(newer.id);
    await commStorage.deleteComm(older.id);
    await storage.edlsAssignments.setCommId(sampleId, sample.commId, sample.data);
    check(
      "the sheet is back to what the event produced",
      (await linkOf(chosen.sheetId, sampleId)) === sample.commId,
    );
  }

  // ---- the other notifier on this event is unaffected ------------------------
  const inappAfter = await countInappFor(staffUserIds);
  if (staffUserIds.length === 0) {
    console.log(
      "SKIP: this sheet has no supervisor or assignee, so the staff notifier has nobody to message.",
    );
  } else {
    check(
      "the other notifier subscribed to this event still delivered",
      inappAfter > inappBefore,
      `staff in-app messages ${inappBefore} → ${inappAfter}`,
    );
  }

  // ---- cleanup, which also proves the link clears itself ---------------------
  const createdCommIds = Array.from(
    new Set(linked.map((a) => a.commId!).filter(Boolean)),
  );
  for (const commId of createdCommIds) {
    await commStorage.deleteComm(commId);
  }
  const cleaned = await storage.edlsAssignments.getBySheetId(chosen.sheetId);
  check(
    "deleting the message clears the link and keeps the assignment",
    cleaned.length === after.length && cleaned.every((a) => !a.commId),
    `${cleaned.length} assignments, ${cleaned.filter((a) => a.commId).length} still linked`,
  );

  console.log(
    failures === 0
      ? "\nAll checks passed."
      : `\n${failures} check(s) FAILED.`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

/** The message currently recorded on one assignment. */
async function linkOf(
  sheetId: string,
  assignmentId: string,
): Promise<string | null | undefined> {
  const rows = await storage.edlsAssignments.getBySheetId(sheetId);
  return rows.find((a) => a.id === assignmentId)?.commId;
}

/** The contact an assignment's worker belongs to, from the notifier's own read. */
function contactIdForAssignment(
  targets: SheetAssignmentSmsTarget[],
  assignmentId: string,
): string | undefined {
  return targets.find((t) => t.assignmentId === assignmentId)?.contactId;
}

/** In-app messages held by the sheet's staff — what the other notifier sends. */
async function countInappFor(userIds: string[]): Promise<number> {
  const { createCommInappStorage } = await import("../../server/storage");
  const inapp = createCommInappStorage();
  let total = 0;
  for (const userId of userIds) {
    total += (await inapp.getCommInappsByUser(userId)).length;
  }
  return total;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
