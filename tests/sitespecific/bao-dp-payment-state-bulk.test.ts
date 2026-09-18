import { beforeEach, describe, expect, it } from "vitest";

import { storage } from "../../server/storage/database";
import {
  computeDpPaymentState,
  computeDpPaymentStates,
} from "../../server/modules/sitespecific/bao/dp-payment-state";

const ACCOUNT_ID = "account-dp";
const CONFIG_ID = "config-dp";

let elections: any[];
let entries: any[];
let balances: Record<string, string>;
let calls: Record<string, number>;

const charge = (
  electionId: string,
  month: string,
  amount: string,
  relationshipId = `relationship-${electionId}`,
) =>
  ({
    id: `${electionId}-${month}-${amount}`,
    referenceId: electionId,
    chargePluginConfigId: CONFIG_ID,
    chargePluginKey: `${electionId}-${month}-${amount}`,
    amount,
    data: {
      billingMonth: month,
      dpRelationshipId: relationshipId,
      dpWorkerId: `dp-${relationshipId}`,
    },
  }) as any;

(storage as any).pluginConfigs = {
  async search() {
    calls.config += 1;
    return [
      {
        config: {
          id: CONFIG_ID,
          pluginId: "sitespecific-bao-dp",
          name: "DP",
          enabled: true,
          data: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        subsidiary: {
          scope: "global",
          employerId: null,
          account: ACCOUNT_ID,
        },
      },
    ];
  },
};

(storage as any).workerTrustElections = {
  async listByWorker(workerId: string) {
    calls.singleElections += 1;
    return elections.filter((e) => e.workerId === workerId);
  },
  async search(params: { workerIds: string[]; sort: string }) {
    calls.bulkElections += 1;
    expect(params.sort).toBe("startDesc");
    return elections.filter((e) => params.workerIds.includes(e.workerId));
  },
};

(storage as any).ledger = {
  entries: {
    async getBalancesByEntityAndAccount(
      _entityType: string,
      workerIds: string[],
    ) {
      calls.balances += 1;
      return workerIds
        .filter((workerId) => balances[workerId] !== undefined)
        .map((entityId) => ({
          entityId,
          accountId: ACCOUNT_ID,
          total: balances[entityId],
        }));
    },
    async getByReferenceAndConfig(referenceId: string) {
      calls.singleEntries += 1;
      return entries.filter((entry) => entry.referenceId === referenceId);
    },
    async getByReferencesAndConfig(referenceIds: string[]) {
      calls.bulkEntries += 1;
      return entries.filter((entry) => referenceIds.includes(entry.referenceId));
    },
  },
};

beforeEach(() => {
  calls = {
    config: 0,
    balances: 0,
    singleElections: 0,
    bulkElections: 0,
    singleEntries: 0,
    bulkEntries: 0,
  };
  balances = {};
  elections = [];
  entries = [];
});

describe("bulk DP payment state", () => {
  it("does no storage work for an empty input", async () => {
    await expect(computeDpPaymentStates([])).resolves.toEqual(new Map());
    expect(Object.values(calls).reduce((sum, count) => sum + count, 0)).toBe(0);
  });

  it("matches the single FIFO calculation, including historical months", async () => {
    elections = [
      { id: "new-election", workerId: "worker-1", startYmd: "2026-01-01" },
      { id: "other-election", workerId: "worker-2", startYmd: "2025-06-01" },
      { id: "old-election", workerId: "worker-1", startYmd: "2024-01-01" },
    ];
    entries = [
      charge("old-election", "2024-02", "40.00"),
      charge("new-election", "2026-03", "60.00"),
      charge("other-election", "2025-07", "25.00"),
    ];
    balances = { "worker-1": "30.00", "worker-2": "0.00" };

    const single = await computeDpPaymentState("worker-1");
    calls = Object.fromEntries(Object.keys(calls).map((key) => [key, 0]));
    const bulk = await computeDpPaymentStates(["worker-1", "worker-2"]);

    expect(bulk.get("worker-1")).toEqual(single);
    expect(bulk.get("worker-1")?.months.map((month) => month.month)).toEqual([
      "2024-02",
      "2026-03",
    ]);
    expect(bulk.get("worker-1")?.months.map((month) => month.status)).toEqual([
      "paid",
      "partial",
    ]);
    expect(bulk.get("worker-2")?.months[0].status).toBe("paid");
    expect(calls).toMatchObject({
      config: 1,
      balances: 1,
      bulkElections: 1,
      bulkEntries: 1,
      singleElections: 0,
      singleEntries: 0,
    });
  });

  it("uses constant bulk calls as worker count grows", async () => {
    const workerIds = Array.from({ length: 100 }, (_, index) => `worker-${index}`);
    elections = workerIds.map((workerId, index) => ({
      id: `election-${index}`,
      workerId,
      startYmd: "2020-01-01",
    }));
    entries = elections.map((election) =>
      charge(election.id, "2020-01", "10.00"),
    );
    balances = Object.fromEntries(workerIds.map((workerId) => [workerId, "10.00"]));

    const result = await computeDpPaymentStates(workerIds);

    expect(result).toHaveLength(100);
    expect(Array.from(result.values()).every((state) => state?.totalCharges === "10.00")).toBe(true);
    expect(calls).toMatchObject({
      config: 1,
      balances: 1,
      bulkElections: 1,
      bulkEntries: 1,
      singleElections: 0,
      singleEntries: 0,
    });
  });
});