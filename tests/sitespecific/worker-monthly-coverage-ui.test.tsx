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
    expect(html).toContain('data-testid="monthly-coverage-card-header"');
    expect(html).toContain("sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]");
    expect(html).toMatch(/>Coverage month<\/p><h3[^>]*>January 2024<\/h3>/);
    expect(html).toMatch(/role="status">Not confirmed<\/span><div class="order-2 min-w-0 text-right sm:order-3"><p[^>]*>Work month<\/p><p[^>]*>October 2023<\/p>/);
    expect(html).not.toContain("Work month — October 2023");
    expect(html).toContain(">Hours by employer</h4>");
    expect(html).toContain("Employer Name");
    expect(html).toContain("Total reported across employers:");
    expect(html).toContain("88.25 hours");
    expect(html).toContain("Applicable threshold:");
    expect(html).toContain("The total is below the hours threshold");
    expect(html).toContain("not the coverage decision");
    expect(html).toContain("sm:grid-cols-2");
    expect(html).toContain("Not confirmed");
    expect(html).toContain('class="rounded-lg border p-4 text-sm bg-background"');
    expect(html.match(/rounded-md border bg-background p-3/g)).toHaveLength(2);
    expect(html).toContain("No recorded medical benefit");
    expect(html).not.toContain("Posted EE-fund benefit charge");
    expect(query.useInfiniteQuery.mock.calls[0][0].queryKey).toContain("worker-a");
  });

  it("renders rows from older responses that omit employer hours", () => {
    query.useInfiniteQuery.mockReturnValue({
      data: { pages: [{
        total: 1, showCharges: false, partial: false,
        months: [{
          coverageMonth: { year: 2024, month: 1, label: "January 2024" },
          workMonth: { year: 2023, month: 10, label: "October 2023" },
          hours: null, status: "unknown", reasons: [],
          medical: ["Legacy medical"], dental: ["Legacy dental"], other: [], charge: null,
        }],
      }] },
      isPending: false, isError: false, hasNextPage: false,
    });

    const html = renderToStaticMarkup(<WorkerMonthlyCoverageHistory workerId="worker-legacy" />);
    expect(html).toContain("Employer hours unavailable.");
    expect(html).toContain("Coverage for January 2024");
    expect(html).toContain('id="monthly-coverage-history"');
    expect(html).toContain("Legacy medical");
    expect(html).toContain("Legacy dental");
    expect(html.match(/lucide-star/g)).toHaveLength(2);
  });

  it("uses a light green card for confirmed active coverage", () => {
    query.useInfiniteQuery.mockReturnValue({
      data: { pages: [{
        total: 1, showCharges: false, partial: false,
        months: [{
          coverageMonth: { year: 2024, month: 3, label: "March 2024" },
          workMonth: { year: 2023, month: 12, label: "December 2023" },
          employerHours: [], hours: null, status: "active", reasons: [],
          medical: [], dental: [], other: [], charge: null,
        }],
      }] },
      isPending: false, isError: false, hasNextPage: false,
    });

    const html = renderToStaticMarkup(<WorkerMonthlyCoverageHistory workerId="worker-active" />);
    expect(html).toContain('class="rounded-lg border p-4 text-sm bg-green-50"');
    expect(html.match(/rounded-md border bg-background p-3/g)).toHaveLength(2);
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
          medicalBenefitIcons: [
            { name: "Medical A", icon: "Stethoscope", color: "#123456" },
            { name: "Medical B", icon: "Stethoscope", color: "#123456" },
          ],
          dentalBenefitIcons: [{ name: "Dental A", icon: "Tooth", color: "#654321" }],
          other: ["Vision", "Life Insurance"],
          otherBenefitIcons: [
            { name: "Vision", icon: "Eye", color: "#246a73" },
            { name: "Life Insurance", icon: "Heart", color: "#ab1234" },
          ],
          charge: "0.00",
        }],
      }] },
      isPending: false, isError: false, hasNextPage: true, isFetchingNextPage: false,
    });
    const html = renderToStaticMarkup(<WorkerMonthlyCoverageHistory workerId="worker-b" />);
    expect(html).toContain("Some coverage details are unavailable");
    expect(html).toContain('class="rounded-lg border p-4 text-sm bg-red-50"');
    expect(html).toContain("Posted EE-fund benefit charge");
    expect(html).toContain("$0.00");
    expect(html).toContain('data-testid="monthly-medical-dental-benefits"');
    expect(html).toContain("Medical A");
    expect(html).toContain("Medical B");
    expect(html).toContain("Dental A");
    expect(html).toContain("lucide-stethoscope");
    expect(html).toContain("lucide-tooth");
    expect(html).not.toContain('<dt class="font-medium">Medical</dt>');
    expect(html).not.toContain('<dt class="font-medium">Dental</dt>');
    expect(html).not.toContain("Medical A, Medical B");
    expect(html).toContain("Employer A");
    expect(html).toContain("Unknown employer (unknown)");
    expect(html).toContain("Total reported across employers:");
    expect(html).toContain("Applicable threshold:");
    expect(html).toContain("Other recorded benefits:");
    expect(html).toContain('aria-label="Other recorded benefits"');
    expect(html).toContain('aria-label="Vision"');
    expect(html).toContain('aria-label="Life Insurance"');
    expect(html).toContain("lucide-eye");
    expect(html).toContain("lucide-heart");
    expect(html).toContain("color:#246a73");
    expect(html).not.toContain("Vision, Life Insurance");
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