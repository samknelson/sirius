/**
 * 2026 DP rate sync — proves the seed corrects existing rows in place
 * (imputed-income amounts → member charges, provisional family placeholders
 * → confirmed no-charge) and that rerunning neither duplicates nor churns.
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  DP_RATES_2026,
  DP_RATES_2026_EFFECTIVE_YMD,
  syncDpRates2026,
  type DpRateSyncStorage,
} from "../../server/modules/sitespecific/bao/dp-rates-2026";

interface Row {
  id: string;
  benefitId: string;
  tierTransition: string;
  rate: string;
  effectiveYmd: string;
  provisional: boolean;
}

let rows: Row[];
let writes: { creates: number; updates: number };
let nextId: number;

const BENEFITS = [
  { id: "b-kaiser", name: "Kaiser" },
  { id: "b-hn", name: "Health Net " }, // trailing space: matched by trimmed name
  { id: "b-mlk", name: "MLK" },
  { id: "b-dental", name: "Dental" },
];

const fakeStorage: DpRateSyncStorage = {
  trustBenefits: { getAllTrustBenefits: async () => BENEFITS },
  baoDpRates: {
    list: async ({ benefitId }) => rows.filter((r) => !benefitId || r.benefitId === benefitId),
    create: async (entry) => {
      writes.creates++;
      const row = { id: `r${nextId++}`, ...entry };
      rows.push(row);
      return row;
    },
    update: async (id, record) => {
      writes.updates++;
      const row = rows.find((r) => r.id === id)!;
      Object.assign(row, record);
      return row;
    },
  },
};

beforeEach(() => {
  rows = [];
  writes = { creates: 0, updates: 0 };
  nextId = 1;
});

describe("syncDpRates2026", () => {
  it("creates 12 rows on an empty table and is a no-op on rerun", async () => {
    const first = await syncDpRates2026(fakeStorage);
    expect(first).toMatchObject({ created: 12, updated: 0, unchanged: 0 });
    expect(rows).toHaveLength(12);
    expect(rows.every((r) => r.effectiveYmd === DP_RATES_2026_EFFECTIVE_YMD)).toBe(true);

    const second = await syncDpRates2026(fakeStorage);
    expect(second).toMatchObject({ created: 0, updated: 0, unchanged: 12, changes: [] });
    expect(rows).toHaveLength(12);
    expect(writes).toEqual({ creates: 12, updates: 0 });
  });

  it("corrects the previously seeded imputed-income amounts and provisional family placeholders in place", async () => {
    // Shape of the earlier (wrong) seed.
    const legacy: Record<string, Record<string, [string, boolean]>> = {
      "b-kaiser": {
        single_to_2party: ["843.74", false],
        "2party_to_family": ["698.17", false],
        single_to_family: ["1541.91", false],
        family_to_family_dp: ["0.00", true],
      },
      "b-hn": {
        single_to_2party: ["607.55", false],
        "2party_to_family": ["430.08", false],
        single_to_family: ["1037.63", false],
        family_to_family_dp: ["0.00", true],
      },
      "b-mlk": {
        single_to_2party: ["177.52", false],
        "2party_to_family": ["144.96", false],
        single_to_family: ["322.49", false],
        family_to_family_dp: ["0.00", true],
      },
    };
    for (const [benefitId, ts] of Object.entries(legacy)) {
      for (const [tierTransition, [rate, provisional]] of Object.entries(ts)) {
        rows.push({
          id: `legacy-${benefitId}-${tierTransition}`,
          benefitId,
          tierTransition,
          rate,
          effectiveYmd: "2026-01-01",
          provisional,
        });
      }
    }
    // An unrelated older row must be left alone.
    rows.push({
      id: "old-2025",
      benefitId: "b-kaiser",
      tierTransition: "single_to_2party",
      rate: "399.00",
      effectiveYmd: "2025-01-01",
      provisional: false,
    });

    const result = await syncDpRates2026(fakeStorage);
    expect(result).toMatchObject({ created: 0, updated: 12, unchanged: 0 });
    expect(rows).toHaveLength(13);

    const byKey = new Map(rows.map((r) => [`${r.benefitId}:${r.tierTransition}:${r.effectiveYmd}`, r]));
    expect(byKey.get("b-kaiser:single_to_2party:2026-01-01")).toMatchObject({
      id: "legacy-b-kaiser-single_to_2party",
      rate: "405.00",
      provisional: false,
    });
    expect(byKey.get("b-hn:single_to_family:2026-01-01")).toMatchObject({ rate: "498.06" });
    expect(byKey.get("b-mlk:2party_to_family:2026-01-01")).toMatchObject({ rate: "69.58" });
    for (const b of ["b-kaiser", "b-hn", "b-mlk"]) {
      expect(byKey.get(`${b}:family_to_family_dp:2026-01-01`)).toMatchObject({
        rate: "0.00",
        provisional: false,
      });
    }
    expect(byKey.get("b-kaiser:single_to_2party:2025-01-01")).toMatchObject({ rate: "399.00" });

    const again = await syncDpRates2026(fakeStorage);
    expect(again).toMatchObject({ created: 0, updated: 0, unchanged: 12 });
    expect(rows).toHaveLength(13);
  });

  it("treats numerically equal stored rates as unchanged (no churn on '405' vs '405.00')", async () => {
    rows.push({
      id: "x",
      benefitId: "b-kaiser",
      tierTransition: "single_to_2party",
      rate: "405",
      effectiveYmd: "2026-01-01",
      provisional: false,
    });
    const result = await syncDpRates2026(fakeStorage);
    expect(result.unchanged).toBe(1);
    expect(result.updated).toBe(0);
    expect(rows.find((r) => r.id === "x")!.rate).toBe("405");
  });

  it("aborts before writing when a plan benefit is missing", async () => {
    const missingStorage: DpRateSyncStorage = {
      ...fakeStorage,
      trustBenefits: { getAllTrustBenefits: async () => BENEFITS.filter((b) => b.name !== "MLK") },
    };
    await expect(syncDpRates2026(missingStorage)).rejects.toThrow(/MLK/);
    expect(rows).toHaveLength(0);
  });

  it("only the family → family rows are zero, and none are provisional", () => {
    for (const plan of Object.values(DP_RATES_2026)) {
      for (const [t, r] of Object.entries(plan)) {
        expect(r.provisional).toBe(false);
        if (t === "family_to_family_dp") expect(Number(r.rate)).toBe(0);
        else expect(Number(r.rate)).toBeGreaterThan(0);
      }
    }
  });
});
