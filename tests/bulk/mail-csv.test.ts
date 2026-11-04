import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ContactPostal } from "../../shared/schema";
import type { IStorage } from "../../server/storage";

const mocks = vi.hoisted(() => ({
  mailingContacts: vi.fn(),
  getByIdForUpdate: vi.fn(),
  update: vi.fn(),
  participants: vi.fn(),
  evidence: vi.fn(),
  outcomes: vi.fn(),
  record: vi.fn(),
  content: vi.fn(),
  render: vi.fn(),
  context: vi.fn(),
}));
vi.mock("../../server/storage/bulk/participants", () => ({
  createBulkParticipantStorage: () => ({
    getMailingContacts: mocks.mailingContacts, getPostalMailingParticipants: mocks.participants,
    getPostalExportComms: mocks.evidence,
  }),
}));
vi.mock("../../server/storage/bulk/offline-postal", () => ({
  createOfflinePostalExportStorage: () => ({ record: mocks.record, applyOutcomes: mocks.outcomes }),
}));
vi.mock("../../server/plugins/tokens", () => ({
  createTokenEvalContext: mocks.context,
  renderTokens: mocks.render,
}));
vi.mock("../../server/modules/bulk/deliver", () => ({ resolveTagIdsForMedium: async () => ["postal-tag"] }));
vi.mock("../../server/plugins/tokens/plugins/bulk-participant", () => ({
  BULK_PARTICIPANT_ROOT_NAME: "bulk_participant",
  composeBulkParticipantEntity: (participant: unknown) => participant,
}));
vi.mock("../../server/storage/transaction-context", () => ({
  runInTransaction: (fn: () => Promise<unknown>) => fn(),
}));

import { buildMailCsv, downloadMailCsv } from "../../server/modules/bulk/mail-csv";

const storage = {
  bulkMessages: { getByIdForUpdate: mocks.getByIdForUpdate, update: mocks.update },
  bulkMessagesPostal: { getByBulkId: mocks.content },
} as unknown as IStorage;
const address = (overrides: Partial<ContactPostal> = {}) => ({
  isActive: true, isPrimary: false, street: "10 Main St",
  city: "Boston", state: "MA", postalCode: "00501",
  deliverabilityStatus: "unknown", ...overrides,
} as ContactPostal);

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getByIdForUpdate.mockResolvedValue({
    id: "message", name: "Test Mailing", medium: ["postal", "email"], data: { offline: true }, status: "draft",
  });
  mocks.mailingContacts.mockResolvedValue([
    { contactId: "one", name: "Full Name", address: address() },
  ]);
  mocks.update.mockResolvedValue({ id: "message", status: "sent" });
  mocks.participants.mockResolvedValue([{
    id: "participant", messageId: "message", contactId: "one", medium: "postal", commId: null,
  }]);
  mocks.content.mockResolvedValue(undefined);
  mocks.evidence.mockResolvedValue([]);
  mocks.outcomes.mockResolvedValue(1);
  mocks.context.mockImplementation((_storage, contactId, options) => ({ contactId, options }));
  mocks.render.mockImplementation(async description => ({ output: description }));
  mocks.record.mockImplementation(async (_messageId, records) => {
    mocks.participants.mockResolvedValue(records.map((record: { participantId: string; contactId: string }) => ({
      id: record.participantId, messageId: "message", contactId: record.contactId, medium: "postal",
      commId: "offline-comm", commStatus: "offline", status: "see_comm",
    })));
    return records.length;
  });
});

