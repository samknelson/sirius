// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { apiRequest, pluginSearch, electionFetchGate } = vi.hoisted(() => ({
  apiRequest: vi.fn(),
  pluginSearch: vi.fn(),
  electionFetchGate: {
    promise: null as Promise<Array<Record<string, unknown>>> | null,
  },
}));

vi.mock("@/components/layouts/WorkerLayout", () => ({
  WorkerLayout: ({ children }: { children: React.ReactNode }) => children,
  useWorkerLayout: () => ({
    worker: { id: "worker-1", denormHomeEmployerId: "home-employer" },
    contact: { displayName: "Test Worker", given: "Test", family: "Worker" },
  }),
}));

vi.mock("@/plugins/_core", () => ({
  pluginManifestQueryKey: (kind: string) => [`/api/plugins/${kind}/manifest`],
  pluginSearch,
}));

vi.mock("@/lib/queryClient", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/queryClient")>("@/lib/queryClient");
  return { ...actual, apiRequest };
});

vi.mock("@/components/ui/select", () => ({
  Select: ({
    value,
    onValueChange,
    disabled,
    children,
  }: {
    value: string;
    onValueChange: (value: string) => void;
    disabled?: boolean;
    children: React.ReactNode;
  }) => (
    <select
      value={value}
      disabled={disabled}
      onChange={(event) => onValueChange(event.target.value)}
    >
      {children}
    </select>
  ),
  SelectTrigger: ({ children }: { children: React.ReactNode }) => children,
  SelectValue: ({ placeholder }: { placeholder?: string }) => (
    <option value="">{placeholder ?? ""}</option>
  ),
  SelectContent: ({ children }: { children: React.ReactNode }) => children,
  SelectItem: ({
    value,
    children,
  }: {
    value: string;
    children: React.ReactNode;
  }) => <option value={value}>{children}</option>,
}));

import WorkerBenefitsEligibility from "../../client/src/pages/worker-benefits-eligibility";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const policies = [
  { id: "policy-election", name: "Election Policy", data: { benefitIds: ["benefit-1", "benefit-2", "benefit-dental"] } },
  { id: "policy-home", name: "Home Policy", data: { benefitIds: ["benefit-1"] } },
  { id: "policy-default", name: "System Default", data: { benefitIds: ["benefit-1"] } },
  { id: "policy-manual", name: "Manual Policy", data: { benefitIds: ["benefit-1"] } },
];

let elections: Array<Record<string, unknown>>;
let benefitHistory: Array<{ benefitId: string; year: number; month: number; benefit?: { benefitType: string } }>;
let benefitDataGate: { url: string; promise: Promise<unknown> } | null;
const benefits = [
  { id: "benefit-1", name: "Health Plan One", benefitType: "type-medical" },
  { id: "benefit-2", name: "Health Plan Two", benefitType: "type-medical" },
  // A benefit's name must not be mistaken for its type.
  { id: "benefit-dental", name: "Medical", benefitType: "type-dental" },
];
const benefitTypes = [
  { id: "type-medical", name: "Medical" },
  { id: "type-dental", name: "Dental" },
];

function recordedBenefits() {
  return benefitHistory.map((row) => ({
    ...row,
    benefit: row.benefit ?? benefits.find((benefit) => benefit.id === row.benefitId) ?? null,
  }));
}
let homePolicyId: string | null;
let root: Root | null = null;
let container: HTMLDivElement | null = null;
let queryClient: QueryClient;
let scrollIntoView: ReturnType<typeof vi.fn>;
let matchMedia: ReturnType<typeof vi.fn>;

function json(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function selects(): HTMLSelectElement[] {
  return Array.from(container!.querySelectorAll("select"));
}

async function waitFor(test: () => void): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      test();
      return;
    } catch (error) {
      lastError = error;
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }
  }
  throw lastError;
}

