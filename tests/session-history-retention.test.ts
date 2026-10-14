import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fakes = vi.hoisted(() => ({
  countBefore: vi.fn(),
  getExpiredIds: vi.fn(),
  deleteExpired: vi.fn(),
  register: vi.fn(),
  list: vi.fn(),
  enabled: vi.fn(),
  configs: vi.fn(),
  error: vi.fn(),
}));

vi.mock("../server/storage", () => ({
  storage: {
    sessionHistory: {
      countBefore: fakes.countBefore,
      getExpiredIds: fakes.getExpiredIds,
      deleteExpired: fakes.deleteExpired,
    },
    pluginConfigs: { getByKindAndPlugin: fakes.configs },
  },
}));
vi.mock("../server/plugins/system/data-retention/registry", () => ({
  registerDataRetentionPlugin: fakes.register,
  dataRetentionPluginRegistry: { list: fakes.list },
}));
vi.mock("../server/plugins/_core", () => ({ isPluginComponentEnabledSync: fakes.enabled }));
vi.mock("../server/logger", () => ({ logger: { error: fakes.error } }));

import {
  sessionHistoryRetentionPlugin as plugin,
  SESSION_HISTORY_CLEANUP_LIMIT,
} from "../server/plugins/system/data-retention/plugins/sessionHistory";
import { runDataRetention } from "../server/plugins/system/data-retention/sweep";
import { validateAgainstSchema } from "../server/lib/json-schema-validator";

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 9, 5, 12, 0, 0));
  fakes.enabled.mockReturnValue(true);
  fakes.list.mockReturnValue([plugin]);
  fakes.configs.mockResolvedValue([{ enabled: true, data: {} }]);
  fakes.countBefore.mockResolvedValue(3);
  fakes.getExpiredIds.mockResolvedValue(["synthetic-old-a", "synthetic-old-b"]);
  fakes.deleteExpired.mockResolvedValue(true);
});

afterEach(() => vi.useRealTimers());

describe("session history retention", () => {
  it("offers a 1-year default, disabled until the operator opts in", () => {
    expect(plugin.defaultEnabled).toBe(false);
    expect(plugin.getDefaultSettings?.()).toEqual({ retentionDays: 365 });
    expect(plugin.metadata.requiredComponent).toBe("system.session_history");
    expect(plugin.metadata.singleton).toBe(true);
    expect(plugin.configSchema?.properties?.retentionDays).toMatchObject({ default: 365 });
  });

  it("uses the calendar-day cutoff and only counts in a dry run", async () => {
    const result = await plugin.cleanup("test");
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 365);
    expect(fakes.countBefore).toHaveBeenCalledWith(cutoff);
    expect(result.count).toBe(3);
    expect(result.metadata?.retentionDays).toBe(365);
    expect(fakes.getExpiredIds).not.toHaveBeenCalled();
    expect(fakes.deleteExpired).not.toHaveBeenCalled();
  });

  it("passes saved settings through the sweep instead of silently using the default", async () => {
    fakes.configs.mockResolvedValue([{ enabled: true, data: { retentionDays: 30 } }]);
    const result = await runDataRetention({ mode: "test", pluginId: plugin.metadata.id });
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);
    expect(fakes.countBefore).toHaveBeenCalledWith(cutoff);
    expect(result.totalDeleted).toBe(3);
    expect(result.perPlugin[0].metadata?.retentionDays).toBe(30);
  });

  it("caps previewed deletions to the same per-sweep bound as live cleanup", async () => {
    fakes.countBefore.mockResolvedValue(2500);
    const result = await plugin.cleanup("test", { retentionDays: 365 });
    expect(result.count).toBe(SESSION_HISTORY_CLEANUP_LIMIT);
    expect(result.metadata?.eligibleCount).toBe(2500);
    expect(result.message).toContain("of 2500");
    expect(fakes.deleteExpired).not.toHaveBeenCalled();
  });

  it("deletes per record with one shared cutoff and counts only actual deletes", async () => {
    fakes.deleteExpired.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const result = await plugin.cleanup("live", { retentionDays: 7 });
    const cutoff = fakes.getExpiredIds.mock.calls[0][0];
    expect(fakes.getExpiredIds).toHaveBeenCalledWith(cutoff, SESSION_HISTORY_CLEANUP_LIMIT);
    expect(fakes.deleteExpired.mock.calls).toEqual([
      ["synthetic-old-a", cutoff], ["synthetic-old-b", cutoff],
    ]);
    expect(fakes.countBefore).not.toHaveBeenCalled();
    expect(result.count).toBe(1);
    expect(JSON.stringify(result)).not.toContain("synthetic-old");
  });

  it.each([0, -1, 1.5, "30", null, 36501])("rejects invalid stored days %s before table access", async (retentionDays) => {
    await expect(plugin.cleanup("live", { retentionDays })).rejects.toThrow("whole number");
    expect(fakes.countBefore).not.toHaveBeenCalled();
    expect(fakes.getExpiredIds).not.toHaveBeenCalled();
    expect(fakes.deleteExpired).not.toHaveBeenCalled();
    expect(validateAgainstSchema(plugin.configSchema!, { retentionDays }).valid).toBe(false);
  });

  it("skips a disabled component before reading config or touching its optional table", async () => {
    fakes.enabled.mockReturnValue(false);
    const result = await runDataRetention({ mode: "live" });
    expect(result.perPlugin[0].skipped).toBe("component-disabled");
    expect(fakes.configs).not.toHaveBeenCalled();
    expect(fakes.getExpiredIds).not.toHaveBeenCalled();
    expect(fakes.deleteExpired).not.toHaveBeenCalled();
  });

  it.each([
    [[], "no-config"],
    [[{ enabled: false, data: { retentionDays: 365 } }], "config-disabled"],
  ])("does not clean up without an enabled config", async (configs, skipped) => {
    fakes.configs.mockResolvedValue(configs);
    const result = await runDataRetention({ mode: "live" });
    expect(result.perPlugin[0].skipped).toBe(skipped);
    expect(fakes.getExpiredIds).not.toHaveBeenCalled();
    expect(fakes.deleteExpired).not.toHaveBeenCalled();
  });

  it("reports an invalid payload without echoing the payload into logs", async () => {
    const canary = "synthetic-sensitive-config-canary";
    fakes.configs.mockResolvedValue([{ enabled: true, data: { retentionDays: canary } }]);
    const result = await runDataRetention({ mode: "live" });
    expect(result.totalErrored).toBe(1);
    expect(result.perPlugin[0].skipped).toBe("error");
    expect(JSON.stringify([result, fakes.error.mock.calls])).not.toContain(canary);
    expect(fakes.deleteExpired).not.toHaveBeenCalled();
  });

  it("leaves legacy plugins compatible and merges defaults without changing saved settings", async () => {
    const cleanup = vi.fn().mockResolvedValue({ count: 0, message: "Legacy cleanup" });
    fakes.list.mockReturnValue([{ metadata: { id: "legacy" }, cleanup }]);
    const data = { legacyFlag: true };
    fakes.configs.mockResolvedValue([{ enabled: true, data }]);
    await runDataRetention();
    expect(cleanup).toHaveBeenCalledWith("live", { legacyFlag: true });
    expect(data).toEqual({ legacyFlag: true });
  });
});
