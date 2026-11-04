// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  toast: vi.fn(),
  message: { id: "message", name: "SPD", medium: ["postal"], status: "sent", sendDate: null, data: { offline: true } },
}));
vi.mock("@/components/layouts/BulkMessageLayout", () => ({
  BulkMessageLayout: ({ children }: { children: React.ReactNode }) => children,
  useBulkMessageLayout: () => ({ bulkMessage: mocks.message }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock("@/components/bulk/TokenCoverageCard", () => ({ TokenCoverageCard: () => null }));
import DeliverPage from "../../client/src/pages/bulk-message-deliver";

let host: HTMLDivElement;
let root: Root;
let client: QueryClient;
let request: ReturnType<typeof vi.fn>;
const flush = () => new Promise(resolve => setTimeout(resolve, 10));
const stats = {
  total: 2, pending: 0, sendFailed: 1, seeComm: 1,
  commBreakdown: { offline: 1 }, byMedium: {},
};
beforeEach(async () => {
  vi.clearAllMocks();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div"); document.body.appendChild(host);
  root = createRoot(host);
  client = new QueryClient({ defaultOptions: { queries: {
    retry: false, staleTime: Infinity,
    queryFn: async ({ queryKey }) => queryKey.at(-1) === "delivery-stats" ? stats : { perToken: [] },
  } } });
  request = vi.fn();
  vi.stubGlobal("fetch", request);
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:mailing") });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
  await act(async () => {
    root.render(<QueryClientProvider client={client}><DeliverPage /></QueryClientProvider>);
    await flush();
  });
});
afterEach(async () => {
  await act(async () => root.unmount());
  client.clear(); host.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks();
});
const button = () => host.querySelector<HTMLButtonElement>('[data-testid="button-download-mail-csv"]')!;

describe("offline download interactions", () => {
  it("defaults to outstanding and shows persisted address errors for a no-file result", async () => {
    const invalidations = vi.spyOn(client, "invalidateQueries");
    request.mockResolvedValue(new Response(JSON.stringify({
      noFile: true, message: "No mailing file was created. Correct address errors and retry.",
      recipientCount: 0, blockedCount: 2, missingAddressCount: 1,
    }), { headers: { "Content-Type": "application/json" } }));
    expect(host.querySelector<HTMLSelectElement>("#mail-csv-mode")?.value).toBe("outstanding");
    await act(async () => { button().click(); await flush(); });
    expect(JSON.parse(request.mock.calls[0][1].body)).toEqual({ mode: "outstanding" });
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    const feedback = host.querySelector('[data-testid="feedback-mail-csv"]');
    expect(feedback?.textContent).toContain("Correct address errors");
    expect(feedback?.querySelector("a")?.getAttribute("href")).toBe("/bulk/message/recipients/list");
    expect(invalidations.mock.calls.map(([filter]) => filter?.queryKey?.at(-1))).toEqual(
      expect.arrayContaining(["message", "/api/bulk-messages", "participants", "delivery-stats", "token-coverage"]),
    );
    expect(button().disabled).toBe(false);
  });

  it("sends the All selection and shows both exported and blocked counts after saving a real CSV response", async () => {
    request.mockResolvedValue(new Response("Full Name,Address 1\nOne,10 Main", {
      headers: { "Content-Type": "text/csv", "X-Recipient-Count": "1", "X-Blocked-Recipient-Count": "1" },
    }));
    await act(async () => {
      const select = host.querySelector<HTMLSelectElement>("#mail-csv-mode")!;
      select.value = "all";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => { button().click(); await flush(); });
    expect(JSON.parse(request.mock.calls[0][1].body)).toEqual({ mode: "all" });
    expect(URL.createObjectURL).toHaveBeenCalledOnce();
    expect(host.querySelector('[data-testid="feedback-mail-csv"]')?.textContent).toContain("1 exported");
    expect(host.querySelector('[data-testid="feedback-mail-csv"]')?.textContent).toContain("1 blocked");
    expect(host.querySelector('[data-testid="stat-error-count"]')?.textContent).toBe("1");
    expect(host.querySelector('[data-testid="stat-offline-count"]')?.textContent).toBe("1");
  });
});
