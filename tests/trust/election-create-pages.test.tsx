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
import { ElectionForm } from "../../client/src/components/trust/ElectionForm";
import type { WorkerTrustElection } from "../../shared/schema";

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
let benefitOptions: Array<{
  id: string;
  name: string;
  benefitType?: string | null;
  benefitTypeName?: string | null;
  benefitTypeSequence?: number | null;
  benefitTypeShowOnEnrollmentWizards?: boolean | null;
}> = [];
let testQueryClient: QueryClient;
let benefitsGate: Promise<void> | null = null;

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

async function renderPage(Page: React.ComponentType, waitForCreate = true): Promise<void> {
  testQueryClient = new QueryClient({
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
      <QueryClientProvider client={testQueryClient}>
        <Page />
      </QueryClientProvider>,
    );
  });
  if (waitForCreate) {
    await waitFor(() => expect(byTestId<HTMLButtonElement>("button-create-election").disabled).toBe(false));
  }
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
  benefitsGate = null;
  benefitOptions = [
    { id: "benefit-medical", name: "Medical" },
    { id: "benefit-dental", name: "Dental" },
  ];
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
      if (benefitsGate) await benefitsGate;
      return json(benefitOptions);
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

  it("groups enabled, unset and untyped benefits, and omits hidden carry-forward IDs on save", async () => {
    electionHistory = [{
      ...newestElection,
      benefitIds: ["benefit-medical", "benefit-dental", "benefit-unset", "benefit-untyped"],
    }, olderElection];
    benefitOptions = [
      { id: "benefit-dental", name: "Dental", benefitType: "hidden", benefitTypeName: "Hidden", benefitTypeSequence: 0, benefitTypeShowOnEnrollmentWizards: false },
      { id: "benefit-untyped", name: "No type" },
      { id: "benefit-orphan", name: "Missing type record", benefitType: "deleted-type", benefitTypeName: null },
      { id: "benefit-unset", name: "Unspecified", benefitType: "late", benefitTypeName: "Late", benefitTypeSequence: 20 },
      { id: "benefit-medical", name: "Medical", benefitType: "early", benefitTypeName: "Early", benefitTypeSequence: 1, benefitTypeShowOnEnrollmentWizards: true },
      { id: "benefit-second", name: "A second benefit", benefitType: "early", benefitTypeName: "Early", benefitTypeSequence: 1 },
    ];
    await renderPage(Page);
    await click("button-create-election");
    await waitFor(() => expect(byTestId("heading-benefit-type-early").textContent).toBe("Early"));

    const headings = [...container!.querySelectorAll('[data-testid^="heading-benefit-type-"]')];
    expect(headings.map((node) => node.textContent)).toEqual(["Early", "Late", "Other"]);
    expect(container?.querySelector('[data-testid="checkbox-benefit-benefit-dental"]')).toBeNull();
    expect(container?.querySelector('[data-testid="heading-benefit-type-hidden"]')).toBeNull();
    expect(byTestId("heading-benefit-type-early").parentElement?.textContent).toContain("A second benefitMedical");
    expect(byTestId("heading-benefit-type-__other__").parentElement?.textContent).toContain("Missing type record");
    expect(byTestId("heading-benefit-type-__other__").parentElement?.textContent).toContain("No type");
    expect(byTestId<HTMLInputElement>("checkbox-benefit-benefit-medical").checked).toBe(true);
    expect(byTestId<HTMLInputElement>("checkbox-benefit-benefit-unset").checked).toBe(true);
    expect(byTestId<HTMLInputElement>("checkbox-benefit-benefit-untyped").checked).toBe(true);
    expect(byTestId<HTMLInputElement>("checkbox-relation-relation-spouse").checked).toBe(true);

    await act(async () => {
      byTestId<HTMLInputElement>("checkbox-benefit-benefit-second").click();
    });
    await click("button-save");
    await waitFor(() => expect(apiRequest).toHaveBeenCalled());
    expect(apiRequest.mock.calls[0][2]).toMatchObject({
      benefitIds: ["benefit-medical", "benefit-unset", "benefit-untyped", "benefit-second"],
      relationshipIds: ["relation-spouse"],
    });
  });
});

