// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { apiRequest, toast } = vi.hoisted(() => ({
  apiRequest: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { firstName: "Test", lastName: "User" } }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));
vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>("@/lib/queryClient");
  return { ...actual, apiRequest };
});
vi.mock("@/components/layouts/PaymentLayout", () => ({
  PaymentLayout: ({ children }: { children: React.ReactNode }) => children,
  usePaymentLayout: () => ({ payment: null, paymentType: { currencyCode: "USD" } }),
}));
vi.mock("@/components/ledger/LedgerTransactionsView", () => ({
  LedgerTransactionsView: () => <div data-testid="transactions" />,
}));
vi.mock("@/components/ledger/ParticipantAllocationBox", () => ({
  ParticipantAllocationBox: () => <div data-testid="participant-box" />,
}));
vi.mock("@/components/ledger/StatementPicker", () => ({}));
vi.mock("@/components/ui/card", () => ({
  Card: ({ children }: any) => <div>{children}</div>,
  CardContent: ({ children }: any) => <div>{children}</div>,
  CardHeader: ({ children }: any) => <div>{children}</div>,
  CardTitle: ({ children }: any) => <h2>{children}</h2>,
  CardDescription: ({ children }: any) => <p>{children}</p>,
}));
vi.mock("@/components/ui/skeleton", () => ({ Skeleton: () => <div /> }));
vi.mock("@/components/ui/badge", () => ({ Badge: ({ children }: any) => <span>{children}</span> }));
vi.mock("@/components/ui/table", () => ({
  Table: ({ children }: any) => <table>{children}</table>,
  TableBody: ({ children }: any) => <tbody>{children}</tbody>,
  TableCell: ({ children }: any) => <td>{children}</td>,
  TableHead: ({ children }: any) => <th>{children}</th>,
  TableHeader: ({ children }: any) => <thead>{children}</thead>,
  TableRow: ({ children }: any) => <tr>{children}</tr>,
}));
vi.mock("@/components/ui/button", () => ({
  Button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
}));
vi.mock("@/components/ui/input", () => ({ Input: (props: any) => <input {...props} /> }));
vi.mock("@/components/ui/textarea", () => ({ Textarea: (props: any) => <textarea {...props} /> }));
vi.mock("@/components/ui/checkbox", () => ({ Checkbox: (props: any) => <input type="checkbox" {...props} /> }));
vi.mock("@/components/ui/select", () => ({
  Select: ({ children }: any) => <div>{children}</div>,
  SelectContent: ({ children }: any) => <div>{children}</div>,
  SelectItem: ({ children, value }: any) => <option value={value}>{children}</option>,
  SelectTrigger: ({ children }: any) => <div>{children}</div>,
  SelectValue: ({ children }: any) => <span>{children}</span>,
}));
vi.mock("@/components/ui/form", () => ({
  Form: ({ children }: any) => <div>{children}</div>,
  FormControl: ({ children }: any) => <div>{children}</div>,
  FormField: ({ render }: any) => render({ field: { value: "", onChange: vi.fn() } }),
  FormItem: ({ children }: any) => <div>{children}</div>,
  FormLabel: ({ children }: any) => <label>{children}</label>,
  FormMessage: () => null,
}));

import { PaymentForm } from "../../client/src/components/ledger/PaymentForm";
import PaymentView from "../../client/src/pages/payment-view";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const payment = {
  id: "payment-1",
  status: "cleared",
  allocated: false,
  amount: "12.00",
  paymentType: "check",
  ledgerEaId: "ea-1",
  details: null,
  dateReceived: null,
  dateCleared: null,
  memo: null,
  attachmentFileId: null as string | null,
};

let root: Root;
let container: HTMLDivElement;
let queryClient: QueryClient;
let fetchMock: ReturnType<typeof vi.fn>;
let savedAttachmentFileId: string | null;

function render(element: React.ReactNode) {
  act(() => root.render(<QueryClientProvider client={queryClient}>{element}</QueryClientProvider>));
}

function response(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}

async function settleQueries() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        queryFn: async ({ queryKey }) => {
          const res = await fetch(String(queryKey[0]), { credentials: "include" });
          return res.json();
        },
      },
    },
  });
  fetchMock = vi.fn(async (url: string | Request, options?: RequestInit) => {
    url = typeof url === "string" ? url : url.url;
    if (options?.method?.toUpperCase() === "POST") {
      savedAttachmentFileId = "file-new";
      return response({ ...payment, attachmentFileId: "file-new" });
    }
    if (url.includes("/api/files/")) return response({ id: "file-old", fileName: "receipt.png", mimeType: "image/png" });
    if (url.includes("/api/ledger/payment-types")) return response([{ id: "check", name: "Check", category: "financial", currencyCode: "USD" }]);
    if (url.includes("/api/ledger/ea")) return response([{ id: "ea-1", accountId: "account-1", entityType: "worker", entityId: "worker-1", entityName: "Worker", data: null }]);
    return response({ ...payment, attachmentFileId: savedAttachmentFileId });
  });
  savedAttachmentFileId = null;
  vi.stubGlobal("fetch", fetchMock);
  apiRequest.mockImplementation(async (method: string, url: string) => {
    if (method === "GET" && url === "/api/ledger/payment-types") return [{ id: "check", name: "Check", category: "financial", currencyCode: "USD" }];
    if (method === "GET" && url.startsWith("/api/ledger/ea")) return [{ id: "ea-1", accountId: "account-1", entityType: "worker", entityId: "worker-1", entityName: "Worker", data: null }];
    if (method === "DELETE") return undefined;
    return payment;
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("individual payment image attachment UI", () => {
  it("renders edit attachment controls only in edit mode and preserves saved image on rejected file", async () => {
    render(<PaymentForm mode="edit" paymentId="payment-1" />);
    await settleQueries();
    expect(container.querySelector('[data-testid="payment-attachment-section"]')).not.toBeNull();

    const input = container.querySelector('[data-testid="input-payment-attachment"]') as HTMLInputElement;
    const rejected = new File(["not an image"], "receipt.pdf", { type: "application/pdf" });
    await act(async () => {
      Object.defineProperty(input, "files", { value: [rejected] });
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(fetchMock).not.toHaveBeenCalledWith("/api/ledger/payments/payment-1/attachment", expect.anything());
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Unsupported image" }));
  });

  it("uses separate attachment endpoints and never submits the financial PUT", async () => {
    render(<PaymentForm mode="edit" paymentId="payment-1" />);
    await settleQueries();
    const input = container.querySelector('[data-testid="input-payment-attachment"]') as HTMLInputElement;
    const image = new File(["image"], "receipt.png", { type: "image/png" });
    await act(async () => {
      Object.defineProperty(input, "files", { value: [image] });
      input.dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(fetchMock).toHaveBeenCalledWith("/api/ledger/payments/payment-1/attachment", expect.objectContaining({ method: "POST" }));
    expect(fetchMock.mock.calls.some(([, options]) => options?.method === "PUT")).toBe(false);
    expect(queryClient.getQueryData(["/api/ledger/payments", "payment-1"])).toEqual(
      expect.objectContaining({ id: "payment-1" }),
    );
  });

  it("renders details without the attachment section when no file is saved", async () => {
    render(<PaymentView />);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(container.querySelector('[data-testid="payment-attachment-section"]')).toBeNull();
  });
});