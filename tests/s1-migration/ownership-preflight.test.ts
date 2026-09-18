import { describe, expect, it, vi } from "vitest";
import { createInFlightCoalescer } from "../../server/modules/s1-migration";

describe("S1 ownership preflight coalescing", () => {
  it("shares one execution for simultaneous callers, but not completed results", async () => {
    const coalesce = createInFlightCoalescer<{ value: number }>();
    let release!: (value: { value: number }) => void;
    const factory = vi.fn(() => new Promise<{ value: number }>((resolve) => { release = resolve; }));

    const first = coalesce(factory);
    const second = coalesce(factory);
    expect(second).toBe(first);
    expect(factory).toHaveBeenCalledTimes(1);

    release({ value: 1 });
    await expect(first).resolves.toEqual({ value: 1 });

    const later = coalesce(async () => ({ value: 2 }));
    await expect(later).resolves.toEqual({ value: 2 });
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it("clears the in-flight slot after failure so a changed snapshot is retried", async () => {
    const coalesce = createInFlightCoalescer<number>();
    const failing = vi.fn(async () => { throw new Error("snapshot failed"); });
    await expect(coalesce(failing)).rejects.toThrow("snapshot failed");

    const retry = vi.fn(async () => 7);
    await expect(coalesce(retry)).resolves.toBe(7);
    expect(failing).toHaveBeenCalledTimes(1);
    expect(retry).toHaveBeenCalledTimes(1);
  });
});