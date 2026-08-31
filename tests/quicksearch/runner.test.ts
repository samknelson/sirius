/**
 * Quicksearch fails SILENTLY by design: a searcher a user may not use simply
 * does not run, and a clause the typed string cannot plausibly be is dropped.
 * Nothing in the UI distinguishes "you are not allowed to search this" from
 * "nothing matched", which is exactly what makes these paths easy to break
 * without noticing. These tests pin each one.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

interface ConfigRow {
  id: string;
  pluginId: string;
  name: string | null;
  enabled: boolean;
  roles: string[];
  data: Record<string, unknown>;
  ordering: number;
}

interface Scenario {
  userRoles: { id: string; name: string }[];
  configs: ConfigRow[];
  permissions: Record<string, boolean>;
  policies: Record<string, boolean>;
  enabledComponents: Record<string, boolean>;
  /** Simulates the policy evaluator being unavailable rather than refusing. */
  policyEvaluatorThrows: boolean;
  /** Every search call the runner actually made, in order. */
  searchCalls: { pluginId: string; settings: Record<string, unknown> }[];
}

let scenario: Scenario;

vi.mock("../../server/storage", () => ({
  storage: {
    users: {
      async getUserRoles() {
        return scenario.userRoles;
      },
    },
    pluginConfigs: {
      // Mirrors the real generic search: the subsidiary join filters by
      // enabled + role overlap, and the result is ordered by (ordering, id).
      async search(_kind: string, params: { enabled?: boolean; roleIn?: string[] }) {
        const roleIn = params.roleIn ?? [];
        return scenario.configs
          .filter((c) => (params.enabled === undefined ? true : c.enabled === params.enabled))
          .filter((c) => c.roles.some((r) => roleIn.includes(r)))
          .sort((a, b) => a.ordering - b.ordering || a.id.localeCompare(b.id))
          .map((c) => ({
            config: {
              id: c.id,
              pluginId: c.pluginId,
              name: c.name,
              enabled: c.enabled,
              data: c.data,
            },
          }));
      },
    },
  },
}));

vi.mock("../../server/services/access-policy-evaluator", () => ({
  async checkAccess(policyId: string) {
    if (scenario.policyEvaluatorThrows) throw new Error("evaluator unavailable");
    return { granted: scenario.policies[policyId] === true };
  },
  getAccessStorage: () => ({
    async hasPermission(_userId: string, permission: string) {
      return scenario.permissions[permission] === true;
    },
  }),
}));

vi.mock("../../server/plugins/_core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../server/plugins/_core")>()),
  async isPluginComponentEnabledAsync(meta: { requiredComponent?: string }) {
    if (!meta.requiredComponent) return true;
    return scenario.enabledComponents[meta.requiredComponent] === true;
  },
}));

