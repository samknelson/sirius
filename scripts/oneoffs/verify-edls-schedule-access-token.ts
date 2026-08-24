/**
 * One-off verification for Task #1300 — the EDLS worker schedule link is
 * keyed by the worker's `worker.aat` access token.
 *
 * Phases, run against the dev database in this order:
 *
 *   off      with `worker.aat` disabled: the notifier refuses loudly and the
 *            public page is unreachable. Run BEFORE enabling.
 *   enable   turn `worker.aat` on (creates its table). Restart the app after.
 *   on       with both components on: minting is get-or-create and race-safe,
 *            the token resolves to its worker, the notifier links by it, the
 *            page opens, and regenerating breaks the old link.
 *   disable  put `worker.aat` back the way it was found (data retained).
 *
 * Usage:
 *   npx tsx scripts/oneoffs/verify-edls-schedule-access-token.ts <phase> \
 *     [--worker=<id>] [--fresh-worker=<id>] [--sheet=<id>]
 *
 * The ids are supplied rather than searched for: this script owns no SQL.
 * `--worker` is a worker with EDLS presence, `--fresh-worker` one who has
 * never held a token (for the race), `--sheet` a future-dated sheet they are
 * assigned to.
 */
import { randomUUID } from "crypto";
import { storage } from "../../server/storage";
import { absoluteUrl } from "../../server/lib/base-url";
import { loadComponentCache, updateComponentCache } from "../../server/services/component-cache";
import {
  enableComponentSchema,
  disableComponentSchema,
} from "../../server/services/component-lifecycle";
import { edlsSheetWorkerSmsNotifier } from "../../server/plugins/event-notifier/plugins/edls-sheet-worker-sms-notifier";

let failures = 0;

