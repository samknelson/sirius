import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({
  get: vi.fn(), list: vi.fn(), canStore: vi.fn(), fetch: vi.fn(),
}));
vi.mock("../../server/storage", () => ({
  storage: { pluginConfigs: { get: fake.get, getByKindAndPlugin: fake.list } },
}));
vi.mock("../../server/storage/wc-stats", () => ({
  wcStatsStorage: { recordCall: vi.fn() },
}));
vi.mock("../../server/storage/wc-cache", async (original) => {
  const actual = await original<typeof import("../../server/storage/wc-cache")>();
  return { ...actual, wcCacheStorage: { ...actual.wcCacheStorage, canStore: fake.canStore } };
});
import { getDrivingDistanceMiles } from "../../server/services/driving-distance";
import { setMaintenanceActive, MaintenanceModeError } from "../../server/services/maintenance-flag";
import { getWcVendorPlugin } from "../../server/plugins/wc-vendors/registry";

const origin = { latitude: 45, longitude: -122 };
const destination = { latitude: 46, longitude: -123 };
const config = {
  id: "google-routes-fixture", pluginKind: "wc-vendors", pluginId: "google-geocoding",
  enabled: true, name: "Routes fixture", data: { secretName: "GOOGLE_MAPS_API_KEY" },
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("GOOGLE_MAPS_API_KEY", "routes-test-credential");
  vi.stubGlobal("fetch", fake.fetch);
  fake.get.mockResolvedValue(config);
  fake.list.mockResolvedValue([config]);
  fake.canStore.mockResolvedValue(true);
  setMaintenanceActive(false);
});
afterEach(() => {
  setMaintenanceActive(false);
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("fork Routes lookups through the configured Google WC vendor", () => {
  it("declares a paid uncached operation and converts the vendor's meters to miles", async () => {
    expect(getWcVendorPlugin("google-geocoding")?.operations["geography.routes.driving-distance"])
      .toMatchObject({ needsWritableDatabase: true, cacheMode: "uncached" });
    fake.fetch.mockResolvedValue(new Response(JSON.stringify({ routes: [{ distanceMeters: 1609.344 }] })));
    expect(await getDrivingDistanceMiles(origin, destination)).toEqual({ status: "ok", miles: 1 });
    expect(fake.fetch).toHaveBeenCalledExactlyOnceWith(
      "https://routes.googleapis.com/directions/v2:computeRoutes",
      expect.objectContaining({ headers: expect.objectContaining({ "X-Goog-Api-Key": "routes-test-credential" }) }),
    );
  });
  it("refuses the paid lookup before transport on a non-writable database", async () => {
    fake.canStore.mockResolvedValue(false);
    expect(await getDrivingDistanceMiles(origin, destination)).toMatchObject({ status: "unavailable" });
    expect(fake.fetch).not.toHaveBeenCalled();
  });
  it("propagates maintenance instead of disguising it as no route", async () => {
    setMaintenanceActive(true);
    await expect(getDrivingDistanceMiles(origin, destination)).rejects.toBeInstanceOf(MaintenanceModeError);
    expect(fake.fetch).not.toHaveBeenCalled();
  });
  it("refuses ambiguous connections instead of choosing a credential arbitrarily", async () => {
    fake.list.mockResolvedValue([config, { ...config, id: "other-google-connection" }]);
    expect(await getDrivingDistanceMiles(origin, destination)).toMatchObject({ status: "unavailable" });
    expect(fake.fetch).not.toHaveBeenCalled();
  });
  it("redacts the configured credential from failed transport errors", async () => {
    fake.fetch.mockRejectedValue(new Error("failed with routes-test-credential"));
    const result = await getDrivingDistanceMiles(origin, destination);
    expect(result.status).toBe("unavailable");
    expect(JSON.stringify(result)).not.toContain("routes-test-credential");
  });
});
