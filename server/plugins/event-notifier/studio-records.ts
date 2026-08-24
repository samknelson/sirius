import { eventBus, type RecentEmitEntry } from "../../services/event-bus";
import { logger } from "../../logger";
import { CONTACT_ROOT_NAME } from "../tokens/plugins/contact";
import type { TokenPreviewRecordRef } from "../tokens/types";
import type {
  EventNotifierEventContext,
  EventNotifierPlugin,
  NotifierRecordRoot,
} from "./types";

/**
 * The real records a notifier's template editor may preview against:
 * the ones its recent events would have been sent about.
 *
 * A notifier config is not about a record the way a bulk message is
 * about its recipients — it describes events that have not happened
 * yet — so there is no list of records for it to hand over. What there
 * IS, is a list of the times it already happened: the event bus keeps
 * the last hundred emits of each event type in memory, and this replays
 * the notifier's OWN root builders over those recorded payloads, which
 * is exactly what the dispatcher did when each one fired. An author
 * previewing "Grievance status changed" therefore sees the grievances
 * whose status actually changed, and sees them as coherent sets: the
 * grievance and the status entry offered together came out of one
 * emit.
 *
 * The config being edited decides which of those times count: the same
 * per-config gate delivery asks before it builds anything is asked here
 * first, so a config that fires on one status is never offered a record
 * from an event at another, and every root plus the recipient list
 * answers for the same set of events.
 *
 * REPLAY YIELDS IDS, NOT ROWS. A recorded payload is a JSON snapshot
 * taken when the event fired; a row rebuilt from it is as old as the
 * emit and may since have changed or been deleted. So the ids the
 * builders produce are handed to the studio as candidates and the
 * kinds load them fresh — the same load a render performs — and a
 * record that no longer exists is left out rather than shown as a
 * picker row that renders nothing.
 *
 * The buffer is per-process and cleared on restart, and an oversized
 * payload is kept only as a truncated marker. Both are ordinary, and
 * both are said plainly where the picker would be rather than left as
 * an unexplained empty list.
 */

/**
 * How many recent events one editor replays. A handful: this is the
 * author's "preview against a real one" list, not an event log.
 */
export const NOTIFIER_STUDIO_SEED_LIMIT = 5;

/**
 * One remembered event the editor is replaying, under the id its
 * records are grouped by. Every root's record and every recipient built
 * from this event carries that id, which is how the studio keeps a
 * preview to ONE event: the grievance and the status entry it shows
 * were true at the same moment, not one from Tuesday and one from now.
 */
interface ReplayedEvent {
  entry: RecentEmitEntry;
  occurrenceId: string;
}

export interface NotifierStudioRecords {
  /** Candidate records per root NAME, newest event first. */
  recordsByRoot: Record<string, TokenPreviewRecordRef[]>;
  /** Why a root got none, in the notifier's own words. */
  emptyRecordsNotes: Record<string, string>;
}

export async function buildNotifierStudioRecords(
  plugin: EventNotifierPlugin,
  configData: unknown,
): Promise<NotifierStudioRecords> {
  const recordsByRoot: Record<string, TokenPreviewRecordRef[]> = {};
  const emptyRecordsNotes: Record<string, string> = {};
  const roots = plugin.tokenTemplates?.roots ?? [];
  if (roots.length === 0) return { recordsByRoot, emptyRecordsNotes };

  // Every event this notifier subscribes to, newest first. Truncated
  // and unserializable payloads are not replayable at all: a builder
  // reading one would either fail or, worse, quietly build a record out
  // of half a payload.
  const remembered = plugin.subscribedEvents
    .flatMap((eventType) => eventBus.getRecentEmits(eventType))
    .sort((a, b) => b.emittedAt.getTime() - a.emittedAt.getTime());
  const replayable = remembered.filter((entry) => !entry.payloadTruncated);
  // ONE eligible set for every root and for the recipients, gated the
  // way delivery gates: the per-config check runs before anything is
  // built, so a config that only fires on one status cannot offer a
  // record from an event it would have ignored.
  const replayed = await eligibleEvents(plugin, replayable, configData);

  // The reasons that are about the buffer or the config rather than
  // about any one root, and that therefore answer for every root at
  // once.
  const sharedNote =
    remembered.length === 0
      ? "Nothing has fired this notifier since the app last started, so there is nothing real to preview against yet. Make the kind of change it watches for, then reopen this editor."
      : replayable.length === 0
        ? `The last ${remembered.length} of these events carried payloads too large to keep, so their records cannot be offered here.`
        : replayed.length === 0
          ? `None of the last ${replayable.length} events this notifier saw match these settings, so it would not have sent anything about them.`
          : undefined;

  for (const root of roots) {
    const records = sharedNote ? [] : await replayRoot(root, replayed, plugin.id);
    recordsByRoot[root.name] = records;
    if (records.length === 0) {
      emptyRecordsNotes[root.name] =
        sharedNote ??
        `None of the last ${replayed.length} matching events carried a ${root.label.toLowerCase()} record.`;
    }
  }

  // The recipient contact is not one of the notifier's declared roots —
  // the framework adds it because delivery resolves a recipient for
  // every message — so it is seeded the way delivery seeds it: by
  // asking the notifier who it would have written to, for the config
  // being edited.
  if (plugin.getRecipients) {
    const contacts = sharedNote
      ? []
      : await replayRecipients(plugin, replayed, configData);
    recordsByRoot[CONTACT_ROOT_NAME] = contacts;
    if (contacts.length === 0) {
      emptyRecordsNotes[CONTACT_ROOT_NAME] =
        sharedNote ??
        `The last ${replayed.length} matching events resolved no recipients.`;
    }
  }

  return { recordsByRoot, emptyRecordsNotes };
}

