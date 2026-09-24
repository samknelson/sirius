// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { apiRequest, toast } = vi.hoisted(() => ({ apiRequest: vi.fn(), toast: vi.fn() }));
vi.mock("@/contexts/PageTitleContext", () => ({ usePageTitle: vi.fn() }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));
vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>("@/lib/queryClient");
  return { ...actual, apiRequest };
});

import Page from "@/pages/config/ledger/settings";
import { getQueryFn } from "@/lib/queryClient";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const name = "ledger.online_payment_authorizations";
const approved = {
  consumer: { version: "c1", text: "Approved consumer fixture" },
  business: { version: "b1", text: "Approved business fixture" },
};
let root: Root | null;
let container: HTMLDivElement | null;
let variableResponse: { status: number; value?: unknown };
let paymentTypeResponse: { status: number; types?: { id: string; name: string; description: string | null; sequence: number }[] };
let defaultPaymentTypeSetting: { id: string; value: { paymentTypeId: string } } | null;
let queryClient: QueryClient;

async function settle() {
  for (let i = 0; i < 5; i++) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  }
}

async function renderPage() {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, queryFn: getQueryFn({ on401: "throw" }) } } });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root!.render(<QueryClientProvider client={queryClient}><Page /></QueryClientProvider>); });
  await settle();
}

function field(id: string) {
  return container!.querySelector(`[data-testid="${id}"]`) as HTMLInputElement | HTMLTextAreaElement;
}

async function edit(id: string, value: string) {
  const element = field(id);
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
      "value",
    )!.set!;
    setter.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function saveButton() {
  return container!.querySelector('[data-testid="save-payment-authorization"]') as HTMLButtonElement;
}

beforeEach(() => {
  variableResponse = { status: 404 };
  paymentTypeResponse = { status: 200, types: [] };
  defaultPaymentTypeSetting = null;
  toast.mockReset();
  apiRequest.mockReset();
  apiRequest.mockResolvedValue({});
  vi.stubGlobal("PointerEvent", MouseEvent);
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
  Object.defineProperty(HTMLElement.prototype, "hasPointerCapture", { configurable: true, value: () => false });
  Object.defineProperty(HTMLElement.prototype, "setPointerCapture", { configurable: true, value: () => undefined });
  Object.defineProperty(HTMLElement.prototype, "releasePointerCapture", { configurable: true, value: () => undefined });
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: () => undefined });
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url === `/api/variables/by-name/${name}`) {
      return { ok: variableResponse.status === 200, status: variableResponse.status, json: async () => ({ value: variableResponse.value }) };
    }
    if (url === "/api/variables/by-name/ledger_payment_type") {
      return {
        ok: true,
        status: 200,
        headers: { get: (): string => "application/json" },
        json: async () => defaultPaymentTypeSetting,
      };
    }
    if (url === "/api/ledger/payment-types") {
      return {
        ok: paymentTypeResponse.status === 200,
        status: paymentTypeResponse.status,
        statusText: "Request failed",
        headers: { get: (): string => "application/json" },
        json: async () => paymentTypeResponse.status === 200
          ? paymentTypeResponse.types
          : { message: "Payment types request failed" },
      };
    }
    throw new Error(`Unexpected fetch ${url}`);
  }));
});

