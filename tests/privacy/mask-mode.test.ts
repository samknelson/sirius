import { afterEach, describe, expect, it } from "vitest";
import { maskId, maskName, maskSsn, preserveMaskState, projectTrainingPerson, readMaskState } from "../../shared/privacy/mask-mode";
import { CANARY, RAW, startPrivacyFixture } from "./fixture";
import { getSystemHelp, findSystemHelpsForPath } from "../../server/help/system";

let fixture: Awaited<ReturnType<typeof startPrivacyFixture>> | undefined;
afterEach(async () => { await fixture?.close(); fixture = undefined; });

describe("strict semantic presentation helpers", () => {
  it("withholds all names and IDs, including valid, short, malformed, Unicode and null", () => {
    for (const input of [null, undefined, "", "Jean-Marie van Example Jr.", "1234", "987-65-4321", 123456, "ＡＢ１２３４"]) {
      expect(maskName(input)).toBe("Name withheld");
      expect(maskSsn(input)).toBe("Withheld");
      expect(maskId(input)).toBe("Withheld");
    }
  });
  it("copies only the reviewed year and fresh reference; no source mutation or fallback", () => {
    const input = Object.freeze({ ...RAW, birthDate: "1980-02-29" });
    expect(projectTrainingPerson(input, "random-reference", 2026)).toEqual({
      reference: "random-reference", label: "Training person", birthYear: "1980", ageGroup: null,
    });
    expect(input.family).toBe(CANARY);
    for (const birthDate of ["1936-12-31", "1900-01-01"]) {
      expect(projectTrainingPerson({ birthDate }, "random", 2026)).toMatchObject({ birthYear: null, ageGroup: "90 or older" });
    }
    for (const birthDate of [null, "2027-01-01", "1980-02-31", "1930", "0001-01-01", "PRIVATE"]) {
      expect(projectTrainingPerson({ birthDate }, "random", 2026)).toMatchObject({ birthYear: null, ageGroup: null });
    }
  });
  it("unknown policy never means OFF; stale whole-session saves preserve authority", () => {
    for (const value of [undefined, false, {}, { mode: "off" }, { version: 2, mode: "off", revision: 1 },
      { version: 1, mode: "off", revision: -1 }, { version: 1, mode: "off", revision: "1" }]) {
      expect(readMaskState(value).mode).toBe("unknown");
    }
    const on = { version: 1, mode: "on", revision: 4 };
    expect(preserveMaskState({ maskMode: { mode: "off", revision: 1 }, refreshedToken: "fixture" },
      { maskMode: on })).toEqual({ maskMode: on, refreshedToken: "fixture" });
    expect(preserveMaskState({ maskMode: on }, {})).toEqual({});
    expect(preserveMaskState({ maskMode: on }, { maskMode: { malformed: true } }))
      .toEqual({ maskMode: { malformed: true } });
  });
});