async function renderPage(): Promise<void> {
  queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        queryFn: async ({ queryKey }) => {
          let url = String(queryKey[0]);
          if (url === "/api/employers" && queryKey[1]) {
            url = `/api/employers/${queryKey[1]}`;
          }
          const response = await fetch(url);
          if (!response.ok) throw new Error(`Request failed: ${url}`);
          return response.json();
        },
      },
      mutations: { retry: false },
    },
  });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <QueryClientProvider client={queryClient}>
        <WorkerBenefitsEligibility />
      </QueryClientProvider>,
    );
  });
}

async function changeSelect(index: number, value: string): Promise<void> {
  const select = selects()[index];
  await act(async () => {
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

async function runEvaluation(): Promise<void> {
  await changeSelect(1, "benefit-1");
  await act(async () => {
    const button = container!.querySelector<HTMLButtonElement>(
      '[data-testid="button-evaluate"]',
    );
    button!.click();
  });
}

beforeEach(() => {
  elections = [
    {
      id: "latest",
      startYmd: "2026-01-01",
      employerId: "new-employer",
      policyId: "legacy-policy",
      effectivePolicyId: "policy-election",
    },
    {
      id: "older",
      startYmd: "2024-01-01",
      employerId: "old-employer",
      policyId: "older-legacy-policy",
      effectivePolicyId: "policy-manual",
    },
  ];
  homePolicyId = "policy-home";
  benefitHistory = [];
  benefitDataGate = null;
  electionFetchGate.promise = null;
  apiRequest.mockReset();
  pluginSearch.mockReset().mockResolvedValue([]);
  scrollIntoView = vi.fn();
  matchMedia = vi.fn().mockReturnValue({ matches: false });
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: scrollIntoView,
  });
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: matchMedia,
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (benefitDataGate?.url === url) return json(await benefitDataGate.promise);
      if (url === "/api/workers/worker-1/benefits") return json(recordedBenefits());
      if (url === "/api/options/trust-benefit-type") return json(benefitTypes);
      if (url.startsWith("/api/workers/worker-1/trust-elections?")) {
        if (electionFetchGate.promise) elections = await electionFetchGate.promise;
        return json(elections);
      }
      if (url === "/api/policies") return json(policies);
      if (url === "/api/trust-benefits") {
        return json(benefits);
      }
      if (url === "/api/employers/home-employer") {
        return json({ id: "home-employer", denormPolicyId: homePolicyId });
      }
      if (url === "/api/employers/lookup") return json([]);
      if (url === "/api/variables/by-name/policy_default") {
        return json({ value: "policy-default" });
      }
      if (url === "/api/options/worker-ws") return json([]);
      if (url === "/api/plugins/trust-eligibility/manifest") return json([]);
      if (url.startsWith("/api/workers/worker-1/relations?")) return json([]);
      throw new Error(`Unexpected fetch: ${url}`);
    }),
  );
});

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  queryClient?.clear();
  container?.remove();
  root = null;
  container = null;
  vi.unstubAllGlobals();
});

