// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const queryState = vi.hoisted(() => ({
  wizard: { data: { progress: { validate: { status: "in_progress", heartbeatAt: "" } } } },
}));
vi.mock("@tanstack/react-query", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-query")>("@tanstack/react-query");
  return {
    ...actual,
    useQuery: (options: { queryKey: unknown[] }) =>
      options.queryKey.length === 1
        ? { data: queryState.wizard, isLoading: false }
        : { data: { validationResults: null, existingMappings: [] }, isLoading: false },
  };
});
import { GbhetValidate } from "../../client/src/components/wizards/framework/GbhetValidate";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("Validate step abandoned-run recovery", () => {
  let container: HTMLDivElement;
  let root: Root;
  const render = () => root.render(<GbhetValidate wizardId="synthetic" wizardType="bao_monthly_hours" step={{ id: "validate" } as any} />);

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-23T12:00:00.000Z"));
    queryState.wizard.data.progress.validate.heartbeatAt = new Date().toISOString();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  it("shows Retry when a fresh heartbeat expires without any wizard data change or refresh", async () => {
    await act(async () => render());
    expect(container.textContent).toContain("Validating data");
    expect(container.textContent).not.toContain("Retry validation");
    await act(async () => vi.advanceTimersByTime(120_001));
    expect(container.textContent).toContain("Validation may have stopped");
    expect(container.textContent).toContain("Retry validation");
  });
});