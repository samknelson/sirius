import { describe, expect, it } from "vitest";
import {
  findExtraTables,
  isOneoffScratchTable,
} from "../../server/services/schema-drift-check";

describe("oneoff schema-drift scratch namespace", () => {
  it("recognizes only the reserved oneoff_ table prefix", () => {
    expect(isOneoffScratchTable("oneoff_test")).toBe(true);
    expect(isOneoffScratchTable("oneoff_any_future_scratch_table")).toBe(true);
    expect(isOneoffScratchTable("oneoff")).toBe(false);
    expect(isOneoffScratchTable("test_oneoff_data")).toBe(false);
  });

  it("ignores unmodeled scratch tables but keeps unrelated extras gated", () => {
    expect(
      findExtraTables(
        ["oneoff_test", "oneoff_future_action", "unexpected_table", "modeled_table"],
        new Set(["modeled_table"]),
      ),
    ).toEqual(["unexpected_table"]);
  });

  it("does not exempt a declared oneoff_ table from the modeled-table path", () => {
    const declaredTables = new Set(["oneoff_declared_table"]);
    expect(findExtraTables(["oneoff_declared_table"], declaredTables)).toEqual([]);
    expect(isOneoffScratchTable("oneoff_declared_table")).toBe(true);
  });
});