describe("worker eligibility Medical benefit default", () => {
  it("uses coverage year then month, regardless of history order or benefit name", async () => {
    benefitHistory = [
      { benefitId: "benefit-1", year: 2025, month: 12 },
      { benefitId: "benefit-dental", year: 2027, month: 1 },
      { benefitId: "benefit-2", year: 2026, month: 2 },
      { benefitId: "benefit-1", year: 2026, month: 1 },
    ];
    await renderPage();
    await waitFor(() => expect(selects()[1].value).toBe("benefit-2"));
    expect(Array.from(selects()[1].options).map((option) => option.value))
      .toEqual(["", "benefit-1", "benefit-2", "benefit-dental"]);
  });

  it.each(["empty", "non-medical", "unknown"] as const)(
    "leaves Benefit blank with %s history",
    async (kind) => {
      benefitHistory = kind === "empty" ? [] : [{
        benefitId: kind === "non-medical" ? "benefit-dental" : "unknown-benefit",
        year: 2026, month: 1,
      }];
      await renderPage();
      await waitFor(() => expect(selects()[0].value).toBe("policy-election"));
      expect(selects()[1].value).toBe("");
    },
  );

  it("clears the old selection on policy change without substituting older Medical history", async () => {
    benefitHistory = [
      { benefitId: "benefit-1", year: 2025, month: 12 },
      { benefitId: "benefit-2", year: 2026, month: 1 },
    ];
    await renderPage();
    await waitFor(() => expect(selects()[1].value).toBe("benefit-2"));
    await changeSelect(0, "policy-manual");
    expect(selects()[1].value).toBe("");
    await changeSelect(1, "benefit-1");
    await changeSelect(0, "policy-election");
    await waitFor(() => expect(selects()[1].value).toBe("benefit-2"));
  });

  it("resolves the default for a manually chosen policy while election data is pending", async () => {
    const gate = deferred<Array<Record<string, unknown>>>();
    electionFetchGate.promise = gate.promise;
    benefitHistory = [{ benefitId: "benefit-1", year: 2026, month: 1 }];
    await renderPage();
    await waitFor(() => expect(selects()[0].options.length).toBeGreaterThan(1));
    await changeSelect(0, "policy-manual");
    await waitFor(() => expect(selects()[1].value).toBe("benefit-1"));
    await act(async () => gate.resolve(elections));
    expect(selects()[0].value).toBe("policy-manual");
    expect(selects()[1].value).toBe("benefit-1");
  });

  it("does not substitute older active coverage when the newest Medical benefit is inactive", async () => {
    benefitHistory = [
      { benefitId: "benefit-1", year: 2025, month: 12 },
      { benefitId: "inactive-benefit", year: 2026, month: 1, benefit: { benefitType: "type-medical" } },
    ];
    await renderPage();
    await waitFor(() => expect(selects()[0].value).toBe("policy-election"));
    await waitFor(() => expect(queryClient.isFetching()).toBe(0));
    expect(selects()[1].value).toBe("");
  });

  it.each(["history", "types", "benefits"] as const)(
    "waits for late %s data and applies the current policy's default",
    async (kind) => {
      benefitHistory = [{ benefitId: "benefit-2", year: 2026, month: 1 }];
      const gate = deferred<unknown>();
      benefitDataGate = {
        url: kind === "history" ? "/api/workers/worker-1/benefits"
          : kind === "types" ? "/api/options/trust-benefit-type" : "/api/trust-benefits",
        promise: gate.promise,
      };
      await renderPage();
      await waitFor(() => expect(selects()[0].value).toBe("policy-election"));
      expect(selects()[1].value).toBe("");
      await changeSelect(0, "policy-manual");
      await act(async () => gate.resolve(
        kind === "history" ? recordedBenefits() : kind === "types" ? benefitTypes : benefits,
      ));
      await waitFor(() => expect(queryClient.isFetching()).toBe(0));
      expect(selects()[1].value).toBe("");
      await changeSelect(0, "policy-election");
      await waitFor(() => expect(selects()[1].value).toBe("benefit-2"));
    },
  );

  it.each(["history", "types"] as const)(
    "preserves manual Benefit selection when %s arrives late",
    async (kind) => {
      benefitHistory = [{ benefitId: "benefit-2", year: 2026, month: 1 }];
      const gate = deferred<unknown>();
      benefitDataGate = {
        url: kind === "history" ? "/api/workers/worker-1/benefits"
          : "/api/options/trust-benefit-type",
        promise: gate.promise,
      };
      await renderPage();
      await waitFor(() => expect(selects()[1].options.length).toBe(4));
      await changeSelect(1, "benefit-dental");
      await act(async () => gate.resolve(kind === "history" ? recordedBenefits() : benefitTypes));
      await waitFor(() => expect(queryClient.isFetching()).toBe(0));
      expect(selects()[1].value).toBe("benefit-dental");
    },
  );

  it("does not change Benefit or results when history refreshes after evaluation", async () => {
    benefitHistory = [{ benefitId: "benefit-1", year: 2026, month: 1 }];
    apiRequest.mockResolvedValue({ benefitId: "benefit-1", eligible: true, results: [] });
    await renderPage();
    await waitFor(() => expect(selects()[1].value).toBe("benefit-1"));
    await runEvaluation();
    await waitFor(() =>
      expect(container!.querySelector('[data-testid="eligibility-results"]')).not.toBeNull(),
    );
    await act(async () => {
      queryClient.setQueryData(["/api/workers", "worker-1", "benefits"], [
        { benefitId: "benefit-2", year: 2026, month: 2, benefit: benefits[1] },
      ]);
    });
    expect(selects()[1].value).toBe("benefit-1");
    expect(container!.querySelector('[data-testid="eligibility-results"]')).not.toBeNull();
  });
});

