import type { Comm, EdlsSheet, Snapshot } from "@shared/schema";
import type { SnapshotNode } from "@shared/snapshots";
import { formatYmd, getTodayYmd, isValidYmd, isYmdBefore } from "@shared/utils/date";
import {
  EventType,
  type EdlsSheetSavedPayload,
} from "../../../services/event-bus";
import { absoluteUrl } from "../../../lib/base-url";
import { logger } from "../../../logger";
import { registerEventNotifier } from "../registry";
import {
  type EventNotifierEventContext,
  type EventNotifierPlugin,
  type NotificationMedium,
  type NotifierMessageContent,
  type NotifierRecipient,
} from "../types";

function payloadOf(ctx: EventNotifierEventContext): EdlsSheetSavedPayload {
  return ctx.payload as EdlsSheetSavedPayload;
}

/**
 * Read the required trigger-status list off a config's `data`. An empty list
 * means the config can never fire — a misconfigured config must never text
 * every assigned worker on every save.
 */
function configuredStatuses(configData: unknown): string[] {
  const data =
    configData && typeof configData === "object"
      ? (configData as Record<string, unknown>)
      : {};
  const values = data.statuses;
  if (!Array.isArray(values)) return [];
  return values.filter((v): v is string => typeof v === "string");
}

/**
 * Whether the sheet's date is one workers can still act on: today or later.
 *
 * `ymd` is a date-only column, so it is compared as a plain `YYYY-MM-DD`
 * string against the same local "today" the rest of the server uses (the TOS
 * view, the public schedule, dispatch polling). No `Date` is constructed —
 * that would reintroduce the timezone drift these helpers exist to avoid.
 *
 * A missing or malformed date fails CLOSED: it is not notifiable. The
 * alternative is guessing at what day the sheet is for and texting workers
 * about it, which is exactly the wrong answer to be confident about — same
 * stance the status gate takes on a config with no trigger statuses.
 */
function isNotifiableSheetYmd(ymd: unknown): boolean {
  if (!isValidYmd(ymd)) return false;
  return !isYmdBefore(ymd, getTodayYmd());
}

/**
 * The message body for a worker who IS on the sheet. Fixed wording: the link
 * differs per recipient, and token record roots are built once per event
 * rather than once per recipient, so this notifier composes its own message
 * instead of going through the template path.
 */
const SENTENCE =
  "Your crew assignment has been posted or updated. Please follow the link below and accept.";

/**
 * The message body for a worker who has been TAKEN OFF the sheet. Names the
 * date, because the worker's only cue is the text itself: they are not being
 * pointed at a row they can open, and they may be on other crews that week.
 */
function removedSentence(ymd: string): string {
  const when = isValidYmd(ymd) ? formatYmd(ymd, "weekday-long") : ymd;
  return `You are no longer scheduled on the crew for ${when}. Please follow the link below for your current schedule.`;
}

/**
 * The worker's own EDLS schedule page, keyed by THEIR access token.
 *
 * `/edls-sched/:access_uuid` is the public worker schedule page: holding the
 * access token is the credential, the page is logged-out readable, and it
 * decides for itself which sheets it will show. The token is the worker's
 * (`worker.aat`), not the assignment's and not the worker's own id: it
 * survives the assignment being edited, moved between crews or deleted — a
 * worker taken off the sheet has no assignment id to be named by at all — and
 * unlike the worker id, which appears in staff URLs and exports, it can be
 * regenerated to revoke every link already sent. The route is not re-spelled
 * anywhere else in this plugin.
 *
 * Absolute, because an SMS is read outside the app.
 */
function workerScheduleUrl(accessUuid: string): string {
  return absoluteUrl(`/edls-sched/${accessUuid}`);
}

/**
 * The component that owns the access token the link is keyed by. This
 * notifier needs it as much as it needs `edls`, and the registry gates a
 * plugin on ONE component — so this notifier enforces the second itself,
 * loudly, rather than the framework growing a list for one plugin.
 */
const ACCESS_TOKEN_COMPONENT = "worker.aat";

