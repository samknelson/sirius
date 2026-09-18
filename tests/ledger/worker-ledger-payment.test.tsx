// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { apiRequest, gatewayRegistry } = vi.hoisted(() => ({
  apiRequest: vi.fn(),
  gatewayRegistry: { enabled: false },
}));

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
  hasPaymentGatewayComponent: () => gatewayRegistry.enabled,
  resolvePaymentGatewayComponent: () => ({ onSuccess }: { onSuccess: (token: string) => void }) =>
    React.createElement("button", {
      "data-testid": "mock-add-payment-method",
      onClick: () => onSuccess("pm-new-token"),
    }, "Save provider method"),
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
  if (method === "GET" && url.endsWith("/ledger/payable-accounts")) return [{
    eaId: "ea-9",
    accountId: "account-9",
    accountName: "Domestic Partner",
    currencyCode: "USD",
    gatewayConfigId: "gw-stripe",
    eligible: true,
  }];
  if (method === "GET" && url.includes("/ledger/payable?eaId=ea-9")) return {
    eaId: "ea-9",
    accountId: "account-9",
    accountName: "Domestic Partner",
    balance: "125.50",
    availableBalance: "125.50",
    reservedAmount: "0.00",
    currencyCode: "USD",
    gatewayConfigId: "gw-stripe",
  };
  if (method === "GET" && url.endsWith("/worker/worker-42")) return methods;
  if (method === "GET" && url.endsWith("/worker/worker-42/gateways")) return [{ id: "gw-stripe", pluginId: "stripe", name: "Stripe" }];
  if (method === "POST" && url.endsWith("/worker/worker-42/setup")) return { clientSecret: "seti_secret", componentId: "stripe:add", publicConfig: { publishableKey: "pk_test" } };
  if (method === "POST" && url.endsWith("/worker/worker-42")) return { id: "pm-new" };
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
  // Account discovery selects the sole account, which then enables the balance
  // query on a subsequent render.
  for (let i = 0; i < 4; i++) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  }
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

async function choose(trigger: Element, optionText: string) {
  await act(async () => {
    trigger.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown" }));
  });
  await waitFor(() => expect(Array.from(document.querySelectorAll('[role="option"]')).some(
    (option) => option.textContent?.includes(optionText),
  )).toBe(true));
  const option = Array.from(document.querySelectorAll('[role="option"]')).find(
    (candidate) => candidate.textContent?.includes(optionText),
  )!;
  await act(async () => {
    option.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, button: 0 }));
    option.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

