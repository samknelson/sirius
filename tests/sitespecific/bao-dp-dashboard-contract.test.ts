import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { baoDpSummaryPlugin } from "../../server/plugins/dashboard/plugins/bao-dp-summary";

describe("Domestic Partner monitoring UI contract", () => {
  it("registers a staff-only BAO dashboard plugin with filtered metric links", async () => {
    expect(baoDpSummaryPlugin.requiredPolicy).toBe("staff");
    expect(baoDpSummaryPlugin.requiredComponent).toBe("sitespecific.bao");
    expect(baoDpSummaryPlugin.client?.requiredPermissions).toEqual(["staff", "admin"]);

    const source = await readFile(
      new URL(
        "../../client/src/plugins/dashboard/bao-dp-summary/BaoDpSummary.tsx",
        import.meta.url,
      ),
      "utf8",
    );
    expect(source).toContain('useDashboardContent<DpSummary>("bao-dp-summary")');
    expect(source).toContain("/bao/dp/workers?status=");
    expect(source).toContain('testId="active-workers"');
    expect(source).toContain('testId="total-charge"');
    expect(source).toContain('testId="total-paid"');
    expect(source).toContain('testId="total-balance"');
    expect(source).toContain("link-bao-dp-${testId}");
    expect(source).toContain("link-bao-dp-status-${status}");
    expect(source).toContain("text-bao-dp-summary-empty");
    expect(source).toContain("text-bao-dp-summary-error");
  });

  it("keeps the report filter in the URL and links to the existing worker DP tab", async () => {
    const [pageSource, appSource] = await Promise.all([
      readFile(
        new URL(
          "../../client/src/pages/sitespecific/bao/dp-workers.tsx",
          import.meta.url,
        ),
        "utf8",
      ),
      readFile(new URL("../../client/src/App.tsx", import.meta.url), "utf8"),
    ]);

    expect(pageSource).toContain('get("status")');
    expect(pageSource).toContain("encodeURIComponent(value)");
    expect(pageSource).toContain("<TableHead>Coverage month</TableHead>");
    expect(pageSource).toContain("row.coverageMonth");
    expect(pageSource).toContain(
      "href={`/workers/${row.workerId}/sitespecific/bao/dp`}",
    );
    expect(appSource).toContain('<Route path="/bao/dp/workers">');
    expect(appSource).toContain(
      '<ProtectedRoute permission="staff" component="sitespecific.bao">',
    );
  });
});