vi.mock("../../server/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { registerQuicksearchPlugin } from "../../server/plugins/quicksearch/registry";
import {
  QUICKSEARCH_RESULT_LIMIT,
  runQuicksearch,
  userHasQuicksearch,
} from "../../server/plugins/quicksearch/runner";
import type { QuicksearchContext } from "../../server/plugins/quicksearch/types";

const USER = { id: "user-1" } as any;

/** Records the call and answers with one row, so "did it run?" is observable. */
function recordingSearch(pluginId: string, rowCount = 1) {
  return async (ctx: QuicksearchContext) => {
    scenario.searchCalls.push({ pluginId, settings: ctx.settings });
    return Array.from({ length: rowCount }, (_, i) => ({
      id: `${pluginId}-${i}`,
      title: `${pluginId} ${i}`,
      href: `/${pluginId}/${i}`,
    }));
  };
}

registerQuicksearchPlugin({
  id: "test-plain",
  name: "Plain",
  description: "No gates at all.",
  search: recordingSearch("test-plain"),
});

registerQuicksearchPlugin({
  id: "test-gated",
  name: "Gated",
  description: "Behind a component and a policy.",
  requiredComponent: "test-component",
  requiredPolicy: "test-policy",
  search: recordingSearch("test-gated"),
});

registerQuicksearchPlugin({
  id: "test-sensitive",
  name: "Sensitive",
  description: "Has a permission-gated option.",
  permissionGatedOptions: { searchSsn: "workers.ssn" },
  search: recordingSearch("test-sensitive"),
});

registerQuicksearchPlugin({
  id: "test-throws",
  name: "Throws",
  description: "Always fails.",
  async search() {
    throw new Error("boom");
  },
});

registerQuicksearchPlugin({
  id: "test-slow",
  name: "Slow",
  description: "Never answers in time.",
  async search() {
    await new Promise((resolve) => setTimeout(resolve, 60_000));
    return [];
  },
});

registerQuicksearchPlugin({
  id: "test-many",
  name: "Many",
  description: "Answers with more rows than the cap.",
  search: recordingSearch("test-many", QUICKSEARCH_RESULT_LIMIT + 1),
});

function config(overrides: Partial<ConfigRow> & { id: string; pluginId: string }): ConfigRow {
  return {
    name: null,
    enabled: true,
    roles: ["role-held"],
    data: {},
    ordering: 0,
    ...overrides,
  };
}

beforeEach(() => {
  scenario = {
    userRoles: [{ id: "role-held", name: "Held" }],
    configs: [],
    permissions: {},
    policies: {},
    enabledComponents: {},
    policyEvaluatorThrows: false,
    searchCalls: [],
  };
});

describe("quicksearch access decisions", () => {
  it("does not run a disabled configuration", async () => {
    scenario.configs = [config({ id: "c1", pluginId: "test-plain", enabled: false })];

    const response = await runQuicksearch(USER, "smith");

    expect(scenario.searchCalls).toEqual([]);
    expect(response.groups).toEqual([]);
    // Silently: a disabled searcher is not reported as a failure either.
    expect(response.failures).toEqual([]);
  });

  it("does not run a configuration whose roles the user does not hold", async () => {
    scenario.configs = [config({ id: "c1", pluginId: "test-plain", roles: ["role-other"] })];

    const response = await runQuicksearch(USER, "smith");

    expect(scenario.searchCalls).toEqual([]);
    expect(response.groups).toEqual([]);
  });

  it("searches nothing for a user with no roles at all", async () => {
    scenario.userRoles = [];
    scenario.configs = [config({ id: "c1", pluginId: "test-plain" })];

    expect((await runQuicksearch(USER, "smith")).groups).toEqual([]);
    expect(scenario.searchCalls).toEqual([]);
  });

  it("does not run a searcher whose component is switched off", async () => {
    scenario.policies["test-policy"] = true;
    scenario.enabledComponents["test-component"] = false;
    scenario.configs = [config({ id: "c1", pluginId: "test-gated" })];

    expect((await runQuicksearch(USER, "smith")).groups).toEqual([]);
    expect(scenario.searchCalls).toEqual([]);
  });

  it("does not run a searcher whose policy the user fails", async () => {
    scenario.enabledComponents["test-component"] = true;
    scenario.policies["test-policy"] = false;
    scenario.configs = [config({ id: "c1", pluginId: "test-gated" })];

    expect((await runQuicksearch(USER, "smith")).groups).toEqual([]);
    expect(scenario.searchCalls).toEqual([]);
  });

  it("runs a gated searcher once component and policy both pass", async () => {
    scenario.enabledComponents["test-component"] = true;
    scenario.policies["test-policy"] = true;
    scenario.configs = [config({ id: "c1", pluginId: "test-gated" })];

    const response = await runQuicksearch(USER, "smith");

    expect(scenario.searchCalls.map((c) => c.pluginId)).toEqual(["test-gated"]);
    expect(response.groups).toHaveLength(1);
  });
});

describe("permission-gated options", () => {
  it("forces a gated option off for a user without the permission", async () => {
    scenario.permissions["workers.ssn"] = false;
    scenario.configs = [
      config({ id: "c1", pluginId: "test-sensitive", data: { searchSsn: true } }),
    ];

    await runQuicksearch(USER, "123456789");

    // The searcher still runs — it just cannot use the clause. That is the
    // silent part: the user sees no SSN results and no explanation.
    expect(scenario.searchCalls[0].settings.searchSsn).toBe(false);
  });

  it("leaves a gated option on for a user who holds the permission", async () => {
    scenario.permissions["workers.ssn"] = true;
    scenario.configs = [
      config({ id: "c1", pluginId: "test-sensitive", data: { searchSsn: true } }),
    ];

    await runQuicksearch(USER, "123456789");

    expect(scenario.searchCalls[0].settings.searchSsn).toBe(true);
  });

  it("never turns a gated option ON just because the permission is held", async () => {
    scenario.permissions["workers.ssn"] = true;
    scenario.configs = [
      config({ id: "c1", pluginId: "test-sensitive", data: { searchSsn: false } }),
    ];

    await runQuicksearch(USER, "123456789");

    // The configuration is still the switch; the permission only removes.
    expect(scenario.searchCalls[0].settings.searchSsn).toBe(false);
  });
});

describe("one searcher failing", () => {
  it("reports a thrown error and still returns the other groups", async () => {
    scenario.configs = [
      config({ id: "c1", pluginId: "test-throws", ordering: 0 }),
      config({ id: "c2", pluginId: "test-plain", ordering: 1 }),
    ];

    const response = await runQuicksearch(USER, "smith");

    expect(response.groups.map((g) => g.pluginId)).toEqual(["test-plain"]);
    expect(response.failures).toEqual([
      { configId: "c1", pluginId: "test-throws", label: "Throws", reason: "error" },
    ]);
  });

  it("reports a searcher whose GATE could not be evaluated, and runs the rest", async () => {
    // A gate that REFUSES is silent; a gate that BREAKS must not take the
    // whole dialog down with it.
    scenario.policyEvaluatorThrows = true;
    scenario.enabledComponents["test-component"] = true;
    scenario.configs = [
      config({ id: "c1", pluginId: "test-gated", ordering: 0 }),
      config({ id: "c2", pluginId: "test-plain", ordering: 1 }),
    ];

    const response = await runQuicksearch(USER, "smith");

    expect(response.failures).toEqual([
      { configId: "c1", pluginId: "test-gated", label: "Gated", reason: "error" },
    ]);
    expect(response.groups.map((g) => g.pluginId)).toEqual(["test-plain"]);
  });

  it("does not offer the search control on the strength of a gate that broke", async () => {
    scenario.policyEvaluatorThrows = true;
    scenario.enabledComponents["test-component"] = true;
    scenario.configs = [config({ id: "c1", pluginId: "test-gated" })];

    expect(await userHasQuicksearch(USER)).toBe(false);
  });

  it("reports a searcher that blows its budget without waiting for it", async () => {
    vi.useFakeTimers();
    try {
      scenario.configs = [
        config({ id: "c1", pluginId: "test-slow", ordering: 0 }),
        config({ id: "c2", pluginId: "test-plain", ordering: 1 }),
      ];

      const pending = runQuicksearch(USER, "smith");
      await vi.advanceTimersByTimeAsync(30_000);
      const response = await pending;

      expect(response.failures).toEqual([
        { configId: "c1", pluginId: "test-slow", label: "Slow", reason: "timeout" },
      ]);
      expect(response.groups.map((g) => g.pluginId)).toEqual(["test-plain"]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("result shaping", () => {
  it("caps a group and says so, rather than quietly dropping the extra row", async () => {
    scenario.configs = [config({ id: "c1", pluginId: "test-many" })];

    const [group] = (await runQuicksearch(USER, "smith")).groups;

    expect(group.results).toHaveLength(QUICKSEARCH_RESULT_LIMIT);
    expect(group.truncated).toBe(true);
  });

  it("orders groups the way an administrator arranged the configurations", async () => {
    scenario.enabledComponents["test-component"] = true;
    scenario.policies["test-policy"] = true;
    scenario.configs = [
      config({ id: "c1", pluginId: "test-gated", ordering: 5 }),
      config({ id: "c2", pluginId: "test-plain", ordering: 1 }),
    ];

    const response = await runQuicksearch(USER, "smith");

    expect(response.groups.map((g) => g.pluginId)).toEqual(["test-plain", "test-gated"]);
  });

  it("labels a group with the configuration's own name when it has one", async () => {
    scenario.configs = [config({ id: "c1", pluginId: "test-plain", name: "People" })];

    expect((await runQuicksearch(USER, "smith")).groups[0].label).toBe("People");
  });

  it("returns nothing for a query below the minimum length, without searching", async () => {
    scenario.configs = [config({ id: "c1", pluginId: "test-plain" })];

    const response = await runQuicksearch(USER, "a");

    expect(scenario.searchCalls).toEqual([]);
    expect(response.groups).toEqual([]);
  });
});

describe("offering the search control", () => {
  it("is unavailable when every configuration is gated away", async () => {
    scenario.policies["test-policy"] = false;
    scenario.enabledComponents["test-component"] = true;
    scenario.configs = [config({ id: "c1", pluginId: "test-gated" })];

    expect(await userHasQuicksearch(USER)).toBe(false);
  });

  it("is unavailable when a configuration names a plugin this build does not have", async () => {
    scenario.configs = [config({ id: "c1", pluginId: "no-such-plugin" })];

    expect(await userHasQuicksearch(USER)).toBe(false);
  });

  it("is available as soon as one configuration survives every gate", async () => {
    scenario.configs = [config({ id: "c1", pluginId: "test-plain" })];

    expect(await userHasQuicksearch(USER)).toBe(true);
  });
});
