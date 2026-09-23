import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("../../server/modules/ledger/payment-methods.ts", import.meta.url),
  "utf8",
);

describe("saved payment-method mutation contract", () => {
  it("uses strict consent-bearing setup and attach bodies", () => {
    expect(source).toMatch(/const setupBodySchema = z\.object\(\{[\s\S]*?consent: paymentMethodConsentSchema,[\s\S]*?\}\)\.strict\(\)/);
    expect(source).toMatch(/const attachBodySchema = setupBodySchema\.extend\(\{[\s\S]*?methodToken: z\.string\(\)\.trim\(\)\.min\(1\),[\s\S]*?\}\)\.strict\(\)/);
    expect(source).toContain("ONLINE_PAYMENT_AUTHORIZATION_VARIABLE");
    expect(source).toContain("Current payment authorization must be accepted");
  });

  it("protects every saved-method mutation without changing read routes", () => {
    const mutationRoutes = [
      "app.post(`${base}/setup`",
      "app.post(base",
      "app.patch(`${base}/:pmId`",
      "app.post(`${base}/:pmId/set-default`",
      "app.delete(`${base}/:pmId`",
    ];
    for (const route of mutationRoutes) {
      const start = source.indexOf(route);
      expect(start).toBeGreaterThanOrEqual(0);
      const end = source.indexOf("\n  });", start);
      expect(source.slice(start, end)).toContain(
        "assertMethodMutationAuthority(req, entityType, entityId)",
      );
      expect(source.slice(start, end)).not.toContain(
        "assertEntityAccess(req, entityType, entityId)",
      );
    }

    const detailsStart = source.indexOf("app.get(`${base}/:pmId/details`");
    const detailsEnd = source.indexOf("\n  });", detailsStart);
    expect(source.slice(detailsStart, detailsEnd)).not.toContain(
      "assertMethodMutationAuthority",
    );
  });

  it("exposes a read-authorized method-management capability check", () => {
    const start = source.indexOf('app.get(`${base}/capabilities`');
    const end = source.indexOf("\n  });", start);
    const route = source.slice(start, end);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(route).toContain("assertMethodReadAccess(req, entityType, entityId)");
    expect(route).toContain("assertMethodMutationAuthority(req, entityType, entityId)");
    expect(route).toContain("res.json({ canManageMethods })");
  });

  it("returns creator display names while keeping creator IDs private", () => {
    expect(source).toContain("createdBy: _createdBy");
    expect(source).toContain("addedByName");
    expect(source).toContain("storage.users.getUser(pm.createdBy)");
  });
});