// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { calculateCheckoutSelection, type CheckoutSelectionInput } from "@shared/ledger/checkout-selection";

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
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ hasPermission: () => false }) }));
vi.mock("wouter", () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode } & React.HTMLAttributes<HTMLAnchorElement>) =>
    <a href={href} {...props}>{children}</a>,
  useLocation: () => ["/pay/ea-1", navigate],
  useParams: () => route,
}));
vi.mock("@/plugins/payment-gateway/registry", () => ({
  hasPaymentGatewayPayComponent: () => payEnabled.value,
   resolvePaymentGatewayPayComponent: () => (props: { clientSecret: string; amount: string; savedMethod?: boolean; publicConfig: { paymentTypes?: string[] }; onComplete: (status: "processing" | "failed", message?: string) => void }) =>
     <div><span>{props.savedMethod ? "Saved method action required" : `New ${props.publicConfig.paymentTypes?.[0]} entry`}</span>
      <span data-testid="provider-amount">{props.amount}</span>
       <button data-testid="mock-pay" onClick={() => props.onComplete("processing")}>Confirm provider payment</button>
       <button onClick={() => props.onComplete("failed", "Check your provider details")}>Fail provider payment</button></div>,
}));

import Checkout from "@/pages/shared-checkout";
import Receipt from "@/pages/shared-payment-receipt";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
let container: HTMLDivElement | null = null;
let queryClient: QueryClient | null = null;

const selectionInput: CheckoutSelectionInput = {
  balance: "125.00", reserved: "0.00", reservations: [],
  invoices: [
    { invoiceNumber: "INV-100", month: 3, year: 2026, invoiceBalance: "40.00" },
    { invoiceNumber: "INV-101", month: 4, year: 2026, invoiceBalance: "85.00" },
  ],
  allowPartial: true, minAmount: 1,
};
function fixture(input: CheckoutSelectionInput = selectionInput) {
  return {
  entityType: "worker", entityId: "worker-1", eaId: "ea-1",
  account: { name: "Domestic Partner account", currency: "USD", gatewayConfigId: "stripe" },
  balance: String(input.balance), available: (Number(input.balance) - Number(input.reserved)).toFixed(2),
  invoices: input.invoices,
  paymentTypes: ["card", "us_bank_account"],
  payComponentId: "stripe:pay", reusableMethodsSupported: true,
  settings: { allowPartial: input.allowPartial, minAmount: input.minAmount },
  authorization: { version: "v1", text: "I authorize this payment." },
  readiness: { paymentAuthorization: "ready", methodPermission: "allowed", reusableMethods: "supported", saveMethod: "ready" },
  selectionInput: input, quote: calculateCheckoutSelection(input, { mode: "full", invoiceNumbers: [] }),
  };
}
const checkout = fixture();
const methods = [
  { id: "pm-card", gatewayConfigId: "stripe", isActive: true, providerDetails: { card: { brand: "Visa", last4: "4242" } } },
  { id: "pm-ach", gatewayConfigId: "stripe", isActive: true, providerDetails: { us_bank_account: { bank_name: "Test Bank", last4: "6789" } } },
  { id: "pm-bad", gatewayConfigId: "stripe", isActive: true, providerError: "expired" },
];

function response(method: string, url: string, body?: any): unknown {
  const entityType = employerFixture ? "employer" : "worker";
  const entityId = employerFixture ? "employer-1" : "worker-1";
  if (method === "GET" && url === "/api/ledger/ea/ea-1") return { entityType, entityId };
  if (method === "GET" && url.includes(`/checkout/${entityType}/${entityId}/ea-1`)) return employerFixture ?? workerFixture;
  if (method === "GET" && url === `/api/ledger/payment-methods/${entityType}/${entityId}`) return methods;
  if (method === "GET" && url === `/api/ledger/payment-methods/${entityType}/${entityId}/authorization`) {
    if (employerFixture) throw new Error("No method-management grant");
    return { authorization: { version: "v1", text: "I authorize this payment." } };
  }
  if (method === "POST" && url.includes("/sessions")) {
     return { id: "session-1", status: "requires_action", clientSecret: "secret", publicConfig: { paymentTypes: [body.paymentMethodType ?? (body.paymentMethodId === "pm-ach" ? "us_bank_account" : "card")] } };
  }
  throw new Error(`Unexpected request ${method} ${url} ${JSON.stringify(body)}`);
}
let employerFixture: typeof checkout | null = null;
let workerFixture: typeof checkout = checkout;

