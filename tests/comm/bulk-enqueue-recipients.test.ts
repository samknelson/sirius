import { describe, expect, it, vi } from "vitest";
import type { BulkParticipantStorage } from "../../server/storage/bulk/participants";
import type { BulkParticipant } from "../../shared/schema/bulk/schema";
import { enqueueBulkRecipients } from "../../server/modules/bulk/enqueue-recipients";

describe("enrolling list recipients into existing bulk messages", () => {
  it("uses the target message's channels and deduplicates submitted contacts", async () => {
    const createIfMissing = vi.fn<BulkParticipantStorage["createIfMissing"]>()
      .mockImplementation(async data => ({ ...data, id: "new" }) as BulkParticipant);
    const result = await enqueueBulkRecipients(
      { createIfMissing }, { id: "existing", medium: ["postal", "sms"] }, ["worker-a", "worker-a", "worker-b"],
    );
    expect(result).toEqual({ participantsCreated: 4, participantsSkipped: 0 });
    expect(createIfMissing.mock.calls.map(([data]) => data)).toEqual([
      { messageId: "existing", contactId: "worker-a", medium: "postal" },
      { messageId: "existing", contactId: "worker-a", medium: "sms" },
      { messageId: "existing", contactId: "worker-b", medium: "postal" },
      { messageId: "existing", contactId: "worker-b", medium: "sms" },
    ]);
  });

  it("skips existing delivery records while adding missing channels, without resetting them", async () => {
    const createIfMissing = vi.fn<BulkParticipantStorage["createIfMissing"]>()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ id: "new" } as BulkParticipant);
    expect(await enqueueBulkRecipients(
      { createIfMissing }, { id: "existing", medium: ["email", "postal"] }, ["worker-a"],
    )).toEqual({ participantsCreated: 1, participantsSkipped: 1 });
    expect(createIfMissing).toHaveBeenCalledTimes(2);
  });

  it("treats repeated enrollment as a no-op when every pair already exists", async () => {
    const createIfMissing = vi.fn<BulkParticipantStorage["createIfMissing"]>().mockResolvedValue(undefined);
    expect(await enqueueBulkRecipients(
      { createIfMissing }, { id: "existing", medium: ["postal", "postal"] }, ["worker-a", "worker-a"],
    )).toEqual({ participantsCreated: 0, participantsSkipped: 1 });
    expect(createIfMissing).toHaveBeenCalledTimes(1);
  });

  it("does not swallow write failures, allowing the caller's transaction to roll back", async () => {
    const createIfMissing = vi.fn<BulkParticipantStorage["createIfMissing"]>()
      .mockResolvedValueOnce({ id: "new" } as BulkParticipant)
      .mockRejectedValueOnce(new Error("database unavailable"));
    await expect(enqueueBulkRecipients(
      { createIfMissing }, { id: "existing", medium: ["postal"] }, ["worker-a", "worker-b"],
    )).rejects.toThrow("database unavailable");
  });
});
