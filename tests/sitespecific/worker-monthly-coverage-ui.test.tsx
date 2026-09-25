import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const query = vi.hoisted(() => ({ useInfiniteQuery: vi.fn() }));
vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...await importOriginal<typeof import("@tanstack/react-query")>(),
  useInfiniteQuery: query.useInfiniteQuery,
}));

import { WorkerMonthlyCoverageHistory } from "../../client/src/pages/worker-monthly-coverage-history";

describe("worker monthly coverage presentation", () => {
  it("labels gaps unknown without inventing benefits or a charge field", () => {
    query.useInfiniteQuery.mockReturnValue({
      data: { pages: [{
        total: 1, showCharges: false, partial: false,
        months: [{
          coverageMonth: { year: 2024, month: 1, label: "January 2024" },
          workMonth: { year: 2023, month: 10, label: "October 2023" },
          employerHours: [{ employerId: "employer", employerName: "Employer Name", reported: 88.25 }],
          hours: { reported: 88.25, required: 100 },
          status: "unknown", reasons: [], medical: [], dental: [], other: [], charge: null,
        }],
      }] },
      isPending: false, isError: false, hasNextPage: false,
    });
    const html = renderToStaticMarkup(<WorkerMonthlyCoverageHistory workerId="worker-a" />);
    expect(html).toContain("January 2024");
    expect(html).toContain("Work month — October 2023");
    expect(html).toContain("Employer Name");
    expect(html).toContain("Total reported across employers:");
    expect(html).toContain("88.25 hours");
    expect(html).toContain("Applicable threshold:");
    expect(html).toContain("The total is below the hours threshold");
    expect(html).toContain("not the coverage decision");
    expect(html).toContain("sm:grid-cols-2");
    expect(html).toContain("Not confirmed");
    expect(html).toContain("No recorded medical benefit");
    expect(html).not.toContain("Posted EE-fund benefit charge");
    expect(query.useInfiniteQuery.mock.calls[0][0].queryKey).toContain("worker-a");
  });

  it("shows partial data and posted charges only when historical balance exists", () => {
    query.useInfiniteQuery.mockReturnValue({
      data: { pages: [{
        total: 1, showCharges: true, partial: true,
        months: [{
          coverageMonth: { year: 2024, month: 2, label: "February 2024" },
          workMonth: { year: 2023, month: 11, label: "November 2023" },
          employerHours: [
            { employerId: "employer-a", employerName: "Employer A", reported: 12.25 },
            { employerId: "unknown", employerName: "Unknown employer (unknown)", reported: 10.5 },
          ],
          hours: null, status: "inactive", reasons: ["Low Hours", "Unpaid Employee Contributions"],
          medical: ["Medical A", "Medical B"], dental: ["Dental A"],
          other: ["Vision"], charge: "0.00",
        }],
      }] },
      isPending: false, isError: false, hasNextPage: true, isFetchingNextPage: false,
    });
    const html = renderToStaticMarkup(<WorkerMonthlyCoverageHistory workerId="worker-b" />);
    expect(html).toContain("Some coverage details are unavailable");
    expect(html).toContain("Posted EE-fund benefit charge");
    expect(html).toContain("$0.00");
    expect(html).toContain("Medical A, Medical B");
    expect(html).toContain("Dental A");
    expect(html).toContain("Employer A");
    expect(html).toContain("Unknown employer (unknown)");
    expect(html).toContain("Total reported across employers:");
    expect(html).toContain("Applicable threshold:");
    expect(html).toContain("Other recorded benefits:");
    expect(html).toContain("Vision");
    expect(html).toContain("Low Hours · Unpaid Employee Contributions");
    expect(html).toContain("Load older months");
  });

  it("reports loading, empty, and failed reads clearly", () => {
    query.useInfiniteQuery.mockReturnValue({ isPending: true, isError: false });
    expect(renderToStaticMarkup(<WorkerMonthlyCoverageHistory workerId="w" />)).toContain("Loading monthly coverage history");
    query.useInfiniteQuery.mockReturnValue({
      isPending: false, isError: false, data: { pages: [{ months: [], total: 0, partial: false, showCharges: false }] },
    });
    expect(renderToStaticMarkup(<WorkerMonthlyCoverageHistory workerId="w" />)).toContain("No monthly coverage");
    query.useInfiniteQuery.mockReturnValue({ isPending: false, isError: true });
    expect(renderToStaticMarkup(<WorkerMonthlyCoverageHistory workerId="w" />)).toContain("Monthly coverage history is unavailable");
  });
});