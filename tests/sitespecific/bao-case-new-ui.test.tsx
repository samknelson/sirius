// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { apiRequest, mockData } = vi.hoisted(() => ({
  apiRequest: vi.fn().mockResolvedValue({ id: "created" }),
  mockData: {
    statuses: [
      { id: "general-open", name: "General Open", caseTypeId: "general", closed: false },
      { id: "general-closed", name: "General Closed", caseTypeId: "general", closed: true },
      { id: "appeal-open", name: "Appeal Open", caseTypeId: "appeal", closed: false },
    ] as Array<{ id: string; name: string; caseTypeId: string; closed: boolean }>,
  },
}));

vi.mock("wouter", () => ({ useLocation: () => ["/bao/cases/new", vi.fn()] }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@tanstack/react-query", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-query")>("@tanstack/react-query");
  return {
    ...actual,
    useQuery: ({ queryKey }: { queryKey: string[] }) => ({
      data: ({
        "/api/options/bao-case-status": mockData.statuses,
        "/api/options/bao-case-type": [
          { id: "general", name: "General" },
          { id: "appeal", name: "Appeal" },
        ],
      } as Record<string, unknown>)[queryKey[0]] ?? [],
    }),
  };
});
vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>("@/lib/queryClient");
  return { ...actual, apiRequest };
});
vi.mock("@/components/ui/select", () => ({
  Select: ({ value, onValueChange, disabled, children }: {
    value: string; onValueChange: (value: string) => void; disabled?: boolean; children: React.ReactNode;
  }) => <select value={value} disabled={disabled} onChange={(e) => onValueChange(e.target.value)}>{children}</select>,
  SelectTrigger: ({ children }: { children: React.ReactNode }) => children,
  SelectValue: ({ placeholder }: { placeholder?: string }) => <option value="">{placeholder}</option>,
  SelectContent: ({ children }: { children: React.ReactNode }) => children,
  SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => <option value={value}>{children}</option>,
}));

import BaoCaseNewPage from "../../client/src/pages/sitespecific/bao/case-new";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLDivElement;
let queryClient: QueryClient;

function field(label: string): HTMLSelectElement {
  const element = Array.from(container.querySelectorAll("label")).find((node) => node.textContent === label);
  const select = element?.parentElement?.querySelector("select");
  if (!select) throw new Error(`Missing ${label} picker`);
  return select;
}

function choices(label: string): string[] {
  return Array.from(field(label).options).map((option) => option.value).filter(Boolean);
}

async function select(label: string, value: string) {
  await act(async () => {
    const element = field(label);
    element.value = value;
    element.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

async function setDeadline(value: string) {
  await act(async () => {
    const date = container.querySelector<HTMLInputElement>('input[type="date"]')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(date, value);
    date.dispatchEvent(new Event("input", { bubbles: true }));
    date.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

async function refresh() {
  await act(async () => { root.render(<QueryClientProvider client={queryClient}><BaoCaseNewPage /></QueryClientProvider>); });
}

beforeEach(async () => {
  mockData.statuses = [
    { id: "general-open", name: "General Open", caseTypeId: "general", closed: false },
    { id: "general-closed", name: "General Closed", caseTypeId: "general", closed: true },
    { id: "appeal-open", name: "Appeal Open", caseTypeId: "appeal", closed: false },
  ];
  apiRequest.mockClear();
  window.history.replaceState({}, "", "/bao/cases/new?entityId=worker-1&noteId=note-1");
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  await refresh();
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  queryClient.clear();
  container.remove();
});

describe("new BAO case status picker", () => {
  it("offers no status before a type, then only that type's open statuses", async () => {
    expect(field("Status").disabled).toBe(true);
    expect(field("Status").options[0].textContent).toBe("Select a case type first");
    expect(choices("Status")).toEqual([]);

    await select("Case type", "general");
    expect(field("Status").disabled).toBe(false);
    expect(choices("Status")).toEqual(["general-open"]);
    await select("Case type", "appeal");
    expect(choices("Status")).toEqual(["appeal-open"]);
  });

  it("clears on type switch and refuses a status removed or reassigned during a refresh", async () => {
    const save = () => container.querySelector<HTMLButtonElement>("[data-testid=button-save-bao-case]")!;
    await select("Case type", "general");
    await select("Status", "general-open");
    await select("Case type", "appeal");
    expect(field("Status").value).toBe("");
    expect(save().disabled).toBe(true);

    await select("Case type", "general");
    await select("Status", "general-open");
    await setDeadline("2099-01-01");
    expect(save().disabled).toBe(false);
    mockData.statuses = mockData.statuses.map((status) =>
      status.id === "general-open" ? { ...status, caseTypeId: "appeal" } : status);
    await refresh();
    expect(choices("Status")).toEqual([]);
    expect(field("Status").value).toBe("");
    expect(save().disabled).toBe(true);
    expect(apiRequest).not.toHaveBeenCalled();
  });

  it("submits only a currently offered open status and blocks a status closed by a refresh", async () => {
    await select("Case type", "general");
    await select("Status", "general-open");
    await setDeadline("2099-01-01");
    const save = container.querySelector<HTMLButtonElement>("[data-testid=button-save-bao-case]")!;
    expect(save.disabled).toBe(false);
    await act(async () => { save.click(); });
    expect(apiRequest).toHaveBeenCalledWith("POST", "/api/sitespecific/bao/cases", expect.objectContaining({
      caseTypeId: "general", statusId: "general-open",
    }));
    apiRequest.mockClear();

    mockData.statuses = mockData.statuses.map((status) =>
      status.id === "general-open" ? { ...status, closed: true } : status);
    await refresh();
    expect(choices("Status")).toEqual([]);
    expect(field("Status").value).toBe("");
    expect(save.disabled).toBe(true);
    expect(apiRequest).not.toHaveBeenCalled();
  });
});