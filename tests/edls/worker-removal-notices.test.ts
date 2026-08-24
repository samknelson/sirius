/**
 * Who the EDLS worker SMS notifier decides to text when a sheet arrives at a
 * trigger status — specifically the workers who have been TAKEN OFF it since
 * the last save this config notified about.
 *
 * That decision is a diff between two rosters, and every way it can go wrong
 * goes wrong silently: a wrong baseline texts nobody (the worker never learns
 * they are off the crew) or texts everybody (the whole sheet is told it has
 * been dropped). Neither shows up as an error anywhere.
 *
 * The riskiest boundary is which snapshot counts as "last time". A snapshot is
 * written with the save it describes, so the save being processed has one too
 * and must not be mistaken for its own baseline; each bundle carries the
 * sheet's `changed` stamp, which is what says WHICH save it is of. The fake
 * history below is handed back in write order and includes rows whose write
 * order disagrees with their save order, so a notifier that trusted the row's
 * own timestamp fails here. The other way to lose a notice is to stop looking
 * too early, so the history offered here also runs deep.
 *
 * No database, no server: storage and the capture-settings read are faked.
 */
import { describe, expect, it, vi } from "vitest";
import type { EdlsSheet, Snapshot } from "@shared/schema";
import type { SnapshotNode } from "@shared/snapshots";

const SHEET_ID = "sheet-1";
const YMD = "2099-06-01";
/** The save being processed. `changed` is stamped inside its transaction. */
const CHANGED = new Date("2099-05-01T12:00:00.000Z");
const MINUTE = 60_000;

const ASSIGNED = "worker-assigned";
const RECEIPTED = "worker-receipted";
const REMOVED = "worker-removed";

function contactOf(workerId: string): string {
  return `contact-${workerId}`;
}
function phoneOf(workerId: string): string {
  return `+1555000${workerId.length}${workerId.slice(-1)}`;
}
/** The worker's access token — the credential the texted link carries. */
function tokenOf(workerId: string): string {
  return `token-for-${workerId}`;
}

/**
 * A stored `edls_sheet` bundle: the sheet's own columns — `changed` among them,
 * which is what says WHICH SAVE this is of — with crews and their assignments
 * nested. `capturedAt` is when the row was written, deliberately independent of
 * the save it captures.
 */
function sheetSnapshot(opts: {
  id: string;
  savedAt: Date;
  capturedAt: Date;
  status: string;
  workerIds: string[];
}): Snapshot {
  const data: SnapshotNode = {
    version: 1,
    data: {
      id: SHEET_ID,
      status: opts.status,
      ymd: YMD,
      changed: opts.savedAt.toISOString(),
      crews: [
        {
          version: 1,
          data: {
            id: "crew-1",
            assignments: opts.workerIds.map((workerId) => ({
              version: 1,
              data: { id: `assignment-${workerId}`, workerId },
            })),
          },
        },
      ],
    },
  } as unknown as SnapshotNode;
  return {
    id: opts.id,
    entityType: "edls_sheet",
    entityId: SHEET_ID,
    createdAt: opts.capturedAt,
    data,
  } as unknown as Snapshot;
}

interface Scenario {
  /** Every snapshot of this sheet that exists. */
  snapshots: Snapshot[];
  /** The sheet's roster as it stands after the save. */
  roster: string[];
  /** Workers with an assignment still waiting to be texted (no receipt). */
  smsTargets: string[];
  /** Workers reachable by SMS today. Anyone absent has no usable number. */
  reachable?: string[];
  /** Workers whose access token cannot be issued. */
  tokenless?: string[];
  captureActive?: boolean;
  statuses?: string[];
  /** The save being processed, when it is not the default one. */
  sheet?: EdlsSheet;
}

let scenario: Scenario;