describe("real HTTP admission, egress and concurrency with authorized in-memory sessions", () => {
  async function setup() { fixture = await startPrivacyFixture(); return fixture; }
  async function turnOn(f: NonNullable<typeof fixture>, sid = "presenter", revision = 1) {
    return f.request("/api/mask-mode/state", {
      method: "POST", body: JSON.stringify({ mode: "on", revision, acknowledged: true }),
    }, sid);
  }
  it("OFF is unchanged; ON/unknown refuse all ordinary methods before work or payload bytes", async () => {
    const f = await setup();
    expect(await (await f.request("/api/domain")).json()).toEqual(RAW);
    expect((await turnOn(f)).status).toBe(200);
    const before = f.controls.effects;
    for (const sid of ["presenter", "legacy"]) {
      for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]) {
        const response = await f.request("/api/domain", { method }, sid);
        expect(response.status).toBe(423);
        expect(await response.text()).not.toContain(CANARY);
      }
      for (const path of ["/files/canary.pdf", "/public-files/canary", "/api/redirect", "/api/sse", "/api/error",
        "/api/plugins/client-injection/resolved", "/api/workers/export", "/api/wizards/existing/export"]) {
        const response = await f.request(path, {}, sid);
        expect([303, 423]).toContain(response.status);
        expect(response.headers.get("location") ?? "").not.toContain(CANARY);
        expect(await response.text()).not.toContain(CANARY);
      }
    }
    expect(f.controls.effects).toBe(before);
    expect(await (await f.request("/api/domain", {}, "other")).json()).toEqual(RAW);
  });
  it("sample is ON-only, revision-bound, not cached and drops all extra fields", async () => {
    const f = await setup();
    expect((await f.request("/api/mask-mode/people")).status).toBe(409);
    await turnOn(f);
    expect((await f.request("/api/mask-mode/people", { headers: { "X-Mask-Revision": "1" } })).status).toBe(409);
    const response = await f.request("/api/mask-mode/people", { headers: { "X-Mask-Revision": "2" } });
    expect(response.headers.get("cache-control")).toContain("no-store");
    const result = await response.json();
    expect(result.people).toHaveLength(3);
    expect(result.people[0]).toMatchObject({ label: "Training person", birthYear: "1980" });
    expect(result.people[1]).toMatchObject({ ageGroup: "90 or older", birthYear: null });
    for (const person of result.people) expect(Object.keys(person).sort()).toEqual(["ageGroup", "birthYear", "label", "reference"]);
    const encoded = JSON.stringify(result);
    for (const value of Object.values(RAW).filter(v => typeof v !== "object")) expect(encoded).not.toContain(String(value));
    expect(f.controls.reads).toBe(1);
    f.controls.targetCanRead = false;
    expect((await f.request("/api/mask-mode/people", { headers: { "X-Mask-Revision": "2" } })).status).toBe(409);
    expect(f.controls.reads).toBe(1);
  });
  it("admin-only transition, origin, acknowledgment and strict request validation", async () => {
    const f = await setup();
    expect((await turnOn(f, "nonadmin")).status).toBe(403);
    for (const body of [
      { mode: "on", revision: 1 }, { mode: "on", revision: "1", acknowledged: true },
      { mode: "on", revision: 1, acknowledged: true, family: CANARY },
    ]) {
      expect((await f.request("/api/mask-mode/state", { method: "POST", body: JSON.stringify(body) })).status).toBe(400);
    }
    expect((await f.request("/api/mask-mode/state", {
      method: "POST", headers: { origin: "https://attacker.invalid" },
      body: JSON.stringify({ mode: "on", revision: 1, acknowledged: true }),
    })).status).toBe(403);
    expect((await turnOn(f, "legacy", 0)).status).toBe(200);
  });
  it("waits for a delayed OFF response, serializes competing transitions and refuses stale requests", async () => {
    const f = await setup();
    const slow = f.request("/api/slow");
    while (!f.controls.pending) await new Promise(resolve => setTimeout(resolve, 5));
    const transition = turnOn(f);
    expect((await slow).headers.get("X-Mask-Mode")).toBe("off");
    await (await slow).text();
    expect((await transition).status).toBe(200);
    expect(f.controls.pending).toBe(0);
    const contenders = await Promise.all([turnOn(f, "presenter", 2), turnOn(f, "presenter", 2)]);
    expect(contenders.map(r => r.status).sort()).toEqual([200, 409]);
    expect(f.rows.get("presenter").maskMode.revision).toBe(3);
    expect((await f.request("/api/domain", { headers: { "X-Mask-Revision": "1" } })).status).toBe(423);
    const off = await f.request("/api/mask-mode/state", {
      method: "POST", body: JSON.stringify({ mode: "off", revision: 3, acknowledged: true }),
    });
    expect(off.status).toBe(200);
    expect((await f.request("/api/domain", { headers: { "X-Mask-Revision": "1" } })).status).toBe(409);
  });
  it("refuses failures without relaying exceptions or acknowledging unsaved state", async () => {
    const f = await setup();
    for (const key of ["failRead", "failPermissions", "failTransition"] as const) {
      f.controls[key] = true;
      const response = await turnOn(f);
      expect(response.status).toBe(503);
      expect(await response.text()).not.toContain(CANARY);
      expect(f.rows.get("presenter").maskMode.mode).toBe("off");
      f.controls[key] = false;
    }
    f.controls.loseLease = true;
    await expect(f.request("/api/domain")).rejects.toThrow();
    expect(f.controls.effects).toBe(0);
  });
  it("uses a safe standalone document even in unknown state and denies old public bytes with this session", async () => {
    const f = await setup();
    const response = await f.request("/mask-mode", {}, "legacy");
    expect(response.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    const document = await response.text();
    expect(document).toContain('src="/mask-mode/client.js"');
    expect(document).not.toContain(CANARY);
    expect(document).not.toContain("weglot.com");
    expect((await f.request("/api/domain", {}, "legacy")).status).toBe(423);
    // Do not claim public/no-cookie URLs are revoked.
    expect(await (await f.request("/public-files/canary", {}, "anonymous")).text()).toContain(CANARY);
  });
  it("can sign out without toggle privilege even when permission lookup fails", async () => {
    const f = await setup();
    f.controls.failPermissions = true;
    const response = await f.request("/api/mask-mode/logout", { method: "POST", body: "{}" }, "nonadmin");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ signedOut: true });
    expect(f.rows.has("nonadmin")).toBe(false);
  });
});

describe("built-in help", () => {
  it("has one stable ID, sanitized details and narrow matching", () => {
    const help = getSystemHelp("system:mask-mode")!;
    expect(help.source).toBe("system");
    expect(help.details).toContain("not a HIPAA certification");
    expect(help.details).not.toContain("<script");
    expect(findSystemHelpsForPath("/mask-mode").filter(h => h.id === help.id)).toHaveLength(1);
    for (const path of ["/mask-mode-other", "/mask-mode/extra", "/workers/example", "/config/helps"]) {
      expect(findSystemHelpsForPath(path).some(h => h.id === help.id)).toBe(false);
    }
  });
});
