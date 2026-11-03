import { describe, expect, it } from "vitest";
import { guardedPresentationDelivery } from "../../server/privacy/socket";

describe("WebSocket egress is independently admitted", () => {
  it("sends only in current OFF state to the current actor; all failures refuse", async () => {
    for (const mode of ["off", "on", "unknown", "malformed"]) {
      let sends = 0, released = 0;
      const sent = await guardedPresentationDelivery("fixture", "staff", async () => { sends++; }, {
        acquire: async () => ({
          name: "fixture", waitedMs: 0, contended: false, isHeld: () => true,
          release: async () => { released++; },
        }),
        read: async () => ({
          passport: { user: { dbUser: { id: "staff" } } },
          maskMode: { version: 1, revision: 1, mode },
        }),
      });
      expect(sent).toBe(mode === "off");
      expect(sends).toBe(mode === "off" ? 1 : 0);
      expect(released).toBe(1);
    }
    let sends = 0;
    expect(await guardedPresentationDelivery("fixture", "old-actor", async () => { sends++; }, {
      acquire: async () => null, read: async () => { throw new Error("Unavailable"); },
    })).toBe(false);
    expect(sends).toBe(0);
  });
  it("does not send through an expired session, changed actor, lost lease or failed read", async () => {
    for (const scenario of ["expired", "actor", "lease", "read"]) {
      let sends = 0, held = true;
      expect(await guardedPresentationDelivery("fixture", "staff", async () => { sends++; }, {
        acquire: async () => ({ name: "fixture", waitedMs: 0, contended: false, isHeld: () => held,
          release: async () => {} }),
        read: async () => {
          if (scenario === "read") throw new Error("Unavailable");
          if (scenario === "expired") return undefined;
          if (scenario === "lease") held = false;
          return { passport: { user: { dbUser: { id: scenario === "actor" ? "target" : "staff" } } },
            maskMode: { version: 1, mode: "off", revision: 1 } };
        },
      })).toBe(false);
      expect(sends).toBe(0);
    }
  });
});
