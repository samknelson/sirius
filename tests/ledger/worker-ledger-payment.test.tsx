// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { apiRequest, navigate, location } = vi.hoisted(() => ({
  apiRequest: vi.fn(),
  navigate: vi.fn(),
  location: { path: "/workers/worker-42/ledger/pay" },
}));

vi.mock("wouter", () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode } & React.AnchorHTMLAttributes<HTMLAnchorElement>) =>
    <a href={href} {...props}>{children}</a>,
  useLocation: () => [location.path, navigate],
  useSearch: () => location.path.includes("?") ? location.path.slice(location.path.indexOf("?") + 1) : "",
}));
vi.mock("@/components/layouts/WorkerLayout", () => ({
  WorkerLayout: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useWorkerLayout: () => ({ worker: { id: "worker-42" } }),
}));
vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>("@/lib/queryClient");
  return { ...actual, apiRequest };
});

import Page from "@/pages/worker-ledger-payment";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

const accounts = [
  { eaId: "ea-domestic", accountName: "Domestic Partner", balance: "125.00", available: "125.00", currency: "USD" },
  { eaId: "ea-family", accountName: "Family Account", balance: "40.00", available: "40.00", currency: "USD" },
];

async function render() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<QueryClientProvider client={client}><Page /></QueryClientProvider>);
    await Promise.resolve();
  });
  await settle();
}

async function settle() {
  for (let i = 0; i < 5; i++) {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  }
}

function text() {
  return container?.textContent ?? "";
}

function payLink(eaId: string) {
  const link = container?.querySelector(`a[href="/pay/${eaId}"]`);
  expect(link, `missing pay link for ${eaId}`).toBeTruthy();
  return link as HTMLAnchorElement;
}

beforeEach(() => {
  location.path = "/workers/worker-42/ledger/pay";
  navigate.mockReset();
  apiRequest.mockReset();
  apiRequest.mockImplementation((method: string, url: string) => {
    if (method === "GET" && url === "/api/ledger/pay-accounts/worker/worker-42") return Promise.resolve(accounts);
    throw new Error(`Unexpected request ${method} ${url}`);
  });
});

afterEach(async () => {
  await act(async () => { root?.unmount(); });
  container?.remove();
  root = null;
  container = null;
});

describe("worker payment account chooser", () => {
  it("requires an explicit account choice when multiple accounts are available", async () => {
    await render();

    expect(text()).toContain("Choose an account to pay");
    expect(text()).toContain("Domestic Partner");
    expect(text()).toContain("Family Account");
    expect(navigate).not.toHaveBeenCalled();
    expect(payLink("ea-domestic").getAttribute("href")).toBe("/pay/ea-domestic");
    expect(payLink("ea-family").getAttribute("href")).toBe("/pay/ea-family");
  });

  it("disables accounts with no available balance while leaving payable accounts selectable", async () => {
    apiRequest.mockResolvedValueOnce([
      { ...accounts[0], available: "0.00" },
      accounts[1],
    ]);
    await render();

    expect(container?.querySelector('a[href="/pay/ea-domestic"]')).toBeNull();
    expect(payLink("ea-family").getAttribute("href")).toBe("/pay/ea-family");
  });

  it("redirects a valid old deep link to the shared account checkout", async () => {
    location.path = "/workers/worker-42/ledger/pay?eaId=ea-family";
    await render();

    expect(navigate).toHaveBeenCalledWith("/pay/ea-family", { replace: true });
  });

  it("reports an unavailable old deep-link account without redirecting", async () => {
    location.path = "/workers/worker-42/ledger/pay?eaId=missing-account";
    await render();

    expect(text()).toContain("The requested account is not available for online payment");
    expect(navigate).not.toHaveBeenCalled();
  });
});