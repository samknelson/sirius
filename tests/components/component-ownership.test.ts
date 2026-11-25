import { describe, expect, it } from "vitest";
import { absentOwnedTables, parseComponentOwnership } from "../../shared/component-ownership";

const definition = { id: "example", name: "Example", description: "", enabledByDefault: false };

describe("retained component schema ownership", () => {
  it("preserves only recorded tables of absent components, independent of saved enabled flags", () => {
    const ownership = parseComponentOwnership({
      example: { definition, tables: ["example_rows"] },
      present: { definition: { ...definition, id: "present" }, tables: ["present_rows"] },
    });
    const retained = absentOwnedTables(ownership, new Set(["present"]));
    expect([...retained]).toEqual(["example_rows"]);
    expect(retained.has("example_unrecorded")).toBe(false);
    expect(absentOwnedTables(ownership, new Set(["example", "present"])).size).toBe(0);
  });

  it("normalizes entries recorded when components were grouped into packages", () => {
    const legacy = parseComponentOwnership({
      example: { packageId: "legacy", definition, tables: ["example_rows"] },
      grouped: { packageId: "example-package", definition: { ...definition, id: "grouped" }, tables: [] },
    });
    expect(legacy).toEqual({
      example: { definition, tables: ["example_rows"] },
      grouped: { definition: { ...definition, id: "grouped" }, tables: [] },
    });
  });

  it.each([
    null,
    [],
    { example: { definition, tables: ["example_rows", "*"] } },
    { example: { definition: { ...definition, id: "wrong" }, tables: [] } },
    { example: { packageId: 7, definition, tables: [] } },
  ])("refuses corrupt ownership rather than silently discarding protection: %j", value => {
    expect(() => parseComponentOwnership(value)).toThrow("ownership");
  });
});
