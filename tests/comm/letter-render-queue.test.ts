import { afterEach, describe, expect, it, vi } from "vitest";
import { LetterRenderQueue } from "../../server/services/comm/letter-render-queue";

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe("LetterRenderQueue", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("runs one preview concurrently with delivery without taking its slot", async () => {
    const queue = new LetterRenderQueue();
    const deliveryGate = deferred();
    const previewGate = deferred();
    const started: string[] = [];

    const delivery = queue.run(false, async () => {
      started.push("delivery");
      await deliveryGate.promise;
    });
    const preview = queue.run(true, async () => {
      started.push("preview");
      await previewGate.promise;
    });
    const nextDelivery = queue.run(false, async () => {
      started.push("next delivery");
    });
    await Promise.resolve();

    expect(started).toEqual(["delivery", "preview"]);
    previewGate.resolve();
    await preview;
    expect(started).toEqual(["delivery", "preview"]);

    deliveryGate.resolve();
    await Promise.all([delivery, nextDelivery]);
    expect(started).toEqual(["delivery", "preview", "next delivery"]);
  });

  it("releases a delivery slot when its task rejects", async () => {
    const queue = new LetterRenderQueue();
    const failureGate = deferred();
    const started: string[] = [];

    const failed = queue.run(false, async () => {
      started.push("failed");
      await failureGate.promise;
      throw new Error("render failed");
    });
    const recovered = queue.run(false, async () => {
      started.push("recovered");
      return "pdf";
    });
    await Promise.resolve();
    expect(started).toEqual(["failed"]);

    failureGate.resolve();
    await expect(failed).rejects.toThrow("render failed");
    await expect(recovered).resolves.toBe("pdf");
    expect(started).toEqual(["failed", "recovered"]);
  });

  it("bounds waiting work and removes timed-out waiters", async () => {
    vi.useFakeTimers();
    const queue = new LetterRenderQueue({
      maxWaitingPerLane: 1,
      waitTimeoutMs: 50,
    });
    const activeGate = deferred();

    const active = queue.run(false, () => activeGate.promise);
    const timedOut = queue.run(false, async () => "stale");
    const overload = queue.run(false, async () => "overload");
    await expect(overload).rejects.toThrow("delivery queue is full");

    const timeoutRejection = expect(timedOut).rejects.toThrow(
      "Timed out waiting for the letter renderer delivery queue",
    );
    await vi.advanceTimersByTimeAsync(50);
    await timeoutRejection;

    const replacement = queue.run(false, async () => "replacement");
    activeGate.resolve();
    await active;
    await expect(replacement).resolves.toBe("replacement");
  });
});