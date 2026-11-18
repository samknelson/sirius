import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";

function slice(source: string, start: string, end: string) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  if (from < 0 || to < 0) throw new Error(`Missing loader fixture boundary: ${start}`);
  return source.slice(from, to);
}
const sync = readFileSync("scripts/s1-migration/lib/sync.ts", "utf8");
const classifier = slice(sync, "export function classifyRow(", "\n/**").replace("export ", "");

describe("S1 previously consumed two-line address transition", () => {
  it.each([
    ["contacts-workers", 3, "// address (T13) — SET reconcile:", "    finishRow();"],
    ["employers", 1, "// address (T13): co_address", "\n    if (mapped) {"],
  ] as const)("%s revisits an unchanged old fingerprint once, then skips replay", async (loader, oldVersion, start, end) => {
    const source = readFileSync(`scripts/s1-migration/load-${loader}.ts`, "utf8");
    const version = Number(source.match(/const LOGIC_VERSION = (\d+)/)?.[1]);
    expect(version).toBeGreaterThan(oldVersion);
    const old = { id: "old", source: "import", isActive: true,
      street: loader === "employers" ? "12 Fictional St, Unit 4B" : "12 Fictional St Unit 4B",
      street2: null, city: "Example", state: "CA", postalCode: "90001", country: "US" };
    const rows: any[] = [old];
    const read = vi.fn(async () => rows);
    const remove = vi.fn(async (id: string) => { rows.find(r => r.id === id).isActive = false; });
    const create = vi.fn(async (_id: string, data: any) => { rows.push({ ...data, id: "new", isActive: true, source: "import" }); });
    const mapping = { stub: false, consumedFingerprint: "unchanged-source", logicVersion: oldVersion };
    const context = {
      mapping, version, c: { nid: 1, fields: {
        field_sirius_address: { thoroughfare: "12 Fictional St", premise: "Unit 4B", locality: "Example", administrative_area: "CA", postal_code: "90001", country: "US" },
        field_grievance_co_address: "12 Fictional St", field_grievance_co_address_2: "Unit 4B",
        field_grievance_co_city: "Example", field_grievance_co_state: "CA", field_grievance_co_zip: "90001",
      } }, contactId: "contact", rowWrites: 0, writes: 0,
      cStats: { addressesRemoved: 0, addressesMatched: 0, addressesUpserted: 0 },
      scStats: { addressesRemoved: 0, addressesMatched: 0, addressesUpserted: 0 },
      scalarOf: (v: any) => v,
      strOf: (fields: any, key: string) => fields[key] ?? null,
      rejects: { add: vi.fn() },
      withNotificationsSuppressed: async (fn: () => unknown) => fn(),
      storage: { contacts: { addresses: { getContactPostalByContact: read, deleteContactPostal: remove, createOrMatchAddress: create } } },
    };
    const program = ts.transpileModule(`${classifier}
      (async () => {
        const outcomes = [];
        for (let run = 0; run < 2; run++) {
          const disposition = classifyRow(mapping, "unchanged-source", version, false);
          outcomes.push(disposition);
          if (disposition === "unchanged") continue;
          ${slice(source, start, end)}
          mapping.logicVersion = version;
        }
        return outcomes;
      })()`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
    expect(Array.from(await runInNewContext(program, context))).toEqual(["changed", "unchanged"]);
    expect(context.rejects.add).not.toHaveBeenCalled();
    expect(remove).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledTimes(1);
    expect(old.isActive).toBe(false);
    expect(rows[1]).toMatchObject({ street: "12 Fictional St", street2: "Unit 4B" });
  });
});
