/**
 * SAFETY: all persistence is mocked before application imports. Cache misses,
 * writes, usage counts and connection/settings reads are disposable fixtures.
 * No configured database or real credential is used. Vendor HTTP and browser
 * launch are blocked, with a socket-level backstop for accidental bypasses.
 *
 * Maintenance mode refuses every outbound vendor call.
 *
 * The database write lock is only half of maintenance mode, and it is the
 * reversible half. An SMS that goes out, an email that goes out, a physical
 * letter that gets printed and mailed, a metered Google geocode — none of
 * those roll back when maintenance ends, which is exactly why they must not
 * happen while it is on.
 *
 * The failure this suite exists to catch is silent by construction: the guard
 * is one call at the top of each method, and forgetting it changes nothing
 * observable until the day maintenance is on and a letter is in the mail. The
 * near miss is just as quiet — several of these methods are written to turn a
 * vendor failure into a normal-looking answer (an empty template list, a "not
 * deliverable" address, a locally-validated address). A refusal that gets
 * converted into one of those is indistinguishable from a vendor outage.
 *
 * So each vendor operation is asserted twice: it refuses with the flag on, and
 * it does NOT refuse with the flag off (proving the guard is the only thing
 * that changed, not a missing key or a broken import). `fetch` and the network
 * are stubbed to throw, so a passing run also proves nothing reached a vendor.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Socket } from "node:net";

const fixture = vi.hoisted(() => ({
  cacheRead: vi.fn(),
  cacheWriteSuccess: vi.fn(),
  cacheWriteFailure: vi.fn(),
  canStore: vi.fn(),
  recordCall: vi.fn(),
  getConfig: vi.fn(),
  getByPlugin: vi.fn(),
  getVariable: vi.fn(),
  httpFetch: vi.fn(),
  launch: vi.fn(),
  forbiddenDatabase: vi.fn(() => { throw new Error("Database access forbidden in maintenance tests"); }),
}));

vi.mock("../../server/storage", () => ({
  storage: {
    pluginConfigs: { get: fixture.getConfig, getByKindAndPlugin: fixture.getByPlugin },
    variables: { getByName: fixture.getVariable },
  },
}));
// Do not import the real storage even to spread its exports: that loads the
// configured connection pool. Missing methods must fail, never reach a DB.
vi.mock("../../server/storage/wc-cache", async () => {
  const { createHash } = await import("node:crypto");
  return {
    wcRequestKeyHash: (key: string) => createHash("sha256").update(key).digest("hex"),
    wcCacheStorage: {
      read: fixture.cacheRead,
      writeSuccess: fixture.cacheWriteSuccess,
      writeFailure: fixture.cacheWriteFailure,
      canStore: fixture.canStore,
    },
  };
});
vi.mock("../../server/storage/wc-stats", () => ({
  wcStatsStorage: { recordCall: fixture.recordCall },
}));
vi.mock("../../server/storage/transaction-context", () => ({
  runOutsideTransaction: (run: () => unknown) => run(),
}));
vi.mock("../../server/storage/db", () => ({
  db: new Proxy({}, { get: fixture.forbiddenDatabase }),
  pool: new Proxy({}, { get: fixture.forbiddenDatabase }),
  registerPoolCheckoutInitializer: fixture.forbiddenDatabase,
}));
vi.mock("../../server/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../server/config/env-registry", () => ({
  registerEnvironmentVariable: vi.fn(),
  registerEnvironmentVariables: vi.fn(),
  getEnvironmentVariable: (name: string) =>
    name === "MAINTENANCE_TEST_CREDENTIAL" ? "SG.fixture-never-sent" : undefined,
}));
vi.mock("../../server/plugins/_core/gating", () => ({
  isPluginComponentEnabledAsync: async () => true,
}));
vi.mock("../../server/flood/service", () => ({
  enforceConfiguredFloodLimits: async () => undefined,
  FloodError: class FloodError extends Error {},
}));
vi.mock("../../server/services/webclient/vendor-http", () => ({
  createVendorHttp: () => ({ fetch: fixture.httpFetch, throwIfRefused: () => undefined }),
}));
vi.mock("puppeteer-core", () => ({ default: { launch: fixture.launch } }));
import {
  MaintenanceModeError,
  assertExternalServiceAllowed,
  isMaintenanceActive,
  isMaintenanceModeError,
  setMaintenanceActive,
} from "../../server/services/maintenance-flag";
import { isMaintenanceActive as isMaintenanceActiveFromWriteLock } from "../../server/services/maintenance-mode";
import type { PostalAddress } from "../../server/services/comm/providers/postal";
import { addressValidationService } from "../../server/services/comm/validators/address";
import { lookupRepresentatives } from "../../server/services/google-civics";
import { wcRequest } from "../../server/services/webclient";
import { postalRequest } from "../../server/services/comm/postal-vendor";
import {
  BTU_CARDCHECK_PLUGIN_ID,
} from "../../server/plugins/wc-vendors/plugins/btu-cardcheck";
import type { PluginConfig } from "@shared/schema";
import "../../server/plugins/wc-vendors/plugins/sms-twilio";
import "../../server/plugins/wc-vendors/plugins/email";
import "../../server/plugins/wc-vendors/plugins/postal";

function connection(pluginId: string): PluginConfig {
  return {
    id: `maintenance-${pluginId}`,
    pluginKind: "wc-vendors",
    pluginId,
    enabled: true,
    ordering: 0,
    data: {
      secretName: "MAINTENANCE_TEST_CREDENTIAL",
      accountSid: `AC${"0".repeat(32)}`,
      fromNumber: "+16175550000",
      defaultFromEmail: "maintenance@example.com",
      siteUrl: "https://maintenance.invalid",
      username: "fixture",
      chromiumPath: "/never-launch-chromium",
    },
  } as PluginConfig;
}

/** The address-validation shape (Google side). */
const ADDRESS = {
  street: "1 Main St",
  city: "Boston",
  state: "MA",
  postalCode: "02108",
  country: "US",
};

