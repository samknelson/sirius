// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const { useParams, useQuery } = vi.hoisted(() => ({
  useParams: vi.fn(() => ({ id: "ea-1", month: "3", year: "2026" })),
  useQuery: vi.fn(),
}));

vi.mock("wouter", async () => {
  const actual = await vi.importActual<typeof import("wouter")>("wouter");
  return { ...actual, useParams };
});
vi.mock("@tanstack/react-query", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-query")>("@tanstack/react-query");
  return { ...actual, useQuery };
});
vi.mock("@/components/layouts/EALayout", () => ({
  EALayout: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import EAInvoices from "../../client/src/pages/ea-invoices";
import EAInvoiceView from "../../client/src/pages/ea-invoice-view";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const summary = {
  invoiceNumber: "INV-3",
  month: 3,
  year: 2026,
  incomingBalance: "11.00",
  chargesSubtotal: "22.00",
  adjustmentsSubtotal: "3.00",
  paymentsAppliedSubtotal: "-7.00",
  outgoingBalance: "29.00",
};
const details = {
  ...summary,
  sections: {
    charges: { entries: [], subtotal: "22.00" },
    adjustments: { entries: [], subtotal: "3.00" },
    paymentsApplied: { entries: [], subtotal: "-7.00" },
  },
};

let root: Root | undefined;
let container: HTMLDivElement | undefined;

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
  vi.clearAllMocks();
});

async function render(page: React.ReactElement) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root!.render(page));
  return container;
}

describe("employer invoice balance display order", () => {
  it("pairs the list's four headings with the right values and keeps amount cells clickable", async () => {
    useQuery.mockImplementation(({ queryKey }: { queryKey: string[] }) => ({
      data: queryKey[0].endsWith("/3/2026") ? details : [summary],
      isLoading: false,
    }));
    const page = await render(<EAInvoices />);
    const headings = Array.from(page.querySelectorAll("thead th")).map((head) => head.textContent?.trim());
    expect(headings).toEqual([
      "Invoice No.", "Period", "Incoming Balance", "Invoiced Amount",
      "Payments Applied", "Outgoing Balance", "Invoice Balance", "Tools",
    ]);

    const row = page.querySelector('[data-testid="row-invoice-2026-3"]')!;
    const cells = Array.from(row.querySelectorAll("td"));
    expect(cells.slice(2, 7).map((cell) => cell.textContent?.trim())).toEqual([
      "$11.00", "$25.00", "-$7.00", "$29.00", "$18.00",
    ]);
    expect(cells[4].getAttribute("data-testid")).toBe("cell-applied-2026-3");
    expect(cells[4].className).toContain("border-l-2");
    expect(cells[3].className).toContain("cursor-pointer");
    expect(cells[4].className).toContain("cursor-pointer");

    await act(async () => {
      cells[4].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Payments Applied — March 2026");
  });

  it("shows the detail cards in accounting order without changing the amounts or reconciliation", async () => {
    useQuery.mockReturnValue({ data: details, isLoading: false });
    const page = await render(<EAInvoiceView />);
    const cards = Array.from(page.querySelectorAll(".statement-page > .statement-section, .statement-page > div > .statement-section"));
    expect(cards.map((card) => card.querySelector(".text-lg")?.textContent)).toEqual([
      "Incoming Balance", "Invoiced Amount", "Payments Applied", "Outgoing Balance",
    ]);
    expect(cards.map((card) => card.querySelector("[data-testid]")?.textContent?.trim())).toEqual([
      "$11.00", "$25.00", "-$7.00", "$29.00",
    ]);
    expect(cards[2].textContent).toContain("Remaining$18.00");
    expect(cards[2].textContent).toContain("payments are always credited to the oldest outstanding balance");
  });
});