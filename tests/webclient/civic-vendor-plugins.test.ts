import { afterEach, describe, expect, it, vi } from "vitest";
import type { PluginConfig } from "@shared/schema";
import {
  getWcVendorPlugin,
  getWcVendorOperationManifest,
  planLegacyCivicWcVendorConfigs,
} from "../../server/plugins/wc-vendors";
import { getWcVendorHandler } from "../../server/plugins/wc-vendors/registry";
import {
  CENSUS_DISTRICT_OPERATION,
  CENSUS_GEOCODER_PLUGIN_ID,
} from "../../server/plugins/wc-vendors/plugins/census-geocoder";
import {
  GOOGLE_GEOCODE_OPERATION,
  GOOGLE_GEOCODING_PLUGIN_ID,
  googleGeocodeRequestKey,
} from "../../server/plugins/wc-vendors/plugins/google-geocoding";
import {
  OPENSTATES_LOOKUP_OPERATION,
  OPENSTATES_PLUGIN_ID,
} from "../../server/plugins/wc-vendors/plugins/openstates";
import { CivicApiError } from "../../server/services/civic-types";
import { getWcRequest } from "../../server/services/webclient";

function context(pluginId: string, credential = "") {
  return {
    credential: { secretName: credential ? "TEST_SECRET" : undefined, value: credential },
    config: {
      id: `config-${pluginId}`,
      pluginKind: "wc-vendors",
      pluginId,
      enabled: true,
      ordering: 0,
      data: {},
    } as PluginConfig,
  };
}

function handler(pluginId: string, operation: string) {
  const found = getWcVendorHandler(pluginId, operation as never);
  if (!found) throw new Error(`Missing ${pluginId}.${operation} test handler`);
  return found;
}

