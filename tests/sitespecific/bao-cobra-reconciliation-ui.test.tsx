// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CobraStatusReconciliation } from "../../client/src/components/sitespecific/bao/CobraStatusReconciliation";

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));
vi.mock("@/lib/queryClient", () => ({ apiRequest }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;
let client: QueryClient;
const buttons = () => [...container.querySelectorAll("button")];
const click = async (text: string) => {
  await act(async () => {
    buttons().find((b) => b.textContent === text)!.click();
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
};
const report = (overrides = {}) => ({
  results: [{
    caseId: "case", blockers: [], changes: { statusId: "enrolled", paymentStatus: "paid" },
    targetStatusName: "Enrolled", initialSatisfied: true, applied: false, ...overrides,
  }],
});
beforeEach(async () => {
  apiRequest.mockReset();
  client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<QueryClientProvider client={client}>
    <CobraStatusReconciliation caseId="case" />
  </QueryClientProvider>));
});
afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  container.remove();
});

describe("COBRA staff reconciliation control", () => {
  it("requires a preview before offering a named status change and applies only this case", async () => {
    expect(container.textContent).not.toContain("Apply status reconciliation");
    apiRequest.mockResolvedValueOnce({ json: async () => report() });
    await click("Preview status reconciliation");
    expect(apiRequest).toHaveBeenLastCalledWith("POST", "/api/sitespecific/bao/cobra/status-reconcile", {
      mode: "test", caseIds: ["case"],
    });
    expect(container.textContent).toContain("Proposed case status: Enrolled");
    expect(container.textContent).toContain("Initial obligation: satisfied");
    apiRequest.mockResolvedValueOnce({ json: async () => report({ applied: true }) });
    await click("Apply status reconciliation");
    expect(apiRequest).toHaveBeenLastCalledWith("POST", "/api/sitespecific/bao/cobra/status-reconcile", {
      mode: "live", caseIds: ["case"],
    });
    expect(container.textContent).toContain("Case status reconciled.");
    expect(container.textContent).not.toContain("Apply status reconciliation");
  });
  it("explains blockers and never offers an apply action for unsupported transitions", async () => {
    apiRequest.mockResolvedValueOnce({ json: async () => report({
      blockers: ["No posted case premium for 2026-01"], changes: {},
    }) });
    await click("Preview status reconciliation");
    expect(container.textContent).toContain("No posted case premium for 2026-01");
    expect(container.textContent).not.toContain("Apply status reconciliation");
  });
  it("shows a changed blocker returned by the locked apply recheck", async () => {
    apiRequest.mockResolvedValueOnce({ json: async () => report() });
    await click("Preview status reconciliation");
    apiRequest.mockResolvedValueOnce({ json: async () => report({
      blockers: ["The financial evidence changed"], changes: {},
    }) });
    await click("Apply status reconciliation");
    expect(container.textContent).toContain("The financial evidence changed");
    expect(container.textContent).not.toContain("Case status reconciled.");
  });
  it("reports request failures without implying success", async () => {
    apiRequest.mockRejectedValueOnce(new Error("Status service unavailable"));
    await click("Preview status reconciliation");
    expect(container.querySelector("[role=alert]")?.textContent).toBe("Status service unavailable");
    expect(container.textContent).not.toContain("Case status reconciled.");
  });
});
