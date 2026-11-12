// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

const apiRequest = vi.hoisted(() => vi.fn());
const toast = vi.hoisted(() => vi.fn());
vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>("@/lib/queryClient");
  return { ...actual, apiRequest };
});
vi.mock("@/components/layouts/WorkerLayout", () => ({
  WorkerLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  useWorkerLayout: () => ({ worker: { id: "worker-1" } }),
}));
vi.mock("@/plugins/wc-vendors/registry", () => ({
  hasWcVendorComponent: () => false,
  resolveWcVendorComponent: () => null,
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));
vi.mock("@/components/ui/alert-dialog", async () => {
  const ReactModule = await import("react");
  type DialogContextValue = { onOpenChange: (open: boolean) => void };
  const DialogContext = ReactModule.createContext<DialogContextValue | null>(null);
  const useDialog = () => {
    const value = ReactModule.useContext(DialogContext);
    if (!value) throw new Error("Alert dialog control used outside its provider");
    return value;
  };
  return {
    AlertDialog: ({ open, onOpenChange, children }: { open: boolean; onOpenChange: (open: boolean) => void; children: React.ReactNode }) =>
      open ? <DialogContext.Provider value={{ onOpenChange }}><div role="alertdialog">{children}</div></DialogContext.Provider> : null,
    AlertDialogContent: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
    AlertDialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    AlertDialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
    AlertDialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
    AlertDialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    AlertDialogCancel: ({ children, onClick, disabled }: React.ButtonHTMLAttributes<HTMLButtonElement>) => {
      const dialog = useDialog();
      return <button type="button" disabled={disabled} onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented && !disabled) dialog.onOpenChange(false);
      }}>{children}</button>;
    },
    AlertDialogAction: ({ children, onClick, disabled, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => {
      const dialog = useDialog();
      return <button type="button" {...props} disabled={disabled} onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented && !disabled) dialog.onOpenChange(false);
      }}>{children}</button>;
    },
  };
});
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
  toast.mockReset();
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

function savedMethod(id: string, options: { active?: boolean; default?: boolean; bank?: boolean } = {}) {
  return {
    id,
    isActive: options.active ?? true,
    isDefault: options.default ?? false,
    gatewayConfigId: "gateway-1",
    ...(options.bank
      ? { providerDetails: { us_bank_account: { bank_name: "Fixture Bank", last4: "6789", account_type: "checking" } } }
      : { providerDetails: { card: { brand: "Visa", last4: "4242", expMonth: 12, expYear: 2030 } } }),
  };
}

