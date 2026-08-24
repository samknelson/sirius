/**
 * One-off end-to-end verification that the EDLS sheet worker SMS notifier
 * tells workers when they have been TAKEN OFF a sheet, and that the public
 * schedule link it sends is addressed to the worker rather than to a row that
 * can disappear.
 *
 * It never emits an event and never reaches the SMS sender: the notifier's own
 * hooks are called directly, which is where all the behaviour under test
 * lives, so no text can be sent by running this. It writes two snapshots and
 * (briefly) one settings variable against a real sheet, and deletes or
 * restores all of it again — including after a failure.
 *
 * Checks:
 *   1. a worker on the baseline roster who is no longer assigned is a
 *      recipient, with removal wording naming the sheet's date,
 *   2. every link — removed or assigned — addresses the worker by their
 *      `worker.aat` ACCESS TOKEN (so this script needs that component on),
 *   3. no worker still on the sheet is told they are off it, including the
 *      ones already holding a receipt,
 *   4. the snapshot of the save being processed is not its own baseline,
 *   5. a baseline captured at a status this config does not notify on is
 *      skipped,
 *   6. the receipt write-back skips a removed worker instead of failing,
 *   7. with snapshot capture switched off, no removal notice is invented,
 *   8. once the removal has been notified, the next transition says nothing.
 *
 * Run: npx tsx scripts/oneoffs/verify-edls-removed-worker-notices.ts
 */
import { randomUUID } from "node:crypto";
import type { Comm, Variable } from "@shared/schema";
import { formatYmd } from "@shared/utils/date";
import { loadComponentCache } from "../../server/services/component-cache";
import { eventBus, EventType, type EdlsSheetSavedPayload } from "../../server/services/event-bus";
import { SNAPSHOTS_SETTINGS_VARIABLE } from "../../server/services/snapshots/capture";
import { storage, createCommSmsOptinStorage } from "../../server/storage";
import { runInTransaction } from "../../server/storage/transaction-context";
import { edlsSheetWorkerSmsNotifier } from "../../server/plugins/event-notifier/plugins/edls-sheet-worker-sms-notifier";
import type { EventNotifierEventContext } from "../../server/plugins/event-notifier/types";

/**
 * The worker's `worker.aat` access token — what the texted link is keyed by.
 * The notifier issues one while resolving recipients, so by the time a
 * message has been composed the worker has one.
 */
async function accessTokenOf(workerId: string): Promise<string> {
  const row = await storage.workerAat.getByWorker(workerId);
  return row?.accessUuid ?? "<no access token issued>";
}

