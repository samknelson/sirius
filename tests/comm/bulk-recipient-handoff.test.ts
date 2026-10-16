import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IStorage } from "../../server/storage";
import type { User } from "@shared/schema";

const mocks = vi.hoisted(() => ({ assertSelection: vi.fn(), transaction: vi.fn() }));
vi.mock("../../server/storage/transaction-context", () => ({
  runInTransaction: (fn: () => Promise<unknown>) => mocks.transaction(fn),
}));
vi.mock("../../server/services/worker-comms-compliance", async (original) => {
  const actual = await original<typeof import("../../server/services/worker-comms-compliance")>();
  return { ...actual, assertWorkerCommsSelection: mocks.assertSelection };
});
vi.mock("../../server/modules/components", () => ({ isComponentEnabled: vi.fn() }));
vi.mock("../../server/services/access-policy-evaluator", () => ({ checkAccess: vi.fn() }));

import { handoffBulkRecipients } from "../../server/services/bulk-recipient-handoff";

function fixture() {
  const fake = {
    contacts: { getExistingIds: vi.fn(async (ids: string[]) => ids) },
    bulkMessages: {
      getForUpdate: vi.fn().mockResolvedValue({ id: "draft", medium: ["email", "postal"], status: "draft", data: null }),
      create: vi.fn().mockResolvedValue({ id: "new", medium: ["email"], status: "draft" }),
    },
    bulkParticipants: { getByMessageId: vi.fn().mockResolvedValue([]), create: vi.fn().mockResolvedValue({ id: "participant" }) },
  };
  return { fake, storage: fake as unknown as IStorage };
}
const base = { contactIds: ["c1", "c1", "c2"], name: "Selected workers", medium: ["email"], hasReportSelection: false };

describe("draft recipient handoff", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.transaction.mockImplementation(fn => fn());
    mocks.assertSelection.mockResolvedValue(undefined);
  });
  it("keeps ordinary callers compatible and creates only deduplicated draft recipients", async () => {
    const { storage, fake } = fixture();
    const result = await handoffBulkRecipients(storage, base);
    expect(result).toMatchObject({ participantsCreated: 2, participantsSkipped: 0, recipientsResolved: 2 });
    expect(fake.bulkMessages.create).toHaveBeenCalledWith({ name: base.name, medium: ["email"], status: "draft" });
    expect(fake.bulkParticipants.create).toHaveBeenCalledTimes(2);
    expect(fake.bulkMessages.getForUpdate).not.toHaveBeenCalled();
    expect(mocks.assertSelection).not.toHaveBeenCalled();
  });
  it("uses the existing draft's channels, skips existing pairs and never edits content or status", async () => {
    const { storage, fake } = fixture();
    fake.bulkParticipants.getByMessageId.mockResolvedValue([{ contactId: "c1", medium: "email", status: "pending", commId: null }]);
    const result = await handoffBulkRecipients(storage, { ...base, bulkMessageId: "draft" });
    expect(fake.bulkMessages.getForUpdate).toHaveBeenCalledWith("draft");
    expect(fake.bulkMessages.create).not.toHaveBeenCalled();
    expect(result).toMatchObject({ participantsCreated: 3, participantsSkipped: 1 });
    expect(fake.bulkParticipants.create).toHaveBeenCalledWith({ messageId: "draft", contactId: "c2", medium: "postal" });
  });
  it.each(["queued", "sent"])("refuses %s messages before any recipient write", async status => {
    const { storage, fake } = fixture();
    fake.bulkMessages.getForUpdate.mockResolvedValue({ id: "draft", medium: ["email"], status, data: null });
    await expect(handoffBulkRecipients(storage, { ...base, bulkMessageId: "draft" })).rejects.toMatchObject({ status: 409 });
    expect(fake.bulkParticipants.create).not.toHaveBeenCalled();
  });
  it.each([
    { status: "send_failed", commId: null },
    { status: "see_comm", commId: "comm" },
    { status: "pending", commId: "comm" },
  ])("refuses previously processed recipients: %j", async participant => {
    const { storage, fake } = fixture();
    fake.bulkParticipants.getByMessageId.mockResolvedValue([{ contactId: "c1", medium: "email", ...participant }]);
    await expect(handoffBulkRecipients(storage, { ...base, bulkMessageId: "draft" })).rejects.toMatchObject({ status: 409 });
    expect(fake.bulkParticipants.create).not.toHaveBeenCalled();
  });
  it("keeps delivery-started drafts closed even after processed participants were removed", async () => {
    const { storage, fake } = fixture();
    fake.bulkMessages.getForUpdate.mockResolvedValue({ id: "draft", medium: ["email"], status: "draft", data: { recipientDeliveryStarted: true } });
    await expect(handoffBulkRecipients(storage, { ...base, bulkMessageId: "draft" })).rejects.toMatchObject({ status: 409 });
    expect(fake.bulkParticipants.create).not.toHaveBeenCalled();
  });
  it.each([undefined, "draft"])("revalidates report membership for %s handoff inside the write transaction", async bulkMessageId => {
    const { storage, fake } = fixture();
    const actor = { id: "effective-user" } as User;
    const reportSelection = { definitionId: "def", view: "without" };
    mocks.assertSelection.mockRejectedValue(Object.assign(new Error("Selection changed"), { status: 409 }));
    await expect(handoffBulkRecipients(storage, { ...base, bulkMessageId, actor, reportSelection, hasReportSelection: true }))
      .rejects.toMatchObject({ status: 409 });
    expect(mocks.assertSelection).toHaveBeenCalledWith(storage, actor, reportSelection, ["c1", "c2"]);
    expect(fake.bulkMessages.create).not.toHaveBeenCalled();
    expect(fake.bulkParticipants.create).not.toHaveBeenCalled();
    expect(mocks.transaction).toHaveBeenCalledOnce();
  });
  it("refuses missing drafts and contacts instead of silently skipping them", async () => {
    const { storage, fake } = fixture();
    fake.bulkMessages.getForUpdate.mockResolvedValue(undefined);
    await expect(handoffBulkRecipients(storage, { ...base, bulkMessageId: "missing" })).rejects.toMatchObject({ status: 404 });
    fake.contacts.getExistingIds.mockResolvedValue(["c1"]);
    await expect(handoffBulkRecipients(storage, base)).rejects.toMatchObject({ status: 400 });
    expect(fake.bulkParticipants.create).not.toHaveBeenCalled();
    expect(fake.bulkMessages.create).not.toHaveBeenCalled();
  });
});
