// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ListBulkAction } from "../../client/src/components/bulk/list-bulk-action";

const { apiRequestMock } = vi.hoisted(() => ({ apiRequestMock: vi.fn() }));

vi.mock("@/lib/queryClient", () => ({
  apiRequest: apiRequestMock,
  ApiError: class ApiError extends Error {
    constructor(public status: number, message: string) {
      super(message);
    }
  },
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("wouter", () => ({ useLocation: () => ["/", vi.fn()] }));

let host: HTMLDivElement;
let root: Root;
let queryClient: QueryClient;

async function settle() {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      await Promise.resolve();
    });
  }
}

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  apiRequestMock.mockReset();
  apiRequestMock.mockImplementation(async (_method: string, url: string) => {
    if (url === "/api/components/config") return [{ componentId: "bulk", enabled: true }];
    if (url.includes("/api/admin/letter-templates")) return [];
    throw new Error(`Unexpected request: ${url}`);
  });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        queryFn: ({ queryKey }) => apiRequestMock("GET", String(queryKey[0])),
      },
    },
  });
});

afterEach(() => {
  act(() => root.unmount());
  queryClient.clear();
  host.remove();
  document.body.querySelectorAll("[data-radix-portal]").forEach((portal) => portal.remove());
});

describe("ListBulkAction Radix dialog handoff", () => {
  it("closes the actual dropdown before opening the modal, releasing the menu focus scope", async () => {
    act(() => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <ListBulkAction
            selectedContactIds={["contact-1"]}
            totalMatching={1}
            visibleSelectedCount={1}
            onSelectAllMatching={vi.fn()}
            sourceLabel="Compliance review"
            testIdPrefix="radix-check"
          />
        </QueryClientProvider>,
      );
    });
    await settle();

    const trigger = host.querySelector<HTMLButtonElement>('[data-testid="radix-check-trigger"]')!;
    await act(async () => {
      trigger.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }));
      trigger.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, button: 0 }));
      trigger.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await settle();
    expect(document.body.querySelector('[role="menu"]')).not.toBeNull();

    const createDraft = document.body.querySelector<HTMLButtonElement>('[data-testid="radix-check-message"]')!;
    await act(async () => {
      createDraft.dispatchEvent(new MouseEvent("pointermove", { bubbles: true }));
      createDraft.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }));
      createDraft.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, button: 0 }));
      createDraft.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    await settle();

    expect(document.body.querySelector('[role="dialog"]')?.textContent).toContain("Create bulk message draft");
    expect(document.body.querySelector('[role="menu"]')).toBeNull();
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });
});
