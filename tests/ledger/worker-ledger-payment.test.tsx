// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));

vi.mock("@/components/layouts/WorkerLayout", () => ({
  WorkerLayout: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useWorkerLayout: () => ({ worker: { id: "worker-42" } }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>("@/lib/queryClient");
  return { ...actual, apiRequest };
});
vi.mock("@/plugins/payment-gateway/registry", () => ({
  hasPaymentGatewayComponent: () => false,
  resolvePaymentGatewayComponent: () => null,
}));
vi.mock("@/components/ledger/WorkerStripePaymentForm", () => ({
  WorkerStripePaymentForm: () => <div data-testid="mock-stripe-payment-form" />,
}));

import Page from "@/pages/worker-ledger-payment";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;
const methods = [{
  id: "pm-card",
  gatewayConfigId: "gw-stripe",
  isActive: true,
  isDefault: true,
  providerDetails: { card: { brand: "visa", last4: "4242", expMonth: 12, expYear: 2030 } },
}];

function responseFor(method: string, url: string, body?: unknown) {
  if (method === "GET" && url.includes("/ledger/payable")) return { balance: "125.50", currencyCode: "USD", eaId: "ea-9" };
  if (method === "GET" && url.endsWith("/worker/worker-42")) return methods;
  if (method === "GET" && url.endsWith("/worker/worker-42/gateways")) return [{ id: "gw-stripe", pluginId: "stripe", name: "Stripe" }];
  if (method === "POST" && url.includes("payment-intent")) return { id: "attempt-1", status: "succeeded", clientSecret: null, publicConfig: {} };
  if (method === "GET" && url.endsWith("/payment-attempts/attempt-1")) return { id: "attempt-1", status: "succeeded", ledgerPaymentId: "payment-1" };
  throw new Error(`Unexpected request ${method} ${url} ${JSON.stringify(body)}`);
}

async function render() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<QueryClientProvider client={queryClient}><Page /></QueryClientProvider>);
    await Promise.resolve();
  });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}

function testId<T extends HTMLElement>(id: string) {
  const element = container?.querySelector(`[data-testid="${id}"]`);
  expect(element, `missing ${id}`).toBeTruthy();
  return element as T;
}

async function inputAmount(value: string) {
  const input = testId<HTMLInputElement>("input-worker-payment-amount");
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await Promise.resolve();
  });
}

async function waitFor(check: () => void) {
  for (let i = 0; i < 20; i++) {
    try {
      check();
      return;
    } catch {
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); });
    }
  }
  check();
}

beforeEach(() => {
  apiRequest.mockReset();
  apiRequest.mockImplementation((method: string, url: string, body?: unknown) =>
    Promise.resolve(responseFor(method, url, body)),
  );
  vi.stubGlobal("crypto", { randomUUID: () => "idem-123" });
});

afterEach(async () => {
  await act(async () => { root?.unmount(); });
  container?.remove();
  root = null;
  container = null;
  vi.unstubAllGlobals();
});

describe("worker ledger checkout", () => {
  it("bounds amount to greater than zero and no more than payable balance", async () => {
    await render();
    const button = testId<HTMLButtonElement>("button-worker-start-payment");
    expect(button.disabled).toBe(true);
    await inputAmount("0");
    expect(button.disabled).toBe(true);
    await inputAmount("125.51");
    expect(button.disabled).toBe(true);
    await act(async () => { testId<HTMLButtonElement>("button-select-worker-payment-method-pm-card").click(); });
    await inputAmount("125.50");
    await waitFor(() => expect(button.disabled).toBe(false));
  });

  it("selects a saved method and sends worker, EA, amount, method, and idempotency key", async () => {
    await render();
    await inputAmount("25.00");
    await act(async () => { testId<HTMLButtonElement>("button-select-worker-payment-method-pm-card").click(); });
    await act(async () => { testId<HTMLButtonElement>("button-worker-start-payment").click(); });

    await waitFor(() => expect(apiRequest).toHaveBeenCalledWith("POST", "/api/workers/worker-42/ledger/payment-intent", {
      eaId: "ea-9",
      amount: "25.00",
      paymentMethodId: "pm-card",
      idempotencyKey: "idem-123",
    }));
    await waitFor(() => expect(apiRequest).toHaveBeenCalledWith("GET", "/api/ledger/payment-attempts/attempt-1"));
    await waitFor(() => expect(container?.textContent).toContain("Payment successful"));
  });

  it("shows ACH processing rather than card success when the API returns processing", async () => {
    apiRequest.mockImplementation((method: string, url: string, body?: unknown) => {
      const value = responseFor(method, url, body);
      return Promise.resolve(url.includes("payment-intent") ? { ...value, status: "processing" } : value);
    });
    await render();
    await inputAmount("25.00");
    await act(async () => { testId<HTMLButtonElement>("button-select-worker-payment-method-pm-card").click(); });
    await act(async () => { testId<HTMLButtonElement>("button-worker-start-payment").click(); });
    await waitFor(() => expect(container?.textContent).toContain("Payment processing"));
    expect(container?.textContent).toContain("payment is being processed");
    expect(container?.textContent).not.toContain("Payment successful");
  });
});