import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WmbScanStatus } from "@/plugins/dashboard/wmb-scan-status/WmbScanStatus";

const fixture = vi.hoisted(() => ({ statuses: [] as Record<string, unknown>[] }));

vi.mock("@/plugins/dashboard/useDashboardContent", () => ({
  useDashboardContent: () => ({ data: { statuses: fixture.statuses }, isLoading: false }),
}));

vi.mock("wouter", () => ({
  Link: ({ children, ...props }: any) => createElement("a", props, children),
}));

describe("Benefits Scan Status links", () => {
  beforeEach(() => {
    fixture.statuses = [];
  });

  it.each(["running", "queued", "completed"])("links a %s scan to the registered detail route", (status) => {
    const now = new Date();
    fixture.statuses = [{
      id: "fictional-scan",
      month: now.getMonth() + 1,
      year: now.getFullYear(),
      status,
      totalQueued: 10,
      processedSuccess: 2,
      processedFailed: 0,
      benefitsStarted: 2,
      benefitsContinued: 0,
      benefitsTerminated: 0,
    }];
    const html = renderToStaticMarkup(createElement(WmbScanStatus, {} as any));
    expect(html).toContain('href="/admin/wmb-scan/fictional-scan"');
    expect(html).not.toContain("/admin/wmb-scan-detail/");
    expect(html).toContain('href="/admin/wmb-scan-queue"');

    const router = readFileSync(new URL("../../client/src/App.tsx", import.meta.url), "utf8");
    expect(router).toContain('<Route path="/admin/wmb-scan/:id">');
    expect(router).toContain('<Route path="/admin/wmb-scan-queue">');
  });

  it("keeps the empty-state management link pointing to the scan queue", () => {
    const html = renderToStaticMarkup(createElement(WmbScanStatus, {} as any));
    expect(html).toContain("No active or scheduled scans");
    expect(html).toContain('href="/admin/wmb-scan-queue"');
  });
});
