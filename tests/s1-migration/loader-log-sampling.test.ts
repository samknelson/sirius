import { readFileSync, readdirSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const io = vi.hoisted(() => ({ sample: vi.fn(), env: vi.fn() }));
vi.mock("../../server/storage/db", () => ({ db: {} }));
vi.mock("../../server/storage/middleware/logging", () => ({ setStorageLogSampling: io.sample }));
vi.mock("../../scripts/s1-migration/lib/script-env", () => ({ getEnvironmentVariable: io.env }));

beforeEach(() => {
  vi.resetModules();
  io.sample.mockReset().mockResolvedValue(undefined);
  io.env.mockReset();
});

describe("loader sampling activation", () => {
  it.each([undefined, "0", "1", "7"])("waits for authorization before reporting sample %s", async raw => {
    io.env.mockImplementation(name => name === "S1_LOADER_LOG_SAMPLE" ? raw : undefined);
    let release!: () => void;
    io.sample.mockReturnValueOnce(new Promise<void>(resolve => { release = resolve; }));
    const output = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { throttleStorageOpLogs } = await import("../../scripts/s1-migration/lib/loader-utils");
      const activation = throttleStorageOpLogs();
      expect(io.sample).toHaveBeenCalledWith(raw == null ? 0 : Number(raw));
      expect(output).not.toHaveBeenCalled();
      release();
      await activation;
      expect(output).toHaveBeenCalledOnce();
    } finally { output.mockRestore(); }
  });

  it("propagates refusal and never reports successful suppression", async () => {
    io.sample.mockRejectedValue(new Error("maintenance required"));
    const output = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { throttleStorageOpLogs } = await import("../../scripts/s1-migration/lib/loader-utils");
      await expect(throttleStorageOpLogs()).rejects.toThrow("maintenance required");
      expect(output).not.toHaveBeenCalled();
    } finally { output.mockRestore(); }
  });

  it("awaits activation before any other async work in every sampling loader", () => {
    const dir = new URL("../../scripts/s1-migration/", import.meta.url);
    const callers = readdirSync(dir).filter(name => /^load-.*\.ts$/.test(name))
      .map(name => readFileSync(new URL(name, dir), "utf8"))
      .filter(source => source.includes("throttleStorageOpLogs()"));
    expect(callers.length).toBe(14);
    for (const source of callers) {
      expect(source).toMatch(/async function main\(\) \{\s+const startedAt = new Date\(\);\s+await throttleStorageOpLogs\(\);/);
      expect(source.match(/throttleStorageOpLogs\(\)/g)).toHaveLength(1);
    }
  });
});
