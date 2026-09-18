import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import S1MigrationDashboard from "@/pages/config/s1-migration";

vi.mock("@/contexts/PageTitleContext", () => ({ usePageTitle: () => {} }));

const runsKey = ["/api/s1-migration/runs"];
const parityRuns = ["balance", "month"].map((kind, index) => ({
  id: index + 1,
  startedAt: "2026-09-18T10:00:00Z",
  finishedAt: "2026-09-18T10:01:00Z",
  args: { harness: `verify-${kind}-parity` },
  report: { result: index === 0 ? "PASS" : "FAIL" },
}));

function client() {
  const q = new QueryClient({
    defaultOptions: { queries: { retry: false, retryOnMount: false, staleTime: Infinity, gcTime: Infinity } },
  });
  q.setQueryData(["/api/s1-migration/status"], {
    stagingPresent: false, bundles: [], idMap: [], target: {},
  });
  q.setQueryData(["/api/s1-migration/collisions"], {
    stagingPresent: false, idMapPresent: false, decisions: [],
  });
  return q;
}

function render(q: QueryClient) {
  return renderToStaticMarkup(
    createElement(QueryClientProvider, { client: q }, createElement(S1MigrationDashboard)),
  );
}

async function failRead(q: QueryClient) {
  await expect(q.fetchQuery({
    queryKey: runsKey,
    staleTime: 0,
    queryFn: async () => { throw new Error("read failed"); },
  })).rejects.toThrow("read failed");
}

function parityChecks(html: string) {
  return ["balance", "month"].map((kind) => {
    const check = html.match(new RegExp(`<li[^>]*data-testid="check-${kind}-parity"[\\s\\S]*?</li>`));
    expect(check).not.toBeNull();
    return check![0];
  });
}

describe("migration run-history read states", () => {
  it("does not turn an initial read failure into empty history or not-yet-run parity", async () => {
    const q = client();
    await failRead(q);
    const html = render(q);
    expect(html).toContain("Could not load run history.");
    expect(html).not.toContain("No runs recorded yet.");
    expect(html).not.toContain("not yet run");
    for (const check of parityChecks(html)) {
      expect(check).toContain("Readiness unknown");
      expect(check).toContain("lucide-circle-minus");
    }
    q.clear();
  });

  it("keeps cached reports visible but does not treat their PASS or FAIL as current readiness", async () => {
    const q = client();
    q.setQueryData(runsKey, { stagingPresent: true, runs: parityRuns });
    await failRead(q);
    const html = render(q);
    expect(html).toContain("Cached history is stale");
    expect(html).toContain('data-testid="row-run-1"');
    expect(html).toContain('data-testid="row-run-2"');
    const checks = parityChecks(html);
    expect(checks[0]).toContain("Stale cached result: PASS");
    expect(checks[1]).toContain("Stale cached result: FAIL");
    for (const check of checks) {
      expect(check).toContain("Readiness unknown");
      expect(check).toContain("lucide-circle-minus");
    }
    q.clear();
  });

  it("does not present cached empty history as a successful empty read", async () => {
    const q = client();
    q.setQueryData(runsKey, { stagingPresent: true, runs: [] });
    await failRead(q);
    const html = render(q);
    expect(html).toContain("Cached history is stale");
    expect(html).not.toContain("No runs recorded yet.");
    expect(html).not.toContain("not yet run");
    q.clear();
  });

  it("preserves the successful empty state", () => {
    const q = client();
    q.setQueryData(runsKey, { stagingPresent: true, runs: [] });
    const html = render(q);
    expect(html).toContain("No runs recorded yet.");
    expect(html).not.toContain('data-testid="run-history-read-error"');
    for (const check of parityChecks(html)) expect(check).toContain("not yet run");
    q.clear();
  });

  it("clears the warning and restores parity readiness after a successful retry", async () => {
    const q = client();
    q.setQueryData(runsKey, { stagingPresent: true, runs: parityRuns });
    await failRead(q);
    await q.fetchQuery({
      queryKey: runsKey,
      queryFn: async () => ({ stagingPresent: true, runs: parityRuns }),
      staleTime: 0,
    });
    const html = render(q);
    expect(html).not.toContain('data-testid="run-history-read-error"');
    expect(html).not.toContain("Readiness unknown");
    expect(html).not.toContain("Stale cached result");
    const checks = parityChecks(html);
    expect(checks[0]).toContain("lucide-circle-check");
    expect(checks[0]).toContain("PASS at");
    expect(checks[1]).toContain("lucide-circle-x");
    expect(checks[1]).toContain("FAIL at");
    q.clear();
  });
});