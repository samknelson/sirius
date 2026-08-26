import { describe, expect, it } from "vitest";
import { EventType, type BaoCaseStatusSavedPayload } from "../../server/services/event-bus";
import { baoCaseStatusNotifier } from "../../server/plugins/event-notifier/plugins/bao-case-status-notifier";
import type { EventNotifierEventContext } from "../../server/plugins/event-notifier/types";

/**
 * Pure dispatch-filter coverage for the `bao_case_status` staff notifier:
 * fires only when a case is created in — or genuinely transitions into —
 * one of the config's statuses; unchanged-status saves, unconfigured
 * statuses, and legacy/incomplete payloads never fire.
 */

const OPEN = "status-open";
const CLOSED = "status-closed";

function payload(overrides: Partial<BaoCaseStatusSavedPayload> = {}): BaoCaseStatusSavedPayload {
  return {
    caseId: "case-1",
    entityType: "worker",
    entityId: "worker-1",
    row: { id: "case-1", statusId: OPEN } as BaoCaseStatusSavedPayload["row"],
    previousStatusId: null,
    statusId: OPEN,
    statusName: "Open",
    entityName: "Test Worker",
    operation: "created",
    ...overrides,
  };
}

function ctx(p: BaoCaseStatusSavedPayload): EventNotifierEventContext {
  return {
    event: EventType.BAO_CASE_STATUS_SAVED,
    payload: p,
  } as EventNotifierEventContext;
}

const config = { statusIds: [OPEN], staffRecipientUserIds: ["staff-1"] };

describe("bao_case_status shouldDispatch", () => {
  it("is BAO-component gated and staff-mode", () => {
    expect(baoCaseStatusNotifier.requiredComponent).toBe("sitespecific.bao");
    expect(baoCaseStatusNotifier.staffNotification).toBe(true);
    expect(baoCaseStatusNotifier.subscribedEvents).toEqual([EventType.BAO_CASE_STATUS_SAVED]);
  });

  it("fires when a case is created in a configured status", () => {
    expect(baoCaseStatusNotifier.shouldDispatch!(ctx(payload()), config)).toBe(true);
  });

  it("fires on a genuine transition into a configured status", () => {
    const p = payload({ operation: "updated", previousStatusId: CLOSED, statusId: OPEN });
    expect(baoCaseStatusNotifier.shouldDispatch!(ctx(p), config)).toBe(true);
  });

  it("does not fire when the save leaves the status unchanged", () => {
    const p = payload({ operation: "updated", previousStatusId: OPEN, statusId: OPEN });
    expect(baoCaseStatusNotifier.shouldDispatch!(ctx(p), config)).toBe(false);
  });

  it("does not fire for statuses outside the configuration", () => {
    const p = payload({ operation: "updated", previousStatusId: OPEN, statusId: CLOSED });
    expect(baoCaseStatusNotifier.shouldDispatch!(ctx(p), config)).toBe(false);
  });

  it("does not fire with an empty or missing status configuration", () => {
    expect(baoCaseStatusNotifier.shouldDispatch!(ctx(payload()), { statusIds: [] })).toBe(false);
    expect(baoCaseStatusNotifier.shouldDispatch!(ctx(payload()), {})).toBe(false);
    expect(baoCaseStatusNotifier.shouldDispatch!(ctx(payload()), undefined)).toBe(false);
  });

  it("skips legacy/incomplete payloads missing the snapshot or transition identity", () => {
    expect(
      baoCaseStatusNotifier.shouldDispatch!(
        ctx(payload({ row: undefined as unknown as BaoCaseStatusSavedPayload["row"] })),
        config,
      ),
    ).toBe(false);
    expect(
      baoCaseStatusNotifier.shouldDispatch!(
        ctx(payload({ previousStatusId: undefined as unknown as null })),
        config,
      ),
    ).toBe(false);
  });

  it("builds the message from the event's committed snapshot, not a re-read", async () => {
    const p = payload();
    const root = baoCaseStatusNotifier.tokenTemplates!.roots[0];
    const entity = await root.build(ctx(p));
    expect(entity).toMatchObject({
      kind: "sitespecific_bao_case",
      row: expect.objectContaining({
        id: "case-1",
        statusName: "Open",
        entityName: "Test Worker",
      }),
    });
  });
});
