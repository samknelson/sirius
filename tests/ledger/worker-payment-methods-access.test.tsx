// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

const apiRequest = vi.hoisted(() => vi.fn());
vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>("@/lib/queryClient");
  return { ...actual, apiRequest };
});
vi.mock("@/components/layouts/WorkerLayout", () => ({
  WorkerLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  useWorkerLayout: () => ({ worker: { id: "worker-1" } }),
}));
vi.mock("@/plugins/payment-gateway/registry", () => ({
  hasPaymentGatewayComponent: () => false,
  resolvePaymentGatewayComponent: () => null,
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, onOpenChange, children }: { open: boolean; onOpenChange: (open: boolean) => void; children: React.ReactNode }) => open
    ? <div>{children}<button type="button" data-testid="close-add-dialog" onClick={() => onOpenChange(false)}>Close</button></div>
    : null,
  DialogContent: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
}));
vi.mock("@/components/ui/select", async () => {
  const ReactModule = await import("react");
  type SelectContextValue = {
    value?: string;
    onValueChange: (value: string) => void;
    open: boolean;
    setOpen: (open: boolean) => void;
  };
  const Context = ReactModule.createContext<SelectContextValue | null>(null);
  const useSelect = () => {
    const value = ReactModule.useContext(Context);
    if (!value) throw new Error("Select component used outside its provider");
    return value;
  };
  return {
    Select: ({ value, onValueChange, children }: { value?: string; onValueChange: (value: string) => void; children: React.ReactNode }) => {
      const [open, setOpen] = ReactModule.useState(false);
      return <Context.Provider value={{ value, onValueChange, open, setOpen }}>{children}</Context.Provider>;
    },
    SelectTrigger: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => {
      const select = useSelect();
      return <button type="button" {...props} role="combobox" onClick={() => select.setOpen(!select.open)}>{children}</button>;
    },
    SelectValue: ({ placeholder }: { placeholder?: string }) => {
      const select = useSelect();
      return <span>{select.value || placeholder}</span>;
    },
    SelectContent: ({ children }: { children: React.ReactNode }) => {
      const select = useSelect();
      return select.open ? <div role="listbox">{children}</div> : null;
    },
    SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => {
      const select = useSelect();
      return <button type="button" role="option" data-testid={`gateway-option-${value}`} onClick={() => {
        select.onValueChange(value);
        select.setOpen(false);
      }}>{children}</button>;
    },
  };
});

import WorkerPaymentMethodsPage from "@/pages/worker-payment-methods";
import { paymentMethodsKey } from "@/lib/payment-method-queries";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
let container: HTMLDivElement | null = null;
afterEach(async () => {
  await act(async () => { root?.unmount(); });
  container?.remove();
  root = null;
  container = null;
  apiRequest.mockReset();
});

const authorization = { version: "current-v1", text: "I authorize saving this payment method.", accepted: true as const };
let setupHandler: (body: unknown) => Promise<unknown>;
let setupRequests: unknown[];

function configurePaymentMethodApi() {
  setupRequests = [];
  setupHandler = async () => ({ clientSecret: "setup-secret", componentId: null, publicConfig: {} });
  apiRequest.mockImplementation(async (method: string, url: string, body?: unknown) => {
    if (url.endsWith("/capabilities")) return { canManageMethods: true };
    if (url.endsWith("/authorization")) return { authorization };
    if (url.endsWith("/gateways")) return [
      { id: "gateway-1", pluginId: "stripe", name: "Card provider" },
      { id: "gateway-2", pluginId: "bank", name: "Bank provider" },
    ];
    if (url.endsWith("/setup") && method === "POST") {
      setupRequests.push(body);
      return setupHandler(body);
    }
    if (method === "GET") return [];
    throw new Error(`Unexpected request: ${method} ${url}`);
  });
}

async function renderPaymentMethodsPage(existingClient?: QueryClient) {
  const queryClient = existingClient ?? new QueryClient({ defaultOptions: { queries: { retry: false } } });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<QueryClientProvider client={queryClient}><WorkerPaymentMethodsPage /></QueryClientProvider>);
  });
  await flush();
}

