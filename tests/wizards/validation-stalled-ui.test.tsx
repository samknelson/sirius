// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const queryState = vi.hoisted(() => ({
  wizard: { data: { progress: { validate: { status: "in_progress", heartbeatAt: "", error: "" } }, validationResults: null as any } },
  pollingError: null as Error | null,
  refresh: vi.fn(),
}));
vi.mock("@tanstack/react-query", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-query")>("@tanstack/react-query");
  return {
    ...actual,
    useQuery: (options: { queryKey: unknown[] }) =>
      options.queryKey.length === 1
        ? { data: queryState.wizard, isLoading: false, error: queryState.pollingError, refetch: queryState.refresh }
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
    queryState.wizard.data.progress.validate.status = "in_progress";
    queryState.wizard.data.validationResults = null;
    queryState.pollingError = null;
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

  it("keeps a healthy run visible after refresh and beyond four minutes", async () => {
    await act(async () => render());
    for (let i = 0; i < 12; i++) {
      await act(async () => {
        vi.advanceTimersByTime(30_000);
        queryState.wizard.data.progress.validate.heartbeatAt = new Date().toISOString();
        render();
      });
    }
    await act(async () => root.unmount());
    root = createRoot(container);
    await act(async () => render());
    expect(container.textContent).toContain("Validating data");
    expect(container.textContent).not.toContain("Validation Failed");
    expect(container.textContent).not.toContain("Retry validation");
  });

  it("distinguishes polling failure from missing heartbeats and resumes after recovery", async () => {
    await act(async () => render());
    queryState.pollingError = new Error("Network unavailable");
    await act(async () => { vi.advanceTimersByTime(180_000); render(); });
    expect(container.textContent).toContain("Cannot read validation status");
    expect(container.textContent).not.toContain("Validation may have stopped");
    expect(container.textContent).not.toContain("Validation Failed");
    queryState.pollingError = null;
    queryState.wizard.data.progress.validate.heartbeatAt = new Date().toISOString();
    await act(async () => render());
    expect(container.textContent).toContain("Validating data");
    expect(container.textContent).not.toContain("Cannot read validation status");
  });

  it("only shows the terminal failure reported by the server", async () => {
    await act(async () => render());
    queryState.wizard.data.progress.validate.status = "failed";
    queryState.wizard.data.progress.validate.error = "Results could not be saved";
    await act(async () => render());
    expect(container.textContent).toContain("Validation Failed");
    expect(container.textContent).toContain("Results could not be saved");
    expect(container.textContent).not.toContain("Validating data");
  });
});