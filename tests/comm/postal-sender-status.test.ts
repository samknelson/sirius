import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createComm: vi.fn(),
  updateComm: vi.fn(),
  createCommPostal: vi.fn(),
  updateCommPostal: vi.fn(),
  getPostalOptin: vi.fn(),
  sendLetter: vi.fn(),
  getCommWithDetails: vi.fn(),
  renderLetterPdf: vi.fn(),
  downloadRemoteLetterPdf: vi.fn(),
}));

vi.mock("../../server/services/comm/letter-pdf", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../server/services/comm/letter-pdf")>(),
  renderLetterPdf: mocks.renderLetterPdf,
}));

vi.mock("../../server/services/comm/remote-letter-pdf", () => ({
  downloadRemoteLetterPdf: mocks.downloadRemoteLetterPdf,
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
import { LetterRenderQueue } from "../../server/services/comm/letter-render-queue";

const toAddress = {
  name: "Test Recipient",
  addressLine1: "123 Main St",
  city: "Portland",
  state: "OR",
  zip: "97201",
  country: "US",
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

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
    mocks.renderLetterPdf.mockResolvedValue(Buffer.from("%PDF-finalized"));
    mocks.downloadRemoteLetterPdf.mockResolvedValue(Buffer.from("%PDF-downloaded"));
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

  it("renders a composed letter and submits only the finalized PDF", async () => {
    mocks.sendLetter.mockResolvedValue({
      success: true,
      letterId: "ltr_pdf",
      details: { providerStatus: "created" },
    });

    const result = await sendPostal({
      contactId: "contact-1",
      toAddress,
      file: '<p style="position:fixed">Final letter</p><script>steal()</script>',
    });

    expect(result.success).toBe(true);
    expect(mocks.renderLetterPdf).toHaveBeenCalledOnce();
    const renderedHtml = mocks.renderLetterPdf.mock.calls[0][0] as string;
    expect(renderedHtml).toContain("sirius-letter-page-v2");
    expect(renderedHtml).toContain("<p>Final letter</p>");
    expect(renderedHtml).not.toContain("position:fixed");
    expect(renderedHtml).not.toContain("<script");
    const sendParams = mocks.sendLetter.mock.calls[0][0];
    expect(sendParams.file).toBeUndefined();
    expect(sendParams.pdfFile).toEqual(Buffer.from("%PDF-finalized"));
  });

  it("does not spend a send key on render failure, so the same keyed send can retry", async () => {
    mocks.renderLetterPdf.mockRejectedValueOnce(new Error("Chromium could not render the letter"));
    mocks.sendLetter.mockResolvedValue({
      success: true,
      letterId: "ltr_retry",
      details: { providerStatus: "created" },
    });
    const request = {
      contactId: "contact-1",
      toAddress,
      file: "<p>Final letter</p>",
      sendKey: "notice:case-1",
    };

    const failed = await sendPostal(request);

    expect(failed).toMatchObject({
      success: false,
      errorCode: "LETTER_PREPARATION_FAILED",
      error: "Chromium could not render the letter",
    });
    expect(failed.comm).toBeUndefined();
    expect(mocks.createComm).not.toHaveBeenCalled();
    expect(mocks.updateComm).not.toHaveBeenCalled();
    expect(mocks.sendLetter).not.toHaveBeenCalled();

    const retried = await sendPostal(request);

    expect(retried.success).toBe(true);
    expect(mocks.createComm).toHaveBeenCalledOnce();
    expect(mocks.createComm).toHaveBeenCalledWith(
      expect.objectContaining({ sendKey: "notice:case-1" }),
    );
    expect(mocks.sendLetter).toHaveBeenCalledOnce();
  });

  it("does not claim or send while a keyed letter is still rendering", async () => {
    const pendingPdf = deferred<Buffer>();
    mocks.renderLetterPdf.mockReturnValueOnce(pendingPdf.promise);
    mocks.sendLetter.mockResolvedValue({
      success: true,
      letterId: "ltr_pending",
      details: { providerStatus: "created" },
    });

    const sending = sendPostal({
      contactId: "contact-1",
      toAddress,
      file: "<p>Pending letter</p>",
      sendKey: "notice:pending",
    });
    await vi.waitFor(() => expect(mocks.renderLetterPdf).toHaveBeenCalledOnce());

    expect(mocks.createComm).not.toHaveBeenCalled();
    expect(mocks.sendLetter).not.toHaveBeenCalled();

    pendingPdf.resolve(Buffer.from("%PDF-pending"));
    const result = await sending;

    expect(result.success).toBe(true);
    expect(mocks.createComm).toHaveBeenCalledOnce();
    expect(mocks.createComm).toHaveBeenCalledWith(
      expect.objectContaining({ sendKey: "notice:pending" }),
    );
    expect(mocks.sendLetter).toHaveBeenCalledOnce();
  });

  it("passes the existing template path through without rendering a PDF", async () => {
    mocks.sendLetter.mockResolvedValue({
      success: true,
      letterId: "ltr_template",
      details: { providerStatus: "created" },
    });
    const mergeVariables = { firstName: "Taylor" };

    const result = await sendPostal({
      contactId: "contact-1",
      toAddress,
      templateId: "tmpl_existing",
      mergeVariables,
    });

    expect(result.success).toBe(true);
    expect(mocks.renderLetterPdf).not.toHaveBeenCalled();
    const sendParams = mocks.sendLetter.mock.calls[0][0];
    expect(sendParams.file).toBeUndefined();
    expect(sendParams).toMatchObject({
      pdfFile: undefined,
      templateId: "tmpl_existing",
      mergeVariables,
    });
  });

  it("downloads a remote letter and sends only its validated PDF bytes", async () => {
    mocks.sendLetter.mockResolvedValue({
      success: true,
      letterId: "ltr_remote",
      details: { providerStatus: "created" },
    });
    const url = "https://letters.example.test/final.pdf";

    const result = await sendPostal({
      contactId: "contact-1",
      toAddress,
      file: url,
    });

    expect(result.success).toBe(true);
    expect(mocks.downloadRemoteLetterPdf).toHaveBeenCalledWith(url);
    expect(mocks.renderLetterPdf).not.toHaveBeenCalled();
    const sendParams = mocks.sendLetter.mock.calls[0][0];
    expect(sendParams.file).toBeUndefined();
    expect(sendParams.pdfFile).toEqual(Buffer.from("%PDF-downloaded"));
    expect(JSON.stringify(sendParams)).not.toContain(url);
  });

  it("does not call transport when a remote letter download is refused", async () => {
    mocks.downloadRemoteLetterPdf.mockRejectedValue(
      new Error("Remote letter download was refused"),
    );

    const result = await sendPostal({
      contactId: "contact-1",
      toAddress,
      file: "https://letters.example.test/refused.pdf",
    });

    expect(result).toMatchObject({
      success: false,
      errorCode: "LETTER_PREPARATION_FAILED",
      error: "Remote letter download was refused",
    });
    expect(result.comm).toBeUndefined();
    expect(mocks.renderLetterPdf).not.toHaveBeenCalled();
    expect(mocks.createComm).not.toHaveBeenCalled();
    expect(mocks.updateComm).not.toHaveBeenCalled();
    expect(mocks.sendLetter).not.toHaveBeenCalled();
  });

  it("keeps the delivery lane available while two previews occupy its separate lane", async () => {
    const queue = new LetterRenderQueue({ waitTimeoutMs: 1_000 });
    const previewGate = deferred<void>();
    const firstPreview = queue.run(true, () => previewGate.promise);
    const secondPreviewTask = vi.fn(async () => undefined);
    const secondPreview = queue.run(true, secondPreviewTask);
    mocks.renderLetterPdf.mockImplementationOnce(() =>
      queue.run(false, async () => Buffer.from("%PDF-delivery")),
    );
    mocks.sendLetter.mockResolvedValue({
      success: true,
      letterId: "ltr_lane",
      details: { providerStatus: "created" },
    });

    const result = await sendPostal({
      contactId: "contact-1",
      toAddress,
      file: "<p>Delivery letter</p>",
      sendKey: "notice:lane-isolation",
    });

    expect(result.success).toBe(true);
    expect(secondPreviewTask).not.toHaveBeenCalled();
    expect(mocks.createComm).toHaveBeenCalledOnce();
    expect(mocks.createComm).toHaveBeenCalledWith(
      expect.objectContaining({ sendKey: "notice:lane-isolation" }),
    );
    expect(mocks.sendLetter).toHaveBeenCalledOnce();

    previewGate.resolve();
    await Promise.all([firstPreview, secondPreview]);
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