describe("worker eligibility policy defaults and feedback", () => {
  it("defaults to the newest election's effective policy, not its legacy policy", async () => {
    await renderPage();
    await waitFor(() => expect(selects()[0].value).toBe("policy-election"));
  });

  it("falls back to the home employer policy, then the system default", async () => {
    elections[0].effectivePolicyId = null;
    await renderPage();
    await waitFor(() => expect(selects()[0].value).toBe("policy-home"));

    await act(async () => root!.unmount());
    root = null;
    container?.remove();
    container = null;
    queryClient.clear();

    homePolicyId = null;
    await renderPage();
    await waitFor(() => expect(selects()[0].value).toBe("policy-default"));
  });

  it("preserves a manual selection made while election data is loading", async () => {
    const gate = deferred<Array<Record<string, unknown>>>();
    electionFetchGate.promise = gate.promise;
    await renderPage();
    await waitFor(() => expect(selects()[0].options.length).toBeGreaterThan(1));
    await changeSelect(0, "policy-manual");

    await act(async () => gate.resolve(elections));
    await waitFor(() => expect(selects()[0].value).toBe("policy-manual"));
  });

  it("clears the selected benefit when the policy is changed", async () => {
    await renderPage();
    await waitFor(() => expect(selects()[0].value).toBe("policy-election"));
    await changeSelect(1, "benefit-1");
    await changeSelect(0, "policy-manual");

    expect(selects()[1].value).toBe("");
  });

  it("focuses and smoothly scrolls to successful results", async () => {
    apiRequest.mockResolvedValue({ benefitId: "benefit-1", eligible: true, results: [] });
    await renderPage();
    await waitFor(() => expect(selects()[0].value).toBe("policy-election"));
    await runEvaluation();

    await waitFor(() =>
      expect(container!.querySelector('[data-testid="eligibility-results"]')).not.toBeNull(),
    );
    const target = container!.querySelector<HTMLElement>(
      '[data-testid="eligibility-results"]',
    )!;
    expect(document.activeElement).toBe(target);
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
    const scrollCount = scrollIntoView.mock.calls.length;
    await changeSelect(2, "2025");
    expect(scrollIntoView).toHaveBeenCalledTimes(scrollCount);
  });

  it("focuses and scrolls to errors without motion when reduced motion is preferred", async () => {
    matchMedia.mockReturnValue({ matches: true });
    apiRequest.mockRejectedValue(new Error("Evaluation failed"));
    await renderPage();
    await waitFor(() => expect(selects()[0].value).toBe("policy-election"));
    await runEvaluation();

    await waitFor(() =>
      expect(container!.querySelector('[data-testid="eligibility-error"]')).not.toBeNull(),
    );
    const target = container!.querySelector<HTMLElement>(
      '[data-testid="eligibility-error"]',
    )!;
    expect(document.activeElement).toBe(target);
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "auto", block: "start" });
  });
});
