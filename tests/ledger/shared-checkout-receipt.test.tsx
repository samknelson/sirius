// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { apiRequest, navigate, route, payEnabled } = vi.hoisted(() => ({
  apiRequest: vi.fn(),
  navigate: vi.fn(),
  route: { sessionId: "session-1", eaId: "ea-1" },
  payEnabled: { value: true },
}));

vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>("@/lib/queryClient");
  return { ...actual, apiRequest };
});
vi.mock("wouter", () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode } & React.HTMLAttributes<HTMLAnchorElement>) =>
    <a href={href} {...props}>{children}</a>,
  useLocation: () => ["/pay/ea-1", navigate],
  useParams: () => route,
}));
vi.mock("@/plugins/payment-gateway/registry", () => ({
  hasPaymentGatewayPayComponent: () => payEnabled.value,
  resolvePaymentGatewayPayComponent: () => (props: { clientSecret: string; onComplete: () => void }) =>
    <button data-testid="mock-pay" onClick={props.onComplete}>Confirm provider payment</button>,
}));

import Checkout from "@/pages/shared-checkout";
import Receipt from "@/pages/shared-payment-receipt";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
let container: HTMLDivElement | null = null;

const checkout = {
  entityType: "worker", entityId: "worker-1", eaId: "ea-1",
  account: { name: "Domestic Partner account", currency: "USD", gatewayConfigId: "stripe" },
  balance: "125.00", available: "125.00",
  invoices: [
    { invoiceNumber: "INV-100", month: 3, year: 2026, invoiceBalance: "40.00" },
    { invoiceNumber: "INV-101", month: 4, year: 2026, invoiceBalance: "85.00" },
  ],
  paymentTypes: ["card", "us_bank_account"],
  payComponentId: "stripe:pay", reusableMethodsSupported: true,
  settings: { allowPartial: true, minAmount: 1 },
  authorization: { version: "v1", text: "I authorize this payment." },
};
const methods = [
  { id: "pm-card", gatewayConfigId: "stripe", isActive: true, providerDetails: { card: { brand: "Visa", last4: "4242" } } },
  { id: "pm-ach", gatewayConfigId: "stripe", isActive: true, providerDetails: { us_bank_account: { bank_name: "Test Bank", last4: "6789" } } },
  { id: "pm-bad", gatewayConfigId: "stripe", isActive: true, providerError: "expired" },
];

function response(method: string, url: string, body?: any): unknown {
  if (method === "GET" && url === "/api/ledger/ea/ea-1") return { entityType: "worker", entityId: "worker-1" };
  if (method === "GET" && url.includes("/checkout/worker/worker-1/ea-1")) return checkout;
  if (method === "GET" && url === "/api/ledger/payment-methods/worker/worker-1") return methods;
  if (method === "GET" && url === "/api/ledger/payment-methods/worker/worker-1/authorization") {
    return { authorization: { version: "v1", text: "I authorize this payment." } };
  }
  if (method === "POST" && url.includes("/sessions")) {
    return { id: "session-1", status: "requires_action", clientSecret: "secret", publicConfig: {} };
  }
  throw new Error(`Unexpected request ${method} ${url} ${JSON.stringify(body)}`);
}

