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

// ---------------------------------------------------------------------------
// Assignment trigger + recipient/suppression hooks
// ---------------------------------------------------------------------------

const assigneeConfig = { statusIds: [OPEN], staffRecipientUserIds: ["staff-1"], notifyCurrentAssignee: true };

function assignedPayload(overrides: Partial<BaoCaseStatusSavedPayload> = {}): BaoCaseStatusSavedPayload {
  return payload({
    operation: "updated",
    previousStatusId: OPEN,
    statusId: OPEN,
    previousAssigneeUserId: "user-old",
    assigneeUserId: "user-new",
    assigneeName: "New Assignee",
    actorUserId: "user-actor",
    ...overrides,
  });
}

describe("bao_case_status assignment trigger", () => {
  it("fires on a genuine assignee change even when the status is unchanged", () => {
    expect(baoCaseStatusNotifier.shouldDispatch!(ctx(assignedPayload()), assigneeConfig)).toBe(true);
  });

  it("does not fire an assignment-only change when Current Assignee is off", () => {
    const cfg = { ...assigneeConfig, notifyCurrentAssignee: false };
    expect(baoCaseStatusNotifier.shouldDispatch!(ctx(assignedPayload()), cfg)).toBe(false);
  });

  it("does not fire when the assignee is unchanged and the status did not move", () => {
    const p = assignedPayload({ previousAssigneeUserId: "user-new" });
    expect(baoCaseStatusNotifier.shouldDispatch!(ctx(p), assigneeConfig)).toBe(false);
  });

  it("counts creation as an assignment change (null → assignee)", () => {
    const p = assignedPayload({
      operation: "created",
      previousStatusId: null,
      statusId: CLOSED, // not a configured status: only the assignment trigger applies
      previousAssigneeUserId: null,
    });
    expect(baoCaseStatusNotifier.shouldDispatch!(ctx(p), assigneeConfig)).toBe(true);
  });

  it("skips the assignment trigger on legacy payloads without assignee identity", () => {
    const p = assignedPayload({
      previousAssigneeUserId: undefined,
      assigneeUserId: undefined,
      assigneeName: undefined,
    });
    expect(baoCaseStatusNotifier.shouldDispatch!(ctx(p), assigneeConfig)).toBe(false);
  });
});

describe("bao_case_status recipient resolution", () => {
  const resolve = (p: BaoCaseStatusSavedPayload, cfg: unknown) =>
    baoCaseStatusNotifier.resolveStaffRecipientUserIds!(ctx(p), cfg, ["staff-1", "staff-2"]) as string[];

  it("keeps only the configured list for a plain status entry", () => {
    const p = payload({ operation: "updated", previousStatusId: CLOSED, statusId: OPEN });
    expect(resolve(p, config)).toEqual(["staff-1", "staff-2"]);
  });

  it("adds the committed assignee on status entry when Current Assignee is on", () => {
    const p = assignedPayload({ previousStatusId: CLOSED, previousAssigneeUserId: "user-new" });
    expect(resolve(p, assigneeConfig)).toEqual(["staff-1", "staff-2", "user-new"]);
  });

  it("deduplicates when the assignee is also explicitly selected", () => {
    const p = assignedPayload({ previousStatusId: CLOSED, assigneeUserId: "staff-1", previousAssigneeUserId: "staff-1" });
    expect(resolve(p, assigneeConfig)).toEqual(["staff-1", "staff-2"]);
  });

  it("targets ONLY the new assignee for an assignment-only change", () => {
    expect(resolve(assignedPayload(), assigneeConfig)).toEqual(["user-new"]);
  });

  it("resolves an empty list when neither trigger applies", () => {
    const p = payload({ operation: "updated", previousStatusId: OPEN, statusId: OPEN });
    expect(resolve(p, assigneeConfig)).toEqual([]);
  });
});

