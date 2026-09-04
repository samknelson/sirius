/**
 * The two incoming-usage dashboard cards' content resolvers.
 *
 * The figures are not computed here — both resolvers ask the counter storage
 * for one usage window and hand its rows on, which is what keeps a card's two
 * columns describing the same calls (proven against the statement it issues in
 * `ws-stats-storage.test.ts`). What is under test here is the small amount
 * each resolver does on its own: which window it asks for, that it hands the
 * rows on in the order it was given them, and — for the by-client card — that
 * a caller is named rather than numbered, and that an id with no name still
 * renders instead of throwing.
 *
 * Gating is the dashboard framework's, enforced on the `/content` front door
 * for every widget alike, so it is not re-tested per plugin.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getTodayYmd } from '@shared/utils/date';

// The plugin files self-register on import. The registry pulls in the whole
// server storage/express stack, and none of it is what these resolvers do.
vi.mock('../../server/plugins/dashboard/registry', () => ({
  registerDashboardPlugin: () => {},
}));

const { wsUsageByPluginPlugin } = await import(
  '../../server/plugins/dashboard/plugins/ws-usage-byplugin'
);
const { wsUsageByClientPlugin } = await import(
  '../../server/plugins/dashboard/plugins/ws-usage-byclient'
);

const usage = vi.fn();
const getAllClients = vi.fn();

/** The only part of the content context these resolvers touch. */
function context() {
  return {
    storage: { wsStats: { usage }, wsClients: { getAll: getAllClients } },
  } as any;
}

/** Run a plugin's single content resolver. */
function resolve(plugin: { content?: unknown }) {
  return (plugin.content as (ctx: unknown) => Promise<any>)(context());
}

const WINDOW = {
  start: '2026-08-25',
  end: '2026-08-31',
  byPlugin: [
    { id: 'edls', today: 1, window: 9 },
    { id: 'roster', today: 2, window: 2 },
  ],
  byClient: [
    { id: 'client-b', today: 2, window: 7 },
    { id: 'client-a', today: 1, window: 4 },
  ],
};

beforeEach(() => {
  usage.mockReset().mockResolvedValue(WINDOW);
  getAllClients.mockReset().mockResolvedValue([]);
});

describe('by service', () => {
  it('asks for one window of seven days ending today', async () => {
    await resolve(wsUsageByPluginPlugin);

    expect(usage).toHaveBeenCalledTimes(1);
    expect(usage).toHaveBeenCalledWith({ end: getTodayYmd(), days: 7 });
  });

  it('hands the counted services on in the order it was given them', async () => {
    const content = await resolve(wsUsageByPluginPlugin);

    // Busiest first is the storage's answer; recomputing it here is how the
    // card and the stats page start disagreeing about the same traffic.
    expect(content.rows).toEqual([
      { id: 'edls', label: 'edls', today: 1, week: 9 },
      { id: 'roster', label: 'roster', today: 2, week: 2 },
    ]);
  });

  it('echoes the window the figures were counted over', async () => {
    const content = await resolve(wsUsageByPluginPlugin);

    // From the same read that produced the counts, so the card cannot label
    // its columns against a second, later clock.
    expect(content).toMatchObject({ start: '2026-08-25', end: '2026-08-31', windowDays: 7 });
  });
});

describe('by client', () => {
  it('names the callers', async () => {
    getAllClients.mockResolvedValue([
      { id: 'client-a', name: 'Partner A' },
      { id: 'client-b', name: 'Partner B' },
    ]);

    const content = await resolve(wsUsageByClientPlugin);

    expect(content.rows).toEqual([
      { id: 'client-b', label: 'Partner B', today: 2, week: 7 },
      { id: 'client-a', label: 'Partner A', today: 1, week: 4 },
    ]);
  });

  it('shows an id it cannot name rather than failing', async () => {
    getAllClients.mockResolvedValue([{ id: 'client-a', name: 'Partner A' }]);

    const content = await resolve(wsUsageByClientPlugin);

    // A usage card that throws because one caller has since been removed is
    // worse than one showing an id.
    expect(content.rows.map((row: { label: string }) => row.label)).toEqual([
      'client-b',
      'Partner A',
    ]);
  });

  it('keeps a caller that was busy earlier in the window but not today', async () => {
    usage.mockResolvedValue({
      ...WINDOW,
      byClient: [{ id: 'client-a', today: 0, window: 5 }],
    });

    const content = await resolve(wsUsageByClientPlugin);

    expect(content.rows).toEqual([{ id: 'client-a', label: 'client-a', today: 0, week: 5 }]);
  });

  it('asks for one window of seven days ending today', async () => {
    await resolve(wsUsageByClientPlugin);

    expect(usage).toHaveBeenCalledTimes(1);
    expect(usage).toHaveBeenCalledWith({ end: getTodayYmd(), days: 7 });
  });
});
