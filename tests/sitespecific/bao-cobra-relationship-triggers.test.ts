import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  baoCobraTriggerConfigSchema,
  resolveTriggerForPlugin,
  triggerAppliesToPerson,
  type BaoCobraTriggerConfig,
} from "../../shared/schema/sitespecific/bao/cobra-triggers";

const h = vi.hoisted(() => ({
  config: null as null | { value: unknown },
  cases: [] as any[],
  events: [] as any[],
  handlers: new Map<string, (payload: any) => Promise<void>>(),
  relations: [
    { id: "child-relation", relationType: "child", relationTypeName: "Child", otherWorker: { id: "child-worker" } },
    { id: "spouse-relation", relationType: "spouse", relationTypeName: "Spouse", otherWorker: { id: "spouse-worker" } },
    { id: "unknown-relation", relationType: null, relationTypeName: null, otherWorker: { id: "unknown-worker" } },
  ],
}));

vi.mock("../../server/services/event-bus", () => ({
  EventType: { TRUST_WMB_SCAN_WORKER_COMPLETED: "scan", TRUST_ELECTION_SAVED: "election", WMB_SAVED: "wmb" },
  eventBus: {
    on: ({ event, handler }: any) => { h.handlers.set(event, handler); return event; },
    off: (event: string) => h.handlers.delete(event),
  },
}));
vi.mock("../../server/storage", () => ({
  storage: {
    variables: { getByName: async () => h.config },
    baoCobraCases: {
      classifyMedicalDentalBenefit: async (id: string) => id === "medical" || id === "dental" ? id : null,
      listForCoveredPersonEffective: async (id: string, ymd: string) =>
        h.cases.filter((c) => c.coveredPersonWorkerId === id && c.cobraEffectiveYmd === ymd)
          .map((theCase) => ({ theCase, statusClosed: false })),
      createEnforcingInvariants: async (entry: any) => {
        const created = { ...entry, id: `case-${h.cases.length + 1}` };
        h.cases.push(created);
        return created;
      },
      update: async (id: string, patch: any) => {
        Object.assign(h.cases.find((c) => c.id === id), patch);
      },
    },
    workerTrustElections: {
      getActiveByWorkerAsOf: async () => ({ relationshipIds: h.relations.map((r) => r.id) }),
    },
    workerRelations: {
      searchWorkerRelations: async ({ workerId }: any) => {
        expect(workerId).toBe("subscriber");
        return h.relations;
      },
    },
    trustWmbEvents: { listAllByType: async () => h.events },
  },
}));
vi.mock("../../server/storage/unified-options", () => ({
  createUnifiedOptionsStorage: () => ({
    list: async () => [{ id: "open", closed: false }],
  }),
}));
vi.mock("../../server/services/component-cache", () => ({
  isCacheInitialized: () => true, isComponentEnabledSync: () => true,
}));
vi.mock("../../server/plugins/trust/eligibility/registry", () => ({
  eligibilityPluginRegistry: { get: (key: string) => ({ metadata: { name: key } }) },
}));
vi.mock("../../server/logger", () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {} },
}));

const { openCobraCasesForTermination, initBaoCobraAutoCase, shutdownBaoCobraAutoCase } =
  await import("../../server/services/bao-cobra-auto-case");
const { reconcileCobraCases } = await import("../../server/services/bao-cobra-case-reconcile");

const failures = (pluginKey: string) => [{ pluginKey, reason: "failed" }];
const benefits = [
  { benefitId: "medical", kind: "medical" as const, failedPlugins: failures("low-hours") },
  { benefitId: "dental", kind: "dental" as const, failedPlugins: failures("ageout") },
];
const group = () => ({
  subscriberWorkerId: "subscriber", year: 2030, month: 7, benefits, trigger: "wmb_scan",
});
const settings = (plugins: BaoCobraTriggerConfig["plugins"]) => {
  h.config = { value: baoCobraTriggerConfigSchema.parse({ plugins }) };
};
const byPerson = (id: string) => h.cases.find((c) => c.coveredPersonWorkerId === id);
const event = (benefitId: string, pluginKey: string) => ({
  workerId: "subscriber", year: 2030, month: 7, benefitId,
  data: { failedPlugins: failures(pluginKey) },
});

beforeEach(() => {
  h.config = null;
  h.cases.length = 0;
  h.events.length = 0;
  shutdownBaoCobraAutoCase();
});

