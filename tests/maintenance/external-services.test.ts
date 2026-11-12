/**
 * SAFETY: THIS ENTIRE SUITE IS INTENTIONALLY DISABLED.
 *
 * Its setup deletes paid WC cache data from whichever database the test
 * process is configured to use. Do not re-enable any suite in this file until
 * its database behavior is isolated and cannot alter shared development or
 * production data.
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
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { wcCacheStorage } from "../../server/storage/wc-cache";
import { getRawProcessEnv } from "../../server/config/env-registry";
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
import { getWcVendorPlugin } from "../../server/plugins/wc-vendors";
import { wcRequest } from "../../server/services/webclient";
import { postalRequest } from "../../server/services/comm/postal-vendor";
import { T631_PLUGIN_ID } from "../../server/plugins/wc-vendors/plugins/sitespecific-t631";
import {
  FREEMAN_EDLS_MIGRATE_PLUGIN_ID,
} from "../../server/plugins/wc-vendors/plugins/sitespecific-freeman-edls-migrate";
import {
  BTU_CARDCHECK_PLUGIN_ID,
} from "../../server/plugins/wc-vendors/plugins/btu-cardcheck";
import { getWcVendorHandler } from "../../server/plugins/wc-vendors/registry";
import type { PluginConfig } from "@shared/schema";
import { migrateLegacyCivicWcVendorConfigs } from "../../server/plugins/wc-vendors";

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
 * The T631 ping as a caller makes it: named vendor, named operation, through
 * the one door.
 *
 * There is no fabricated context any more — a registered plugin carries no
 * runnable handler, so this goes through the framework, which is the point.
 * The refusal is asserted as soon as the service is known, before any
 * connection is read, so this stands up on a database with no T631 connection
 * configured: with the flag on it must refuse, and with the flag off it must
 * get far enough to complain about the missing connection instead.
 */
async function t631Ping(): Promise<unknown> {
  const plugin = getWcVendorPlugin(T631_PLUGIN_ID);
  if (!plugin?.operations["sitespecific.t631.service.ping"]) {
    throw new Error("T631 ping operation is not registered");
  }
  return wcRequest({
    vendor: { pluginId: T631_PLUGIN_ID },
    operation: "sitespecific.t631.service.ping",
    args: undefined as never,
  });
}

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

    // The two site-specific clients are written to answer rather than throw:
    // every remote and network condition comes back as a result an operator
    // reads on a diagnostics page. A refusal must NOT be converted into one of
    // those — it would report the remote system as unwell when nobody asked it
    // anything — so each is asserted the same way as a vendor call.
    ["T631", "ping", () => t631Ping()],
    [
      "Freeman EDLS",
      "ping",
      () =>
        wcRequest({
          vendor: { pluginId: FREEMAN_EDLS_MIGRATE_PLUGIN_ID },
          operation: "service.test-connection",
          args: undefined,
        }),
    ],
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

/** Any network attempt is a test failure, whichever way the flag is set. */
let networkAttempts: string[] = [];

beforeEach(() => {
  networkAttempts = [];
  vi.stubGlobal("fetch", (input: unknown) => {
    const url = typeof input === "string" ? input : String((input as { url?: string })?.url ?? input);
    networkAttempts.push(url);
    return Promise.reject(new Error(`network blocked in tests: ${url}`));
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  setMaintenanceActive(false);
});

describe.skip("the refusal itself", () => {
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

/**
 * Forget every stored answer for the services asserted below.
 *
 * The cacheable operations now answer from the web client cache when a fresh
 * answer is stored, and a stored answer is served without asking anybody —
 * during maintenance too, deliberately, because reading a stored answer is not
 * an outbound call. That includes a stored FAILURE, which is the hold that
 * stops an outage becoming a retry storm.
 *
 * This suite asks the other question: when the vendor WOULD have to be asked,
 * is it refused? So it starts from nothing stored. Without this, a run that
 * stored a failure (this suite stubs the network to throw, so the
 * maintenance-OFF half does exactly that) makes the NEXT run pass its
 * refusals off as stored answers and fail.
 */
/**
 * Give the civic lookup a key, if this machine has none.
 *
 * The refusal now comes from inside the framework request rather than from a
 * guard at the top of the method, so the caller reads its key first. On a
 * machine without one, "no key configured" answers before maintenance mode
 * ever gets a say — a configuration difference, not the behavior under test.
 * The network is stubbed to throw either way, so the key is never used.
 */
function ensureCivicKey(): void {
  const env = getRawProcessEnv();
  if (!env.GOOGLE_MAPS_API_KEY && !env.GOOGLE_CIVICS_API_KEY) {
    env.GOOGLE_MAPS_API_KEY = "test-civic-key-never-sent";
  }
}

async function forgetStoredAnswers(): Promise<void> {
  for (const service of ["Google", "Census", "Twilio", "Lob"]) {
    const rows = await wcCacheStorage.list({ service, page: 1, pageSize: 500 });
    for (const row of rows) await wcCacheStorage.deleteById(row.id);
  }
}

describe.skip("with maintenance ON, no vendor is reached", () => {
  beforeAll(async () => {
    ensureCivicKey();
    await migrateLegacyCivicWcVendorConfigs();
    await forgetStoredAnswers();
  });
  beforeEach(() => setMaintenanceActive(true));

  for (const [service, name, run] of operations()) {
    it(`${service}.${name} refuses`, async () => {
      await expect(run()).rejects.toBeInstanceOf(MaintenanceModeError);
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
    const localEmailTest = getWcVendorHandler("local-email", "service.test-connection");
    if (!localEmailTest) throw new Error("Local Email test operation is not registered");
    await expect(localEmailTest({
      credential: { value: "" },
      config: { id: "test-local-email", pluginKind: "wc-vendors", pluginId: "local-email", enabled: true, ordering: 0 } as PluginConfig,
    }, undefined as never)).resolves.toMatchObject({
      status: "connected",
    });
    const localPostalTest = getWcVendorHandler("local-postal", "service.test-connection");
    if (!localPostalTest) throw new Error("Local Postal test operation is not registered");
    await expect(localPostalTest({
      credential: { value: "" },
      config: { id: "test-local-postal", pluginKind: "wc-vendors", pluginId: "local-postal", enabled: true, ordering: 0 } as PluginConfig,
    }, undefined as never)).resolves.toMatchObject({
      status: "connected",
    });
    expect(networkAttempts).toEqual([]);
  });
});

describe.skip("with maintenance OFF, nothing is refused", () => {
  beforeEach(() => setMaintenanceActive(false));

  for (const [service, name, run] of operations()) {
    it(`${service}.${name} gets past the guard`, async () => {
      // These still fail — the network is stubbed and no vendor key is
      // resolvable here — but they must never fail AS a maintenance refusal.
      // That is what proves the guard, and not something else, is what
      // maintenance mode changed.
      try {
        await run();
      } catch (error) {
        expect(isMaintenanceModeError(error)).toBe(false);
      }
    });
  }
});

describe.skip("leaving maintenance restores vendors live, with no restart", () => {
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

    setMaintenanceActive(true);
    await expect(postalRequest("lob", "communications.postal.template.list", undefined)).rejects.toBeInstanceOf(MaintenanceModeError);
  });
});
