// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { Employer } from "../../shared/schema";

vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...await importOriginal<typeof import("@tanstack/react-query")>(),
  useQuery: () => ({ data: [] }),
}));

import { EmployersTable } from "../../client/src/components/employers/employers-table";

describe("employer list navigation", () => {
  it("links each employer name to its detail page, including inactive rows", async () => {
    const employers = [
      { id: "employer-a", name: "Acme Builders", isActive: true },
      { id: "employer-b", name: "Beacon Works", isActive: false },
    ] as Employer[];
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    try {
      await act(async () => {
        root.render(
          <EmployersTable
            employers={employers}
            isLoading={false}
            includeInactive
            onToggleInactive={() => {}}
          />,
        );
      });

      const active = container.querySelector<HTMLAnchorElement>('[data-testid="text-employer-name-employer-a"]');
      const inactive = container.querySelector<HTMLAnchorElement>('[data-testid="text-employer-name-employer-b"]');
      expect(active?.tagName).toBe("A");
      expect(active?.getAttribute("href")).toBe("/employers/employer-a");
      expect(active?.textContent).toBe("Acme Builders");
      expect(inactive?.tagName).toBe("A");
      expect(inactive?.getAttribute("href")).toBe("/employers/employer-b");
      expect(container.querySelector('[data-testid="badge-inactive-employer-employer-b"]')).not.toBeNull();
      expect(container.querySelector('[data-testid="button-view-employer-employer-a"]')).not.toBeNull();
    } finally {
      await act(async () => { root.unmount(); });
      container.remove();
    }
  });
});