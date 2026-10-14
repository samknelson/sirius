import { describe, expect, it, vi } from "vitest";
import { ConfigurationCoherency } from "../../server/services/configuration-coherency";

describe("shared configuration coordination", () => {
  it("uses one five-second infrastructure timer and never overlaps slow polls", async () => {
    vi.useFakeTimers();
    try {
      let finish!: (value: Record<string, string>) => void;
      const read = vi.fn().mockReturnValueOnce(new Promise(resolve => { finish = resolve; })).mockResolvedValue({});
      const c = new ConfigurationCoherency(read, fn => fn(), () => {});
      c.start();
      c.start();
      expect(vi.getTimerCount()).toBe(1);
      await vi.advanceTimersByTimeAsync(15_000);
      expect(read).toHaveBeenCalledOnce();
      finish({});
      await vi.advanceTimersByTimeAsync(0);
      expect(read).toHaveBeenCalledTimes(2);
      c.stop();
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });
  it("coalesces generations, retries failed dependencies, and preserves completed siblings", async () => {
    let revision = "1";
    const env = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(undefined);
    const files = vi.fn();
    const lazy = vi.fn();
    const c = new ConfigurationCoherency(async () => ({ global: revision }), fn => fn(), () => {});
    c.register({ id: "lazy", scopes: [], invalidate: lazy });
    c.register({ id: "env", scopes: [], refresh: env });
    c.register({ id: "files", scopes: [], after: ["env"], refresh: files });
    expect((await c.poll()).filter(r => !r.ok).map(r => r.id)).toEqual(["env", "files"]);
    expect(files).not.toHaveBeenCalled();
    await c.poll();
    expect(lazy).toHaveBeenCalledOnce();
    expect(env).toHaveBeenCalledTimes(2);
    expect(files).toHaveBeenCalledOnce();
    expect(await c.poll()).toEqual([]);
    revision = "90071992547409931234";
    await c.poll();
    expect(lazy).toHaveBeenCalledTimes(2);
  });

  it("invalidates lazy participants before active reads and keeps component checks on every tick", async () => {
    const order: string[] = [];
    const c = new ConfigurationCoherency(async () => ({}), fn => fn(), () => {});
    c.register({ id: "component", scopes: [], everyPoll: true, refresh: async () => { order.push("component"); } });
    c.register({ id: "lazy", scopes: ["plugins"], invalidate: () => { order.push("drop"); } });
    c.register({ id: "active", scopes: ["plugins"], refresh: async () => { order.push("active"); } });
    await c.poll();
    expect(order).toEqual(["drop", "component", "active"]);
    await c.poll();
    expect(order.slice(3)).toEqual(["component"]);
  });

  it("serializes polls outside ambient context and observes commits made during an older poll", async () => {
    let release!: (value: Record<string, string>) => void;
    const read = vi.fn().mockReturnValueOnce(new Promise(resolve => { release = resolve; })).mockResolvedValue({ global: "2" });
    const outside = vi.fn(fn => fn());
    const refresh = vi.fn();
    const c = new ConfigurationCoherency(read, outside, () => {});
    c.register({ id: "active", scopes: [], refresh });
    const old = c.poll();
    const joined = c.poll();
    expect(read).toHaveBeenCalledOnce();
    const committed = c.refreshCommitted();
    release({ global: "1" });
    await Promise.all([old, joined, committed]);
    expect(read).toHaveBeenCalledTimes(2);
    expect(outside).toHaveBeenCalledTimes(2);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("keeps a failed revision read pending without changing confirmed participant state", async () => {
    const read = vi.fn().mockResolvedValueOnce({ environment: "1" }).mockRejectedValueOnce(new Error("db unavailable")).mockResolvedValue({ environment: "2" });
    const drop = vi.fn();
    const c = new ConfigurationCoherency(read, fn => fn(), () => {});
    c.register({ id: "env", scopes: ["environment"], invalidate: drop });
    await c.poll();
    await expect(c.poll()).rejects.toThrow("db unavailable");
    expect(drop).toHaveBeenCalledOnce();
    await c.poll();
    expect(drop).toHaveBeenCalledTimes(2);
  });

  it("does not reload cron for unrelated configuration scopes", async () => {
    let revisions = { cron: "1", environment: "1" };
    const cron = vi.fn();
    const c = new ConfigurationCoherency(async () => revisions, fn => fn(), () => {});
    c.register({ id: "cron", scopes: ["cron"], refresh: cron });
    await c.poll();
    revisions = { ...revisions, environment: "2" };
    await c.poll();
    expect(cron).toHaveBeenCalledOnce();
    revisions = { ...revisions, cron: "2" };
    await c.poll();
    expect(cron).toHaveBeenCalledTimes(2);
  });
});
