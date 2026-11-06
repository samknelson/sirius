import { expect, it } from "vitest";
import { guardedPresentationDelivery } from "../../server/privacy/socket";
it("never uses mask preference as authority but retains expiry and effective actor checks", async () => {
  for (const mode of ["on", "off", "unknown"]) {
    let sends = 0;
    expect(await guardedPresentationDelivery("fixture", "target", async () => { sends++; }, {
      read: async () => ({ passport: { user: { dbUser: { id: "admin" } } }, masqueradeUserId: "target",
        maskModeRevoked: true, maskMode: { mode } }),
    })).toBe(true);
    expect(sends).toBe(1);
  }
  for (const session of [undefined, {}, { passport: { user: { dbUser: { id: "other" } } } }]) {
    expect(await guardedPresentationDelivery("fixture", "target", async () => { throw new Error("Must not send"); },
      { read: async () => session })).toBe(false);
  }
  expect(await guardedPresentationDelivery("fixture", "target", async () => {},
    { read: async () => { throw new Error("Unavailable"); } })).toBe(false);
});
