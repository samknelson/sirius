// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MonthlyCoveragePage, MonthlyCoverageRow } from "../../client/src/pages/worker-monthly-coverage-history";

const query = vi.hoisted(() => ({ useInfiniteQuery: vi.fn() }));
vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...await importOriginal<typeof import("@tanstack/react-query")>(),
  useInfiniteQuery: query.useInfiniteQuery,
}));

import { WorkerMonthlyCoverageHistory } from "../../client/src/pages/worker-monthly-coverage-history";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

function month(year: number, number: number) {
  return { year, month: number, label: `${new Date(year, number - 1, 1).toLocaleString("en-US", { month: "long" })} ${year}` };
}

function row(year: number, number: number, status: MonthlyCoverageRow["status"], reasons: string[] = []): MonthlyCoverageRow {
  const work = new Date(year, number - 4, 1);
  return {
    coverageMonth: month(year, number),
    workMonth: month(work.getFullYear(), work.getMonth() + 1),
    employerHours: [{ employerId: "a", employerName: "Employer A", reported: 88.25 }],
    hours: { reported: 88.25, required: 100 },
    status, reasons, medical: [], dental: [], other: [], charge: null,
  };
}

function page(months: MonthlyCoverageRow[], total = months.length, extras: Partial<MonthlyCoveragePage> = {}): MonthlyCoveragePage {
  return { months, total, showCharges: false, partial: false, ...extras };
}

function response(pages: MonthlyCoveragePage[], hasNextPage = false, overrides: Record<string, unknown> = {}) {
  query.useInfiniteQuery.mockReturnValue({
    data: { pages }, isPending: false, isError: false, hasNextPage,
    isFetchingNextPage: false, fetchNextPage: vi.fn(), refetch: vi.fn(), ...overrides,
  });
}

async function render() {
  await act(async () => { root.render(<WorkerMonthlyCoverageHistory workerId="worker-a" />); });
}

