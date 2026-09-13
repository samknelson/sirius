/**
 * How often the phone validator is allowed to call the provider.
 *
 * Every path in the app that needs a phone number in E.164 goes through
 * `validateAndFormat`, including paths with no interest in whether the number
 * is real — building a `WHERE` clause, checking an opt-in, listing a contact's
 * numbers. Each of those used to bill a Twilio Lookup. The rules that stop
 * that are invisible at runtime: nothing breaks when they regress, the app
 * just quietly starts spending money again, and the only place it shows is a
 * provider invoice nobody reads until the end of the month.
 *
 * So these tests count calls. They stub the provider and the cache rather than
 * touching a database, because the thing under test is the decision to call,
 * not what is stored.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const providerSettings: Record<string, any> = {
  local: { phoneValidation: { defaultCountry: 'US' } },
  twilio: { phoneValidation: {} },
};

const lookup = vi.fn(async (phoneNumber: string) => ({
  valid: true,
  formatted: phoneNumber,
  countryCode: 'US',
  type: 'mobile',
  carrier: 'Test Carrier',
  smsPossible: true,
  voicePossible: true,
}));

let providerId = 'twilio';

const getPluginConfigs = vi.fn(
  async (_kind: string, pluginId: string) => [{
    id: `test-${pluginId}`,
    pluginKind: 'wc-vendors',
    pluginId,
    enabled: pluginId === 'twilio' ? providerId === 'twilio' : providerId === 'local',
    name: pluginId,
    siriusId: null,
    ordering: 0,
    isSingleton: false,
    data: providerSettings[pluginId === 'sms-local' ? 'local' : pluginId],
  }],
);

const resolveSmsVendor = vi.fn(async () => ({
  target: { pluginId: providerId === 'twilio' ? 'twilio' : 'sms-local' },
  pluginId: providerId === 'twilio' ? 'twilio' : 'sms-local',
  config: {
    id: `test-${providerId}`,
    pluginId: providerId === 'twilio' ? 'twilio' : 'sms-local',
  },
}));

vi.mock('../../server/services/comm/sms-vendor', () => ({
  ensureSmsVendorConfig: vi.fn(async () => undefined),
  resolveSmsVendor,
}));

vi.mock('../../server/storage', () => ({
  storage: {
    pluginConfigs: {
      getByKindAndPlugin: getPluginConfigs,
    },
  },
}));

/**
 * The paid lookup itself is now a wc-vendor operation. Keep the real webclient
 * transport/cache wrapper under test, and replace only the vendor context
 * (which would otherwise resolve a real Twilio config and SDK).
 */
vi.mock('../../server/services/webclient/wc-vendor-context', () => ({
  runWcVendorRequest: async (options: any, transport: (request: any) => Promise<unknown>) =>
    transport({
      service: 'Twilio',
      requestType: 'validate-phone',
      args: {
        configId: 'test-twilio',
        args: options.args,
      },
      mode: options.mode,
      fetch: async () => {
        try {
          const value = await lookup(options.args.phoneNumber);
          if (value.valid && value.smsPossible === undefined) {
            return {
              answered: false,
              error: 'Provider answered without line-type intelligence',
            };
          }
          return { answered: true, value, store: value.valid };
        } catch (error) {
          return {
            answered: false,
            error: error instanceof Error ? error.message : 'Provider validation failed',
          };
        }
      },
    }),
}));

/**
 * A row of the web client cache, as the framework sees it. Phone validation
 * no longer keeps its own store: it is one request type among others, and
 * what is cached is the Lookup response keyed by the E.164 number.
 */
interface StoredEntry {
  service: string;
  requestType: string;
  requestKey: string;
  outcome: 'success' | 'failure';
  response: unknown;
  fetchedAt: Date;
}

const store = new Map<string, StoredEntry>();
let writable = true;
let writeThrows = false;
const canStore = vi.fn(async () => writable);
const optinWrite = vi.fn(async () => {});

vi.mock('../../server/storage/wc-cache', () => ({
  wcRequestKeyHash: (requestKey: string) => requestKey,
  wcCacheStorage: {
    read: async (_service: string, _requestType: string, requestKey: string) =>
      store.get(requestKey),
    writeSuccess: async (
      service: string,
      requestType: string,
      requestKey: string,
      response: unknown,
    ) => {
      if (writeThrows) throw new Error('cannot execute INSERT in a read-only transaction');
      store.set(requestKey, {
        service,
        requestType,
        requestKey,
        outcome: 'success',
        response,
        fetchedAt: new Date(),
      });
    },
    writeFailure: async (
      service: string,
      requestType: string,
      requestKey: string,
      error: string | undefined,
      keepSuccessNewerThan: Date,
    ) => {
      const existing = store.get(requestKey);
      // A still-fresh answer outlives an outage; see the framework's own guard.
      if (existing?.outcome === 'success' && existing.fetchedAt >= keepSuccessNewerThan) return;
      store.set(requestKey, {
        service,
        requestType,
        requestKey,
        outcome: 'failure',
        response: { error: error ?? null },
        fetchedAt: new Date(),
      });
    },
    canStore: () => canStore(),
  },
}));

