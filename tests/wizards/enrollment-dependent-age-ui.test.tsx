// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { DependentsStep } from "@/components/wizards/framework/enrollment/DependentsStep";
import {
  ADULT_ENROLLMENT_RELATIONSHIPS, CHILD_ENROLLMENT_RELATIONSHIPS,
} from "@shared/utils/enrollment-dependent-age";

// The full Radix picker is covered in authorized Chromium. A native picker
// here makes date/selection state assertions deterministic without pointer APIs.
vi.mock("@/components/ui/select", () => ({
  Select: ({ value, onValueChange, children }: any) =>
    <select value={value} onChange={event => onValueChange(event.target.value)}>{children}</select>,
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: any) => children,
  SelectItem: ({ value, disabled, children }: any) => <option value={value} disabled={disabled}>{children}</option>,
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/lib/queryClient", async original => ({
  ...await original<typeof import("@/lib/queryClient")>(), apiRequest: vi.fn(async () => ({})),
}));
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const relationTypes = [...CHILD_ENROLLMENT_RELATIONSHIPS, ...ADULT_ENROLLMENT_RELATIONSHIPS]
  .map((name, index) => ({ id: `configured-${index}`, name }));
const dataKey = "/api/wizards/wizard/dispatch/dependents/data";
const props: any = { wizardId: "wizard", step: { id: "dependents" }, data: {
  dependents: [], dependentLookup: { status: "no_match", message: "Fictional new dependent" },
  pendingDocument: { fileId: "doc", fileName: "evidence.pdf" },
} };
const actor = vi.hoisted(() => ({ staff: false }));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ hasPermission: (permission: string) => permission === "staff" && actor.staff }),
}));

