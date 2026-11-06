// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { queryClient } from "@/lib/queryClient";
import type { ResolvedMenu } from "@shared/menu-types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLDivElement;
let fetchMock: ReturnType<typeof vi.fn>;
let restored = false;

const targetAuth = {
  user: { id: "worker", firstName: "Worker", lastName: "Person", email: "worker@example.com" },
  permissions: ["worker"],
  components: [],
  masquerade: {
    isMasquerading: true,
    originalUser: { id: "admin", email: "admin@example.com", firstName: "Admin", lastName: "Person" },
  },
};
const originalAuth = {
  user: { id: "admin", firstName: "Admin", lastName: "Person", email: "admin@example.com" },
  permissions: ["admin", "masquerade"],
  components: [],
  masquerade: { isMasquerading: false },
};
const menuFor = (name: string): ResolvedMenu => ({
  plugin: "default",
  items: [{ id: name, label: name, icon: "Home", href: `/${name}` }],
});

function SessionAndMenuProbe() {
  const { user, masquerade, hasPermission, stopMasquerade } = useAuth();
  const { data: menu } = useQuery<ResolvedMenu>({
    queryKey: ["/api/menu"],
    queryFn: async () => {
      const response = await fetch("/api/menu", { credentials: "include" });
      if (!response.ok) throw new Error("Menu request failed");
      return response.json();
    },
    staleTime: 30_000,
  });
  return (
    <div>
      <span data-testid="current-user">{user?.id ?? "signed-out"}</span>
      <span data-testid="masquerade-state">{String(masquerade.isMasquerading)}</span>
      <span data-testid="admin-permission">{String(hasPermission("admin"))}</span>
      <span data-testid="menu-items">{menu?.items.map((item) => item.id).join(",") ?? "loading"}</span>
      <button
        data-testid="stop"
        onClick={async () => { try { await stopMasquerade(); } catch { /* The caller reports the failure. */ } }}
      >
        Stop
      </button>
    </div>
  );
}

async function settle() {
  for (let i = 0; i < 5; i++) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  }
}

async function render() {
  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <AuthProvider><SessionAndMenuProbe /></AuthProvider>
      </QueryClientProvider>,
    );
  });
  await settle();
}

function text(testId: string) {
  return document.querySelector(`[data-testid="${testId}"]`)?.textContent;
}

beforeEach(() => {
  queryClient.clear();
  restored = false;
  fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
    if (url === "/api/auth/masquerade/stop") {
      if (options?.method !== "POST") throw new Error("Expected stop POST");
      restored = true;
      return { ok: true, status: 200 };
    }
    if (url === "/api/auth/user") {
      return {
        ok: true,
        status: 200,
        json: async () => restored ? originalAuth : targetAuth,
      };
    }
    if (url === "/api/menu") {
      return {
        ok: true,
        status: 200,
        json: async () => menuFor(restored ? "admin-home" : "worker-home"),
      };
    }
    throw new Error(`Unexpected request: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  queryClient.clear();
  container.remove();
  vi.unstubAllGlobals();
});

describe("masquerade session-dependent menu", () => {
  it("refreshes auth, header permissions, and the server menu after a successful stop", async () => {
    await render();
    expect(text("current-user")).toBe("worker");
    expect(text("masquerade-state")).toBe("true");
    expect(text("admin-permission")).toBe("false");
    expect(text("menu-items")).toBe("worker-home");

    await act(async () => {
      document.querySelector<HTMLButtonElement>('[data-testid="stop"]')!.click();
    });
    await settle();

    expect(text("current-user")).toBe("admin");
    expect(text("masquerade-state")).toBe("false");
    expect(text("admin-permission")).toBe("true");
    expect(text("menu-items")).toBe("admin-home");
    const stopIndex = fetchMock.mock.calls.findIndex(([url]) => url === "/api/auth/masquerade/stop");
    const restoredAuthIndex = fetchMock.mock.calls.findIndex(
      ([url], index) => index > stopIndex && url === "/api/auth/user",
    );
    const restoredMenuIndex = fetchMock.mock.calls.findIndex(
      ([url], index) => index > restoredAuthIndex && url === "/api/menu",
    );
    expect(stopIndex).toBeGreaterThanOrEqual(0);
    expect(restoredAuthIndex).toBeGreaterThan(stopIndex);
    expect(restoredMenuIndex).toBeGreaterThan(restoredAuthIndex);
  });

  it("keeps the target account and menu when stopping masquerade fails", async () => {
    await render();
    fetchMock.mockImplementation(async (url: string) => {
      if (url === "/api/auth/masquerade/stop") return { ok: false, status: 500 };
      if (url === "/api/auth/user") return { ok: true, json: async () => targetAuth };
      if (url === "/api/menu") return { ok: true, json: async () => menuFor("worker-home") };
      throw new Error(`Unexpected request: ${url}`);
    });

    await act(async () => {
      document.querySelector<HTMLButtonElement>('[data-testid="stop"]')!.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(text("current-user")).toBe("worker");
    expect(text("masquerade-state")).toBe("true");
    expect(text("admin-permission")).toBe("false");
    expect(text("menu-items")).toBe("worker-home");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
