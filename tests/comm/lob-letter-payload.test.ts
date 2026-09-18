import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  wcUncachedRequest: vi.fn(),
}));

vi.mock("../../server/services/webclient", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../server/services/webclient")>(),
  wcUncachedRequest: mocks.wcUncachedRequest,
}));

import { LobPostalProvider } from "../../server/services/comm/providers/postal/lob";

const address = {
  name: "Test Person",
  addressLine1: "123 Main St",
  city: "Portland",
  state: "OR",
  zip: "97201",
  country: "US",
};

describe("Lob letter request payload", () => {
  let provider: LobPostalProvider;
  let outboundPayload: Record<string, unknown> | undefined;

  beforeEach(async () => {
    vi.clearAllMocks();
    outboundPayload = undefined;
    provider = new LobPostalProvider();
    await provider.configure({ apiKey: "test_key" });

    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      outboundPayload = JSON.parse(String(init?.body));
      return {
        ok: true,
        json: async () => ({ id: "ltr_test" }),
      };
    }));

    mocks.wcUncachedRequest.mockImplementation(async ({ fetch }: { fetch: () => Promise<unknown> }) => {
      const result = await fetch() as {
        answered: boolean;
        value?: unknown;
        error?: string;
      };
      return result.answered
        ? { value: result.value }
        : { error: result.error };
    });
  });

  it("uses a selected template as Lob's file source and preserves merge variables", async () => {
    const result = await provider.sendLetter({
      to: address,
      from: address,
      templateId: "tmpl_selected",
      mergeVariables: { first_name: "Taylor" },
    });

    expect(result.success).toBe(true);
    expect(outboundPayload).toMatchObject({
      file: "tmpl_selected",
      merge_variables: { first_name: "Taylor" },
    });
    expect(outboundPayload).not.toHaveProperty("template_id");
  });

  it("refuses direct HTML before it can reach Lob's renderer", async () => {
    const html = "<html><body>Direct letter</body></html>";
    const result = await provider.sendLetter({
      to: address,
      from: address,
      file: html,
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/does not accept string file content/);
    expect(outboundPayload).toBeUndefined();
    expect(mocks.wcUncachedRequest).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    ["missing", {}],
    ["ambiguous", { pdfFile: Buffer.from("%PDF-1.7"), templateId: "tmpl_selected" }],
  ])("rejects %s letter content before calling Lob", async (_case, content) => {
    const result = await provider.sendLetter({
      to: address,
      from: address,
      ...content,
    });

    expect(result).toEqual({
      success: false,
      error: "Exactly one of pdfFile or templateId must be supplied",
    });
    expect(mocks.wcUncachedRequest).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
});