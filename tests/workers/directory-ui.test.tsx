// @vitest-environment jsdom
import React, { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MultiSelect, type MultiSelectOption } from "../../client/src/components/ui/multi-select";
import { ContextualWorkerFilters } from "../../client/src/components/workers/contextual-worker-filters";
import type { WorkerFilters } from "../../client/src/components/workers/workers-table";
import { normalizeEmployerEmploymentFilters, updateEmployerSelection } from "../../shared/utils/employer-employment-filters";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WorkersTable } from "../../client/src/components/workers/workers-table";

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ hasPermission: () => true }),
}));
vi.mock("@/contexts/TerminologyContext", () => ({
  useTerminology: () => ({ term: (value: string) => value }),
}));

const choices: MultiSelectOption[] = [
  { value: "active", label: "Active", group: "Employed" },
  { value: "leave", label: "Leave", group: "Employed" },
  { value: "former", label: "Former", group: "Not employed" },
];
type EmploymentFilters = {
  employerId?: string;
  employerIds?: string[];
  employmentStatusIds?: string[];
  employmentMode?: "current" | "ever" | "custom";
};

describe("worker directory filter controls", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
    HTMLElement.prototype.scrollIntoView = vi.fn();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  async function click(element: Element | null) {
    if (!element) throw new Error("Expected element was not rendered");
    await act(async () => {
      (element as HTMLElement).click();
      await new Promise(resolve => setTimeout(resolve, 5));
    });
  }

  it("All, None, Invert and metadata groups operate on the full option set", async () => {
    let selected: string[] = [];
    function Harness() {
      const [value, setValue] = useState<string[]>([]);
      selected = value;
      return <MultiSelect options={choices} value={value} onChange={setValue} selectionActions testId="statuses" testIdPrefix="status" />;
    }
    await act(async () => root.render(<Harness />));
    await click(document.querySelector('[data-testid="statuses"]'));
    await click(document.querySelector('[data-testid="statuses-all"]'));
    expect(selected).toEqual(["active", "leave", "former"]);
    await click(document.querySelector('[data-testid="statuses-invert"]'));
    expect(selected).toEqual([]);
    await click(document.querySelector("summary"));
    await click(document.querySelector('[aria-label="Employed: Select all"]'));
    expect(selected).toEqual(["active", "leave"]);
    await click(document.querySelector('[data-testid="status-former"]'));
    expect(selected).toEqual(["active", "leave", "former"]);
    await click(document.querySelector('[aria-label="Employed: Select none"]'));
    expect(selected).toEqual(["former"]);
    await click(document.querySelector('[data-testid="statuses-none"]'));
    expect(selected).toEqual([]);
    await act(async () => {
      const input = document.querySelector("input") as HTMLInputElement;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Former");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click(document.querySelector('[data-testid="statuses-all"]'));
    expect(selected).toEqual(["active", "leave", "former"]);
  });

  it("defaults a first employer to current and clears dependent mode/status when the last employer is removed", async () => {
    let draft: WorkerFilters = {
      employerId: "all", employerIds: [], employerTypeId: "all", bargainingUnitId: "all",
      bargainingUnitIds: [], benefitId: "all", benefitIds: [], contactStatus: "all",
      jobTitle: "", memberStatusId: "all", employmentStatusIds: [], workStatusIds: [],
      representativeIds: [], workStatusActive: "all",
    };
    function Harness() {
      const [filters, setFilters] = useState(draft);
      draft = filters;
      return (
        <ContextualWorkerFilters
          filters={filters} appliedFilters={filters} onChange={setFilters}
          employers={[{ id: "employer-a", name: "Cedar Works", isActive: true, typeId: null } as any]}
          employerTypes={[]} bargainingUnits={[]} benefits={[]} memberStatuses={[]}
          employmentStatuses={[{ id: "leave", name: "Leave", employed: true }]}
          workStatuses={[]} industries={[]} politicalOfficials={[]} fieldReps={[]}
          bargainingUnitsEnabled={false} cardcheckEnabled={false} stewardEnabled={false}
          stewardLabel="Shop Steward" btuEnabled={false} benefitsEnabled={false}
          politicalEnabled={false} enableBenefitRoleFilters={false}
          fieldRepsLoading={false} fieldRepsError={false} onRetryFieldReps={() => {}}
          contactQuery="" appliedContact="" appliedNameId="" onContactChange={() => {}}
          onApply={() => {}} onRemoveApplied={() => {}} onClear={() => {}}
        />
      );
    }
    await act(async () => root.render(<Harness />));
    await click([...document.querySelectorAll("button")].find(button => button.textContent?.includes("Employment")) ?? null);
    await click(document.querySelector('[aria-label="Employers"]'));
    await click(document.querySelector('[data-testid="select-employer-employer-a"]'));
    expect(draft.employerIds).toEqual(["employer-a"]);
    expect(draft.employmentMode).toBe("current");

    await click(document.querySelector('[data-testid="select-employer-employer-a"]'));
    expect(draft.employerIds).toEqual([]);
    expect(draft.employmentMode).toBeUndefined();
    expect(draft.employmentStatusIds).toEqual([]);
  });

  it("keeps filter state on collapse, gates optional sections, and labels applied mode independently of draft", async () => {
    let draft: WorkerFilters = {
      employerId: "all", employerIds: ["employer-a"], employerTypeId: "all", bargainingUnitId: "all",
      bargainingUnitIds: [], benefitId: "all", benefitIds: [], contactStatus: "all",
      jobTitle: "", memberStatusId: "all", employmentStatusIds: [], workStatusIds: [],
      representativeIds: [], workStatusActive: "all", employmentMode: "current",
    };
    let applied = { ...draft };
    function Harness() {
      const [filters, setFilters] = useState(draft);
      const [appliedFilters, setAppliedFilters] = useState(applied);
      draft = filters;
      applied = appliedFilters;
      return (
        <ContextualWorkerFilters
          filters={filters} appliedFilters={appliedFilters} onChange={setFilters}
          employers={[{ id: "employer-a", name: "Cedar Works", isActive: true, typeId: null } as any]}
          employerTypes={[]} bargainingUnits={[]} benefits={[]} memberStatuses={[]}
          employmentStatuses={[]} workStatuses={[]} industries={[]} politicalOfficials={[]}
          fieldReps={[]} bargainingUnitsEnabled={false} cardcheckEnabled={false}
          stewardEnabled={false} stewardLabel="Shop Steward" btuEnabled={false}
          benefitsEnabled={false} politicalEnabled={false} enableBenefitRoleFilters={false}
          fieldRepsLoading={false} fieldRepsError={false} onRetryFieldReps={() => {}}
          contactQuery="" appliedContact="" appliedNameId="" onContactChange={() => {}}
          onApply={() => setAppliedFilters(filters)} onRemoveApplied={() => {}} onClear={() => {}}
        />
      );
    }
    await act(async () => root.render(<Harness />));
    expect(container.textContent).not.toContain("Benefits");
    expect(container.textContent).not.toContain("Political");
    expect(container.textContent).toContain("Currently employed");

    await click([...document.querySelectorAll("button")].find(button => button.textContent?.includes("Employment")) ?? null);
    await click(document.querySelector('[aria-label="Ever worked there"]'));
    expect(draft.employmentMode).toBe("ever");
    expect(container.querySelector('[data-testid="applied-worker-filter-chips"]')?.textContent).toContain("Currently employed");
    expect(container.querySelector('[data-testid="applied-worker-filter-chips"]')?.textContent).not.toContain("Ever worked there");

    await click([...document.querySelectorAll("button")].find(button => button.textContent?.includes("Employment")) ?? null);
    expect(draft.employerIds).toEqual(["employer-a"]);
    await click(container.querySelector('[data-testid="button-apply-worker-filters"]'));
    expect(applied.employmentMode).toBe("ever");
    expect(container.querySelector('[data-testid="applied-worker-filter-chips"]')?.textContent).toContain("Ever worked there");
  });

  it("preserves expanded sections when Apply briefly unmounts the filter panel for loading", async () => {
    function Harness() {
      const [openSections, setOpenSections] = useState(["contact"]);
      const [loading, setLoading] = useState(false);
      const filters: WorkerFilters = {
        employerId: "all", employerIds: [], employerTypeId: "all", bargainingUnitId: "all",
        bargainingUnitIds: [], benefitId: "all", benefitIds: [], contactStatus: "all",
        jobTitle: "", memberStatusId: "all", employmentStatusIds: [], workStatusIds: [],
        representativeIds: [], workStatusActive: "all",
      };
      if (loading) return <div data-testid="workers-loading">Loading results</div>;
      return (
        <ContextualWorkerFilters
          filters={filters} appliedFilters={filters} onChange={() => {}}
          employers={[]} employerTypes={[]} bargainingUnits={[]} benefits={[]} memberStatuses={[]}
          employmentStatuses={[]} workStatuses={[]} industries={[]} politicalOfficials={[]}
          fieldReps={[]} bargainingUnitsEnabled={false} cardcheckEnabled={false}
          stewardEnabled={false} stewardLabel="Shop Steward" btuEnabled={false}
          benefitsEnabled={false} politicalEnabled={false} enableBenefitRoleFilters={false}
          fieldRepsLoading={false} fieldRepsError={false} onRetryFieldReps={() => {}}
          contactQuery="" appliedContact="" appliedNameId="" onContactChange={() => {}}
          openSections={openSections} onOpenSectionsChange={setOpenSections}
          onApply={() => {
            setLoading(true);
            window.setTimeout(() => setLoading(false), 0);
          }}
          onRemoveApplied={() => {}} onClear={() => {}}
        />
      );
    }
    await act(async () => root.render(<Harness />));
    await click([...document.querySelectorAll("button")].find(button => button.textContent?.includes("Employment")) ?? null);
    expect([...document.querySelectorAll("button")].find(button => button.textContent?.includes("Employment"))?.getAttribute("aria-expanded")).toBe("true");
    await click(container.querySelector('[data-testid="button-apply-worker-filters"]'));
    expect(container.querySelector('[data-testid="workers-loading"]')).toBeNull();
    expect([...document.querySelectorAll("button")].find(button => button.textContent?.includes("Employment"))?.getAttribute("aria-expanded")).toBe("true");
  });

  it("retains restored singular employer meaning as ever and normalizes added/removed scopes", () => {
    const restored = normalizeEmployerEmploymentFilters<EmploymentFilters>({
      employerId: "legacy-employer", employmentStatusIds: ["left"],
    });
    expect(restored.employerIds).toEqual(["legacy-employer"]);
    expect(restored.employmentMode).toBe("ever");
    expect(restored.employmentStatusIds).toEqual([]);
    expect(updateEmployerSelection<EmploymentFilters>({ employerIds: [], employmentStatusIds: [] }, ["a"]).employmentMode).toBe("current");
    expect(updateEmployerSelection<EmploymentFilters>({ employerIds: ["a"], employmentMode: "custom", employmentStatusIds: ["leave"] }, ["a", "b"]))
      .toMatchObject({ employmentMode: "custom", employmentStatusIds: ["leave"] });
    expect(updateEmployerSelection<EmploymentFilters>({ employerIds: ["a"], employmentMode: "custom", employmentStatusIds: ["leave"] }, []))
      .toMatchObject({ employmentMode: undefined, employmentStatusIds: [] });
  });
});

describe("worker directory employer summary states", () => {
  let container: HTMLDivElement;
  let root: Root;
  let client: QueryClient;
  const summaryKey = ["/api/workers/employers/summary"];
  const workers = [{
    id: "worker-a", contactId: "contact-a", given: "Fictional", family: "Worker",
    contact_name: "Fictional Worker", denorm_ms_ids: [], denorm_employer_ids: [],
  }] as any;
  const cell = () => container.querySelector('[data-testid="employment-indicators-worker-a"]')!;
  const activeEmployers = [
    { id: "other", name: "Other Works", isHome: false, employmentStatusEmployed: true },
    { id: "terminated", name: "Former Works", isHome: false, employmentStatusEmployed: false },
    { id: "home", name: "Home Works", isHome: true, employmentStatusName: "Leave", employmentStatusEmployed: true },
  ];

  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity, queryFn: async () => [] } },
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    client.clear();
    container.remove();
  });

  async function renderTable() {
    await act(async () => root.render(
      <QueryClientProvider client={client}>
        <WorkersTable workers={workers} isLoading={false} />
      </QueryClientProvider>,
    ));
  }

  async function settle(action: () => void) {
    await act(async () => {
      action();
      await new Promise(resolve => setTimeout(resolve, 10));
    });
  }

  it("shows loading, not None, until a delayed summary returns employed badges in home-first order", async () => {
    let resolve!: (value: unknown) => void;
    client.setQueryDefaults(summaryKey, { queryFn: () => new Promise(done => { resolve = done; }) });
    await renderTable();
    expect(cell().textContent).toBe("Loading employers…");
    expect(cell().querySelector('[role="status"]')).not.toBeNull();
    expect(cell().textContent).not.toContain("None");
    await settle(() => resolve([{ workerId: "worker-a", employers: activeEmployers }]));
    expect([...cell().querySelectorAll('[data-testid^="employment-icon-"]')].map(el => el.getAttribute("data-testid")))
      .toEqual(["employment-icon-home", "employment-icon-other"]);
    expect(cell().textContent).not.toContain("Loading");
    expect(cell().textContent).not.toContain("None");
    expect(cell().querySelector('[data-testid="employment-icon-home"]')?.getAttribute("style")).toContain("34, 197, 94");
  });

  it.each([
    ["empty summary", []],
    ["empty relationships", [{ workerId: "worker-a", employers: [] }]],
    ["terminated relationships only", [{ workerId: "worker-a", employers: [activeEmployers[1]] }]],
  ])("shows None after a successful %s", async (_label, summary) => {
    client.setQueryData(summaryKey, summary);
    await renderTable();
    expect(cell().textContent).toBe("None");
  });

  it.each([false, true])("shows a recoverable failure without claiming None (cached success: %s)", async (cached) => {
    if (cached) client.setQueryData(summaryKey, [{ workerId: "worker-a", employers: [] }]);
    let resolveRetry!: (value: unknown) => void;
    const request = vi.fn()
      .mockRejectedValueOnce(new Error("Summary unavailable"))
      .mockImplementationOnce(() => new Promise(done => { resolveRetry = done; }));
    client.setQueryDefaults(summaryKey, { queryFn: request });
    await renderTable();
    await settle(() => { if (cached) void client.refetchQueries({ queryKey: summaryKey }); });
    expect(cell().textContent).toContain("Employers unavailable");
    expect(cell().textContent).not.toContain("None");
    await settle(() => (cell().querySelector("button") as HTMLButtonElement).click());
    if (cached) {
      expect(cell().textContent).toContain("Retrying…");
      expect((cell().querySelector("button") as HTMLButtonElement).disabled).toBe(true);
    } else {
      expect(cell().textContent).toBe("Loading employers…");
    }
    expect(cell().textContent).not.toContain("None");
    await settle(() => resolveRetry([{ workerId: "worker-a", employers: activeEmployers }]));
    expect(request).toHaveBeenCalledTimes(2);
    expect(cell().textContent).not.toContain("unavailable");
    expect(cell().querySelector('[data-testid="employment-icon-home"]')).not.toBeNull();
  });
});
