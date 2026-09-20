import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  "client/src/components/sitespecific/freeman/FullResetCard.tsx",
  "utf8",
);
const routes = readFileSync(
  "server/modules/sitespecific/freeman/edls-migrate/routes.ts",
  "utf8",
);

describe("Freeman EDLS full reset danger card", () => {
  it("requires exact confirmation before enabling the final action", () => {
    expect(source).toContain("confirmation === preflight.data?.confirmation");
    expect(source).toContain("disabled={blocked}");
    expect(source).toContain("Final destructive confirmation");
  });

  it("states system-wide scope, irreversibility, and retained data", () => {
    expect(source).toContain("system-wide worker registry");
    expect(source).toContain("This cannot be undone");
    expect(source).toContain("migration progress are retained");
  });

  it("keeps preflight and execution behind the shared admin and component gate", () => {
    expect(routes).toContain('requirePermission("admin")');
    expect(routes).toContain('requireComponent("edls")');
    expect(routes).toContain('requireComponent("sitespecific.freeman")');
    expect(routes).toMatch(/app\.get\(\s*"\/api\/sitespecific\/freeman\/edls-migrate\/full-reset",\s*\.\.\.gate,/s);
    expect(routes).toMatch(/app\.post\(\s*"\/api\/sitespecific\/freeman\/edls-migrate\/full-reset",\s*\.\.\.gate,/s);
  });
});