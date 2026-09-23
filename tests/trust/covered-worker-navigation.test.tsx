// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useQuery } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

const { election } = vi.hoisted(() => ({
  election: {
    id: "election-1",
    workerId: "subscriber-1",
    employerName: "Employer",
    policyName: "Policy",
    startYmd: "2026-01-01",
    endYmd: null,
    benefits: [],
    relationships: [
      { id: "rel-1", label: "Alex (Child)", coveredWorkerId: "dependent-1" },
      { id: "rel-2", label: "Sam (Spouse)", coveredWorkerId: "dependent-2" },
      { id: "rel-deleted", label: "Unknown relationship", coveredWorkerId: null },
      { id: "rel-orphan", label: "Unknown worker (Child)", coveredWorkerId: null },
    ],
  },
}));

vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...await importOriginal<typeof import("@tanstack/react-query")>(),
  useQuery: vi.fn(),
  useMutation: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/components/layouts/TrustElectionLayout", () => ({
  TrustElectionLayout: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useTrustElectionLayout: () => ({ election, workerName: "Subscriber", isWorkerLoading: false }),
}));
vi.mock("@/components/layouts/WorkerLayout", () => ({
  WorkerLayout: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useWorkerLayout: () => ({ worker: { id: "subscriber-1" } }),
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ hasPermission: () => false }),
}));
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

import ElectionDetailPage from "@/pages/trust/election-detail";
import ElectionsCurrentPage from "@/pages/workers/elections-current";
import WorkerBenefitsHistory from "@/pages/worker-benefits-history";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let container: HTMLDivElement;

async function render(Page: React.ComponentType) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root!.render(<Page />); });
}

function expectCoveredLinks(selector: string) {
  const section = container.querySelector(selector)!;
  const links = Array.from(section.querySelectorAll("a"));
  expect(links.map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
    ["Alex (Child)", "/workers/dependent-1"],
    ["Sam (Spouse)", "/workers/dependent-2"],
  ]);
  expect(links.every((link) => link.tabIndex === 0)).toBe(true);
  expect(section.textContent).toContain("Unknown relationship");
  expect(section.textContent).toContain("Unknown worker (Child)");
}

afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  root = undefined;
  document.body.innerHTML = "";
  vi.resetAllMocks();
  election.relationships = [
    { id: "rel-1", label: "Alex (Child)", coveredWorkerId: "dependent-1" },
    { id: "rel-2", label: "Sam (Spouse)", coveredWorkerId: "dependent-2" },
    { id: "rel-deleted", label: "Unknown relationship", coveredWorkerId: null },
    { id: "rel-orphan", label: "Unknown worker (Child)", coveredWorkerId: null },
  ];
});

describe("covered worker navigation", () => {
  it("links each dependent, not the subscriber, on election detail", async () => {
    await render(ElectionDetailPage);
    expectCoveredLinks('[data-testid="text-relationships"]');
    expect(container.querySelector('[data-testid="link-worker"]')?.getAttribute("href")).toBe("/workers/subscriber-1");
  });

  it("links individual dependents on Current Election and preserves the empty state", async () => {
    vi.mocked(useQuery).mockImplementation(((options: { queryKey: string[] }) => ({
      data: options.queryKey.at(-1) === "current" ? election : [],
      isLoading: false,
    })) as typeof useQuery);
    await render(ElectionsCurrentPage);
    expectCoveredLinks('[data-testid="text-current-relationships"]');
    election.relationships = [];
    await act(async () => { root!.render(<ElectionsCurrentPage />); });
    expect(container.querySelector('[data-testid="text-current-relationships"]')?.textContent).toBe("—");
  });

  it("links only a resolved source on Benefit History; unresolved and own remain text", async () => {
    vi.mocked(useQuery).mockImplementation(((options: { queryKey: string[] }) => ({
      data: options.queryKey.at(-1) === "benefits" ? [
        { id: "dependent", year: 2026, month: 1, benefit: { name: "Medical" }, employer: { name: "Employer" },
          sourceRelationId: "relation-1",
          sourceRelation: { sourceWorkerId: "source-1", sourceWorkerName: "Taylor", relationTypeName: "Child" } },
        { id: "deleted", year: 2026, month: 2, benefit: { name: "Medical" }, employer: { name: "Employer" },
          sourceRelationId: "deleted-relation", sourceRelation: null },
        { id: "missing", year: 2026, month: 3, benefit: { name: "Medical" }, employer: { name: "Employer" },
          sourceRelationId: "relation-2",
          sourceRelation: { sourceWorkerId: null, sourceWorkerName: "Unknown worker", relationTypeName: "Spouse" } },
        { id: "own", year: 2026, month: 4, benefit: { name: "Medical" }, employer: { name: "Employer" },
          sourceRelationId: null, sourceRelation: null },
      ] : [],
      isLoading: false,
    })) as typeof useQuery);
    await render(WorkerBenefitsHistory);
    const source = (id: string) => container.querySelector(`[data-testid="text-benefit-source-${id}"]`)!;
    expect(source("dependent").textContent).toBe("via Taylor (Child)");
    expect(source("dependent").querySelector("a")?.getAttribute("href")).toBe("/workers/source-1");
    expect(source("deleted").textContent).toBe("via Unknown worker");
    expect(source("missing").textContent).toBe("via Unknown worker (Spouse)");
    expect(source("own").textContent).toBe("Own");
    for (const id of ["deleted", "missing", "own"]) expect(source(id).querySelector("a")).toBeNull();
  });
});