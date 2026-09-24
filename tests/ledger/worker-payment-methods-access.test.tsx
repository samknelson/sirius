// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

const apiRequest = vi.hoisted(() => vi.fn());
vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>("@/lib/queryClient");
  return { ...actual, apiRequest };
});
vi.mock("@/components/layouts/WorkerLayout", () => ({
  WorkerLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  useWorkerLayout: () => ({ worker: { id: "worker-1" } }),
}));
vi.mock("@/plugins/payment-gateway/registry", () => ({
  hasPaymentGatewayComponent: () => false,
  resolvePaymentGatewayComponent: () => null,
}));

import WorkerPaymentMethodsPage from "@/pages/worker-payment-methods";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
let container: HTMLDivElement | null = null;
afterEach(async () => {
  await act(async () => { root?.unmount(); });
  container?.remove();
  root = null;
  container = null;
  apiRequest.mockReset();
});

describe("worker saved method management controls", () => {
  it.each([false, true])("shows mutation controls only when management authority is %s", async (canManageMethods) => {
    apiRequest.mockImplementation(async (_method: string, url: string) => {
      if (url.endsWith("/capabilities")) return { canManageMethods };
      if (url.endsWith("/authorization")) return { authorization: { version: "v1", text: "Authorize" } };
      if (url.endsWith("/gateways")) return [];
      return [{ id: "saved-1", isDefault: false, gatewayConfigId: "gateway-1",
        isActive: true, providerDetails: { card: { brand: "Visa", last4: "4242", expMonth: 12, expYear: 2030 } } }];
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => { root!.render(<QueryClientProvider client={queryClient}><WorkerPaymentMethodsPage /></QueryClientProvider>); });
    for (let i = 0; i < 5; i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    expect(container.textContent).toContain("Visa •••• 4242");
    expect(!!container.querySelector('[data-testid="button-worker-add-payment-method"]')).toBe(canManageMethods);
    expect(!!container.querySelector('button[aria-label="Remove"]')).toBe(canManageMethods);
    expect(!!container.querySelector('button[aria-label="Set default"]')).toBe(canManageMethods);
    expect(apiRequest.mock.calls.some(([, url]) => String(url).endsWith("/authorization"))).toBe(canManageMethods);
  });
});