// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryObserver, focusManager } from "@tanstack/react-query";
import { liveQueryOptions } from "../../client/src/lib/live-query-options";
import { queryClient } from "../../client/src/lib/queryClient";

afterEach(() => {
  focusManager.setFocused(undefined);
  vi.useRealTimers();
});

describe("live coordination query freshness", () => {
  it("overrides indefinite defaults to pick up changed statuses by polling, returning, and manual refresh", async () => {
    vi.useFakeTimers();
    focusManager.setFocused(true);
    // Use the real application's defaults: without the live overrides, this
    // test keeps the old answer indefinitely instead of silently passing.
    const client = new QueryClient({ defaultOptions: queryClient.getDefaultOptions() });
    client.mount();
    let current = { accepted: null as boolean | null, notified: "pending", inPopulation: true };
    const queryFn = vi.fn(async () => ({ ...current }));
    const options = { ...liveQueryOptions, queryKey: ["coordination"], queryFn };
    const observer = new QueryObserver(client, options);
    let unsubscribe = observer.subscribe(() => {});
    try {
      await vi.advanceTimersByTimeAsync(1);
      expect(observer.getCurrentResult().data).toEqual(current);
      current = { accepted: true, notified: "sent", inPopulation: false };
      await vi.advanceTimersByTimeAsync(30_000);
      expect(observer.getCurrentResult().data).toEqual(current);

      focusManager.setFocused(false);
      current = { accepted: false, notified: "failed", inPopulation: true };
      await vi.advanceTimersByTimeAsync(30_000);
      expect(observer.getCurrentResult().data?.notified).toBe("sent");
      focusManager.setFocused(true);
      await vi.advanceTimersByTimeAsync(1);
      expect(observer.getCurrentResult().data).toEqual(current);

      unsubscribe();
      current = { accepted: null, notified: "none", inPopulation: false };
      const returningObserver = new QueryObserver(client, options);
      unsubscribe = returningObserver.subscribe(() => {});
      await vi.advanceTimersByTimeAsync(1);
      expect(returningObserver.getCurrentResult().data).toEqual(current);
      current = { accepted: true, notified: "sent", inPopulation: true };
      await returningObserver.refetch();
      expect(returningObserver.getCurrentResult().data).toEqual(current);
      expect(queryFn).toHaveBeenCalledTimes(5);
    } finally {
      unsubscribe();
      client.unmount();
      client.clear();
    }
  });
});
