/**
 * What the dispatcher counts, and what it refuses to count.
 *
 * The counter's whole value is that a number means one thing: a call reached a
 * service and we did its work. Every refusal above the handler must count
 * nothing — otherwise "usage" quietly includes people probing our URL space
 * and partners whose credentials expired, and nobody can tell the difference
 * later.
 *
 * So these drive the real dispatcher over real HTTP rather than calling the
 * counting helper directly: the question is which requests reach the handler,
 * and only the assembled router answers that.
 *
 * Counting happens after the response is gone, so every assertion that a call
 * WAS counted waits for it, and every assertion that it was NOT gives it the
 * same chance to arrive before concluding it never will.
 */
import type { AddressInfo } from 'node:net';
import http from 'node:http';

import express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTodayYmd } from '@shared/utils/date';

const validateSecret = vi.fn();
const recordUsage = vi.fn();
const getWsClient = vi.fn();
const isIpAllowed = vi.fn();
const grantHas = vi.fn();
const configGet = vi.fn();
const configGetByKind = vi.fn();
const recordCall = vi.fn();

vi.mock('../../server/storage', () => ({
  storage: {
    wsClientCredentials: { validateSecret, recordUsage },
    wsClients: { get: getWsClient },
    wsClientIpRules: { isIpAllowed },
    wsClientGrants: { has: grantHas },
    pluginConfigs: { get: configGet, getByKind: configGetByKind },
    wsStats: { recordCall },
  },
}));

/**
 * Counting must not join the caller's transaction — a failed upsert would
 * abort it, and a rollback would erase the record of a call that happened.
 * Stubbed to run the callback so the test can assert it was used at all.
 */
const runOutsideTransaction = vi.fn((fn: () => unknown) => fn());
vi.mock('../../server/storage/transaction-context', () => ({
  runOutsideTransaction: (fn: () => unknown) => runOutsideTransaction(fn),
}));

