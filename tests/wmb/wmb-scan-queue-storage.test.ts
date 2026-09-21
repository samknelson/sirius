import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getClient: vi.fn(),
}));

vi.mock("../../server/storage/transaction-context", () => ({
  getClient: mocks.getClient,
}));

import { trustWmbScanQueue, trustWmbScanStatus } from "../../shared/schema";
import { createWmbScanQueueStorage } from "../../server/storage/wmb-scan-queue";

interface EnqueueFixtureOptions {
  populationIds: string[];
  existingEntries?: Array<{ id: string; workerId: string }>;
  existingStatus?: boolean;
}

function enqueueFixture({
  populationIds,
  existingEntries = [],
  existingStatus = false,
}: EnqueueFixtureOptions) {
  const status = {
    id: "status-1",
    month: 3,
    year: 2026,
    scopeType: "all",
    scopeEmployerId: null,
    status: "queued",
  };
  const insertedQueueBatches: unknown[][] = [];
  const deletedQueueBatches: unknown[] = [];
  const statusSets: Array<Record<string, unknown>> = [];
  const statusInserts: Array<Record<string, unknown>> = [];

  const clientSelect = vi.fn(() => ({
    from: vi.fn(() => Promise.resolve(populationIds.map(id => ({ id })))),
  }));

  let transactionSelectCall = 0;
  const tx = {
    select: vi.fn(() => {
      transactionSelectCall++;
      if (transactionSelectCall === 1) {
        return {
          from: vi.fn(() => ({
            where: vi.fn(() => ({
              orderBy: vi.fn(() => ({
                limit: vi.fn(() => Promise.resolve(existingStatus ? [status] : [])),
              })),
            })),
          })),
        };
      }
      return {
        from: vi.fn(() => ({
          where: vi.fn(() => Promise.resolve(existingEntries)),
        })),
      };
    }),
    insert: vi.fn((table: unknown) => ({
      values: vi.fn((values: unknown) => {
        if (table === trustWmbScanStatus) {
          statusInserts.push(values as Record<string, unknown>);
          return { returning: vi.fn(() => Promise.resolve([status])) };
        }
        insertedQueueBatches.push(values as unknown[]);
        return Promise.resolve();
      }),
    })),
    update: vi.fn((table: unknown) => ({
      set: vi.fn((values: Record<string, unknown>) => {
        if (table === trustWmbScanStatus) statusSets.push(values);
        return {
          where: vi.fn(() => existingStatus && statusSets.length === 1
            ? { returning: vi.fn(() => Promise.resolve([status])) }
            : Promise.resolve()),
        };
      }),
    })),
    delete: vi.fn(() => ({
      where: vi.fn((condition: unknown) => {
        deletedQueueBatches.push(condition);
        return Promise.resolve();
      }),
    })),
  };

  const client = {
    select: clientSelect,
    execute: vi.fn(() => Promise.resolve({
      rows: populationIds.map(id => ({ id })),
    })),
    transaction: vi.fn(async (callback: (transaction: typeof tx) => unknown) => callback(tx)),
  };

  return {
    client,
    insertedQueueBatches,
    deletedQueueBatches,
    statusSets,
    statusInserts,
  };
}

describe("WMB month scan queue bulk enqueue", () => {
  beforeEach(() => {
    mocks.getClient.mockReset();
  });

  it("enqueues a large worker population in bounded bulk inserts", async () => {
    const populationIds = Array.from({ length: 1_201 }, (_, index) => `worker-${index}`);
    const fixture = enqueueFixture({ populationIds });
    mocks.getClient.mockReturnValue(fixture.client);

    const result = await createWmbScanQueueStorage().enqueueMonth(3, 2026);

    expect(result).toEqual({ statusId: "status-1", queuedCount: 1_201 });
    expect(fixture.insertedQueueBatches.map(batch => batch.length)).toEqual([500, 500, 201]);
    expect(fixture.insertedQueueBatches.flat()).toHaveLength(1_201);
    expect(fixture.statusSets.at(-1)).toEqual({ totalQueued: 1_201 });
  });

  it("bounds deletion statements when a rerun population shrinks", async () => {
    const existingEntries = Array.from({ length: 1_201 }, (_, index) => ({
      id: `queue-${index}`,
      workerId: `former-worker-${index}`,
    }));
    const fixture = enqueueFixture({
      populationIds: [],
      existingEntries,
      existingStatus: true,
    });
    mocks.getClient.mockReturnValue(fixture.client);

    const result = await createWmbScanQueueStorage().enqueueMonth(3, 2026);

    expect(result).toEqual({ statusId: "status-1", queuedCount: 0 });
    expect(fixture.deletedQueueBatches).toHaveLength(3);
    expect(fixture.insertedQueueBatches).toHaveLength(0);
    expect(fixture.statusSets[0]).toMatchObject({
      status: "queued",
      totalQueued: 0,
      processedSuccess: 0,
      processedFailed: 0,
      benefitsStarted: 0,
      benefitsContinued: 0,
      benefitsTerminated: 0,
    });
    expect(fixture.statusSets.at(-1)).toEqual({ totalQueued: 0 });
  });

  it("preserves employer scope and trigger source across every bulk row", async () => {
    const populationIds = Array.from({ length: 1_001 }, (_, index) => `worker-${index}`);
    const fixture = enqueueFixture({ populationIds });
    mocks.getClient.mockReturnValue(fixture.client);

    const result = await createWmbScanQueueStorage().enqueueMonth(
      3,
      2026,
      { type: "employer", employerId: "employer-1" },
      "scheduled_sweep",
    );

    expect(result.queuedCount).toBe(1_001);
    expect(fixture.client.execute).toHaveBeenCalledTimes(1);
    expect(fixture.client.select).not.toHaveBeenCalled();
    expect(fixture.statusInserts).toEqual([{
      month: 3,
      year: 2026,
      status: "queued",
      scopeType: "employer",
      scopeEmployerId: "employer-1",
    }]);
    expect(fixture.insertedQueueBatches.map(batch => batch.length)).toEqual([500, 500, 1]);
    expect(fixture.insertedQueueBatches.flat()).toEqual(
      populationIds.map(workerId => ({
        statusId: "status-1",
        workerId,
        month: 3,
        year: 2026,
        status: "pending",
        triggerSource: "scheduled_sweep",
      })),
    );
  });
});