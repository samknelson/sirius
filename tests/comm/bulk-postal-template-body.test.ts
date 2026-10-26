import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IStorage } from "../../server/storage";

const mocks = vi.hoisted(() => ({ send: vi.fn(), render: vi.fn() }));
vi.mock("../../server/services/comm/senders/postal", () => ({ sendPostal: mocks.send }));
vi.mock("../../server/plugins/tokens", () => ({
  createTokenEvalContext: () => ({}), renderTokens: mocks.render,
  evaluateChain: vi.fn(), buildTokenPickerEntries: () => [],
}));
vi.mock("../../server/modules/bulk/token-roots", () => ({ BULK_POSTAL_MERGE_ROOT_NAMES: [] }));
vi.mock("../../server/delivery/shape", () => ({
  mediumField: (_medium: string, key: string) => ({ key }),
  tokenCleanerFor: () => undefined,
}));
vi.mock("../../server/modules/bulk/postal-address", () => ({
  selectActivePostalAddress: () => ({ street: "1 Example Street", city: "Example", state: "NY", postalCode: "10001", country: "US" }),
}));
import { deliverPostal } from "../../server/modules/bulk/deliver-postal";

const content = {
  description: "Notice", fileUrl: "https://example.invalid/old.pdf", templateId: "old-vendor-template",
  mailType: "usps_first_class", data: { body: "<p>Dear {{contact.name}}</p>" },
};
const storage = {
  bulkMessagesPostal: { getByBulkId: async () => content },
  contacts: { addresses: { getContactPostalByContact: async () => [] }, getContact: async () => ({ displayName: "Example" }) },
} as unknown as IStorage;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.send.mockResolvedValue({ success: true, comm: { id: "comm" } });
  mocks.render.mockImplementation(async (text: string) => ({ output: text.replace("{{contact.name}}", "Example") }));
});

describe("selected postal template content", () => {
  it("renders recipient-specific HTML through the existing token renderer before provider submission", async () => {
    const result = await deliverPostal(storage, "message", "contact", []);
    expect(result.success).toBe(true);
    expect(mocks.render).toHaveBeenCalledWith(content.data.body, expect.anything(), expect.objectContaining({ strictUnknown: true }));
    expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({
      file: "<p>Dear Example</p>", templateId: undefined, description: "Notice",
    }));
  });
  it("does not render a printed body for an offline mailing-list export", async () => {
    await deliverPostal(storage, "message", "contact", [], undefined, undefined, true, {
      toAddress: { addressLine1: "1 Example", city: "Example", state: "NY", zip: "10001", country: "US" },
      sendKey: "offline-test", fallbackDescription: "Mailing",
    });
    expect(mocks.render.mock.calls.some(([text]) => text === content.data.body)).toBe(false);
    expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({ sendOffline: true, sendKey: "offline-test" }));
  });
});
