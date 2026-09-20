// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

import { EntityFileManager } from "../../client/src/components/entity-files/EntityFileManager";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLDivElement;
let queryClient: QueryClient;
const filesResponse = {
  configured: true,
  message: null,
  allowed: null,
  files: [
    {
      id: "image-1",
      entityId: "payment-1",
      fileId: "stored-image",
      name: "Check image",
      typeId: null,
      typeName: null,
      data: null,
      file: {
        id: "stored-image",
        fileName: "check.png",
        mimeType: "image/png",
        size: 100,
        uploadedAt: "2026-09-20T00:00:00.000Z",
        status: "live",
      },
    },
    {
      id: "document-1",
      entityId: "payment-1",
      fileId: "stored-document",
      name: "Receipt PDF",
      typeId: null,
      typeName: null,
      data: null,
      file: {
        id: "stored-document",
        fileName: "receipt.pdf",
        mimeType: "application/pdf",
        size: 200,
        uploadedAt: "2026-09-20T00:00:00.000Z",
        status: "live",
      },
    },
  ],
};

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function waitFor(assertion: () => void) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await flush();
    }
  }
  throw lastError;
}

async function click(element: Element) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

beforeEach(() => {
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
  });
  queryClient.setQueryData(["/api/entity-files", "ledger_payment", "payment-1"], filesResponse);
  queryClient.setQueryData(["/api/options/file-type"], []);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  queryClient.clear();
  vi.unstubAllGlobals();
});

describe("saved payment image previews", () => {
  it("expands and closes images while leaving non-images as normal downloads", async () => {
    act(() => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <EntityFileManager context="ledger_payment" entityId="payment-1" />
        </QueryClientProvider>,
      );
    });

    await waitFor(() => {
      expect(container.querySelector('[data-testid="row-entity-file-image-1"]')).not.toBeNull();
    });

    const toggle = container.querySelector('[data-testid="entity-file-preview-image-1-toggle"]')!;
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector('[data-testid="entity-file-preview-document-1-toggle"]')).toBeNull();
    expect(container.querySelector('[data-testid="button-download-document-1"]')).not.toBeNull();

    await click(toggle);
    const image = container.querySelector('[data-testid="entity-file-preview-image-1-image"]') as HTMLImageElement;
    expect(image.src).toContain("/api/files/stored-image/download");
    expect(toggle.getAttribute("aria-expanded")).toBe("true");

    await click(toggle);
    expect(container.querySelector('[data-testid="entity-file-preview-image-1-image"]')).toBeNull();
    expect(container.querySelector('[data-testid="row-entity-file-image-1"]')).not.toBeNull();
  });
});