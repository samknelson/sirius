/**
 * The inbound usage endpoint: what range it reads, what it refuses, and how it
 * names the callers.
 *
 * The figures themselves are not gathered here — the endpoint asks the counter
 * for one report, precisely so that no two figures on the page can describe a
 * different set of calls. That the report is internally consistent is the
 * storage's guarantee, proven against the statements it issues in
 * `ws-stats-storage.test.ts`; what is under test here is that this endpoint
 * asks for it as one report, resolves one window for it, refuses a window it
 * cannot honestly answer, and does not quietly recompute any of it.
 */
import type { AddressInfo } from 'node:net';
import http from 'node:http';

import express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { addDaysYmd, getTodayYmd } from '@shared/utils/date';

const report = vi.fn();
const listDimensions = vi.fn();
const getAllClients = vi.fn();

vi.mock('../../server/storage', () => ({
  storage: {
    wsStats: { report, listDimensions },
    wsClients: { getAll: getAllClients },
  },
}));

vi.mock('../../server/storage/transaction-context', () => ({
  runInTransaction: (fn: () => unknown) => fn(),
}));

const { registerWebServiceAdminRoutes } = await import('../../server/modules/webservices/admin');

/** An empty report, for the tests that are not about the figures. */
function emptyReport(overrides: Record<string, unknown> = {}) {
  return {
    days: [],
    total: 0,
    byPlugin: [],
    byPluginOperation: [],
    byClient: [],
    byDimension: [],
    ...overrides,
  };
}

let baseUrl = '';
let server: http.Server;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  // The gate itself is not what this file is about; every route in the module
  // carries the same admin pair.
  registerWebServiceAdminRoutes(
    app,
    (_req, _res, next) => next(),
    () => (_req, _res, next) => next(),
  );
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
  report.mockReset().mockResolvedValue(emptyReport());
  listDimensions.mockReset().mockResolvedValue([]);
  getAllClients.mockReset().mockResolvedValue([]);
});

async function getStats(query = '') {
  const response = await fetch(`${baseUrl}/api/admin/ws-stats${query}`);
  return { status: response.status, body: await response.json() };
}

describe('the range', () => {
  it('reads the last thirty days when the caller names none', async () => {
    const today = getTodayYmd();
    const { status, body } = await getStats();

    expect(status).toBe(200);
    expect(body.end).toBe(today);
    // Thirty days INCLUDING today: an off-by-one here silently changes what
    // every unfiltered figure on the page means.
    expect(body.start).toBe(addDaysYmd(today, -29));
    expect(report).toHaveBeenCalledWith(
      expect.objectContaining({ start: body.start, end: body.end }),
    );
  });

  it('asks for every figure once, over one window', async () => {
    await getStats('?start=2026-08-01&end=2026-08-07&pluginId=ping-v1&clientId=c1&operation=ping');

    // One read, so there is no gap between two reads for anything to change
    // in — and one range object, so no figure can be counted over a window
    // its neighbour on the page was not.
    expect(report).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith({
      start: '2026-08-01',
      end: '2026-08-07',
      pluginId: 'ping-v1',
      clientId: 'c1',
      operation: 'ping',
    });
  });

  it('refuses a day that is not a day, and reads nothing', async () => {
    const { status } = await getStats('?start=last-tuesday');

    expect(status).toBe(400);
    expect(report).not.toHaveBeenCalled();
  });

  it('refuses a range that ends before it starts, and reads nothing', async () => {
    const { status, body } = await getStats('?start=2026-08-31&end=2026-08-01');

    expect(status).toBe(400);
    expect(body.message).toMatch(/starts after it ends/i);
    expect(report).not.toHaveBeenCalled();
  });

  it('offers the filters every combination the counter has ever recorded', async () => {
    // Deliberately a retired operation: the catalogue comes from the counts,
    // not the plugin registry, so its calls stay accountable. It says which
    // combinations exist rather than how many calls they made, so it is the
    // one read that does not have to agree with the figures.
    listDimensions.mockResolvedValue([
      { pluginId: 'ping-v1', clientId: 'c1', operation: 'retired-op' },
    ]);
    getAllClients.mockResolvedValue([{ id: 'c1', name: 'Acme' }]);

    const { body } = await getStats();

    expect(body.dimensions).toEqual([
      { pluginId: 'ping-v1', clientId: 'c1', operation: 'retired-op', clientName: 'Acme' },
    ]);
  });
});

describe('the answer', () => {
  it('passes the counter figures through rather than recomputing them', async () => {
    report.mockResolvedValue(
      emptyReport({
        days: [
          { ymd: '2026-08-01', calls: 3 },
          { ymd: '2026-08-03', calls: 4 },
        ],
        total: 7,
        byPlugin: [{ pluginId: 'ping-v1', calls: 7 }],
      }),
    );

    const { body } = await getStats('?start=2026-08-01&end=2026-08-07');

    expect(body.days).toHaveLength(2);
    expect(body.byPlugin).toEqual([{ pluginId: 'ping-v1', calls: 7 }]);
    // Re-adding the days here would be a second, unsynchronised account of
    // the same traffic — and the one the page trusts.
    expect(body.total).toBe(7);
  });

  it('names the clients rather than numbering them', async () => {
    report.mockResolvedValue(emptyReport({ byClient: [{ clientId: 'c1', calls: 9 }], total: 9 }));
    getAllClients.mockResolvedValue([{ id: 'c1', name: 'Acme' }]);

    const { body } = await getStats();

    expect(body.byClient).toEqual([{ clientId: 'c1', calls: 9, clientName: 'Acme' }]);
  });

  it('shows an id rather than failing when a client cannot be named', async () => {
    // Counts are removed with the client they belong to, so this should not
    // arise; a usage screen that throws is still worse than one showing an id.
    report.mockResolvedValue(emptyReport({ byClient: [{ clientId: 'ghost', calls: 2 }], total: 2 }));
    getAllClients.mockResolvedValue([]);

    const { status, body } = await getStats();

    expect(status).toBe(200);
    expect(body.byClient).toEqual([{ clientId: 'ghost', calls: 2, clientName: 'ghost' }]);
  });

  it('reports a failed read as a failure instead of an empty week', async () => {
    report.mockRejectedValue(new Error('the counter is unavailable'));

    const { status } = await getStats();

    expect(status).toBe(500);
  });
});