describe("immediate dependent DOB form feedback", () => {
  let root: Root, container: HTMLDivElement;
  const button = (id: string) => container.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`)!;
  const text = (id: string) => container.querySelector(`[data-testid="${id}"]`)?.textContent;
  const add = () => button("button-add-dependent");
  async function input(id: string, value: string) {
    await act(async () => {
      const node = container.querySelector<HTMLInputElement>(`[data-testid="${id}"]`)!;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(node, value);
      node.dispatchEvent(new Event("input", { bubbles: true }));
      node.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }
  async function choose(id: string) {
    await act(async () => {
      const node = container.querySelector("select")!;
      node.value = id;
      node.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }
  async function lookup() {
    await act(async () => { button("button-lookup-dependent").click(); });
  }
  async function date(today: string) {
    await act(async () => {
      queryClient.setQueryData([dataKey], { applicationToday: today });
      // Query observers batch notifications on the next timer turn.
      await new Promise(resolve => setTimeout(resolve, 0));
    });
  }
  beforeEach(async () => {
    queryClient.clear();
    actor.staff = false;
    vi.clearAllMocks();
    vi.mocked(apiRequest).mockResolvedValue({});
    vi.spyOn(queryClient, "invalidateQueries").mockResolvedValue();
    queryClient.setQueryData(["/api/options/worker-relation-type"], relationTypes);
    queryClient.setQueryData(["/api/options/gender"], []);
    queryClient.setQueryData([dataKey], { applicationToday: "2026-06-15" });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root.render(
      <QueryClientProvider client={queryClient}><DependentsStep {...props} /></QueryClientProvider>,
    ));
    await input("input-dependent-ssn", "123-45-6789");
    await input("input-dependent-given", "Fictional");
    await input("input-dependent-family", "Dependent");
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove(); queryClient.clear(); vi.restoreAllMocks();
  });

  it.each([
    ["2001-06-16", false, false], ["2001-06-15", true, false],
    ["2000-06-16", true, false], ["2000-06-15", false, true],
    ["1950-01-01", false, true],
  ])("renders the exact birthday cutoff for DOB %s", async (dob, warning, error) => {
    await input("input-dependent-dob", dob);
    await choose("configured-0");
    await lookup();
    expect(!!text("alert-dependent-age-warning")).toBe(warning);
    expect(!!text("alert-dependent-age-error")).toBe(error);
    expect(add().disabled).toBe(error);
    expect(container.querySelectorAll("option:disabled").length).toBe(error ? 5 : 0);
  });
  it.each(CHILD_ENROLLMENT_RELATIONSHIPS)("warns for %s but permits Add until the 26th birthday", async name => {
    await input("input-dependent-dob", "2000-06-16");
    await choose(relationTypes.find(option => option.name === name)!.id);
    await lookup();
    expect(text("alert-dependent-age-warning")).toContain("June 16, 2026");
    expect(add().disabled).toBe(false);
    await date("2026-06-16");
    expect(text("alert-dependent-age-error")).toContain("26 or older");
    expect(add().disabled).toBe(true);
    expect((container.querySelector("select") as HTMLSelectElement).value)
      .toBe(relationTypes.find(option => option.name === name)!.id);
  });
  it.each(ADULT_ENROLLMENT_RELATIONSHIPS)("allows %s at age 26 without warning", async name => {
    await input("input-dependent-dob", "2000-06-15");
    await choose(relationTypes.find(option => option.name === name)!.id);
    await lookup();
    expect(text("alert-dependent-age-warning")).toBeUndefined();
    expect(text("alert-dependent-age-error")).toBeUndefined();
    expect(add().disabled).toBe(false);
  });
  it("keeps DOB/name/document/relationship on refusal, then allows correction without substitution", async () => {
    await input("input-dependent-dob", "2001-06-15");
    await choose("configured-0");
    await lookup();
    vi.mocked(apiRequest).mockRejectedValueOnce(new Error("Server refused this add"));
    await act(async () => { add().click(); });
    expect(text("text-pending-document")).toContain("evidence.pdf");
    expect(container.querySelector<HTMLInputElement>("#dep-given")!.value).toBe("Fictional");
    await input("input-dependent-dob", "2000-06-15");
    expect(text("alert-dependent-age-error")).toContain("26 or older");
    expect(container.querySelector("select")!.value).toBe("configured-0");
    expect(add().disabled).toBe(true);
    await choose("configured-9");
    expect(text("alert-dependent-age-error")).toBeUndefined();
    expect(add().disabled).toBe(true); // the changed DOB still needs rechecking
    await lookup();
    expect(add().disabled).toBe(false);
    await input("input-dependent-ssn", "234-56-7890");
    expect(add().disabled).toBe(true);
  });
  it("rejects empty/future DOBs and stale configured options", async () => {
    await choose("configured-9");
    for (const dob of ["", "2027-01-01"]) {
      await input("input-dependent-dob", dob);
      expect(add().disabled).toBe(true);
      expect(button("button-lookup-dependent").disabled).toBe(true);
    }
    expect(text("alert-dependent-age-error")).toContain("future");
    await input("input-dependent-dob", "2000-06-15");
    await lookup();
    expect(add().disabled).toBe(false);
    await act(async () => {
      queryClient.setQueryData(["/api/options/worker-relation-type"], relationTypes.slice(0, 9));
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    expect(text("alert-dependent-age-error")).toContain("available relationship");
    expect(add().disabled).toBe(true);
  });
  it("requires staff assistance for an unrelated existing person and offers no add controls", async () => {
    await act(async () => root.render(
      <QueryClientProvider client={queryClient}><DependentsStep {...props} data={{
        ...props.data, dependentLookup: { status: "requires_staff", message: "Staff must review this relationship." },
      }} /></QueryClientProvider>,
    ));
    expect(text("alert-dependent-lookup")).toContain("Staff must review this relationship");
    expect(container.querySelector('[data-testid="button-add-dependent"]')).toBeNull();
    expect(container.querySelector('[data-testid="input-dependent-document"]')).toBeNull();
    expect(container.querySelector('[data-testid="select-relation-type"]')).toBeNull();
    expect(apiRequest).not.toHaveBeenCalled();
  });
  it("hides disabled types for workers and blocks a previously selected type after an administrator disables it", async () => {
    await input("input-dependent-dob", "2000-06-15");
    await choose("configured-9");
    await lookup();
    expect(add().disabled).toBe(false);
    await act(async () => {
      queryClient.setQueryData(["/api/options/worker-relation-type"], relationTypes.map(option =>
        option.id === "configured-9" ? {
          ...option, data: { availableToWorkersInElectionWizards: false },
        } : option));
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    expect(container.querySelector('option[value="configured-9"]')).toBeNull();
    expect(container.querySelectorAll('option[value^="configured-"]').length).toBe(relationTypes.length - 1);
    expect(text("alert-dependent-age-error")).toContain("ask staff");
    expect(add().disabled).toBe(true);
    vi.mocked(apiRequest).mockClear();
    await act(async () => add().click());
    expect(apiRequest).not.toHaveBeenCalled();

    actor.staff = true;
    await act(async () => root.render(
      <QueryClientProvider client={queryClient}><DependentsStep {...props} /></QueryClientProvider>,
    ));
    expect(container.querySelector('option[value="configured-9"]')).not.toBeNull();
    expect(add().disabled).toBe(false);
  });
  it("changes leap-day availability on March 1 using only the server's date", async () => {
    await date("2026-02-28");
    await input("input-dependent-dob", "2000-02-29");
    await choose("configured-0");
    await lookup();
    expect(text("alert-dependent-age-warning")).toContain("March 1, 2026");
    expect(add().disabled).toBe(false);
    await date("2026-03-01");
    expect(add().disabled).toBe(true);
    expect(text("alert-dependent-age-error")).toContain("26 or older");
  });
});
