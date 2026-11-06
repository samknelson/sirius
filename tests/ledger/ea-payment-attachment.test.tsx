// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  apiRequest: vi.fn(), toast: vi.fn(), navigate: vi.fn(),
  params: { id: "employer-ea", paymentTypeId: undefined as string | undefined },
  staff: true,
}));
vi.mock("wouter", () => ({
  useParams: () => mocks.params, useLocation: () => ["/ea/employer-ea/payments/new", mocks.navigate],
}));
vi.mock("@/components/layouts/EALayout", () => ({ EALayout: ({ children }: any) => children }));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { firstName: "Staff", lastName: "Member" }, hasPermission: () => mocks.staff }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock("@/lib/queryClient", async () => ({
  ...await vi.importActual<typeof import("@/lib/queryClient")>("@/lib/queryClient"), apiRequest: mocks.apiRequest,
}));
// Selection itself is covered by the existing payment-form suite; here the
// boundary is the EA form's conversion of selected periods into its POST.
vi.mock("@/components/ledger/StatementPicker", () => ({
  StatementPicker: ({ onSelectionsChange }: any) => (
    <button type="button" data-testid="choose-statements" onClick={() => onSelectionsChange([
      { month: 2, year: 2026, amount: "40" }, { month: 1, year: 2026, amount: "60" },
    ])}>Choose statements</button>
  ),
}));

import EAPaymentCreate from "@/pages/ea-payment-create";
import { queryClient } from "@/lib/queryClient";
import { financeUploadHelp } from "../../server/help/system/finance-uploads";
import { likePatternMatches } from "../../server/help/path-match";
import { sanitizeHtml } from "@shared/utils/html";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;
let upload = vi.fn<(url: string, init: RequestInit) => Promise<Response>>();
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { "Content-Type": "application/json" },
});
const flush = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 15)); });
async function until(check: () => void) {
  for (let n = 0; n < 100; n++) {
    try { check(); return; } catch (error) { if (n === 99) throw error; await flush(); }
  }
}
const get = (id: string) => container.querySelector(`[data-testid="${id}"]`) as HTMLElement;
async function click(id: string) { await act(async () => get(id).click()); await flush(); }
async function change(id: string, value: string) {
  await act(async () => {
    const input = get(id) as HTMLInputElement;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function select(name = "check.png") {
  const input = get("input-payment-attachment") as HTMLInputElement;
  const file = new File(["image"], name, { type: "image/png" });
  Object.defineProperty(input, "files", { configurable: true, value: [file] });
  await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
  return file;
}
async function render(type?: string) {
  mocks.params.paymentTypeId = type;
  act(() => root.render(<QueryClientProvider client={queryClient}><EAPaymentCreate /></QueryClientProvider>));
  await until(() => expect(get("select-payment-type")?.textContent).toContain(type === "adjustment" ? "Adjustment" : "Check"));
  await change("input-amount", "100.00");
}
async function submit() {
  await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  await flush();
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  mocks.staff = true;
  mocks.params.paymentTypeId = undefined;
  vi.clearAllMocks();
  queryClient.clear();
  queryClient.setQueryData(["/api/ledger/ea", "employer-ea"], { id: "employer-ea", accountId: "account", entityType: "employer" });
  queryClient.setQueryData(["/api/ledger/accounts", "account"], { id: "account", currencyCode: "USD" });
  queryClient.setQueryData(["/api/ledger/payment-types"], [
    { id: "check", name: "Check", category: "financial", currencyCode: "USD" },
    { id: "adjustment", name: "Adjustment", category: "adjustment", currencyCode: "USD" },
  ]);
  queryClient.setQueryData(["/api/sitespecific/bao/withholding-uploads", { eaId: "employer-ea" }], [
    { wizardId: "upload-1", month: 1, year: 2026, totalAmount: "100.00", allocationCount: 2 },
  ]);
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:preview") });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
  upload = vi.fn(async (_url: string, _init: RequestInit) => json({ id: "attachment" }));
  vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
    if (init?.method === "POST" && url.startsWith("/api/entity-files/")) return upload(url, init);
    throw new Error(`Unexpected request ${url}`);
  }));
  mocks.apiRequest.mockResolvedValue({ id: "saved-payment", ledgerNotifications: [
    { type: "created", amount: "100", description: "posted once" },
  ] });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  queryClient.clear();
  vi.unstubAllGlobals();
});

