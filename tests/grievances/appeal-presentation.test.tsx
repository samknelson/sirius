/**
 * BAO appeal-only presentation invariants (UI level, static markup):
 *
 *   - a LEGACY GENERIC grievance opened on the BAO surface is WORDED as an
 *     appeal ("Appeal ID") while KEEPING generic form behavior (the
 *     cardinality choice stays editable so legacy class data is never
 *     coerced),
 *   - the true appeal variant hides the generic creation choices entirely,
 *   - outside BAO the generic form keeps grievance wording,
 *   - the worker and employer tab registries carry the appeal-only label the
 *     tab renderer swaps in when the BAO component is enabled.
 */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// The form reads component flags through useAuth; presentation tests control
// them directly instead of standing up the whole auth provider.
const hasComponentMock = vi.fn((_id: string) => false);
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ hasComponent: hasComponentMock }),
}));

import { GrievanceForm } from "@/components/grievances/grievance-form";
import { getTabTreeForEntity } from "@shared/tabRegistry";
import { APPEAL_ONLY_COMPONENT } from "@shared/schema";

function renderForm(props: Partial<Parameters<typeof GrievanceForm>[0]> = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, enabled: false } },
  });
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <GrievanceForm onSubmit={() => {}} submitLabel="Save" {...props} />
    </QueryClientProvider>,
  );
}

describe("BAO appeal presentation", () => {
  it("words a legacy generic record as an appeal while keeping generic behavior", () => {
    // A legacy generic grievance opened by direct URL on the BAO surface:
    // wording follows the surface, behavior follows the record.
    const html = renderForm({ variant: "grievance", wording: "appeal" });
    expect(html).toContain("Appeal ID");
    expect(html).not.toContain("Grievance ID");
    // Generic behavior preserved: cardinality stays visible and editable.
    expect(html).toContain("Cardinality");
  });

  it("hides generic creation choices on the true appeal variant", () => {
    const html = renderForm({ variant: "appeal" });
    expect(html).toContain("Appeal ID");
    expect(html).not.toContain("Cardinality");
    expect(html).not.toContain(">Status<");
  });

  it("keeps grievance wording outside BAO", () => {
    const html = renderForm({ variant: "grievance" });
    expect(html).toContain("Grievance ID");
    expect(html).not.toContain("Appeal ID");
  });

  it("declares the appeal-only label on the worker and employer grievance tabs", () => {
    for (const entity of ["worker", "employer"] as const) {
      const tab = getTabTreeForEntity(entity).find((t) => t.id === "grievances");
      expect(tab, `${entity} grievances tab`).toBeTruthy();
      expect(tab!.label).toBe("Grievances");
      expect(tab!.appealOnlyLabel).toBe("Appeals");
    }
    void APPEAL_ONLY_COMPONENT; // documented pairing: the renderer keys the swap on this component
  });
});