/** The postal-provider shape (Lob side) — a different contract, same address. */
const POSTAL_ADDRESS: PostalAddress = {
  addressLine1: "987 Maintenance Test Ave",
  city: "Cambridge",
  state: "MA",
  zip: "02139-9998",
  country: "US",
};

const MAINTENANCE_PHONE = "+16175559998";

/**
 * Every vendor operation the guard covers, as a callable. Sends AND reads:
 * a phone lookup, an address verification, a geocode, a status poll and a
 * template listing all spend vendor quota or vendor state too.
 */
function operations() {
  return [
    ["Twilio", "testConnection", () => wcRequest({
      vendor: { pluginId: "twilio" },
      operation: "service.test-connection",
      args: undefined,
    })],
    ["Twilio", "getConfiguration", () => wcRequest({
      vendor: { pluginId: "twilio" },
      operation: "communications.sms.configuration.read",
      args: undefined,
    })],
    ["Twilio", "validatePhone", () => wcRequest({
      vendor: { pluginId: "twilio" },
      operation: "communications.phone.validate",
      args: { phoneNumber: MAINTENANCE_PHONE },
    })],
    ["Twilio", "sendSms", () => wcRequest({
      vendor: { pluginId: "twilio" },
      operation: "communications.sms.send",
      args: { to: "+16175551212", body: "hi" },
    })],
    ["Twilio", "getAvailablePhoneNumbers", () => wcRequest({
      vendor: { pluginId: "twilio" },
      operation: "communications.phone.list",
      args: undefined,
    })],

    ["SendGrid", "testConnection", () => wcRequest({
      vendor: { pluginId: "sendgrid" },
      operation: "service.test-connection",
      args: undefined,
    })],
    [
      "SendGrid",
      "sendEmail",
      () => wcRequest({
        vendor: { pluginId: "sendgrid" },
        operation: "communications.email.send",
        args: { to: { email: "a@example.com" }, subject: "s", text: "t" },
      }),
    ],

    ["Lob", "testConnection", () => postalRequest("lob", "service.test-connection", undefined)],
    ["Lob", "verifyAddress", () => postalRequest("lob", "communications.postal.address.verify", POSTAL_ADDRESS)],
    [
      "Lob",
      "sendLetter",
      () =>
        postalRequest("lob", "communications.postal.send", {
          to: POSTAL_ADDRESS,
          from: POSTAL_ADDRESS,
          file: "<html><body>hi</body></html>",
          description: "test",
        }),
    ],
    ["Lob", "getLetterStatus", () => postalRequest("lob", "communications.postal.letter.status", { letterId: "ltr_123" })],
    ["Lob", "cancelLetter", () => postalRequest("lob", "communications.postal.letter.cancel", { letterId: "ltr_123" })],
    ["Lob", "listTemplates", () => postalRequest("lob", "communications.postal.template.list", undefined)],

    ["Google", "validateAddress", () => addressValidationService.validateAddress(ADDRESS)],
    [
      "Google",
      "parseAndValidate",
      () => addressValidationService.parseAndValidate({ rawAddress: "1 Main St, Boston MA" }),
    ],
    ["Google", "geocodeAddress", () => addressValidationService.geocodeAddress(ADDRESS)],
    ["Google", "lookupRepresentatives", () => lookupRepresentatives("1 Main St, Boston MA")],

    // The BTU client is written to answer rather than throw:
    // every remote and network condition comes back as a result an operator
    // reads on a diagnostics page. A refusal must NOT be converted into one of
    // those — it would report the remote system as unwell when nobody asked it
    // anything — so each is asserted the same way as a vendor call.
    [
      "BTU",
      "login",
      () =>
        wcRequest({
          vendor: { pluginId: BTU_CARDCHECK_PLUGIN_ID },
          operation: "sitespecific.btu.cardcheck.login",
          args: undefined,
        }),
    ],
  ] as const;
}