vi.mock("../../server/storage", () => ({
  storage: {
    snapshots: {
      async listRecent(
        _entityType: string,
        _entityId: string,
        limit: number,
        offset = 0,
      ): Promise<Snapshot[]> {
        // The real query's contract: one page of the entity's history in WRITE
        // order, newest first, and a short page means the history ends there.
        return [...scenario.snapshots]
          .sort(
            (a, b) =>
              (b.createdAt as unknown as Date).getTime() -
              (a.createdAt as unknown as Date).getTime(),
          )
          .slice(offset, offset + limit);
      },
    },
    edlsAssignments: {
      async getBySheetId() {
        return scenario.roster.map((workerId) => ({
          id: `assignment-${workerId}`,
          workerId,
        }));
      },
      async getSmsTargetsBySheetId() {
        return scenario.smsTargets.map((workerId) => ({
          assignmentId: `assignment-${workerId}`,
          workerId,
          contactId: contactOf(workerId),
          phoneNumber: phoneOf(workerId),
          data: null,
        }));
      },
    },
    workerAat: {
      // Get-or-create in the real thing; here it simply answers with the
      // worker's stable token, unless the scenario says it cannot be issued.
      async ensureAccessUuid(workerId: string) {
        if (scenario.tokenless?.includes(workerId)) {
          throw new Error(`no token for ${workerId}`);
        }
        return {
          record: { id: `aat-${workerId}`, workerId, accessUuid: tokenOf(workerId), accessCode: null },
          issued: false,
        };
      },
    },
    workers: {
      async getSmsContactsByWorkerIds(workerIds: string[]) {
        // The real read drops anyone with no active primary number, so an
        // unreachable worker is simply absent from the answer.
        const reachable = scenario.reachable ?? [ASSIGNED, RECEIPTED, REMOVED];
        return workerIds
          .filter((id) => reachable.includes(id))
          .map((workerId) => ({
            workerId,
            contactId: contactOf(workerId),
            phoneNumber: phoneOf(workerId),
          }));
      },
    },
  },
  createCommSmsOptinStorage: () => ({
    async getSmsOptinsByPhoneNumbers(phoneNumbers: string[]) {
      return new Map(phoneNumbers.map((n) => [n, { optin: true }]));
    },
  }),
}));

vi.mock("../../server/services/snapshots/capture", () => ({
  isSnapshotCaptureActive: async () => scenario.captureActive ?? true,
}));

vi.mock("../../server/lib/base-url", () => ({
  absoluteBaseUrl: () => "https://example.test",
  absoluteUrl: (relative: string) => `https://example.test${relative}`,
}));

const { edlsSheetWorkerSmsNotifier } = await import(
  "../../server/plugins/event-notifier/plugins/edls-sheet-worker-sms-notifier"
);

function sheetSavedAt(changed: Date): EdlsSheet {
  return { id: SHEET_ID, ymd: YMD, status: "lock", changed } as unknown as EdlsSheet;
}

async function recipientsFor(s: Scenario) {
  scenario = s;
  const sheet = s.sheet ?? sheetSavedAt(CHANGED);
  const context = {
    payload: { sheetId: SHEET_ID, sheet, previousStatus: "draft", newStatus: "lock" },
  } as never;
  const recipients = await edlsSheetWorkerSmsNotifier.getRecipients!(context, {
    statuses: s.statuses ?? ["lock"],
  });
  const messages = new Map<string, string>();
  for (const recipient of recipients) {
    const content = await edlsSheetWorkerSmsNotifier.getMessage!("sms", recipient, context);
    messages.set(recipient.contactId, content?.message ?? "");
  }
  return { contactIds: recipients.map((r) => r.contactId), messages };
}

