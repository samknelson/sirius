import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ContactPostal } from "../../shared/schema";
import type { IStorage } from "../../server/storage";

const mocks = vi.hoisted(() => ({
  mailingContacts: vi.fn(),
  getByIdForUpdate: vi.fn(),
  update: vi.fn(),
  participants: vi.fn(),
  link: vi.fn(),
  deliverPostal: vi.fn(),
}));
vi.mock("../../server/storage/bulk/participants", () => ({
  createBulkParticipantStorage: () => ({
    getMailingContacts: mocks.mailingContacts, getByMessageId: mocks.participants,
  }),
}));
vi.mock("../../server/modules/bulk/deliver-postal", () => ({ deliverPostal: mocks.deliverPostal }));
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
  bulkParticipants: { update: mocks.link },
} as unknown as IStorage;
const address = (overrides: Partial<ContactPostal> = {}) => ({
  isActive: true, isPrimary: false, street: "10 Main St",
  city: "Boston", state: "MA", postalCode: "00501",
  deliverabilityStatus: "unknown", ...overrides,
} as ContactPostal);

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getByIdForUpdate.mockResolvedValue({
    id: "message", medium: ["postal", "email"], data: { offline: true }, status: "draft",
  });
  mocks.mailingContacts.mockResolvedValue([
    { contactId: "one", name: "Full Name", address: address() },
  ]);
  mocks.update.mockResolvedValue({ id: "message", status: "sent" });
  mocks.participants.mockResolvedValue([{
    id: "participant", messageId: "message", contactId: "one", medium: "postal", commId: null,
  }]);
  mocks.deliverPostal.mockResolvedValue({ success: true, commId: "offline-comm" });
  mocks.link.mockImplementation(async (id, data) => {
    mocks.participants.mockResolvedValue([{
      id, messageId: "message", contactId: "one", medium: "postal", ...data,
    }]);
    return { id, ...data };
  });
});

describe("offline mailing CSV", () => {
  it("exports one row per contact, uses active primary, and preserves street lines, ZIP and deliverability", () => {
    const result = buildMailCsv([
      { contactId: "one", name: 'Last, "First"', address: address() },
      { contactId: "one", name: 'Last, "First"', address: address({
        isPrimary: true, street: "20 Oak\r\nApt 2\nBuilding B", deliverabilityStatus: "undeliverable",
      }) },
      { contactId: "one", name: 'Last, "First"', address: address({ isActive: false, isPrimary: true }) },
      { contactId: "two", name: "No Address", address: address({ isActive: false }) },
      { contactId: "three", name: "Fallback", address: address() },
    ]);
    expect(result.recipientCount).toBe(3);
    expect(result.missingAddressCount).toBe(1);
    expect(result.csv).toContain('"Full Name","Address 1","Address 2","City","State","ZIP","Primary Address","Deliverability Status"');
    expect(result.csv).toContain('"Last, ""First""","20 Oak","Apt 2\nBuilding B","Boston","MA","00501","true","undeliverable"');
    expect(result.csv).toContain('"No Address","","","","","","",""');
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
    const second = await downloadMailCsv(storage, "message");
    expect(second.csv).toBe(first.csv);
    expect(mocks.update).toHaveBeenCalledTimes(1);
    expect(mocks.deliverPostal).toHaveBeenCalledTimes(1);
    expect(mocks.link).toHaveBeenCalledWith("participant", {
      status: "see_comm", commId: "offline-comm", message: null,
    });
  });

  it("repairs missing history on already-sent exports, recording offline mail with actor and tag attribution", async () => {
    mocks.getByIdForUpdate.mockResolvedValue({
      name: "Test Mailing", medium: ["postal"], data: { offline: true }, status: "sent",
    });
    await downloadMailCsv(storage, "message", "staff-user");
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.deliverPostal).toHaveBeenCalledWith(
      storage, "message", "one", expect.any(Array), "staff-user", ["postal-tag"], true,
      expect.objectContaining({
        sendKey: "bulk-postal-export:message",
        fallbackDescription: "Test Mailing",
        toAddress: expect.objectContaining({ addressLine1: "10 Main St", zip: "00501" }),
      }),
    );
    expect(mocks.link).toHaveBeenCalledTimes(1);
  });

  it("does not pretend a history write or participant link failure completed the mailing", async () => {
    mocks.deliverPostal.mockResolvedValueOnce({ success: false, error: "record failed" });
    await expect(downloadMailCsv(storage, "message")).rejects.toThrow("record offline");
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.link).not.toHaveBeenCalled();
    mocks.link.mockResolvedValueOnce(undefined);
    await expect(downloadMailCsv(storage, "message")).rejects.toThrow("link offline");
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("preserves existing comm links and other media, but records missing-address postal recipients", async () => {
    mocks.participants.mockResolvedValue([
      { id: "existing", contactId: "one", medium: "postal", commId: "previous-comm" },
      { id: "email", contactId: "one", medium: "email", commId: null },
      { id: "missing", messageId: "message", contactId: "missing", medium: "postal", commId: null },
    ]);
    mocks.mailingContacts.mockResolvedValue([
      { contactId: "one", name: "Existing", address: address() },
      { contactId: "missing", name: "No Address", address: null },
    ]);
    const result = await downloadMailCsv(storage, "message");
    expect(result.missingAddressCount).toBe(1);
    expect(mocks.deliverPostal).toHaveBeenCalledTimes(1);
    expect(mocks.deliverPostal.mock.calls[0][2]).toBe("missing");
    expect(mocks.deliverPostal.mock.calls[0][7].toAddress.addressLine1).toBe("");
    expect(mocks.link.mock.calls[0][0]).toBe("missing");
  });

  it("does not mark sent on empty exports or failed preparation", async () => {
    mocks.mailingContacts.mockResolvedValue([]);
    await expect(downloadMailCsv(storage, "message")).rejects.toMatchObject({ status: 400 });
    mocks.mailingContacts.mockRejectedValue(new Error("read failed"));
    await expect(downloadMailCsv(storage, "message")).rejects.toThrow("read failed");
    expect(mocks.update).not.toHaveBeenCalled();
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
