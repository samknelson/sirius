// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { auth, apiRequest, invalidateQueries } = vi.hoisted(() => ({
  auth: {
    user: { id: "admin" } as { id: string } | null,
    permissions: ["admin"] as string[],
    active: false,
    stop: vi.fn(),
  },
  apiRequest: vi.fn(),
  invalidateQueries: vi.fn(),
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: auth.user,
    hasPermission: (permission: string) => auth.permissions.includes(permission),
    masquerade: { isMasquerading: auth.active },
    stopMasquerade: auth.stop,
  }),
}));
vi.mock("@/lib/queryClient", () => ({
  apiRequest,
  getApiErrorMessage: (error: Error) => error.message,
  queryClient: { invalidateQueries },
}));

import { QuickMasquerade } from "@/components/layout/QuickMasquerade";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;
let client: QueryClient;
let fetchMock: ReturnType<typeof vi.fn>;
const recent = (id: string) => ({
  userId: id, email: `${id}@example.com`, firstName: id.toUpperCase(),
  lastName: "Person", timestamp: "2026-01-01",
});

async function settle() {
  for (let i = 0; i < 4; i++) {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  }
}
async function render() {
  await act(async () => {
    root.render(<QueryClientProvider client={client}><QuickMasquerade /></QueryClientProvider>);
  });
}
function find(testId: string) {
  return document.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
}
async function open() {
  await act(async () => { find("button-quick-masquerade")!.click(); });
  await settle();
}

beforeEach(() => {
  auth.user = { id: "admin" };
  auth.permissions = ["admin"];
  auth.active = false;
  auth.stop.mockReset().mockResolvedValue(undefined);
  apiRequest.mockReset().mockResolvedValue({});
  invalidateQueries.mockReset().mockResolvedValue(undefined);
  fetchMock = vi.fn().mockImplementation(async (url: string) =>
    url.includes("/recent")
      ? { ok: true, json: async () => ({ recentMasquerades: ["first", "second", "third", "fourth"].map(recent) }) }
      : { ok: true, json: async () => [] });
  vi.stubGlobal("fetch", fetchMock);
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
  vi.useRealTimers();
});

describe("quick masquerade toolbar", () => {
  it("only offers start to authorized users, and limits recents to the server's first three", async () => {
    auth.permissions = [];
    await render();
    expect(find("button-quick-masquerade")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    auth.permissions = ["masquerade"];
    await render();
    await open();
    expect([...document.querySelectorAll('[data-testid^="quick-recent-"]')].map(el => el.getAttribute("data-testid")))
      .toEqual(["quick-recent-first", "quick-recent-second", "quick-recent-third"]);
    expect(find("quick-recent-first")?.textContent).toContain("FIRST Person");
    expect(find("quick-recent-first")?.textContent).toContain("first@example.com");
  });

  it("handles empty history and keyboard opening and closing", async () => {
    fetchMock.mockImplementation(async () => ({ ok: true, json: async () => ({ recentMasquerades: [] }) }));
    await render();
    const trigger = find("button-quick-masquerade")!;
    expect(trigger.tagName).toBe("BUTTON");
    trigger.focus();
    expect(document.activeElement).toBe(trigger);
    // jsdom does not synthesize the browser's native button click from Enter.
    await act(async () => { trigger.click(); });
    await settle();
    expect(document.body.textContent).toContain("No recent users.");
    await act(async () => {
      document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    await settle();
    expect(find("quick-masquerade-search")).toBeNull();
  });

  it("debounces search, shows active matches and starts once with pending and failure feedback", async () => {
    fetchMock.mockImplementation(async (url: string) => url.includes("/recent")
      ? { ok: true, json: async () => ({ recentMasquerades: [] }) }
      : { ok: true, json: async () => [
        { id: "target", firstName: "Test", lastName: "Person", email: "test@example.com", isActive: true },
        { id: "inactive", firstName: "Old", lastName: "User", email: "old@example.com", isActive: false },
      ] });
    await render();
    await open();
    const input = find("quick-masquerade-search") as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, "te");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(document.body.textContent).toContain("Searching...");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 350)); });
    await settle();
    expect(find("quick-result-target")?.textContent).toContain("test@example.com");
    expect(fetchMock).toHaveBeenCalledWith("/api/auth/masquerade/search?q=te",
      expect.objectContaining({ credentials: "include" }));
    expect(find("quick-result-inactive")).toBeNull();
    let reject!: (error: Error) => void;
    apiRequest.mockImplementation(() => new Promise((_resolve, rej) => { reject = rej; }));
    await act(async () => { find("quick-result-target")!.click(); });
    await act(async () => { find("quick-result-target")!.click(); });
    expect(apiRequest).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).toContain("Starting masquerade...");
    await act(async () => { reject(new Error("Access denied")); });
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("Access denied");
    expect(find("quick-result-target")?.hasAttribute("disabled")).toBe(false);
  });

  it("shows no-match and search errors without offering stale results", async () => {
    await render();
    await open();
    const input = find("quick-masquerade-search") as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "nobody");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 350)); });
    await settle();
    expect(document.body.textContent).toContain("No active users found.");
    fetchMock.mockImplementation(async (url: string) => url.includes("/search") ? { ok: false } : { ok: true });
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "broken");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 350)); });
    await settle();
    expect(document.body.textContent).toContain("Could not search users.");
  });

  it("cancels a previous search when the query changes or the menu closes", async () => {
    const signals: AbortSignal[] = [];
    fetchMock.mockImplementation(async (url: string, options?: { signal?: AbortSignal }) => {
      if (url.includes("/recent")) return { ok: true, json: async () => ({ recentMasquerades: [] }) };
      signals.push(options!.signal!);
      return new Promise(() => {});
    });
    await render();
    await open();
    const input = find("quick-masquerade-search") as HTMLInputElement;
    const type = async (value: string) => {
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    };
    await type("first");
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 350)); });
    expect(signals).toHaveLength(1);
    await type("second");
    expect(signals[0].aborted).toBe(true);
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 350)); });
    expect(signals).toHaveLength(2);
    await act(async () => { find("button-quick-masquerade")!.click(); });
    expect(signals[1].aborted).toBe(true);
  });

  it("starts from a recent target through the existing endpoint", async () => {
    // Keep the navigation from committing by holding the auth invalidation promise.
    invalidateQueries.mockImplementation(() => new Promise(() => {}));
    await render();
    await open();
    await act(async () => { find("quick-recent-second")!.click(); });
    expect(apiRequest).toHaveBeenCalledWith("POST", "/api/auth/masquerade/start", { userId: "second" });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["/api/auth/user"] });
  });

  it("offers only stop during masquerade even with no effective admin permissions, and reports failures", async () => {
    auth.active = true;
    auth.permissions = [];
    await render();
    await open();
    expect(find("quick-stop-masquerade")).not.toBeNull();
    expect(find("quick-masquerade-search")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    auth.stop.mockRejectedValueOnce(new Error("Could not stop"));
    await act(async () => { find("quick-stop-masquerade")!.click(); });
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("Could not stop");
    await act(async () => { find("quick-stop-masquerade")!.click(); });
    expect(auth.stop).toHaveBeenCalledTimes(2);
    expect(find("quick-stop-masquerade")).toBeNull();
  });
});