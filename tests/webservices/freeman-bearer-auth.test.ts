import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  validateSecret,
  recordUsage,
  getClient,
  isIpAllowed,
  logWsRequest,
  wcRequest,
  componentState,
} = vi.hoisted(() => ({
  validateSecret: vi.fn(),
  recordUsage: vi.fn(),
  getClient: vi.fn(),
  isIpAllowed: vi.fn(),
  logWsRequest: vi.fn(),
  wcRequest: vi.fn(),
  componentState: { enabled: true },
}));

vi.mock('../../server/storage', () => ({
  storage: {
    wsClientCredentials: { validateSecret, recordUsage },
    wsClients: { get: getClient },
    wsClientIpRules: { isIpAllowed },
  },
}));

vi.mock('../../server/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn() },
  logWsRequest,
}));

vi.mock('../../server/services/component-cache', () => ({
  isComponentEnabledSync: () => componentState.enabled,
}));

vi.mock('../../server/services/webclient/client', () => ({ wcRequest }));

import { createWebServiceAuthMiddleware } from '../../server/middleware/webservice-auth';

const CREDENTIAL = { id: 'credential-1', clientId: 'client-1' };
const CONFIG_ID = 'freeman-config-1';
const CLIENT = {
  id: 'client-1',
  name: 'Freeman client',
  status: 'active',
  ipAllowlistEnabled: false,
  data: { freemanBearerAuthorizationConfigId: CONFIG_ID },
};
const TOKEN = 'canary-bearer-value';

function request(headers: Record<string, string>) {
  return {
    headers,
    socket: { remoteAddress: '127.0.0.1' },
    method: 'GET',
    originalUrl: '/api/ws/example/read',
    path: '/example/read',
  } as any;
}

async function authenticate(headers: Record<string, string>) {
  const result: { status?: number; body?: unknown; next: boolean } = { next: false };
  const res = {
    locals: {},
    status(status: number) {
      result.status = status;
      return res;
    },
    json(body: unknown) {
      result.body = body;
      return res;
    },
  } as any;
  await createWebServiceAuthMiddleware()(
    request(headers),
    res,
    () => { result.next = true; },
  );
  return result;
}

const X_HEADERS = {
  'x-ws-client-key': 'client-key',
  'x-ws-client-secret': 'client-secret',
};

beforeEach(() => {
  vi.clearAllMocks();
  componentState.enabled = true;
  validateSecret.mockResolvedValue({ valid: true, credential: CREDENTIAL });
  getClient.mockResolvedValue(CLIENT);
  isIpAllowed.mockResolvedValue(true);
  recordUsage.mockResolvedValue(undefined);
  wcRequest.mockResolvedValue({
    source: 'network',
    outcome: 'success',
    fresh: true,
    value: { success: true, outcome: 'success', status: 200, response: {} },
  });
});

