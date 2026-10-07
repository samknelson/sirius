// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GbhetValidate } from "../../client/src/components/wizards/framework/GbhetValidate";
import { queryClient } from "../../client/src/lib/queryClient";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("Validate browser polling with real React Query", () => {
  let container: HTMLDivElement;
  let root: Root;
  let status: "in_progress" | "completed" | "failed";
  let offline: boolean;
  let polls: number;
  const result = { totalRows: 2000, validRows: 2000, invalidRows: 0, errors: [], errorSummary: {} };
  const render = () => root.render(
    <QueryClientProvider client={queryClient}>
      <GbhetValidate wizardId="polling-fixture" wizardType="bao_monthly_hours" step={{ id: "validate" } as any} />
    </QueryClientProvider>,
  );
  const advance = async (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-07T12:00:00Z"));
    status = "in_progress"; offline = false; polls = 0;
    queryClient.clear();
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.includes("/dispatch/")) {
        return new Response(JSON.stringify({ validationResults: null, existingMappings: [] }),
          { headers: { "Content-Type": "application/json" } });
      }
      polls++;
      if (offline) throw new Error("Network offline");
      return new Response(JSON.stringify({ data: {
        progress: { validate: { status, heartbeatAt: new Date().toISOString(), error: status === "failed" ? "Results could not be saved" : null } },
        validationResults: status === "completed" ? result : null,
      } }), { headers: { "Content-Type": "application/json" } });
    }));
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    queryClient.clear();
    container.remove();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("continues beyond four minutes, survives remount, and shows the newly persisted terminal results", async () => {
    await act(async () => render());
    await advance(10);
    expect(container.textContent).toContain("Validating data");
    await advance(300_000);
    expect(polls).toBeGreaterThan(60);
    expect(container.textContent).not.toContain("Validation may have stopped");
    expect(container.textContent).not.toContain("Validation Failed");
    await act(async () => root.unmount());
    root = createRoot(container);
    await act(async () => render());
    await advance(10);
    expect(container.textContent).toContain("Validating data");
    status = "completed";
    await advance(4010);
    expect(container.querySelector('[data-testid="text-total-rows"]')?.textContent).toBe("2,000");
    expect(container.textContent).not.toContain("Validating data");
  });

  it("keeps polling after an initial request failure and recovers without starting another run", async () => {
    offline = true;
    await act(async () => render());
    await advance(1500);
    expect(container.textContent).toContain("Cannot read validation status");
    const previousPolls = polls;
    offline = false;
    await advance(4010);
    expect(polls).toBeGreaterThan(previousPolls);
    expect(container.textContent).toContain("Validating data");
    expect(container.textContent).not.toContain("Cannot read validation status");
    expect(container.textContent).not.toContain("Validation Failed");
  });

  it("keeps a background polling failure separate from an eventual server-side failure", async () => {
    await act(async () => render());
    await advance(10);
    offline = true;
    await advance(6000);
    expect(container.textContent).toContain("Cannot read validation status");
    expect(container.textContent).not.toContain("Validation Failed");
    offline = false;
    status = "failed";
    await advance(5010);
    expect(container.textContent).toContain("Validation Failed");
    expect(container.textContent).toContain("Results could not be saved");
  });
});
