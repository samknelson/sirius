import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  pluginId: "local-email",
  createComm: vi.fn(),
  createCommEmail: vi.fn(),
  updateComm: vi.fn(),
  updateCommEmail: vi.fn(),
  wcRequest: vi.fn(),
}));

vi.mock("../../server/services/comm/email-vendor", () => ({
  ensureEmailVendorConfig: vi.fn(async () => ({
    id: "email-config",
    pluginId: state.pluginId,
    enabled: true,
    data: {},
  })),
  emailVendorTarget: vi.fn(() => ({ configId: "email-config" })),
}));

vi.mock("../../server/plugins/wc-vendors", () => ({
  getWcVendorPlugin: (pluginId: string) =>
    pluginId === "sendgrid"
      ? { operations: { "send-email": { description: "send email" } } }
      : { operations: { "validate-email": { description: "validate email" } } },
}));

vi.mock("../../server/services/webclient", () => ({
  wcRequest: state.wcRequest,
}));

vi.mock("../../server/storage/comm", () => ({
  createCommStorage: () => ({
    createComm: state.createComm,
    updateComm: state.updateComm,
  }),
  createCommEmailStorage: () => ({
    createCommEmail: state.createCommEmail,
    updateCommEmail: state.updateCommEmail,
  }),
  createCommEmailOptinStorage: () => ({
    getEmailOptinByEmail: vi.fn(async () => ({ optin: true, allowlist: true })),
  }),
}));

vi.mock("../../server/storage", () => ({
  storage: {
    commTags: { setTags: vi.fn() },
  },
}));

vi.mock("../../server/storage/transaction-context", () => ({
  runInTransaction: async (fn: () => Promise<unknown>) => fn(),
}));

vi.mock("../../server/system-mode", () => ({
  getSystemMode: vi.fn(async () => "live"),
}));

import { sendEmail } from "../../server/services/comm/senders/email";

beforeEach(() => {
  state.pluginId = "local-email";
  state.createComm.mockReset();
  state.createCommEmail.mockReset();
  state.updateComm.mockReset();
  state.updateCommEmail.mockReset();
  state.wcRequest.mockReset();
  state.createComm.mockResolvedValue({
    id: "comm-1",
    status: "sending",
    data: {},
  });
  state.createCommEmail.mockResolvedValue({ id: "comm-email-1", data: {} });
  state.wcRequest.mockImplementation(async ({ operation }: { operation: string }) => {
    if (operation === "validate-email") {
      return { value: { valid: true, formatted: "recipient@example.test" } };
    }
    if (operation === "get-default-from") {
      return { value: { email: "sender@example.test" } };
    }
    if (operation === "send-email") {
      return { value: { success: true, messageId: "message-1" } };
    }
    throw new Error(`Unexpected operation ${operation}`);
  });
});

describe("email sender vendor capability gate", () => {
  it("does not claim a send key or create a Comm for Local Email, then retries after SendGrid selection", async () => {
    const request = {
      contactId: "contact-1",
      toEmail: "recipient@example.test",
      subject: "Subject",
      bodyText: "Body",
      sendKey: "email-once",
    };

    const localResult = await sendEmail(request);

    expect(localResult).toMatchObject({
      success: false,
      errorCode: "EMAIL_NOT_SUPPORTED",
    });
    expect(state.wcRequest).not.toHaveBeenCalled();
    expect(state.createComm).not.toHaveBeenCalled();
    expect(state.createCommEmail).not.toHaveBeenCalled();

    state.pluginId = "sendgrid";
    const sendGridResult = await sendEmail(request);

    expect(sendGridResult).toMatchObject({
      success: true,
      messageId: "message-1",
    });
    expect(state.createComm).toHaveBeenCalledTimes(1);
    expect(state.createComm).toHaveBeenCalledWith(
      expect.objectContaining({ sendKey: "email-once" }),
    );
    expect(state.wcRequest).toHaveBeenCalledWith(
      expect.objectContaining({ operation: "send-email" }),
    );
  });
});