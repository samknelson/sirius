// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { apiRequest, toast } = vi.hoisted(() => ({
  apiRequest: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { firstName: "Test", lastName: "User", email: "test@example.com" } }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));
vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>("@/lib/queryClient");
  return { ...actual, apiRequest };
});

import { PaymentForm } from "../../client/src/components/ledger/PaymentForm";
import { queryClient } from "../../client/src/lib/queryClient";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const eas = [
  { id: "ea-acme", accountId: "account-1", entityType: "employer", entityId: "acme", entityName: "Acme" },
  { id: "ea-beta", accountId: "account-1", entityType: "employer", entityId: "beta", entityName: "Beta" },
  { id: "ea-cyan", accountId: "account-1", entityType: "employer", entityId: "cyan", entityName: "Cyan" },
];

const paymentTypes = [
  { id: "check", name: "Check", category: "financial", currencyCode: "USD" },
];

const statementInvoices = Array.from({ length: 18 }, (_, index) => ({
  month: (index % 12) + 1,
  year: 2024 + Math.floor(index / 12),
  totalAmount: "25.00",
  entryCount: 1,
  incomingBalance: "0.00",
  invoiceBalance: "25.00",
  outgoingBalance: "25.00",
}));

function makePayment(overrides: Record<string, unknown> = {}) {
  return {
    id: "payment-1",
    status: "cleared",
    allocated: false,
    amount: "100.00",
    paymentType: "check",
    ledgerEaId: "ea-acme",
    details: {
      proposedAllocation: [
        { eaId: "ea-acme", amount: "60.00", statementYmd: "2025-01-01" },
        { eaId: "ea-beta", amount: "40.00", statementYmd: "2025-02-01" },
      ],
    },
    dateReceived: null,
    dateCleared: null,
    memo: null,
    attachmentFileId: null,
    ...overrides,
  };
}

function json(data: unknown) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

let root: Root;
let container: HTMLDivElement;
let serverPayment: ReturnType<typeof makePayment>;

async function flush(ms = 0) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

async function waitFor(assertion: () => void, timeout = 1_000) {
  const started = Date.now();
  let error: unknown;
  while (Date.now() - started < timeout) {
    try {
      assertion();
      return;
    } catch (caught) {
      error = caught;
      await flush(10);
    }
  }
  throw error;
}

async function changeInput(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

async function click(element: Element) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

async function selectFile(input: HTMLInputElement, file: File) {
  Object.defineProperty(input, "files", {
    configurable: true,
    value: [file],
  });
  await act(async () => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

async function choose(trigger: Element, optionText: string) {
  await act(async () => {
    trigger.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown" }));
  });
  await waitFor(() => {
    expect(Array.from(document.querySelectorAll('[role="option"]')).some(
      (option) => option.textContent?.includes(optionText),
    )).toBe(true);
  });
  const option = Array.from(document.querySelectorAll('[role="option"]')).find(
    (candidate) => candidate.textContent?.includes(optionText),
  )!;
  await act(async () => {
    option.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, button: 0 }));
    option.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await flush();
}

function renderForm(props: React.ComponentProps<typeof PaymentForm>) {
  act(() => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <PaymentForm {...props} />
      </QueryClientProvider>,
    );
  });
}

function participantCards() {
  return Array.from(container.querySelectorAll("span"))
    .filter((node) => /^Participant \d+$/.test(node.textContent || ""))
    .map((node) => node.parentElement!.parentElement!);
}

function allocationInputs() {
  return participantCards().map((card) => card.querySelector('input[placeholder="0.00"]') as HTMLInputElement);
}

