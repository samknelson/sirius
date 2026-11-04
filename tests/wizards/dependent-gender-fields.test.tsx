// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { queryClient } from "../../client/src/lib/queryClient";
import { DependentGenderFields } from "../../client/src/components/wizards/framework/enrollment/DependentGenderFields";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("shared dependent gender fields", () => {
  let container: HTMLDivElement;
  let root: Root;
  const genderOptions = [
    { id: "gender-female", name: "Female", nota: false, sequence: 1 },
    { id: "gender-nota", name: "Specify Gender", nota: true, sequence: 2 },
  ];

  beforeEach(() => {
    queryClient.clear();
    queryClient.setQueryData(["/api/options/gender"], genderOptions);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    queryClient.clear();
    container.remove();
  });

  it("loads configured gender options and requires text for Specify Gender", async () => {
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <DependentGenderFields
            idPrefix="test-dependent"
            gender="gender-nota"
            genderNota=""
            currentDesignation="Existing designation"
            onGenderChange={vi.fn()}
            onGenderNotaChange={vi.fn()}
          />
        </QueryClientProvider>,
      );
    });

    const requiredInput = container.querySelector<HTMLInputElement>(
      "#test-dependent-gender-nota",
    );
    expect(container.textContent).toContain("Current designation: Existing designation");
    expect(requiredInput).not.toBeNull();
    expect(requiredInput?.required).toBe(true);
  });

  it("does not require a specification for a configured gender option", async () => {
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <DependentGenderFields
            idPrefix="regular-dependent"
            gender="gender-female"
            genderNota=""
            onGenderChange={vi.fn()}
            onGenderNotaChange={vi.fn()}
          />
        </QueryClientProvider>,
      );
    });

    expect(
      container.querySelector("#regular-dependent-gender-nota"),
    ).toBeNull();
  });
});
