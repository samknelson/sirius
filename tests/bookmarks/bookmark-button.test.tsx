// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { auth, apiRequest, toast } = vi.hoisted(() => ({
  auth: { permissions: [] as string[] },
  apiRequest: vi.fn(),
  toast: vi.fn(),
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ hasPermission: (permission: string) => auth.permissions.includes(permission) }),
}));
vi.mock("@/lib/queryClient", () => ({ apiRequest }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));

import { BookmarkButton } from "@/components/ui/bookmark-button";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;
let client: QueryClient;
let bookmarked: boolean;
const fetchStatus = vi.fn();

async function settle() {
  for (let i = 0; i < 5; i++) {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  }
}

async function render(entityType: string, permissions: string[]) {
  auth.permissions = permissions;
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <BookmarkButton entityType={entityType} entityId="entity-1" entityName="Example" />
      </QueryClientProvider>,
    );
  });
  await settle();
}

function button() {
  return container.querySelector<HTMLButtonElement>('[data-testid="button-bookmark"]');
}

beforeEach(() => {
  auth.permissions = [];
  bookmarked = false;
  apiRequest.mockReset();
  toast.mockReset();
  fetchStatus.mockReset();
  fetchStatus.mockImplementation(async () => ({
    ok: true, json: async () => ({ bookmarked, bookmark: null }),
  }));
  vi.stubGlobal("fetch", fetchStatus);
  apiRequest.mockImplementation(async (method: string) => {
    bookmarked = method === "POST";
    return {};
  });
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  client.clear();
  container.remove();
  vi.unstubAllGlobals();
});

describe("bookmark permission transitions", () => {
  it.each(["worker", "employer", "company"])(
    "keeps hooks stable and actions gated on the mounted %s button",
    async entityType => {
      await render(entityType, []);
      expect(button()).toBeNull();
      expect(fetchStatus).not.toHaveBeenCalled();
      expect(apiRequest).not.toHaveBeenCalled();

      // Granting permission must reuse this root, not mount a replacement.
      await render(entityType, ["bookmark"]);
      expect(button()?.disabled).toBe(false);
      expect(fetchStatus).toHaveBeenCalledWith(
        `/api/bookmarks/check?entityType=${entityType}&entityId=entity-1`,
      );
      await act(async () => { button()!.click(); });
      await settle();
      expect(apiRequest).toHaveBeenLastCalledWith("POST", "/api/bookmarks", { entityType, entityId: "entity-1" });
      expect(container.querySelector('[data-testid="icon-bookmarked"]')).not.toBeNull();
      expect(toast).toHaveBeenLastCalledWith({
        title: "Bookmarked", description: "Example has been added to your bookmarks.",
      });

      await render(entityType, []);
      expect(button()).toBeNull();
      const requestsBefore = fetchStatus.mock.calls.length;
      // Disabled observers must also ignore invalidation while unauthorized.
      await act(async () => { await client.invalidateQueries({ queryKey: ["/api/bookmarks/check"] }); });
      await settle();
      expect(fetchStatus).toHaveBeenCalledTimes(requestsBefore);
      expect(apiRequest).toHaveBeenCalledTimes(1);

      // Admin alone retains the existing permission override and remove action.
      await render(entityType, ["admin"]);
      expect(button()?.disabled).toBe(false);
      expect(fetchStatus.mock.calls.length).toBeGreaterThan(requestsBefore);
      await act(async () => { button()!.click(); });
      await settle();
      expect(apiRequest).toHaveBeenLastCalledWith("DELETE", `/api/bookmarks/entity/${entityType}/entity-1`);
      expect(container.querySelector('[data-testid="icon-not-bookmarked"]')).not.toBeNull();
      expect(toast).toHaveBeenLastCalledWith({
        title: "Removed", description: "Example has been removed from your bookmarks.",
      });
      await render(entityType, []);
      expect(button()).toBeNull();
    },
  );
});