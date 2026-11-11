// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/ui/select", async () => {
  const React = await vi.importActual<typeof import("react")>("react");
  const SelectionContext = React.createContext<{ onValueChange: (value: string) => void } | null>(null);
  return {
    Select: ({ onValueChange, children }: { onValueChange: (value: string) => void; children: React.ReactNode }) => (
      <SelectionContext.Provider value={{ onValueChange }}>
        <div>{children}</div>
      </SelectionContext.Provider>
    ),
    SelectTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    SelectValue: ({ placeholder }: { placeholder?: string }) => <span>{placeholder}</span>,
    SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => {
      const selection = React.useContext(SelectionContext);
      return <button type="button" onClick={() => selection?.onValueChange(value)}>{children}</button>;
    },
  };
});

import { BenefitColorSelect } from "../../client/src/components/trust-benefits/benefit-color-select";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
});

describe("BenefitColorSelect", () => {
  it("shows named swatches and sends No color as a cleared reference", async () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(["/api/options/color"], [
      { id: "color-blue", name: "Blue", color: "#123ABC" },
    ]);
    const onChange = vi.fn();

    await act(async () => {
      root!.render(
        <QueryClientProvider client={queryClient}>
          <BenefitColorSelect id="benefit-color" value="color-blue" onChange={onChange} testId="color-select" />
        </QueryClientProvider>,
      );
    });

    expect(host.textContent).toContain("Blue");
    expect(host.textContent).toContain("No color");
    const swatch = host.querySelector('[aria-hidden="true"]') as HTMLElement;
    expect(swatch.style.backgroundColor).toBe("rgb(18, 58, 188)");
    const noColorButton = [...host.querySelectorAll("button")].find((button) => button.textContent?.includes("No color"));
    expect(noColorButton).toBeTruthy();
    await act(async () => noColorButton?.click());
    expect(onChange).toHaveBeenCalledWith(null);
    queryClient.clear();
  });
});
