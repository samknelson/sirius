// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));

vi.mock("@/components/layouts/WorkerLayout", () => ({
  WorkerLayout: ({ children }: { children: React.ReactNode }) => children,
  useWorkerLayout: () => ({ worker: { id: "worker-1" } }),
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ hasPermission: () => true }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>("@/lib/queryClient");
  return { ...actual, apiRequest };
});

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? <div role="dialog">{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
}));

vi.mock("@/components/ui/select", () => ({
  Select: ({
    value,
    onValueChange,
    children,
  }: {
    value: string;
    onValueChange: (value: string) => void;
    children: React.ReactNode;
  }) => (
    <select
      data-testid="select-employer"
      value={value}
      onChange={(event) => onValueChange(event.target.value)}
    >
      {children}
    </select>
  ),
  SelectTrigger: ({ children }: { children: React.ReactNode }) => children,
  SelectValue: ({ placeholder }: { placeholder?: string }) => <option value="">{placeholder}</option>,
  SelectContent: ({ children }: { children: React.ReactNode }) => children,
  SelectItem: ({
    value,
    children,
  }: {
    value: string;
    children: React.ReactNode;
  }) => <option value={value}>{children}</option>,
}));

vi.mock("@/components/ui/checkbox", () => ({
  Checkbox: ({
    checked,
    onCheckedChange,
    "data-testid": testId,
  }: {
    checked: boolean;
    onCheckedChange: () => void;
    "data-testid"?: string;
  }) => (
    <input
      type="checkbox"
      checked={checked}
      onChange={onCheckedChange}
      data-testid={testId}
    />
  ),
}));

import ElectionsCurrentPage from "../../client/src/pages/workers/elections-current";
import ElectionsListPage from "../../client/src/pages/workers/elections-list";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const newestElection = {
  id: "newest",
  workerId: "worker-1",
  employerId: "employer-new",
  policyId: "policy-that-must-not-copy",
  benefitIds: ["benefit-medical"],
  relationshipIds: ["relation-spouse"],
  startYmd: "2025-08-01",
  endYmd: "2026-07-31",
  enrollmentType: "open_enrollment",
  data: { historical: true },
  employerName: "Newest Employer",
  policyName: "Historical Policy",
  benefits: [{ id: "benefit-medical", name: "Medical" }],
  relationships: [{ id: "relation-spouse", label: "Spouse" }],
};

const olderElection = {
  ...newestElection,
  id: "older",
  employerId: "employer-old",
  benefitIds: ["benefit-dental"],
  relationshipIds: [],
  startYmd: "2024-01-01",
};

type TestElection = Omit<typeof newestElection, "endYmd"> & {
  endYmd: string | null;
};

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let electionHistory: TestElection[] = [];
let currentElection: TestElection | null = newestElection;
let requestedUrls: string[] = [];

function json(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function todayYmd(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function byTestId<T extends HTMLElement>(testId: string): T {
  const element = container?.querySelector<T>(`[data-testid="${testId}"]`);
  if (!element) throw new Error(`Missing element ${testId}: ${container?.innerHTML}`);
  return element;
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

async function renderPage(Page: React.ComponentType): Promise<void> {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        queryFn: async ({ queryKey }) => {
          const url = queryKey.map(String).join("/");
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
        <Page />
      </QueryClientProvider>,
    );
  });
  await waitFor(() => expect(byTestId<HTMLButtonElement>("button-create-election").disabled).toBe(false));
}

async function click(testId: string): Promise<void> {
  await act(async () => {
    byTestId<HTMLButtonElement>(testId).click();
  });
}

function expectCarriedDefaults(): void {
  expect(byTestId<HTMLSelectElement>("select-employer").value).toBe("employer-new");
  expect(byTestId<HTMLInputElement>("input-start-ymd").value).toBe(todayYmd());
  expect(byTestId<HTMLInputElement>("input-end-ymd").value).toBe("");
  expect(byTestId<HTMLInputElement>("checkbox-benefit-benefit-medical").checked).toBe(true);
  expect(byTestId<HTMLInputElement>("checkbox-benefit-benefit-dental").checked).toBe(false);
  expect(byTestId<HTMLInputElement>("checkbox-relation-relation-spouse").checked).toBe(true);
}

async function openElectionDialog(): Promise<void> {
  await click("button-create-election");
  await waitFor(expectCarriedDefaults);
}

beforeEach(() => {
  electionHistory = [newestElection, olderElection];
  currentElection = newestElection;
  requestedUrls = [];
  apiRequest.mockReset();
  apiRequest.mockResolvedValue({ ...newestElection, id: "created" });
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    requestedUrls.push(url);
    if (url.includes("/trust-elections/current")) return json(currentElection);
    if (url.includes("/trust-elections/first-time-eligibility")) return json({ eligible: true });
    if (url.includes("/trust-elections/life-event-eligibility")) return json({ eligible: true });
    if (url.includes("/trust-elections")) return json(electionHistory);
    if (url.includes("/employers/lookup")) {
      return json([
        { id: "employer-new", name: "Newest Employer" },
        { id: "employer-old", name: "Older Employer" },
      ]);
    }
    if (url.includes("/trust-benefits")) {
      return json([
        { id: "benefit-medical", name: "Medical" },
        { id: "benefit-dental", name: "Dental" },
      ]);
    }
    if (url.includes("/relations")) {
      return json([{
        id: "relation-spouse",
        relationTypeName: "Spouse",
        otherWorker: { displayName: "Alex Worker", given: "Alex", family: "Worker" },
      }]);
    }
    if (url.includes("/open-enrollment-windows/active")) return json({ active: null, today: todayYmd() });
    throw new Error(`Unexpected fetch: ${url}`);
  }));
});

