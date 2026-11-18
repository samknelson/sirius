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
  it("defers new contact consumption and keeps incomplete contacts retryable", () => {
    for (const loader of ["contacts-workers", "employers"]) {
      const source = readFileSync(`scripts/s1-migration/load-${loader}.ts`, "utf8");
      const claim = slice(source, 'const winner = await putMapping("contact"', "\n        });");
      expect(claim).not.toContain("fingerprint:");
      expect(claim).not.toContain("logicVersion:");
    }
    const people = readFileSync("scripts/s1-migration/load-contacts-workers.ts", "utf8");
    const finish = slice(people, "const finishRow = () =>", "\n    if (DRY_RUN");
    for (const mapped of [false, true]) {
      for (const incomplete of [false, true]) {
        const pending: unknown[] = [];
        const context = {
          DRY_RUN: false, contactId: "contact", c: { nid: 1 }, fp: "hash",
          mapped, isFreshCreate: !mapped, rowWrites: 0,
          summary: { updated: 0, unchanged: 0 }, pendingContactAdvance: pending,
          rejects: { hasAnyIn: (_nid: number, reasons: string[]) => incomplete && reasons.includes("address_incomplete") },
        };
        runInNewContext(ts.transpileModule(`${finish}; finishRow();`, {}).outputText, context);
        expect(pending).toHaveLength(incomplete ? 0 : 1);
      }
    }
    const employer = readFileSync("scripts/s1-migration/load-employers.ts", "utf8");
    expect(employer).toMatch(/CONTACT_ADVANCE_BLOCKERS = .*"address_incomplete"/);
    expect(employer).toContain("!rejects.hasAnyIn(p.s1Id, CONTACT_ADVANCE_BLOCKERS)");
  });
  for (const loader of ["contacts-workers", "employers"] as const) {
    it.each(["fresh", "edit", "remove-line2", "blank-line2", "incomplete", "inactive", "operator-match", "operator-other", "absent"])(
      `${loader}: %s reconciles safely and a second reconciliation writes nothing`,
      async (scenario) => {
        const source = readFileSync(`scripts/s1-migration/load-${loader}.ts`, "utf8");
        const base = { street: "12 Fictional St", street2: "Unit 4B", city: "Example", state: "CA", postalCode: "90001", country: "US" };
        const rows: any[] = scenario === "fresh" ? [] : [{
          ...base, id: "existing", source: scenario.startsWith("operator") ? "admin" : "import",
          isActive: scenario !== "inactive",
          ...(scenario === "operator-other" ? { street: "99 Other St" } : {}),
        }];
        const line2 = scenario === "edit" ? "Unit 5" : scenario === "remove-line2" ? null : scenario === "blank-line2" ? "  " : base.street2;
        const fields: any = scenario === "absent" ? {} : scenario === "incomplete" ? {
          field_sirius_address: { premise: line2 }, field_grievance_co_address_2: line2,
        } : {
          field_sirius_address: { thoroughfare: base.street, premise: line2, locality: base.city, administrative_area: base.state, postal_code: base.postalCode },
          field_grievance_co_address: base.street, field_grievance_co_address_2: line2,
          field_grievance_co_city: base.city, field_grievance_co_state: base.state, field_grievance_co_zip: base.postalCode,
        };
        const remove = vi.fn(async (id: string) => { rows.find(r => r.id === id).isActive = false; });
        const create = vi.fn(async (_id: string, data: any) => { rows.push({ ...data, id: "new", source: "import", isActive: true }); });
        const reject = vi.fn();
        const context = {
          c: { nid: 1, fields }, contactId: "contact", rowWrites: 0, writes: 0,
          cStats: { addressesRemoved: 0, addressesMatched: 0, addressesUpserted: 0 },
          scStats: { addressesRemoved: 0, addressesMatched: 0, addressesUpserted: 0 },
          scalarOf: (v: unknown) => v,
          strOf: (f: any, k: string) => f[k]?.trim() || null,
          rejects: { add: reject },
          withNotificationsSuppressed: async (fn: () => unknown) => fn(),
          storage: { contacts: { addresses: {
            getContactPostalByContact: async () => rows,
            deleteContactPostal: remove, createOrMatchAddress: create,
          } } },
        };
        const body = slice(source,
          loader === "employers" ? "// address (T13): co_address" : "// address (T13) — SET reconcile:",
          loader === "employers" ? "\n    if (mapped) {" : "    finishRow();");
        const program = ts.transpileModule(`(async () => { ${body} })()`,
          { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
        await runInNewContext(program, context);
        if (scenario === "incomplete") {
          expect(reject).toHaveBeenCalledWith("address_incomplete", { nid: 1 }, 1);
          expect(remove).not.toHaveBeenCalled();
          expect(create).not.toHaveBeenCalled();
        } else {
          expect(reject).not.toHaveBeenCalled();
          if (scenario.startsWith("operator")) expect(rows[0].isActive).toBe(true);
          if (scenario === "operator-match") expect(create).not.toHaveBeenCalled();
          if (scenario === "inactive") expect(remove).not.toHaveBeenCalled();
          if (scenario === "absent") expect(rows.filter(r => r.isActive)).toHaveLength(0);
          else expect(rows.find(r => r.isActive && r.street === base.street)).toMatchObject({
            street2: line2?.trim() || null,
          });
        }
        remove.mockClear(); create.mockClear();
        await runInNewContext(program, context);
        expect(remove).not.toHaveBeenCalled();
        expect(create).not.toHaveBeenCalled();
      },
    );
  }
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
