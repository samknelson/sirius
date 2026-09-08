import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { createLatestSaveQueue } from "../../client/src/pages/sitespecific/bao/dc-attestation-queue";
import { renderToStaticMarkup } from "react-dom/server";
import {
  DC_ATTESTATION_CONTROL_ORDER,
  DcReadinessSavingStatus,
} from "../../client/src/pages/sitespecific/bao/dc-readiness-presentation";

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
        expect.any(Function),
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

  it("keeps an edit enqueued during asynchronous failure recovery", async () => {
    vi.useFakeTimers();
    try {
      const first = deferred<string>();
      const second = deferred<string>();
      const recovery = deferred<void>();
      const save = vi
        .fn<(value: string) => Promise<string>>()
        .mockReturnValueOnce(first.promise)
        .mockReturnValueOnce(second.promise);
      const queue = createLatestSaveQueue({
        delayMs: 10,
        save,
        onError: async () => recovery.promise,
      });

      queue.enqueue("first");
      await vi.advanceTimersByTimeAsync(10);
      first.reject(new Error("temporary failure"));
      await Promise.resolve();
      queue.enqueue("during recovery");
      recovery.resolve();
      await Promise.resolve();
      await Promise.resolve();

      await vi.advanceTimersByTimeAsync(10);
      expect(save).toHaveBeenLastCalledWith("during recovery");
      second.resolve("saved");
      await Promise.resolve();
      queue.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not invoke lifecycle callbacks after disposal", async () => {
    vi.useFakeTimers();
    try {
      const request = deferred<string>();
      const save = vi.fn(() => request.promise);
      const onSuccess = vi.fn();
      const onSettled = vi.fn();
      const queue = createLatestSaveQueue({
        delayMs: 10,
        save,
        onSuccess,
        onSettled,
      });

      queue.enqueue("old case");
      await vi.advanceTimersByTimeAsync(10);
      queue.dispose();
      request.resolve("saved");
      await Promise.resolve();
      await Promise.resolve();

      expect(onSuccess).not.toHaveBeenCalled();
      expect(onSettled).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("DC readiness checklist presentation", () => {
  it("always reserves the saving status row while only announcing pending saves", () => {
    const idle = renderToStaticMarkup(createElement(DcReadinessSavingStatus, { pending: false }));
    const saving = renderToStaticMarkup(createElement(DcReadinessSavingStatus, { pending: true }));

    expect(idle).toContain("min-h-5");
    expect(saving).toContain("min-h-5");
    expect(idle).toContain('role="status"');
    expect(idle).not.toContain("Saving checklist changes");
    expect(saving).toContain("Saving checklist changes…");
  });

  it("keeps the optional restrictions attestation after every required control", () => {
    expect(DC_ATTESTATION_CONTROL_ORDER.at(-1)).toBe("restrictionsNoted");
    expect(DC_ATTESTATION_CONTROL_ORDER.slice(0, -1)).toEqual([
      "dcFormOnFile",
      "signed",
      "doctorAddress",
      "doctorPhone",
      "dates",
    ]);
  });
});
