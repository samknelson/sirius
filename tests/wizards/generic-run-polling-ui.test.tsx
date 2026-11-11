// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { queryClient } from "../../client/src/lib/queryClient";
import { RunProgressView } from "../../client/src/components/wizards/framework/RunProgressView";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("generic run recovery controls", () => {
  let container: HTMLDivElement;
  let root: Root;
  let status: string;
  let heartbeat: string | undefined;
  let unreadable: boolean;
  let posts: number;

  const render = (retrySafe: boolean) => root.render(
    <QueryClientProvider client={queryClient}>
      <RunProgressView wizardId="generic-run-fixture" wizardType="fixture" data={{}}
        step={{
          id: "run", name: "Run", kind: "run", state: "pending", retrySafe,
          progress: { status, heartbeatAt: heartbeat, error: status === "failed" ? "Saved failure" : undefined },
        }} />
    </QueryClientProvider>,
  );
  const settle = async () => {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
  };

  beforeEach(() => {
    status = "failed";
    heartbeat = new Date().toISOString();
    unreadable = false;
    posts = 0;
    queryClient.clear();
    vi.stubGlobal("fetch", vi.fn(async (_url: string, options?: any) => {
      if (options?.method === "POST") {
        posts++;
        return new Response(JSON.stringify({ started: true }), { status: 202 });
      }
      if (unreadable) throw new Error("network offline");
      return new Response(JSON.stringify({ data: { progress: { run: {
        status, heartbeatAt: heartbeat, error: status === "failed" ? "Saved failure" : undefined,
        runId: "current-run",
      } } } }), { headers: { "Content-Type": "application/json" } });
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
  });

  it("offers retry only for a confirmed failure on a step declared safe", async () => {
    await act(async () => {
      render(true);
    });
    await settle();
    expect(container.textContent).toContain("Saved failure");
    const retry = container.querySelector('[data-testid="button-run-wizard"]') as HTMLButtonElement;
    expect(retry.textContent).toContain("Retry run");
    expect(retry.disabled).toBe(false);
    await act(async () => retry.click());
    expect(posts).toBe(1);
  });

  it("keeps failed side-effecting runs on a manual recovery path", async () => {
    await act(async () => {
      render(false);
    });
    await settle();
    expect(container.textContent).toContain("not marked safe to repeat");
    const button = container.querySelector('[data-testid="button-run-wizard"]') as HTMLButtonElement;
    expect(button.textContent).toContain("Manual recovery required");
    expect(button.disabled).toBe(true);
    expect(posts).toBe(0);
  });

  it("does not treat stale progress as failure or allow another run", async () => {
    status = "in_progress";
    heartbeat = new Date(Date.now() - 180_000).toISOString();
    await act(async () => {
      render(true);
    });
    await settle();
    expect(container.textContent).toContain("stale");
    expect(container.textContent).not.toContain("The run failed");
    expect((container.querySelector('[data-testid="button-run-wizard"]') as HTMLButtonElement).disabled).toBe(true);
    expect(posts).toBe(0);
  });

  it("keeps unreadable status separate from failure and disables retry", async () => {
    unreadable = true;
    await act(async () => {
      render(true);
    });
    await settle();
    expect(container.textContent).toContain("Cannot read this run's current status");
    expect(container.textContent).not.toContain("The run failed");
    expect((container.querySelector('[data-testid="button-run-wizard"]') as HTMLButtonElement).disabled).toBe(true);
    expect(posts).toBe(0);
  });
});
