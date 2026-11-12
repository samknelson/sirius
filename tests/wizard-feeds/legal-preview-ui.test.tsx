// @vitest-environment jsdom
import React from "react";
import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { LegalPreview } from "../../client/src/plugins/wizards/LegalPreview";
import { LegalProcess } from "../../client/src/plugins/wizards/LegalProcess";

it("renders estimate currency, distinct-worker explanations and unavailable pricing", () => {
  const client = new QueryClient();
  client.setQueryData(["/api/wizards/u/dispatch/preview/data"], { historical: false, forecast: {
    fingerprint: "current", workersWithNewGrants: 2, newWorkers: 1, newGrants: 3,
    existingGrantSkips: 1, knownChargeTotal: "35.00", unpriceableGrants: 1, excludedRows: 0,
    chargeGroups: [],
  } });
  const html = renderToStaticMarkup(<QueryClientProvider client={client}>
    <LegalPreview wizardId="u" wizardType="gbhet_legal_workers_monthly"
      step={{ id: "preview", name: "Preview", kind: "custom", state: "pending" }} />
  </QueryClientProvider>);
  expect(html).toContain("$35.00");
  expect(html).toContain("Distinct workers");
  expect(html).toContain("Some grant pricing is unavailable");
  expect(html).toContain("existing grants skipped");
  expect(html).toContain("button-approve-legal-preview");
});
it("keeps historical uploads viewable without approval or a retroactive estimate", () => {
  const client = new QueryClient();
  client.setQueryData(["/api/wizards/old/dispatch/preview/data"], { historical: true, forecast: null });
  const html = renderToStaticMarkup(<QueryClientProvider client={client}>
    <LegalPreview wizardId="old" wizardType="gbhet_legal_workers_corrections"
      step={{ id: "preview", name: "Preview", kind: "custom", state: "completed" }} />
  </QueryClientProvider>);
  expect(html).toContain("No preview approval is required");
  expect(html).not.toContain("button-approve-legal-preview");
});
it("shows the exact background-processing notice, progress and valid return links", () => {
  const html = renderToStaticMarkup(<QueryClientProvider client={new QueryClient()}>
    <Router ssrPath="/wizards/u">
      <LegalProcess wizardId="u" wizardType="gbhet_legal_workers_monthly"
        step={{ id: "process", name: "Process", kind: "run", state: "in_progress", progress: { status: "in_progress", percentComplete: 42 } }} />
    </Router>
  </QueryClientProvider>);
  expect(html).toContain("You can leave this page. Processing will continue in the background. Return to this upload to check progress and results.");
  expect(html).toContain('href="/employers/monthly-uploads"');
  expect(html).toContain('href="/wizards/u"');
  expect(html).toContain("42");
});
