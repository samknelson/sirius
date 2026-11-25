import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { discoverComponentPackages } from "../../../../scripts/component-packages";
import {
  HANDLERS_ON_FRAMEWORK, VENDOR_MARKER_EXEMPT, auditWcVendorHandlerFixture,
} from "../../../../scripts/dev/check-maintenance-guards";

it("audits contributed handlers instead of exempting their transport modules", () => {
  const owner = discoverComponentPackages().find(p => p.id === "freeman")!;
  expect(Object.keys(owner.maintenanceGuards!)).toHaveLength(2);
  for (const [path, spec] of Object.entries(owner.maintenanceGuards!)) {
    expect(HANDLERS_ON_FRAMEWORK[path]).toEqual(spec);
    expect(VENDOR_MARKER_EXEMPT[path]).toBeUndefined();
    const source = readFileSync(path, "utf8");
    expect(auditWcVendorHandlerFixture(source, HANDLERS_ON_FRAMEWORK[path])).toEqual([]);
    expect(auditWcVendorHandlerFixture(`${source}\nfetch("https://unprotected.example");`, HANDLERS_ON_FRAMEWORK[path]).length).toBeGreaterThan(0);
  }
});