afterEach(async () => {
  if (root) {
    await act(async () => root!.unmount());
  }
  container?.remove();
  root = null;
  container = null;
  vi.unstubAllGlobals();
});

describe.each([
  ["Current", ElectionsCurrentPage],
  ["All Elections", ElectionsListPage],
] as const)("New Election from the %s tab", (_tab, Page) => {
  it("opens with the newest-by-start-date election's carry-forward fields", async () => {
    await renderPage(Page);
    await openElectionDialog();

    expectCarriedDefaults();
    expect(requestedUrls).toContain("/api/workers/worker-1/trust-elections?sort=startDesc");
  });

  it("discards edits on close and restores carry-forward defaults on reopen", async () => {
    await renderPage(Page);
    await openElectionDialog();

    const start = byTestId<HTMLInputElement>("input-start-ymd");
    await act(async () => {
      start.value = "2030-01-02";
      start.dispatchEvent(new Event("change", { bubbles: true }));
      byTestId<HTMLInputElement>("checkbox-benefit-benefit-medical").click();
    });
    await click("button-cancel");
    await openElectionDialog();

    expectCarriedDefaults();
  });
});

it("opens a blank, today-dated form for a worker with no election history", async () => {
  electionHistory = [];
  await renderPage(ElectionsListPage);
  await click("button-create-election");

  await waitFor(() => {
    expect(byTestId<HTMLSelectElement>("select-employer").value).toBe("");
    expect(byTestId<HTMLInputElement>("input-start-ymd").value).toBe(todayYmd());
    expect(byTestId<HTMLInputElement>("input-end-ymd").value).toBe("");
    expect(byTestId<HTMLInputElement>("checkbox-benefit-benefit-medical").checked).toBe(false);
    expect(byTestId<HTMLInputElement>("checkbox-relation-relation-spouse").checked).toBe(false);
  });
});

it("submits only carried-forward employer, benefits, relationships, and fresh dates", async () => {
  await renderPage(ElectionsCurrentPage);
  await openElectionDialog();
  await click("button-save");

  await waitFor(() => expect(apiRequest).toHaveBeenCalled());
  expect(apiRequest).toHaveBeenCalledWith(
    "POST",
    "/api/workers/worker-1/trust-elections",
    {
      employerId: "employer-new",
      startYmd: todayYmd(),
      endYmd: null,
      benefitIds: ["benefit-medical"],
      relationshipIds: ["relation-spouse"],
    },
  );
  const submitted = apiRequest.mock.calls[0][2];
  expect(submitted).not.toHaveProperty("policyId");
  expect(submitted).not.toHaveProperty("enrollmentType");
  expect(submitted).not.toHaveProperty("data");
});

it("labels past, current-boundary, and future elections consistently", async () => {
  const today = todayYmd();
  electionHistory = [
    { ...newestElection, id: "future", startYmd: "2999-01-01", endYmd: null },
    { ...newestElection, id: "current", startYmd: today, endYmd: today },
    { ...newestElection, id: "past", startYmd: "2000-01-01", endYmd: "2000-12-31" },
  ];

  await renderPage(ElectionsListPage);

  await waitFor(() => {
    expect(byTestId("badge-status-future").textContent).toBe("Upcoming");
    expect(byTestId("badge-status-current").textContent).toBe("Active");
    expect(byTestId("badge-status-past").textContent).toBe("Ended");
  });
});

it("shows no Current Election when the API excludes an open future election", async () => {
  electionHistory = [
    { ...newestElection, id: "future", startYmd: "2999-01-01", endYmd: null },
    { ...newestElection, id: "past", startYmd: "2000-01-01", endYmd: "2000-12-31" },
  ];
  currentElection = null;

  await renderPage(ElectionsCurrentPage);

  await waitFor(() => {
    expect(byTestId("text-no-current-election").textContent).toContain("No current election");
    expect(container?.querySelector('[data-testid="card-current-election"]')).toBeNull();
  });
});