/** The previous save, at a trigger status, with everyone still on the sheet. */
const BASELINE = sheetSnapshot({
  id: "snap-baseline",
  savedAt: new Date(CHANGED.getTime() - MINUTE),
  capturedAt: new Date(CHANGED.getTime() - MINUTE + 20),
  status: "lock",
  workerIds: [ASSIGNED, RECEIPTED, REMOVED],
});
/** The snapshot of the save being processed, written by a sibling handler. */
const THIS_SAVE = sheetSnapshot({
  id: "snap-this-save",
  savedAt: CHANGED,
  capturedAt: new Date(CHANGED.getTime() + 250),
  status: "lock",
  workerIds: [ASSIGNED, RECEIPTED],
});

describe("EDLS worker SMS notifier — workers taken off the sheet", () => {
  it("texts the removed worker, with the wording and link of someone off the crew", async () => {
    const { contactIds, messages } = await recipientsFor({
      snapshots: [BASELINE, THIS_SAVE],
      roster: [ASSIGNED, RECEIPTED],
      smsTargets: [ASSIGNED],
    });

    expect(contactIds, "assigned and removed, receipted worker untouched").toEqual([
      contactOf(ASSIGNED),
      contactOf(REMOVED),
    ]);
    expect(messages.get(contactOf(REMOVED))).toContain("no longer scheduled");
    expect(messages.get(contactOf(REMOVED)), "names the date").toContain("June 1, 2099");
    expect(
      messages.get(contactOf(REMOVED)),
      "link carries the worker's access token, not a row that is gone",
    ).toContain(`/edls-sched/${tokenOf(REMOVED)}`);
    expect(messages.get(contactOf(ASSIGNED))).toContain("posted or updated");
    expect(messages.get(contactOf(ASSIGNED))).toContain(`/edls-sched/${tokenOf(ASSIGNED)}`);
    // The worker's own id is unrotatable and appears in staff URLs and
    // exports, so a link carrying it would hand out perpetual read access.
    for (const message of messages.values()) {
      expect(message).not.toContain(`/edls-sched/${ASSIGNED}`);
      expect(message).not.toContain(`/edls-sched/${REMOVED}`);
    }
  });

  it("does not text a worker whose access token cannot be issued", async () => {
    // No token means no link that resolves, and the message is nothing but a
    // link: a text with a dead one is worse than no text at all.
    const { contactIds } = await recipientsFor({
      snapshots: [BASELINE, THIS_SAVE],
      roster: [ASSIGNED, RECEIPTED],
      smsTargets: [ASSIGNED],
      tokenless: [ASSIGNED],
    });
    expect(contactIds).toEqual([contactOf(REMOVED)]);
  });

  it("never uses this save's own snapshot as the baseline", async () => {
    // The only snapshot on record is the one written for the save being
    // processed. Reading "the latest snapshot" would find it, diff the sheet
    // against itself and report nobody removed — which is also what the
    // correct answer looks like, so the discriminator is the roster: this
    // save's snapshot still lists the removed worker.
    const thisSaveWithEveryone = sheetSnapshot({
      id: "snap-this-save-2",
      savedAt: CHANGED,
      capturedAt: new Date(CHANGED.getTime() + 1),
      status: "lock",
      workerIds: [ASSIGNED, RECEIPTED, REMOVED],
    });
    const { contactIds } = await recipientsFor({
      snapshots: [thisSaveWithEveryone],
      roster: [ASSIGNED, RECEIPTED],
      smsTargets: [ASSIGNED],
    });
    expect(contactIds, "no earlier save on record means nobody was removed").toEqual([
      contactOf(ASSIGNED),
    ]);
  });

  it("uses a baseline whose snapshot landed after this save had already started", async () => {
    // The race the design has to survive: capture is fired after the previous
    // save commits and is not awaited, so a quick follow-up save can take its
    // own stamp BEFORE that snapshot row exists. Here the baseline's snapshot
    // is written a full second after this save's stamp, and the save it
    // captures is still the earlier one. Ordering history by capture time
    // would discard it and text nobody.
    const lateBaseline = sheetSnapshot({
      id: "snap-late-baseline",
      savedAt: new Date(CHANGED.getTime() - 40),
      capturedAt: new Date(CHANGED.getTime() + 1_000),
      status: "lock",
      workerIds: [ASSIGNED, RECEIPTED, REMOVED],
    });
    const { contactIds, messages } = await recipientsFor({
      snapshots: [lateBaseline, THIS_SAVE],
      roster: [ASSIGNED, RECEIPTED],
      smsTargets: [ASSIGNED],
    });
    expect(contactIds).toEqual([contactOf(ASSIGNED), contactOf(REMOVED)]);
    expect(messages.get(contactOf(REMOVED))).toContain("no longer scheduled");
  });

  it("prefers the most recent earlier SAVE, not the most recently captured one", async () => {
    // Two earlier saves whose snapshots landed out of order. The newer save
    // took the worker off; the older one still had them on. Diffing against
    // the older save would announce a removal that was announced already.
    const older = sheetSnapshot({
      id: "snap-older-save",
      savedAt: new Date(CHANGED.getTime() - 2 * MINUTE),
      capturedAt: new Date(CHANGED.getTime() - 10),
      status: "lock",
      workerIds: [ASSIGNED, RECEIPTED, REMOVED],
    });
    const newer = sheetSnapshot({
      id: "snap-newer-save",
      savedAt: new Date(CHANGED.getTime() - MINUTE),
      capturedAt: new Date(CHANGED.getTime() - 2 * MINUTE),
      status: "lock",
      workerIds: [ASSIGNED, RECEIPTED],
    });
    const { contactIds } = await recipientsFor({
      snapshots: [older, newer],
      roster: [ASSIGNED, RECEIPTED],
      smsTargets: [ASSIGNED],
    });
    expect(contactIds, "already told; not told again").toEqual([contactOf(ASSIGNED)]);
  });

  it("still uses a legacy bundle that carries no save stamp", async () => {
    // History captured before the sheet's own columns were bundled whole has
    // nothing to place it by but when it was written. That is far enough in
    // the past to be unambiguous, and refusing it would mean a sheet with old
    // history could never notify anyone.
    const legacy = sheetSnapshot({
      id: "snap-legacy",
      savedAt: new Date(CHANGED.getTime() - MINUTE),
      capturedAt: new Date(CHANGED.getTime() - MINUTE),
      status: "lock",
      workerIds: [ASSIGNED, RECEIPTED, REMOVED],
    });
    delete ((legacy.data as unknown as { data: Record<string, unknown> }).data).changed;

    const { contactIds } = await recipientsFor({
      snapshots: [legacy],
      roster: [ASSIGNED, RECEIPTED],
      smsTargets: [ASSIGNED],
    });
    expect(contactIds).toEqual([contactOf(ASSIGNED), contactOf(REMOVED)]);
  });

  it("finds the last notifying save however long ago it was, past any read window", async () => {
    // A sheet that has been round the houses since it was last locked: dozens
    // of later transitions at statuses this config ignores. The baseline is
    // the lock at the far end of that history. A search that stopped after a
    // fixed number of rows would not report having stopped — it would report
    // that nobody was removed, and the notice would be lost for good, because
    // this save's own snapshot becomes the next baseline without the worker.
    const baseline = sheetSnapshot({
      id: "snap-distant-lock",
      savedAt: new Date(CHANGED.getTime() - 500 * MINUTE),
      capturedAt: new Date(CHANGED.getTime() - 500 * MINUTE),
      status: "lock",
      workerIds: [ASSIGNED, RECEIPTED, REMOVED],
    });
    const churn = Array.from({ length: 60 }, (_, index) =>
      sheetSnapshot({
        id: `snap-churn-${index}`,
        savedAt: new Date(CHANGED.getTime() - (60 - index) * MINUTE),
        capturedAt: new Date(CHANGED.getTime() - (60 - index) * MINUTE),
        status: index % 2 === 0 ? "draft" : "request",
        workerIds: [ASSIGNED, RECEIPTED, REMOVED],
      }),
    );

    const { contactIds, messages } = await recipientsFor({
      snapshots: [...churn, baseline, THIS_SAVE],
      roster: [ASSIGNED, RECEIPTED],
      smsTargets: [ASSIGNED],
    });
    expect(contactIds).toEqual([contactOf(ASSIGNED), contactOf(REMOVED)]);
    expect(messages.get(contactOf(REMOVED))).toContain("no longer scheduled");
  });

  it("does not mistake a still-assigned worker holding a receipt for a removed one", async () => {
    // Nobody has been taken off: the SMS targets are narrow only because both
    // other workers already hold receipts. Diffing against them instead of the
    // full roster would text the whole sheet a removal notice.
    const { contactIds } = await recipientsFor({
      snapshots: [BASELINE],
      roster: [ASSIGNED, RECEIPTED, REMOVED],
      smsTargets: [ASSIGNED],
    });
    expect(contactIds).toEqual([contactOf(ASSIGNED)]);
  });

  it("treats removed-and-re-added as assigned", async () => {
    const { contactIds, messages } = await recipientsFor({
      snapshots: [BASELINE],
      roster: [ASSIGNED, RECEIPTED, REMOVED],
      smsTargets: [ASSIGNED, REMOVED],
    });
    expect(contactIds).toEqual([contactOf(ASSIGNED), contactOf(REMOVED)]);
    expect(messages.get(contactOf(REMOVED)), "the normal message, not a removal notice").toContain(
      "posted or updated",
    );
  });

  it("tells a removed worker once: the next transition with no edits texts nobody", async () => {
    const history = [BASELINE, THIS_SAVE];
    const { contactIds } = await recipientsFor({
      snapshots: history,
      roster: [ASSIGNED, RECEIPTED],
      smsTargets: [],
    });
    expect(contactIds).toEqual([contactOf(REMOVED)]);

    // A later transition with nothing edited. This save's snapshot is now the
    // baseline, and the removed worker is not in it.
    const later = await recipientsFor({
      snapshots: history,
      roster: [ASSIGNED, RECEIPTED],
      smsTargets: [],
      sheet: sheetSavedAt(new Date(CHANGED.getTime() + 10 * MINUTE)),
    });
    expect(later.contactIds).toEqual([]);
  });

  it("ignores a snapshot whose captured status this config does not notify on", async () => {
    const draft = sheetSnapshot({
      id: "snap-draft",
      savedAt: new Date(CHANGED.getTime() - MINUTE),
      capturedAt: new Date(CHANGED.getTime() - MINUTE + 20),
      status: "draft",
      workerIds: [ASSIGNED, RECEIPTED, REMOVED],
    });
    const { contactIds } = await recipientsFor({
      snapshots: [draft],
      roster: [ASSIGNED, RECEIPTED],
      smsTargets: [ASSIGNED],
      statuses: ["lock"],
    });
    expect(contactIds, "a draft save is not a save this config notified about").toEqual([
      contactOf(ASSIGNED),
    ]);
  });

  it("invents nothing when snapshot capture is switched off", async () => {
    const { contactIds } = await recipientsFor({
      snapshots: [BASELINE, THIS_SAVE],
      roster: [ASSIGNED, RECEIPTED],
      smsTargets: [ASSIGNED],
      captureActive: false,
    });
    expect(contactIds).toEqual([contactOf(ASSIGNED)]);
  });

  it("skips a removed worker with no usable number", async () => {
    const { contactIds } = await recipientsFor({
      snapshots: [BASELINE, THIS_SAVE],
      roster: [ASSIGNED, RECEIPTED],
      smsTargets: [ASSIGNED],
      reachable: [ASSIGNED, RECEIPTED],
    });
    expect(contactIds).toEqual([contactOf(ASSIGNED)]);
  });
});
