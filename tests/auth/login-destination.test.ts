import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let destination: typeof import('../../client/src/lib/login-destination');
let values: Map<string, string>;

beforeEach(async () => {
  vi.resetModules();
  values = new Map();
  vi.stubGlobal('window', {
    sessionStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
      removeItem: (key: string) => { values.delete(key); },
    },
  });
  destination = await import('../../client/src/lib/login-destination');
});
afterEach(() => vi.unstubAllGlobals());

describe('safe page-only login destinations', () => {
  it.each(['/records/list', '/workers/123/contacts', '/dashboard', '/reports/monthly-total'])(
    'accepts %s', path => expect(destination.validateLoginDestination(path)).toBe(path),
  );
  it.each([
    '', '/', 'records/list', 'https://evil.invalid', '//evil.invalid', '/\\evil.invalid',
    '/records/list?token=secret', '/records/list#secret', '/a\nb', '/a\u0085b',
    '/a/../dashboard', '/a/./b', '/a//b', '/a/%2e%2e/b', '/%2f%2fevil.invalid',
    '/%5cevil.invalid', '/%252f%252fevil.invalid', '/%61pi/logout', '/%6cogin',
    '/a/%3fsecret', '/a/%23secret', '/a/%00', '/a/%zz', '/a/%',
    '/login', '/LOGIN/nested', '/api/logout', '/auth/callback', '/auth-error',
    '/logout', '/register', '/verify-worker', '/bootstrap', '/sign-in', '/callback',
  ])('rejects %j', path => expect(destination.validateLoginDestination(path)).toBeNull());

  it('builds the interrupted page URL without accepting page state', () => {
    expect(destination.captureLoginDestination('/records/list'))
      .toBe('/login?destination=%2Frecords%2Flist');
    expect(destination.buildLoginUrl('/records/list?credential=secret')).toBe('/login');
  });
});

describe('one per-tab return-location lifecycle', () => {
  it('lets an explicit destination replace an older saved page', () => {
    destination.captureLoginDestination('/workers');
    destination.applyLoginDestinationQuery('?destination=%2Frecords%2Flist');
    expect(destination.consumeLoginDestination()).toBe('/records/list');
    expect(destination.consumeLoginDestination()).toBe('/dashboard');
    expect(values.has('redirectAfterLogin')).toBe(false);
  });

  it.each(['', 'https%3A%2F%2Fevil.invalid', '%2Fapi%2Flogout', '%2Flogin'])(
    'does not resurrect older state after explicit invalid %j', value => {
      destination.captureLoginDestination('/workers');
      destination.applyLoginDestinationQuery(`?destination=${value}`);
      expect(destination.consumeLoginDestination()).toBe('/dashboard');
    },
  );

  it('rejects ambiguous duplicate parameters', () => {
    destination.captureLoginDestination('/workers');
    destination.applyLoginDestinationQuery('?destination=/records/list&destination=/workers');
    expect(destination.consumeLoginDestination()).toBe('/dashboard');
  });

  it('retains pending state across failed attempts and login without a parameter', () => {
    destination.applyLoginDestinationQuery('?destination=%2Frecords%2Flist');
    destination.applyLoginDestinationQuery('?error=failed');
    expect(destination.getLoginDestination()).toBe('/records/list');
    expect(destination.getLoginDestination()).toBe('/records/list');
  });

  it('survives refresh and same-tab provider roundtrips to root or dashboard', async () => {
    destination.applyLoginDestinationQuery('?destination=%2Frecords%2Flist');
    vi.resetModules(); // New document, same tab's storage.
    destination = await import('../../client/src/lib/login-destination');
    expect(destination.captureLoginDestination('/')).toBe('/login?destination=%2Frecords%2Flist');
    expect(destination.captureLoginDestination('/dashboard')).toBe('/login?destination=%2Frecords%2Flist');
    expect(destination.consumeLoginDestination()).toBe('/records/list');
  });

  it('validates legacy stored values before using them', () => {
    values.set('redirectAfterLogin', '//evil.invalid');
    expect(destination.consumeLoginDestination()).toBe('/dashboard');
  });

  it('clears the return location for intentional logout', () => {
    destination.captureLoginDestination('/records/list');
    destination.clearLoginDestination();
    expect(destination.consumeLoginDestination()).toBe('/dashboard');
  });

  it('works in the same document even when storage access throws', () => {
    vi.stubGlobal('window', {
      get sessionStorage() { throw new Error('storage denied'); },
    });
    expect(destination.getLoginDestination()).toBeNull();
    destination.applyLoginDestinationQuery('?destination=%2Frecords%2Flist');
    expect(destination.consumeLoginDestination()).toBe('/records/list');
    expect(destination.consumeLoginDestination()).toBe('/dashboard');
  });
});
