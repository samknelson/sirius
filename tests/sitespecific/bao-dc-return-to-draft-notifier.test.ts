import { describe, expect, it } from "vitest";
import {
  EventType,
  type BaoDcCaseSavedPayload,
} from "../../server/services/event-bus";
import { baoDcReturnToDraftNotifier } from "../../server/plugins/event-notifier/plugins/bao-dc-return-to-draft";
import type { EventNotifierEventContext } from "../../server/plugins/event-notifier/types";
import { getPluginConfigAdapter } from "../../server/plugins/_core/config-adapter";
import { initializeEventNotifierPluginSystem } from "../../server/plugins/event-notifier";

function payload(
  overrides: Partial<BaoDcCaseSavedPayload> = {},
): BaoDcCaseSavedPayload {
  return {
    caseId: "case/with spaces",
    workerId: "worker-1",
    dcEventType: "case_status_changed",
    workMonthYmd: null,
    previousStatus: "in_queue",
    status: "draft",
    reason: "The physician signature is missing.",
    actorUserId: "approver-1",
    createdByUserId: "msr-1",
    explicitApproverReturn: true,
    ...overrides,
  };
}

function ctx(p: BaoDcCaseSavedPayload): EventNotifierEventContext {
  return { event: EventType.BAO_DC_CASE_SAVED, payload: p };
}

describe("Disability Credit return-to-draft notifier", () => {
  it("is in-app only and targets the MSR who created the case", async () => {
    expect(baoDcReturnToDraftNotifier.supportedMedia).toEqual(["inapp"]);
    expect(baoDcReturnToDraftNotifier.singleton).toBe(true);
    expect(baoDcReturnToDraftNotifier.notifySelf).toBe(true);
    expect(baoDcReturnToDraftNotifier.shouldDispatch!(ctx(payload()), undefined)).toBe(true);
    expect(
      baoDcReturnToDraftNotifier.resolveStaffRecipientUserIds!(
        ctx(payload()),
        undefined,
        [],
      ),
    ).toEqual(["msr-1"]);

    await expect(
      baoDcReturnToDraftNotifier.getMessage!(
        "inapp",
        { contactId: "contact-1", userId: "msr-1" },
        ctx(payload()),
      ),
    ).resolves.toMatchObject({
      title: "Disability Credit case returned to draft",
      body: expect.stringContaining("The physician signature is missing."),
      linkUrl: "/bao/dc/cases/case%2Fwith%20spaces",
      linkLabel: "Review Case",
    });
  });

  it("seeds an enabled in-app singleton configuration on existing deployments", () => {
    initializeEventNotifierPluginSystem();
    const adapter = getPluginConfigAdapter("event-notifier");
    expect(adapter?.seedDefault?.(baoDcReturnToDraftNotifier)).toMatchObject({
      pluginId: "bao_dc_return_to_draft",
      enabled: true,
      media: ["inapp"],
    });
  });

  it("suppresses automatic bounces and unrelated status changes", () => {
    const should = (p: BaoDcCaseSavedPayload) =>
      baoDcReturnToDraftNotifier.shouldDispatch!(ctx(p), undefined);

    expect(should(payload({ explicitApproverReturn: false }))).toBe(false);
    expect(should(payload({ explicitApproverReturn: undefined }))).toBe(false);
    expect(should(payload({ previousStatus: "ready_for_review" }))).toBe(false);
    expect(should(payload({ status: "approved" }))).toBe(false);
    expect(should(payload({ dcEventType: "attestations_updated" }))).toBe(false);
    expect(should(payload({ reason: "   " }))).toBe(false);
    expect(should(payload({ createdByUserId: null }))).toBe(false);
  });
});