describe("bao_case_status actor suppression", () => {
  const suppression = (p: BaoCaseStatusSavedPayload, cfg: unknown) =>
    baoCaseStatusNotifier.actorSuppression!(ctx(p), cfg);

  it("defaults to suppressing the payload's effective actor (existing configs keep historic behavior)", () => {
    expect(suppression(assignedPayload(), config)).toEqual({
      suppress: true,
      actorUserId: "user-actor",
    });
  });

  it("can be turned off per config", () => {
    const cfg = { ...assigneeConfig, suppressActorNotification: false };
    expect(suppression(assignedPayload(), cfg).suppress).toBe(false);
  });

  it("self-take suppresses only the self case: actor === new assignee", () => {
    // Taking one's own case: actor is the new assignee — suppression drops the
    // sole recipient. Assigned by another: actor differs, assignee is kept.
    const selfTake = assignedPayload({ assigneeUserId: "user-actor", assigneeName: "Actor" });
    const s = suppression(selfTake, assigneeConfig);
    const recipients = baoCaseStatusNotifier.resolveStaffRecipientUserIds!(
      ctx(selfTake), assigneeConfig, [],
    ) as string[];
    expect(recipients.filter((id) => !(s.suppress && id === s.actorUserId))).toEqual([]);

    const byOther = assignedPayload();
    const s2 = suppression(byOther, assigneeConfig);
    const recipients2 = baoCaseStatusNotifier.resolveStaffRecipientUserIds!(
      ctx(byOther), assigneeConfig, [],
    ) as string[];
    expect(recipients2.filter((id) => !(s2.suppress && id === s2.actorUserId))).toEqual(["user-new"]);
  });

  it("returns a null actor for legacy payloads (falls back to the ambient request user)", () => {
    expect(suppression(assignedPayload({ actorUserId: undefined }), config).actorUserId).toBeNull();
  });
});

describe("bao_case_status config validation", () => {
  const validate = (cfg: Record<string, unknown>) =>
    baoCaseStatusNotifier.validateConfigData!(cfg) as { valid: boolean; errors?: string[] };

  it("accepts existing-style configs (statuses + explicit recipients, no new fields)", () => {
    expect(validate({ statusIds: [OPEN], staffRecipientUserIds: ["staff-1"] }).valid).toBe(true);
  });

  it("accepts an assignment-only config (Current Assignee, no statuses, no explicit users)", () => {
    expect(validate({ notifyCurrentAssignee: true }).valid).toBe(true);
  });

  it("rejects a config with no recipient mode", () => {
    const r = validate({ statusIds: [OPEN] });
    expect(r.valid).toBe(false);
    expect(r.errors!.join(" ")).toMatch(/recipient mode/i);
  });

  it("rejects a config that can never fire (no statuses, no assignee mode)", () => {
    const r = validate({ staffRecipientUserIds: ["staff-1"] });
    expect(r.valid).toBe(false);
    expect(r.errors!.join(" ")).toMatch(/never send/i);
  });

  it("rejects explicit recipients that could never be notified (no statuses)", () => {
    const r = validate({ staffRecipientUserIds: ["staff-1"], notifyCurrentAssignee: true });
    expect(r.valid).toBe(false);
    expect(r.errors!.join(" ")).toMatch(/status entry/i);
  });
});

describe("bao_case_status message truthfulness", () => {
  const build = (p: BaoCaseStatusSavedPayload) =>
    baoCaseStatusNotifier.tokenTemplates!.roots[0].build(ctx(p));

  it("summarizes an assignment-only change as an assignment, not a status transition", async () => {
    const entity = await build(assignedPayload());
    expect((entity as any).row).toMatchObject({
      changeSummary: "was assigned to New Assignee",
      assigneeName: "New Assignee",
    });
  });

  it("summarizes a status entry as the new status, even when the assignee also changed", async () => {
    const entity = await build(assignedPayload({ previousStatusId: CLOSED, statusName: "Open" }));
    expect((entity as any).row).toMatchObject({ changeSummary: "is now Open" });
  });

  it("legacy payloads without assignee identity fall back to the status summary", async () => {
    const entity = await build(
      payload({ operation: "updated", previousStatusId: OPEN, statusId: OPEN }),
    );
    expect((entity as any).row).toMatchObject({
      changeSummary: "is now Open",
      assigneeName: null,
    });
  });
});
