// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { Settings } from "lucide-react";
import type { NavItem, NavSection } from "@/config/navigation-registry";
import { filterConfigSections } from "@/pages/config";

const item = (label: string, path: string): NavItem => ({
  label,
  path,
  icon: Settings,
  testId: `link-${path}`,
});

const accessibleSections: NavSection[] = [
  {
    id: "system",
    title: "System",
    description: "System configuration",
    icon: Settings,
    items: [
      item("System Status", "/config/status"),
      item("Environment", "/config/environment"),
    ],
  },
  {
    id: "people",
    title: "People",
    description: "People configuration",
    icon: Settings,
    items: [item("User Settings", "/config/users")],
    subsections: [
      {
        id: "workers",
        title: "Workers",
        description: "Worker configuration",
        icon: Settings,
        items: [
          item("Ban Notifications", "/config/workers/ban"),
          item("Time Off Sick", "/config/workers/tos"),
        ],
      },
      {
        id: "employers",
        title: "Employers",
        description: "Employer configuration",
        icon: Settings,
        items: [item("Employer User Settings", "/config/employers/users")],
      },
    ],
  },
];

describe("configuration landing-page link search", () => {
  it("matches direct link labels case-insensitively and removes unrelated sections", () => {
    const result = filterConfigSections(accessibleSections, "ENViron");

    expect(result.map(section => section.id)).toEqual(["system"]);
    expect(result[0].items.map(candidate => candidate.label)).toEqual(["Environment"]);
  });

  it("retains only the parent section and subsection for a nested match", () => {
    const result = filterConfigSections(accessibleSections, "time off");

    expect(result.map(section => section.id)).toEqual(["people"]);
    expect(result[0].items).toEqual([]);
    expect(result[0].subsections?.map(subsection => subsection.id)).toEqual(["workers"]);
    expect(result[0].subsections?.[0].items.map(candidate => candidate.label)).toEqual([
      "Time Off Sick",
    ]);
  });

  it("clearing the query restores the original accessible navigation unchanged", () => {
    expect(filterConfigSections(accessibleSections, "")).toBe(accessibleSections);
    expect(filterConfigSections(accessibleSections, "   ")).toBe(accessibleSections);
  });

  it("returns no sections when no accessible link matches", () => {
    expect(filterConfigSections(accessibleSections, "not available")).toEqual([]);
  });

  it("cannot introduce links absent from the access-filtered input", () => {
    const permittedOnly = [{
      ...accessibleSections[0],
      items: [accessibleSections[0].items[0]],
    }];

    expect(filterConfigSections(permittedOnly, "environment")).toEqual([]);
  });

  it("keeps unresolved dynamic feedback visible while filtering", () => {
    const loading: NavSection = {
      id: "dynamic",
      title: "Dynamic",
      description: "Dynamic links",
      icon: Settings,
      items: [],
      itemsStatus: "loading",
    };

    expect(filterConfigSections([loading], "anything")).toEqual([loading]);
  });
});

vi.mock("@/contexts/PageTitleContext", () => ({
  usePageTitle: vi.fn(),
}));
vi.mock("@/hooks/useConfigNavigation", () => ({
  useAccessibleConfigSections: () => ({
    sections: accessibleSections,
    isLoading: false,
    isError: false,
  }),
}));

describe("configuration landing-page search control", () => {
  it("renders a labeled keyboard text-entry search field near the introduction", async () => {
    const { default: ConfigurationLandingPage } = await import("@/pages/config");
    const markup = renderToStaticMarkup(<ConfigurationLandingPage />);

    expect(markup).toContain('for="configuration-search"');
    expect(markup).toContain('id="configuration-search"');
    expect(markup).toContain('type="search"');
    expect(markup.indexOf("System settings and administrative options"))
      .toBeLessThan(markup.indexOf('id="configuration-search"'));
  });

  it("filters rendered links and the clear button restores them", async () => {
    const { default: ConfigurationLandingPage } = await import("@/pages/config");
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(<ConfigurationLandingPage />);
    });

    const input = container.querySelector<HTMLInputElement>("#configuration-search");
    expect(input).not.toBeNull();

    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      valueSetter?.call(input, "time off");
      input?.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(container.textContent).toContain("Time Off Sick");
    expect(container.textContent).not.toContain("Environment");
    expect(container.textContent).not.toContain("Employer User Settings");

    const clear = container.querySelector<HTMLButtonElement>(
      '[data-testid="button-clear-configuration-search"]',
    );
    expect(clear).not.toBeNull();
    await act(async () => {
      clear?.click();
    });

    expect(container.textContent).toContain("Time Off Sick");
    expect(container.textContent).toContain("Environment");
    expect(container.textContent).toContain("Employer User Settings");

    await act(async () => root.unmount());
  });

  it("shows clear feedback when no accessible rendered link matches", async () => {
    const { default: ConfigurationLandingPage } = await import("@/pages/config");
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(<ConfigurationLandingPage />);
    });

    const input = container.querySelector<HTMLInputElement>("#configuration-search");
    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      valueSetter?.call(input, "not available");
      input?.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(container.querySelector('[data-testid="text-configuration-search-empty"]'))
      .not.toBeNull();
    expect(container.textContent).toContain(
      "No accessible configuration links match your search.",
    );
    expect(container.querySelector('[data-testid^="card-section-"]')).toBeNull();

    await act(async () => root.unmount());
  });
});