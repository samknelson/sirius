import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getClient: vi.fn(),
}));

vi.mock("../../server/storage/transaction-context", () => ({
  getClient: mocks.getClient,
  onAfterCommit: vi.fn(),
  runInTransaction: vi.fn(),
}));

vi.mock("../../server/storage/utils", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../server/storage/utils")>();
  return { ...original, tableExists: vi.fn().mockResolvedValue(true) };
});

// These modules otherwise pull the fully constructed storage singleton into
// this focused storage test through initialization-time dependencies.
vi.mock("../../server/services/event-bus", () => ({
  eventBus: { emit: vi.fn() },
  EventType: {},
}));
vi.mock("../../server/services/component-cache", () => ({
  isComponentEnabledSync: vi.fn(() => false),
}));

import { createWorkerTrustElectionsStorage } from "../../server/storage/trust/elections";
import { createTrustWmbStorage } from "../../server/storage/trust/wmb";
import { createWorkerStorage } from "../../server/storage/workers";
import { createBaoDpRatesStorage } from "../../server/storage/sitespecific/bao/dp-rates";

function queryChain(
  rows: unknown[],
  terminal: "where" | "orderBy",
): Record<string, ReturnType<typeof vi.fn>> {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  chain.from = vi.fn(() => chain);
  chain.leftJoin = vi.fn(() => chain);
  chain.where = terminal === "where"
    ? vi.fn(() => Promise.resolve(rows))
    : vi.fn(() => chain);
  chain.orderBy = vi.fn(() => Promise.resolve(rows));
  return chain;
}

describe("BAO DP report bulk storage inputs", () => {
  beforeEach(() => {
    mocks.getClient.mockReset();
  });

  it.each([
    { size: 8, expectedReads: 1 },
    { size: 1_002, expectedReads: 3 },
  ])(
    "uses bounded bulk reads, not per-worker SQL, for $size workers",
    async ({ size, expectedReads }) => {
      const ids = Array.from({ length: size }, (_, index) => `worker-${index}`);

      const electionSelect = vi.fn(() => queryChain([], "orderBy"));
      mocks.getClient.mockReturnValue({ select: electionSelect });
      await createWorkerTrustElectionsStorage().getActiveByWorkersAsOf(
        [...ids, ids[0]],
        "2026-03-15",
      );
      expect(electionSelect).toHaveBeenCalledTimes(expectedReads);

      const presenceSelect = vi.fn(() => queryChain([], "where"));
      mocks.getClient.mockReturnValue({ selectDistinct: presenceSelect });
      await createTrustWmbStorage().getWorkersBenefitPresenceForMonth(
        [...ids, ids[0]],
        2026,
        3,
      );
      expect(presenceSelect).toHaveBeenCalledTimes(expectedReads);

      const nameSelect = vi.fn(() => queryChain([], "where"));
      mocks.getClient.mockReturnValue({ select: nameSelect });
      const names = await createWorkerStorage({} as never).getWorkerDisplayNames([
        ...ids,
        ids[0],
      ]);
      expect(nameSelect).toHaveBeenCalledTimes(expectedReads);
      expect(names.size).toBe(size);
    },
  );

  it("returns no-query empty results from every ID-based bulk input", async () => {
    const elections = await createWorkerTrustElectionsStorage()
      .getActiveByWorkersAsOf([], "2026-03-15");
    const presence = await createTrustWmbStorage()
      .getWorkersBenefitPresenceForMonth([], 2026, 3);
    const names = await createWorkerStorage({} as never).getWorkerDisplayNames([]);

    expect(elections).toEqual([]);
    expect(presence).toEqual([]);
    expect(names.size).toBe(0);
    expect(mocks.getClient).not.toHaveBeenCalled();
  });

  it("keeps the latest active-as-of election per worker in start-descending order", async () => {
    const older = {
      id: "e-older",
      workerId: "worker-a",
      startYmd: "2026-01-01",
    };
    const latest = {
      id: "e-latest",
      workerId: "worker-a",
      startYmd: "2026-03-01",
    };
    const other = {
      id: "e-other",
      workerId: "worker-b",
      startYmd: "2026-02-01",
    };
    const select = vi.fn(() =>
      queryChain([latest, other, older], "orderBy"),
    );
    mocks.getClient.mockReturnValue({ select });

    const rows = await createWorkerTrustElectionsStorage()
      .getActiveByWorkersAsOf(["worker-a", "worker-b"], "2026-03-15");

    expect(rows.map((row) => row.id)).toEqual(["e-latest", "e-other"]);
  });

  it("matches single-worker display-name composition and fallback behavior", async () => {
    const dbRows = [
      {
        id: "parts",
        given: "Ada",
        family: "Lovelace",
        displayName: "Ignored Display",
      },
      {
        id: "display",
        given: null,
        family: null,
        displayName: "Display Only",
      },
    ];
    const select = vi.fn(() => queryChain(dbRows, "where"));
    mocks.getClient.mockReturnValue({ select });

    const names = await createWorkerStorage({} as never).getWorkerDisplayNames([
      "parts",
      "display",
      "missing",
      "missing",
    ]);

    expect(Object.fromEntries(names)).toEqual({
      parts: "Ada Lovelace",
      display: "Display Only",
      missing: "missing",
    });
  });

  it("requests one SQL latest-rate selection for all benefit/transition pairs", async () => {
    const effectiveRows = [
      {
        id: "rate-1",
        benefitId: "benefit-1",
        tierTransition: "single_to_2party",
        effectiveYmd: "2026-01-01",
        rate: "25.00",
        provisional: false,
        data: null,
      },
    ];
    const orderBy = vi.fn(() => Promise.resolve(effectiveRows));
    const where = vi.fn(() => ({ orderBy }));
    const from = vi.fn(() => ({ where }));
    const selectDistinctOn = vi.fn(() => ({ from }));
    mocks.getClient.mockReturnValue({ selectDistinctOn });

    const rows = await createBaoDpRatesStorage()
      .getEffectiveRatesForMonth("2026-03-01");

    expect(selectDistinctOn).toHaveBeenCalledTimes(1);
    expect(where).toHaveBeenCalledTimes(1);
    expect(orderBy).toHaveBeenCalledTimes(1);
    expect(rows).toEqual(effectiveRows);
  });
});