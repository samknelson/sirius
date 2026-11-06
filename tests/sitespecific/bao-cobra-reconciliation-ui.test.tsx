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
    const invalidate = vi.spyOn(client, "invalidateQueries");
    expect(container.textContent).not.toContain("Apply status reconciliation");
    apiRequest.mockResolvedValueOnce(report());
    await click("Preview status reconciliation");
    expect(apiRequest).toHaveBeenLastCalledWith("POST", "/api/sitespecific/bao/cobra/status-reconcile", {
      mode: "test", caseIds: ["case"],
    });
    expect(container.querySelector("[role=alert]")).toBeNull();
    expect(container.textContent).toContain("Proposed payment status: paid");
    expect(container.textContent).toContain("Proposed case status: Enrolled");
    expect(container.textContent).toContain("Initial obligation: satisfied");
    expect(invalidate).not.toHaveBeenCalled();
    apiRequest.mockResolvedValueOnce(report({ applied: true }));
    await click("Apply status reconciliation");
    expect(apiRequest).toHaveBeenLastCalledWith("POST", "/api/sitespecific/bao/cobra/status-reconcile", {
      mode: "live", caseIds: ["case"],
    });
    expect(container.textContent).toContain("Case status reconciled.");
    expect(container.textContent).not.toContain("Apply status reconciliation");
    expect(invalidate).toHaveBeenCalledOnce();
  });
  it("explains blockers and never offers an apply action for unsupported transitions", async () => {
    apiRequest.mockResolvedValueOnce(report({
      blockers: ["No posted case premium for 2026-01"], changes: {},
    }));
    await click("Preview status reconciliation");
    expect(container.textContent).toContain("No posted case premium for 2026-01");
    expect(container.textContent).not.toContain("Apply status reconciliation");
    expect(container.textContent).not.toContain("Case status reconciled.");
  });
  it("shows a changed blocker returned by the locked apply recheck", async () => {
    apiRequest.mockResolvedValueOnce(report());
    await click("Preview status reconciliation");
    apiRequest.mockResolvedValueOnce(report({
      blockers: ["The financial evidence changed"], changes: {},
    }));
    await click("Apply status reconciliation");
    expect(container.textContent).toContain("The financial evidence changed");
    expect(container.textContent).not.toContain("Apply status reconciliation");
    expect(container.textContent).not.toContain("Case status reconciled.");
  });
  it("shows a no-change preview without offering apply or claiming success", async () => {
    apiRequest.mockResolvedValueOnce(report({ changes: {} }));
    await click("Preview status reconciliation");
    expect(container.textContent).toContain("No status changes are supported by the current evidence.");
    expect(container.textContent).not.toContain("Apply status reconciliation");
    expect(container.textContent).not.toContain("Case status reconciled.");
  });
  it("shows an unsatisfied initial obligation in the proposed status", async () => {
    apiRequest.mockResolvedValueOnce(report({
      changes: { paymentStatus: "unpaid" }, initialSatisfied: false,
    }));
    await click("Preview status reconciliation");
    expect(container.textContent).toContain("Proposed payment status: unpaid");
    expect(container.textContent).toContain("Initial obligation: not yet satisfied");
    expect(container.textContent).not.toContain("Proposed case status:");
  });
  it("does not claim success when the apply recheck finds no change to apply", async () => {
    apiRequest.mockResolvedValueOnce(report());
    await click("Preview status reconciliation");
    apiRequest.mockResolvedValueOnce(report({ changes: {}, applied: false }));
    await click("Apply status reconciliation");
    expect(container.textContent).toContain("No status changes are supported by the current evidence.");
    expect(container.textContent).not.toContain("Case status reconciled.");
    expect(container.textContent).not.toContain("Apply status reconciliation");
  });
  it("reports request failures without implying success", async () => {
    apiRequest.mockRejectedValueOnce(new Error("Status service unavailable"));
    await click("Preview status reconciliation");
    expect(container.querySelector("[role=alert]")?.textContent).toBe("Status service unavailable");
    expect(container.textContent).not.toContain("Case status reconciled.");
    expect(container.textContent).not.toContain("Apply status reconciliation");
  });
  it("keeps an apply request failure visible without claiming success or refreshing data", async () => {
    const invalidate = vi.spyOn(client, "invalidateQueries");
    apiRequest.mockResolvedValueOnce(report());
    await click("Preview status reconciliation");
    apiRequest.mockRejectedValueOnce(new Error("Unable to apply reconciliation"));
    await click("Apply status reconciliation");
    expect(container.querySelector("[role=alert]")?.textContent).toBe("Unable to apply reconciliation");
    expect(container.textContent).not.toContain("Case status reconciled.");
    expect(invalidate).not.toHaveBeenCalled();
  });
});
