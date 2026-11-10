// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider, focusManager } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

vi.mock("wouter", () => ({
  useParams: () => ({ id: "ea-1" }),
  Link: ({ href, children }: any) => <a href={href}>{children}</a>,
}));
vi.mock("@/components/layouts/EALayout", () => ({
  EALayout: ({ children }: any) => children,
  useEALayout: () => ({ currencyCode: "USD", ea: { id: "ea-1" } }),
}));
vi.mock("@/components/layouts/LedgerAccountLayout", () => ({
  LedgerAccountLayout: ({ children }: any) => children,
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ hasPermission: () => true }) }));
vi.mock("@/contexts/PageTitleContext", () => ({ usePageTitle: () => {} }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

import EAPayments from "@/pages/ea-payments";
import AccountPayments from "@/pages/config/ledger/account-payments";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe("online payment lists", () => {
  it.each([["EA", EAPayments], ["account", AccountPayments]] as const)("refreshes an already open %s list from Pending to Cleared without changing classification", async (_name, Page) => {
    vi.useFakeTimers();
    focusManager.setFocused(true);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const payment = { id: "payment-1", ledgerEaId: "ea-1", status: "pending",
      amount: "25.00", paymentType: "online-card", dateReceived: "2026-11-10T15:38:14Z",
      dateCleared: null as string | null, details: { paymentAttemptId: "session-1" },
      entityType: "worker", entityId: "worker-1", entityName: "Fixture worker" };
    let current = { ...payment };
    let reads = 0;
    const client = new QueryClient({ defaultOptions: { queries: {
      staleTime: Infinity, retry: false,
      queryFn: async ({ queryKey }) => {
        if (queryKey[0] === "/api/ledger/payment-types")
          return [{ id: "online-card", name: "Online – Card", currencyCode: "USD" }];
        reads++;
        return [current];
      },
    } } });
    const flush = async (ms = 1) => {
      await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
      await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    };
    try {
      await act(async () => { root.render(<QueryClientProvider client={client}><Page /></QueryClientProvider>); });
      await flush();
      expect(container.textContent?.toLowerCase()).toContain("pending");
      expect(container.textContent).toContain("Online – Card");
      current = { ...payment, status: "cleared", dateCleared: "2026-11-10T15:50:00Z" };
      await flush(5000);
      expect(container.textContent?.toLowerCase()).toContain("cleared");
      const count = reads;
      await flush(10000);
      expect(reads).toBe(count);
      expect(container.querySelectorAll('a[href="/ledger/payment/payment-1"]')).toHaveLength(1);
      expect(current.dateReceived).toBe(payment.dateReceived);
    } finally {
      await act(async () => root.unmount());
      client.clear();
      container.remove();
      focusManager.setFocused(undefined);
      vi.useRealTimers();
    }
  });
});
