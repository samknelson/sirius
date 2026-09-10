import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Router } from "wouter";
import { EntityTabNavigation } from "../client/src/components/shared/EntityTabNavigation";
import type { ResolvedTab } from "../client/src/hooks/useTabAccess";

const primaryTabs: ResolvedTab[] = [
  { id: "details", label: "Details", href: "/records/1", hasChildren: false },
  {
    id: "contact",
    label: "Contact",
    href: "/records/1/email",
    hasChildren: true,
  },
];

const secondaryTabs: ResolvedTab[] = [
  { id: "email", label: "Email", href: "/records/1/email", hasChildren: false },
  { id: "phone", label: "Phone", href: "/records/1/phone", hasChildren: false },
];

function renderNavigation(navigation: React.ReactNode): string {
  return renderToStaticMarkup(<Router ssrPath="/records/1/phone">{navigation}</Router>);
}

describe("EntityTabNavigation", () => {
  it("renders active roots and filtered children with stable, accessible navigation", () => {
    const markup = renderNavigation(
      <EntityTabNavigation
        tabs={primaryTabs}
        activeTab="phone"
        activeRootId="contact"
        subTabs={secondaryTabs}
        testIdPrefix="tab-"
        secondaryTestIdPrefix="subtab-"
        primaryTestId="nav-tabs"
        secondaryTestId="nav-subtabs"
      />,
    );

    expect(markup).toContain('aria-label="Primary record navigation"');
    expect(markup).toContain('aria-label="Secondary record navigation"');
    expect(markup).toContain('data-testid="nav-tabs"');
    expect(markup).toContain('data-testid="nav-subtabs"');
    expect(markup).toMatch(/aria-current="page"[^>]*data-testid="tab-contact"/);
    expect(markup).toMatch(/aria-current="page"[^>]*data-testid="subtab-phone"/);
    expect(markup).toContain('data-testid="tab-details"');
    expect(markup).toContain('href="/records/1"');
    expect(markup).not.toMatch(/<a[^>]*>\s*<button/);
    expect(markup).not.toMatch(/<button[^>]*>\s*<a/);
  });

  it("omits secondary navigation when no children are supplied", () => {
    const markup = renderNavigation(
      <EntityTabNavigation
        tabs={primaryTabs}
        activeTab="details"
        testIdPrefix="button-record-"
      />,
    );

    expect(markup).toMatch(/aria-current="page"[^>]*data-testid="button-record-details"/);
    expect(markup).not.toContain("Secondary record navigation");
  });

  it("preserves the underline appearance without nested interactive elements", () => {
    const markup = renderNavigation(
      <EntityTabNavigation
        tabs={primaryTabs}
        activeTab="email"
        activeRootId="contact"
        subTabs={secondaryTabs}
        appearance="underline"
        testIdPrefix="tab-"
        secondaryTestIdPrefix="subtab-"
      />,
    );

    expect(markup).toContain("border-b-2");
    expect(markup).toMatch(/aria-current="page"[^>]*data-testid="tab-contact"/);
    expect(markup).toMatch(/aria-current="page"[^>]*data-testid="subtab-email"/);
    expect(markup).not.toContain("<button");
  });
});