/** Any unmocked network attempt is a failure, even if a caller swallows it. */
let networkAttempts: string[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  fixture.cacheRead.mockReset().mockResolvedValue(undefined);
  fixture.cacheWriteSuccess.mockResolvedValue(undefined);
  fixture.cacheWriteFailure.mockResolvedValue(undefined);
  fixture.canStore.mockResolvedValue(true);
  fixture.recordCall.mockResolvedValue(undefined);
  fixture.getConfig.mockImplementation(async (id: string) => connection(id.replace(/^maintenance-/, "")));
  fixture.getByPlugin.mockImplementation(async (_kind: string, pluginId: string) => [connection(pluginId)]);
  fixture.getVariable.mockImplementation(async (name: string) => {
    if (name !== "address_validation_config") throw new Error(`Unexpected variable read: ${name}`);
    return { value: {
      mode: "google",
      local: { enabled: true, countries: ["US"], strictValidation: true },
      google: { enabled: true, components: {} },
      fallback: { useLocalOnGoogleFailure: true, logValidationAttempts: false },
    } };
  });
  fixture.httpFetch.mockRejectedValue(new Error("Fixture HTTP boundary reached; no request sent"));
  fixture.launch.mockRejectedValue(new Error("Fixture browser boundary reached; no browser launched"));
  networkAttempts = [];
  vi.spyOn(Socket.prototype, "connect").mockImplementation(function () {
    networkAttempts.push("socket");
    throw new Error("Real sockets forbidden in maintenance tests");
  });
  vi.stubGlobal("fetch", (input: unknown) => {
    const url = typeof input === "string" ? input : String((input as { url?: string })?.url ?? input);
    networkAttempts.push(url);
    return Promise.reject(new Error(`network blocked in tests: ${url}`));
  });
});

afterEach(() => {
  try {
    expect(networkAttempts).toEqual([]);
    expect(fixture.forbiddenDatabase).not.toHaveBeenCalled();
  } finally {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    setMaintenanceActive(false);
  }
});

describe("the refusal itself", () => {
  it("is silent when maintenance is off", () => {
    setMaintenanceActive(false);
    expect(() => assertExternalServiceAllowed("Lob", "send letter")).not.toThrow();
  });

  it("names the service and the operation, and reads the same for all four", () => {
    setMaintenanceActive(true);
    const messages = (["Twilio", "SendGrid", "Lob", "Google"] as const).map((service) => {
      try {
        assertExternalServiceAllowed(service, "do a thing");
        throw new Error(`${service} was not refused`);
      } catch (error) {
        expect(isMaintenanceModeError(error)).toBe(true);
        return (error as MaintenanceModeError).message;
      }
    });

    for (const message of messages) {
      expect(message).toContain("maintenance mode");
      expect(message).toContain("do a thing");
    }
    // One wording: the messages differ only by the service name.
    const shapes = new Set(messages.map((m) => m.replace(/^\w+ /, "")));
    expect(shapes.size).toBe(1);
  });

  it("carries a service-unavailable status, so a caller answers 503 not 500", () => {
    const error = new MaintenanceModeError("Lob", "send letter");
    expect(error.status).toBe(503);
    expect(error.statusCode).toBe(503);
  });

  it("is the same flag the database write lock reads", () => {
    // If these ever became two booleans, the site could refuse vendors while
    // still accepting writes, or the reverse.
    setMaintenanceActive(true);
    expect(isMaintenanceActive()).toBe(true);
    expect(isMaintenanceActiveFromWriteLock()).toBe(true);
    setMaintenanceActive(false);
    expect(isMaintenanceActiveFromWriteLock()).toBe(false);
  });
});

