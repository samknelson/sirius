import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { discoverOptionalComponents } from "../../scripts/optional-components";
import {
  HANDLERS_ON_FRAMEWORK, VENDOR_MARKER_EXEMPT, auditWcVendorHandlerFixture,
} from "../../scripts/dev/check-maintenance-guards";

it("audits component-declared vendor handlers instead of exempting their transport modules", () => {
  const declared = discoverOptionalComponents().flatMap(c => Object.entries(c.maintenanceGuards));
  for (const [path, spec] of declared) {
    expect(HANDLERS_ON_FRAMEWORK[path]).toEqual(spec);
    expect(VENDOR_MARKER_EXEMPT[path]).toBeUndefined();
    const source = readFileSync(path, "utf8");
    expect(auditWcVendorHandlerFixture(source, HANDLERS_ON_FRAMEWORK[path])).toEqual([]);
    expect(auditWcVendorHandlerFixture(`${source}\nfetch("https://unprotected.example");`, HANDLERS_ON_FRAMEWORK[path]).length).toBeGreaterThan(0);
  }
});