async function click(element: Element | null) {
  if (!element) throw new Error("Expected clickable element");
  await act(async () => { element.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
}

function runButton(index: number): HTMLButtonElement {
  const buttons = container.querySelectorAll<HTMLButtonElement>("section[aria-label^='Active coverage'], section[aria-label^='Inactive coverage'], section[aria-label^='Unenrolled coverage'], section[aria-label^='Not confirmed coverage']");
  const button = buttons[index]?.querySelector<HTMLButtonElement>("h3 > button");
  if (!button) throw new Error(`Missing run ${index}`);
  return button;
}

beforeEach(() => {
  query.useInfiniteQuery.mockReset();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
});

describe("worker monthly coverage status runs", () => {
  it("starts compact, then opens a run and selects one month with its original evidence", async () => {
    const june = row(2025, 6, "active");
    june.medical = ["Medical A", "Medical B"];
    june.dental = ["Dental A"];
    june.other = ["Vision"];
    june.medicalBenefitIcons = [
      { name: "Medical A", icon: "Stethoscope", color: "#123456" },
      { name: "Medical B", icon: "Stethoscope", color: "#123456" },
    ];
    june.dentalBenefitIcons = [{ name: "Dental A", icon: "Tooth", color: "#654321" }];
    june.otherBenefitIcons = [{ name: "Vision", icon: "Eye", color: "#246a73" }];
    june.charge = "42.00";
    response([page([row(2025, 7, "active"), june], 2, { showCharges: true })]);
    await render();

    expect(runButton(0).textContent).toContain("June 2025 – July 2025");
    expect(runButton(0).textContent).toContain("2 months");
    expect(runButton(0).getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelectorAll('[data-testid="monthly-coverage-card"]')).toHaveLength(0);
    await click(runButton(0));
    expect(runButton(0).getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelectorAll<HTMLButtonElement>('[role="group"] button[aria-pressed]')).toHaveLength(2);
    expect(container.querySelectorAll('[data-testid="monthly-coverage-card"]')).toHaveLength(1);
    const junePicker = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="group"] button')).find((button) => button.textContent?.includes("June 2025"));
    expect(junePicker?.textContent).toContain("Work: March 2025 · 88.25 hours");
    await click(junePicker ?? null);
    expect(junePicker?.getAttribute("aria-pressed")).toBe("true");
    const card = container.querySelector('[data-testid="monthly-coverage-card"]')!;
    expect(card.getAttribute("aria-label")).toBe("Coverage for June 2025");
    expect(card.textContent).toContain("Benefits received for June 2025");
    expect(card.textContent).toContain("Medical A");
    expect(card.textContent).toContain("Dental A");
    expect(card.textContent).toContain("March 2025");
    expect(card.textContent).toContain("Hours by employer");
    expect(card.textContent).toContain("Employer A");
    expect(card.textContent).toContain("Applicable threshold:");
    expect(card.textContent).toContain("$42.00");
    expect(card.querySelector(".lucide-stethoscope")).not.toBeNull();
    expect(card.querySelector(".lucide-tooth")).not.toBeNull();
    expect(card.querySelector('[aria-label="Vision"]')).not.toBeNull();
    await click(runButton(0));
    expect(container.querySelectorAll('[data-testid="monthly-coverage-card"]')).toHaveLength(0);
  });

  it("extends an open run across page boundaries without losing the selected month", async () => {
    const fetchNextPage = vi.fn();
    response([page([row(2025, 5, "active"), row(2025, 4, "active")], 4)], true, { fetchNextPage });
    await render();
    expect(runButton(0).textContent).toContain("Older months have not loaded");
    await click(runButton(0));
    const april = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="group"] button')).find((button) => button.textContent?.includes("April 2025"));
    await click(april ?? null);
    await click(Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Load older months") ?? null);
    expect(fetchNextPage).toHaveBeenCalledOnce();
    response([page([row(2025, 5, "active"), row(2025, 4, "active")], 4),
      page([row(2025, 3, "active"), row(2025, 2, "active")], 4)]);
    await render();
    expect(runButton(0).textContent).toContain("February 2025 – May 2025");
    expect(runButton(0).textContent).toContain("4 months");
    expect(runButton(0).textContent).not.toContain("Older months have not loaded");
    expect(runButton(0).getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelector('[data-testid="monthly-coverage-card"]')?.getAttribute("aria-label")).toBe("Coverage for April 2025");
    expect(container.querySelectorAll('[role="group"] button[aria-pressed]')).toHaveLength(4);
  });

  it("uses Unenrolled only for the sole recorded No Election reason", async () => {
    response([page([
      row(2025, 5, "inactive", ["No Election"]),
      row(2025, 4, "inactive", ["No Election"]),
      row(2025, 3, "inactive", ["No Election", "Low Hours"]),
      row(2025, 2, "unknown"),
      row(2025, 1, "active"),
    ])]);
    await render();
    expect(runButton(0).textContent).toContain("Unenrolled");
    expect(runButton(0).textContent).toContain("April 2025 – May 2025");
    expect(runButton(1).textContent).toContain("Inactive");
    expect(runButton(1).textContent).toContain("No Election · Low Hours");
    expect(runButton(2).textContent).toContain("Not confirmed");
    await click(runButton(0));
    expect(container.querySelector('[data-testid="monthly-coverage-card"]')?.textContent).toContain("Election record: No Election");
    await click(runButton(2));
    expect(container.textContent).toContain("A reliable coverage decision is not available");
  });

  it("keeps unknown rows and legacy missing evidence honest", async () => {
    const unknown = row(2024, 1, "unknown");
    unknown.hours = null;
    unknown.employerHours = undefined;
    unknown.medical = ["Legacy medical"];
    unknown.dental = ["Legacy dental"];
    response([page([unknown])]);
    await render();
    expect(runButton(0).textContent).toContain("Not confirmed");
    await click(runButton(0));
    expect(container.textContent).toContain("Employer hours unavailable.");
    expect(container.textContent).toContain("Legacy medical");
    expect(container.textContent).toContain("Legacy dental");
    expect(container.textContent).not.toContain("Posted EE-fund benefit charge");
    expect(query.useInfiniteQuery.mock.calls[0][0].queryKey).toContain("worker-a");
  });

  it("preserves partial, loading, empty, and failed-read messaging", async () => {
    query.useInfiniteQuery.mockReturnValue({ isPending: true, isError: false });
    await render();
    expect(container.textContent).toContain("Loading monthly coverage history");
    response([page([], 0)]);
    await render();
    expect(container.textContent).toContain("No monthly coverage");
    response([page([row(2024, 2, "inactive", ["Low Hours"])], 1, { partial: true })], true);
    await render();
    expect(container.textContent).toContain("Some coverage details are unavailable");
    expect(container.textContent).toContain("Load older months");
    response([page([row(2024, 2, "inactive")])], false, { isError: true });
    await render();
    expect(container.textContent).toContain("Older months could not be loaded");
    query.useInfiniteQuery.mockReturnValue({ isPending: false, isError: true });
    await render();
    expect(container.textContent).toContain("Monthly coverage history is unavailable");
  });
});