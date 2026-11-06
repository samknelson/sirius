// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  create: vi.fn(),
  navigate: vi.fn(),
  toast: vi.fn(),
  invalidateQueries: vi.fn(),
}));

vi.mock("@/components/layouts/WorkerLayout", () => ({
  WorkerLayout: ({ children }: { children: React.ReactNode }) => children,
  useWorkerLayout: () => ({ worker: { id: "worker-123" } }),
}));
vi.mock("wouter", () => ({
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
  useLocation: () => ["/workers/worker-123/sitespecific/bao/disability-credit", state.navigate],
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: state.toast }) }));
vi.mock("@/lib/queryClient", () => ({
  apiRequest: state.create,
  getApiErrorMessage: (error: Error) => error.message,
  queryClient: { invalidateQueries: state.invalidateQueries },
}));
vi.mock("@/components/ui/alert-dialog", () => ({
  AlertDialog: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? <div role="dialog">{children}</div> : null,
  AlertDialogAction: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) =>
    <button {...props}>{children}</button>,
  AlertDialogCancel: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) =>
    <button {...props}>{children}</button>,
  AlertDialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  AlertDialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
}));

import WorkerBaoDcPage from "@/pages/worker-sitespecific-bao-dc";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLDivElement;
let queryClient: QueryClient;

function button(testId: string): HTMLButtonElement {
  const element = container.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`);
  if (!element) throw new Error(`Missing button ${testId}`);
  return element;
}

async function render({ hasOpenCase = false } = {}) {
  queryClient.setQueryData(["/api/workers", "worker-123", "sitespecific/bao/dc"], {
    eligibility: { eligible: true, conditions: ["fmla_months"], fmlaMonthsInWindow: [], activeDenialLetterIds: [] },
    cases: [],
    hasOpenCase,
    yearUsage: {},
    isStaff: true,
  });
  await act(async () => {
    root.render(<QueryClientProvider client={queryClient}><WorkerBaoDcPage /></QueryClientProvider>);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity, staleTime: Infinity },
      mutations: { retry: false },
    },
  });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  queryClient.clear();
  container.remove();
});

describe("worker Disability Credit Start case", () => {
  it("opens the detail page for the case returned by regular creation", async () => {
    let finishCreate!: (result: { id: string }) => void;
    state.create.mockReturnValue(new Promise((resolve) => { finishCreate = resolve; }));
    await render();

    await act(async () => button("button-start-dc-case").click());
    expect(state.create).toHaveBeenCalledWith(
      "POST",
      "/api/workers/worker-123/sitespecific/bao/dc/cases",
      { confirmDuplicate: false },
    );
    expect(state.navigate).not.toHaveBeenCalled();

    await act(async () => finishCreate({ id: "created-case-456" }));
    expect(state.navigate).toHaveBeenCalledWith("/bao/dc/cases/created-case-456");
    expect(state.toast).toHaveBeenCalledWith({ title: "Disability Credit case opened" });
    expect(state.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["/api/workers", "worker-123", "sitespecific/bao/dc"],
    });
  });

  it("opens the returned case after staff confirm the duplicate warning", async () => {
    state.create.mockResolvedValue({ id: "duplicate-case-789" });
    await render({ hasOpenCase: true });

    await act(async () => button("button-start-dc-case").click());
    expect(container.textContent).toContain("Open a second case?");
    expect(state.create).not.toHaveBeenCalled();

    await act(async () => button("button-confirm-duplicate").click());
    expect(state.create).toHaveBeenCalledWith(
      "POST",
      "/api/workers/worker-123/sitespecific/bao/dc/cases",
      { confirmDuplicate: true },
    );
    expect(state.navigate).toHaveBeenCalledWith("/bao/dc/cases/duplicate-case-789");
  });

  it("stays on the worker tab and keeps the error feedback when creation fails", async () => {
    state.create.mockRejectedValue(new Error("Case service unavailable"));
    await render();

    await act(async () => button("button-start-dc-case").click());
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });

    expect(state.navigate).not.toHaveBeenCalled();
    expect(state.toast).toHaveBeenCalledWith({
      title: "Could not open case",
      description: "Case service unavailable",
      variant: "destructive",
    });
  });
});