const loggerError = vi.fn();
vi.mock('../../server/logger', () => ({
  logger: { error: loggerError, warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
  logWsRequest: vi.fn(),
}));

const componentEnabled = vi.fn(async () => true);
vi.mock('../../server/plugins/_core', () => ({
  isPluginComponentEnabledAsync: (...args: unknown[]) => componentEnabled(...(args as [])),
}));

/** Swapped per test; the default serves a normal response. */
let handlerImpl: (args: any) => Promise<void> = async ({ res }) => {
  res.status(200).json({ served: true });
};

const PLUGIN = {
  id: 'ping-v1',
  operations: [
    { name: 'ping', methods: ['GET', 'POST'], handler: (args: any) => handlerImpl(args) },
  ],
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
const { installWebServiceMaintenanceGate } = await import(
  '../../server/modules/webservices/maintenance'
);
const { setMaintenanceActive } = await import('../../server/services/maintenance-flag');

const CONFIG = {
  id: 'config-1',
  pluginKind: 'web-service',
  pluginId: 'ping-v1',
  enabled: true,
  data: { alias: 'ping' },
};

const CREDENTIALS = { 'x-ws-client-key': 'key', 'x-ws-client-secret': 'secret' };

let server: http.Server;
let origin: string;

beforeAll(async () => {
  const app = express();
  installWebServiceMaintenanceGate(app);
  app.use(express.json());
  registerWebServiceDispatcher(app);

  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  origin = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  setMaintenanceActive(false);
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

beforeEach(() => {
  vi.clearAllMocks();
  setMaintenanceActive(false);
  handlerImpl = async ({ res }) => {
    res.status(200).json({ served: true });
  };

  validateSecret.mockResolvedValue({
    valid: true,
    credential: { id: 'cred-1', clientId: 'client-1' },
  });
  recordUsage.mockResolvedValue(undefined);
  getWsClient.mockResolvedValue({
    id: 'client-1',
    name: 'Partner',
    status: 'active',
    ipAllowlistEnabled: false,
  });
  isIpAllowed.mockResolvedValue(true);
  grantHas.mockResolvedValue(true);
  configGet.mockResolvedValue(CONFIG);
  configGetByKind.mockResolvedValue([CONFIG]);
  componentEnabled.mockResolvedValue(true);
  recordCall.mockResolvedValue(undefined);
});

async function call(path: string, init: RequestInit = {}) {
  const response = await fetch(`${origin}${WEB_SERVICE_BASE_PATH}${path}`, {
    headers: CREDENTIALS,
    ...init,
  });
  const body = await response.json().catch(() => null);
  return { status: response.status, body };
}

/** Wait for the after-response count to land. */
const countLands = () => vi.waitFor(() => expect(recordCall).toHaveBeenCalledTimes(1));

/**
 * Give a count the same chance to arrive as a real one gets, then insist none
 * did. Without the wait this passes for the wrong reason: the count is written
 * after the response, so it is never there the instant `fetch` resolves.
 */
async function noCountLands() {
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(recordCall).not.toHaveBeenCalled();
}

describe('a served call is counted once, against its four dimensions', () => {
  it('counts a handled call', async () => {
    const result = await call('/ping/ping');
    expect(result.status).toBe(200);

    await countLands();
    expect(recordCall).toHaveBeenCalledWith('ping-v1', 'client-1', 'ping', getTodayYmd());
  });

  it('counts the plugin, not the configuration that addressed it', async () => {
    // Several configurations can share one plugin; the plugin id is the
    // stable, portable identity of "which service".
    await call('/config-1/ping');

    await countLands();
    expect(recordCall.mock.calls[0][0]).toBe('ping-v1');
    expect(recordCall.mock.calls[0]).not.toContain('config-1');
  });

  it('counts a call whose handler threw', async () => {
    handlerImpl = async () => {
      throw new Error('the service broke');
    };

    const result = await call('/ping/ping');
    expect(result.status).toBe(500);

    // The call reached the service and we did its work; how that went is the
    // request log's business.
    await countLands();
  });

  it('counts a call the caller hung up on', async () => {
    // A long export a partner abandons halfway is still work we did. The
    // count hangs off 'close' rather than 'finish' precisely for this.
    handlerImpl = async ({ res }) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.write('{"partial":');
      await new Promise((resolve) => res.on('close', resolve));
    };

    const controller = new AbortController();
    const response = await fetch(`${origin}${WEB_SERVICE_BASE_PATH}/ping/ping`, {
      headers: CREDENTIALS,
      signal: controller.signal,
    });
    expect(response.status).toBe(200);

    // Headers arrived, the body never will: hang up mid-response.
    controller.abort();
    await expect(response.text()).rejects.toThrow();

    await countLands();
  });

  it('counts once, not once per listener', async () => {
    await call('/ping/ping');
    await countLands();
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(recordCall).toHaveBeenCalledTimes(1);
  });

  it('counts outside the caller transaction', async () => {
    await call('/ping/ping');
    await countLands();

    expect(runOutsideTransaction).toHaveBeenCalled();
  });
});

describe('a refused call is counted not at all', () => {
  it('counts nothing when the site is in maintenance', async () => {
    setMaintenanceActive(true);

    const result = await call('/ping/ping');
    expect(result.status).toBe(503);
    await noCountLands();
  });

  it('counts nothing without credentials', async () => {
    const response = await fetch(`${origin}${WEB_SERVICE_BASE_PATH}/ping/ping`);
    expect(response.status).toBe(401);
    await noCountLands();
  });

  it('counts nothing for a credential that does not validate', async () => {
    validateSecret.mockResolvedValue({ valid: false });

    const result = await call('/ping/ping');
    expect(result.status).toBe(401);
    await noCountLands();
  });

  it('counts nothing for an address that resolves to nothing', async () => {
    configGet.mockResolvedValue(undefined);
    configGetByKind.mockResolvedValue([]);

    const result = await call('/nope/ping');
    expect(result.status).toBe(404);
    await noCountLands();
  });

  it('counts nothing for an ambiguous alias', async () => {
    configGet.mockResolvedValue(undefined);
    configGetByKind.mockResolvedValue([
      { ...CONFIG, id: 'config-1' },
      { ...CONFIG, id: 'config-2' },
    ]);

    const result = await call('/ping/ping');
    expect(result.status).toBe(404);
    await noCountLands();
  });

  it('counts nothing when the client holds no grant', async () => {
    grantHas.mockResolvedValue(false);

    const result = await call('/ping/ping');
    expect(result.status).toBe(404);
    await noCountLands();
  });

  it('counts nothing when the configuration is disabled', async () => {
    configGet.mockResolvedValue({ ...CONFIG, enabled: false });

    const result = await call('/ping/ping');
    expect(result.status).toBe(404);
    await noCountLands();
  });

  it('counts nothing when the plugin is not registered', async () => {
    configGet.mockResolvedValue({ ...CONFIG, pluginId: 'retired-v0' });

    const result = await call('/ping/ping');
    expect(result.status).toBe(404);
    await noCountLands();
  });

  it('counts nothing when the plugin component is off', async () => {
    componentEnabled.mockResolvedValue(false);

    const result = await call('/ping/ping');
    expect(result.status).toBe(404);
    await noCountLands();
  });

  it('counts nothing for an operation the service does not declare', async () => {
    const result = await call('/ping/nope');
    expect(result.status).toBe(404);
    await noCountLands();
  });

  it('counts nothing for a verb the operation does not accept', async () => {
    const result = await call('/ping/ping', { method: 'DELETE' });
    expect(result.status).toBe(405);
    await noCountLands();
  });
});

describe('counting can fail without the caller knowing', () => {
  it('serves the call and logs, when the count cannot be written', async () => {
    recordCall.mockRejectedValue(new Error('ws_stats is unavailable'));

    const result = await call('/ping/ping');

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ served: true });
    await vi.waitFor(() => expect(loggerError).toHaveBeenCalled());
  });
});
