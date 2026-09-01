/**
 * Maintenance mode shuts the web service doors — first, and for everyone.
 *
 * The requirement is an ordering requirement, so these tests drive a real
 * Express app with the real dispatcher mounted rather than calling the gate
 * middleware directly: a gate that works perfectly but sits after
 * authentication would pass a unit test and fail in production. Authentication
 * writes (it stamps `last_used_at`), and every write fails against the
 * maintenance-mode read-only pool, so a caller would get an opaque 500 instead
 * of a retryable 503.
 *
 * Hence the assertions that nothing was *reached*: no credential validated, no
 * configuration read. Those are what prove the gate is in front rather than
 * merely present.
 *
 * Storage, the logger and the plugin registry are stubbed so the suite needs
 * no database — which also means a passing run proves the refusal path touches
 * neither.
 */
import type { AddressInfo } from 'node:net';
import http from 'node:http';

import express from 'express';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const validateSecret = vi.fn();
const recordUsage = vi.fn();
const getClient = vi.fn();
const isIpAllowed = vi.fn();
const grantHas = vi.fn();
const configGet = vi.fn();
const configGetByKind = vi.fn();

vi.mock('../../server/storage', () => ({
  storage: {
    wsClientCredentials: { validateSecret, recordUsage },
    wsClients: { get: getClient },
    wsClientIpRules: { isIpAllowed },
    wsClientGrants: { has: grantHas },
    pluginConfigs: { get: configGet, getByKind: configGetByKind },
  },
}));

vi.mock('../../server/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
  logWsRequest: vi.fn(),
}));

vi.mock('../../server/plugins/_core', () => ({
  isPluginComponentEnabledAsync: vi.fn(async () => true),
}));

const operationHandler = vi.fn(async ({ res }: any) => {
  res.status(200).json({ served: true });
});

const PLUGIN = {
  id: 'ping-v1',
  operations: [{ name: 'ping', methods: ['GET', 'POST'], handler: operationHandler }],
};

vi.mock('../../server/plugins/web-service', () => ({
  webServiceRegistry: {
    get: (id: string) => (id === 'ping-v1' ? PLUGIN : undefined),
    getMetadata: () => ({ id: 'ping-v1' }),
  },
  findWebServiceOperation: (plugin: any, name: string) =>
    plugin.operations.find((o: any) => o.name === name),
}));

const { registerWebServiceDispatcher, WEB_SERVICE_BASE_PATH } = await import(
  '../../server/modules/webservices'
);
const { setMaintenanceActive } = await import('../../server/services/maintenance-flag');
const {
  installWebServiceMaintenanceGate,
  WS_MAINTENANCE_CODE,
  WS_MAINTENANCE_RETRY_AFTER_SECONDS,
} = await import('../../server/modules/webservices/maintenance');

/** A configuration the dispatcher can resolve and dispatch. */
const CONFIG = {
  id: 'config-1',
  pluginKind: 'web-service',
  pluginId: 'ping-v1',
  enabled: true,
  data: { alias: 'ping' },
};

/** Headers for a credential that would authenticate successfully. */
const GOOD_CREDENTIALS = {
  'x-ws-client-key': 'key',
  'x-ws-client-secret': 'secret',
};

let server: http.Server;
let origin: string;

