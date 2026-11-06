// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  staff: false, access: true, checking: false, accessError: false,
  navigate: vi.fn(), create: vi.fn(async () => ({ id: "new-draft" })),
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ hasPermission: () => state.staff }) }));
vi.mock("@/hooks/use-access-check", () => ({
  useAccessCheck: () => ({ canAccess: state.access, isLoading: state.checking, isError: state.accessError }),
}));
vi.mock("@/components/layouts/WorkerLayout", () => ({
  WorkerLayout: ({ children }: any) => children,
  useWorkerLayout: () => ({ worker: { id: "own-worker" } }),
}));
vi.mock("wouter", () => ({
  Link: ({ children }: any) => <span>{children}</span>,
  useLocation: () => ["/workers/own-worker/elections/current", state.navigate],
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/lib/queryClient", () => ({
  apiRequest: state.create, queryClient: { invalidateQueries: vi.fn() },
}));
vi.mock("@/components/trust/ElectionFormDialog", () => ({
  ElectionFormDialog: () => <div data-testid="manual-election-dialog" />,
}));
vi.mock("@/components/wizards/WizardLauncher", () => ({
  WizardLauncher: ({ entityId, type }: any) => <button data-testid="cobra-launcher"
    data-entity={entityId} data-type={type}>Elect COBRA Coverage</button>,
}));

import ElectionsCurrentPage from "@/pages/workers/elections-current";
import ElectionsListPage from "@/pages/workers/elections-list";
import WorkerCobraPage from "@/pages/worker-sitespecific-bao-cobra";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;
let client: QueryClient;
let settle: (() => void) | undefined;
let error = false;
let blocked = false;
let pending = false;
const flush = async () => act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
const button = (id: string) => container.querySelector(`[data-testid="${id}"]`) as HTMLButtonElement | null;

beforeEach(() => {
  Object.assign(state, { staff: false, access: true, checking: false, accessError: false });
  vi.clearAllMocks();
  error = false; blocked = false; pending = false; settle = undefined;
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url.endsWith("-eligibility")) {
      if (pending) await new Promise<void>(resolve => { settle = resolve; });
      return new Response(JSON.stringify({ eligible: !blocked, reason: blocked ? "Unavailable for this worker." : undefined }),
        { status: error ? 500 : 200, headers: { "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify(url.endsWith("/current") ? null : []));
  }));
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

describe("COBRA's existing worker launcher", () => {
  async function renderCobra({ elected = false, deadline = "2099-01-01", closed = false, fails = false } = {}) {
    client.setDefaultOptions({ queries: { retry: false, queryFn: async () => {
      if (fails) throw new Error("Case lookup failed");
      return { cases: [{ case: { id: "case", statusClosed: closed, lastDayToElectYmd: deadline,
        electionMadeYmd: elected ? "2026-01-01" : null }, asOfYmd: "2026-11-01", coverage: [], payment: null }] };
    } } });
    await render(WorkerCobraPage);
  }
  it("keeps the worker entity and COBRA type on an electable case", async () => {
    await renderCobra();
    expect(button("cobra-launcher")?.dataset.entity).toBe("own-worker");
    expect(button("cobra-launcher")?.dataset.type).toBe("bao_cobra_enrollment");
  });
  it.each([{ elected: true }, { deadline: "2000-01-01" }, { closed: true }, { fails: true }])(
    "does not offer unverified or unavailable cases: %j", async options => {
      await renderCobra(options);
      expect(button("cobra-launcher")).toBeNull();
    },
  );
});
afterEach(async () => {
  settle?.();
  await act(async () => root.unmount());
  client.clear();
  container.remove();
  vi.unstubAllGlobals();
});
async function render(Page: React.ComponentType) {
  await act(async () => root.render(<QueryClientProvider client={client}><Page /></QueryClientProvider>));
  await flush();
  await flush();
}

describe.each([["Current", ElectionsCurrentPage], ["List", ElectionsListPage]] as const)("%s election self-service", (_name, Page) => {
  it("shows all guided actions to workers without staff controls and sends explicit worker scope", async () => {
    await render(Page);
    for (const id of ["button-enrollment-wizard", "button-open-enrollment-wizard", "button-life-event-wizard"]) {
      expect(button(id)?.disabled).toBe(false);
    }
    expect(button("button-create-election")).toBeNull();
    expect(container.querySelector('[data-testid="manual-election-dialog"]')).toBeNull();
    expect(container.textContent).not.toContain("View detail");
    await act(async () => button("button-enrollment-wizard")!.click());
    expect(state.create).toHaveBeenCalledWith("POST", "/api/wizards", {
      type: "benefit_election_enrollment", entityId: "own-worker", status: "draft",
      data: { launchArguments: { workerId: "own-worker" } },
    });
    expect(state.navigate).toHaveBeenCalledWith("/wizards/new-draft");
  });
  it("retains staff New Election beside guided enrollment", async () => {
    state.staff = true;
    await render(Page);
    expect(button("button-create-election")).not.toBeNull();
    expect(button("button-life-event-wizard")?.disabled).toBe(false);
    expect(container.querySelector('[data-testid="manual-election-dialog"]')).not.toBeNull();
  });
  it("keeps launch disabled throughout lookup failures and explains refusals", async () => {
    error = true;
    await render(Page);
    expect(button("button-enrollment-wizard")?.disabled).toBe(true);
    expect(button("button-open-enrollment-wizard")?.disabled).toBe(true);
    expect(button("button-life-event-wizard")?.disabled).toBe(true);
    expect(container.textContent).toContain("Availability could not be checked");
    expect(state.create).not.toHaveBeenCalled();
    error = false; blocked = true;
    await act(async () => { await client.invalidateQueries(); });
    await flush();
    expect(container.textContent).toContain("Unavailable for this worker.");
    expect(button("button-enrollment-wizard")?.disabled).toBe(true);
  });
  it("does not launch while ownership is pending or refused", async () => {
    state.checking = true;
    await render(Page);
    expect(button("button-enrollment-wizard")).toBeNull();
    expect(container.textContent).toContain("Checking enrollment access");
    state.checking = false; state.access = false;
    await render(Page);
    expect(button("button-enrollment-wizard")).toBeNull();
    expect(state.create).not.toHaveBeenCalled();
  });
  it("never enables launch before an eligibility answer arrives", async () => {
    pending = true;
    await render(Page);
    for (const id of ["button-enrollment-wizard", "button-open-enrollment-wizard", "button-life-event-wizard"]) {
      expect(button(id)?.disabled).toBe(true);
    }
    expect(container.textContent).toContain("Checking availability");
    expect(state.create).not.toHaveBeenCalled();
  });
});
