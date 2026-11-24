import { afterEach, describe, expect, it, vi } from "vitest";
import { hashKey, QueryClient, QueryObserver } from "@tanstack/react-query";
import { DashboardRefreshState } from "../../client/src/plugins/dashboard/refresh-state";
import { dashboardRefreshSchema } from "@shared/dashboard-refresh";

const clients: QueryClient[] = [];
afterEach(() => { clients.splice(0).forEach(client => client.clear()); });
function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  const state = new DashboardRefreshState(client);
  const unsubscribe = state.subscribe(() => {});
  return { client, state, unsubscribe };
}

describe("dashboard refresh boundaries", () => {
  it("defaults old configurations to off and refuses unsafe intervals", () => {
    expect(dashboardRefreshSchema.parse({})).toEqual({ autoRefresh: false, refreshIntervalSeconds: 30 });
    for (const interval of [0, -1, 9, 10.5, "30", null, 86401]) {
      expect(dashboardRefreshSchema.safeParse({ refreshIntervalSeconds: interval }).success).toBe(false);
    }
    expect(dashboardRefreshSchema.parse({ autoRefresh: true, refreshIntervalSeconds: 10 }).autoRefresh).toBe(true);
  });

  it("refreshes only registered active queries and reuses an existing request", async () => {
    const { client, state, unsubscribe } = setup();
    let finish!: (value: number) => void;
    const request = vi.fn(() => new Promise<number>(resolve => { finish = resolve; }));
    const active = new QueryObserver(client, { queryKey: ["instance-a", "today"], queryFn: request });
    const stop = active.subscribe(() => {});
    const unregister = state.register(hashKey(["instance-a", "today"]));
    const otherFn = vi.fn(async () => 4);
    await client.fetchQuery({ queryKey: ["instance-b", "today"], queryFn: otherFn });
    await client.fetchQuery({ queryKey: ["instance-a", "yesterday"], queryFn: otherFn });
    const refresh = state.refresh();
    expect(request).toHaveBeenCalledTimes(1);
    finish(1);
    await refresh;
    expect(otherFn).toHaveBeenCalledTimes(2);
    unregister();
    await state.refresh();
    expect(request).toHaveBeenCalledTimes(1);
    stop();
    unsubscribe();
  });

  it("does not mislabel partial success or a new selection with an old timestamp", async () => {
    const { client, state, unsubscribe } = setup();
    const a = ["a"], b = ["b"], next = ["next"];
    const unA = state.register(hashKey(a));
    const unB = state.register(hashKey(b));
    client.setQueryData(a, { count: 1 }, { updatedAt: 100 });
    // A registered pending query counts even before it has returned data.
    const observer = new QueryObserver(client, { queryKey: b, enabled: false });
    const stop = observer.subscribe(() => {});
    expect(state.read().lastSuccess).toBe(0);
    client.setQueryData(b, { count: 2 }, { updatedAt: 200 });
    expect(state.read().lastSuccess).toBe(100);
    await client.fetchQuery({ queryKey: a, queryFn: () => Promise.reject(new Error("network")) }).catch(() => {});
    expect(state.read()).toMatchObject({ error: true, lastSuccess: 100 });
    unA(); unB();
    const unNext = state.register(hashKey(next));
    expect(state.read().lastSuccess).toBe(0);
    unNext(); stop(); unsubscribe();
  });

  it("latches access refusal after children unregister, without a remount loop", () => {
    const { client, state, unsubscribe } = setup();
    const key = ["current-user", "current-config"];
    const unregister = state.register(hashKey(key));
    client.setQueryData(key, { secret: "previous data" });
    client.setQueryData(key, null);
    expect(state.read().denied).toBe(true);
    unregister();
    expect(state.read().denied).toBe(true);
    expect(state.read().lastSuccess).toBe(0);
    // A different instance has no access to this refusal or its data.
    const other = new DashboardRefreshState(client);
    expect(other.read()).toMatchObject({ denied: false, count: 0, lastSuccess: 0 });
    unsubscribe();
  });
});
