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
  tags: [{ id: "tag", name: "SPD tag" }], memberStatuses: [], benefits: [], employers: [], employerTypes: [],
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
    expect(failed).not.toContain("0 expected");
  });
});
