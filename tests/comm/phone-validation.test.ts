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

const getProviderSettings = vi.fn(
  async (_category: string, provider: string) => providerSettings[provider],
);

vi.mock('../../server/services/service-registry', () => ({
  serviceRegistry: {
    resolve: async () => ({ id: providerId, validatePhone: lookup }),
    getProviderSettings: (category: string, provider: string) =>
      getProviderSettings(category, provider),
  },
}));

interface StoredEntry {
  validatedAt: Date | null;
  validationResponse: unknown;
}

const store = new Map<string, StoredEntry>();
let writable = true;
let writeThrows = false;
const canStore = vi.fn(async () => writable);

vi.mock('../../server/storage/phone-validation-cache', () => ({
  phoneValidationCache: {
    read: async (phoneNumber: string) => store.get(phoneNumber),
    write: async (phoneNumber: string, entry: { validationResponse: unknown }) => {
      if (writeThrows) throw new Error('cannot execute INSERT in a read-only transaction');
      store.set(phoneNumber, { validatedAt: new Date(), validationResponse: entry.validationResponse });
    },
    canStore: () => canStore(),
  },
}));

vi.mock('../../server/storage/transaction-context', () => ({
  runOutsideTransaction: <T>(fn: () => T) => fn(),
}));

const { PhoneValidationService, DEFAULT_REVALIDATE_AFTER_DAYS } = await import(
  '../../server/services/comm/validators/phone'
);

const NUMBER = '(617) 555-0142';
const E164 = '+16175550142';

let service: InstanceType<typeof PhoneValidationService>;

beforeEach(() => {
  lookup.mockClear();
  canStore.mockClear();
  getProviderSettings.mockClear();
  store.clear();
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

    const stale = store.get(E164)!;
    stale.validatedAt = new Date(
      Date.now() - (DEFAULT_REVALIDATE_AFTER_DAYS + 1) * 24 * 60 * 60 * 1000,
    );

    await service.validateAndFormat(NUMBER);
    expect(lookup).toHaveBeenCalledTimes(2);
  });

  it('honours a shortened revalidation age', async () => {
    providerSettings.twilio = { phoneValidation: { revalidateAfterDays: 1 } };
    await service.validateAndFormat(NUMBER);

    const stored = store.get(E164)!;
    stored.validatedAt = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);

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
    expect(store.has(E164)).toBe(false);
    expect(lookup).toHaveBeenCalledTimes(1);

    // Within the back-off window the next reader gets the local answer and no
    // second attempt: an outage must not turn every read into a call.
    await service.validateAndFormat(NUMBER);
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it('treats a provider answer with no line-type intelligence as a failure, not a validation', async () => {
    // What the transport returns when it cannot reach Twilio: a locally
    // derived "valid" with no carrier data. Caching it would buy six months
    // of silence on the strength of a call that never happened.
    lookup.mockResolvedValueOnce({ valid: true, formatted: E164 } as any);
    await service.validateAndFormat(NUMBER);
    expect(store.has(E164)).toBe(false);
  });

  it('backs off after paying for an answer it could not store', async () => {
    // The gate passed, then the connection turned read-only mid-lookup. The
    // money is already spent; the next call must not spend it again.
    writeThrows = true;
    await service.validateAndFormat(NUMBER);
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(store.has(E164)).toBe(false);

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
    // One read of each provider's settings for the whole run, not ten.
    expect(getProviderSettings).toHaveBeenCalledTimes(2);
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
