import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { workerCommsDefinitionSchema, type WorkerCommsDefinition, type WorkerCommsOptions } from "../../shared/worker-comms-compliance";

const state = vi.hoisted(() => ({
  search: "definitionId=def&view=without",
  dashboard: {} as { data?: unknown; isLoading?: boolean; isError?: boolean },
}));
vi.mock("wouter", () => ({
  useLocation: () => ["/workers/comms-compliance", vi.fn()],
  useSearch: () => state.search,
  Link: ({ href, children, ...props }: any) => <a href={href} {...props}>{children}</a>,
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/components/layout/PageHeader", () => ({ PageHeader: ({ title, actions }: any) => <header><h1>{title}</h1>{actions}</header> }));
vi.mock("@/components/bulk/list-bulk-action", () => ({
  ListBulkAction: ({ reportSelection }: any) => <div data-testid="bulk-handoff">{JSON.stringify(reportSelection)}</div>,
}));
vi.mock("@/plugins/dashboard/useDashboardContent", () => ({
  useDashboardContent: () => ({ ...state.dashboard, refetch: vi.fn(), isFetching: false }),
}));
import CompliancePage from "../../client/src/pages/worker-comms-compliance";
import { CommsDefinitionEditor } from "../../client/src/components/workers/comms-definition-editor";
import { WorkerCommsCompliance as Widget } from "../../client/src/plugins/dashboard/worker-comms-compliance/WorkerCommsCompliance";

const definition: WorkerCommsDefinition = {
  ...workerCommsDefinitionSchema.parse({
    name: "October SPD", commTagId: "tag", statuses: ["delivered", "offline"], medium: "postal",
    sentFrom: "2026-10-01", sentThrough: "2026-10-31", population: {},
  }), id: "def",
};
const options: WorkerCommsOptions = {
  tags: [{ id: "tag", name: "SPD tag" }], memberStatuses: [], benefits: [{ id: "medical", name: "Medical" }], employers: [], employerTypes: [],
  bargainingUnits: [], representatives: [], benefitsEnabled: false, bargainingUnitsEnabled: false,
  politicalEnabled: false, canManage: false, canBulk: false,
};
function renderPage(overrides: Partial<WorkerCommsOptions> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(["/api/worker-comms-compliance/definitions"], [definition]);
  client.setQueryData(["/api/worker-comms-compliance/options"], { ...options, ...overrides });
  client.setQueryData(["/api/worker-comms-compliance/report", JSON.stringify(definition), "without", 1, 50], {
    definition, counts: { population: 12, with: 7, without: 5 }, total: 5, page: 1, pageSize: 50, benefitMonth: "2026-10",
    rows: [{ workerId: "w", contactId: "c", siriusId: 9, name: "Example Worker", commId: null, sent: null, status: null, medium: null }],
  });
  const markup = renderToStaticMarkup(<QueryClientProvider client={client}><CompliancePage /></QueryClientProvider>);
  client.clear();
  return markup;
}

describe("worker compliance presentation", () => {
  beforeEach(() => { state.search = "definitionId=def&view=without"; state.dashboard = {}; });
  it("renders the URL-selected missing view, worker evidence and explicit qualification criteria", () => {
    const html = renderPage();
    expect(html).toContain("Example Worker");
    expect(html).toContain("SPD tag");
    expect(html).toContain("Delivered, Offline");
    expect(html).toContain("Benefit history: No benefit restriction");
    expect(html).toContain("Reference month: October 2026");
    expect(html).not.toContain("Current benefit month:");
    expect(html).toContain("month granularity");
    expect(html).toContain("2026-10-01");
    expect(html).toContain("2026-10-31");
    expect(html).toContain("/workers/w/comm/history");
    expect(html).toContain("No matching record");
    expect(html).not.toContain('data-testid="bulk-handoff"');
    expect(html).not.toContain("New definition");
  });
  it("only offers bulk handoff/manage controls for the corresponding capabilities", () => {
    const html = renderPage({ canBulk: true, canManage: true });
    expect(html).toContain('data-testid="bulk-handoff"');
    expect(html).toContain("&quot;definitionId&quot;:&quot;def&quot;");
    expect(html).toContain("&quot;view&quot;:&quot;without&quot;");
    expect(html).toContain("New definition");
  });
  it("keeps unavailable saved population selections visible and explicitly clearable", () => {
    const value = { ...definition, population: { ...definition.population, benefitIds: ["unavailable-benefit"], bargainingUnitId: "unit" } };
    const html = renderToStaticMarkup(<CommsDefinitionEditor definition={value} options={options} onSave={vi.fn()} onCancel={vi.fn()} />);
    expect(html).toContain("unavailable-benefit");
    expect(html).toContain("Remove unavailable choice unavailable-benefit");
    expect(html).toContain("Clear saved choice");
    expect(html).toContain("Offline");
  });
  it("renders the four benefit-history modes and only the active mode fields", () => {
    const withBenefit = {
      ...definition,
      population: { ...definition.population, benefitIds: ["medical"] },
    };
    const current = renderToStaticMarkup(<CommsDefinitionEditor definition={withBenefit} options={options} onSave={vi.fn()} onCancel={vi.fn()} />);
    expect(current).toContain("Benefit history period");
    expect(current).toContain("Current benefit month");
    expect(current).toContain("Ever through reference month");
    expect(current).toContain("Last N months");
    expect(current).toContain("Date range");
    expect(current).not.toContain('id="benefit-lookback-months"');
    expect(current).not.toContain('id="benefit-from"');

    const lookbackDefinition = {
      ...withBenefit,
      population: { ...withBenefit.population, benefitPeriod: { mode: "lookback" as const, months: 6 } },
    };
    const lookback = renderToStaticMarkup(<CommsDefinitionEditor definition={lookbackDefinition} options={options} onSave={vi.fn()} onCancel={vi.fn()} />);
    expect(lookback).toContain('id="benefit-lookback-months"');
    expect(lookback).toContain("The last N months includes the current month plus the N−1 preceding months.");
    expect(lookback).not.toContain('id="benefit-from"');

    const rangeDefinition = {
      ...withBenefit,
      population: { ...withBenefit.population, benefitPeriod: { mode: "range" as const, from: "2025-01-15", through: "2025-03-02" } },
    };
    const range = renderToStaticMarkup(<CommsDefinitionEditor definition={rangeDefinition} options={options} onSave={vi.fn()} onCancel={vi.fn()} />);
    expect(range).toContain('id="benefit-from"');
    expect(range).toContain('value="2025-01-15"');
    expect(range).toContain('id="benefit-through"');
    expect(range).toContain("Any selected benefit in any included month is enough to match.");
    expect(range).toContain("communication sent dates above are a separate filter");
  });
  it("defaults legacy benefit definitions to current period and omits the period when no benefits are selected", () => {
    const legacyWithBenefit = {
      ...definition,
      population: { ...definition.population, benefitIds: ["medical"], benefitPeriod: undefined },
    };
    const markup = renderToStaticMarkup(<CommsDefinitionEditor definition={legacyWithBenefit} options={options} onSave={vi.fn()} onCancel={vi.fn()} />);
    expect(markup).toContain('id="benefit-period-mode"');
    expect(markup).toContain("Current benefit month");

    const noBenefits = renderToStaticMarkup(<CommsDefinitionEditor definition={definition} options={options} onSave={vi.fn()} onCancel={vi.fn()} />);
    expect(noBenefits).toContain("With no benefits selected, benefits do not restrict the population.");
    expect(noBenefits).not.toContain('id="benefit-period-mode"');
  });
  it("distinguishes an empty widget from a failed calculation and links to the report", () => {
    state.dashboard = { data: { definitions: [], benefitMonth: "2026-10" } };
    const empty = renderToStaticMarkup(<Widget userId="staff" userRoles={[]} />);
    expect(empty).toContain("No definitions yet");
    expect(empty).toContain('href="/workers/comms-compliance"');
    state.dashboard = { data: { definitions: [{ definition, tagName: "SPD tag", counts: null, error: "Cannot evaluate definition" }], benefitMonth: "2026-10" } };
    const failed = renderToStaticMarkup(<Widget userId="staff" userRoles={[]} />);
    expect(failed).toContain("Cannot evaluate definition");
    expect(failed).toContain("SPD tag");
    expect(failed).toContain("Delivered, Offline");
    expect(failed).toContain("view=without");
    expect(failed).toContain("Reference month · October 2026");
    expect(failed).toContain("Benefit history: No benefit restriction");
    expect(failed).not.toContain("0 expected");
  });
  it("uses each dashboard definition's resolved history period instead of treating the global month as its period", () => {
    const withBenefit = { ...definition, population: { ...definition.population, benefitIds: ["medical"] } };
    state.dashboard = {
      data: {
        definitions: [{
          definition: withBenefit,
          tagName: "SPD tag",
          counts: { population: 12, with: 7, without: 5 },
          benefitPeriod: { mode: "lookback", fromMonth: "2026-08", throughMonth: "2026-10", referenceMonth: "2026-10", label: "Last 3 months, including current: 2026-08 through 2026-10" },
        }],
        benefitMonth: "2026-10",
      },
    };
    const html = renderToStaticMarkup(<Widget userId="staff" userRoles={[]} />);
    expect(html).toContain("Reference month · October 2026");
    expect(html).toContain("Benefit history: Last 3 months, including current: 2026-08 through 2026-10");
    expect(html).toContain("Any selected benefit in any included month matches");
  });
});
