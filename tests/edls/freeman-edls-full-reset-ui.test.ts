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

  it("keeps complete reset failures visible without a support-reference lookup", () => {
    expect(source).toContain("Failed stage:");
    expect(source).toContain("Complete record snapshot");
    expect(source).toContain("Database error");
    expect(source).toMatch(/No reset\s+deletion was committed/);
    expect(routes).toContain('action: "refresh"');
    expect(routes).toContain('action: "inspect"');
    expect(routes).toContain("logId");
    expect(routes).toContain("storage.logs.create");
    expect(routes).toContain("failedRecord");
    expect(routes).toContain('outcome: "rolled_back"');
    expect(routes).toContain("diagnostics");
    expect(routes).toContain("stage");
  });

  it("shows concrete relationship identities and preservation disposition", () => {
    expect(source).toContain("workerName");
    expect(source).toContain("contactName");
    expect(source).toContain("referencingSchema");
    expect(source).toContain("relation.disposition");
    expect(source).toContain("full-reset-blockers");
    expect(source).toContain("full-reset-preservations");
  });

  it("keeps preflight and execution behind the shared admin and component gate", () => {
    expect(routes).toContain('requirePermission("admin")');
    expect(routes).toContain('requireComponent("edls")');
    expect(routes).toContain('requireComponent("sitespecific.freeman")');
    expect(routes).toMatch(/app\.get\(\s*"\/api\/sitespecific\/freeman\/edls-migrate\/full-reset",\s*\.\.\.gate,/s);
    expect(routes).toMatch(/app\.post\(\s*"\/api\/sitespecific\/freeman\/edls-migrate\/full-reset",\s*\.\.\.gate,/s);
  });
});