describe("COBRA relationship trigger settings", () => {
  it("round-trips explicit empty and combined scopes, and preserves omitted legacy scope", () => {
    const parsed = baoCobraTriggerConfigSchema.parse({ plugins: {
      legacy: { trigger: true },
      empty: { trigger: true, self: false, dependentRelationshipTypeIds: [] },
      both: { trigger: true, self: true, dependentRelationshipTypeIds: ["child"] },
    } });
    expect(baoCobraTriggerConfigSchema.parse(JSON.parse(JSON.stringify(parsed)))).toEqual(parsed);
    expect(triggerAppliesToPerson(resolveTriggerForPlugin(parsed, "legacy"), null, false)).toBe(true);
    expect(triggerAppliesToPerson(parsed.plugins.empty, null, true)).toBe(false);
    expect(triggerAppliesToPerson(parsed.plugins.empty, "child", false)).toBe(false);
    expect(triggerAppliesToPerson(parsed.plugins.both, null, true)).toBe(true);
    expect(triggerAppliesToPerson(parsed.plugins.both, "child", false)).toBe(true);
    expect(triggerAppliesToPerson(parsed.plugins.both, "spouse", false)).toBe(false);
    expect(baoCobraTriggerConfigSchema.safeParse({ plugins: { bad: { trigger: true, dependentRelationshipTypeIds: [null] } } }).success).toBe(false);
  });

  it("keeps legacy all-person behavior, while disabled and empty scopes open no cases", async () => {
    expect((await openCobraCasesForTermination(group())).created).toBe(4);
    h.cases.length = 0;
    settings({ "low-hours": { trigger: false }, ageout: { trigger: false } });
    expect((await openCobraCasesForTermination(group())).qualified).toBe(false);
    expect(h.cases).toHaveLength(0);
    settings({ "low-hours": { trigger: true, self: false, dependentRelationshipTypeIds: [] },
      ageout: { trigger: true, self: false, dependentRelationshipTypeIds: [] } });
    await openCobraCasesForTermination(group());
    expect(h.cases).toHaveLength(0);
  });

  it("restricts each lost benefit and its event mapping to its own qualifying people", async () => {
    settings({
      "low-hours": { trigger: true, self: true, dependentRelationshipTypeIds: [], qualifyingEventId: "low-event" },
      ageout: { trigger: true, self: false, dependentRelationshipTypeIds: ["child"], qualifyingEventId: "age-event" },
    });
    await openCobraCasesForTermination(group());
    expect(h.cases).toHaveLength(2);
    expect(byPerson("subscriber")).toMatchObject({
      medicalBenefitLostId: "medical", dentalBenefitLostId: null, qualifyingEventId: "low-event",
    });
    expect(byPerson("child-worker")).toMatchObject({
      medicalBenefitLostId: null, dentalBenefitLostId: "dental", qualifyingEventId: "age-event",
    });
    expect(byPerson("spouse-worker")).toBeUndefined();
    expect(byPerson("unknown-worker")).toBeUndefined();
    await openCobraCasesForTermination(group());
    expect(h.cases).toHaveLength(2);
    expect(byPerson("subscriber").dentalBenefitLostId).toBeNull();
    expect(byPerson("child-worker").medicalBenefitLostId).toBeNull();
  });

  it("merges only an applicable benefit into an existing case", async () => {
    settings({ "low-hours": { trigger: true, self: true, dependentRelationshipTypeIds: [] },
      ageout: { trigger: true, self: false, dependentRelationshipTypeIds: ["child"] } });
    h.cases.push({ id: "prior", coveredPersonWorkerId: "subscriber", cobraEffectiveYmd: "2030-07-01",
      electionMadeYmd: null, medicalBenefitLostId: null, dentalBenefitLostId: null });
    const result = await openCobraCasesForTermination(group());
    expect(result.merged).toBe(1);
    expect(byPerson("subscriber").medicalBenefitLostId).toBe("medical");
    expect(byPerson("subscriber").dentalBenefitLostId).toBeNull();
  });

  it("allows self and selected dependents together without including other dependents", async () => {
    settings({ "low-hours": { trigger: true, self: true, dependentRelationshipTypeIds: ["child"] },
      ageout: { trigger: false } });
    await openCobraCasesForTermination(group());
    expect(h.cases.map((c) => c.coveredPersonWorkerId)).toEqual(["subscriber", "child-worker"]);
    expect(h.cases.every((c) => c.medicalBenefitLostId === "medical" && c.dentalBenefitLostId === null)).toBe(true);
  });

  it("uses the same benefit-specific results for live scans and persisted reconciliation", async () => {
    settings({
      "low-hours": { trigger: true, self: true, dependentRelationshipTypeIds: [] },
      ageout: { trigger: true, self: false, dependentRelationshipTypeIds: ["child"] },
    });
    initBaoCobraAutoCase();
    await h.handlers.get("scan")!({
      workerId: "subscriber", year: 2030, month: 7,
      actions: benefits.map((b) => ({
        benefitId: b.benefitId, benefitName: b.benefitId, scanType: "continue",
        eligible: false, pluginResults: b.failedPlugins.map((r) => ({ ...r, eligible: false })),
      })),
    });
    const live = h.cases.map((c) => [c.coveredPersonWorkerId, c.medicalBenefitLostId, c.dentalBenefitLostId]);
    h.cases.length = 0;
    h.events.push(event("medical", "low-hours"), event("dental", "ageout"));
    const first = await reconcileCobraCases();
    expect(first.created).toBe(2);
    expect(h.cases.map((c) => [c.coveredPersonWorkerId, c.medicalBenefitLostId, c.dentalBenefitLostId])).toEqual(live);
    const second = await reconcileCobraCases();
    expect(second.created).toBe(0);
    expect(second.merged).toBe(0);
    expect(byPerson("subscriber").dentalBenefitLostId).toBeNull();
    expect(byPerson("child-worker").medicalBenefitLostId).toBeNull();
    shutdownBaoCobraAutoCase();
  });
});