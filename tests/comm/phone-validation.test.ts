/**
 * Paid lookup regression coverage retained from the legacy provider suite.
 * Exercise real WC routing/cache policy with fake SDK, storage and credentials:
 * no database, shared cache deletion or paid request is permitted here.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  selected: "twilio",
  settings: {} as Record<string, unknown>,
  writable: true,
  writeThrows: false,
  lookup: vi.fn(),
  settingsReads: vi.fn(),
  canStore: vi.fn(),
  optinWrite: vi.fn(),
  read: vi.fn(),
  store: new Map<string, { outcome: "success" | "failure"; response: unknown; fetchedAt: Date }>(),
}));

function configs() {
  return ["twilio", "sms-local"].map((pluginId) => ({
    id: `${pluginId}-config`, pluginId, pluginKind: "wc-vendors", enabled: true, ordering: 0,
    data: {
      ...(pluginId === "twilio" ? {
        accountSid: "AC_test", fromNumber: "+16175550142", secretName: "PHONE_LOOKUP_TEST_SECRET",
        phoneValidation: state.settings,
      } : { phoneValidation: { defaultCountry: "US" } }),
      operations: pluginId === state.selected ? ["communications.phone.validate"] : [],
    },
  }));
}
vi.mock("../../server/storage", () => ({
  storage: { pluginConfigs: {
    getByKind: async () => configs(),
    get: async (id: string) => configs().find((config) => config.id === id),
    getByKindAndPlugin: async (_kind: string, id: string) => {
      state.settingsReads(id);
      return configs().filter((config) => config.pluginId === id);
    },
  } },
}));
vi.mock("twilio", () => ({
  default: () => ({ lookups: { v2: { phoneNumbers: (phone: string) => ({
    fetch: () => state.lookup(phone),
  }) } } }),
}));
vi.mock("../../server/storage/wc-stats", () => ({
  wcStatsStorage: { recordCall: vi.fn() },
}));
vi.mock("../../server/storage/wc-cache", () => ({
  wcRequestKeyHash: (key: string) => key,
  wcCacheStorage: {
    read: async (_type: string, key: string) => { state.read(key); return state.store.get(key); },
    canStore: async () => { state.canStore(); return state.writable; },
    writeSuccess: async (_service: string, _config: string, _type: string, key: string, response: unknown) => {
      if (state.writeThrows) throw new Error("cannot execute INSERT in a read-only transaction");
      state.store.set(key, { outcome: "success", response, fetchedAt: new Date() });
    },
    writeFailure: async (_service: string, _config: string, _type: string, key: string, error: string | undefined, boundary: Date) => {
      const current = state.store.get(key);
      if (current?.outcome === "success" && current.fetchedAt >= boundary) return;
      state.store.set(key, { outcome: "failure", response: { error: error ?? null }, fetchedAt: new Date() });
    },
  },
}));
vi.mock("../../server/storage/phone-optin-validation", () => ({
  phoneOptinValidation: { write: (...args: unknown[]) => state.optinWrite(...args) },
}));
vi.mock("../../server/storage/transaction-context", () => ({
  runOutsideTransaction: <T>(fn: () => T) => fn(),
}));
vi.mock("../../server/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import "../../server/plugins/wc-vendors/plugins/sms-twilio";
import "../../server/plugins/wc-vendors/plugins/sms-local";
import { resetUnstorableHolds } from "../../server/services/webclient";
import { resetPhoneValidationSettings } from "../../server/services/comm/validators/phone-validation-settings";
import { PhoneValidationService, DEFAULT_REVALIDATE_AFTER_DAYS } from "../../server/services/comm/validators/phone";

const NUMBER = "(617) 555-0142";
const E164 = "+16175550142";
let service: PhoneValidationService;

beforeEach(() => {
  vi.clearAllMocks();
  state.store.clear();
  state.settings = {};
  state.selected = "twilio";
  state.writable = true;
  state.writeThrows = false;
  state.lookup.mockReset().mockResolvedValue({
    valid: true, phoneNumber: E164, countryCode: "US",
    lineTypeIntelligence: { type: "mobile", carrierName: "Test Carrier" },
  });
  vi.stubEnv("PHONE_LOOKUP_TEST_SECRET", "test-token");
  resetPhoneValidationSettings();
  resetUnstorableHolds();
  service = new PhoneValidationService("US");
});
afterEach(() => vi.unstubAllEnvs());

describe("phone validation call frequency through WC vendors", () => {
  it("validates a new number once and serves every later call from storage", async () => {
    for (let i = 0; i < 6; i++) {
      expect(await service.validateAndFormat(NUMBER)).toMatchObject({
        isValid: true, e164Format: E164, smsPossible: true,
      });
    }
    expect(state.lookup).toHaveBeenCalledTimes(1);
    expect(state.optinWrite).toHaveBeenCalledTimes(1);
  });
  it("never calls a provider or reads the cache in never mode", async () => {
    expect(await service.validateAndFormat(NUMBER, { revalidate: "never" })).toMatchObject({
      isValid: true, e164Format: E164,
    });
    expect(state.lookup).not.toHaveBeenCalled();
    expect(state.read).not.toHaveBeenCalled();
  });
  it("produces the same E.164 in every mode", async () => {
    const results = await Promise.all((["never", "default", "always"] as const).map(
      (revalidate) => service.validateAndFormat(NUMBER, { revalidate }),
    ));
    expect(new Set(results.map((result) => result.e164Format))).toEqual(new Set([E164]));
  });
  it.each([DEFAULT_REVALIDATE_AFTER_DAYS, 1])("revalidates after the configured %i-day age", async (days) => {
    state.settings = { revalidateAfterDays: days };
    await service.validateAndFormat(NUMBER);
    state.store.get(E164)!.fetchedAt = new Date(Date.now() - (days + 1) * 86400000);
    await service.validateAndFormat(NUMBER);
    expect(state.lookup).toHaveBeenCalledTimes(2);
  });
  it("asks again in always mode however fresh the stored answer is", async () => {
    await service.validateAndFormat(NUMBER);
    await service.validateAndFormat(NUMBER, { revalidate: "always" });
    expect(state.lookup).toHaveBeenCalledTimes(2);
  });
  it("does not pay for a lookup when its answer could not be stored", async () => {
    state.writable = false;
    expect(await service.validateAndFormat(NUMBER, { revalidate: "always" })).toMatchObject({
      isValid: true, e164Format: E164,
    });
    expect(state.lookup).not.toHaveBeenCalled();
  });
  it("serves a stored answer on a read-only connection instead of a bare parse", async () => {
    await service.validateAndFormat(NUMBER);
    state.writable = false;
    expect((await service.validateAndFormat(NUMBER, { revalidate: "always" })).smsPossible).toBe(true);
    expect(state.lookup).toHaveBeenCalledTimes(1);
  });
  it("never reaches the provider for a number that fails the local parse", async () => {
    expect((await service.validateAndFormat("12345")).isValid).toBe(false);
    expect(state.lookup).not.toHaveBeenCalled();
    expect(state.canStore).not.toHaveBeenCalled();
  });
  it("uses local validation without a paid lookup when Local is assigned", async () => {
    state.selected = "sms-local";
    expect((await service.validateAndFormat(NUMBER, { revalidate: "always" })).e164Format).toBe(E164);
    expect(state.lookup).not.toHaveBeenCalled();
  });
  it("records lookup failure rather than freshness and backs off instead of retrying", async () => {
    state.lookup.mockRejectedValueOnce(new Error("twilio unreachable"));
    expect((await service.validateAndFormat(NUMBER)).isValid).toBe(true);
    expect(state.store.get(E164)).toMatchObject({
      outcome: "failure", response: { error: "twilio unreachable" },
    });
    await service.validateAndFormat(NUMBER);
    expect(state.lookup).toHaveBeenCalledTimes(1);
  });
  it("treats missing line-type intelligence as a failure, never a validation", async () => {
    state.lookup.mockResolvedValueOnce({ valid: true, phoneNumber: E164 });
    await service.validateAndFormat(NUMBER);
    expect(state.store.get(E164)?.outcome).toBe("failure");
  });
  it("backs off after paying for an answer it could not store", async () => {
    state.writeThrows = true;
    await service.validateAndFormat(NUMBER);
    expect(state.store.has(E164)).toBe(false);
    state.writeThrows = false;
    await service.validateAndFormat(NUMBER);
    expect(state.lookup).toHaveBeenCalledTimes(1);
  });
  it("reads each vendor's settings only once for a run of normalizations", async () => {
    for (let i = 0; i < 10; i++) await service.validateAndFormat(NUMBER, { revalidate: "never" });
    expect(state.settingsReads).toHaveBeenCalledTimes(2);
  });
  it("retains a completed negative validity answer rather than paying again for the same number", async () => {
    state.lookup.mockResolvedValueOnce({
      valid: false, phoneNumber: E164, countryCode: "US",
      lineTypeIntelligence: { type: "unknown" },
    });
    expect((await service.validateAndFormat(NUMBER)).isValid).toBe(false);
    expect(state.store.get(E164)).toMatchObject({ outcome: "success", response: { valid: false } });
    expect((await service.validateAndFormat(NUMBER)).isValid).toBe(false);
    expect(state.lookup).toHaveBeenCalledTimes(1);
  });
});
