// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { queryClient } from "../../client/src/lib/queryClient";
import { RunProgressView } from "../../client/src/components/wizards/framework/RunProgressView";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("BAO Process browser tracking", () => {
  let container: HTMLDivElement, root: Root;
  let status: string, heartbeat: string | undefined, offline: boolean, problem: string | null, polls: number, posts: number;
  let rowIssues: number;
  const render = () => root.render(<QueryClientProvider client={queryClient}>
    <RunProgressView wizardId="process-fixture" wizardType="bao_monthly_hours" data={{}}
      step={{ id: "process", name: "Process", kind: "run", state: "pending" }} />
  </QueryClientProvider>);
  const advance = async (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
  beforeEach(() => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-08T12:00:00Z"));
    queryClient.clear(); status = "in_progress"; heartbeat = new Date().toISOString();
    offline = false; problem = null; polls = 0; posts = 0; rowIssues = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string, options: any) => {
      if (options?.method === "POST") posts++;
      if (offline) throw new Error("offline");
      if (url.includes("/dispatch/")) return new Response(JSON.stringify({ persistenceProblem: problem }));
      polls++;
      return new Response(JSON.stringify({ data: { progress: { process: {
        status, heartbeatAt: heartbeat, runId: "safe-run", protocol: "bao-process-v1",
        phase: status === "failed" ? "execution-failed" : "rows", processed: 1200, total: 2009,
        rowIssues, partialPostingRisk: rowIssues > 0,
        error: status === "failed" ? "Processing failed. Some records may already be posted. Do not resubmit." : undefined,
      } } } }));
    }));
    container = document.createElement("div"); document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    queryClient.clear(); container.remove(); vi.unstubAllGlobals(); vi.useRealTimers();
  });

  it("tracks long runs and refresh without resubmitting, then shows durable completion", async () => {
    await act(async () => render()); await advance(20);
    expect(container.textContent).toContain("1200/2009 rows");
    await advance(300_000);
    expect(polls).toBeGreaterThan(60);
    expect(container.textContent).toContain("heartbeat is stale");
    expect(container.textContent).not.toContain("Process failed");
    expect((container.querySelector("button") as HTMLButtonElement).disabled).toBe(true);
    await act(async () => root.unmount()); root = createRoot(container);
    await act(async () => render()); await advance(20);
    expect(container.textContent).toContain("safe-run");
    status = "completed"; await advance(2200);
    expect(container.textContent).toContain("Run complete");
    expect((container.querySelector("button") as HTMLButtonElement).disabled).toBe(true);
    expect(posts).toBe(0);
  });

  it("distinguishes missing heartbeat, polling failures, persistence failures and execution failures", async () => {
    heartbeat = undefined;
    await act(async () => render()); await advance(20);
    expect(container.textContent).toContain("heartbeat is missing");
    offline = true; await advance(2200);
    expect(container.textContent).toContain("browser polling problem");
    expect(container.textContent).not.toContain("Process failed");
    offline = false; problem = "Final status could not be saved. Do not resubmit."; await advance(2200);
    expect(container.textContent).not.toContain("browser polling problem");
    expect(container.textContent).toContain("Final status could not be saved");
    problem = null; status = "failed"; await advance(2200);
    expect(container.textContent).toContain("Processing failed");
    expect(container.textContent).toContain("already be posted");
    expect(posts).toBe(0);
  });

  it("recovers from an initial polling error without admitting another run", async () => {
    offline = true; await act(async () => render()); await advance(20);
    expect(container.textContent).toContain("Cannot read Process status");
    expect((container.querySelector("button") as HTMLButtonElement).disabled).toBe(true);
    offline = false; await advance(2200);
    expect(container.textContent).toContain("1200/2009 rows");
    expect(container.textContent).not.toContain("Cannot read Process status");
    expect(posts).toBe(0);
  });

  it("shows durable completion with row issues without offering a repeat run", async () => {
    status = "completed"; rowIssues = 3;
    await act(async () => render()); await advance(20);
    expect(container.textContent).toContain("finished with 3 row issues");
    expect(container.textContent).toContain("Review the saved results");
    expect((container.querySelector("button") as HTMLButtonElement).disabled).toBe(true);
    expect(posts).toBe(0);
  });
});