function check(ok: boolean, label: string, detail?: unknown) {
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${label}${detail === undefined ? "" : ` — ${JSON.stringify(detail)}`}`,
  );
  if (!ok) failures++;
}

function arg(name: string): string | undefined {
  return process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
}

const CONFIG = { statuses: ["lock"] };

/** A fired-event context shaped like the one the dispatcher hands over. */
async function sheetArrivedAtLock(sheetId: string) {
  const sheet = await storage.edlsSheets.get(sheetId);
  return {
    eventType: "EDLS_SHEET_SAVED",
    payload: {
      sheetId,
      previousStatus: "draft",
      newStatus: "lock",
      sheet: sheet ?? { id: sheetId, ymd: "2099-01-01" },
    },
  } as any;
}

async function get(id: string) {
  const res = await fetch(absoluteUrl(`/api/public/edls/schedule/${encodeURIComponent(id)}`));
  return { status: res.status, body: await res.text() };
}

async function phaseOff() {
  await loadComponentCache();

  // 1. The notifier refuses at dispatch, naming the missing component. It
  //    refuses from shouldDispatch, which the dispatcher calls before it
  //    resolves recipients — so nothing is texted and no receipt is written.
  let thrown: unknown;
  try {
    await edlsSheetWorkerSmsNotifier.shouldDispatch!(
      await sheetArrivedAtLock(arg("sheet") ?? randomUUID()),
      CONFIG,
    );
  } catch (error) {
    thrown = error;
  }
  const message = thrown instanceof Error ? thrown.message : String(thrown ?? "");
  check(thrown !== undefined, "notifier fails rather than silently sending nothing");
  check(message.includes("worker.aat"), "the failure names the missing component", message);

  // 2. The public page is unreachable while the credential's component is off.
  const refused = await get(randomUUID());
  check(refused.status === 403, "public schedule refuses with worker.aat off", refused.status);
  check(
    refused.body.toLowerCase().includes("component"),
    "and it is the component gate refusing",
    refused.body.slice(0, 200),
  );
}

/**
 * The refusal as the dispatcher really sees it: fire EDLS_SHEET_SAVED through
 * the event bus with `worker.aat` off and confirm the whole send is a visible
 * failure — an error log naming the component — with nothing texted and no
 * assignment left holding a receipt for a message that never went out.
 *
 * The payload is fabricated (nothing is saved) so the run costs the database
 * nothing but the log line, and its `sheet.ymd` is moved forward so the date
 * gate cannot be what refuses.
 */
async function phaseDispatchOff() {
  await loadComponentCache();
  const sheetId = arg("link-sheet")!;
  const { eventBus, EventType } = await import("../../server/services/event-bus");
  const { initializeEventNotifierDispatcher } = await import(
    "../../server/plugins/event-notifier/dispatcher"
  );
  initializeEventNotifierDispatcher();

  const owedBefore = (await storage.edlsAssignments.getSmsTargetsBySheetId(sheetId)).length;
  check(owedBefore > 0, "the sheet has workers owed a text", owedBefore);

  const sheet = (await storage.edlsSheets.get(sheetId))!;
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

  // Where the failure surfaces is the point of this phase, so it is captured
  // from the server's own log stream rather than asserted about in the
  // abstract. The app logger writes to the console only — the admin log
  // viewer is fed by the storage logger — so the console IS the report for a
  // failed config, and it is checked below that the viewer is not.
  let captured = "";
  const realWrite = process.stdout.write.bind(process.stdout);
  (process.stdout as any).write = (chunk: any, ...rest: any[]) => {
    captured += String(chunk);
    return realWrite(chunk, ...rest);
  };
  try {
    await eventBus.emit(EventType.EDLS_SHEET_SAVED, {
      sheetId,
      previousStatus: "draft",
      newStatus: "lock",
      sheet: { ...sheet, ymd: tomorrow },
    });
  } finally {
    (process.stdout as any).write = realWrite;
  }

  check(
    captured.includes("Event-notifier dispatch failed for config"),
    "the dispatcher reports the whole config as a failed dispatch",
  );
  check(
    captured.includes("worker.aat") && captured.includes("edls-sheet-worker-sms-notifier"),
    "and the report names the missing component and the notifier",
  );

  const owedAfter = (await storage.edlsAssignments.getSmsTargetsBySheetId(sheetId)).length;
  check(
    owedAfter === owedBefore,
    "no assignment was marked as notified",
    { owedBefore, owedAfter },
  );
}

async function phaseEnable() {
  const result = await enableComponentSchema("worker.aat");
  check(result.success, "worker.aat schema enabled", result.error ?? result.schemaOperations);
  await updateComponentCache("worker.aat", true);
  console.log("Restart the app before running the `on` phase.");
}

async function phaseDisable() {
  await updateComponentCache("worker.aat", false);
  const result = await disableComponentSchema("worker.aat", { retainData: true });
  check(result.success, "worker.aat disabled, data retained", result.error ?? result.schemaOperations);
  console.log("Restart the app to put the running server back in step.");
}

async function phaseOn() {
  await loadComponentCache();
  const workerId = arg("worker")!;
  const freshWorkerId = arg("fresh-worker")!;
  const sheetId = arg("sheet")!;

  // 1. Get-or-create issues once and then never again.
  const before = await storage.workerAat.getByWorker(workerId);
  const first = await storage.workerAat.ensureAccessUuid(workerId);
  check(!!first.record.accessUuid, "a worker who had none is issued a token");
  check(first.issued === !before?.accessUuid, "`issued` tells a genuine mint from a reuse", {
    issued: first.issued,
    hadOne: !!before?.accessUuid,
  });
  const token = first.record.accessUuid!;
  const second = await storage.workerAat.ensureAccessUuid(workerId);
  check(second.record.accessUuid === token, "being texted again keeps the same token");
  check(second.issued === false, "a reuse is not recorded as an issue");

  // 2. Several sends landing at once resolve to ONE value.
  const raced = await Promise.all(
    Array.from({ length: 5 }, () => storage.workerAat.ensureAccessUuid(freshWorkerId)),
  );
  const values = new Set(raced.map((r) => r.record.accessUuid));
  check(values.size === 1, "five concurrent sends agree on one token", values.size);
  check(
    raced.filter((r) => r.issued).length === 1,
    "exactly one of them is the issue",
    raced.map((r) => r.issued),
  );

  // 3. The reverse read, and what it must never match.
  const byToken = await storage.workerAat.getByAccessUuid(token);
  check(byToken?.workerId === workerId, "the token resolves to its worker");
  check((await storage.workerAat.getByAccessUuid("")) === undefined, "a blank id matches nobody");
  check(
    (await storage.workerAat.getByAccessUuid("   ")) === undefined,
    "a whitespace id matches nobody",
  );
  check(
    (await storage.workerAat.getByAccessUuid(workerId)) === undefined,
    "a worker UUID is not a token",
  );
  check(
    (await storage.workerAat.getByAccessUuid(randomUUID())) === undefined,
    "an unknown UUID matches nobody",
  );

  // 4. The page opens for the token, and for nothing else.
  const opened = await get(token);
  check(opened.status === 200, "the texted link opens the schedule", opened.status);
  const byWorkerUuid = await get(workerId);
  check(byWorkerUuid.status === 403, "a worker UUID no longer opens the page", byWorkerUuid.status);
  const unknown = await get(randomUUID());
  check(unknown.status === 403, "an unknown id is refused", unknown.status);
  const malformed = await get("not-a-uuid");
  check(malformed.status === 403, "a malformed id is refused", malformed.status);
  const blank = await get(" ");
  check(blank.status === 403, "a blank id is refused", blank.status);
  check(
    new Set([byWorkerUuid.body, unknown.body, malformed.body, blank.body]).size === 1,
    "every refusal is the same generic answer",
    [unknown.body.slice(0, 120), malformed.body.slice(0, 120)],
  );

  // 5. Regenerating from the Access Tokens tab kills the old link.
  const regenerated = randomUUID();
  await storage.workerAat.setAccessUuid(workerId, regenerated);
  check((await get(token)).status === 403, "the old link stops working");
  check((await get(regenerated)).status === 200, "the new one works");
  const afterRegen = await storage.workerAat.ensureAccessUuid(workerId);
  check(
    afterRegen.record.accessUuid === regenerated && !afterRegen.issued,
    "the next text carries the regenerated token",
  );

  // 6. The notifier links by the token, never by the worker id.
  const ctx = await sheetArrivedAtLock(sheetId);
  check(
    (await edlsSheetWorkerSmsNotifier.shouldDispatch!(ctx, CONFIG)) === true,
    "with both components on, the notifier dispatches",
  );
  // Recipients come from whichever sheet actually has SMS-reachable workers
  // on it, which need not be the future-dated one used for the gate above.
  const linkCtx = await sheetArrivedAtLock(arg("link-sheet") ?? sheetId);
  const recipients = await edlsSheetWorkerSmsNotifier.getRecipients!(linkCtx, CONFIG);
  console.log(`  (notifier resolved ${recipients.length} recipient(s))`);
  for (const recipient of recipients) {
    const composed = await edlsSheetWorkerSmsNotifier.getMessage!("sms", recipient, linkCtx, CONFIG);
    const body = composed?.message ?? "";
    const linked = /\/edls-sched\/([^\s]+)/.exec(body)?.[1];
    const resolved = linked ? await storage.workerAat.getByAccessUuid(linked) : undefined;
    check(!!resolved, "the texted link carries a resolvable access token", body);
    check(linked !== resolved?.workerId, "and not the worker's own id");
    check(
      linked ? (await get(linked)).status === 200 : false,
      "and following it opens that worker's week",
    );
  }

  // The tokens this run touched, so the caller can scan the logs for them.
  console.log(`\nTokens to scan for in winston_logs: ${token} ${regenerated}`);
}

async function main() {
  const phase = process.argv[2];
  switch (phase) {
    case "off":
      await phaseOff();
      break;
    case "enable":
      await phaseEnable();
      break;
    case "on":
      await phaseOn();
      break;
    case "dispatch-off":
      await phaseDispatchOff();
      break;
    case "disable":
      await phaseDisable();
      break;
    default:
      console.log("Usage: verify-edls-schedule-access-token.ts off|enable|on|disable");
      process.exit(2);
  }
  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
