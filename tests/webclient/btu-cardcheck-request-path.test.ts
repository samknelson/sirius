import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  wcRequest: vi.fn(),
  closeSession: vi.fn(),
}));

vi.mock("../../server/services/webclient", () => ({
  wcRequest: mocks.wcRequest,
}));
vi.mock("../../server/plugins/wc-vendors/plugins/btu-cardcheck", () => ({
  BTU_CARDCHECK_PLUGIN_ID: "sitespecific-btu-cardcheck",
  closeBtuCardcheckSession: mocks.closeSession,
}));

import {
  fetchBtuCardcheckPdf,
  startBtuCardcheckScrape,
} from "../../server/services/btu-cardcheck-scrape";

describe("BTU card-check service WC request path", () => {
  beforeEach(() => {
    mocks.wcRequest.mockReset();
  });

  it("starts sessions through the renamed vendor login operation", async () => {
    mocks.wcRequest.mockResolvedValue({ value: { sessionId: "session-1" } });

    await expect(startBtuCardcheckScrape()).resolves.toBe("session-1");
    expect(mocks.wcRequest).toHaveBeenCalledWith({
      vendor: { pluginId: "sitespecific-btu-cardcheck" },
      operation: "login",
      args: undefined,
    });
  });

  it("retrieves card checks through the renamed vendor fetch operation", async () => {
    mocks.wcRequest.mockResolvedValue({
      value: { pdfBase64: Buffer.from("pdf").toString("base64") },
    });

    await expect(fetchBtuCardcheckPdf("session-1", "123")).resolves.toEqual(
      Buffer.from("pdf"),
    );
    expect(mocks.wcRequest).toHaveBeenCalledWith({
      vendor: { pluginId: "sitespecific-btu-cardcheck" },
      operation: "fetch-cardcheck",
      args: { sessionId: "session-1", nid: "123" },
    });
  });
});