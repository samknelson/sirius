import { afterEach, describe, expect, it } from "vitest";
import { componentRegistry } from "../../shared/components";
import { preserveMaskState } from "../../shared/privacy/mask-mode";
import { startPrivacyFixture, CANARY } from "./fixture";
import { guardedPresentationDelivery } from "../../server/privacy/socket";

let fixture: Awaited<ReturnType<typeof startPrivacyFixture>> | undefined;
afterEach(async () => { await fixture?.close(); fixture = undefined; });

describe("optional Mask Mode component boundary", () => {
  it("is registered disabled by default without owning business tables", () => {
    expect(componentRegistry.find(c => c.id === "system.mask_mode")).toMatchObject({
      name: "Mask Mode", enabledByDefault: false,
    });
    expect(componentRegistry.find(c => c.id === "system.mask_mode")?.managesSchema).toBeUndefined();
  });

  it("bypasses leases in disabled normal and legacy sessions; refuses every direct feature path", async () => {
    fixture = await startPrivacyFixture();
    fixture.controls.enabled = false;
    for (const sid of ["presenter", "legacy", "anonymous"]) {
      const normal = await fixture.request("/api/domain", {}, sid);
      expect(normal.status).toBe(200);
      expect(normal.headers.has("X-Mask-Revision")).toBe(false);
      const bootstrap = await fixture.request("/api/components/presentation", {}, sid);
      expect(await bootstrap.json()).toEqual({ maskModeEnabled: false });
    }
    for (const path of ["/api/mask-mode/state", "/api/mask-mode/people", "/mask-mode/client.js", "/api/mask-mode/not-registered"]) {
      expect((await fixture.request(path)).status).toBe(404);
    }
    const page = await fixture.request("/mask-mode");
    expect(page.status).toBe(404);
    expect(await page.text()).toContain("Mask Mode is disabled");
    expect(fixture.controls.acquisitions).toBe(0);
    expect(fixture.controls.reads).toBe(0);
  });

  it("never lets an ON or revoked session fall through after disable or re-enable", async () => {
    fixture = await startPrivacyFixture();
    const row = fixture.rows.get("presenter");
    row.maskMode.mode = "on";
    fixture.controls.enabled = false;
    const denied = await fixture.request("/api/domain");
    expect(denied.status).toBe(401);
    expect(await denied.text()).not.toContain(CANARY);
    expect(fixture.controls.effects).toBe(0);
    expect(fixture.controls.acquisitions).toBe(0);
    const recovery = await fixture.request("/mask-mode");
    expect(await recovery.text()).toContain("Protected session ended");
    row.maskModeRevoked = true;
    row.maskMode.mode = "off"; // A stale rolling save must not erase the fence.
    fixture.controls.enabled = true;
    fixture.controls.epoch = "new-component-generation";
    expect((await fixture.request("/api/domain")).status).toBe(401);
    const signedOut = await fixture.request("/api/logout", { redirect: "manual" });
    expect(signedOut.status).toBe(303);
    expect(fixture.rows.has("presenter")).toBe(false);
  });

  it("requires fresh authentication before a login from an older component generation can toggle", async () => {
    fixture = await startPrivacyFixture();
    fixture.controls.epoch = "new-component-generation";
    const state = await fixture.request("/api/mask-mode/state");
    expect(await state.json()).toMatchObject({ mode: "off", canToggle: false, reauthRequired: true });
    expect((await fixture.request("/api/mask-mode/state", {
      method: "POST", body: JSON.stringify({ mode: "on", revision: 1, acknowledged: true }),
    })).status).toBe(409);
    expect((await fixture.request("/api/domain")).status).toBe(200);
  });

  it("fails closed on component authority failure without returning raw error details", async () => {
    fixture = await startPrivacyFixture();
    fixture.controls.failComponent = true;
    const result = await fixture.request("/api/components/presentation");
    expect(result.status).toBe(503);
    expect(await result.text()).not.toContain(CANARY);
    expect(fixture.controls.effects).toBe(0);
  });

  it("retains lifecycle revocation and epoch across stale session saves and cannot forge them", () => {
    expect(preserveMaskState({ maskModeRevoked: false, maskModeEpoch: "forged" }, {
      maskModeRevoked: true, maskModeEpoch: "original",
    })).toMatchObject({ maskModeRevoked: true, maskModeEpoch: "original" });
    expect(preserveMaskState({ maskModeRevoked: true, maskModeEpoch: "forged" }, {})).toEqual({});
  });

  it("uses no socket lease when disabled but still rejects revoked, expired, changed-actor and ON sessions", async () => {
    for (const scenario of ["normal", "revoked", "expired", "actor", "on"]) {
      let acquisitions = 0, sent = 0;
      const result = await guardedPresentationDelivery("fixture", "staff", async () => { sent++; }, {
        component: async () => ({ enabled: false, epoch: null }),
        acquire: async () => { acquisitions++; return null; },
        read: async () => scenario === "expired" ? undefined : {
          passport: { user: { dbUser: { id: scenario === "actor" ? "other" : "staff" } } },
          maskModeRevoked: scenario === "revoked",
          maskMode: { version: 1, revision: 1, mode: scenario === "on" ? "on" : "off" },
        },
      });
      expect(acquisitions).toBe(0);
      expect(result).toBe(scenario === "normal");
      expect(sent).toBe(scenario === "normal" ? 1 : 0);
    }
  });
});
