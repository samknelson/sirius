import { describe, expect, it } from "vitest";
import type { PolicyContext } from "../../shared/access-policies";
import edit from "../../shared/access-policies/edls/sheet/edit";
import assign from "../../shared/access-policies/edls/sheet/assign";

function context(
  permissions: string[],
  sheet: { status: string; supervisor: string } | null,
): PolicyContext {
  return {
    user: { id: "supervisor", email: "supervisor@example.test" },
    entityId: "sheet",
    loadEntity: async <T>() => sheet as T | null,
    hasPermission: async permission => permissions.includes(permission),
    hasAnyPermission: async requested => requested.some(permission => permissions.includes(permission)),
    hasAllPermissions: async requested => requested.every(permission => permissions.includes(permission)),
    checkPolicy: async () => false,
    isComponentEnabled: async () => true,
    getUserContact: async () => null,
    getUserWorker: async () => null,
    storage: {},
  };
}

describe("EDLS sheet details and assignment authorization", () => {
  // Exercise every combination: advisor is an independent assignment grant,
  // not a prohibition on editing when another permission qualifies.
  const permissions = [
    "edls.manager", "edls.coordinator", "edls.worker.advisor", "edls.supervisor",
  ];
  it.each(["draft", "request", "reserved", "lock", "trash"])(
    "preserves the access matrix on %s sheets",
    async status => {
      for (let mask = 0; mask < 16; mask++) {
        const held = permissions.filter((_, index) => mask & (1 << index));
        for (const supervisor of ["supervisor", "someone-else"]) {
          const ctx = context(held, { status, supervisor });
          const blocked = status === "lock" || status === "trash";
          const staff = held.includes("edls.manager") || held.includes("edls.coordinator");
          const ownDraft = status === "draft" && supervisor === ctx.user.id &&
            held.includes("edls.supervisor");
          expect((await edit.evaluate!(ctx)).granted).toBe(!blocked && (staff || ownDraft));
          expect((await assign.evaluate!(ctx)).granted).toBe(
            !blocked && (staff || ownDraft || held.includes("edls.worker.advisor")),
          );
        }
      }
    },
  );

  it("refuses missing sheets even with all qualifying permissions", async () => {
    for (const policy of [edit, assign]) {
      expect(await policy.evaluate!(context(permissions, null))).toEqual({
        granted: false, reason: "Sheet not found",
      });
    }
  });

  it("advertises the correct grants and preserves status and admin safeguards", () => {
    expect(edit.id).toBe("edls.sheet.edit");
    expect(assign.id).toBe("edls.sheet.assign");
    expect(edit.describeRequirements!()).toEqual(
      assign.describeRequirements!().filter(rule =>
        !("permission" in rule) || rule.permission !== "edls.worker.advisor"),
    );
    expect(assign.describeRequirements!()).toContainEqual({ permission: "edls.worker.advisor" });
    for (const policy of [edit, assign]) {
      expect(policy.scope).toBe("entity");
      expect(policy.entityType).toBe("edls_sheet");
      expect(policy.component).toBe("edls");
      expect(policy.noAdminBypass).toBe(true);
      expect(policy.cacheKeyFields).toEqual(["status", "supervisor"]);
    }
  });
});