it("keeps carry-forward selections until benefit metadata arrives, then filters hidden types", async () => {
  let release!: () => void;
  benefitsGate = new Promise<void>((resolve) => { release = resolve; });
  benefitOptions = [
    { id: "benefit-medical", name: "Medical", benefitType: "visible", benefitTypeName: "Visible" },
    { id: "benefit-dental", name: "Dental", benefitType: "hidden", benefitTypeName: "Hidden", benefitTypeShowOnEnrollmentWizards: false },
  ];
  electionHistory = [{
    ...newestElection,
    benefitIds: ["benefit-medical", "benefit-dental"],
  }];
  await renderPage(ElectionsListPage);
  await click("button-create-election");
  expect(byTestId<HTMLButtonElement>("button-save").disabled).toBe(true);
  await waitFor(() => expect(byTestId<HTMLInputElement>("checkbox-relation-relation-spouse").checked).toBe(true));
  await act(async () => { release(); });
  await waitFor(() => expect(byTestId<HTMLInputElement>("checkbox-benefit-benefit-medical").checked).toBe(true));
  expect(container?.querySelector('[data-testid="checkbox-benefit-benefit-dental"]')).toBeNull();
  await click("button-save");
  await waitFor(() => expect(apiRequest).toHaveBeenCalled());
  expect(apiRequest.mock.calls[0][2]).toMatchObject({
    benefitIds: ["benefit-medical"],
    relationshipIds: ["relation-spouse"],
  });
});

it("drops a selected benefit when its type is hidden while the create form is open", async () => {
  benefitOptions = [
    { id: "benefit-medical", name: "Medical", benefitType: "medical", benefitTypeName: "Medical", benefitTypeShowOnEnrollmentWizards: true },
    { id: "benefit-dental", name: "Dental" },
  ];
  await renderPage(ElectionsCurrentPage);
  await openElectionDialog();
  benefitOptions = [
    { ...benefitOptions[0], benefitTypeShowOnEnrollmentWizards: false },
    benefitOptions[1],
  ];
  await act(async () => {
    await testQueryClient.invalidateQueries({ queryKey: ["/api/trust-benefits"] });
  });
  await waitFor(() => expect(container?.querySelector('[data-testid="checkbox-benefit-benefit-medical"]')).toBeNull());
  await click("button-save");
  await waitFor(() => expect(apiRequest).toHaveBeenCalled());
  expect(apiRequest.mock.calls[0][2]).toMatchObject({ benefitIds: [], relationshipIds: ["relation-spouse"] });
});

it("leaves the edit election checklist and submitted selections unchanged", async () => {
  benefitOptions = [
    { id: "benefit-medical", name: "Medical", benefitType: "hidden", benefitTypeName: "Hidden", benefitTypeShowOnEnrollmentWizards: false },
    { id: "benefit-dental", name: "Dental" },
  ];
  await renderPage(
    () => <ElectionForm mode="edit" workerId="worker-1" election={newestElection as WorkerTrustElection} />,
    false,
  );
  await waitFor(() => expect(byTestId<HTMLInputElement>("checkbox-benefit-benefit-medical").checked).toBe(true));
  expect(container?.querySelector('[data-testid^="heading-benefit-type-"]')).toBeNull();
  await click("button-save");
  await waitFor(() => expect(apiRequest).toHaveBeenCalled());
  expect(apiRequest).toHaveBeenCalledWith(
    "PATCH",
    "/api/trust-elections/newest",
    expect.objectContaining({ benefitIds: ["benefit-medical"], relationshipIds: ["relation-spouse"] }),
  );
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