describe('Freeman bearer authentication for incoming web services', () => {
  it('runs only after client credentials and the IP allowlist pass', async () => {
    validateSecret.mockResolvedValueOnce({ valid: false });
    expect((await authenticate(X_HEADERS)).status).toBe(401);
    expect(wcRequest).not.toHaveBeenCalled();

    validateSecret.mockResolvedValueOnce({ valid: true, credential: CREDENTIAL });
    getClient.mockResolvedValueOnce({ ...CLIENT, ipAllowlistEnabled: true });
    isIpAllowed.mockResolvedValueOnce(false);
    expect((await authenticate(X_HEADERS)).status).toBe(401);
    expect(wcRequest).not.toHaveBeenCalled();
  });

  it('leaves unassociated and component-disabled clients unchanged', async () => {
    getClient.mockResolvedValueOnce({ ...CLIENT, data: {} });
    expect((await authenticate(X_HEADERS)).next).toBe(true);
    expect(wcRequest).not.toHaveBeenCalled();

    componentState.enabled = false;
    expect((await authenticate(X_HEADERS)).next).toBe(true);
    expect(wcRequest).not.toHaveBeenCalled();
    expect(recordUsage).toHaveBeenCalledTimes(2);
  });

  it('requires X-WS credentials instead of Basic credentials', async () => {
    const basic = Buffer.from('client-key:client-secret').toString('base64');
    const result = await authenticate({ authorization: `Basic ${basic}` });

    expect(result).toMatchObject({
      status: 401,
      body: { code: 'FREEMAN_CLIENT_HEADERS_REQUIRED' },
    });
    expect(wcRequest).not.toHaveBeenCalled();
    expect(recordUsage).not.toHaveBeenCalled();
  });

  it('requires a non-empty Bearer header', async () => {
    for (const authorization of [undefined, 'Basic abc', 'Bearer ', 'Bearer one two']) {
      const headers = {
        ...X_HEADERS,
        ...(authorization === undefined ? {} : { authorization }),
      };
      const result = await authenticate(headers);
      expect(result).toMatchObject({
        status: 401,
        body: { code: 'FREEMAN_BEARER_REQUIRED' },
      });
    }
    expect(wcRequest).not.toHaveBeenCalled();
    expect(recordUsage).not.toHaveBeenCalled();
  });

  it('authorizes only through the client-selected configuration', async () => {
    const result = await authenticate({
      ...X_HEADERS,
      authorization: `Bearer ${TOKEN}`,
    });

    expect(result.next).toBe(true);
    expect(wcRequest).toHaveBeenCalledWith({
      vendor: { configId: CONFIG_ID },
      operation: 'sitespecific.freeman.authorization.bearer',
      args: { bearerCredential: TOKEN },
    });
    expect(recordUsage).toHaveBeenCalledWith(CREDENTIAL.id);
  });

  it.each([
    [
      'no framework answer',
      { source: 'network', outcome: 'failure', fresh: false, error: 'failed' },
      'FREEMAN_AUTH_NO_ANSWER',
    ],
    [
      'network failure',
      { source: 'network', outcome: 'success', fresh: true, value: { success: false, outcome: 'network_error' } },
      'FREEMAN_AUTH_NETWORK_ERROR',
    ],
    [
      'invalid JSON',
      { source: 'network', outcome: 'success', fresh: true, value: { success: false, outcome: 'malformed_response', status: 200 } },
      'FREEMAN_AUTH_INVALID_JSON',
    ],
    [
      'non-200 response',
      { source: 'network', outcome: 'success', fresh: true, value: { success: false, outcome: 'http_error', status: 403, response: { unsafe: TOKEN } } },
      'FREEMAN_AUTH_HTTP_STATUS',
    ],
    [
      'non-200 success',
      { source: 'network', outcome: 'success', fresh: true, value: { success: true, outcome: 'success', status: 201, response: {} } },
      'FREEMAN_AUTH_HTTP_STATUS',
    ],
    [
      'HTTP 200 refusal',
      { source: 'network', outcome: 'success', fresh: true, value: { success: false, outcome: 'http_error', status: 200, response: {} } },
      'FREEMAN_AUTH_REFUSED',
    ],
  ])('fails closed for %s without stamping usage', async (_label, vendorResult, code) => {
    wcRequest.mockResolvedValueOnce(vendorResult);
    const result = await authenticate({
      ...X_HEADERS,
      authorization: `Bearer ${TOKEN}`,
    });

    expect(result).toMatchObject({ status: 401, body: { code } });
    expect(recordUsage).not.toHaveBeenCalled();
    expect(JSON.stringify(result.body)).not.toContain(TOKEN);
    expect(JSON.stringify(logWsRequest.mock.calls)).not.toContain(TOKEN);
  });

  it('turns configuration and framework refusals into a safe 401', async () => {
    wcRequest.mockRejectedValueOnce(new Error(`private URL and ${TOKEN}`));
    const result = await authenticate({
      ...X_HEADERS,
      authorization: `Bearer ${TOKEN}`,
    });

    expect(result).toMatchObject({
      status: 401,
      body: { code: 'FREEMAN_AUTH_CONFIGURATION_UNAVAILABLE' },
    });
    expect(JSON.stringify(result.body)).not.toContain(TOKEN);
    expect(JSON.stringify(logWsRequest.mock.calls)).not.toContain(TOKEN);
    expect(recordUsage).not.toHaveBeenCalled();
  });
});