vi.mock('../../server/storage/phone-optin-validation', () => ({
  phoneOptinValidation: { write: () => optinWrite() },
}));

vi.mock('../../server/logger', () => ({
  logger: { error: () => {}, warn: () => {}, info: () => {}, debug: () => {} },
}));

vi.mock('../../server/storage/transaction-context', () => ({
  runOutsideTransaction: <T>(fn: () => T) => fn(),
}));

await import('../../server/plugins/wc-vendors/plugins/sms-twilio');
const { resetUnstorableHolds } = await import('../../server/services/webclient');
const { resetPhoneValidationSettings } = await import(
  '../../server/services/comm/validators/phone-validation-settings'
);
const { getPhoneValidationSettings } = await import(
  '../../server/services/comm/validators/phone-validation-settings'
);
const { PhoneValidationService, DEFAULT_REVALIDATE_AFTER_DAYS } = await import(
  '../../server/services/comm/validators/phone'
);

const NUMBER = '(617) 555-0142';
const E164 = '+16175550142';
const CACHE_KEY = `test-twilio:${E164}`;

let service: InstanceType<typeof PhoneValidationService>;

beforeEach(() => {
  lookup.mockClear();
  canStore.mockClear();
  getPluginConfigs.mockClear();
  resolveSmsVendor.mockClear();
  optinWrite.mockClear();
  store.clear();
  // The settings memo and the "paid for it, could not store it" hold both
  // outlive an instance now that they are module-level.
  resetPhoneValidationSettings();
  resetUnstorableHolds();
  providerSettings.twilio = { phoneValidation: {} };
  providerId = 'twilio';
  writable = true;
  writeThrows = false;
  service = new PhoneValidationService('US');
});