function manifest(pluginId: string) {
  const plugin = getWcVendorPlugin(pluginId);
  if (!plugin) throw new Error(`Missing ${pluginId} test plugin`);
  return getWcVendorOperationManifest(plugin);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("civic vendor plugin declarations", () => {
  it("publishes the intended cache and write policies without runnable behavior", () => {
    expect(manifest(GOOGLE_GEOCODING_PLUGIN_ID)).toContainEqual(expect.objectContaining({
      id: GOOGLE_GEOCODE_OPERATION,
      description: "geocode an address",
      needsWritableDatabase: true,
      cacheMode: "cached",
    }));
    expect(manifest(OPENSTATES_PLUGIN_ID)).toContainEqual(expect.objectContaining({
      id: OPENSTATES_LOOKUP_OPERATION,
      description: "look up state legislators",
      needsWritableDatabase: true,
      cacheMode: "uncached",
    }));
    expect(manifest(CENSUS_GEOCODER_PLUGIN_ID)).toContainEqual(expect.objectContaining({
      id: CENSUS_DISTRICT_OPERATION,
      description: "look up census districts",
      needsWritableDatabase: false,
      cacheMode: "cached",
    }));
    expect(JSON.stringify(manifest(
      GOOGLE_GEOCODING_PLUGIN_ID,
    ))).not.toContain("requestKey");
  });

  it("keys Google answers by normalized address and every answer-changing restriction", () => {
    expect(googleGeocodeRequestKey({
      address: "  10  main St ",
      components: " country:us ",
      region: " us ",
    })).toBe("10 MAIN ST|components=COUNTRY:US|region=US");
    const behavior = getWcRequest("Google", GOOGLE_GEOCODE_OPERATION);
    expect(behavior).toMatchObject({
      cached: true,
      needsWritableDatabase: true,
    });
    expect(behavior?.requestKey({
      configId: "google-config-a",
      args: { address: " 10 main st ", region: " us " },
    })).toBe("google-config-a:10 MAIN ST|region=US");
    expect(behavior?.requestKey({
      configId: "google-config-b",
      args: { address: "10 MAIN ST", region: "US" },
    })).toBe("google-config-b:10 MAIN ST|region=US");
  });
});

describe("legacy civic connection migration plan", () => {
  it("creates canonical configs using only credential names", () => {
    expect(planLegacyCivicWcVendorConfigs({
      existingPluginIds: new Set(),
      availableSecretNames: new Set([
        "GOOGLE_MAPS_API_KEY",
        "OPEN_STATES_API_KEY",
      ]),
      configuredGoogleSecretName: "GOOGLE_MAPS_API_KEY",
    })).toEqual({
      ambiguousGoogleSecretNames: [],
      configs: [
        {
          pluginId: "google-geocoding",
          name: "Google Geocoding",
          secretName: "GOOGLE_MAPS_API_KEY",
        },
        {
          pluginId: "openstates",
          name: "OpenStates",
          secretName: "OPEN_STATES_API_KEY",
        },
        {
          pluginId: "census-geocoder",
          name: "US Census Geocoder",
        },
      ],
    });
  });

  it("refuses to guess between active Google credential names", () => {
    const plan = planLegacyCivicWcVendorConfigs({
      existingPluginIds: new Set(),
      availableSecretNames: new Set([
        "GOOGLE_MAPS_API_KEY",
        "GOOGLE_CIVICS_API_KEY",
      ]),
    });
    expect(plan.configs.map((entry) => entry.pluginId)).toEqual([
      "census-geocoder",
    ]);
    expect(plan.ambiguousGoogleSecretNames).toEqual([
      "GOOGLE_MAPS_API_KEY",
      "GOOGLE_CIVICS_API_KEY",
    ]);
  });

  it("leaves every existing administrator configuration untouched on rerun", () => {
    expect(planLegacyCivicWcVendorConfigs({
      existingPluginIds: new Set([
        "google-geocoding",
        "openstates",
        "census-geocoder",
      ]),
      availableSecretNames: new Set([
        "GOOGLE_MAPS_API_KEY",
        "GOOGLE_CIVICS_API_KEY",
        "OPEN_STATES_API_KEY",
      ]),
      configuredGoogleSecretName: "ANOTHER_GOOGLE_KEY",
    })).toEqual({
      configs: [],
      ambiguousGoogleSecretNames: [],
    });
  });
});

describe("Google Geocoding vendor handler", () => {
  it("builds the provider request and scrubs echoed credentials from failures", async () => {
    const secret = "google-secret-canary";
    let requested = "";
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      requested = String(input);
      return new Response(JSON.stringify({
        status: "REQUEST_DENIED",
        error_message: `Credential ${secret} was denied`,
      }), { status: 200 });
    }));

    const answer = await handler(
      GOOGLE_GEOCODING_PLUGIN_ID,
      GOOGLE_GEOCODE_OPERATION,
    )(
      context(GOOGLE_GEOCODING_PLUGIN_ID, secret),
      { address: "10 Main St", components: "country:US", region: "us" } as never,
    ) as {
      answered: boolean;
      value?: { error_message?: string };
      error?: string;
    };

    expect(requested).toContain("address=10+Main+St");
    expect(requested).toContain("components=country%3AUS");
    expect(requested).toContain("region=us");
    expect(requested).toContain(`key=${secret}`);
    expect(answer.answered).toBe(false);
    expect(JSON.stringify(answer)).not.toContain(secret);
    expect(answer.error).toContain("[REDACTED]");
  });

  it("treats zero results as a complete cacheable vendor answer", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({ status: "ZERO_RESULTS", results: [] })),
    ));
    await expect(handler(
      GOOGLE_GEOCODING_PLUGIN_ID,
      GOOGLE_GEOCODE_OPERATION,
    )(
      context(GOOGLE_GEOCODING_PLUGIN_ID, "key"),
      { address: "missing" } as never,
    )).resolves.toMatchObject({
      answered: true,
      value: { status: "ZERO_RESULTS" },
    });
    const answer = await handler(
      GOOGLE_GEOCODING_PLUGIN_ID,
      GOOGLE_GEOCODE_OPERATION,
    )(
      context(GOOGLE_GEOCODING_PLUGIN_ID, "key"),
      { address: "missing" } as never,
    ) as { store?: boolean };
    expect(answer.store).toBeUndefined();
  });

  it("scrubs a credential-bearing URL from network exceptions", async () => {
    const secret = "google-network-secret";
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error(`request failed at https://google.test/?key=${secret}`);
    }));
    const answer = await handler(
      GOOGLE_GEOCODING_PLUGIN_ID,
      GOOGLE_GEOCODE_OPERATION,
    )(
      context(GOOGLE_GEOCODING_PLUGIN_ID, secret),
      { address: "10 Main St" } as never,
    );
    expect(JSON.stringify(answer)).toContain("[REDACTED]");
    expect(JSON.stringify(answer)).not.toContain(secret);
  });
});

