import { renderToStaticMarkup } from "react-dom/server";
import { Router } from "wouter";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BaoCoverageSummary } from "../../client/src/plugins/dashboard/bao-worker-coverage/BaoWorkerCoverage";
import { BaoWorkerCoverage, BaoWorkerCoverageView } from "../../client/src/plugins/dashboard/bao-worker-coverage/BaoWorkerCoverage";

const dashboardContent = vi.hoisted(() => ({
  result: { data: null as BaoCoverageSummary | null, isLoading: false, isError: false },
}));

vi.mock("../../client/src/plugins/dashboard/useDashboardContent", () => ({
  useDashboardContent: () => dashboardContent.result,
}));

const summary = (overrides: Partial<BaoCoverageSummary> = {}): BaoCoverageSummary => ({
  workerId: "worker/123",
  state: "available",
  current: {
    coverageMonth: { year: 2027, month: 2, label: "February 2027" },
    workMonth: { year: 2026, month: 11, label: "November 2026" },
    hours: { reported: 100, required: 100, thresholdMet: true },
    coverage: "covered",
    causes: { hours: null, balance: null },
  },
  balance: {
    available: true,
    totals: [{ currency: "USD", amount: "0.00", formatted: "$0.00" }],
  },
  future: [
    {
      workMonth: { year: 2026, month: 12, label: "December 2026" },
      coverageMonth: { year: 2027, month: 3, label: "March 2027" },
      hours: { reported: 100, required: 100, thresholdMet: true },
      status: "met",
      deadline: "2027-01-20",
    },
    {
      workMonth: { year: 2027, month: 1, label: "January 2027" },
      coverageMonth: { year: 2027, month: 4, label: "April 2027" },
      hours: { reported: 49.5, required: 100, thresholdMet: false },
      status: "pending",
      deadline: "2027-02-20",
    },
  ],
  ...overrides,
});

function renderWidget(data: BaoCoverageSummary) {
  dashboardContent.result = { data, isLoading: false, isError: false };
  return renderToStaticMarkup(
    <Router hook={() => ["/", () => {}]}>
      <BaoWorkerCoverage userId="worker/123" userRoles={[]} />
    </Router>,
  );
}

describe("BAO worker coverage dashboard widget", () => {
  beforeEach(() => {
    dashboardContent.result = { data: null, isLoading: false, isError: false };
  });

  it("shows actual covered status, months, exact hours and balance without marking a cause", () => {
    const html = renderWidget(summary());
    expect(html).toContain("February 2027");
    expect(html).toContain("November 2026");
    expect(html).toContain("100 hrs");
    expect(html).toContain("$0.00");
    expect(html).toContain('aria-label="Current coverage"');
    expect(html).toContain('aria-label="Future coverage"');
    expect(html).toContain('aria-label="Coverage confirmed"');
    expect(html).not.toContain("Blocking coverage");
  });

  it("emphasizes only confirmed blocking causes, not unknown or merely below-threshold hours", () => {
    const base = summary();
    const hours = renderWidget(summary({
      current: {
        ...base.current, coverage: "not-covered",
        hours: { reported: 99.75, required: 100, thresholdMet: false },
        causes: { hours: true, balance: null },
      },
    }));
    expect(hours).toContain('aria-label="Not covered"');
    expect(hours).toContain("99.75 hrs");
    expect(hours).toContain('data-blocking="hours"');
    expect(hours).not.toContain('data-blocking="balance"');

    const balance = renderWidget(summary({
      current: { ...base.current, coverage: "not-covered", causes: { hours: null, balance: true } },
      balance: { available: true, totals: [{ currency: "USD", amount: "-12.50", formatted: "-$12.50" }] },
    }));
    expect(balance).toContain("-$12.50");
    expect(balance).toContain('data-blocking="balance"');
    expect(balance).not.toContain('data-blocking="hours"');

    const unknown = renderWidget(summary({
      current: { ...base.current, coverage: "not-covered", causes: { hours: false, balance: null } },
    }));
    expect(unknown).not.toContain("Blocking coverage");
  });

  it("keeps future threshold outcomes separate from actual current coverage", () => {
    const base = summary();
    const html = renderWidget(summary({
      current: { ...base.current, coverage: "not-covered", causes: { hours: true, balance: null } },
      future: [
        { ...base.future[0], hours: { reported: 125.25, required: 100, thresholdMet: true }, status: "met" },
        { ...base.future[1], hours: { reported: 100, required: 100, thresholdMet: true }, status: "met" },
      ],
    }));
    expect(html).toContain('aria-label="Not covered"');
    expect(html.match(/aria-label="Hours threshold met"/g)).toHaveLength(2);
    expect(html).toContain("125.25 hrs");
    expect(html).toContain("Reported / required");
    expect(html).toContain("not a current coverage decision");
  });

  it("distinguishes pending, below, stale and unavailable without implying noncoverage", () => {
    const base = summary();
    const future = renderWidget(summary({
      future: [
        { ...base.future[0], status: "pending" },
        { ...base.future[1], status: "below" },
      ],
    }));
    expect(future).toContain('aria-label="Hours threshold pending"');
    expect(future).toContain('aria-label="Hours threshold not met"');
    expect(future).toContain('aria-hidden="true"');
    for (const [coverage, label] of [["stale", "Coverage needs updating"], ["unavailable", "Coverage unavailable"]] as const) {
      const html = renderWidget(summary({ current: { ...base.current, coverage } }));
      expect(html).toContain(`aria-label="${label}"`);
      expect(html).not.toContain('aria-label="Not covered"');
      expect(html).not.toContain("Blocking coverage");
    }
  });

  it("preserves multi-currency balances, empty hours/future, link and contact message in both hosts", () => {
    const base = summary();
    const data = summary({
      current: { ...base.current, hours: null },
      balance: { available: true, totals: [
        { currency: "USD", amount: "4.00", formatted: "$4.00" },
        { currency: "CAD", amount: "3.00", formatted: "$3.00" },
      ] },
      future: [],
    });
    const html = renderWidget(data);
    expect(html).toContain("$4.00, CAD $3.00");
    expect(html).toContain("No future coverage periods to show.");
    expect(html).toContain("Reported:");
    expect(html).toContain("—");
    expect(html).toContain('href="/workers/worker%2F123/employment/monthly"');
    expect(html).toContain("Contact the fund with any questions or concerns.");
    expect(renderToStaticMarkup(
      <Router hook={() => ["/", () => {}]}><BaoWorkerCoverageView data={data} /></Router>,
    )).toContain("No future coverage periods to show.");
  });

  it("preserves loading, error, unlinked and unavailable messages", () => {
    dashboardContent.result = { data: null, isLoading: true, isError: false };
    expect(renderToStaticMarkup(<BaoWorkerCoverage userId="" userRoles={[]} />)).toContain('aria-busy="true"');
    dashboardContent.result = { data: null, isLoading: false, isError: true };
    expect(renderToStaticMarkup(<BaoWorkerCoverage userId="" userRoles={[]} />)).toContain("Coverage information is temporarily unavailable.");
    expect(renderWidget(summary({ state: "unlinked" }))).toContain("Your worker account is not linked");
    expect(renderWidget(summary({ state: "unavailable" }))).toContain("Coverage information is unavailable.");
  });
});