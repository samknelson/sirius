import { describe, expect, it } from "vitest";
import { planCrewLeadsImport } from "../../shared/freemanCrewleadsTransfer";

// Settled irreversible-data contract: a partial parse must never authorize
// replacement deletions, and matching is by the portable ID, not the name.
const existing = [
  { id: "keep", siriusId: "001", name: "Original" },
  { id: "other", siriusId: "002", name: "Other" },
];

describe("crew lead replacement safety", () => {
  it.each([
    "", " \r\n ", '[{"name":"New","siriusId":"001"},',
    "Valid | 001\nbroken line",
    "Valid | 001\nDuplicate | 001",
    '[{"name":"New","siriusId":1}]',
    '{"type":"other","records":[]}',
    '[{"name":"","siriusId":"001"}]',
  ])("rejects invalid input without planning deletion: %j", (input) => {
    const plan = planCrewLeadsImport(input, "replace", existing);
    expect(plan.errors.length).toBeGreaterThan(0);
    expect(plan.summary.delete).toBe(0);
  });

  it("only treats an explicit empty JSON list as a request to clear", () => {
    expect(planCrewLeadsImport("[]", "replace", existing)).toMatchObject({
      clearAll: true, errors: [], summary: { delete: 2 },
    });
    expect(planCrewLeadsImport("[]", "merge", existing)).toMatchObject({
      clearAll: false, errors: [], summary: { delete: 0 },
    });
  });

  it("matches trimmed string IDs, never names or supplied internal IDs", () => {
    const plan = planCrewLeadsImport(JSON.stringify([
      { name: "Changed", siriusId: " 001 ", id: "other", data: { overwritten: true } },
      { name: "Other", siriusId: "003" },
    ]), "merge", existing);
    expect(plan.errors).toEqual([]);
    expect(plan.items).toMatchObject([
      { action: "update", existingId: "keep", siriusId: "001", name: "Changed" },
      { action: "create", existingId: null, siriusId: "003" },
    ]);
    expect(plan.summary.delete).toBe(0);
    expect(plan.items[0].changes.map((change) => change.field)).toEqual(["name"]);
  });

  it("handles BOM, CRLF, pipe/tab, blank lines and preserves leading zeroes", () => {
    const plan = planCrewLeadsImport("\uFEFF Original | 001 \r\n\r\n Added \t 003 \r\n", "replace", existing);
    expect(plan.errors).toEqual([]);
    expect(plan.summary).toMatchObject({ create: 1, unchanged: 1, delete: 1 });
    expect(plan.items).toMatchObject([
      { action: "unchanged", siriusId: "001", existingId: "keep" },
      { action: "create", siriusId: "003" },
      { action: "delete", existingId: "other" },
    ]);
  });

  it("refuses ambiguous normalized IDs already present in storage", () => {
    const plan = planCrewLeadsImport("New | 001", "replace", [
      ...existing, { id: "duplicate", siriusId: " 001 ", name: "Duplicate" },
    ]);
    expect(plan.errors.length).toBeGreaterThan(0);
    expect(plan.summary.delete).toBe(0);
  });
});