beforeEach(() => {
  window.history.replaceState({}, "", "/");
  HTMLElement.prototype.scrollIntoView = vi.fn();
  apiRequest.mockReset();
  gatewayRegistry.enabled = false;
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
  it("requires an explicit choice when multiple accounts are available", async () => {
    apiRequest.mockImplementation((method: string, url: string, body?: unknown) => {
      if (method === "GET" && url.endsWith("/ledger/payable-accounts")) return Promise.resolve([
        { eaId: "ea-9", accountId: "account-9", accountName: "First account", currencyCode: "USD", gatewayConfigId: "gw-stripe", eligible: true },
        { eaId: "ea-10", accountId: "account-10", accountName: "Second account", currencyCode: "USD", gatewayConfigId: "gw-stripe", eligible: true },
      ]);
      if (method === "GET" && url.includes("eaId=ea-10")) return Promise.resolve({
        eaId: "ea-10", accountId: "account-10", accountName: "Second account", balance: "10.00",
        availableBalance: "10.00", reservedAmount: "0.00", currencyCode: "USD", gatewayConfigId: "gw-stripe",
      });
      return Promise.resolve(responseFor(method, url, body));
    });
    await render();
    expect(apiRequest.mock.calls.some((call) => String(call[1]).includes("/ledger/payable?"))).toBe(false);
    expect(container?.textContent).toContain("No account is chosen automatically");
    await choose(testId("select-worker-payment-account"), "Second account");
    await waitFor(() => expect(apiRequest).toHaveBeenCalledWith("GET", "/api/workers/worker-42/ledger/payable?eaId=ea-10"));
    await waitFor(() => expect(container?.textContent).toContain("$10.00"));
  });

  it("allows changing away from a URL-preselected account", async () => {
    window.history.replaceState({}, "", "/workers/worker-42/ledger/pay?eaId=ea-9");
    apiRequest.mockImplementation((method: string, url: string, body?: unknown) => {
      if (method === "GET" && url.endsWith("/ledger/payable-accounts")) return Promise.resolve([
        { eaId: "ea-9", accountId: "account-9", accountName: "First account", currencyCode: "USD", gatewayConfigId: "gw-stripe", eligible: true },
        { eaId: "ea-10", accountId: "account-10", accountName: "Second account", currencyCode: "USD", gatewayConfigId: "gw-stripe", eligible: true },
      ]);
      if (method === "GET" && url.includes("eaId=ea-10")) return Promise.resolve({
        eaId: "ea-10", accountId: "account-10", accountName: "Second account", balance: "10.00",
        availableBalance: "10.00", reservedAmount: "0.00", currencyCode: "USD", gatewayConfigId: "gw-stripe",
      });
      return Promise.resolve(responseFor(method, url, body));
    });
    await render();
    await waitFor(() => expect(container?.textContent).toContain("$125.50"));
    await choose(testId("select-worker-payment-account"), "Second account");
    await waitFor(() => expect(container?.textContent).toContain("$10.00"));
    expect(testId("select-worker-payment-account").textContent).toContain("Second account");
  });

  it("ignores an in-flight payment response after the account changes", async () => {
    window.history.replaceState({}, "", "/workers/worker-42/ledger/pay?eaId=ea-9");
    let releaseIntent!: (value: unknown) => void;
    const pendingIntent = new Promise((resolve) => { releaseIntent = resolve; });
    apiRequest.mockImplementation((method: string, url: string, body?: unknown) => {
      if (method === "GET" && url.endsWith("/ledger/payable-accounts")) return Promise.resolve([
        { eaId: "ea-9", accountId: "account-9", accountName: "First account", currencyCode: "USD", gatewayConfigId: "gw-stripe", eligible: true },
        { eaId: "ea-10", accountId: "account-10", accountName: "Second account", currencyCode: "USD", gatewayConfigId: "gw-stripe", eligible: true },
      ]);
      if (method === "GET" && url.includes("eaId=ea-10")) return Promise.resolve({
        eaId: "ea-10", accountId: "account-10", accountName: "Second account", balance: "10.00",
        availableBalance: "10.00", reservedAmount: "0.00", currencyCode: "USD", gatewayConfigId: "gw-stripe",
      });
      if (method === "POST" && url.includes("payment-intent")) return pendingIntent;
      return Promise.resolve(responseFor(method, url, body));
    });
    await render();
    await inputAmount("5.00");
    await act(async () => { testId<HTMLButtonElement>("button-select-worker-payment-method-pm-card").click(); });
    await act(async () => { testId<HTMLButtonElement>("button-worker-start-payment").click(); });
    await choose(testId("select-worker-payment-account"), "Second account");
    await act(async () => {
      releaseIntent({ id: "stale-attempt", status: "processing", clientSecret: null, publicConfig: {} });
      await pendingIntent;
    });
    await waitFor(() => expect(container?.textContent).toContain("Second account amount due"));
    expect(container?.textContent).not.toContain("Payment processing");
  });

  it("reports an invalid URL account instead of falling back to the sole account", async () => {
    window.history.replaceState({}, "", "/workers/worker-42/ledger/pay?eaId=missing-ea");
    await render();
    expect(container?.textContent).toContain("requested payment account was not found");
    expect(apiRequest.mock.calls.some((call) => String(call[1]).includes("/ledger/payable?"))).toBe(false);
  });

  it("does not turn a missing balance into a false $0 balance", async () => {
    apiRequest.mockImplementation((method: string, url: string, body?: unknown) => {
      const value = responseFor(method, url, body);
      if (url.includes("/ledger/payable?")) {
        const { balance: _balance, ...withoutBalance } = value as Record<string, unknown>;
        return Promise.resolve(withoutBalance);
      }
      return Promise.resolve(value);
    });
    await render();
    await waitFor(() => expect(container?.textContent).toContain("Payment response is missing balance."));
    expect(container?.textContent).not.toContain("$0.00");
  });

  it("rejects malformed monetary and currency data instead of enabling payment", async () => {
    apiRequest.mockImplementation((method: string, url: string, body?: unknown) => {
      const value = responseFor(method, url, body);
      return Promise.resolve(url.includes("/ledger/payable?") ? {
        ...(value as object),
        currencyCode: "not-a-currency",
      } : value);
    });
    await render();
    await waitFor(() => expect(container?.textContent).toContain("unsupported currencyCode"));
    expect(container?.querySelector('[data-testid="button-worker-start-payment"]')).toBeNull();
  });

  it("describes a credit balance separately from a zero balance", async () => {
    apiRequest.mockImplementation((method: string, url: string, body?: unknown) => {
      const value = responseFor(method, url, body);
      return Promise.resolve(url.includes("/ledger/payable?") ? {
        ...(value as object),
        balance: "-15.00",
        availableBalance: "0.00",
      } : value);
    });
    await render();
    await waitFor(() => expect(container?.textContent).toContain("account has a credit of $15.00"));
    expect(container?.textContent).not.toContain("You have no balance due on this account.");
  });

  it("keeps payment methods available when the account balance is zero", async () => {
    apiRequest.mockImplementation((method: string, url: string, body?: unknown) => {
      const value = responseFor(method, url, body);
      return Promise.resolve(url.includes("/ledger/payable?") ? {
        ...(value as object),
        balance: "0.00",
        availableBalance: "0.00",
      } : value);
    });
    await render();
    await waitFor(() => expect(container?.textContent).toContain("You have no balance due on this account."));
    expect(testId("worker-payment-method-pm-card")).toBeTruthy();
    expect(testId("button-worker-add-payment-method")).toBeTruthy();
    expect(container?.querySelector('[data-testid="button-worker-start-payment"]')).toBeNull();
  });

  it("can set up and attach a payment method while the balance is zero", async () => {
    gatewayRegistry.enabled = true;
    apiRequest.mockImplementation((method: string, url: string, body?: unknown) => {
      const value = responseFor(method, url, body);
      return Promise.resolve(url.includes("/ledger/payable?") ? {
        ...(value as object),
        balance: "0.00",
        availableBalance: "0.00",
      } : value);
    });
    await render();
    await act(async () => { testId<HTMLButtonElement>("button-worker-add-payment-method").click(); });
    const gatewayTrigger = document.querySelector('[data-testid="select-worker-payment-gateway"]');
    expect(gatewayTrigger).toBeTruthy();
    await choose(gatewayTrigger!, "Stripe");
    await waitFor(() => expect(document.querySelector('[data-testid="mock-add-payment-method"]')).toBeTruthy());
    await act(async () => {
      (document.querySelector('[data-testid="mock-add-payment-method"]') as HTMLButtonElement).click();
    });
    await waitFor(() => expect(apiRequest).toHaveBeenCalledWith(
      "POST",
      "/api/ledger/payment-methods/worker/worker-42",
      { gatewayConfigId: "gw-stripe", methodToken: "pm-new-token" },
    ));
  });

  it("shows actionable saved-method and gateway loading failures", async () => {
    apiRequest.mockImplementation((method: string, url: string, body?: unknown) => {
      if (method === "GET" && url.endsWith("/worker/worker-42")) return Promise.reject(new Error("Saved methods are temporarily unavailable."));
      if (method === "GET" && url.endsWith("/worker/worker-42/gateways")) return Promise.reject(new Error("Gateway configuration could not be loaded."));
      return Promise.resolve(responseFor(method, url, body));
    });
    await render();
    expect(container?.textContent).toContain("Saved methods are temporarily unavailable.");
    await act(async () => { testId<HTMLButtonElement>("button-worker-add-payment-method").click(); });
    await waitFor(() => expect(document.body.textContent).toContain("Gateway configuration could not be loaded."));
    expect(document.body.textContent).toContain("Retry");
  });

  it("explains when no payment gateway is configured", async () => {
    apiRequest.mockImplementation((method: string, url: string, body?: unknown) =>
      Promise.resolve(method === "GET" && url.endsWith("/worker/worker-42/gateways") ? [] : responseFor(method, url, body)),
    );
    await render();
    await act(async () => { testId<HTMLButtonElement>("button-worker-add-payment-method").click(); });
    await waitFor(() => expect(document.body.textContent).toContain("No payment provider is configured for this account."));
  });

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