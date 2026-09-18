// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { useQuery } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-query", () => ({ useQuery: vi.fn() }));
vi.mock("@/components/layouts/WorkerLayout", () => ({
  WorkerLayout: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useWorkerLayout: () => ({ worker: { id: "worker-42" } }),
}));

import Page from "@/pages/worker-sitespecific-bao-dp";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = "";
  vi.resetAllMocks();
});

describe("worker domestic-partner payment navigation", () => {
  it("carries the domestic-partner EA into checkout", async () => {
    vi.mocked(useQuery).mockReturnValue({
      data: {
        configured: true,
        eaId: "ea-dp-7",
        dependents: {},
        state: {
          accountId: "account-dp",
          configId: "config-dp",
          balance: "25.00",
          totalCharges: "25.00",
          totalPaid: "0.00",
          months: [],
        },
      },
      isLoading: false,
      isError: false,
    } as ReturnType<typeof useQuery>);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => { root.render(<Page />); });
    const link = container.querySelector('[data-testid="button-dp-pay"]') as HTMLAnchorElement | null;
    expect(link?.getAttribute("href")).toBe("/workers/worker-42/ledger/pay?eaId=ea-dp-7");
    await act(async () => root.unmount());
  });
});