/**
 * The recent events this config would actually have sent about.
 *
 * Delivery asks `shouldDispatch` BEFORE it builds a single root, so the
 * replay does too, and asks it once for the whole editor rather than
 * per root: an author looking at a config set to one status must not be
 * offered a record from an event at another status — that record is not
 * one this config would ever have written about, and every root plus
 * the recipient list has to agree on which events those are.
 *
 * The whole buffer is scanned for matches (the gate is a predicate over
 * the payload), stopping at the handful the panel shows. A gate that
 * throws on an old payload skips that event only.
 */
async function eligibleEvents(
  plugin: EventNotifierPlugin,
  replayable: RecentEmitEntry[],
  configData: unknown,
): Promise<ReplayedEvent[]> {
  const eligible: ReplayedEvent[] = [];
  const take = (entry: RecentEmitEntry) => {
    // The occurrence id only has to tell these events apart for the
    // length of one editor session — it is how the picker knows which
    // records were true together, never anything the client stores.
    eligible.push({
      entry,
      occurrenceId: `${entry.eventType}#${entry.emittedAt.getTime()}#${eligible.length}`,
    });
  };
  if (!plugin.shouldDispatch) {
    for (const entry of replayable.slice(0, NOTIFIER_STUDIO_SEED_LIMIT)) take(entry);
    return eligible;
  }
  for (const entry of replayable) {
    if (eligible.length >= NOTIFIER_STUDIO_SEED_LIMIT) break;
    try {
      const ok = await plugin.shouldDispatch(
        { event: entry.eventType, payload: entry.payload },
        configData,
      );
      if (ok) take(entry);
    } catch (error) {
      logger.debug("Notifier studio replay could not gate an event", {
        service: "event-notifier",
        pluginId: plugin.id,
        event: entry.eventType,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return eligible;
}

/**
 * Run ONE root's builder over each replayed event, in the order the
 * events fired.
 *
 * The builder is the notifier's own — the very function that seeded
 * this root when the event fired — so a root can never offer a record
 * that delivery would not have used. A builder that returns null (the
 * row is gone, the root is optional) or throws (a payload from an older
 * shape of the event) costs that one event its record and nothing else:
 * an editor that refused to open because a two-week-old payload no
 * longer parses would be a worse answer than a shorter list.
 */
async function replayRoot(
  root: NotifierRecordRoot,
  replayed: ReplayedEvent[],
  pluginId: string,
): Promise<TokenPreviewRecordRef[]> {
  const byId = new Map<string, TokenPreviewRecordRef>();
  for (const { entry, occurrenceId } of replayed) {
    const ctx: EventNotifierEventContext = {
      event: entry.eventType,
      payload: entry.payload,
    };
    let id: string | undefined;
    try {
      const entity = await root.build(ctx);
      const raw = entity?.row?.id;
      id = typeof raw === "string" && raw ? raw : undefined;
    } catch (error) {
      logger.debug("Notifier studio replay could not rebuild a record", {
        service: "event-notifier",
        pluginId,
        root: root.name,
        event: entry.eventType,
        error: error instanceof Error ? error.message : String(error),
      });
      continue;
    }
    if (!id) continue;
    // One record can be the subject of several of these events (the
    // same grievance moving twice), and it is then one picker row that
    // belongs to both: keep the newest and let it carry every
    // occurrence, so choosing the older event's status entry still
    // brings its grievance along.
    const seen = byId.get(id);
    if (seen) {
      seen.occurrenceIds?.push(occurrenceId);
      continue;
    }
    // Id alone: the kind names its own record and says what its gate is
    // asked about. A replay knows which record the event was about; it
    // has no business knowing that, say, a dispatch status row reads as
    // a read of its worker.
    byId.set(id, {
      id,
      hint: describeAge(entry.emittedAt),
      occurrenceIds: [occurrenceId],
    });
  }
  return [...byId.values()];
}

/**
 * Who this notifier would have written to, over the events it would
 * have sent about.
 *
 * The events are already the config's own (see {@link eligibleEvents}),
 * so this is the second half of what dispatch does with them: resolve
 * the recipients the same way, for the config being edited. An author
 * is therefore never offered a preview as somebody this config would
 * not write to.
 */
async function replayRecipients(
  plugin: EventNotifierPlugin,
  replayed: ReplayedEvent[],
  configData: unknown,
): Promise<TokenPreviewRecordRef[]> {
  const byId = new Map<string, TokenPreviewRecordRef>();
  for (const { entry, occurrenceId } of replayed) {
    const ctx: EventNotifierEventContext = {
      event: entry.eventType,
      payload: entry.payload,
    };
    try {
      const recipients = (await plugin.getRecipients?.(ctx, configData)) ?? [];
      for (const recipient of recipients) {
        if (!recipient.contactId) continue;
        const seen = byId.get(recipient.contactId);
        if (seen) {
          seen.occurrenceIds?.push(occurrenceId);
          continue;
        }
        byId.set(recipient.contactId, {
          id: recipient.contactId,
          hint: describeAge(entry.emittedAt),
          occurrenceIds: [occurrenceId],
        });
        if (byId.size >= NOTIFIER_STUDIO_SEED_LIMIT) return [...byId.values()];
      }
    } catch (error) {
      logger.debug("Notifier studio replay could not resolve recipients", {
        service: "event-notifier",
        pluginId: plugin.id,
        event: entry.eventType,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return [...byId.values()];
}

/**
 * When the event fired, as the author would say it. Relative, because
 * the point of the hint is to tell one replayed event from another and
 * to be honest that this is a short window of recent activity.
 */
function describeAge(at: Date): string {
  const seconds = Math.max(0, Math.round((Date.now() - at.getTime()) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}