describe("offline mailing CSV", () => {
  it("loads shared postal content once, preserves authored history, and isolates recipient descriptions", async () => {
    mocks.content.mockResolvedValue({
      description: "Letter to {{contact}}", templateId: "vendor-template",
      fileUrl: "https://example.com/letter.pdf", mergeVariables: { authored: "value" },
      fromName: "Return Name", fromAddressLine1: "1 Return St", fromCity: "Boston",
      fromState: "MA", fromZip: "00123", fromCountry: "US",
      mailType: "usps_standard", color: true, doubleSided: true,
    });
    mocks.mailingContacts.mockResolvedValue([
      { contactId: "one", name: "One", address: address() },
      { contactId: "two", name: "Two", address: address() },
    ]);
    mocks.participants.mockResolvedValue([
      { id: "p1", messageId: "message", contactId: "one", medium: "postal", commId: null },
      { id: "p2", messageId: "message", contactId: "two", medium: "postal", commId: null },
    ]);
    mocks.render.mockImplementation(async (text, ctx) => ({ output: text.replace("{{contact}}", ctx.contactId) }));
    await downloadMailCsv(storage, "message", "actor");
    expect(mocks.content).toHaveBeenCalledTimes(1);
    const records = mocks.record.mock.calls[0][1];
    expect(records[0].postal).toMatchObject({
      description: "Letter to one", fromName: "Return Name", fromZip: "00123", fromAddressLine1: "1 Return St",
      body: "https://example.com/letter.pdf", data: { templateId: "vendor-template", mergeVariables: { authored: "value" } },
      mailType: "usps_standard", color: true, doubleSided: true,
    });
    expect(records[1].postal.description).toBe("Letter to two");
    expect(mocks.render.mock.calls[0][1]).not.toBe(mocks.render.mock.calls[1][1]);
    expect(mocks.context.mock.calls[0][2].seeds[0].entity.id).toBe("p1");
    expect(mocks.context.mock.calls[1][2].seeds[0].entity.id).toBe("p2");
  });

  it("does not write any completion if a personalized description cannot be rendered", async () => {
    mocks.render.mockRejectedValueOnce(new Error("invalid description token"));
    await expect(downloadMailCsv(storage, "message")).rejects.toThrow("invalid description token");
    expect(mocks.record).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("exports one row per contact, uses active primary, and preserves street lines, ZIP and deliverability", () => {
    const result = buildMailCsv([
      { contactId: "one", name: 'Last, "First"', address: address() },
      { contactId: "one", name: 'Last, "First"', address: address({
        isPrimary: true, street: "20 Oak\r\nApt 2\nBuilding B", deliverabilityStatus: "verified",
      }) },
      { contactId: "one", name: 'Last, "First"', address: address({ isActive: false, isPrimary: true }) },
      { contactId: "two", name: "No Address", address: address({ isActive: false }) },
      { contactId: "three", name: "Fallback", address: address() },
    ]);
    expect(result.recipientCount).toBe(2);
    expect(result.missingAddressCount).toBe(1);
    expect(result.csv).toContain('"Full Name","Address 1","Address 2","City","State","ZIP","Primary Address","Deliverability Status"');
    expect(result.csv).toContain('"Last, ""First""","20 Oak","Apt 2\nBuilding B","Boston","MA","00501","true","verified"');
    expect(result.csv).not.toContain('"No Address"');
    expect(result.csv).toContain('"Fallback","10 Main St","","Boston","MA","00501","false","unknown"');
  });

  it("neutralizes formulas without using executable spreadsheet formulas for ZIP formatting", () => {
    const result = buildMailCsv([{
      contactId: "one", name: "  =HYPERLINK(\"bad\")",
      address: address({ street: "+SUM(1,2)\r\n@command", city: "\t=command", state: "-command" }),
    }]);
    expect(result.csv).toContain("\"'  =HYPERLINK(\"\"bad\"\")\"");
    expect(result.csv).toContain("\"'+SUM(1,2)\"");
    expect(result.csv).toContain("\"'@command\"");
    expect(result.csv).toContain("\"'\t=command\"");
    expect(result.csv).toContain("\"'-command\"");
    expect(result.csv).toContain('"00501"');
    expect(result.csv).not.toContain('="00501"');
  });

  it("prepares the full export before completing the message, with no duplicate completion on re-download", async () => {
    const first = await downloadMailCsv(storage, "message");
    expect(first.content.toString("utf8")).toBe(first.csv);
    expect(mocks.update).toHaveBeenCalledWith("message", { status: "sent", sendDate: null });
    expect(mocks.mailingContacts.mock.invocationCallOrder[0]).toBeLessThan(mocks.update.mock.invocationCallOrder[0]);
    mocks.getByIdForUpdate.mockResolvedValue({
      medium: ["postal"], data: { offline: true }, status: "sent",
    });
    const second = await downloadMailCsv(storage, "message", undefined, "all");
    expect(second.csv).toBe(first.csv);
    expect(mocks.update).toHaveBeenCalledTimes(1);
    expect(mocks.record).toHaveBeenCalledTimes(1);
    expect(mocks.content).toHaveBeenCalledTimes(1);
  });

  it("repairs missing history on already-sent exports, recording offline mail with actor and tag attribution", async () => {
    mocks.getByIdForUpdate.mockResolvedValue({
      name: "Test Mailing", medium: ["postal"], data: { offline: true }, status: "sent",
    });
    await downloadMailCsv(storage, "message", "staff-user");
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.record).toHaveBeenCalledWith("message", [
      expect.objectContaining({ participantId: "participant", contactId: "one",
        postal: expect.objectContaining({ description: "Test Mailing", toAddressLine1: "10 Main St", toZip: "00501" }) }),
    ], ["postal-tag"], "staff-user");
  });

  it("does not pretend a history write or participant link failure completed the mailing", async () => {
    mocks.record.mockRejectedValueOnce(new Error("record failed"));
    await expect(downloadMailCsv(storage, "message")).rejects.toThrow("record failed");
    expect(mocks.update).not.toHaveBeenCalled();
    mocks.record.mockRejectedValueOnce(new Error("Unable to link every offline postal communication"));
    await expect(downloadMailCsv(storage, "message")).rejects.toThrow("link every offline");
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("preserves successful comm links and blocks missing-address recipients instead of recording success", async () => {
    mocks.participants.mockResolvedValue([
      { id: "existing", contactId: "one", medium: "postal", commId: "previous-comm", commStatus: "offline", status: "see_comm" },
      { id: "missing", messageId: "message", contactId: "missing", medium: "postal", commId: null },
    ]);
    mocks.mailingContacts.mockResolvedValue([
      { contactId: "missing", name: "No Address", address: null },
    ]);
    const result = await downloadMailCsv(storage, "message");
    expect(result.noFile).toBe(true);
    expect(result.missingAddressCount).toBe(1);
    expect(mocks.record).not.toHaveBeenCalled();
    expect(mocks.outcomes.mock.calls[0][1]).toEqual([
      expect.objectContaining({ participantId: "missing", contactId: "missing",
        status: "send_failed", commId: null, message: expect.stringContaining("no active postal address") }),
    ]);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("does not mark sent on empty exports or failed preparation", async () => {
    mocks.participants.mockResolvedValue([]);
    mocks.mailingContacts.mockResolvedValue([]);
    await expect(downloadMailCsv(storage, "message")).resolves.toMatchObject({ noFile: true, recipientCount: 0 });
    mocks.mailingContacts.mockRejectedValue(new Error("read failed"));
    await expect(downloadMailCsv(storage, "message")).rejects.toThrow("read failed");
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("exports only newly appended recipients after the first completion", async () => {
    await downloadMailCsv(storage, "message");
    mocks.participants.mockResolvedValue([
      { id: "participant", contactId: "one", medium: "postal", commId: "offline-comm", commStatus: "offline", status: "see_comm" },
      { id: "new", contactId: "two", medium: "postal", commId: null },
    ]);
    mocks.mailingContacts.mockResolvedValue([{ contactId: "two", name: "New Worker", address: address() }]);
    const result = await downloadMailCsv(storage, "message");
    expect(mocks.mailingContacts).toHaveBeenLastCalledWith("message", ["two"]);
    expect(result.recipientCount).toBe(1);
    expect(result.csv).toContain("New Worker");
    expect(mocks.record.mock.calls[1][1]).toHaveLength(1);
    expect(mocks.record.mock.calls[1][1][0].contactId).toBe("two");
  });

  it("returns a no-file explanation when outstanding selection is already complete", async () => {
    mocks.participants.mockResolvedValue([{
      id: "participant", contactId: "one", medium: "postal", commId: "completed", commStatus: "offline", status: "see_comm",
    }]);
    mocks.mailingContacts.mockResolvedValue([]);
    const result = await downloadMailCsv(storage, "message");
    expect(result).toMatchObject({ noFile: true, recipientCount: 0, blockedCount: 0 });
    expect(result.message).toContain("No recipients need mailing");
    expect(mocks.record).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("rejects an undeliverable primary without using a secondary address, and allows a corrected retry", async () => {
    mocks.mailingContacts.mockResolvedValue([
      { contactId: "one", name: "Blocked", address: address({ isPrimary: true, deliverabilityStatus: "undeliverable" }) },
      { contactId: "one", name: "Blocked", address: address({ deliverabilityStatus: "verified" }) },
    ]);
    const blocked = await downloadMailCsv(storage, "message");
    expect(blocked).toMatchObject({ noFile: true, blockedCount: 1, recipientCount: 0 });
    expect(blocked.csv).not.toContain("Blocked");
    expect(mocks.outcomes.mock.calls[0][1][0]).toMatchObject({ status: "send_failed", commId: null });
    expect(mocks.record).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
    mocks.mailingContacts.mockResolvedValue([{ contactId: "one", name: "Corrected", address: address() }]);
    mocks.participants.mockResolvedValue([{ id: "participant", contactId: "one", medium: "postal", commId: null, status: "send_failed" }]);
    const corrected = await downloadMailCsv(storage, "message");
    expect(corrected).toMatchObject({ noFile: false, blockedCount: 0, recipientCount: 1 });
    expect(mocks.record).toHaveBeenCalledTimes(1);
  });

  it("reports partial batches, completing only usable recipients", async () => {
    mocks.participants.mockResolvedValue([
      { id: "good", contactId: "one", medium: "postal", commId: null },
      { id: "bad", contactId: "two", medium: "postal", commId: null },
    ]);
    mocks.mailingContacts.mockResolvedValue([
      { contactId: "one", name: "Good", address: address() },
      { contactId: "two", name: "Bad", address: address({ deliverabilityStatus: "undeliverable" }) },
    ]);
    const result = await downloadMailCsv(storage, "message");
    expect(result).toMatchObject({ noFile: false, recipientCount: 1, blockedCount: 1 });
    expect(result.csv).not.toContain('"Bad"');
    expect(mocks.record.mock.calls[0][1].map((row: { contactId: string }) => row.contactId)).toEqual(["one"]);
    expect(mocks.outcomes.mock.calls[0][1][0].participantId).toBe("bad");
  });

  it("retries a linked failed comm without treating it as already mailed or reusing its spent key", async () => {
    mocks.participants.mockResolvedValue([{
      id: "participant", contactId: "one", medium: "postal", commId: "failed-comm", commStatus: "failed",
    }]);
    mocks.evidence.mockResolvedValue([{
      id: "failed-comm", contactId: "one", status: "failed", sendKey: "bulk-postal-export:message",
    }]);
    const result = await downloadMailCsv(storage, "message");
    expect(result.recipientCount).toBe(1);
    expect(mocks.record.mock.calls[0][1][0]).toMatchObject({
      previousCommId: "failed-comm", sendKey: "bulk-postal-export:message:retry:failed-comm",
    });
  });

  it("repairs a removed/re-added recipient from send-once evidence without exporting or creating history again", async () => {
    mocks.mailingContacts.mockResolvedValue([]);
    mocks.evidence.mockResolvedValue([{
      id: "spent", contactId: "one", status: "offline", sendKey: "bulk-postal-export:message",
    }]);
    const result = await downloadMailCsv(storage, "message");
    expect(result.noFile).toBe(true);
    expect(mocks.record).not.toHaveBeenCalled();
    expect(mocks.outcomes.mock.calls[0][1][0]).toMatchObject({
      participantId: "participant", commId: "spent", status: "see_comm",
    });
  });

  it("does not erase a previous all-recipient address refusal during an outstanding-only no-op", async () => {
    mocks.mailingContacts.mockResolvedValue([]);
    mocks.participants.mockResolvedValue([{
      id: "participant", contactId: "one", medium: "postal", commId: "sent", commStatus: "offline",
      status: "send_failed", message: "Postal address is marked undeliverable.",
    }]);
    expect((await downloadMailCsv(storage, "message")).noFile).toBe(true);
    expect(mocks.outcomes).not.toHaveBeenCalled();
  });

  it("does not return a download if the sent-state update fails", async () => {
    mocks.update.mockRejectedValueOnce(new Error("write failed"));
    await expect(downloadMailCsv(storage, "message")).rejects.toThrow("write failed");
    mocks.update.mockResolvedValueOnce(undefined);
    await expect(downloadMailCsv(storage, "message")).rejects.toThrow("completion failed");
  });

  it.each([
    undefined,
    { medium: ["postal"], data: { offline: false }, status: "draft" },
    { medium: ["email"], data: { offline: true }, status: "draft" },
  ])("refuses missing or non-offline-postal messages before reading PII", async (bulk) => {
    mocks.getByIdForUpdate.mockResolvedValue(bulk);
    await expect(downloadMailCsv(storage, "message")).rejects.toMatchObject({ status: bulk ? 400 : 404 });
    expect(mocks.mailingContacts).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
