import { describe, expect, it, vi } from "vitest";
import { createLatestSaveQueue } from "../../client/src/pages/sitespecific/bao/dc-attestation-queue";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("DC attestation save queue", () => {
  it("coalesces rapid edits into the latest complete value", async () => {
    vi.useFakeTimers();
    try {
      const save = vi.fn(async (value: string) => value);
      const queue = createLatestSaveQueue({ delayMs: 50, save });

      queue.enqueue("first");
      queue.enqueue("latest");
      await vi.advanceTimersByTimeAsync(50);

      expect(save).toHaveBeenCalledTimes(1);
      expect(save).toHaveBeenCalledWith("latest");
      queue.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("persists a newer edit after an earlier in-flight save fails", async () => {
    vi.useFakeTimers();
    try {
      const first = deferred<string>();
      const second = deferred<string>();
      const save = vi
        .fn<(value: string) => Promise<string>>()
        .mockReturnValueOnce(first.promise)
        .mockReturnValueOnce(second.promise);
      const onError = vi.fn();
      const queue = createLatestSaveQueue({
        delayMs: 10,
        save,
        onError,
      });

      queue.enqueue("first");
      await vi.advanceTimersByTimeAsync(10);
      queue.enqueue("newer while saving");
      first.reject(new Error("temporary failure"));
      await Promise.resolve();
      await Promise.resolve();
      expect(onError).toHaveBeenCalledWith(
        expect.any(Error),
        "first",
        true,
      );

      await vi.advanceTimersByTimeAsync(10);
      expect(save).toHaveBeenCalledTimes(2);
      expect(save).toHaveBeenLastCalledWith("newer while saving");
      second.resolve("saved");
      await Promise.resolve();
      queue.dispose();
    } finally {
      vi.useRealTimers();
    }
  });
});