describe("OpenStates vendor handler", () => {
  it("preserves civic-official normalization", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({
        results: [{
          name: "A. Legislator",
          image: "https://example.test/photo.jpg",
          party: [{ name: "Example" }],
          email: "primary@example.test",
          jurisdiction: { name: "Massachusetts" },
          current_role: {
            title: "Representative",
            org_classification: "lower",
            district: "7",
            division_id: "ocd-division/country:us/state:ma/sldl:7",
          },
          offices: [
            { voice: "555-0100", email: "office@example.test" },
            { voice: "555-0100" },
          ],
          links: [{ url: "https://example.test" }],
        }],
      })),
    ));

    await expect(handler(OPENSTATES_PLUGIN_ID, OPENSTATES_LOOKUP_OPERATION)(
      context(OPENSTATES_PLUGIN_ID, "key"),
      { lat: 42.36, lng: -71.06 } as never,
    )).resolves.toEqual([{
      name: "A. Legislator",
      officeName: "Representative, District 7 - Massachusetts",
      level: "state",
      division: "Massachusetts",
      party: "Example",
      phones: ["555-0100"],
      emails: ["primary@example.test", "office@example.test"],
      photoUrl: "https://example.test/photo.jpg",
      urls: ["https://example.test"],
      channels: [],
      ocdDivisionId: "ocd-division/country:us/state:ma/sldl:7",
    }]);
  });

  it("does not relay an echoed credential in an error body", async () => {
    const secret = "openstates-secret-canary";
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(`upstream rejected ${secret}`, { status: 500 }),
    ));
    const error = await handler(OPENSTATES_PLUGIN_ID, OPENSTATES_LOOKUP_OPERATION)(
      context(OPENSTATES_PLUGIN_ID, secret),
      { lat: 1, lng: 2 } as never,
    ).catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(CivicApiError);
    const message = error instanceof Error ? error.message : String(error);
    expect(message).toContain("[REDACTED]");
    expect(message).not.toContain(secret);
  });

  it("scrubs credential echoes from successful normalized fields and network errors", async () => {
    const secret = "openstates-success-secret";
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({
        results: [{
          name: `Person ${secret}`,
          current_role: { title: "Representative", division_id: "/sldl:1" },
        }],
      })),
    ));
    const value = await handler(OPENSTATES_PLUGIN_ID, OPENSTATES_LOOKUP_OPERATION)(
      context(OPENSTATES_PLUGIN_ID, secret),
      { lat: 1, lng: 2 } as never,
    );
    expect(JSON.stringify(value)).toContain("[REDACTED]");
    expect(JSON.stringify(value)).not.toContain(secret);

    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error(`failed https://openstates.test/?apikey=${secret}`);
    }));
    const error = await handler(OPENSTATES_PLUGIN_ID, OPENSTATES_LOOKUP_OPERATION)(
      context(OPENSTATES_PLUGIN_ID, secret),
      { lat: 1, lng: 2 } as never,
    ).catch((thrown: unknown) => thrown);
    expect(String(error)).toContain("[REDACTED]");
    expect(String(error)).not.toContain(secret);
  });

  it("does not relay credentials from a malformed successful response", async () => {
    const secret = "openstates-malformed-secret";
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(`not json ${secret}`, { status: 200 }),
    ));
    const error = await handler(OPENSTATES_PLUGIN_ID, OPENSTATES_LOOKUP_OPERATION)(
      context(OPENSTATES_PLUGIN_ID, secret),
      { lat: 1, lng: 2 } as never,
    ).catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(CivicApiError);
    expect(String(error)).toContain("not valid JSON");
    expect(String(error)).not.toContain(secret);
  });
});

describe("Census Geocoder vendor handler", () => {
  it("extracts current congressional and state districts", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({
        result: {
          geographies: {
            "States": [{ STATE: "25" }],
            "119th Congressional Districts": [{ CD: "07" }],
            "2024 State Legislative Districts - Upper": [{ SLDU: "02" }],
            "2024 State Legislative Districts - Lower": [{ SLDL: "08" }],
          },
        },
      })),
    ));
    await expect(handler(CENSUS_GEOCODER_PLUGIN_ID, CENSUS_DISTRICT_OPERATION)(
      context(CENSUS_GEOCODER_PLUGIN_ID),
      { lat: 42.36, lng: -71.06 } as never,
    )).resolves.toEqual({
      answered: true,
      value: {
        state: "25",
        cd: "07",
        sldu: "02",
        sldl: "08",
        districtKey: "25|07|02|08",
      },
    });
  });
});