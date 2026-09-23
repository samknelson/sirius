// @vitest-environment jsdom
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const { cases } = vi.hoisted(() => ({
  cases: [
    {
      id: "dependent-case",
      coveredPersonWorkerId: "dependent-worker",
      subscriberWorkerId: "subscriber-without-case",
      coveredPersonName: "Dependent Person",
      subscriberName: "Plan Subscriber",
      statusName: "Open",
      statusClosed: false,
      qualifyingEventName: null,
      source: "manual",
      cobraEffectiveYmd: null,
      lastDayToElectYmd: null,
    },
    {
      id: "missing-names",
      coveredPersonWorkerId: "unnamed-covered",
      subscriberWorkerId: "unnamed-subscriber",
      coveredPersonName: null,
      subscriberName: null,
      statusName: "Open",
      statusClosed: false,
      qualifyingEventName: null,
      source: "manual",
      cobraEffectiveYmd: null,
      lastDayToElectYmd: null,
    },
  ],
}));

vi.mock("@tanstack/react-query", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-query")>("@tanstack/react-query");
  return {
    ...actual,
    useQuery: ({ queryKey }: { queryKey: string[] }) => ({
      data: queryKey[0] === "/api/sitespecific/bao/cobra/cases" ? cases : [],
      isLoading: false,
    }),
    useMutation: () => ({ mutate: vi.fn(), isPending: false }),
  };
});
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/components/layout/PageHeader", () => ({
  PageHeader: () => null,
}));

import BaoCobraCases from "../../client/src/pages/sitespecific/bao/cobra-cases";

describe("COBRA cases list worker links", () => {
  it("links different covered and subscriber workers to their own destinations without requiring a subscriber case", () => {
    const document = new DOMParser().parseFromString(
      renderToStaticMarkup(<BaoCobraCases />),
      "text/html",
    );
    const row = document.querySelector('[data-testid="row-cobra-case-dependent-case"]')!;
    expect(row.querySelector('[data-testid="link-case-covered-cobra-dependent-case"]')?.getAttribute("href"))
      .toBe("/workers/dependent-worker/sitespecific/bao/cobra");
    expect(row.querySelector('[data-testid="link-case-subscriber-dependent-case"]')?.getAttribute("href"))
      .toBe("/workers/subscriber-without-case");
    expect(row.querySelector('[data-testid="text-case-subscriber-dependent-case"]')?.textContent)
      .toBe("Plan Subscriber");

    const unnamed = document.querySelector('[data-testid="row-cobra-case-missing-names"]')!;
    for (const cell of ["covered", "subscriber"]) {
      const name = unnamed.querySelector(`[data-testid="text-case-${cell}-missing-names"]`)!;
      expect(name.textContent).toBe("—");
      expect(name.querySelector("a")).toBeNull();
    }
  });
});