import { afterEach, describe, expect, it, vi } from "vitest";
import { apiRequest } from "@/lib/queryClient";
import { getCheckoutErrorMessage } from "@/lib/checkout-errors";

afterEach(() => vi.unstubAllGlobals());

describe("administrator checkout non-JSON response boundary", () => {
  it.each(["preview", "session", "status", "cancel"] as const)("safely explains an HTML response at %s", async stage => {
    for (const status of [200, 502]) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html>private upstream details</html>", {
        status, headers: { "content-type": "text/html" },
      })));
      const error = await apiRequest("GET", "/api/ledger/admin-checkout/worker/fictional/fictional").catch(cause => cause);
      const message = getCheckoutErrorMessage(error, stage);
      expect(message).not.toMatch(/private upstream|<html>|unexpected response/);
      expect(message).toMatch(/Retry|Check|check/);
      if (stage !== "preview") expect(message).toMatch(/unknown|reserved balance/);
    }
  });
  it("keeps useful JSON denial reasons and offers sign-in recovery", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: "Administrator access is required" }), {
      status: 403, headers: { "content-type": "application/json" },
    })));
    const denied = await apiRequest("GET", "/api/ledger/admin-checkout/worker/fictional/fictional").catch(cause => cause);
    expect(getCheckoutErrorMessage(denied, "preview")).toBe("Administrator access is required");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("Unauthorized", { status: 401 })));
    const expired = await apiRequest("GET", "/api/ledger/admin-checkout/worker/fictional/fictional").catch(cause => cause);
    expect(getCheckoutErrorMessage(expired, "preview")).toContain("Sign in again");
  });
});
