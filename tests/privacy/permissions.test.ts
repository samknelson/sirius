import { describe, expect, it } from "vitest";
import type { Request } from "express";
import { maskModePermissions } from "../../server/privacy/permissions";

describe("fresh presenter capability versus effective data actor", () => {
  const user = (id: string, active = true) => ({ id, isActive: active });
  it("keeps the original admin's toggle but not their data authority through masquerade", async () => {
    const users = new Map([["admin", user("admin")], ["target", user("target")]]);
    const rights = maskModePermissions({
      getUser: async id => users.get(id),
      userHasPermission: async (id, key) => id === "admin" || (id === "target" && key === "staff"),
    });
    const session = { passport: { user: { dbUser: { id: "admin" } } }, masqueradeUserId: "target" };
    expect(await rights({} as Request, session)).toEqual({ canToggle: true, canRead: true });
    users.delete("target");
    expect(await rights({} as Request, session)).toEqual({ canToggle: true, canRead: false });
    users.set("target", user("target", false));
    expect(await rights({} as Request, session)).toEqual({ canToggle: true, canRead: false });
    users.set("target", user("target"));
    users.set("admin", user("admin", false));
    expect(await rights({} as Request, session)).toEqual({ canToggle: false, canRead: false });
  });
  it("never borrows a target admin's toggle permission", async () => {
    const rights = maskModePermissions({
      getUser: async id => user(id),
      userHasPermission: async (id, key) => id === "target" || key === "staff",
    });
    expect(await rights({} as Request, {
      passport: { user: { dbUser: { id: "staff" } } }, masqueradeUserId: "target",
    })).toEqual({ canToggle: false, canRead: true });
  });
  it("does not swallow lookup failures into an OFF authority", async () => {
    const rights = maskModePermissions({
      getUser: async () => { throw new Error("unavailable"); },
      userHasPermission: async () => true,
    });
    await expect(rights({} as Request, { passport: { user: { dbUser: { id: "admin" } } } }))
      .rejects.toThrow("unavailable");
  });
});