function configureRemovalApi(initialMethods: ReturnType<typeof savedMethod>[], deleteHandler?: (id: string) => Promise<unknown>) {
  let currentMethods = initialMethods.map((method) => ({ ...method }));
  const deleteRequests: string[] = [];
  apiRequest.mockImplementation(async (method: string, url: string) => {
    if (url.endsWith("/capabilities")) return { canManageMethods: true };
    if (url.endsWith("/authorization")) return { authorization };
    if (url.endsWith("/gateways")) return [];
    if (url === "/api/ledger/payment-methods/worker/worker-1" && method === "GET") {
      return currentMethods.map((item) => ({ ...item }));
    }
    const methodId = url.split("/").at(-1)!;
    if (method === "DELETE") {
      deleteRequests.push(methodId);
      if (deleteHandler) await deleteHandler(methodId);
      currentMethods = currentMethods.map((item) => item.id === methodId
        ? { ...item, isActive: false, isDefault: false }
        : item);
      return { success: true };
    }
    throw new Error(`Unexpected request: ${method} ${url}`);
  });
  return { deleteRequests, getMethods: () => currentMethods };
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

  it.each([
    ["card", false],
    ["bank account", true],
  ])("removes a saved %s from the list and keeps it inactive after reload", async (_label, bank) => {
    const fixture = configureRemovalApi([savedMethod("saved-1", { active: true, default: true, bank })]);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await renderPaymentMethodsPage(client);
    expect(container!.textContent).toContain(bank ? "Fixture Bank •••• 6789" : "Visa •••• 4242");

    await click(container!.querySelector('button[aria-label="Remove"]'));
    expect(container!.querySelector('[role="alertdialog"]')).not.toBeNull();
    await click([...container!.querySelectorAll('[role="alertdialog"] button')].find((button) => button.textContent === "Remove") ?? null);
    await flush();

    expect(fixture.deleteRequests).toEqual(["saved-1"]);
    expect(fixture.getMethods()).toMatchObject([{ id: "saved-1", isActive: false, isDefault: false }]);
    expect(client.getQueryData(paymentMethodsKey("worker", "worker-1"))).toMatchObject([
      { id: "saved-1", isActive: false, isDefault: false },
    ]);
    expect(container!.textContent).not.toContain("Visa •••• 4242");
    expect(container!.textContent).not.toContain("Fixture Bank •••• 6789");
    expect(container!.textContent).toContain("No saved payment methods yet.");
    expect(container!.querySelector('[role="alertdialog"]')).toBeNull();
    expect(toast).toHaveBeenCalledWith({ title: "Payment method removed" });

    await act(async () => { root?.unmount(); });
    container?.remove();
    root = null;
    container = null;
    await renderPaymentMethodsPage(client);
    expect(container!.textContent).toContain("No saved payment methods yet.");
    expect(container!.querySelector('button[aria-label="Remove"]')).toBeNull();
    client.clear();
  });

  it("leaves a saved method unchanged when removal is canceled", async () => {
    const fixture = configureRemovalApi([savedMethod("saved-1")]);
    await renderPaymentMethodsPage();
    await click(container!.querySelector('button[aria-label="Remove"]'));
    await click([...container!.querySelectorAll('[role="alertdialog"] button')].find((button) => button.textContent === "Cancel") ?? null);
    await flush();

    expect(fixture.deleteRequests).toEqual([]);
    expect(container!.textContent).toContain("Visa •••• 4242");
    expect(container!.querySelector('[role="alertdialog"]')).toBeNull();
    expect(toast).not.toHaveBeenCalledWith({ title: "Payment method removed" });
  });

  it("shows a retryable error without hiding the method or announcing success", async () => {
    let shouldFail = true;
    const fixture = configureRemovalApi([savedMethod("saved-1")], async () => {
      if (shouldFail) {
        shouldFail = false;
        throw new Error("Temporary removal failure");
      }
    });
    await renderPaymentMethodsPage();
    await click(container!.querySelector('button[aria-label="Remove"]'));
    await click([...container!.querySelectorAll('[role="alertdialog"] button')].find((button) => button.textContent === "Remove") ?? null);
    await flush();

    expect(fixture.deleteRequests).toEqual(["saved-1"]);
    expect(container!.textContent).toContain("Temporary removal failure");
    expect(container!.textContent).toContain("Try again");
    expect(container!.textContent).toContain("Visa •••• 4242");
    expect(toast).not.toHaveBeenCalledWith({ title: "Payment method removed" });

    await click([...container!.querySelectorAll('[role="alertdialog"] button')].find((button) => button.textContent === "Try again") ?? null);
    await flush();
    expect(fixture.deleteRequests).toEqual(["saved-1", "saved-1"]);
    expect(container!.textContent).toContain("No saved payment methods yet.");
    expect(toast).toHaveBeenCalledWith({ title: "Payment method removed" });
  });

  it("prevents duplicate removal submissions while the request is pending", async () => {
    let finishRemoval!: () => void;
    const fixture = configureRemovalApi([savedMethod("saved-1")], () => new Promise<void>((resolve) => { finishRemoval = resolve; }));
    await renderPaymentMethodsPage();
    await click(container!.querySelector('button[aria-label="Remove"]'));
    const confirm = [...container!.querySelectorAll('[role="alertdialog"] button')].find((button) => button.textContent === "Remove") ?? null;
    await click(confirm);
    await flush();

    expect(fixture.deleteRequests).toEqual(["saved-1"]);
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    expect(confirm!.textContent).toBe("Removing…");
    await click(confirm);
    expect(fixture.deleteRequests).toEqual(["saved-1"]);

    finishRemoval();
    await flush();
    expect(container!.textContent).toContain("No saved payment methods yet.");
  });

  it("does not show already inactive methods or their default and remove controls", async () => {
    configureRemovalApi([savedMethod("inactive", { active: false, default: true })]);
    await renderPaymentMethodsPage();

    expect(container!.textContent).toContain("No saved payment methods yet.");
    expect(container!.querySelector('[data-testid="worker-payment-method-inactive"]')).toBeNull();
    expect(container!.querySelector('button[aria-label="Remove"]')).toBeNull();
    expect(container!.querySelector('button[aria-label="Set default"]')).toBeNull();
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