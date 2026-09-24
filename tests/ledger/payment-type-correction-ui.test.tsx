// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { apiRequest, toast } = vi.hoisted(() => ({ apiRequest: vi.fn(), toast: vi.fn() }));
vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>("@/lib/queryClient");
  return { ...actual, apiRequest };
});
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));
vi.mock("@/contexts/PageTitleContext", () => ({ usePageTitle: () => {} }));
vi.mock("@/hooks/useConfigNavigation", () => ({
  useOptionsListName: () => ({ pluralName: "Ledger Payment Types" }),
}));
vi.mock("@/components/shared/BackToOptions", () => ({
  BackToOptions: () => null,
}));

import Page from "@/pages/config/ledger-payment-types";
import { queryClient } from "@/lib/queryClient";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
Element.prototype.scrollIntoView = vi.fn();

const key = ["/api/options/ledger-payment-type"];
const initialType = {
  id: "type-1", name: "Check", description: null, currencyCode: "USD",
  category: "financial", direction: "credit", sequence: 0,
};
const preview = {
  paymentTypeId: "type-1", paymentTypeName: "Check", currentDirection: "credit",
  targetDirection: "charge", snapshot: "snapshot-1", eligible: true, blockers: [],
  paymentCount: 1, entryCount: 1,
  payments: [{
    id: "payment-1", amount: "50.00", blockers: [],
    entries: [{ id: "entry-1", amount: "-50.00", proposedAmount: "50.00", eaId: "ea-1",
      plugin: "payment-simple-allocation", key: "config-1:payment-1" }],
  }],
};
let root: Root | null = null;
let container: HTMLDivElement | null = null;
let persistedType = { ...initialType };

async function flush() {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}
async function click(selector: string) {
  const element = document.querySelector(selector);
  expect(element, `missing ${selector}`).toBeTruthy();
  await act(async () => { (element as HTMLElement).click(); });
}
async function changeInput(selector: string, value: string) {
  const input = document.querySelector(selector) as HTMLInputElement;
  expect(input).toBeTruthy();
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
async function selectCharge() {
  const trigger = document.querySelector('[data-testid="select-edit-direction-type-1"]')!;
  await act(async () => {
    trigger.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown" }));
  });
  await flush();
  const charge = Array.from(document.querySelectorAll('[role="option"]'))
    .find((option) => option.textContent === "Charge");
  expect(charge).toBeTruthy();
  await act(async () => {
    charge!.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, button: 0 }));
    (charge as HTMLElement).click();
  });
  await flush();
}
async function render() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  queryClient.setQueryData(key, [persistedType]);
  await act(async () => { root!.render(<QueryClientProvider client={queryClient}><Page /></QueryClientProvider>); });
  await flush();
}

beforeEach(() => {
  persistedType = { ...initialType };
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify([persistedType]), {
    status: 200, headers: { "Content-Type": "application/json" },
  })));
  apiRequest.mockReset();
  toast.mockReset();
  apiRequest.mockImplementation((method: string, url: string, body?: Record<string, unknown>) => {
    if (method === "PUT" && url === "/api/options/ledger-payment-type/type-1") {
      persistedType = { ...persistedType, ...body };
      return Promise.resolve(persistedType);
    }
    if (method === "POST" && url.endsWith("/charge-correction/preview")) return Promise.resolve(preview);
    if (method === "POST" && url.endsWith("/charge-correction/confirm")) {
      persistedType = { ...persistedType, direction: "charge" };
      return Promise.resolve({ paymentTypeId: "type-1", direction: "charge", paymentCount: 1, entryCount: 1 });
    }
    if (method === "GET" && url === key[0]) return Promise.resolve([persistedType]);
    throw new Error(`Unexpected request ${method} ${url}`);
  });
});
afterEach(async () => {
  await act(async () => { root?.unmount(); });
  container?.remove();
  root = null;
  container = null;
  queryClient.clear();
  vi.unstubAllGlobals();
});

