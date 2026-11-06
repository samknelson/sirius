import { afterEach, expect, it } from "vitest";
import { componentRegistry } from "../../shared/components";
import { startPrivacyFixture } from "./fixture";
let fixture: Awaited<ReturnType<typeof startPrivacyFixture>> | undefined;
afterEach(async () => { await fixture?.close(); fixture = undefined; });
it("keeps the optional component default OFF without business tables", () => {
  const component = componentRegistry.find(c => c.id === "system.mask_mode");
  expect(component).toMatchObject({ enabledByDefault: false });
  expect(component?.managesSchema).toBeUndefined();
});
it("ends screen masking when disabled, not authentication or normal work", async () => {
  fixture = await startPrivacyFixture();
  fixture.rows.get("presenter").maskMode.mode = "on";
  fixture.controls.enabled = false;
  expect(await (await fixture.request("/api/mask-mode/state")).json()).toMatchObject({ mode: "off", enabled: false, canToggle: false });
  expect((await fixture.request("/api/domain")).status).toBe(200);
  expect((await fixture.request("/api/mask-mode/state", { method: "POST", body: JSON.stringify({ mode: "on", revision: 1 }) })).status).toBe(409);
  expect(await (await fixture.request("/api/mask-mode/state", {}, "anonymous")).json()).toMatchObject({ mode: "off", canToggle: false });
});