describe("checkout-saved methods refresh", () => {
  it.each(["card", "us_bank_account"])("replaces an infinitely fresh empty cache with a settled %s on return", async type => {
    configurePaymentMethodApi();
    const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false, refetchOnWindowFocus: false } } });
    const key = paymentMethodsKey("worker", "worker-1");
    client.setQueryData(key, []);
    const implementation = apiRequest.getMockImplementation()!;
    apiRequest.mockImplementation(async (method, url, body) => url === "/api/ledger/payment-methods/worker/worker-1"
      ? [{ id: "settled", isActive: true, isDefault: true, gatewayConfigId: "gateway-1",
        providerDetails: type === "card" ? { card: { brand: "Visa", last4: "4242" } }
          : { us_bank_account: { bank_name: "Fixture Bank", last4: "6789" } } }]
      : implementation(method, url, body));
    await renderPaymentMethodsPage(client);
    expect(container!.textContent).toContain(type === "card" ? "Visa •••• 4242" : "Fixture Bank •••• 6789");
    expect(container!.textContent).not.toContain("No saved payment methods yet");
    expect(client.getQueryData(key)).toMatchObject([{ id: "settled" }]);
    client.clear();
  });
});

async function flush() {
  for (let i = 0; i < 5; i++) {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  }
}