describe('phone validation call frequency', () => {
  it('validates a new number once and serves every later call from storage', async () => {
    const first = await service.validateAndFormat(NUMBER);
    expect(first.isValid).toBe(true);
    expect(first.e164Format).toBe(E164);
    expect(first.smsPossible).toBe(true);
    expect(lookup).toHaveBeenCalledTimes(1);

    for (let i = 0; i < 5; i++) {
      const again = await service.validateAndFormat(NUMBER);
      expect(again.e164Format).toBe(E164);
      expect(again.smsPossible).toBe(true);
    }
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it('never calls the provider or reads storage in `never` mode', async () => {
    const read = vi.spyOn(store, 'get');
    const result = await service.validateAndFormat(NUMBER, { revalidate: 'never' });

    expect(result.isValid).toBe(true);
    expect(result.e164Format).toBe(E164);
    expect(lookup).not.toHaveBeenCalled();
    // A cache read here would deadlock the design: the cache lives on the
    // opt-in row, and reading an opt-in normalizes through this function.
    expect(read).not.toHaveBeenCalled();
    read.mockRestore();
  });

  it('produces the same E.164 in every mode', async () => {
    const modes = ['never', 'default', 'always'] as const;
    const formatted = new Set<string | undefined>();
    for (const revalidate of modes) {
      formatted.add((await service.validateAndFormat(NUMBER, { revalidate })).e164Format);
    }
    expect([...formatted]).toEqual([E164]);
  });

  it('re-validates once the stored answer passes the configured age', async () => {
    await service.validateAndFormat(NUMBER);
    expect(lookup).toHaveBeenCalledTimes(1);

    const stale = store.get(CACHE_KEY)!;
    stale.fetchedAt = new Date(
      Date.now() - (DEFAULT_REVALIDATE_AFTER_DAYS + 1) * 24 * 60 * 60 * 1000,
    );

    await service.validateAndFormat(NUMBER);
    expect(lookup).toHaveBeenCalledTimes(2);
  });

  it('honours a shortened revalidation age', async () => {
    providerSettings.twilio = { phoneValidation: { revalidateAfterDays: 1 } };
    await service.validateAndFormat(NUMBER);

    const stored = store.get(CACHE_KEY)!;
    stored.fetchedAt = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);

    await service.validateAndFormat(NUMBER);
    expect(lookup).toHaveBeenCalledTimes(2);
  });

  it('asks again in `always` mode however fresh the stored answer is', async () => {
    await service.validateAndFormat(NUMBER);
    await service.validateAndFormat(NUMBER, { revalidate: 'always' });
    expect(lookup).toHaveBeenCalledTimes(2);
  });

  it('does not call the provider when the result could not be stored', async () => {
    writable = false;
    const result = await service.validateAndFormat(NUMBER, { revalidate: 'always' });

    expect(lookup).not.toHaveBeenCalled();
    // Still a usable answer — just a locally-derived one.
    expect(result.isValid).toBe(true);
    expect(result.e164Format).toBe(E164);
  });

  it('serves the stored answer on a read-only connection rather than a bare parse', async () => {
    await service.validateAndFormat(NUMBER);
    writable = false;

    const result = await service.validateAndFormat(NUMBER, { revalidate: 'always' });
    expect(result.smsPossible).toBe(true);
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it('never reaches the provider for a number that fails the local parse', async () => {
    const result = await service.validateAndFormat('12345');
    expect(result.isValid).toBe(false);
    expect(lookup).not.toHaveBeenCalled();
    expect(canStore).not.toHaveBeenCalled();
  });

  it('does not call the provider at all when it is not Twilio', async () => {
    providerId = 'local';
    const result = await service.validateAndFormat(NUMBER, { revalidate: 'always' });
    expect(result.e164Format).toBe(E164);
    expect(lookup).not.toHaveBeenCalled();
  });

  it('does not stamp freshness on a failed lookup, and backs off instead of retrying', async () => {
    lookup.mockRejectedValueOnce(new Error('twilio unreachable'));
    const first = await service.validateAndFormat(NUMBER);
    expect(first.isValid).toBe(true); // local fallback
    expect(lookup).toHaveBeenCalledTimes(1);

    // The failure is recorded as a failure — never as a validation. It is the
    // hold itself, which is why it now survives a restart instead of living
    // in one process's memory.
    const held = store.get(CACHE_KEY)!;
    expect(held.outcome).toBe('failure');
    expect(held.response).toEqual({ error: 'twilio unreachable' });

    // Within that window the next reader gets the local answer and no second
    // attempt: an outage must not turn every read into a call.
    await service.validateAndFormat(NUMBER);
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it('treats a provider answer with no line-type intelligence as a failure, not a validation', async () => {
    // What the transport returns when it cannot reach Twilio: a locally
    // derived "valid" with no carrier data. Caching it would buy six months
    // of silence on the strength of a call that never happened.
    lookup.mockResolvedValueOnce({ valid: true, formatted: E164 } as any);
    await service.validateAndFormat(NUMBER);
    expect(store.get(CACHE_KEY)?.outcome).toBe('failure');
  });

  it('backs off after paying for an answer it could not store', async () => {
    // The gate passed, then the connection turned read-only mid-lookup. The
    // money is already spent; the next call must not spend it again.
    writeThrows = true;
    await service.validateAndFormat(NUMBER);
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(store.has(CACHE_KEY)).toBe(false);

    writeThrows = false;
    await service.validateAndFormat(NUMBER);
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it('reads settings once for a run of normalizations rather than once each', async () => {
    // Opt-in reads normalize per row, so a settings read per call would put a
    // database round trip inside every bulk loop.
    for (let i = 0; i < 10; i++) {
      await service.validateAndFormat(NUMBER, { revalidate: 'never' });
    }
    // One read of each vendor's settings for the whole run, not ten.
    expect(getPluginConfigs).toHaveBeenCalledTimes(2);
  });

  it('reads local and Twilio settings even when local is selected', async () => {
    providerId = 'local';
    providerSettings.local = {
      phoneValidation: { defaultCountry: 'GB', strictValidation: false },
    };
    providerSettings.twilio = {
      phoneValidation: {
        revalidateAfterDays: 7,
        useLocalOnTwilioFailure: false,
        logValidationAttempts: false,
      },
    };

    await expect(getPhoneValidationSettings()).resolves.toMatchObject({
      defaultCountry: 'GB',
      strictValidation: false,
      revalidateAfterDays: 7,
      useLocalOnTwilioFailure: false,
      logValidationAttempts: false,
    });
    expect(getPluginConfigs).toHaveBeenCalledWith('wc-vendors', 'sms-local');
    expect(getPluginConfigs).toHaveBeenCalledWith('wc-vendors', 'twilio');
  });

  it('does not cache a number the provider rejects', async () => {
    lookup.mockResolvedValueOnce({
      valid: false,
      formatted: E164,
      error: 'The requested resource was not found',
      smsPossible: false,
      voicePossible: false,
    } as any);

    const result = await service.validateAndFormat(NUMBER);
    expect(result.isValid).toBe(false);
    expect(store.has(E164)).toBe(false);
  });
});