beforeAll(async () => {
  const app = express();
  // The real entry point's order: the gate, then the base middleware, then
  // (much later) the dispatcher. The body limit is tiny here only so an
  // oversized request is cheap to send; what it proves is that the parser
  // never gets to answer while maintenance is on.
  installWebServiceMaintenanceGate(app);
  app.use(express.json({ limit: '1kb' }));
  registerWebServiceDispatcher(app);

  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  origin = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

beforeEach(() => {
  vi.clearAllMocks();
  setMaintenanceActive(false);

  validateSecret.mockResolvedValue({ valid: true, credential: { id: 'cred-1', clientId: 'client-1' } });
  recordUsage.mockResolvedValue(undefined);
  getClient.mockResolvedValue({ id: 'client-1', name: 'Partner', status: 'active', ipAllowlistEnabled: false });
  isIpAllowed.mockResolvedValue(true);
  grantHas.mockResolvedValue(true);
  configGet.mockResolvedValue(CONFIG);
  configGetByKind.mockResolvedValue([CONFIG]);
});

afterEach(() => {
  setMaintenanceActive(false);
});

async function call(path: string, init: RequestInit = {}) {
  const response = await fetch(`${origin}${WEB_SERVICE_BASE_PATH}${path}`, init);
  const body = await response.json().catch(() => null);
  return { status: response.status, headers: response.headers, body };
}

describe('maintenance mode refuses incoming web service calls', () => {
  beforeEach(() => {
    setMaintenanceActive(true);
  });

  it('refuses an anonymous call without examining a credential', async () => {
    const result = await call('/ping/ping');

    expect(result.status).toBe(503);
    expect(result.body).toMatchObject({ code: WS_MAINTENANCE_CODE });
    expect(result.headers.get('retry-after')).toBe(String(WS_MAINTENANCE_RETRY_AFTER_SECONDS));
    expect(validateSecret).not.toHaveBeenCalled();
  });

  it('refuses a caller holding perfectly valid credentials, identically', async () => {
    const anonymous = await call('/ping/ping');
    const authenticated = await call('/ping/ping', { headers: GOOD_CREDENTIALS });

    expect(authenticated.status).toBe(503);
    expect(authenticated.body).toEqual(anonymous.body);
    // The whole point of gating ahead of authentication: the credential is
    // never validated, and the write that authentication performs on every
    // call is never attempted against the read-only pool.
    expect(validateSecret).not.toHaveBeenCalled();
    expect(recordUsage).not.toHaveBeenCalled();
  });

  it('touches no database at all while refusing', async () => {
    await call('/ping/ping', { headers: GOOD_CREDENTIALS });

    expect(configGet).not.toHaveBeenCalled();
    expect(configGetByKind).not.toHaveBeenCalled();
    expect(grantHas).not.toHaveBeenCalled();
    expect(operationHandler).not.toHaveBeenCalled();
  });

  it('refuses a write the same way it refuses a read', async () => {
    const result = await call('/ping/ping', {
      method: 'POST',
      headers: { ...GOOD_CREDENTIALS, 'content-type': 'application/json' },
      body: JSON.stringify({ hello: true }),
    });

    expect(result.status).toBe(503);
    expect(result.body).toMatchObject({ code: WS_MAINTENANCE_CODE });
  });

  it('refuses a malformed body instead of complaining about it', async () => {
    // The body parser answers 400 for unparseable JSON, and it runs before
    // every router in the app. Telling a caller their JSON is broken while the
    // site is down sends them debugging the wrong thing.
    const result = await call('/ping/ping', {
      method: 'POST',
      headers: { ...GOOD_CREDENTIALS, 'content-type': 'application/json' },
      body: '{"broken":',
    });

    expect(result.status).toBe(503);
    expect(result.body).toMatchObject({ code: WS_MAINTENANCE_CODE });
  });

  it('refuses an oversized body instead of rejecting it on size', async () => {
    const result = await call('/ping/ping', {
      method: 'POST',
      headers: { ...GOOD_CREDENTIALS, 'content-type': 'application/json' },
      body: JSON.stringify({ payload: 'x'.repeat(4096) }),
    });

    expect(result.status).toBe(503);
    expect(result.body).toMatchObject({ code: WS_MAINTENANCE_CODE });
  });

  it('refuses paths that name no service at all', async () => {
    // The mount's catch-all is behind the gate too, so a caller probing the
    // URL space gets the same refusal as one calling a real address.
    for (const path of ['/', '/nonsense', '/a/b/c/d']) {
      const result = await call(path);
      expect(result.status).toBe(503);
      expect(result.body).toMatchObject({ code: WS_MAINTENANCE_CODE });
    }
  });

  it('says something a machine can act on', async () => {
    const result = await call('/ping/ping');

    // "Retry later" must be distinguishable from "you may not call this" —
    // only one of the two is worth retrying, and the dispatcher's own
    // refusals are deliberately vague.
    expect(result.body.code).not.toBe('NOT_FOUND');
    expect(typeof result.body.message).toBe('string');
    expect(result.body.message.length).toBeGreaterThan(0);
  });
});

describe('an app cannot serve web services without the gate', () => {
  it('refuses to register a dispatcher on an ungated app', () => {
    // The gate is installed at the far end of the boot sequence from the
    // dispatcher, so nothing in the dispatcher's own code shows whether it is
    // there. Dropping or reordering the install must break the boot, not
    // quietly reopen the doors during a maintenance window.
    expect(() => registerWebServiceDispatcher(express())).toThrow(/maintenance gate/i);
  });
});

describe('normal dispatch is unaffected when maintenance is off', () => {
  it('still demands credentials', async () => {
    const result = await call('/ping/ping');

    expect(result.status).toBe(401);
    expect(result.body).toMatchObject({ code: 'MISSING_CREDENTIALS' });
  });

  it('dispatches an authenticated call to its operation', async () => {
    const result = await call('/ping/ping', { headers: GOOD_CREDENTIALS });

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ served: true });
    expect(recordUsage).toHaveBeenCalledWith('cred-1');
  });

  it('still refuses an address it cannot resolve, with its own vague code', async () => {
    configGet.mockResolvedValue(undefined);
    configGetByKind.mockResolvedValue([]);

    const result = await call('/nope/ping', { headers: GOOD_CREDENTIALS });

    expect(result.status).toBe(404);
    expect(result.body).toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('the credential usage stamp is bookkeeping, not a gate', () => {
  it('serves the call even when the stamp cannot be written', async () => {
    // Exactly what a read-only pool produces, but the stamp can fail for any
    // transient reason; either way a proven credential has already earned its
    // answer.
    recordUsage.mockRejectedValue(new Error('cannot execute UPDATE in a read-only transaction'));

    const result = await call('/ping/ping', { headers: GOOD_CREDENTIALS });

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ served: true });
    expect(operationHandler).toHaveBeenCalled();
  });
});
