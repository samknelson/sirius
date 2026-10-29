import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchAuthUser } from "../../client/src/lib/auth-user";

afterEach(() => vi.unstubAllGlobals());
describe("current-user lookup failures are not logouts", () => {
  it("treats only 401 as signed out", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 401 })));
    expect(await fetchAuthUser()).toBeNull();
  });
  it.each([403, 404, 500, 503])("surfaces HTTP %s for retry", async (status) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status })));
    await expect(fetchAuthUser()).rejects.toThrow();
  });
  it.each(["<html>fallback</html>", "{}", '{"user":null}', '{"user":{"id":"u"}}'])(
    "rejects a malformed success envelope: %s", async (body) => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body)));
      await expect(fetchAuthUser()).rejects.toThrow();
    },
  );
  it("surfaces network errors rather than returning null", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    await expect(fetchAuthUser()).rejects.toThrow("offline");
  });
  it("accepts the normal signed-in envelope", async () => {
    const data = {
      user: { id: "u", email: "fixture@example.invalid", firstName: null, lastName: null, isActive: true }, permissions: [], components: [],
      masquerade: { isMasquerading: false },
      timezone: { systemTimeZone: "UTC", userTimeZone: null, allowUserTimezones: false },
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(data)));
    expect(await fetchAuthUser()).toEqual(data);
  });
});
