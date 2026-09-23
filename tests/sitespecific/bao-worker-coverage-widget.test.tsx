import { readFile } from "node:fs/promises";
import { renderToStaticMarkup } from "react-dom/server";
import { Router } from "wouter";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BaoCoverageSummary } from "../../client/src/plugins/dashboard/bao-worker-coverage/BaoWorkerCoverage";
import { BaoWorkerCoverage } from "../../client/src/plugins/dashboard/bao-worker-coverage/BaoWorkerCoverage";

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

  it("shows covered current coverage without marking unrelated balances as a cause", () => {
    const html = renderWidget(summary());

    expect(html).toContain("February 2027");
    expect(html).toContain("November 2026");
    expect(html).toContain("100 hrs");
    expect(html).toContain("100 hrs");
    expect(html).toContain("$0.00");
    expect(html).toContain('aria-label="Current coverage"');
    expect(html).toContain('aria-label="Future coverage"');
    expect(html).toContain('title="Coverage confirmed"');
    expect(html).toContain("Coverage confirmed");
    expect(html).not.toContain("is-highlighted");
  });

  it("highlights only the hours cell when hours are a known blocking cause", () => {
    const html = renderWidget(summary({
      current: {
        ...summary().current,
        coverage: "not-covered",
        hours: { reported: 99.75, required: 100, thresholdMet: false },
        causes: { hours: true, balance: null },
      },
    }));

    expect(html).toContain('title="Not covered"');
    expect(html).toContain("99.75 hrs");
    expect(html).toContain("bao-worker-coverage-hours is-highlighted");
    expect(html).not.toContain("bao-worker-coverage-balance is-highlighted");
  });

  it("highlights only the balance cell when balance is a known blocking cause", () => {
    const html = renderWidget(summary({
      current: {
        ...summary().current,
        coverage: "not-covered",
        causes: { hours: null, balance: true },
      },
      balance: {
        available: true,
        totals: [{ currency: "USD", amount: "-12.50", formatted: "-$12.50" }],
      },
    }));

    expect(html).toContain("-$12.50");
    expect(html).toContain("bao-worker-coverage-balance is-highlighted");
    expect(html).not.toContain("bao-worker-coverage-hours is-highlighted");
  });

  it("shows future hours recovery separately from current noncoverage", () => {
    const html = renderWidget(summary({
      current: {
        ...summary().current,
        coverage: "not-covered",
        causes: { hours: true, balance: null },
      },
      future: [
        {
          ...summary().future[0],
          hours: { reported: 125.25, required: 100, thresholdMet: true },
          status: "met",
        },
        {
          ...summary().future[1],
          hours: { reported: 100, required: 100, thresholdMet: true },
          status: "met",
        },
      ],
    }));

    expect(html).toContain('title="Not covered"');
    expect(html.match(/title="Hours threshold met"/g)).toHaveLength(2);
    expect(html).toContain("125.25 hrs");
    expect(html).toContain("is-highlighted");
    expect(html).toContain("bao-worker-coverage-row--met");
  });

  it("distinguishes pending and below future rows with accessible neutral/red statuses", () => {
    const html = renderWidget(summary({
      future: [
        { ...summary().future[0], status: "pending" },
        { ...summary().future[1], status: "below" },
      ],
    }));

    expect(html).toContain("bao-worker-coverage-row--pending");
    expect(html).toContain('title="Hours threshold pending"');
    expect(html).toContain("bao-worker-coverage-row--below");
    expect(html).toContain('title="Hours threshold not met"');
    expect(html).toContain('class="sr-only"');
    expect(html).toContain('aria-hidden="true"');
  });

  it("keeps responsive mobile row markup and the worker monthly-hours footer link", async () => {
    const html = renderWidget(summary());
    const css = await readFile(
      new URL("../../client/src/plugins/dashboard/bao-worker-coverage/bao-worker-coverage.css", import.meta.url),
      "utf8",
    );

    expect(css).toContain("@media(max-width:700px)");
    expect(css).toContain(".bao-worker-coverage-table-head{display:none}");
    expect(css).toContain(".bao-worker-coverage-table-row{grid-template-columns:1fr 1fr");
    expect(css).toContain('content:"Coverage month"');
    expect(html).toContain('href="/workers/worker%2F123/employment/monthly"');
    expect(html).toContain("View your full monthly hours breakdown");
    expect(html).toContain("Contact the fund with any questions or concerns.");
  });
});