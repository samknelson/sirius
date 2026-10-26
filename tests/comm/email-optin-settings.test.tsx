// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ staff: true, request: vi.fn(), toast: vi.fn() }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ hasPermission: () => mocks.staff }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock("@/lib/queryClient", () => ({ apiRequest: mocks.request }));
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: any) => open ? <div>{children}</div> : null,
  DialogContent: ({ children }: any) => <section role="dialog">{children}</section>,
  DialogHeader: ({ children }: any) => <header>{children}</header>,
  DialogTitle: ({ children }: any) => <h2>{children}</h2>,
  DialogDescription: ({ children }: any) => <p>{children}</p>,
}));
import EmailOptinSettings from "../../client/src/components/comm/EmailOptinSettings";
import EntityEmailManagement from "../../client/src/components/shared/EntityEmailManagement";
import EmailManagement from "../../client/src/components/worker/EmailManagement";

let root: Root;
let host: HTMLDivElement;
let client: QueryClient;
let fetchMock: ReturnType<typeof vi.fn>;
const status = { exists: true, optin: false, allowlist: true, record: null };
const flush = () => new Promise(resolve => setTimeout(resolve, 10));
const address = "person+notice@example.invalid";
const url = `/api/email-optin/${encodeURIComponent(address)}`;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.staff = true;
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div"); document.body.appendChild(host);
  root = createRoot(host);
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => status });
  vi.stubGlobal("fetch", fetchMock);
  mocks.request.mockResolvedValue({});
});
afterEach(async () => {
  await act(async () => root.unmount());
  client.clear(); host.remove(); vi.unstubAllGlobals();
});
async function render(element: React.ReactNode) {
  await act(async () => root.render(<QueryClientProvider client={client}>{element}</QueryClientProvider>));
  await act(flush);
}
async function click(selector: string) {
  const button = host.querySelector<HTMLElement>(selector);
  expect(button).not.toBeNull();
  await act(async () => { button!.click(); await flush(); });
}

describe("email opt-in on address tabs", () => {
  it("uses the existing encoded endpoint and shared cache, and updates opt-in", async () => {
    const invalidate = vi.spyOn(client, "invalidateQueries");
    await render(<EmailOptinSettings email={address} />);
    expect(fetchMock).toHaveBeenCalledWith(url, { credentials: "include" });
    await click('[data-testid="button-email-optin-settings"]');
    expect(host.querySelector('[data-testid="switch-email-allowlist"]')?.getAttribute("aria-checked")).toBe("true");
    await click('[data-testid="switch-email-optin"]');
    expect(mocks.request).toHaveBeenCalledWith("PUT", url, { optin: true, allowlist: undefined });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["/api/email-optin", address] });
  });

  it.each([null, "", "  "])("does not offer settings or query a blank address %j", async email => {
    await render(<EmailOptinSettings email={email} />);
    expect(host.querySelector("button")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not expose or query staff-only settings to non-staff", async () => {
    mocks.staff = false;
    await render(<EmailOptinSettings email={address} />);
    expect(host.querySelector("button")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("supports opting out and changing allowlist independently", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ...status, optin: true }) });
    await render(<EmailOptinSettings email={address} />);
    await click('[data-testid="button-email-optin-settings"]');
    await click('[data-testid="switch-email-optin"]');
    expect(mocks.request).toHaveBeenCalledWith("PUT", url, { optin: false, allowlist: undefined });
    await click('[data-testid="switch-email-allowlist"]');
    expect(mocks.request).toHaveBeenCalledWith("PUT", url, { optin: undefined, allowlist: false });
  });

  it("reports a failed update without claiming the consent value changed", async () => {
    mocks.request.mockRejectedValueOnce(new Error("Update refused"));
    await render(<EmailOptinSettings email={address} />);
    await click('[data-testid="button-email-optin-settings"]');
    await click('[data-testid="switch-email-optin"]');
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ description: "Update refused", variant: "destructive" }));
    expect(host.querySelector('[data-testid="switch-email-optin"]')?.getAttribute("aria-checked")).toBe("false");
  });

  it("shows a load failure and retry instead of editable default values", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false });
    await render(<EmailOptinSettings email={address} />);
    await click('[data-testid="button-email-optin-settings"]');
    expect(host.textContent).toContain("Failed to load");
    expect([...host.querySelectorAll('[role="switch"]')].every(control => control.hasAttribute("disabled"))).toBe(true);
    const retry = [...host.querySelectorAll("button")].find(button => button.textContent === "Retry")!;
    await act(async () => { retry.click(); await flush(); });
    expect(host.querySelector('[data-testid="switch-email-optin"]')).not.toBeNull();
  });

  it("uses the submitted address for invalidation when the saved email changes mid-request", async () => {
    let complete!: () => void;
    mocks.request.mockReturnValue(new Promise<void>(resolve => { complete = resolve; }));
    const invalidate = vi.spyOn(client, "invalidateQueries");
    await render(<EmailOptinSettings email={address} />);
    await click('[data-testid="button-email-optin-settings"]');
    await click('[data-testid="switch-email-optin"]');
    expect(host.querySelector('[data-testid="switch-email-optin"]')?.hasAttribute("disabled")).toBe(true);
    await render(<EmailOptinSettings email="new@example.invalid" />);
    await act(async () => { complete(); await flush(); });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["/api/email-optin", address] });
    expect(fetchMock).toHaveBeenCalledWith("/api/email-optin/new%40example.invalid", { credentials: "include" });
  });

  it("makes settings available on the shared contact Email tab", async () => {
    await render(<EntityEmailManagement config={{
      entityId: "contact", currentEmail: address, apiEndpoint: "/api/example/contact", invalidateQueryKeys: [],
    }} />);
    expect(host.querySelector('[data-testid="button-email-optin-settings"]')).not.toBeNull();
    await click('[data-testid="button-email-optin-settings"]');
    expect(host.textContent).toContain("Email Opt-in Settings");
  });

  it("retains settings on the worker Email tab independently of address edit permission", async () => {
    client.setQueryData(["/api/contacts", "contact"], { id: "contact", email: address });
    fetchMock.mockImplementation(async (path: string) => ({ ok: true, json: async () =>
      path === "/api/contacts/contact" ? { id: "contact", email: address } : status }));
    await render(<EmailManagement contactId="contact" workerId="worker" canEdit={false} />);
    expect(host.querySelector('[data-testid="button-email-optin-settings"]')).not.toBeNull();
  });
});