async function render(page: "checkout" | "receipt" = "checkout") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<QueryClientProvider client={client}>{page === "checkout" ? <Checkout /> : <Receipt />}</QueryClientProvider>);
    await Promise.resolve();
  });
  await settle();
}
async function settle() {
  for (let i = 0; i < 5; i++) {
    if (vi.isFakeTimers()) {
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    } else {
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    }
  }
}
function text() { return container?.textContent ?? ""; }
function button(label: string) {
  const result = Array.from(container?.querySelectorAll("button") ?? []).find(b => b.textContent?.includes(label));
  expect(result, `missing button ${label}`).toBeTruthy();
  return result as HTMLButtonElement;
}
async function fill(id: string, value: string) {
  const input = container?.querySelector(`#${id}`) as HTMLInputElement;
  expect(input).toBeTruthy();
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
async function clickCheckboxContaining(label: string) {
  const labelNode = Array.from(container?.querySelectorAll("label") ?? []).find(node => node.textContent?.includes(label));
  expect(labelNode).toBeTruthy();
  const checkbox = labelNode!.querySelector('[role="checkbox"]') as HTMLElement | null;
  await act(async () => { (checkbox ?? labelNode!).click(); });
}

beforeEach(() => {
  apiRequest.mockReset();
  navigate.mockReset();
  payEnabled.value = true;
  vi.stubGlobal("crypto", { randomUUID: () => "idempotency-1" });
  apiRequest.mockImplementation((method: string, url: string, body?: unknown) => Promise.resolve(response(method, url, body)));
});
afterEach(async () => {
  await act(async () => { root?.unmount(); });
  container?.remove();
  root = null;
  container = null;
  vi.unstubAllGlobals();
});

describe("shared checkout", () => {
  it("renders one-time checkout data, statements, saved card and hides provider-error methods", async () => {
    await render();
    expect(text()).toContain("Domestic Partner account");
    expect(text()).toContain("INV-100");
    expect(text()).toContain("Visa •••• 4242");
    expect(text()).toContain("Test Bank •••• 6789");
    expect(text()).not.toContain("pm-bad");
    expect(text()).toContain("I authorize this payment.");
  });

  it("leaves reusable-method saving unchecked by default and submits the explicit flag", async () => {
    await render();
    const saveLabel = Array.from(container!.querySelectorAll("label")).find(node => node.textContent?.includes("Save this method"));
    expect(saveLabel).toBeTruthy();
    const saveBox = saveLabel!.querySelector('[role="checkbox"]') as HTMLElement;
    expect(saveBox.getAttribute("aria-checked")).toBe("false");
    expect(saveBox.hasAttribute("disabled")).toBe(false);
    await fill("checkout-amount", "5.00");
    await clickCheckboxContaining("I authorize");
    await act(async () => { saveBox.click(); });
    expect(saveBox.getAttribute("aria-checked")).toBe("true");
    await act(async () => { button("Review payment").click(); });
    await act(async () => { button("Submit payment").click(); });
    await settle();
    expect(apiRequest).toHaveBeenCalledWith("POST", expect.stringContaining("/sessions"),
      expect.objectContaining({ saveMethod: true }));
  });

  it("gates reusable saving when the account does not support reusable methods", async () => {
    apiRequest.mockImplementation((method: string, url: string, body?: unknown) => {
      if (method === "GET" && url.includes("/checkout/")) {
        return Promise.resolve({ ...checkout, reusableMethodsSupported: false });
      }
      return Promise.resolve(response(method, url, body));
    });
    await render();
    const saveLabel = Array.from(container!.querySelectorAll("label")).find(node => node.textContent?.includes("Save this method"));
    const saveBox = saveLabel!.querySelector('[role="checkbox"]') as HTMLElement;
    expect(saveBox.matches(":disabled") || saveBox.hasAttribute("disabled") || saveBox.hasAttribute("data-disabled")).toBe(true);
    expect(text()).toContain("Saving is unavailable");
  });

  it("requires consent and matching statement allocation before review", async () => {
    await render();
    await fill("checkout-amount", "40.00");
    expect(button("Review payment").disabled).toBe(true);
    await fill("invoice-INV-100", "39.00");
    await clickCheckboxContaining("I authorize");
    expect(button("Review payment").disabled).toBe(true);
    await fill("invoice-INV-100", "40.00");
    expect(button("Review payment").disabled).toBe(false);
  });

  it("submits a saved ACH method with statement selection and consent", async () => {
    await render();
    await fill("checkout-amount", "40.00");
    await fill("invoice-INV-100", "40.00");
    const ach = Array.from(container!.querySelectorAll("label")).find(node => node.textContent?.includes("Test Bank"));
    await act(async () => { (ach!.querySelector("input") as HTMLInputElement).click(); });
    await clickCheckboxContaining("I authorize");
    await act(async () => { button("Review payment").click(); });
    await act(async () => { button("Submit payment").click(); });
    await settle();
    expect(apiRequest).toHaveBeenCalledWith("POST", "/api/ledger/checkout/worker/worker-1/ea-1/sessions",
      expect.objectContaining({
        amount: "40.00", paymentMethodId: "pm-ach", saveMethod: false,
        statementSelection: [{ invoiceNumber: "INV-100", amount: "40.00" }],
        consent: { version: "v1", text: "I authorize this payment.", accepted: true },
      }));
    expect(navigate).toHaveBeenCalledWith("/pay/receipt/session-1");
  });

  it("shows provider confirmation for a new one-time payment and navigates on completion", async () => {
    await render();
    await fill("checkout-amount", "5.00");
    await clickCheckboxContaining("I authorize");
    await act(async () => { button("Review payment").click(); });
    await act(async () => { button("Submit payment").click(); });
    await settle();
    expect(text()).toContain("Secure payment confirmation");
    expect(text()).toContain("Confirm provider payment");
    await act(async () => { button("Confirm provider payment").click(); });
    expect(navigate).toHaveBeenCalledWith("/pay/receipt/session-1");
  });

  it("does not allow fields or a second submit to mutate an existing provider secret", async () => {
    await render();
    await fill("checkout-amount", "5.00");
    await clickCheckboxContaining("I authorize");
    await act(async () => { button("Review payment").click(); });
    await act(async () => { button("Submit payment").click(); });
    await settle();
    expect(text()).toContain("Secure payment confirmation");
    const amount = container!.querySelector("#checkout-amount") as HTMLInputElement;
    expect(amount.disabled).toBe(true);
    expect(button("Submit payment").disabled).toBe(true);
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(amount, "99.00");
      amount.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(amount.value).toBe("5.00");
    expect(apiRequest.mock.calls.filter(([method, url]) => method === "POST" && String(url).includes("/sessions"))).toHaveLength(1);
  });

  it("reports API failure and permits retry of saved methods", async () => {
    let failed = true;
    apiRequest.mockImplementation((method: string, url: string, body?: unknown) => {
      if (failed && method === "GET" && url.includes("/payment-methods/")) return Promise.reject(new Error("Methods unavailable"));
      return Promise.resolve(response(method, url, body));
    });
    await render();
    expect(text()).toContain("Saved methods could not be loaded");
    failed = false;
    await act(async () => { button("Retry").click(); });
    await settle();
    expect(text()).toContain("Visa •••• 4242");
  });
});

describe("shared payment receipt", () => {
  const receipt = (status: string, extra: Record<string, unknown> = {}) => ({
    id: "session-1", entityType: "worker", entityId: "worker-1", eaId: "ea-1",
    amount: "12.50", currency: "USD", status, ...extra,
  });

  it.each([
    ["succeeded", "Payment posted"],
    ["processing", "Payment processing"],
    ["failed", "Payment failed"],
    ["canceled", "Payment canceled"],
    ["expired", "Payment expired"],
  ])("renders %s status with safe retry/account links", async (status, heading) => {
    apiRequest.mockImplementation(() => Promise.resolve(receipt(status, status === "succeeded" ? { ledgerPaymentId: "ledger-1" } : {})));
    await render("receipt");
    expect(text()).toContain(heading);
    expect(text()).toContain("$12.50");
    expect(container?.querySelector('a[href="/ea/ea-1"]')).toBeTruthy();
    if (status === "succeeded") expect(container?.querySelector('a[href="/ledger/payment/ledger-1"]')).toBeTruthy();
    else if (status !== "processing") expect(container?.querySelector('a[href="/pay/ea-1"]')).toBeTruthy();
  });

  it("shows receipt API error and retries, including narrow-width wrapping content", async () => {
    let failed = true;
    apiRequest.mockImplementation(() => failed ? Promise.reject(new Error("Receipt unavailable")) : Promise.resolve(receipt("failed", {
      failureMessage: "A deliberately long provider message that must remain readable on a narrow viewport",
    })));
    await render("receipt");
    expect(text()).toContain("Receipt unavailable");
    failed = false;
    await act(async () => { button("Retry").click(); });
    await settle();
    expect(text()).toContain("Payment failed");
    expect(text()).toContain("long provider message");
    expect(container?.querySelector("main")?.className).toContain("w-full");
  });

  it("reloads a processing receipt to posted and stops terminal polling", async () => {
    let current = receipt("processing");
    apiRequest.mockImplementation(() => Promise.resolve(current));
    await render("receipt");
    expect(text()).toContain("Payment processing");
    current = receipt("succeeded", { ledgerPaymentId: "ledger-reloaded" });
    await act(async () => { button("Check status").click(); });
    await settle();
    expect(text()).toContain("Payment posted");
    expect(container?.querySelector('a[href="/ledger/payment/ledger-reloaded"]')).toBeTruthy();
    expect(Array.from(container?.querySelectorAll("button") ?? []).some(node => node.textContent?.includes("Check status"))).toBe(false);
  });
});