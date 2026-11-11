import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  execute: vi.fn(),
  transaction: vi.fn(),
  oldColorColumnExists: true,
  legacyColors: [{ color: "#112233" }, { color: "#ABCDEF" }],
}));

vi.mock("../../server/db", () => ({
  db: {
    transaction: state.transaction,
    execute: state.execute,
  },
}));
vi.mock("../../server/services/migration-runner", () => ({
  registerMigration: vi.fn(),
}));

import migration from "../../scripts/migrate/core/1207_normalize_trust_benefit_colors";

describe("normalize trust benefit colors migration", () => {
  beforeEach(() => {
    state.execute.mockReset();
    state.transaction.mockReset();
    state.oldColorColumnExists = true;
    state.legacyColors = [{ color: "#112233" }, { color: "#ABCDEF" }];
    state.execute.mockImplementation(async () => {
      const call = state.execute.mock.calls.length;
      if (call === 3) {
        return { rows: [{ exists: state.oldColorColumnExists }] };
      }
      if (call === 4 && state.oldColorColumnExists) {
        return { rows: state.legacyColors };
      }
      return { rows: [] };
    });
    state.transaction.mockImplementation(async (callback: (tx: { execute: typeof state.execute }) => unknown) =>
      callback({ execute: state.execute }),
    );
  });

  it("reuses each distinct legacy color and drops raw storage only after backfilling", async () => {
    await migration.up();
    expect(state.execute).toHaveBeenCalledTimes(10);
    expect(state.execute.mock.calls[4][0].queryChunks).toBeDefined();
    expect(state.execute.mock.calls[5][0].queryChunks).toBeDefined();
    // Calls 6–7 backfill references and remove the legacy column, then FK/index
    // setup follows. The whole sequence runs inside one transaction.
    expect(state.transaction).toHaveBeenCalledTimes(1);
    expect(state.execute.mock.calls[6][0].queryChunks).toBeDefined();
    expect(state.execute.mock.calls[7][0].queryChunks).toBeDefined();
  });

  it("supports databases where both earlier raw-color migrations were skipped", async () => {
    state.oldColorColumnExists = false;
    await migration.up();
    expect(state.execute).toHaveBeenCalledTimes(5);
    expect(state.transaction).toHaveBeenCalledTimes(1);
  });

  it("refuses unsupported legacy values without dropping their original column", async () => {
    state.legacyColors = [{ color: "not-a-hex-color" }];
    await expect(migration.up()).rejects.toThrow(/unsupported color value/);
    expect(state.execute).toHaveBeenCalledTimes(4);
  });
});