describe("Ledger Settings default payment type", () => {
  const types = [
    { id: "card", name: "Card", description: "Credit or debit", sequence: 1 },
    { id: "bank", name: "Bank transfer", description: null, sequence: 2 },
  ];

  it("loads the canonical ledger types, selects one, and saves the default", async () => {
    paymentTypeResponse = { status: 200, types };
    defaultPaymentTypeSetting = { id: "default-variable", value: { paymentTypeId: "card" } };
    await renderPage();
    expect(fetch).toHaveBeenCalledWith("/api/ledger/payment-types", expect.objectContaining({ credentials: "include" }));
    expect(fetch).not.toHaveBeenCalledWith("/api/ledger-payment-types", expect.anything());
    const trigger = container!.querySelector('[data-testid="select-payment-type"]') as HTMLButtonElement;
    expect(trigger.textContent).toContain("Card");
    await act(async () => {
      trigger.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown" }));
    });
    expect(Array.from(document.querySelectorAll('[role="option"]')).map((option) => option.textContent)).toEqual(
      expect.arrayContaining([expect.stringContaining("Card"), expect.stringContaining("Bank transfer")]),
    );
    const bank = document.querySelector('[data-testid="option-payment-type-bank"]')!;
    await act(async () => {
      bank.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, button: 0 }));
      bank.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(trigger.textContent).toContain("Bank transfer");
    await act(async () => {
      (container!.querySelector('[data-testid="button-save-settings"]') as HTMLButtonElement).click();
    });
    expect(apiRequest).toHaveBeenCalledWith("PUT", "/api/variables/default-variable", {
      value: { paymentTypeId: "bank" },
    });
  });

  it.each([403, 500])("shows a retryable load error for a %i response without showing empty setup guidance", async (status) => {
    paymentTypeResponse = { status };
    await renderPage();
    expect(container!.textContent).toContain("Unable to load payment types");
    expect(container!.textContent).toContain("Payment types request failed");
    expect(container!.textContent).not.toContain("No payment types configured");
    expect((container!.querySelector('[data-testid="select-payment-type"]') as HTMLButtonElement).disabled).toBe(true);
    expect((container!.querySelector('[data-testid="button-save-settings"]') as HTMLButtonElement).disabled).toBe(true);

    paymentTypeResponse = { status: 200, types };
    await act(async () => {
      (container!.querySelector('[data-testid="payment-types-load-error"] button') as HTMLButtonElement).click();
    });
    await settle();
    expect(container!.textContent).not.toContain("Unable to load payment types");
    expect((container!.querySelector('[data-testid="select-payment-type"]') as HTMLButtonElement).disabled).toBe(false);
    expect(fetch).toHaveBeenCalledWith("/api/ledger/payment-types", expect.anything());
  });

  it("only shows setup guidance after a successful empty response", async () => {
    await renderPage();
    expect(container!.textContent).toContain("No payment types configured. Please add payment types first.");
    expect(container!.textContent).not.toContain("Unable to load payment types");
    expect((container!.querySelector('[data-testid="button-save-settings"]') as HTMLButtonElement).disabled).toBe(true);
  });
});

afterEach(async () => {
  await act(async () => { root?.unmount(); });
  queryClient?.clear();
  container?.remove();
  root = null;
  container = null;
  vi.unstubAllGlobals();
});

describe("shared ledger payment authorization editor", () => {
  it("shows missing configuration without manufacturing legal text or allowing incomplete saves", async () => {
    await renderPage();
    expect(container!.textContent).toContain("Authorization not configured");
    expect(field("consumer-authorization-text").value).toBe("");
    expect(saveButton().disabled).toBe(true);
    await edit("consumer-authorization-version", "c2");
    expect(saveButton().disabled).toBe(true);
    expect(container!.textContent).toContain("Blank or whitespace-only values cannot be saved");
    expect(apiRequest).not.toHaveBeenCalledWith("PUT", expect.stringContaining(name), expect.anything());
  });

  it("requires both approved payer texts and versions before configuring a missing variable", async () => {
    await renderPage();
    await edit("consumer-authorization-version", "c2");
    await edit("consumer-authorization-text", "Approved consumer fixture");
    await edit("business-authorization-version", "b2");
    await edit("business-authorization-text", "   ");
    expect(saveButton().disabled).toBe(true);
    await edit("business-authorization-text", "Approved business fixture");
    expect(saveButton().disabled).toBe(false);
    await act(async () => { saveButton().click(); });
    expect(apiRequest).toHaveBeenCalledWith("PUT", `/api/variables/by-name/${name}`, {
      value: {
        consumer: { version: "c2", text: "Approved consumer fixture" },
        business: { version: "b2", text: "Approved business fixture" },
      },
    });
  });

  it("loads approved values and saves only deliberate, complete edits via the validated variable endpoint", async () => {
    variableResponse = { status: 200, value: approved };
    await renderPage();
    expect(container!.textContent).toContain("Authorization configured");
    expect(field("consumer-authorization-text").value).toBe(approved.consumer.text);
    expect(field("business-authorization-text").value).toBe(approved.business.text);
    expect(saveButton().disabled).toBe(true);
    await edit("business-authorization-version", "b2");
    expect(saveButton().disabled).toBe(false);
    await act(async () => { saveButton().click(); });
    expect(apiRequest).toHaveBeenCalledWith("PUT", `/api/variables/by-name/${name}`, {
      value: { consumer: approved.consumer, business: { version: "b2", text: approved.business.text } },
    });
  });

  it("does not overwrite an inaccessible or malformed stored value", async () => {
    variableResponse = { status: 403 };
    await renderPage();
    expect(container!.textContent).toContain("Unable to load authorization configuration");
    expect(container!.querySelector('[data-testid="save-payment-authorization"]')).toBeNull();
    await act(async () => { root?.unmount(); });
    root = null;
    container?.remove();
    variableResponse = { status: 200, value: { consumer: approved.consumer } };
    await renderPage();
    expect(container!.textContent).toContain("Stored authorization needs review");
    expect(container!.querySelector('[data-testid="save-payment-authorization"]')).toBeNull();
  });
});