async function render(page: "checkout" | "receipt" = "checkout") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient = client;
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
function radio(label: string) {
  const node = Array.from(container?.querySelectorAll("label") ?? []).find(item => item.textContent?.includes(label) && item.querySelector('input[type="radio"]'));
  expect(node, `missing radio ${label}`).toBeTruthy();
  return node!.querySelector('input[type="radio"]') as HTMLInputElement;
}
async function selectRadio(label: string) {
  await act(async () => { radio(label).click(); });
}
function postBody() {
  const post = apiRequest.mock.calls.find(([method, url]) => method === "POST" && String(url).endsWith("/sessions"));
  expect(post).toBeTruthy();
  return post![2];
}
function noPost() {
  expect(apiRequest.mock.calls.filter(([method, url]) => method === "POST" && String(url).endsWith("/sessions"))).toHaveLength(0);
}
async function submit() {
  await act(async () => { button("Review payment").click(); });
   await act(async () => { button("Continue to secure confirmation").click(); });
  await settle();
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
  workerFixture = checkout;
  vi.stubGlobal("crypto", { randomUUID: () => "idempotency-1" });
  apiRequest.mockImplementation((method: string, url: string, body?: unknown) => Promise.resolve(response(method, url, body)));
});
afterEach(async () => {
  await act(async () => { root?.unmount(); });
  container?.remove();
  root = null;
  container = null;
  queryClient = null;
  vi.unstubAllGlobals();
  employerFixture = null;
  window.history.replaceState({}, "", "/");
});

