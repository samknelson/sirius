import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const { useQuery } = vi.hoisted(() => ({ useQuery: vi.fn() }));

vi.mock("@tanstack/react-query", () => ({ useQuery }));
vi.mock("wouter", () => ({
  useParams: () => ({ id: "case-1" }),
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("@/hooks/useTabAccess", () => ({
  useBaoCobraCaseTabAccess: () => ({ tabs: [], getActiveRoot: () => undefined }),
}));
vi.mock("@/contexts/PageTitleContext", () => ({ usePageTitle: () => undefined }));

import { BaoCobraCaseLayout } from "../../client/src/components/layouts/BaoCobraCaseLayout";

const caseData = {
  id: "case-1",
  coveredPersonWorkerId: "covered-123",
  subscriberWorkerId: "subscriber-456",
  coveredPersonName: "Covered Person",
};

function render(activeTab: "details" | "edit") {
  return renderToStaticMarkup(
    <BaoCobraCaseLayout activeTab={activeTab}>
      <span>Case content</span>
    </BaoCobraCaseLayout>,
  );
}

describe("COBRA case worker backlink", () => {
  it.each(["details", "edit"] as const)(
    "links the %s page to the covered person's worker, not the subscriber",
    (tab) => {
      useQuery.mockReturnValue({ data: caseData, isLoading: false, error: null });
      const html = render(tab);
      expect(html).toContain('href="/workers/covered-123"');
      expect(html).toContain("View Covered Person&#x27;s Worker Record");
      expect(html).not.toContain("/workers/subscriber-456");
      expect(html).toContain('href="/cobra/cases"');
    },
  );

  it.each([
    { state: "loading", query: { data: undefined, isLoading: true, error: null } },
    { state: "not found", query: { data: undefined, isLoading: false, error: new Error("Not found") } },
    { state: "error with stale case data", query: { data: caseData, isLoading: false, error: new Error("Not found") } },
  ])("keeps the cases link but no worker link when $state", ({ query }) => {
    useQuery.mockReturnValue(query);
    const html = render("details");
    expect(html).not.toContain('href="/workers/');
    expect(html).toContain('href="/cobra/cases"');
  });
});