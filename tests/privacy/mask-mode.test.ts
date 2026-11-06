import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { maskName, maskSsn, maskId, maskEmail, maskPersonal, preserveMaskState } from "../../shared/privacy/mask-mode";
import { startPrivacyFixture, RAW } from "./fixture";

let fixture: Awaited<ReturnType<typeof startPrivacyFixture>> | undefined;
afterEach(async () => { await fixture?.close(); fixture = undefined; });

describe("screen-only formatting", () => {
  it("retains the approved fragments and separators deterministically", () => {
    expect(maskName("Morgan Lancaster")).toBe("M***** L********");
    expect(maskSsn("123-45-6789")).toBe("1**-**-****");
    expect(maskPersonal("(415) 555-1234", "phone")).toBe("(4**) ***-****");
    expect(maskEmail("morgan@gmail.com")).toBe("m*****@gmail.com");
    expect(maskPersonal("12/31/1980", "dob")).toBe("1*/**/****");
    expect(maskId("ABC-123 45")).toBe("A**-*** **");
  });
  it("handles absent, short, malformed, Unicode and already formatted values without raw fallback", () => {
    for (const value of ["", "Not set", "No name set", "N/A", "—", "Unknown worker"]) expect(maskName(value)).toBe(value);
    expect(maskName(null)).toBe("");
    expect(maskName("李明 Éva O'Neil")).toBe("李* É** O'****");
    expect(maskName("M***** L********")).toBe("M***** L********");
    expect(maskId("A")).toBe("A");
    expect(maskSsn("not-valid")).toBe("n**-*****");
    expect(maskEmail("malformed")).toBe("m********");
    expect(maskPersonal("Invalid", "dob")).toBe("I******");
    expect(maskPersonal("Nov 12, 1980", "dob")).toBe("Nov 1*, ****");
    expect(maskEmail("a+b@example.invalid")).toBe("a+*@example.invalid");
  });
  it("ignores forged preferences on ordinary saves but retains the current preference", () => {
    const policy = { version: 1, mode: "on", revision: 3 };
    expect(preserveMaskState({ maskMode: { mode: "off" }, refreshed: true }, { maskMode: policy }))
      .toEqual({ refreshed: true, maskMode: policy });
    expect(preserveMaskState({ maskModeRevoked: true }, { maskModeRevoked: true })).toEqual({});
  });
});

describe("preference-only controls", () => {
  it("keeps normal HTTP actions, raw responses, downloads and WebSockets available while ON", async () => {
    fixture = await startPrivacyFixture();
    const response = await fixture.request("/api/mask-mode/state", { method: "POST", body: JSON.stringify({ mode: "on", revision: 1 }) });
    expect(response.status).toBe(200);
    for (const method of ["GET", "POST", "PATCH", "DELETE"]) {
      expect(await (await fixture.request("/api/domain", { method })).json()).toEqual(RAW);
    }
    expect(await (await fixture.request("/files/canary.pdf")).text()).toBe(RAW.family);
    const socket = new WebSocket(fixture.origin.replace("http", "ws") + "/ws", { headers: { cookie: "fixture=presenter" } });
    const data = await new Promise<string>((resolve, reject) => { socket.once("message", data => resolve(data.toString())); socket.once("error", reject); });
    expect(JSON.parse(data)).toEqual(RAW);
    socket.close();
  });
  it("enforces current admin, origin, CAS and login on preference writes only", async () => {
    fixture = await startPrivacyFixture();
    const init = { method: "POST", body: JSON.stringify({ mode: "on", revision: 1 }) };
    expect((await fixture.request("/api/mask-mode/state", init, "nonadmin")).status).toBe(403);
    expect((await fixture.request("/api/mask-mode/state", init, "anonymous")).status).toBe(401);
    expect((await fixture.request("/api/mask-mode/state", { ...init, headers: { origin: "https://other.invalid" } })).status).toBe(403);
    expect((await fixture.request("/api/mask-mode/state", init)).status).toBe(200);
    expect((await fixture.request("/api/mask-mode/state", init)).status).toBe(409);
    expect(await (await fixture.request("/api/mask-mode/state", {}, "other")).json()).toMatchObject({ mode: "off" });
  });
  it("upgrades legacy sessions without lockout and recovers obsolete URLs", async () => {
    fixture = await startPrivacyFixture();
    expect((await fixture.request("/api/domain", {}, "legacy")).status).toBe(200);
    expect(await (await fixture.request("/api/mask-mode/state", {}, "legacy")).json()).toMatchObject({ mode: "off", revision: 0, canToggle: true });
    expect((await fixture.request("/api/mask-mode/state", { method: "POST", body: JSON.stringify({ mode: "on", revision: 0 }) }, "legacy")).status).toBe(200);
    expect((await fixture.request("/mask-mode")).headers.get("location")).toBe("/");
    expect((await fixture.request("/api/mask-mode/people")).status).toBe(410);
  });
  it("reports state errors without refusing or redirecting ordinary application work", async () => {
    fixture = await startPrivacyFixture();
    fixture.controls.failComponent = true;
    expect((await fixture.request("/api/mask-mode/state")).status).toBe(503);
    expect((await fixture.request("/api/domain")).status).toBe(200);
  });
});