describe("shared checkout", () => {
   it("offers both new methods, reviews the chosen type, and hands off to provider entry before receipt", async () => {
     await render();
     expect(radio("New credit/debit card").checked).toBe(true);
     expect(radio("New US bank transfer").checked).toBe(false);
     expect(text()).toContain("securely enter your card details");
     await selectRadio("New US bank transfer");
     expect(text()).toContain("link or enter your US bank account");
     await clickCheckboxContaining("I authorize");
     await act(async () => { button("Review payment").click(); });
     expect(text()).toContain("using a new US bank transfer");
     expect(text()).toContain("does not complete your payment");
     await act(async () => { button("Continue to secure confirmation").click(); });
     await settle();
     expect(postBody().paymentMethodType).toBe("us_bank_account");
     expect(text()).toContain("New us_bank_account entry");
     expect(document.activeElement).toBe(container?.querySelector('[aria-label="Secure payment confirmation"]'));
     expect(text()).toContain("Payment not complete");
     expect(navigate).not.toHaveBeenCalled();
     await act(async () => { button("Fail provider payment").click(); });
     expect(text()).toContain("Check your provider details");
     expect(navigate).not.toHaveBeenCalled();
     await act(async () => { button("Confirm provider payment").click(); });
     expect(navigate).toHaveBeenCalledWith("/pay/receipt/session-1");
   });

   it("switching method resets review and consent, then submits the newly chosen card", async () => {
     await render();
     await clickCheckboxContaining("I authorize");
     await act(async () => { button("Review payment").click(); });
     await selectRadio("New US bank transfer");
     expect(button("Review payment").disabled).toBe(true);
     await clickCheckboxContaining("I authorize");
     await act(async () => { button("Review payment").click(); });
     expect(text()).toContain("using a new US bank transfer");
     await selectRadio("New credit/debit card");
     expect(button("Review payment").disabled).toBe(true);
     await clickCheckboxContaining("I authorize");
     await submit();
     expect(postBody().paymentMethodType).toBe("card");
     expect(text()).toContain("New card entry");
   });

   it.each([
     [["card"], "New credit/debit card", "New US bank transfer", "card"],
     [["us_bank_account"], "New US bank transfer", "New credit/debit card", "us_bank_account"],
   ] as const)("shows only the permitted %j method", async (types, visible, hidden, selected) => {
     workerFixture = { ...checkout, paymentTypes: [...types] };
     await render();
     expect(radio(visible).checked).toBe(true);
     expect(text()).not.toContain(hidden);
     await clickCheckboxContaining("I authorize");
     await submit();
     expect(postBody().paymentMethodType).toBe(selected);
   });

   it("gives a recovery path when provider entry is unavailable after a session starts", async () => {
     apiRequest.mockImplementation((method: string, url: string, body?: unknown) =>
       Promise.resolve(method === "POST" && url.includes("/sessions")
         ? { id: "session-1", status: "requires_action", clientSecret: null }
         : response(method, url, body)));
     await render();
     await clickCheckboxContaining("I authorize");
     await submit();
     expect(text()).toContain("Secure payment entry is unavailable");
     expect(text()).toContain("Check this payment's status");
     expect(navigate).not.toHaveBeenCalled();
   });
  it("pays the complete COBRA $267.35 statement, not an editable arbitrary amount", async () => {
    const input: CheckoutSelectionInput = { ...selectionInput, balance: "267.35", invoices: [
      { invoiceNumber: "COBRA-APR", month: 4, year: 2026, invoiceBalance: "267.35" },
    ] };
    workerFixture = { ...fixture(input), account: { ...checkout.account, name: "COBRA account" } };
    await render();
    expect(text()).toContain("COBRA account");
    expect(text()).toContain("$267.35");
    expect(container!.querySelector("#checkout-amount")).toBeNull();
    await clickCheckboxContaining("I authorize");
    await submit();
    expect(postBody()).toEqual(expect.objectContaining({
      selection: { mode: "full", invoiceNumbers: [] }, amount: "267.35",
      statementSelection: [{ invoiceNumber: "COBRA-APR", amount: "267.35" }], saveMethod: false,
    }));
  });

  it("discloses exactly which negative statement supplies credit to which payable statement", async () => {
    const input: CheckoutSelectionInput = { ...selectionInput, balance: "100.00", invoices: [
      { invoiceNumber: "CREDIT-FEB", month: 2, year: 2026, invoiceBalance: "-25.00" },
      ...selectionInput.invoices,
    ] };
    workerFixture = fixture(input);
    expect(workerFixture.quote.creditTransfers).toEqual([{
      sourceInvoiceNumber: "CREDIT-FEB", sourceStatementYmd: "2026-02-01",
      targetInvoiceNumber: "INV-100", targetStatementYmd: "2026-03-01", amount: "25.00",
    }]);
    await render();
    // The payer must see source, destination, and amount before accepting the quote.
    expect(text()).toContain("Account-credit transfers");
    expect(text()).toContain("$25.00 from CREDIT-FEB (2026-02-01) to INV-100 (2026-03-01)");
    expect(text()).toContain("INV-100Statement due $40.00$15.00 cash");
    await clickCheckboxContaining("I authorize");
    await submit();
    expect(postBody()).toEqual(expect.objectContaining({
      amount: "100.00",
      statementSelection: [
        { invoiceNumber: "INV-100", amount: "15.00" }, { invoiceNumber: "INV-101", amount: "85.00" },
      ],
    }));
    expect(postBody().creditTransfers).toEqual([{
      sourceInvoiceNumber: "CREDIT-FEB", sourceStatementYmd: "2026-02-01",
      targetInvoiceNumber: "INV-100", targetStatementYmd: "2026-03-01", amount: "25.00",
    }]);
  });

  it("blocks an unattributed account credit and gives administrator guidance instead of allocating it", async () => {
    workerFixture = fixture({ ...selectionInput, balance: "100.00" });
    await render();
    expect(text()).toContain("An account credit has no statement source");
    expect(text()).toContain("Contact the ledger administrator");
    await clickCheckboxContaining("I authorize");
    expect(button("Review payment").disabled).toBe(true);
    noPost();
  });

  it("pays one or several entire statements and calculates their totals", async () => {
    await render();
    await selectRadio("Pay selected statements");
    expect(button("Review payment").disabled).toBe(true);
    await clickCheckboxContaining("INV-100");
    expect(text()).toContain("$40.00");
    await clickCheckboxContaining("INV-101");
    expect(text()).toContain("$125.00");
    await clickCheckboxContaining("I authorize");
    await submit();
    expect(postBody()).toEqual(expect.objectContaining({
      selection: { mode: "statements", invoiceNumbers: ["INV-100", "INV-101"] },
      amount: "125.00", statementSelection: [
        { invoiceNumber: "INV-100", amount: "40.00" }, { invoiceNumber: "INV-101", amount: "85.00" },
      ],
    }));
  });

  it("uses a verified deep-link statement, ignores forged amount, and preserves choice after refetch", async () => {
    window.history.replaceState({}, "", "/pay/ea-1?invoice=INV-100&amount=1");
    await render();
    expect(radio("Pay selected statements").checked).toBe(true);
    expect(text()).toContain("$40.00");
    await clickCheckboxContaining("INV-101");
    // A query refetch delivers a fresh payload, but must not reset the payer's choice.
    await act(async () => { await queryClient!.invalidateQueries({ queryKey: ["checkout"] }); });
    await settle();
    expect(radio("Pay selected statements").checked).toBe(true);
    await clickCheckboxContaining("I authorize");
    await submit();
    expect(postBody()).toEqual(expect.objectContaining({
      amount: "125.00", selection: { mode: "statements", invoiceNumbers: ["INV-100", "INV-101"] },
    }));
  });

  it("refreshes a changed statement quote without losing selection or submitting the old total", async () => {
    window.history.replaceState({}, "", "/pay/ea-1?invoice=INV-100");
    await render();
    workerFixture = fixture({ ...selectionInput, balance: "130.00",
      invoices: [{ ...selectionInput.invoices[0], invoiceBalance: "45.00" }, selectionInput.invoices[1]] });
    await act(async () => { await queryClient!.invalidateQueries({ queryKey: ["checkout"] }); });
    await settle();
    expect(radio("Pay selected statements").checked).toBe(true);
    await clickCheckboxContaining("I authorize");
    await submit();
    expect(postBody()).toEqual(expect.objectContaining({
      amount: "45.00", statementSelection: [{ invoiceNumber: "INV-100", amount: "45.00" }],
    }));
  });

  it("requires renewed consent if authorization wording changes on refetch", async () => {
    await render();
    await clickCheckboxContaining("I authorize");
    await act(async () => { button("Review payment").click(); });
    workerFixture = { ...checkout, authorization: { version: "v2", text: "I authorize revised payment terms." } };
    await act(async () => { await queryClient!.invalidateQueries({ queryKey: ["checkout"] }); });
    await settle();
    expect(text()).toContain("I authorize revised payment terms.");
    expect(button("Review payment").disabled).toBe(true);
    noPost();
    const newConsent = Array.from(container!.querySelectorAll("label")).find(node => node.textContent?.includes("I authorize revised payment terms."))!.querySelector('[role="checkbox"]') as HTMLElement;
    expect(newConsent.getAttribute("aria-checked")).toBe("false");
    await clickCheckboxContaining("I authorize revised payment terms.");
    await submit();
    expect(postBody().consent).toEqual({ version: "v2", text: "I authorize revised payment terms.", accepted: true });
  });

  it("reports a stale deep-link statement rather than trusting a link's amount", async () => {
    window.history.replaceState({}, "", "/pay/ea-1?invoice=NO-LONGER-DUE&amount=1");
    await render();
    expect(text()).toContain("That statement is no longer payable");
    expect(radio("Pay full balance").checked).toBe(true);
  });

  it("blocks a selected statement below the minimum but permits the full balance", async () => {
    const input = { ...selectionInput, minAmount: 50 };
    workerFixture = fixture(input);
    await render();
    await selectRadio("Pay selected statements");
    await clickCheckboxContaining("INV-100");
    await clickCheckboxContaining("I authorize");
    expect(text()).toContain("payment minimum is 50.00");
    expect(button("Review payment").disabled).toBe(true);
    noPost();
    await selectRadio("Pay full balance");
    await clickCheckboxContaining("I authorize");
    expect(button("Review payment").disabled).toBe(false);
  });

  it("blocks stale pending allocations rather than accepting a mismatched quote", async () => {
    const input: CheckoutSelectionInput = { ...selectionInput, reserved: "20.00",
      reservations: [{ amount: "20.00", statementSelection: [{ invoiceNumber: "INV-100", amount: "20.00" }] }] };
    workerFixture = fixture(input);
    await render();
    await clickCheckboxContaining("I authorize");
    expect(text()).toContain("full balance cannot be safely allocated");
    expect(button("Review payment").disabled).toBe(true);
    await selectRadio("Pay selected statements");
    expect(text()).not.toContain("$40.00 due");
    await clickCheckboxContaining("INV-101");
    await clickCheckboxContaining("I authorize");
    expect(button("Review payment").disabled).toBe(false);
  });

  it("offers only full balance when partial selection is disabled", async () => {
    workerFixture = fixture({ ...selectionInput, allowPartial: false });
    await render();
    expect(text()).toContain("requires payment of the full available balance");
    expect(container!.querySelectorAll('input[name="payment-choice"]')).toHaveLength(1);
    await clickCheckboxContaining("I authorize");
    await submit();
    expect(postBody().selection).toEqual({ mode: "full", invoiceNumbers: [] });
  });

  it("rejects statement deep links on a full-only account without silently submitting the linked statement", async () => {
    workerFixture = fixture({ ...selectionInput, allowPartial: false });
    window.history.replaceState({}, "", "/pay/ea-1?invoice=INV-100");
    await render();
    expect(radio("Pay full balance").checked).toBe(true);
    expect(text()).toContain("requires payment of the full available balance");
    await clickCheckboxContaining("I authorize");
    await submit();
    expect(postBody()).toEqual(expect.objectContaining({
      amount: "125.00", selection: { mode: "full", invoiceNumbers: [] },
      statementSelection: [
        { invoiceNumber: "INV-100", amount: "40.00" }, { invoiceNumber: "INV-101", amount: "85.00" },
      ],
    }));
  });

  it("distinguishes missing payment authorization from denied method permission and unsupported saving", async () => {
    workerFixture = { ...checkout, authorization: null as unknown as typeof checkout.authorization,
      readiness: { ...checkout.readiness, paymentAuthorization: "configuration_required", saveMethod: "configuration_required" } };
    await render();
    expect(text()).toContain("Payment authorization wording has not been configured");
    expect(text()).toContain("Saving requires current payment authorization");
    expect(button("Review payment").disabled).toBe(true);
    noPost();
  });

  it.each([
    ["permission_denied", "You do not have permission to save payment methods"],
    ["provider_unsupported", "This payment provider does not support saving methods"],
  ] as const)("explains %s while leaving one-time payment available", async (state, message) => {
    workerFixture = { ...checkout, readiness: { ...checkout.readiness, methodPermission: "denied", saveMethod: state } };
    await render();
    expect(text()).toContain("You do not have permission to manage or save payment methods");
    expect(text()).toContain("Visa •••• 4242");
    expect(text()).toContain(message);
    const saveBox = Array.from(container!.querySelectorAll("label")).find(node => node.textContent?.includes("Save this method"))!.querySelector('[role="checkbox"]') as HTMLElement;
    expect(saveBox.hasAttribute("data-disabled") || saveBox.hasAttribute("disabled")).toBe(true);
    await clickCheckboxContaining("I authorize");
    await submit();
    expect(postBody().saveMethod).toBe(false);
  });

  it("permits an authorized payer to use existing saved methods without method-management permission", async () => {
    workerFixture = { ...checkout, readiness: { ...checkout.readiness, methodPermission: "denied", saveMethod: "permission_denied" } };
    await render();
    await selectRadio("Visa");
    await clickCheckboxContaining("I authorize");
    await submit();
     expect(postBody()).toEqual(expect.objectContaining({ paymentMethodId: "pm-card", paymentMethodType: undefined, saveMethod: false }));
     expect(text()).toContain("Saved method action required");
  });

  it("blocks a reviewed save when saving permission is revoked by a refetch", async () => {
    await render();
    await clickCheckboxContaining("Save this method");
    await clickCheckboxContaining("I authorize");
    await act(async () => { button("Review payment").click(); });
     expect(button("Continue to secure confirmation").disabled).toBe(false);
    workerFixture = { ...checkout, readiness: { ...checkout.readiness, methodPermission: "denied", saveMethod: "permission_denied" } };
    await act(async () => { await queryClient!.invalidateQueries({ queryKey: ["checkout"] }); });
    await settle();
    expect(text()).toContain("You do not have permission to save payment methods");
     expect(button("Continue to secure confirmation").disabled).toBe(true);
     await act(async () => { button("Continue to secure confirmation").click(); });
    noPost();
  });

  it("leaves saving unchecked for a one-time payment and sends consent and explicit save intent", async () => {
    await render();
    expect(text()).toContain("Visa •••• 4242");
    expect(text()).toContain("Test Bank •••• 6789");
    expect(text()).not.toContain("pm-bad");
    const saveBox = Array.from(container!.querySelectorAll("label")).find(node => node.textContent?.includes("Save this method"))!.querySelector('[role="checkbox"]') as HTMLElement;
    expect(saveBox.getAttribute("aria-checked")).toBe("false");
    expect(button("Review payment").disabled).toBe(true);
    await act(async () => { saveBox.click(); });
    await clickCheckboxContaining("I authorize");
    await submit();
    expect(postBody()).toEqual(expect.objectContaining({
      saveMethod: true, consent: { version: "v1", text: "I authorize this payment.", accepted: true },
      idempotencyKey: "idempotency-1",
    }));
  });

  it("submits a saved ACH selection and completes provider action before receipt", async () => {
    await render();
    await selectRadio("Pay selected statements");
    await clickCheckboxContaining("INV-100");
    await selectRadio("Test Bank");
    await clickCheckboxContaining("I authorize");
    await submit();
    expect(postBody()).toEqual(expect.objectContaining({
      amount: "40.00", paymentMethodId: "pm-ach", saveMethod: false,
      selection: { mode: "statements", invoiceNumbers: ["INV-100"] },
      statementSelection: [{ invoiceNumber: "INV-100", amount: "40.00" }],
    }));
    expect(text()).toContain("Saved method action required");
    expect(navigate).not.toHaveBeenCalled();
    await act(async () => { button("Confirm provider payment").click(); });
    expect(navigate).toHaveBeenCalledWith("/pay/receipt/session-1");
  });

  it("freezes selection, method, consent, save, and submit after provider secret is issued", async () => {
    await render();
    await clickCheckboxContaining("I authorize");
    await submit();
    expect(text()).toContain("Secure payment confirmation");
    expect(radio("Pay selected statements").disabled).toBe(true);
    expect(radio("Visa").disabled).toBe(true);
     expect(button("Continue to secure confirmation").disabled).toBe(true);
    await act(async () => { radio("Pay selected statements").click(); });
    expect(radio("Pay full balance").checked).toBe(true);
    expect(apiRequest.mock.calls.filter(([method, url]) => method === "POST" && String(url).endsWith("/sessions"))).toHaveLength(1);
    await act(async () => { button("Confirm provider payment").click(); });
    expect(navigate).toHaveBeenCalledWith("/pay/receipt/session-1");
  });

  it("keeps the submitted quote and provider amount frozen when the account refetches after session creation", async () => {
    await render();
    await clickCheckboxContaining("I authorize");
    await submit();
    expect(postBody().amount).toBe("125.00");
    expect(container!.querySelector('[data-testid="provider-amount"]')?.textContent).toBe("$125.00");
    workerFixture = fixture({ ...selectionInput, balance: "130.00",
      invoices: [{ ...selectionInput.invoices[0], invoiceBalance: "45.00" }, selectionInput.invoices[1]] });
    await act(async () => { await queryClient!.invalidateQueries({ queryKey: ["checkout"] }); });
    await settle();
    expect(container!.querySelector('[data-testid="provider-amount"]')?.textContent).toBe("$125.00");
    expect(text()).toContain("Payment total$125.00INV-100Statement due $40.00$40.00 cashINV-101Statement due $85.00$85.00 cash");
    expect(radio("Pay full balance").disabled).toBe(true);
    expect(apiRequest.mock.calls.filter(([method, url]) => method === "POST" && String(url).endsWith("/sessions"))).toHaveLength(1);
  });

  it("preselects employer deep-link amount, uses business consent, and sends one-time ACH", async () => {
    employerFixture = { ...checkout, entityType: "employer", entityId: "employer-1",
      paymentTypes: ["us_bank_account"], authorization: { version: "business-v2", text: "I authorize the business debit." },
      readiness: { ...checkout.readiness, methodPermission: "denied", saveMethod: "permission_denied" } };
    window.history.replaceState({}, "", "/pay/ea-1?invoice=INV-100&amount=1");
    await render();
    expect(radio("Pay selected statements").checked).toBe(true);
     expect(text()).toContain("New US bank transfer");
    expect(text()).not.toContain("Visa •••• 4242");
    expect(text()).toContain("$40.00");
    await clickCheckboxContaining("I authorize the business debit.");
    await submit();
    expect(apiRequest).toHaveBeenCalledWith("POST", "/api/ledger/checkout/employer/employer-1/ea-1/sessions",
      expect.objectContaining({ amount: "40.00", saveMethod: false,
        selection: { mode: "statements", invoiceNumbers: ["INV-100"] },
        statementSelection: [{ invoiceNumber: "INV-100", amount: "40.00" }],
        consent: { version: "business-v2", text: "I authorize the business debit.", accepted: true } }));
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

  it("shows employer account and confirmation without a worker-account link", async () => {
    apiRequest.mockImplementation(() => Promise.resolve(receipt("succeeded", {
      entityType: "employer", entityId: "employer-1", ledgerPaymentId: "ledger-employer",
    })));
    await render("receipt");
    expect(text()).toContain("Payment posted");
    expect(text()).toContain("Confirmation: session-1");
    expect(container?.querySelector('a[href="/ea/ea-1"]')).toBeTruthy();
    expect(container?.querySelector('a[href="/ledger/payment/ledger-employer"]')).toBeTruthy();
    expect(container?.querySelector('a[href="/workers/worker-1/ledger/accounts"]')).toBeNull();
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