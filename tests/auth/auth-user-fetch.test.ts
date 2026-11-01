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
  it("opens the existing error page for a verified Clerk account refusal", async () => {
    const assign = vi.fn();
    vi.stubGlobal("window", { location: { pathname: "/login", assign } });
    const url = "/auth-error?error=access_denied&ref=CLERK-ABC-123&category=inactive_account";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ authErrorUrl: url }, { status: 403 })));
    expect(await fetchAuthUser()).toBeNull();
    expect(assign).toHaveBeenCalledWith(url);
  });
  it("does not redirect again from the error page", async () => {
    const assign = vi.fn();
    vi.stubGlobal("window", { location: { pathname: "/auth-error", assign } });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({
      authErrorUrl: "/auth-error?error=access_denied&ref=CLERK-ABC-123",
    }, { status: 403 })));
    expect(await fetchAuthUser()).toBeNull();
    expect(assign).not.toHaveBeenCalled();
  });
  it.each(["/register", "/login"])("keeps an unlinked Clerk user on %s to register or sign out", async pathname => {
    const assign = vi.fn();
    vi.stubGlobal("window", { location: { pathname, assign } });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({
      authErrorUrl: "/auth-error?error=access_denied&ref=CLERK-ABC-123",
    }, { status: 403 })));
    expect(await fetchAuthUser()).toBeNull();
    expect(assign).not.toHaveBeenCalled();
  });
  it.each(["https://example.invalid", "//example.invalid", "/auth-error?error=access_denied&category=private_details"])(
    "rejects an unrecognized refusal redirect %s", async authErrorUrl => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ authErrorUrl }, { status: 403 })));
      await expect(fetchAuthUser()).rejects.toThrow();
    },
  );
});