describe("EA payment and adjustment attachments", () => {
  it("keeps selection local, supports preview/replace/remove, and Cancel uploads nothing", async () => {
    await render();
    await select();
    expect(get("text-payment-attachment-name").textContent).toBe("check.png");
    await click("payment-attachment-preview-toggle");
    expect(get("payment-attachment-preview-image")).toBeTruthy();
    await select("replacement.png");
    expect(get("text-payment-attachment-name").textContent).toBe("replacement.png");
    await click("button-remove-payment-attachment");
    expect(get("text-payment-attachment-name")).toBeNull();
    await select();
    await click("button-cancel");
    expect(upload).not.toHaveBeenCalled();
    expect(mocks.apiRequest).not.toHaveBeenCalled();
    expect(mocks.navigate).toHaveBeenCalledWith("/ea/employer-ea/payments");
  });

  it.each([undefined, "adjustment"])("binds upload to returned ID and preserves statement payload for %s", async type => {
    await render(type);
    await click("choose-statements");
    if (!type) {
      await change("input-merchant", "Fictional employer");
      await change("input-check-number", "1234");
    }
    const file = await select();
    await submit();
    await until(() => expect(mocks.navigate).toHaveBeenCalledWith("/ledger/payment/saved-payment"));
    expect(mocks.apiRequest).toHaveBeenCalledTimes(1);
    const [method, path, body] = mocks.apiRequest.mock.calls[0];
    expect([method, path]).toEqual(["POST", "/api/ledger/payments"]);
    expect(body).toMatchObject({
      paymentType: type || "check", ledgerEaId: "employer-ea", amount: "100.00",
      status: type ? "cleared" : "draft",
      details: { proposedAllocation: [
        { eaId: "employer-ea", amount: "40.00", statementYmd: "2026-02-01" },
        { eaId: "employer-ea", amount: "60.00", statementYmd: "2026-01-01" },
      ] },
    });
    if (type) expect(body.details).toMatchObject({ adjustmentUser: "Staff Member", dateEntered: expect.any(String), effectiveDate: expect.any(String) });
    else expect(body.details).toMatchObject({ merchant: "Fictional employer", checkTransactionNumber: "1234" });
    expect(upload).toHaveBeenCalledTimes(1);
    expect(upload.mock.calls[0][0]).toBe("/api/entity-files/ledger_payment/saved-payment");
    expect((upload.mock.calls[0][1].body as FormData).get("file")).toBe(file);
  });

  it("creates normally without a file", async () => {
    await render();
    await submit();
    await until(() => expect(mocks.navigate).toHaveBeenCalledWith("/ledger/payment/saved-payment"));
    expect(upload).not.toHaveBeenCalled();
  });

  it("retains selection on validation and server save failures without uploading", async () => {
    await render();
    await select();
    await click("radio-alloc-upload-source");
    await submit();
    expect(mocks.apiRequest).not.toHaveBeenCalled();
    await click("checkbox-upload-upload-1");
    mocks.apiRequest.mockRejectedValueOnce(new Error("Save refused"));
    await submit();
    await until(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Error" })));
    expect(upload).not.toHaveBeenCalled();
    expect(get("text-payment-attachment-name").textContent).toBe("check.png");
    await submit();
    await until(() => expect(upload).toHaveBeenCalledTimes(1));
    expect(mocks.apiRequest).toHaveBeenCalledTimes(2);
  });

  it.each(["retry", "continue"])("recovers with %s without repeating BAO financial creation or notifications", async action => {
    await render("adjustment");
    await click("radio-alloc-upload-source");
    await click("checkbox-upload-upload-1");
    await select();
    upload.mockResolvedValueOnce(json({ message: "Payments filesystem is not configured" }, 503));
    await submit();
    await until(() => expect(get("text-payment-attachment-retry")?.textContent).toContain("Payments filesystem is not configured"));
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect((get("input-amount") as HTMLInputElement).closest("fieldset")!.disabled).toBe(true);
    expect((get("button-select-payment-attachment") as HTMLButtonElement).disabled).toBe(true);
    expect(get("button-submit")).toBeNull();
    expect(mocks.apiRequest.mock.calls[0][2]).toMatchObject({
      status: "cleared", details: { baoUploadSource: { wizardIds: ["upload-1"] } },
    });
    expect(mocks.apiRequest.mock.calls[0][2].details).not.toHaveProperty("proposedAllocation");
    await submit(); // even a programmatic submit must not repeat creation
    await click(action === "retry" ? "button-retry-attachment" : "button-continue-saved-payment");
    await until(() => expect(mocks.navigate).toHaveBeenCalledWith("/ledger/payment/saved-payment"));
    expect(mocks.apiRequest).toHaveBeenCalledTimes(1);
    expect(upload).toHaveBeenCalledTimes(action === "retry" ? 2 : 1);
    expect(mocks.toast.mock.calls.filter(([t]) => t.title === "Ledger Entry Created")).toHaveLength(1);
  });

  it("locks concurrent submissions and conflicting actions while save/upload are pending", async () => {
    await render();
    await select();
    let finishSave!: (value: unknown) => void;
    mocks.apiRequest.mockImplementationOnce(() => new Promise(resolve => { finishSave = resolve; }));
    let finishUpload!: (value: Response) => void;
    upload.mockImplementationOnce(() => new Promise(resolve => { finishUpload = resolve; }));
    await submit();
    await submit();
    expect(mocks.apiRequest).toHaveBeenCalledTimes(1);
    expect((get("button-cancel") as HTMLButtonElement).disabled).toBe(true);
    await act(async () => finishSave({ id: "saved-payment" }));
    await until(() => expect(upload).toHaveBeenCalledTimes(1));
    expect((get("button-continue-saved-payment") as HTMLButtonElement).disabled).toBe(true);
    expect((get("button-retry-attachment") as HTMLButtonElement).disabled).toBe(true);
    await act(async () => finishUpload(json({ id: "attachment" })));
    await until(() => expect(mocks.navigate).toHaveBeenCalledTimes(1));
  });

  it("keeps attachment-only recovery available after another upload refusal", async () => {
    await render();
    await select();
    upload.mockResolvedValueOnce(json({ message: "File type is not allowed" }, 400));
    upload.mockResolvedValueOnce(json({ message: "Filesystem unavailable" }, 503));
    await submit();
    await until(() => expect(get("text-payment-attachment-retry")?.textContent).toContain("File type is not allowed"));
    await click("button-retry-attachment");
    await until(() => expect(get("text-payment-attachment-retry")?.textContent).toContain("Filesystem unavailable"));
    expect(get("text-payment-attachment-name").textContent).toBe("check.png");
    expect(mocks.navigate).not.toHaveBeenCalled();
    await click("button-retry-attachment");
    await until(() => expect(mocks.navigate).toHaveBeenCalledWith("/ledger/payment/saved-payment"));
    expect(mocks.apiRequest).toHaveBeenCalledTimes(1);
    expect(upload).toHaveBeenCalledTimes(3);
    expect(mocks.toast.mock.calls.filter(([t]) => t.title === "Ledger Entry Created")).toHaveLength(1);
  });

  it("does not offer selection or creation to non-staff", () => {
    mocks.staff = false;
    act(() => root.render(<QueryClientProvider client={queryClient}><EAPaymentCreate /></QueryClientProvider>));
    expect(get("payment-attachment-picker")).toBeNull();
    expect(get("button-submit")).toBeNull();
  });
});

describe("payment-entry help", () => {
  const help = financeUploadHelp.find(entry => entry.id === "system:staff-payment-entry")!;
  it.each(["/ea/example/payments/new", "/ea/example/payments/new/check", "/ea/example/payments/new/adjustment"])("covers %s", path => {
    expect(help.paths.some(pattern => likePatternMatches(pattern, path))).toBe(true);
  });
  it.each(["/ea/example/payments", "/ea/example/payments/newish", "/ea/example/summary", "/employers/example", "/ledger/accounts/example/payments"])("does not match sibling %s", path => {
    expect(help.paths.some(pattern => likePatternMatches(pattern, path))).toBe(false);
  });
  it("preserves actionable selection, configuration and recovery guidance after sanitization", () => {
    const html = sanitizeHtml(help.details!, "rich-document");
    for (const text of ["Select image", "Replace image", "Remove", "Preview image", "Cancel uploads nothing", "Retry attachment", "do not create another payment", "Config → Entity Files"]) expect(html).toContain(text);
  });
});