beforeEach(() => {
  Object.defineProperties(URL, {
    createObjectURL: {
      configurable: true,
      value: vi.fn(() => "blob:payment-preview"),
    },
    revokeObjectURL: {
      configurable: true,
      value: vi.fn(),
    },
  });
  vi.stubGlobal("PointerEvent", MouseEvent);
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
  Object.defineProperty(HTMLElement.prototype, "hasPointerCapture", {
    configurable: true,
    value: () => false,
  });
  Object.defineProperty(HTMLElement.prototype, "setPointerCapture", {
    configurable: true,
    value: () => undefined,
  });
  Object.defineProperty(HTMLElement.prototype, "releasePointerCapture", {
    configurable: true,
    value: () => undefined,
  });
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: () => undefined,
  });
  queryClient.clear();
  serverPayment = makePayment();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);

  vi.stubGlobal("fetch", vi.fn(async (request: string | Request) => {
    const url = typeof request === "string" ? request : request.url;
    if (url.startsWith("/api/ledger/payments/")) return json(serverPayment);
    if (url === "/api/ledger/payment-types") return json(paymentTypes);
    if (url.startsWith("/api/ledger/accounts/")) return json({ id: "account-1", currencyCode: "USD" });
    if (url.startsWith("/api/entity-files/")) {
      return json({ configured: true, message: null, allowed: null, files: [] });
    }
    return json([]);
  }));

  apiRequest.mockImplementation(async (method: string, url: string, body?: any) => {
    if (method === "GET" && url === "/api/ledger/ea") return eas;
    if (method === "GET" && url.startsWith("/api/ledger/ea?")) return eas;
    if (method === "GET" && url.endsWith("/invoices")) return [];
    if (method === "PUT") {
      serverPayment = { ...serverPayment, ...body };
      return serverPayment;
    }
    if (method === "POST") {
      serverPayment = { ...makePayment({ id: "created-payment" }), ...body };
      return serverPayment;
    }
    throw new Error(`Unexpected API call: ${method} ${url}`);
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  queryClient.clear();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("PaymentForm rendered allocation regressions", () => {
  it.each(["create", "edit", "batch"] as const)(
    "keeps the %s statement header opaque above a long list through selection and split mode",
    async (context) => {
      apiRequest.mockImplementation(async (method: string, url: string) => {
        if (method === "GET" && (url === "/api/ledger/ea" || url.startsWith("/api/ledger/ea?"))) return eas;
        if (method === "GET" && url.endsWith("/invoices")) return statementInvoices;
        throw new Error(`Unexpected API call: ${method} ${url}`);
      });
      if (context === "edit") {
        queryClient.setQueryData(["/api/ledger/payments", "payment-1"], serverPayment);
      }
      renderForm(context === "edit"
        ? { mode: "edit", paymentId: "payment-1" }
        : { mode: "create", accountId: "account-1", ...(context === "batch" ? { batchId: "batch-1" } : {}) });
      if (context !== "edit") {
        await waitFor(() => expect(participantCards()).toHaveLength(1));
        await choose(participantCards()[0].querySelector('[role="combobox"]')!, "Acme");
      }
      await waitFor(() => expect(participantCards()[0]?.querySelectorAll("tbody tr")).toHaveLength(18));
      const card = participantCards()[0];
      const scrollContainer = card.querySelector("table")!.parentElement!;
      expect(scrollContainer.className).toContain("max-h-[240px]");
      expect(scrollContainer.className).toContain("overflow-y-auto");
      const assertHeader = (labels: string[]) => {
        const headings = Array.from(card.querySelectorAll("thead th"));
        expect(headings.map((cell) => cell.textContent)).toEqual(["", ...labels]);
        for (const cell of headings) {
          expect(cell.classList.contains("sticky")).toBe(true);
          expect(cell.classList.contains("top-0")).toBe(true);
          expect(cell.classList.contains("z-10")).toBe(true);
          expect(cell.classList.contains("bg-muted")).toBe(true);
          expect(cell.className).not.toMatch(/bg-muted\//);
        }
      };
      assertHeader(["Period", "Charges", "Balance"]);

      await click(card.querySelectorAll("tbody tr")[0]);
      await waitFor(() => expect(card.textContent).toContain("Split across multiple statements"));
      await click(Array.from(card.querySelectorAll("button")).find(
        (button) => button.textContent?.includes("Split across multiple statements"),
      )!);
      assertHeader(["Period", "Charges", "Balance", "Apply"]);
      await click(card.querySelectorAll("tbody tr")[1]);
      expect(card.querySelectorAll('input[placeholder="Amount required"]')).toHaveLength(2);
      await changeInput(card.querySelector('input[placeholder="Amount required"]')!, "12.50");
      expect((card.querySelector('input[placeholder="Amount required"]') as HTMLInputElement).value).toBe("12.50");

      await click(Array.from(card.querySelectorAll("button")).find(
        (button) => button.textContent?.includes("Enter manually"),
      )!);
      expect(card.querySelector("table")).toBeNull();
      expect(card.textContent).toContain("Pick from statements");
      await click(Array.from(card.querySelectorAll("button")).find(
        (button) => button.textContent?.includes("Pick from statements"),
      )!);
      assertHeader(["Period", "Charges", "Balance"]);
    },
  );

  it.each(["cold", "cached"] as const)(
    "keeps the first participant visible when %s edit account options arrive late",
    async (cacheState) => {
      const options = deferred<typeof eas>();
      apiRequest.mockImplementation(async (method: string, url: string, body?: any) => {
        if (method === "GET" && url === "/api/ledger/ea") return eas;
        if (method === "GET" && url.startsWith("/api/ledger/ea?")) return options.promise;
        if (method === "GET" && url.endsWith("/invoices")) return [];
        if (method === "PUT") {
          serverPayment = { ...serverPayment, ...body };
          return serverPayment;
        }
        throw new Error(`Unexpected API call: ${method} ${url}`);
      });
      if (cacheState === "cached") {
        queryClient.setQueryData(["/api/ledger/payments", "payment-1"], serverPayment);
      }

      renderForm({ mode: "edit", paymentId: "payment-1" });
      await waitFor(() => {
        expect(allocationInputs().map((input) => input.value)).toEqual(["60.00", "40.00"]);
      });

      await act(async () => {
        options.resolve(eas);
        await options.promise;
      });
      await waitFor(() => {
        const cards = participantCards();
        expect(cards).toHaveLength(2);
        expect(cards[0].querySelector('[role="combobox"]')?.textContent).toContain("Acme");
        expect(cards[1].querySelector('[role="combobox"]')?.textContent).toContain("Beta");
        expect(cards[0].textContent).toContain("Selected: January 2025");
        expect(cards[1].textContent).toContain("Selected: February 2025");
      });
    },
  );

  it("creates two employers, reopens the saved payment, and saves it repeatedly", async () => {
    const onSuccess = vi.fn();
    renderForm({ mode: "create", accountId: "account-1", onSuccess });
    await waitFor(() => expect(participantCards()).toHaveLength(1));

    await changeInput(container.querySelector('[data-testid="input-amount"]')!, "100.00");
    await choose(participantCards()[0].querySelector('[role="combobox"]')!, "Acme");
    await click(Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Add Another Participant"),
    )!);
    expect(participantCards()).toHaveLength(2);
    await changeInput(allocationInputs()[0], "60.00");
    await changeInput(allocationInputs()[1], "40.00");
    await choose(participantCards()[1].querySelector('[role="combobox"]')!, "Beta");
    await click(container.querySelector('[data-testid="button-save"]')!);

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    const createCall = apiRequest.mock.calls.find(
      ([method, url]) => method === "POST" && url === "/api/ledger/payments",
    );
    expect(createCall?.[2]).toEqual(expect.objectContaining({
      ledgerEaId: "ea-acme",
      details: expect.objectContaining({
        proposedAllocation: [
          expect.objectContaining({ eaId: "ea-acme", amount: "60.00" }),
          expect.objectContaining({ eaId: "ea-beta", amount: "40.00" }),
        ],
      }),
    }));

    renderForm({ mode: "edit", paymentId: "created-payment" });
    await waitFor(() => {
      expect(allocationInputs().map((input) => input.value)).toEqual(["60.00", "40.00"]);
    });
    await click(container.querySelector('[data-testid="button-save"]')!);
    await waitFor(() => {
      expect(apiRequest.mock.calls.filter(([method]) => method === "PUT")).toHaveLength(1);
    });
    await click(container.querySelector('[data-testid="button-save"]')!);
    await waitFor(() => {
      expect(apiRequest.mock.calls.filter(([method]) => method === "PUT")).toHaveLength(2);
    });
    for (const call of apiRequest.mock.calls.filter(([method]) => method === "PUT")) {
      expect(call[2].details.proposedAllocation.map((row: any) => row.eaId)).toEqual(["ea-acme", "ea-beta"]);
      expect(call[2].details.proposedAllocation.map((row: any) => row.amount)).toEqual(["60.00", "40.00"]);
    }
  });

  it("retries a failed image upload without creating the payment again", async () => {
    let uploadAttempts = 0;
    vi.mocked(fetch).mockImplementation(async (request: string | URL | Request, init?: RequestInit) => {
      const url = typeof request === "string" ? request : request instanceof URL ? request.href : request.url;
      if (url === "/api/entity-files/ledger_payment/created-payment" && init?.method === "POST") {
        uploadAttempts += 1;
        if (uploadAttempts === 1) {
          return new Response(JSON.stringify({ message: "Storage is temporarily unavailable" }), {
            status: 503,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response(JSON.stringify({ id: "attachment-1" }), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url === "/api/ledger/payment-types") return json(paymentTypes);
      if (url.startsWith("/api/ledger/accounts/")) return json({ id: "account-1", currencyCode: "USD" });
      return json([]);
    });

    const onSuccess = vi.fn();
    renderForm({ mode: "create", accountId: "account-1", onSuccess });
    await waitFor(() => expect(participantCards()).toHaveLength(1));
    await changeInput(container.querySelector('[data-testid="input-amount"]')!, "25.00");
    await choose(participantCards()[0].querySelector('[role="combobox"]')!, "Acme");
    await selectFile(
      container.querySelector('[data-testid="input-payment-attachment"]')!,
      new File(["image"], "check.png", { type: "image/png" }),
    );

    expect(container.querySelector('[data-testid="text-payment-attachment-name"]')?.textContent).toBe("check.png");
    const previewToggle = container.querySelector('[data-testid="payment-attachment-preview-toggle"]')!;
    expect(previewToggle.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector('[data-testid="payment-attachment-preview-image"]')).toBeNull();
    await click(previewToggle);
    expect(container.querySelector('[data-testid="payment-attachment-preview-image"]')?.getAttribute("src"))
      .toBe("blob:payment-preview");
    await click(previewToggle);
    expect(container.querySelector('[data-testid="payment-attachment-preview-image"]')).toBeNull();
    await click(container.querySelector('[data-testid="button-save"]')!);
    await waitFor(() => {
      expect(container.querySelector('[data-testid="text-payment-attachment-retry"]')).not.toBeNull();
    });
    expect(onSuccess).not.toHaveBeenCalled();
    expect(apiRequest.mock.calls.filter(
      ([method, url]) => method === "POST" && url === "/api/ledger/payments",
    )).toHaveLength(1);

    await click(container.querySelector('[data-testid="button-save"]')!);
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(uploadAttempts).toBe(2);
    expect(apiRequest.mock.calls.filter(
      ([method, url]) => method === "POST" && url === "/api/ledger/payments",
    )).toHaveLength(1);
  });

  it("preserves a saved statement period when the participant has no invoice rows", async () => {
    const noInvoices = deferred<never[]>();
    serverPayment = makePayment({
      amount: "25.00",
      details: {
        proposedAllocation: [
          { eaId: "ea-acme", amount: "25.00", statementYmd: "2024-11-01" },
        ],
      },
    });
    queryClient.setQueryData(["/api/ledger/payments", "payment-1"], serverPayment);
    apiRequest.mockImplementation(async (method: string, url: string, body?: any) => {
      if (method === "GET" && url === "/api/ledger/ea") return eas;
      if (method === "GET" && url.startsWith("/api/ledger/ea?")) return eas;
      if (method === "GET" && url.endsWith("/invoices")) return noInvoices.promise;
      if (method === "PUT") {
        serverPayment = { ...serverPayment, ...body };
        return serverPayment;
      }
      throw new Error(`Unexpected API call: ${method} ${url}`);
    });

    renderForm({ mode: "edit", paymentId: "payment-1" });
    await waitFor(() => expect(allocationInputs()[0]?.value).toBe("25.00"));
    await act(async () => {
      noInvoices.resolve([]);
      await noInvoices.promise;
    });
    await waitFor(() => {
      expect(participantCards()[0].textContent).toContain("No statements found");
      expect(participantCards()[0].textContent).toContain("Selected: November 2024");
    });

    await click(container.querySelector('[data-testid="button-save"]')!);
    await waitFor(() => expect(apiRequest.mock.calls.some(([method]) => method === "PUT")).toBe(true));
    const update = apiRequest.mock.calls.find(([method]) => method === "PUT")![2];
    expect(update.details.proposedAllocation).toEqual([
      expect.objectContaining({
        eaId: "ea-acme",
        amount: "25.00",
        statementYmd: "2024-11-01",
      }),
    ]);
  });

  it("does not overwrite unsaved amounts when payment data refreshes in the background", async () => {
    queryClient.setQueryData(["/api/ledger/payments", "payment-1"], serverPayment);
    renderForm({ mode: "edit", paymentId: "payment-1" });
    await waitFor(() => expect(allocationInputs()).toHaveLength(2));

    await changeInput(container.querySelector('[data-testid="input-amount"]')!, "110.00");
    await changeInput(allocationInputs()[0], "70.00");
    expect(allocationInputs().map((input) => input.value)).toEqual(["70.00", "40.00"]);

    act(() => {
      queryClient.setQueryData(["/api/ledger/payments", "payment-1"], makePayment({
        memo: "server refresh",
      }));
    });
    await flush(20);

    expect((container.querySelector('[data-testid="input-amount"]') as HTMLInputElement).value).toBe("110.00");
    expect(allocationInputs().map((input) => input.value)).toEqual(["70.00", "40.00"]);
  });

  it("submits an account change and row removal without retaining the removed employer", async () => {
    queryClient.setQueryData(["/api/ledger/payments", "payment-1"], serverPayment);
    renderForm({ mode: "edit", paymentId: "payment-1" });
    await waitFor(() => expect(participantCards()).toHaveLength(2));

    await choose(participantCards()[0].querySelector('[role="combobox"]')!, "Cyan");
    const secondCard = participantCards()[1];
    await click(secondCard.querySelector("button")!);
    await waitFor(() => expect(participantCards()).toHaveLength(1));
    await changeInput(container.querySelector('[data-testid="input-amount"]')!, "60.00");
    await click(container.querySelector('[data-testid="button-save"]')!);
    await waitFor(() => {
      expect(apiRequest.mock.calls.filter(([method]) => method === "PUT")).toHaveLength(1);
    });

    const update = apiRequest.mock.calls.find(([method]) => method === "PUT")![2];
    expect(update.ledgerEaId).toBe("ea-cyan");
    expect(update.details.proposedAllocation).toEqual([
      expect.objectContaining({ eaId: "ea-cyan", amount: "60.00" }),
    ]);
  });

  it("creates through the batch endpoint with the rendered participant allocation", async () => {
    apiRequest.mockImplementation(async (method: string, url: string, body?: any) => {
      if (method === "GET" && url.startsWith("/api/ledger/ea?")) return eas;
      if (method === "GET" && url.endsWith("/invoices")) return [];
      if (method === "POST" && url === "/api/ledger-payment-batches/batch-1/payments") {
        const saved = { ...makePayment({ id: "batch-payment" }), ...body.payment };
        return { paymentId: "batch-payment", payment: saved, ledgerNotifications: [] };
      }
      throw new Error(`Unexpected API call: ${method} ${url}`);
    });
    const onSuccess = vi.fn();
    renderForm({ mode: "create", accountId: "account-1", batchId: "batch-1", onSuccess });
    await waitFor(() => expect(participantCards()).toHaveLength(1));
    await changeInput(container.querySelector('[data-testid="input-amount"]')!, "25.00");
    await choose(participantCards()[0].querySelector('[role="combobox"]')!, "Acme");
    await click(container.querySelector('[data-testid="button-save"]')!);
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));

    const call = apiRequest.mock.calls.find(
      ([method, url]) => method === "POST" && url === "/api/ledger-payment-batches/batch-1/payments",
    );
    expect(call?.[2]).toEqual({
      payment: expect.objectContaining({
        ledgerEaId: "ea-acme",
        amount: "25.00",
        details: expect.objectContaining({
          proposedAllocation: [expect.objectContaining({ eaId: "ea-acme", amount: "25.00" })],
        }),
      }),
    });
  });
});