async function click(element: Element | null) {
  if (!element) throw new Error("Expected control was not found");
  await act(async () => { element.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
}

async function chooseGateway(id: string) {
  await click(container!.querySelector('[data-testid="select-worker-payment-gateway"]'));
  await click(container!.querySelector(`[data-testid="gateway-option-${id}"]`));
}

async function toggleConsent() {
  const checkbox = container!.querySelector<HTMLInputElement>('[data-testid="checkbox-worker-method-consent"]');
  if (!checkbox) throw new Error("Authorization checkbox was not found");
  await act(async () => { checkbox.click(); });
}

describe("worker saved method management controls", () => {
  it.each([false, true])("shows mutation controls only when management authority is %s", async (canManageMethods) => {
    apiRequest.mockImplementation(async (_method: string, url: string) => {
      if (url.endsWith("/capabilities")) return { canManageMethods };
      if (url.endsWith("/authorization")) return { authorization: { version: "v1", text: "Authorize" } };
      if (url.endsWith("/gateways")) return [];
      return [{ id: "saved-1", isDefault: false, gatewayConfigId: "gateway-1",
        isActive: true, providerDetails: { card: { brand: "Visa", last4: "4242", expMonth: 12, expYear: 2030 } } }];
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => { root!.render(<QueryClientProvider client={queryClient}><WorkerPaymentMethodsPage /></QueryClientProvider>); });
    for (let i = 0; i < 5; i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    expect(container.textContent).toContain("Visa •••• 4242");
    expect(!!container.querySelector('[data-testid="button-worker-add-payment-method"]')).toBe(canManageMethods);
    expect(!!container.querySelector('button[aria-label="Remove"]')).toBe(canManageMethods);
    expect(!!container.querySelector('button[aria-label="Set default"]')).toBe(canManageMethods);
    expect(apiRequest.mock.calls.some(([, url]) => String(url).endsWith("/authorization"))).toBe(canManageMethods);
  });

  it("continues setup when the provider is selected before authorization", async () => {
    configurePaymentMethodApi();
    await renderPaymentMethodsPage();
    await click(container!.querySelector('[data-testid="button-worker-add-payment-method"]'));
    await chooseGateway("gateway-1");
    await chooseGateway("gateway-2");

    expect(setupRequests).toHaveLength(0);
    expect(container!.textContent).toContain("gateway-2");
    expect(container!.textContent).toContain("Accept the payment authorization to continue with this provider.");
    await toggleConsent();
    await flush();

    expect(setupRequests).toHaveLength(1);
    expect(setupRequests[0]).toEqual({
      gatewayConfigId: "gateway-2",
      consent: { ...authorization, accepted: true },
    });
  });

  it("continues setup when authorization is accepted before choosing a provider", async () => {
    configurePaymentMethodApi();
    await renderPaymentMethodsPage();
    await click(container!.querySelector('[data-testid="button-worker-add-payment-method"]'));
    await toggleConsent();
    expect(setupRequests).toHaveLength(0);

    await chooseGateway("gateway-1");
    await flush();

    expect(setupRequests).toHaveLength(1);
    expect(setupRequests[0]).toEqual({
      gatewayConfigId: "gateway-1",
      consent: { ...authorization, accepted: true },
    });
  });

  it("does not duplicate an in-flight setup when authorization is toggled", async () => {
    configurePaymentMethodApi();
    let resolveSetup!: (value: unknown) => void;
    setupHandler = () => new Promise((resolve) => { resolveSetup = resolve; });
    await renderPaymentMethodsPage();
    await click(container!.querySelector('[data-testid="button-worker-add-payment-method"]'));
    await chooseGateway("gateway-1");
    await toggleConsent();
    expect(setupRequests).toHaveLength(1);

    await toggleConsent();
    await toggleConsent();
    expect(setupRequests).toHaveLength(1);

    resolveSetup({ clientSecret: "setup-secret", componentId: null, publicConfig: {} });
    await flush();
    expect(setupRequests).toHaveLength(1);
    expect(container!.textContent).toContain("This payment provider is not available.");
  });

  it("resets a dismissed choice and keeps a failed setup retryable", async () => {
    configurePaymentMethodApi();
    let shouldFail = true;
    setupHandler = async () => {
      if (shouldFail) {
        shouldFail = false;
        throw new Error("Temporary setup failure");
      }
      return { clientSecret: "setup-secret", componentId: null, publicConfig: {} };
    };
    await renderPaymentMethodsPage();
    await click(container!.querySelector('[data-testid="button-worker-add-payment-method"]'));
    await chooseGateway("gateway-2");
    expect(setupRequests).toHaveLength(0);
    await click(container!.querySelector('[data-testid="close-add-dialog"]'));

    await click(container!.querySelector('[data-testid="button-worker-add-payment-method"]'));
    expect((container!.querySelector('[data-testid="checkbox-worker-method-consent"]') as HTMLInputElement).checked).toBe(false);
    expect(container!.textContent).toContain("Select a payment provider");
    await toggleConsent();
    await chooseGateway("gateway-2");
    await flush();
    expect(setupRequests).toHaveLength(1);
    expect(container!.textContent).toContain("Temporary setup failure");
    expect(container!.querySelector('[data-testid="select-worker-payment-gateway"]')).not.toBeNull();

    await click([...container!.querySelectorAll("button")].find((button) => button.textContent === "Retry setup") ?? null);
    await flush();
    expect(setupRequests).toHaveLength(2);
    expect(setupRequests[1]).toEqual(setupRequests[0]);
  });

  it("ignores setup results that arrive after the dialog closes", async () => {
    configurePaymentMethodApi();
    let resolveSetup!: (value: unknown) => void;
    setupHandler = () => new Promise((resolve) => { resolveSetup = resolve; });
    await renderPaymentMethodsPage();
    await click(container!.querySelector('[data-testid="button-worker-add-payment-method"]'));
    await chooseGateway("gateway-1");
    await toggleConsent();
    expect(setupRequests).toHaveLength(1);
    await click(container!.querySelector('[data-testid="close-add-dialog"]'));
    resolveSetup({ clientSecret: "stale-secret", componentId: null, publicConfig: {} });
    await flush();

    await click(container!.querySelector('[data-testid="button-worker-add-payment-method"]'));
    await flush();
    expect(container!.querySelector('[data-testid="select-worker-payment-gateway"]')).not.toBeNull();
    expect(container!.textContent).not.toContain("Loading secure setup…");
    expect((container!.querySelector('[data-testid="checkbox-worker-method-consent"]') as HTMLInputElement).checked).toBe(false);
  });
});