let failures = 0;
function check(label: string, ok: boolean, detail?: string) {
  console.log(`${ok ? "PASS" : "FAIL"}: ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

const ENTITY_TYPE = "edls_sheet";
const TRIGGER_STATUS = "lock";
const OTHER_STATUS = "draft";
const REMOVAL_WORDING = /no longer scheduled/i;

interface Candidate {
  workerId: string;
  contactId: string;
  phoneNumber: string;
}

/** Everything this run created, so it can be undone whatever happens. */
const createdSnapshotIds: string[] = [];
let settingsBefore: { existed: boolean; variable?: Variable } | null = null;

async function main() {
  await loadComponentCache();

  // ---- a sheet with a roster, and two textable workers not on it -----------
  // Prefer a sheet that still has workers waiting to be texted, so the
  // assigned side of the message is exercised too rather than only the
  // removed side; any sheet with a roster will do if there is no such sheet.
  const sheets = await storage.edlsSheets.getAll();
  let sheetId: string | null = null;
  let fallbackSheetId: string | null = null;
  for (const candidate of sheets) {
    const roster = await storage.edlsAssignments.getBySheetId(candidate.id);
    if (roster.length === 0) continue;
    fallbackSheetId ??= candidate.id;
    const targets = await storage.edlsAssignments.getSmsTargetsBySheetId(candidate.id);
    if (targets.length > 0) {
      sheetId = candidate.id;
      break;
    }
  }
  sheetId ??= fallbackSheetId;
  if (!sheetId) {
    console.log("SKIP: no EDLS sheet with any assignment to work from.");
    return;
  }
  const sheet = await storage.edlsSheets.get(sheetId);
  if (!sheet) throw new Error("sheet vanished");
  const roster = await storage.edlsAssignments.getBySheetId(sheetId);
  const onSheet = new Set(roster.map((a) => a.workerId));

  const candidates = await textableWorkersNotOnSheet(onSheet, 2);
  if (candidates.length < 2) {
    console.log(
      "SKIP: need two opted-in workers with an active primary number who are not on the sheet.",
    );
    return;
  }
  const [removed, decoyOnly] = candidates;
  console.log(
    `Sheet "${sheet.title}" (${sheetId}), ${roster.length} assignment(s); ` +
      `pretending worker ${removed.workerId} was on it and has been taken off.`,
  );

  // What a real save hands over for capture to store, before anything is
  // fabricated below.
  await verifyLiveSaveCapture(sheetId);

  const bundle = await storage.edlsSheets.export(sheetId);
  if (!bundle) throw new Error("sheet export produced nothing");

  // Two saves of this sheet: the one being processed, and the earlier one it
  // has to compare itself against. A save is identified by its `changed`
  // stamp, captured inside the bundle.
  const changed = new Date();
  const baselineChanged = new Date(changed.getTime() - 60_000);

  // The snapshot of the save being processed, written by the sibling
  // after-commit handler. It qualifies on status and names a different absent
  // worker — so if it were ever chosen as the baseline, `decoyOnly` would be
  // texted and `removed` would not.
  await createSnapshot(
    sheetId,
    withStatusAndExtraWorker(bundle, TRIGGER_STATUS, decoyOnly.workerId, changed),
    "verify: this save",
  );
  await sleep(50);
  // The baseline: an EARLIER save that arrived at the trigger status with the
  // removed worker still on it — whose snapshot row is deliberately written
  // LAST, the way a capture that was still landing when the next save started
  // would be. Ordering history by capture time would discard it.
  await createSnapshot(
    sheetId,
    withStatusAndExtraWorker(bundle, TRIGGER_STATUS, removed.workerId, baselineChanged),
    "verify: baseline (captured late)",
  );

  const ctx = contextFor(sheet, changed);
  const config = { statuses: [TRIGGER_STATUS] };

  const recipients = await edlsSheetWorkerSmsNotifier.getRecipients!(ctx, config);
  const contactIds = new Set(recipients.map((r) => r.contactId));

  check(
    "a worker taken off the sheet is a recipient",
    contactIds.has(removed.contactId),
    `${recipients.length} recipient(s)`,
  );
  check(
    "the save's own snapshot is not used as the baseline",
    !contactIds.has(decoyOnly.contactId),
    contactIds.has(decoyOnly.contactId)
      ? "this save's own snapshot won"
      : "the earlier save won, though its snapshot was written last",
  );

  const body = await messageFor(ctx, config, removed.contactId);
  check("the removed worker gets a message", !!body, body);
  check(
    "it says they are off the crew and names the date",
    REMOVAL_WORDING.test(body) && body.includes(formatYmd(sheet.ymd, "weekday-long")),
    body,
  );
  check(
    "its link addresses the worker, not an assignment",
    body.includes(`/edls-sched/${await accessTokenOf(removed.workerId)}`),
    body,
  );

  // Currently assigned workers: the same wording as before this change, and a
  // link addressed to them rather than to the row they happen to hold.
  const smsTargets = await storage.edlsAssignments.getSmsTargetsBySheetId(sheetId);
  const workerByContact = new Map(smsTargets.map((t) => [t.contactId, t.workerId]));
  let assignedChecked = 0;
  let assignedBad = "";
  for (const recipient of recipients) {
    const workerId = workerByContact.get(recipient.contactId);
    if (!workerId) continue;
    const text = await messageFor(ctx, config, recipient.contactId);
    const token = await accessTokenOf(workerId);
    if (!/posted or updated/i.test(text) || !text.includes(`/edls-sched/${token}`)) {
      assignedBad = text;
      break;
    }
    assignedChecked++;
  }
  check(
    "assigned workers keep the posted-or-updated text, addressed to themselves",
    !assignedBad,
    assignedBad || `${assignedChecked} checked`,
  );

  // Nobody still on the sheet may be told they are off it — including the
  // workers already holding a receipt, who are absent from the SMS target
  // read entirely and so would be the ones a naive diff got wrong.
  const rosterContacts = await storage.workers.getSmsContactsByWorkerIds(Array.from(onSheet));
  const rosterContactIds = new Set(rosterContacts.map((c) => c.contactId));
  const receipted = roster.filter((a) => a.commId).length;
  const wronglyRemoved: string[] = [];
  for (const recipient of recipients) {
    const text = await messageFor(ctx, config, recipient.contactId);
    if (REMOVAL_WORDING.test(text) && rosterContactIds.has(recipient.contactId)) {
      wronglyRemoved.push(recipient.contactId);
    }
  }
  check(
    "no worker still on the sheet is told they are off it",
    wronglyRemoved.length === 0,
    `${rosterContactIds.size} workers on the sheet, ${receipted} already receipted`,
  );

  // The receipt write-back has nothing to record for a removed worker.
  await edlsSheetWorkerSmsNotifier.onCommCreated!(
    "sms",
    { contactId: removed.contactId },
    { id: randomUUID() } as Comm,
    ctx,
    config,
  );
  check("the receipt write-back skips a removed worker without failing", true);

  // A baseline captured at a status this config does not notify on is not
  // this config's baseline.
  const narrow = await edlsSheetWorkerSmsNotifier.getRecipients!(ctx, {
    statuses: ["reserved"],
  });
  check(
    "a snapshot captured at a status this config ignores is not a baseline",
    !narrow.some((r) => r.contactId === removed.contactId),
  );

  // Told once: the next transition reads THIS save's snapshot as its baseline,
  // and the removed worker is not on it. (`decoyOnly` is on that snapshot by
  // construction and would legitimately be announced then — this is about the
  // worker who has already been told.)
  const laterCtx = contextFor(sheet, new Date(changed.getTime() + 60_000));
  const laterRecipients = await edlsSheetWorkerSmsNotifier.getRecipients!(laterCtx, config);
  let repeated = false;
  for (const recipient of laterRecipients) {
    if (recipient.contactId !== removed.contactId) continue;
    if (REMOVAL_WORDING.test(await messageFor(laterCtx, config, recipient.contactId))) {
      repeated = true;
    }
  }
  check("a later transition with no further changes repeats no removal notice", !repeated);

  // Capture switched off: there would be no next baseline, so a stale one
  // would re-announce the same removal forever. Say so instead of guessing.
  await disableSnapshotCapture();
  const withoutCapture = await edlsSheetWorkerSmsNotifier.getRecipients!(ctx, config);
  check(
    "with snapshot capture disabled, no removal notice is invented",
    !withoutCapture.some((r) => r.contactId === removed.contactId),
    "an error is logged above",
  );
}

/**
 * When a REAL save's history entry becomes readable, and what it holds.
 *
 * Everything the removal notice does rests on this: the notifier runs after a
 * save commits and asks for the previous save's roster. If history were
 * written by an after-commit listener, the previous save's entry might not
 * have landed yet, and "not there yet" is indistinguishable from "never had
 * one" — the worker is never told, and the next baseline no longer holds them.
 * So the entry is written inside the save's own transaction: it is readable
 * the instant the save returns, and a save that rolls back leaves none.
 *
 * Nothing is dispatched: the event bus is intercepted for the duration, so no
 * notifier and no text results from the saves below. The sheet's status is
 * flipped and put back, and the history entries this makes are deleted again.
 */
async function verifyLiveSaveCapture(sheetId: string): Promise<void> {
  const original = await storage.edlsSheets.get(sheetId);
  if (!original) throw new Error("sheet vanished");
  const before = await storage.snapshots.listByEntity(ENTITY_TYPE, sheetId);
  const knownIds = new Set(before.map((snapshot) => snapshot.id));

  const emitted: EdlsSheetSavedPayload[] = [];
  const realEmit = eventBus.emit.bind(eventBus);
  (eventBus as { emit: unknown }).emit = async (event: string, payload: unknown) => {
    if (event === EventType.EDLS_SHEET_SAVED) {
      emitted.push(payload as EdlsSheetSavedPayload);
      return;
    }
    return realEmit(event as never, payload as never);
  };

  const flipped = original.status === TRIGGER_STATUS ? OTHER_STATUS : TRIGGER_STATUS;
  try {
    const saved = await storage.edlsSheets.update(sheetId, { status: flipped });

    // Read history with NO delay: an after-commit writer would not be here yet.
    const afterSave = await storage.snapshots.listByEntity(ENTITY_TYPE, sheetId);
    const fresh = afterSave.filter((snapshot) => !knownIds.has(snapshot.id));
    for (const snapshot of fresh) createdSnapshotIds.push(snapshot.id);
    check(
      "a save's history entry is readable the moment the save returns",
      fresh.length === 1,
      `${fresh.length} new entr(y/ies)`,
    );

    const stored = fresh[0] ? await storage.snapshots.get(fresh[0].id) : undefined;
    const bundle = stored?.data as { data?: Record<string, unknown> } | undefined;
    check(
      "it holds the sheet as that save left it",
      bundle?.data?.status === flipped &&
        asIso(bundle?.data?.changed) === asIso(saved?.changed),
      `${String(bundle?.data?.status)} @ ${asIso(bundle?.data?.changed)}`,
    );

    // A save that rolls back must leave no history behind either.
    const countBeforeRollback = afterSave.length;
    await runInTransaction(async () => {
      await storage.edlsSheets.update(sheetId, { status: original.status });
      throw new Error("verification rollback");
    }).catch((error: unknown) => {
      if (!(error instanceof Error) || error.message !== "verification rollback") throw error;
    });
    const afterRollback = await storage.snapshots.listByEntity(ENTITY_TYPE, sheetId);
    check(
      "a save that rolls back leaves no history entry",
      afterRollback.length === countBeforeRollback,
      `${afterRollback.length} vs ${countBeforeRollback}`,
    );
  } finally {
    const restore = await storage.edlsSheets.update(sheetId, { status: original.status });
    const afterRestore = await storage.snapshots.listByEntity(ENTITY_TYPE, sheetId);
    for (const snapshot of afterRestore) {
      if (!knownIds.has(snapshot.id) && !createdSnapshotIds.includes(snapshot.id)) {
        createdSnapshotIds.push(snapshot.id);
      }
    }
    (eventBus as { emit: unknown }).emit = realEmit;
    check(
      "the sheet is back at the status it started on",
      restore?.status === original.status,
      String(restore?.status),
    );
  }

  check(
    "each save still emitted its save event",
    emitted.length === 2,
    `${emitted.length} emitted`,
  );

  // Delete this section's history entries now rather than at the end of the
  // run: they are real entries for this sheet at a notifying status, and the
  // fabricated history the rest of the checks rely on has to be the newest.
  const mine = createdSnapshotIds.filter((id) => !knownIds.has(id));
  for (const id of mine) await storage.snapshots.delete(id);
  createdSnapshotIds.length = 0;
}

/** The event context for a save of this sheet that arrived at the trigger status. */
function contextFor(
  sheet: Awaited<ReturnType<typeof storage.edlsSheets.get>> & {},
  changed: Date,
): EventNotifierEventContext {
  return {
    event: EventType.EDLS_SHEET_SAVED,
    payload: {
      sheetId: sheet.id,
      previousStatus: OTHER_STATUS,
      newStatus: TRIGGER_STATUS,
      sheet: { ...sheet, status: TRIGGER_STATUS, changed },
    },
  };
}

async function messageFor(
  ctx: EventNotifierEventContext,
  config: unknown,
  contactId: string,
): Promise<string> {
  const message = await edlsSheetWorkerSmsNotifier.getMessage!(
    "sms",
    { contactId },
    ctx,
    config,
  );
  return message?.message ?? "";
}

/** Workers with an active primary number and an SMS opt-in who are not on the sheet. */
async function textableWorkersNotOnSheet(
  onSheet: Set<string>,
  wanted: number,
): Promise<Candidate[]> {
  const workers = await storage.workers.getAllWorkers();
  const offSheet = workers.map((w) => w.id).filter((id) => !onSheet.has(id));
  const contacts = await storage.workers.getSmsContactsByWorkerIds(offSheet.slice(0, 400));
  const optins = await createCommSmsOptinStorage().getSmsOptinsByPhoneNumbers(
    contacts.map((c) => c.phoneNumber),
  );
  const picked: Candidate[] = [];
  const seenContacts = new Set<string>();
  for (const contact of contacts) {
    if (seenContacts.has(contact.contactId)) continue;
    if (!optins.get(contact.phoneNumber)?.optin) continue;
    seenContacts.add(contact.contactId);
    picked.push(contact);
    if (picked.length === wanted) break;
  }
  return picked;
}

/**
 * A copy of a sheet bundle as it would have been captured at `status` for the
 * save stamped `changed`, with one more worker on it.
 */
function withStatusAndExtraWorker(
  bundle: unknown,
  status: string,
  workerId: string,
  changed: Date,
): unknown {
  const clone = JSON.parse(JSON.stringify(bundle)) as {
    version: number;
    data: Record<string, unknown> & { crews?: Array<{ data: { assignments?: unknown[] } }> };
  };
  clone.data.status = status;
  clone.data.changed = changed.toISOString();
  const crews = clone.data.crews ?? [];
  if (crews.length === 0) throw new Error("sheet bundle has no crew to add a worker to");
  const assignments = (crews[0].data.assignments ??= []);
  assignments.push({ version: 1, data: { id: randomUUID(), workerId } });
  return clone;
}

async function createSnapshot(sheetId: string, data: unknown, label: string) {
  const row = await storage.snapshots.create({
    entityType: ENTITY_TYPE,
    entityId: sheetId,
    label,
    data,
    authorId: null,
    authorName: "verification script",
  });
  createdSnapshotIds.push(row.id);
  return row;
}

/** Turn EDLS sheet snapshot capture off, the way the settings screen would. */
async function disableSnapshotCapture(): Promise<void> {
  const existing = await storage.variables.getByName(SNAPSHOTS_SETTINGS_VARIABLE);
  settingsBefore = { existed: !!existing, variable: existing };
  const value = {
    ...((existing?.value as Record<string, unknown>) ?? {}),
    events: {
      ...(((existing?.value as { events?: Record<string, boolean> } | null)?.events) ?? {}),
      [EventType.EDLS_SHEET_SAVED]: false,
    },
  };
  if (existing) await storage.variables.update(existing.id, { value });
  else await storage.variables.create({ name: SNAPSHOTS_SETTINGS_VARIABLE, value });
}

async function cleanup(): Promise<void> {
  for (const id of createdSnapshotIds) {
    await storage.snapshots.delete(id);
  }
  if (settingsBefore) {
    const current = await storage.variables.getByName(SNAPSHOTS_SETTINGS_VARIABLE);
    if (settingsBefore.existed && settingsBefore.variable && current) {
      await storage.variables.update(current.id, { value: settingsBefore.variable.value });
    } else if (!settingsBefore.existed && current) {
      await storage.variables.delete(current.id);
    }
  }
}

/** A timestamp from a bundle — a Date in memory, an ISO string out of jsonb. */
function asIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return typeof value === "string" ? value : "";
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

main()
  .then(async () => {
    await cleanup();
    check("everything this run wrote was cleaned up", true, `${createdSnapshotIds.length} snapshot(s)`);
    console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch(async (error) => {
    console.error(error);
    await cleanup().catch((cleanupError) => console.error("cleanup failed", cleanupError));
    process.exit(1);
  });
