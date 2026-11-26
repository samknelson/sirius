import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EventNotifierEventContext } from "../../server/plugins/event-notifier/types";
import type { WorkerBanSavedPayload } from "../../server/services/event-bus";

const fakes = vi.hoisted(() => ({
  worker: vi.fn(),
  register: vi.fn(),
}));
vi.mock("../../server/plugins/event-notifier/registry", () => ({
  registerEventNotifier: fakes.register,
}));
vi.mock("../../server/storage", () => ({
  storage: { workers: { getWorker: fakes.worker } },
}));

import { EventType } from "../../server/services/event-bus";
import { workerBanNotifier as plugin } from "../../server/plugins/event-notifier/plugins/worker-ban-notifier";

function context(patch: Partial<WorkerBanSavedPayload> = {}): EventNotifierEventContext {
  return {
    event: EventType.WORKER_BAN_SAVED,
    payload: {
      banId: "ban",
      workerId: "affected-worker",
      type: "dispatch",
      startDate: new Date("2026-11-01T12:00:00"),
      endDate: null,
      active: true,
      ...patch,
    } satisfies WorkerBanSavedPayload,
  };
}

beforeEach(() => {
  fakes.worker.mockReset();
  fakes.worker.mockResolvedValue({ contactId: "affected-contact" });
});

describe("worker ban notification recipient safety", () => {
  it("skips inactive and deleted saves without imposing transition-only semantics", async () => {
    expect(await plugin.shouldDispatch!(context(), {})).toBe(true);
    expect(await plugin.shouldDispatch!(context(), {})).toBe(true);
    expect(await plugin.shouldDispatch!(context({ active: false }), {})).toBe(false);
    expect(await plugin.shouldDispatch!(context({ isDeleted: true }), {})).toBe(false);
  });

  it("targets only the affected worker's contact without requiring an account", async () => {
    expect(await plugin.getRecipients!(context(), {})).toEqual([{ contactId: "affected-contact" }]);
    expect(fakes.worker).toHaveBeenCalledExactlyOnceWith("affected-worker");
    expect(plugin.staffNotification).not.toBe(true);
    expect(plugin.notifySelf).toBe(true);
  });

  it.each([undefined, {}, { contactId: null }])("has no recipient for a missing worker/contact link: %j", async worker => {
    fakes.worker.mockResolvedValue(worker);
    expect(await plugin.getRecipients!(context(), {})).toEqual([]);
  });

  it("declares the component gate and only the existing save event and supported channels", () => {
    expect(plugin.requiredComponent).toBe("worker.ban");
    expect(plugin.subscribedEvents).toEqual([EventType.WORKER_BAN_SAVED]);
    expect(plugin.supportedMedia).toEqual(["email", "sms", "inapp"]);
    expect(plugin.tokenTemplates).toBeUndefined();
    expect(plugin.configSchema).toBeUndefined();
  });
});
