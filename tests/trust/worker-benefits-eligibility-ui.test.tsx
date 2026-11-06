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
  { id: "policy-election", name: "Election Policy", data: { benefitIds: ["benefit-1"] } },
  { id: "policy-home", name: "Home Policy", data: { benefitIds: ["benefit-1"] } },
  { id: "policy-default", name: "System Default", data: { benefitIds: ["benefit-1"] } },
  { id: "policy-manual", name: "Manual Policy", data: { benefitIds: ["benefit-1"] } },
];

let elections: Array<Record<string, unknown>>;
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
      if (url.startsWith("/api/workers/worker-1/trust-elections?")) {
        if (electionFetchGate.promise) elections = await electionFetchGate.promise;
        return json(elections);
      }
      if (url === "/api/policies") return json(policies);
      if (url === "/api/trust-benefits") {
        return json([{ id: "benefit-1", name: "Medical" }]);
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
