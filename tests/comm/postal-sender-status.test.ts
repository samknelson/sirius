import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createComm: vi.fn(),
  updateComm: vi.fn(),
  createCommPostal: vi.fn(),
  updateCommPostal: vi.fn(),
  getPostalOptin: vi.fn(),
  sendLetter: vi.fn(),
  getCommWithDetails: vi.fn(),
}));

vi.mock("../../server/storage/comm", () => ({
  createCommStorage: () => ({
    createComm: mocks.createComm,
    updateComm: mocks.updateComm,
    lockComm: vi.fn(),
    getCommWithDetails: mocks.getCommWithDetails,
  }),
  createCommPostalStorage: () => ({
    createCommPostal: mocks.createCommPostal,
    updateCommPostal: mocks.updateCommPostal,
  }),
  createCommPostalOptinStorage: () => ({
    getPostalOptinByCanonicalAddress: mocks.getPostalOptin,
  }),
}));

vi.mock("../../server/storage", () => ({
  storage: { commTags: { setTags: vi.fn() } },
}));

vi.mock("../../server/storage/transaction-context", () => ({
  runInTransaction: (fn: () => unknown) => fn(),
}));

vi.mock("../../server/services/service-registry", () => ({
  serviceRegistry: {
    resolve: async () => ({
      id: "lob",
      supportsPostal: () => true,
      getDefaultReturnAddress: async () => ({
        addressLine1: "1 Return St",
        city: "Portland",
        state: "OR",
        zip: "97201",
        country: "US",
      }),
      sendLetter: mocks.sendLetter,
    }),
  },
}));

vi.mock("../../server/services/comm/validators/address-verification", () => ({
  verifyPostalAddress: async (_transport: unknown, address: unknown) => ({
    valid: true,
    canonicalAddress: "123 MAIN ST|PORTLAND|OR|97201|US",
    normalizedAddress: address,
  }),
}));

vi.mock("../../server/services/system-mode", () => ({
  getSystemMode: async () => "live",
}));

vi.mock("../../server/services/comm/callback-handlers/url-builder", () => ({
  buildStatusCallbackUrl: () => "https://example.test/lob/callback",
}));

vi.mock("../../server/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("../../server/services/maintenance-flag", () => ({
  isMaintenanceModeError: () => false,
}));

import { sendPostal } from "../../server/services/comm/senders/postal";

const toAddress = {
  name: "Test Recipient",
  addressLine1: "123 Main St",
  city: "Portland",
  state: "OR",
  zip: "97201",
  country: "US",
};

describe("postal sender Lob acceptance status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createComm.mockResolvedValue({
      id: "comm-1",
      medium: "postal",
      contactId: "contact-1",
      status: "sending",
      sent: null,
      data: {},
    });
    mocks.createCommPostal.mockResolvedValue({
      id: "postal-1",
      commId: "comm-1",
      data: {},
    });
    mocks.getPostalOptin.mockResolvedValue({ optin: true, allowlist: true });
    mocks.getCommWithDetails.mockResolvedValue({
      id: "comm-1",
      medium: "postal",
      contactId: "contact-1",
      status: "sending",
      sent: null,
      data: {},
      postalDetails: {
        id: "postal-1",
        commId: "comm-1",
        data: {},
      },
    });
    mocks.updateComm.mockImplementation(async (_id, update) => ({
      ...(await mocks.getCommWithDetails()),
      ...update,
    }));
    mocks.updateCommPostal.mockImplementation(async (_id, update) => ({
      id: "postal-1",
      commId: "comm-1",
      ...update,
    }));
  });

  it("records a successful provider acceptance as queued without a sent timestamp", async () => {
    mocks.sendLetter.mockResolvedValue({
      success: true,
      letterId: "ltr_test",
      details: { providerStatus: "created" },
    });

    const result = await sendPostal({ contactId: "contact-1", toAddress });

    expect(result.success).toBe(true);
    expect(result.comm?.status).toBe("queued");
    expect(result.comm?.sent).toBeNull();
    expect(mocks.createComm).toHaveBeenCalledWith(
      expect.not.objectContaining({ sent: expect.anything() }),
    );
    expect(mocks.updateComm).toHaveBeenLastCalledWith(
      "comm-1",
      expect.objectContaining({ status: "queued" }),
    );
    expect(mocks.sendLetter).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: {
          commId: "comm-1",
          contactId: "contact-1",
        },
      }),
    );
  });

  it("keeps a failed provider request failed rather than queued or sent", async () => {
    mocks.sendLetter.mockResolvedValue({
      success: false,
      error: "Lob rejected the request",
    });

    const result = await sendPostal({ contactId: "contact-1", toAddress });

    expect(result.success).toBe(false);
    expect(result.comm?.status).toBe("failed");
    expect(mocks.updateComm).toHaveBeenLastCalledWith(
      "comm-1",
      expect.objectContaining({ status: "failed" }),
    );
    expect(mocks.updateComm).not.toHaveBeenCalledWith(
      "comm-1",
      expect.objectContaining({ status: "queued" }),
    );
  });

  it("does not overwrite a callback that wins the race with provider acceptance", async () => {
    const mailedAt = new Date("2026-09-08T12:00:00.000Z");
    mocks.getCommWithDetails.mockResolvedValue({
      id: "comm-1",
      medium: "postal",
      contactId: "contact-1",
      status: "sent",
      sent: mailedAt,
      data: {
        lastProviderStatus: "letter.mailed",
        lastAppliedStatusUpdate: mailedAt.toISOString(),
      },
      postalDetails: {
        id: "postal-1",
        commId: "comm-1",
        data: { providerStatus: "letter.mailed" },
      },
    });
    mocks.sendLetter.mockResolvedValue({
      success: true,
      letterId: "ltr_test",
      details: { providerStatus: "created" },
    });

    const result = await sendPostal({ contactId: "contact-1", toAddress });

    expect(result.comm?.status).toBe("sent");
    expect(result.comm?.sent).toEqual(mailedAt);
    expect(mocks.updateComm).toHaveBeenLastCalledWith(
      "comm-1",
      expect.objectContaining({
        status: "sent",
        data: expect.objectContaining({
          lastProviderStatus: "letter.mailed",
          letterId: "ltr_test",
        }),
      }),
    );
    expect(mocks.updateCommPostal).toHaveBeenLastCalledWith(
      "postal-1",
      expect.objectContaining({
        data: expect.objectContaining({
          providerStatus: "letter.mailed",
          providerDetails: { providerStatus: "created" },
        }),
      }),
    );
  });
});