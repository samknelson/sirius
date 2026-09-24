/**
 * The outgoing overview endpoint: what we are able to call.
 *
 * It reports the registry as it stands in the running process, and that is the
 * whole point — a hand-maintained list would keep naming a service whose module
 * this environment does not load, and stop naming one somebody added last week.
 * So the assertions here register behaviors and expect them back; nothing in
 * the endpoint may know a service by name.
 *
 * The windows are the other half. A window may be a settings read rather than a
 * constant, and an operator who shortens one expects the screen to say so now,
 * not after a restart — so they are resolved per request, exactly as the
 * request wrapper resolves them.
 */
import type { AddressInfo } from 'node:net';
import http from 'node:http';

import express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/** Swapped per test; the endpoint must report whatever is registered. */
let behaviors: any[] = [];

vi.mock('../../server/services/webclient', async () => {
  // The real duration resolver, so this proves the endpoint resolves windows
  // the way the wrapper does rather than proving a stub.
  const registry = await import('../../server/services/webclient/registry');
  return {
    listWcRequests: () => behaviors,
    resolveWcDuration: registry.resolveWcDuration,
  };
});

vi.mock('../../server/services/access-policy-evaluator', () => ({
  requireAccess: () => (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../../server/storage', () => ({
  storage: { wcCache: {}, wcStats: {} },
}));

const { registerWcCacheAdminRoutes } = await import('../../server/modules/system/wc-cache');

let baseUrl = '';
let server: http.Server;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  registerWcCacheAdminRoutes(app);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

beforeEach(() => {
  behaviors = [];
});

async function getRequests() {
  const response = await fetch(`${baseUrl}/api/admin/wc-requests`);
  return { status: response.status, body: await response.json() };
}

function behavior(overrides: Record<string, unknown> = {}) {
  return {
    service: 'twilio',
    requestType: 'lookup',
    operation: 'look up a phone number',
    cached: true,
    freshFor: 60_000,
    failureRememberedFor: 5_000,
    requestKey: (args: { phone: string }) => args.phone,
    ...overrides,
  };
}

describe('what the overview reports', () => {
  it('reports what is registered, in a stable order', async () => {
    behaviors = [
      behavior({ service: 'twilio', requestType: 'lookup' }),
      behavior({ service: 'lob', requestType: 'verify-address' }),
      behavior({ service: 'twilio', requestType: 'carrier' }),
    ];

    const { status, body } = await getRequests();

    expect(status).toBe(200);
    expect(body.map((r: any) => `${r.service}:${r.requestType}`)).toEqual([
      'lob:verify-address',
      'twilio:carrier',
      'twilio:lookup',
    ]);
  });

  it('says nothing at all when this environment registers nothing', async () => {
    const { body } = await getRequests();

    expect(body).toEqual([]);
  });

  it('never exposes the request key', async () => {
    behaviors = [behavior()];

    const { body } = await getRequests();

    // Not just absent from the object: absent from the payload, since a
    // function serialized by accident would arrive as something else entirely.
    expect(body[0]).not.toHaveProperty('requestKey');
    expect(JSON.stringify(body)).not.toContain('requestKey');
  });

  it('resolves a window every time it is asked, not once at registration', async () => {
    let configured = 60_000;
    behaviors = [behavior({ freshFor: () => configured })];

    const first = await getRequests();
    expect(first.body[0].freshForMs).toBe(60_000);

    configured = 120_000;
    const second = await getRequests();
    expect(second.body[0].freshForMs).toBe(120_000);
  });

  it('reports the storability requirement the wrapper would apply, not the blank', async () => {
    behaviors = [
      behavior({ requestType: 'cached-default', cached: true }),
      behavior({ requestType: 'uncached-default', cached: false }),
      behavior({ requestType: 'explicit', cached: true, needsWritableDatabase: false }),
    ];

    const { body } = await getRequests();
    const byType = Object.fromEntries(body.map((r: any) => [r.requestType, r]));

    // Unset means "same as cached" at the point the wrapper decides, so an
    // unset flag must not be reported as "no".
    expect(byType['cached-default'].needsWritableDatabase).toBe(true);
    expect(byType['uncached-default'].needsWritableDatabase).toBe(false);
    expect(byType.explicit.needsWritableDatabase).toBe(false);
  });

  it('reports an uncached request type as answering every time', async () => {
    behaviors = [behavior({ cached: false, freshFor: 0, failureRememberedFor: 0 })];

    const { body } = await getRequests();

    expect(body[0].cached).toBe(false);
    expect(body[0].freshForMs).toBe(0);
  });
});
