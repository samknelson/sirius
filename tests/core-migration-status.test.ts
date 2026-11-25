import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  getByName: vi.fn(),
  getMigrations: vi.fn(),
  register: vi.fn(),
}));
vi.mock("../server/storage", () => ({ storage: { variables: { getByName: state.getByName } } }));
vi.mock("../server/services/boot/migration-runner", () => ({ getMigrations: state.getMigrations }));
vi.mock("../server/plugins/system/status/registry", () => ({ registerSystemStatusPlugin: state.register }));

let plugin: typeof import("../server/plugins/system/status/plugins/core-migrations").coreMigrationStatusPlugin;

const migrations = Array.from({ length: 8 }, (_, i) => ({
  version: 100 + i, name: `script-${i}`, description: `Description ${i}`,
  up: vi.fn(),
}));
beforeEach(async () => {
  state.getMigrations.mockReturnValue([...migrations]);
  state.getByName.mockReset().mockResolvedValue({ value: 107 });
  // Vitest clears import-time mock calls before each test. Re-evaluate the
  // module after that cleanup so registration is observed, not replayed.
  state.register.mockClear();
  vi.resetModules();
  ({ coreMigrationStatusPlugin: plugin } = await import("../server/plugins/system/status/plugins/core-migrations"));
});

describe("core migration system status", () => {
  it("registers an immediate plugin with a details view", () => {
    expect(state.register).toHaveBeenCalledTimes(1);
    expect(state.register).toHaveBeenCalledWith(plugin);
    expect(plugin.scanMode).toBe("immediate");
    expect(plugin.details).toBeTypeOf("function");
  });
  it("reports matching versions without warnings or execution-history claims", async () => {
    const messages = await plugin.scan();
    expect(messages.every(m => m.priority === "info")).toBe(true);
    expect(messages[0].title).toContain("matches");
    expect(messages[0].details).toContain("Pending core migrations: 0");
    expect(messages.at(-1)?.details).toContain("not per-script execution history");
    expect(messages.at(-1)?.details).toContain("never deployed");
  });
  it("reports every pending script even beyond the five-row window", async () => {
    state.getByName.mockResolvedValue({ value: 99 });
    const messages = await plugin.scan();
    expect(messages[0]).toMatchObject({ priority: "warning" });
    expect(messages[0].title).toContain("behind");
    expect(messages[1].details).toContain("100: script-0");
    expect(messages[1].details).toContain("107: script-7");
    const detail = await plugin.details!();
    const rows = detail.groups[1].rows;
    expect(rows).toHaveLength(5);
    expect(rows.map(r => r.label)).toEqual([107, 106, 105, 104, 103].map(v => `${v}: script-${v - 100}`));
    expect(rows.every(r => r.value === "Pending")).toBe(true);
  });
  it("warns when the database is ahead", async () => {
    state.getByName.mockResolvedValue({ value: 108 });
    expect((await plugin.scan())[0].title).toContain("ahead");
    expect((await plugin.details!()).groups[1].rows.every(r => r.value === "Covered by database version")).toBe(true);
  });
  it.each([null, "107", -1, 1.5, {}, NaN, Infinity])("identifies malformed version %j without exposing it", async value => {
    state.getByName.mockResolvedValue({ value });
    const messages = await plugin.scan();
    expect(messages[0].title).toContain("Invalid migrations_version");
    expect(messages[0].details).toContain("Pending core migrations: unknown");
    expect((await plugin.details!()).groups[1].rows[0].value).toContain("Unknown");
  });
  it("reports a missing version separately from zero", async () => {
    state.getByName.mockResolvedValue(undefined);
    expect((await plugin.scan())[0].title).toContain("Missing");
    state.getByName.mockResolvedValue({ value: 0 });
    expect((await plugin.scan())[0].title).toContain("behind");
  });
  it("reports an empty registry rather than claiming success", async () => {
    state.getMigrations.mockReturnValue([]);
    expect((await plugin.scan())[0]).toMatchObject({ priority: "warning", title: "No core migration scripts registered in this build" });
    expect((await plugin.details!()).groups[1].rows).toEqual([]);
  });
  it("rereads storage once per scan or detail request", async () => {
    await plugin.scan();
    state.getByName.mockResolvedValue({ value: 104 });
    const detail = await plugin.details!();
    expect(detail.groups[1].rows[2].value).toBe("Pending");
    expect(detail.groups[1].rows[3].value).toBe("Covered by database version");
    expect(state.getByName).toHaveBeenCalledTimes(2);
    expect(state.getByName).toHaveBeenCalledWith("migrations_version");
    expect(migrations.every(m => m.up.mock.calls.length === 0)).toBe(true);
  });
});
