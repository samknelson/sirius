/**
 * BAO EE Contributions eligibility gate.
 *
 * This suite intentionally stubs only the storage boundary. The executor,
 * plugin registry, plugin validation, and trust-eligibility config adapter are
 * the real implementations. Exact SQL month aggregation is verified separately
 * against PostgreSQL with transaction-local fixtures, not emulated here.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { state, mockStorage } = vi.hoisted(() => {
  const state = {
    accountExists: true,
    eaWorkers: new Set<string>(["subscriber-1"]),
    outstanding: {
      count: 2,
      months: [
        { year: 2025, month: 12 },
        { year: 2026, month: 1 },
      ],
    },
  };

  const mockStorage = {
    ledger: {
      accounts: {
        get: vi.fn(),
      },
      ea: {
        getByEntityAndAccount: vi.fn(),
      },
      entries: {
        getOutstandingStatementMonths: vi.fn(),
      },
    },
    workers: {
      getWorker: vi.fn(),
    },
    contacts: {
      getContact: vi.fn(),
    },
    employers: {
      getEmployer: vi.fn(),
    },
    workerTrustElections: {
      getActiveByWorkerAsOf: vi.fn(),
    },
    workerRelations: {
      findActiveBetween: vi.fn(),
    },
  };

  return { state, mockStorage };
});

vi.mock("../../server/storage/database", () => ({ storage: mockStorage }));
vi.mock("../../server/modules/components", () => ({
  getEnabledComponentIds: vi.fn(async () => ["sitespecific.bao"]),
}));

import { defaultHydrate, getPluginConfigAdapter } from "../../server/plugins/_core/config-adapter";
import {
  evaluateEligibilityRules,
  pluginConfigToEligibilityRule,
} from "../../server/plugins/trust/eligibility/executor";
import { registerTrustEligibilityKind } from "../../server/plugins/trust/eligibility";
import { BaoEeContributionsPlugin } from "../../server/plugins/trust/eligibility/plugins/sitespecific-bao-ee-contributions";
import { eligibilityPluginRegistry } from "../../server/plugins/trust/eligibility/registry";
import type { EligibilityRule } from "../../server/plugins/trust/eligibility/types";

const PLUGIN_ID = "sitespecific-bao-ee-contributions";
const ACCOUNT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const POLICY_ID = "policy-bao-ee";
const BENEFIT_ID = "benefit-bao-ee";
const CONFIG_ID = "config-bao-ee";
const EMPLOYER_ID = "employer-bao-ee";
const SUBSCRIBER_ID = "subscriber-1";
const DEPENDENT_ID = "dependent-1";

const plugin = new BaoEeContributionsPlugin();
const rule: EligibilityRule = {
  pluginKey: PLUGIN_ID,
  appliesTo: ["start", "continue"],
  config: {
    appliesTo: ["start", "continue"],
    accountId: ACCOUNT_ID,
  },
};

function worker(id: string): any {
  return { id, contactId: null };
}

async function evaluate(
  workerId = SUBSCRIBER_ID,
  relationship?: { dependentWorkerId: string },
) {
  return evaluateEligibilityRules([rule], {
    scanType: "continue",
    workerId,
    worker: worker(SUBSCRIBER_ID),
    relationship,
    employerId: EMPLOYER_ID,
    asOfYear: 2026,
    asOfMonth: 3,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  state.accountExists = true;
  state.eaWorkers = new Set([SUBSCRIBER_ID]);
  state.outstanding = {
    count: 2,
    months: [
      { year: 2025, month: 12 },
      { year: 2026, month: 1 },
    ],
  };

  mockStorage.ledger.accounts.get.mockImplementation(async (id: string) =>
    state.accountExists ? { id } : undefined,
  );
  mockStorage.ledger.ea.getByEntityAndAccount.mockImplementation(
    async (_entityType: string, workerId: string, _accountId: string) =>
      state.eaWorkers.has(workerId) ? { id: `ea-${workerId}` } : undefined,
  );
  mockStorage.ledger.entries.getOutstandingStatementMonths.mockImplementation(
    async () => state.outstanding,
  );
  mockStorage.workers.getWorker.mockImplementation(async (id: string) => worker(id));
  mockStorage.contacts.getContact.mockResolvedValue(undefined);
  mockStorage.employers.getEmployer.mockImplementation(async (id: string) => ({ id }));
  mockStorage.workerRelations.findActiveBetween.mockResolvedValue({
    relationType: "child",
  });
});

registerTrustEligibilityKind();

describe("BAO EE Contributions plugin metadata and config adapter", () => {
  it("exposes the account remote picker metadata used by the editor", () => {
    const accountSchema = (plugin.metadata.configSchema as any).properties.accountId;

    expect(accountSchema).toMatchObject({
      type: "string",
      format: "uuid",
      "x-options-endpoint": "/api/ledger/accounts",
    });
  });

  it("round-trips appliesTo, policy, benefit, and accountId through the adapter", () => {
    const adapter = getPluginConfigAdapter("trust-eligibility");
    expect(adapter).toBeDefined();

    const parsed = adapter!.configSchema.parse({
      pluginId: PLUGIN_ID,
      name: "BAO EE Contributions",
      enabled: true,
      ordering: 7,
      data: {
        appliesTo: ["start", "continue"],
        accountId: ACCOUNT_ID,
      },
      policy: POLICY_ID,
      benefit: BENEFIT_ID,
    });
    const firstRows = adapter!.toRows(parsed);

    expect(firstRows.base.data).toEqual({
      appliesTo: ["start", "continue"],
      accountId: ACCOUNT_ID,
    });
    expect(firstRows.subsidiary).toEqual({
      policy: POLICY_ID,
      benefit: BENEFIT_ID,
      appliesTo: "start,continue",
    });

    const hydrated = defaultHydrate({
      config: {
        ...firstRows.base,
        id: CONFIG_ID,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any,
      subsidiary: { id: CONFIG_ID, ...firstRows.subsidiary },
    } as any);
    expect(hydrated).toMatchObject({
      id: CONFIG_ID,
      policy: POLICY_ID,
      benefit: BENEFIT_ID,
      data: {
        appliesTo: ["start", "continue"],
        accountId: ACCOUNT_ID,
      },
    });

    const secondRows = adapter!.toRows(adapter!.configSchema.parse(hydrated));
    expect(secondRows).toEqual(firstRows);

    const ruleFromStoredConfig = pluginConfigToEligibilityRule({
      ...firstRows.base,
      id: CONFIG_ID,
    } as any);
    expect(ruleFromStoredConfig.appliesTo).toEqual(["start", "continue"]);
    expect(ruleFromStoredConfig.config.accountId).toBe(ACCOUNT_ID);
  });
});

describe("BAO EE Contributions config validation", () => {
  it("accepts an existing account and rejects malformed or deleted accounts", async () => {
    await expect(
      plugin.validateConfig({ appliesTo: ["continue"], accountId: ACCOUNT_ID }),
    ).resolves.toEqual({ valid: true });

    const malformed = await plugin.validateConfig({
      appliesTo: ["continue"],
      accountId: "not-a-uuid",
    });
    expect(malformed.valid).toBe(false);
    expect(malformed.errors?.join(" ")).toMatch(/uuid/i);

    state.accountExists = false;
    const deleted = await plugin.validateConfig({
      appliesTo: ["continue"],
      accountId: ACCOUNT_ID,
    });
    expect(deleted).toEqual({
      valid: false,
      errors: ["Ledger account does not exist"],
    });
  });
});

describe("BAO EE Contributions real executor behavior", () => {
  it("keeps subscriber and dependent results identical and reads the subscriber EA", async () => {
    const subscriber = await evaluate();
    const dependent = await evaluate(SUBSCRIBER_ID, {
      dependentWorkerId: DEPENDENT_ID,
    });

    expect(subscriber).toHaveLength(1);
    expect(dependent).toHaveLength(1);
    expect(subscriber[0]).toMatchObject({ eligible: false });
    expect(dependent[0]).toMatchObject({ eligible: false });
    expect(dependent[0].reason).toBe(subscriber[0].reason);
    expect(
      mockStorage.ledger.ea.getByEntityAndAccount.mock.calls.map((call) => call[1]),
    ).toEqual([SUBSCRIBER_ID, SUBSCRIBER_ID]);
  });

  it("distinguishes an absent EA (pass) from invalid configuration (fail closed)", async () => {
    state.eaWorkers.clear();
    const absentAccount = await evaluate();
    expect(absentAccount[0].eligible).toBe(true);
    expect(absentAccount[0].reason).toMatch(/no worker-linked account/i);

    state.accountExists = false;
    const invalidConfig = await evaluate();
    expect(invalidConfig[0].eligible).toBe(false);
    expect(invalidConfig[0].reason).toMatch(/invalid bao ee contributions configuration/i);
    expect(mockStorage.ledger.ea.getByEntityAndAccount).toHaveBeenCalledTimes(1);
  });

  it("reflects changed balances on reevaluation without caching the prior result", async () => {
    const blocked = await evaluate();
    expect(blocked[0].eligible).toBe(false);

    state.outstanding = {
      count: 1,
      months: [{ year: 2026, month: 1 }],
    };
    const restored = await evaluate();
    expect(restored[0].eligible).toBe(true);

    state.outstanding = {
      count: 2,
      months: [
        { year: 2025, month: 12 },
        { year: 2026, month: 2 },
      ],
    };
    const blockedAgain = await evaluate();
    expect(blockedAgain[0].eligible).toBe(false);
    expect(mockStorage.ledger.entries.getOutstandingStatementMonths).toHaveBeenCalledTimes(3);
  });

  it("passes an empty ledger and forwards only the evaluated month exclusion", async () => {
    state.outstanding = { count: 0, months: [] };
    expect((await evaluate())[0]).toMatchObject({
      eligible: true,
      reason: expect.stringContaining("0 outstanding statement months"),
    });
    expect(mockStorage.ledger.ea.getByEntityAndAccount).toHaveBeenCalledWith(
      "worker", SUBSCRIBER_ID, ACCOUNT_ID,
    );
    expect(mockStorage.ledger.entries.getOutstandingStatementMonths).toHaveBeenCalledWith(
      `ea-${SUBSCRIBER_ID}`, { year: 2026, month: 3 },
    );
  });

  it("rejects a missing account setting before querying a worker ledger", async () => {
    const results = await evaluateEligibilityRules(
      [{ ...rule, config: { appliesTo: ["continue"] } }],
      {
        scanType: "continue", workerId: SUBSCRIBER_ID,
        worker: worker(SUBSCRIBER_ID), employerId: EMPLOYER_ID,
        asOfYear: 2026, asOfMonth: 3,
      },
    );
    expect(results[0].eligible).toBe(false);
    expect(results[0].reason).toMatch(/invalid.*configuration/i);
    expect(mockStorage.ledger.ea.getByEntityAndAccount).not.toHaveBeenCalled();
  });
});

it("is registered under the expected trust eligibility plugin id", () => {
  expect(eligibilityPluginRegistry.get(PLUGIN_ID)?.metadata.id).toBe(PLUGIN_ID);
});