// Each test starts with a mocked cache miss. Never clear the configured cache:
// a fresh stored answer (including a failure hold) may legitimately be served
// during maintenance, but is not the outbound path these refusal cases cover.
describe("with maintenance ON, no vendor is reached", () => {
  beforeEach(() => setMaintenanceActive(true));

  for (const [service, name, run] of operations()) {
    it(`${service}.${name} refuses`, async () => {
      await expect(run()).rejects.toBeInstanceOf(MaintenanceModeError);
      expect(fixture.httpFetch).not.toHaveBeenCalled();
      expect(fixture.launch).not.toHaveBeenCalled();
      expect(fixture.cacheWriteSuccess).not.toHaveBeenCalled();
      expect(fixture.cacheWriteFailure).not.toHaveBeenCalled();
      expect(fixture.recordCall).not.toHaveBeenCalled();
      expect(networkAttempts).toEqual([]);
    });
  }

  it("the address validator does not fall back to local validation", async () => {
    // The fallback path answers a Google outage with a locally-validated
    // address. Reporting a successful validation here would hide that the
    // configured validator never ran.
    await expect(addressValidationService.validateAddress(ADDRESS)).rejects.toBeInstanceOf(
      MaintenanceModeError,
    );
  });

  it("Lob's swallowing methods surface the refusal instead of an empty/undeliverable answer", async () => {
    await expect(postalRequest("lob", "communications.postal.template.list", undefined)).rejects.toBeInstanceOf(MaintenanceModeError);
    await expect(postalRequest("lob", "communications.postal.address.verify", POSTAL_ADDRESS)).rejects.toBeInstanceOf(MaintenanceModeError);
  });

  it("local providers keep working — they call nothing external", async () => {
    for (const pluginId of ["local-email", "local-postal"]) {
      await expect(wcRequest({
        vendor: { pluginId }, operation: "service.test-connection", args: undefined,
      })).resolves.toMatchObject({ outcome: "success", value: { status: "connected" } });
    }
    expect(fixture.httpFetch).not.toHaveBeenCalled();
    expect(fixture.launch).not.toHaveBeenCalled();
    expect(networkAttempts).toEqual([]);
  });
});

describe("with maintenance OFF, nothing is refused", () => {
  beforeEach(() => setMaintenanceActive(false));

  for (const [service, name, run] of operations()) {
    it(`${service}.${name} gets past the guard`, async () => {
      // Fake connections and credentials let the real handlers reach their
      // blocked transport. Merely "not a maintenance error" could pass because
      // of a missing config or broken import, so assert reachability as well.
      let result: unknown;
      try {
        result = await run();
      } catch (error) {
        expect(isMaintenanceModeError(error)).toBe(false);
      }
      if (service === "BTU") {
        expect(fixture.launch).toHaveBeenCalledOnce();
      } else if (service === "Lob" && name === "testConnection") {
        // Lob deliberately has no non-destructive remote probe. Prove the
        // real handler ran, not just that configuration resolution succeeded.
        expect(result).toMatchObject({
          status: "unsupported",
          error: { message: expect.stringContaining("no non-destructive connection probe") },
        });
        expect(fixture.httpFetch).not.toHaveBeenCalled();
      } else {
        expect(fixture.httpFetch).toHaveBeenCalled();
      }
    });
  }
});

describe("leaving maintenance restores vendors live, with no restart", () => {
  it("flips on the flag change, in the same process", async () => {
    setMaintenanceActive(true);
    await expect(postalRequest("lob", "communications.postal.template.list", undefined)).rejects.toBeInstanceOf(MaintenanceModeError);

    setMaintenanceActive(false);
    let refusedAfterExit = false;
    try {
      await postalRequest("lob", "communications.postal.template.list", undefined);
    } catch (error) {
      refusedAfterExit = isMaintenanceModeError(error);
    }
    expect(refusedAfterExit).toBe(false);
    expect(fixture.httpFetch).toHaveBeenCalledOnce();

    setMaintenanceActive(true);
    await expect(postalRequest("lob", "communications.postal.template.list", undefined)).rejects.toBeInstanceOf(MaintenanceModeError);
  });
});
