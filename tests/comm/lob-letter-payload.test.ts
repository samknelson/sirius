import { beforeEach, describe, expect, it, vi } from "vitest";

import "../../server/plugins/wc-vendors/plugins/postal";
import { getWcVendorHandler } from "../../server/plugins/wc-vendors/registry";
import type { LetterSendResult, SendLetterParams } from "../../server/services/comm/providers/postal";
import type { WcVendorContext } from "../../server/plugins/wc-vendors/types";

const context = {
  credential: { secretName: "LOB_TEST_SECRET", value: "test_key" },
  config: { id: "lob-config", pluginKind: "wc-vendors", pluginId: "lob", enabled: true, ordering: 0, data: {} },
} as WcVendorContext;
const provider = {
  sendLetter: (args: SendLetterParams) =>
    getWcVendorHandler("lob", "communications.postal.send")!(context, args as never) as Promise<LetterSendResult>,
};

const address = {
  name: "Test Person",
  addressLine1: "123 Main St",
  city: "Portland",
  state: "OR",
  zip: "97201",
  country: "US",
};

describe("Lob letter request payload", () => {
  let outboundPayload: Record<string, unknown> | undefined;

  beforeEach(async () => {
    vi.clearAllMocks();
    outboundPayload = undefined;

    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      outboundPayload = JSON.parse(String(init?.body));
      return {
        ok: true,
        json: async () => ({ id: "ltr_test" }),
      };
    }));

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
    expect(fetch).not.toHaveBeenCalled();
  });
});