describe("payment type effect editor", () => {
  it("saves Charge normally for an unused type, including after reload", async () => {
    await render();
    await click('[data-testid="button-edit-type-1"]');
    await selectCharge();
    await click('[data-testid="button-save-type-1"]');
    await flush();
    expect(apiRequest).toHaveBeenCalledWith("PUT", "/api/options/ledger-payment-type/type-1",
      expect.objectContaining({ direction: "charge" }));
    expect(persistedType.direction).toBe("charge");
    await act(async () => { await queryClient.invalidateQueries({ queryKey: key }); });
    expect(document.querySelector('[data-testid="text-direction-type-1"]')?.textContent).toContain("Charge");
  });

  it("keeps the guarded save error visible and requires an explicit, reviewed confirmation", async () => {
    apiRequest.mockImplementation((method: string, url: string, body?: Record<string, unknown>) => {
      if (method === "PUT") return Promise.reject(new Error("This type has cleared payments. Changing its ledger effect requires an audited historical correction."));
      if (url.endsWith("/preview")) return Promise.resolve(preview);
      if (url.endsWith("/confirm")) {
        expect(body).toEqual({ snapshot: "snapshot-1", confirmed: true });
        persistedType = { ...persistedType, direction: "charge" };
        return Promise.resolve({ paymentTypeId: "type-1", direction: "charge", paymentCount: 1, entryCount: 1 });
      }
      if (method === "GET") return Promise.resolve([persistedType]);
      throw new Error(`Unexpected request ${method} ${url}`);
    });
    await render();
    await click('[data-testid="button-edit-type-1"]');
    await changeInput('[data-testid="input-edit-name-type-1"]', "Unsaved draft name");
    await selectCharge();
    expect(document.querySelector('[data-testid="effect-change-guidance-type-1"]')?.textContent)
      .toContain("add a new Charge payment type");
    await click('[data-testid="button-save-type-1"]');
    await flush();
    expect(document.querySelector('[data-testid="error-edit-payment-type-type-1"]')?.textContent)
      .toContain("cleared payments");
    expect(persistedType.direction).toBe("credit");
    await click('[data-testid="button-preview-correction-type-1"]');
    await flush();
    expect(document.querySelector('[data-testid="correction-payment-payment-1"]')?.textContent)
      .toContain("-50.00 → 50.00");
    expect(apiRequest).not.toHaveBeenCalledWith("POST",
      "/api/options/ledger-payment-type/type-1/charge-correction/confirm", expect.anything());
    await click('[data-testid="button-confirm-charge-correction"]');
    await flush();
    expect(persistedType.direction).toBe("charge");
    expect(persistedType.name).toBe("Check");
    expect(document.querySelector('[data-testid="text-direction-type-1"]')?.textContent).toContain("Charge");
  });

  it("blocks unsupported corrections without ever submitting a confirmation", async () => {
    apiRequest.mockImplementation((method: string, url: string) => {
      if (method === "POST" && url.endsWith("/preview")) return Promise.resolve({
        ...preview, eligible: false, blockers: ["Payment has a bespoke allocation"],
        payments: [{ ...preview.payments[0], blockers: ["Payment has a bespoke allocation"] }],
      });
      if (method === "GET") return Promise.resolve([persistedType]);
      throw new Error(`Unexpected request ${method} ${url}`);
    });
    await render();
    await click('[data-testid="button-edit-type-1"]');
    await selectCharge();
    await click('[data-testid="button-preview-correction-type-1"]');
    await flush();
    expect(document.querySelector('[data-testid="charge-correction-unsupported"]')?.textContent)
      .toContain("bespoke allocation");
    expect((document.querySelector('[data-testid="button-confirm-charge-correction"]') as HTMLButtonElement).disabled).toBe(true);
    expect(persistedType.direction).toBe("credit");
  });

  it("discards a stale preview after confirmation is rejected", async () => {
    apiRequest.mockImplementation((method: string, url: string) => {
      if (method === "POST" && url.endsWith("/preview")) return Promise.resolve(preview);
      if (method === "POST" && url.endsWith("/confirm")) return Promise.reject(new Error("Snapshot changed"));
      if (method === "GET") return Promise.resolve([persistedType]);
      throw new Error(`Unexpected request ${method} ${url}`);
    });
    await render();
    await click('[data-testid="button-edit-type-1"]');
    await selectCharge();
    await click('[data-testid="button-preview-correction-type-1"]');
    await flush();
    await click('[data-testid="button-confirm-charge-correction"]');
    await flush();
    expect(document.querySelector('[data-testid="error-charge-correction"]')?.textContent)
      .toContain("Review a fresh preview");
    expect((document.querySelector('[data-testid="button-confirm-charge-correction"]') as HTMLButtonElement).disabled).toBe(true);
    expect(persistedType.direction).toBe("credit");
    await click('[data-testid="button-refresh-correction-preview"]');
    await flush();
    expect((document.querySelector('[data-testid="button-confirm-charge-correction"]') as HTMLButtonElement).disabled).toBe(false);
  });
});