/**
 * The worker's access token, minted if they have never had one.
 *
 * Get-or-create, never set: a worker who already holds a token keeps it, so
 * links from earlier texts go on working even when several sends land at
 * once. Null when no token could be issued — the caller drops that recipient
 * rather than texting them a link that cannot resolve.
 */
async function resolveAccessToken(workerId: string): Promise<string | null> {
  const { storage } = await import("../../../storage");
  try {
    const { record } = await storage.workerAat.ensureAccessUuid(workerId);
    if (record.accessUuid) return record.accessUuid;
    logger.error("EDLS worker SMS notifier got no access token for a worker", {
      service: "edls-sheet-worker-sms-notifier",
      workerId,
    });
    return null;
  } catch (error) {
    logger.error("EDLS worker SMS notifier could not issue a worker access token", {
      service: "edls-sheet-worker-sms-notifier",
      workerId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * One assignment a text speaks for, carrying the values it held when it was
 * resolved: the receipt written after the send has to prove it is recording
 * the message against the same assignment the message was about.
 */
interface ResolvedAssignment {
  assignmentId: string;
  data: unknown;
}

/**
 * What each recipient contact was resolved from, remembered for the span of
 * one dispatched event. `getRecipients` already works out who is on the sheet
 * and who has come off it; `getMessage` needs the same answer to pick the
 * wording and build that recipient's link, and re-deriving it per message
 * would both cost queries per worker and risk answering differently than the
 * recipient list did. Keyed weakly by the event context, so it is dropped with
 * the event.
 *
 * `covered` is EVERY assignment an assigned worker's text speaks for — a
 * worker assigned twice on a sheet gets one text about both rows, and all of
 * them are receipted, or the rows the text did not mention would still be
 * waiting to be texted and would text the worker again at the next status
 * arrival with nothing changed.
 *
 * A REMOVED worker has no assignment on this sheet by definition, which is
 * exactly why they are a separate shape rather than one with an empty list:
 * there is nothing for the receipt write-back to record, and the difference is
 * what the message wording branches on.
 */
type ResolvedRecipient =
  | {
      kind: "assigned";
      workerId: string;
      accessUuid: string;
      covered: ResolvedAssignment[];
    }
  | { kind: "removed"; workerId: string; accessUuid: string };

const recipientByContact = new WeakMap<
  EventNotifierEventContext,
  Map<string, ResolvedRecipient>
>();

/** Entity type the snapshot service files EDLS sheet bundles under. */
const SHEET_SNAPSHOT_ENTITY_TYPE = "edls_sheet";

/**
 * How much of a sheet's history to read at a time while looking back for the
 * last save at a notifying status. This is a read size, NOT a depth limit: the
 * search pages on until it finds that save or reaches the start of the sheet's
 * history. A sheet accumulates one snapshot per status transition, and the
 * save being looked for is usually the newest one, so one page normally ends
 * it.
 */
const BASELINE_SNAPSHOT_PAGE = 20;

/**
 * A timestamp as milliseconds, whatever shape it arrives in — a `Date` from a
 * live row, an ISO string out of a jsonb bundle. Null when it is neither.
 */
function toMillis(value: unknown): number | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.getTime();
  }
  if (typeof value === "string") {
    const parsed = new Date(value).getTime();
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

/**
 * The sheet's `changed` stamp as captured in a snapshot bundle: the identity
 * of the save the snapshot is OF. Read off the raw node rather than through
 * the decoder, so history can be ordered before deciding which bundles are
 * worth decoding.
 */
function capturedSheetChanged(node: unknown): unknown {
  if (!node || typeof node !== "object") return null;
  const data = (node as { data?: unknown }).data;
  if (!data || typeof data !== "object") return null;
  return (data as { changed?: unknown }).changed ?? null;
}

/**
 * The status a snapshot bundle was captured at, read off the raw node for the
 * same reason as the stamp: it decides whether a bundle is worth decoding at
 * all. A bundle whose status cannot be read this way is NOT dismissed — it is
 * kept as a candidate, so the decoder gets to say out loud that it cannot read
 * it, rather than the search stepping quietly over it.
 */
function capturedSheetStatus(node: unknown): string | null {
  if (!node || typeof node !== "object") return null;
  const data = (node as { data?: unknown }).data;
  if (!data || typeof data !== "object") return null;
  const status = (data as { status?: unknown }).status;
  return typeof status === "string" ? status : null;
}

/**
 * The worker ids that were on this sheet as of the last save this config would
 * have notified about, or null when there is no such save to compare against.
 *
 * The baseline is PER CONFIG: each config carries its own trigger statuses, so
 * "the last time this config spoke to these workers" is a different save for a
 * config that fires on `lock` than for one that also fires on `reserved`. The
 * captured status is read from the snapshot's own sheet bundle rather than
 * from its label, which is prose meant for humans.
 *
 * The history is complete when this runs: each save writes its own snapshot
 * inside its transaction (see `captureEntitySnapshot`), so every save that
 * committed before this one has a snapshot committed with it — including THIS
 * save, whose snapshot is therefore present and must not be mistaken for the
 * baseline.
 *
 * WHICH SAVE a snapshot is of is read out of the snapshot itself — the sheet's
 * `changed` stamp, captured with the rest of the bundle — rather than from the
 * row's own timestamp, which merely says when it was written. This save's
 * snapshot carries exactly this save's stamp and is excluded by a strict
 * comparison, so no timing is involved in ruling it out; older bundles from
 * before the sheet's own columns were captured fall back to their write time.
 */
async function resolveBaselineWorkerIds(
  sheet: EdlsSheet,
  configData: unknown,
): Promise<Set<string> | null> {
  const triggers = new Set(configuredStatuses(configData));
  if (triggers.size === 0) return null;

  const { storage } = await import("../../../storage");
  const { decodeEdlsSheetSnapshot } = await import(
    "../../../modules/edls/snapshot-decode"
  );

  const changed = toMillis(sheet.changed);
  if (changed === null) {
    // Without the save's own stamp there is nothing to order history against.
    logger.error("EDLS worker SMS notifier cannot place a save in the sheet's history", {
      service: "edls-sheet-worker-sms-notifier",
      sheetId: sheet.id,
      changed: String(sheet.changed),
    });
    return null;
  }

  // Walk the sheet's history backwards, a page at a time, until a save this
  // config notifies about turns up or the history runs out. It is walked to
  // the END rather than to some fixed depth: a sheet that has cycled through
  // other statuses many times since the last `lock` still has exactly one
  // right answer, and stopping short of it would not read as "stopped short",
  // it would read as "nobody was removed" — and the notice, once skipped, can
  // never be recovered, because the next baseline no longer holds the worker.
  // Pages keep the whole of a long history out of memory; the search normally
  // ends on the first one, since the previous save is the newest row.
  const candidates: Array<{ snapshot: Snapshot; savedAt: number }> = [];
  for (let offset = 0; candidates.length === 0; offset += BASELINE_SNAPSHOT_PAGE) {
    const page = await storage.snapshots.listRecent(
      SHEET_SNAPSHOT_ENTITY_TYPE,
      sheet.id,
      BASELINE_SNAPSHOT_PAGE,
      offset,
    );
    if (page.length === 0) break;

    // Everything on this page captured for an EARLIER save than this one.
    //
    // Bundles from before the sheet's own columns were captured whole carry no
    // save stamp. They fall back to when they were written, which is all the
    // ordering they ever had: the hazard the stamp exists for is a snapshot of
    // a save close enough in time to be confused with this one, and any bundle
    // old enough to lack a stamp is nowhere near this save.
    for (const snapshot of page) {
      const savedAt =
        toMillis(capturedSheetChanged(snapshot.data)) ?? toMillis(snapshot.createdAt);
      if (savedAt === null || savedAt >= changed) continue;
      const status = capturedSheetStatus(snapshot.data);
      if (status !== null && !triggers.has(status)) continue;
      candidates.push({ snapshot, savedAt });
    }
    if (page.length < BASELINE_SNAPSHOT_PAGE) break;
  }
  // Newest save first. Pages arrive in write order, which is save order for
  // anything captured with its save; sorting settles the older rows whose only
  // ordering was when they happened to be written.
  candidates.sort((a, b) => b.savedAt - a.savedAt);

  for (const { snapshot } of candidates) {
    let decoded;
    try {
      decoded = decodeEdlsSheetSnapshot(snapshot.data as SnapshotNode);
    } catch (error) {
      // An undecodable bundle is not an older baseline in disguise: the roster
      // it holds is unknown, and silently walking past it would diff against a
      // sheet from further back and announce removals that already happened.
      logger.error("EDLS worker SMS notifier could not decode a sheet snapshot", {
        service: "edls-sheet-worker-sms-notifier",
        sheetId: sheet.id,
        snapshotId: snapshot.id,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
    const status = decoded.sheet.status;
    if (typeof status !== "string" || !triggers.has(status)) continue;
    const workerIds = new Set<string>();
    for (const assignment of decoded.assignments) {
      const workerId = assignment.workerId;
      if (typeof workerId === "string") workerIds.add(workerId);
    }
    return workerIds;
  }
  return null;
}

/**
 * The workers this save took off the sheet, resolved down to a contact and a
 * number they can be texted at. Empty when there is no baseline to compare
 * against, or when nobody came off.
 *
 * The comparison is against the sheet's FULL roster, deliberately not against
 * the SMS targets: those are narrowed to assignments still waiting to be
 * texted, so a worker who is still on the sheet and merely already holds a
 * receipt is absent from them — diffing against that list would call the whole
 * already-notified sheet "removed" and text every one of them. It also makes
 * removed-then-re-added, and moved-between-crews, the no-ops they should be:
 * both end with the worker on the roster.
 *
 * Contacts and numbers are resolved live rather than read out of the snapshot,
 * because the snapshot records who was assigned, not where to reach them
 * today; a worker whose number has since gone inactive simply drops out.
 */
async function resolveRemovedWorkers(
  sheet: EdlsSheet,
  configData: unknown,
): Promise<Array<{ workerId: string; contactId: string; phoneNumber: string }>> {
  const { isSnapshotCaptureActive } = await import(
    "../../../services/snapshots/capture"
  );
  // Removal notices are entirely a function of captured history, and they are
  // told-once only because THIS save's snapshot becomes the next baseline. With
  // capture switched off there is no next baseline, so a stale one would
  // re-announce the same removal at every transition. Refuse to guess, and say
  // so — the alternative is a setting silently turning a feature off.
  if (!(await isSnapshotCaptureActive(EventType.EDLS_SHEET_SAVED))) {
    logger.error(
      "EDLS worker SMS notifier cannot notify removed workers: snapshot capture for EDLS_SHEET_SAVED is disabled",
      {
        service: "edls-sheet-worker-sms-notifier",
        sheetId: sheet.id,
      },
    );
    return [];
  }

  const baseline = await resolveBaselineWorkerIds(sheet, configData);
  if (!baseline || baseline.size === 0) return [];

  const { storage } = await import("../../../storage");
  const roster = await storage.edlsAssignments.getBySheetId(sheet.id);
  const assigned = new Set(roster.map((assignment) => assignment.workerId));
  const removedIds = Array.from(baseline).filter((id) => !assigned.has(id));
  if (removedIds.length === 0) return [];

  return storage.workers.getSmsContactsByWorkerIds(removedIds);
}

/**
 * Texts the WORKERS assigned to an EDLS sheet when the sheet ARRIVES at one of
 * the admin-selected statuses (in practice "Locked"): a status change, or a
 * sheet created directly in that status. Saves that leave the status unchanged
 * never fire.
 *
 * DELIBERATELY BLIND TO PAST SHEETS. A sheet dated before today never texts
 * anyone, whatever its status change: the message tells a worker to go accept
 * a crew assignment, and there is nothing left to accept on a day that has
 * already happened. Re-locking or correcting an old sheet is a routine
 * back-office act and used to blast every assigned worker with a text that was
 * always wrong. This is unconditional — there is no admin setting for it, and
 * it is not a bug to "fix" back. A sheet dated today or later is unaffected.
 *
 * Workers TAKEN OFF the sheet since the last save this config notified about
 * are texted too, with their own wording: being dropped from a crew is at
 * least as much news as being added to one, and nothing else tells them. Who
 * was on the sheet then is read back out of the snapshot captured for that
 * save, so no removal is recorded anywhere at the moment it happens — which is
 * what makes it work when a whole crew is deleted and its assignments go with
 * it by database cascade, with no application code running at all.
 *
 * This is deliberately separate from `edls-sheet-status-notifier`, which
 * notifies the sheet's STAFF (supervisor, assignee, crew supervisors) across
 * every medium. Here the recipients are the sheet's workers, the only medium
 * is SMS, and each worker's message carries a link to their OWN schedule.
 * That sibling notifier intentionally does NOT share the past-date rule: staff
 * still want to hear about corrections to a finished day, because a correction
 * is the whole point of the message they get.
 *
 * Recipients are pre-filtered to workers who can actually receive a text — an
 * active primary number that has recorded an SMS opt-in — because the SMS
 * sender records a FAILED communication for every un-opted-in number it is
 * handed, and a locked sheet should not litter the comm log with one failure
 * per opted-out worker.
 *
 * OPT-IN PER SHEET. The sheet's own `notificationsEnabled` flag has to be on
 * or nothing is sent, and it is off on every sheet until somebody turns it on
 * from Manage Sheet. Turning it on is not retroactive: it takes effect at the
 * sheet's next arrival at a trigger status, so a sheet already past that
 * status stays silent. The staff `edls-sheet-status-notifier` ignores the
 * flag — supervisors and assignees are told about their sheets either way.
 */
export const edlsSheetWorkerSmsNotifier: EventNotifierPlugin = {
  id: "edls-sheet-worker-sms-notifier",
  name: "EDLS Sheet Worker SMS Notifier",
  description:
    "Texts the workers assigned to an EDLS sheet, each with a link to their own schedule, when the sheet arrives at one of the selected statuses. Only sheets with notifications enabled on their Manage Sheet page are sent; the flag is off on every sheet until somebody turns it on. Requires the Worker Access Tokens (worker.aat) component as well as EDLS: the link is keyed by the worker's access token, and with that component disabled this notifier texts nobody and fails with an error in the server log.",
  order: 110,
  requiredComponent: "edls",
  subscribedEvents: [EventType.EDLS_SHEET_SAVED],
  supportedMedia: ["sms"],
  configSchema: {
    type: "object",
    required: ["statuses"],
    properties: {
      statuses: {
        type: "array",
        title: "Trigger statuses",
        description:
          "Text the assigned workers when a sheet arrives at one of these statuses (by status change, or by being created in one). At least one status is required.",
        minItems: 1,
        uniqueItems: true,
        items: {
          type: "string",
          enum: ["draft", "request", "lock", "trash", "reserved"],
          enumNames: ["Draft", "Request", "Locked", "Trash", "Reserved"],
        },
      },
    },
  },

  async shouldDispatch(ctx, configData): Promise<boolean> {
    const { previousStatus, newStatus, sheet } = payloadOf(ctx);
    // Arrival semantics, same as the staff notifier: creates carry
    // previousStatus: null (never equal to a real status), so a sheet created
    // directly in a configured status fires; an edit that leaves the status
    // alone never does.
    if (!newStatus) return false;
    if (newStatus === previousStatus) return false;
    const triggers = new Set(configuredStatuses(configData));
    if (triggers.size === 0) return false;
    if (!triggers.has(newStatus)) return false;
    // Nothing left to accept on a day that has already happened, so a
    // past-dated sheet is never worth a text. See the plugin doc comment.
    if (!isNotifiableSheetYmd(sheet?.ymd)) return false;
    // Per-sheet opt-in, off unless somebody turned it on for THIS sheet. Read
    // off the sheet the save event carries, not re-loaded. It sits with the
    // cheap payload checks, deliberately BEFORE the component check below
    // that throws: a sheet whose flag is off is a legitimate "notify nobody",
    // not a misconfiguration, and must not be recorded as a failed config.
    if (sheet?.notificationsEnabled !== true) return false;

    // This config WOULD fire — so a missing `worker.aat` is refused here,
    // loudly, and only here. Every message this notifier sends is a link
    // keyed by the worker's access token, and that component owns it: without
    // it there is no token to mint, no page to reach, and nothing honest to
    // text anybody. Throwing rather than returning false is the point: the
    // dispatcher records the whole send as a failed config (server log and
    // the admin log viewer), where returning false would be indistinguishable
    // from a sheet that legitimately notified nobody and the first anyone
    // would hear of it is workers not getting texts. It happens before
    // recipients are resolved, so nothing is sent and no receipt is written —
    // every assignment stays owed a text and gets one once the component is
    // enabled.
    const { isComponentEnabled } = await import("../../../modules/components");
    if (!(await isComponentEnabled(ACCESS_TOKEN_COMPONENT))) {
      throw new Error(
        `EDLS worker SMS notifier cannot send: the '${ACCESS_TOKEN_COMPONENT}' component is not enabled, and the schedule link it texts is keyed by that component's worker access token. Enable Worker Access Tokens, or disable this notifier's configs.`,
      );
    }
    return true;
  },

  async getRecipients(ctx, configData): Promise<NotifierRecipient[]> {
    const { sheetId, sheet } = payloadOf(ctx);
    const { storage, createCommSmsOptinStorage } = await import(
      "../../../storage"
    );

    // Assignments already narrowed to workers with an active primary phone
    // who do NOT hold a receipt for the assignment as it currently stands,
    // ordered by assignment id so a repeated worker always resolves in the
    // same order. Re-locking a sheet nobody edited therefore leaves nothing
    // here.
    const targets =
      await storage.edlsAssignments.getSmsTargetsBySheetId(sheetId);
    const removed = await resolveRemovedWorkers(sheet, configData);
    if (targets.length === 0 && removed.length === 0) return [];

    // Grouped per contact, keeping the id order: a worker assigned twice on
    // the same sheet is texted ONCE — and that one text speaks for every
    // assignment of theirs in the group, which is why they are all kept
    // rather than only the first.
    const byContact = new Map<string, (typeof targets)[number][]>();
    for (const target of targets) {
      const group = byContact.get(target.contactId);
      if (group) group.push(target);
      else byContact.set(target.contactId, [target]);
    }

    // Drop anyone whose number has not recorded an SMS opt-in before the
    // sender turns them into a failed communication record. One read for both
    // groups: an opted-out worker taken off a sheet would litter the comm log
    // with a failure exactly as an assigned one would.
    const optins = await createCommSmsOptinStorage().getSmsOptinsByPhoneNumbers([
      ...Array.from(byContact.values()).map((group) => group[0].phoneNumber),
      ...removed.map((worker) => worker.phoneNumber),
    ]);

    // The access token every message is keyed by is resolved HERE, with the
    // recipients and before any message is composed: a worker whose token
    // cannot be issued has no working link to be sent, so they are not a
    // recipient at all rather than one who gets a text that goes nowhere.
    const resolved = new Map<string, ResolvedRecipient>();
    const recipients: NotifierRecipient[] = [];
    for (const [contactId, group] of byContact) {
      if (!optins.get(group[0].phoneNumber)?.optin) continue;
      const accessUuid = await resolveAccessToken(group[0].workerId);
      if (!accessUuid) continue;
      resolved.set(contactId, {
        kind: "assigned",
        workerId: group[0].workerId,
        accessUuid,
        covered: group.map((t) => ({ assignmentId: t.assignmentId, data: t.data })),
      });
      recipients.push({ contactId });
    }
    for (const worker of removed) {
      // Being on the sheet wins: a contact already resolved as assigned is a
      // person with work on this sheet, whatever an older roster said, and
      // they must not be told they are off it.
      if (resolved.has(worker.contactId)) continue;
      if (!optins.get(worker.phoneNumber)?.optin) continue;
      // A removed worker holds no assignment row, but the link they are sent
      // is the same one an assigned worker gets, so it is keyed the same way.
      const accessUuid = await resolveAccessToken(worker.workerId);
      if (!accessUuid) continue;
      resolved.set(worker.contactId, {
        kind: "removed",
        workerId: worker.workerId,
        accessUuid,
      });
      recipients.push({ contactId: worker.contactId });
    }

    recipientByContact.set(ctx, resolved);
    return recipients;
  },

  async getMessage(
    medium: NotificationMedium,
    recipient: NotifierRecipient,
    ctx: EventNotifierEventContext,
  ): Promise<NotifierMessageContent | null> {
    if (medium !== "sms") return null;
    const resolved = recipientByContact.get(ctx)?.get(recipient.contactId);
    // Nothing resolved means this recipient did not come from the reads above;
    // there is no honest thing to tell them.
    if (!resolved) return null;
    const link = workerScheduleUrl(resolved.accessUuid);
    if (resolved.kind === "removed") {
      const { sheet } = payloadOf(ctx);
      return { message: `${removedSentence(sheet.ymd)} ${link}` };
    }
    return { message: `${SENTENCE} ${link}` };
  },

  /**
   * Record the text on the assignment it was about, so a sheet can show who
   * was contacted and what they were sent.
   *
   * The recorded communication is a RECEIPT, not just a link: it means this
   * worker has been told about the assignment AS IT STOOD when the message
   * went out, and holding one is what keeps them out of the next send. Any
   * change to the assignment voids it (see `updateData`), so the next arrival
   * at a trigger status texts the workers whose rows changed and nobody else.
   *
   * Reuses the same per-event contact → assignment map the message was built
   * from, which is what makes the recorded link and the link inside the text
   * necessarily the same assignment. The assignment's values are handed back
   * with it so a row edited while the text was in flight keeps its voided
   * receipt instead of being handed one for the version it no longer holds.
   *
   * EVERY assignment the text spoke for is receipted, not just the one it
   * linked to. A worker assigned twice on a sheet is deliberately texted once;
   * receipting only the linked row would leave the other still waiting to be
   * texted, and the next status arrival would text that worker again with
   * nothing changed. Each row is guarded by its own values, so a row edited
   * mid-send keeps the resend it earned while its siblings are still
   * receipted.
   *
   * Deliberately records failures too: the framework calls this whenever a
   * comm record exists, and a failed or undelivered text still counts as
   * told — there is no automatic retry, and a coordinator forces a resend by
   * editing the row like any other change. A worker whose text bounced is
   * also a more useful thing to see on a sheet than one indistinguishable
   * from a worker nobody tried to reach. Workers with no active primary
   * number and workers who never opted in are filtered out before sending, so
   * they are never recorded — they were genuinely not contacted.
   *
   * A worker TAKEN OFF the sheet has no assignment row on it, so there is
   * nothing here to record their text against and nothing that could gate a
   * later one: they are skipped, not failed. Their notice is told-once
   * because this save's snapshot becomes the next baseline and no longer
   * lists them, not because of anything written here.
   */
  async onCommCreated(
    medium: NotificationMedium,
    recipient: NotifierRecipient,
    comm: Comm,
    ctx: EventNotifierEventContext,
  ): Promise<void> {
    if (medium !== "sms") return;
    const resolved = recipientByContact.get(ctx)?.get(recipient.contactId);
    if (!resolved || resolved.kind !== "assigned") return;
    const { storage } = await import("../../../storage");
    // A false return means there was nothing to record onto: the assignment
    // was deleted between the text going out and this write, it was edited in
    // that window (so it is owed a fresh text, not this receipt), or a later
    // text already claimed the slot. The worker was still texted either way,
    // and none of the three is repairable here.
    for (const assignment of resolved.covered) {
      await storage.edlsAssignments.setCommId(
        assignment.assignmentId,
        comm.id,
        assignment.data,
      );
    }
  },
};

registerEventNotifier(edlsSheetWorkerSmsNotifier);
