import { beforeEach, describe, expect, it, vi } from "vitest";
import { parse } from "csv-parse/sync";

const fixture = vi.hoisted(() => ({ units: [] as any[], candidates: [] as any[], contexts: [] as any[] }));
vi.mock("../../server/plugins/trust/provider-edi/base", async importOriginal => {
  const actual = await importOriginal<typeof import("../../server/plugins/trust/provider-edi/base")>();
  return { ...actual,
    wmbPrimaryKeys: async () => ["active"],
    resolveBenefitIds: async () => ["benefit"],
    buildMemberUnits: async (keys: string[], ctx: any) => {
      fixture.contexts.push(ctx);
      return fixture.units.filter(u => keys.includes(u.wmb.id));
    },
  };
});
vi.mock("../../server/plugins/trust/provider-edi/termination-population", () => ({
  loadTerminationCandidates: async (ctx: any) => fixture.candidates.filter(c =>
    c.role === "subscriber" ? (ctx.terminationPolicy?.subscribers ?? ctx.configData.explicitSubscriberTerminations)
      : (ctx.terminationPolicy?.dependents ?? ctx.configData.explicitDependentTerminations)),
}));
import { registeredEdiPlugins, requireEdiPlugin } from "./fixtures/harness";
import { assembleEdiFileLines } from "../../server/plugins/trust/provider-edi/base";
import { carrierLayoutCsv } from "../../server/plugins/trust/provider-edi/carrier-csv";
import { validateAgainstSchema } from "../../server/lib/json-schema-validator";
import { terminationContractBlocker } from "../../server/plugins/trust/provider-edi/termination-policy";
import type { TrustProviderEdiContext } from "../../server/plugins/trust/provider-edi/registry";
import { trustProviderEdiWizardPlugin } from "../../server/plugins/wizards/plugins/trust-provider-edi";

const person = {
  ssn: "001234567", contactId: "contact", workerSiriusId: "123", email: "fixture@example.invalid",
  givenName: "Fixture", familyName: "Person", middleName: null, birthDate: "1980-01-01",
  genderCode: "F", postal: null, phoneNumber: null,
};
function context(subscribers = false, dependents = false): TrustProviderEdiContext {
  return { configId: "fixture", providerId: null, sftpClientId: null,
    configData: { explicitSubscriberTerminations: subscribers, explicitDependentTerminations: dependents },
    input: { asOfDate: "2026-11-01" },
    storage: { readOnly: { query: async () => [] } } as any,
  };
}
beforeEach(() => {
  fixture.contexts = [];
  fixture.units = ["active", "history"].map(id => ({
    wmb: { id, workerId: id, benefitId: "benefit", year: 2026, month: id === "active" ? 11 : 10 },
    benefitSiriusId: "D", isCobra: id === "history", coverageStartYmd: "2026-01-01",
    subscriber: person,
    dependents: [{ ...person, ssn: "009876543", relationId: "relation", relationSiriusId: "QMSCO" }],
  }));
  fixture.candidates = ["subscriber", "dependent"].map(role => ({
    eventId: role, benefitId: "benefit", workerId: role, familyWmbId: "history",
    rowKey: role === "subscriber" ? "history" : "history:relation",
    role, start: role === "subscriber" ? "2026-01-01" : "2026-09-01",
    end: "2026-10-31", evidence: "coverage inferred",
  }));
});

describe("registered carrier lifecycle composition", () => {
  it("exposes validated settings on precisely nine membership schemas", () => {
    const membership = registeredEdiPlugins().filter(p => p.benefitSiriusIds?.length);
    expect(membership).toHaveLength(9);
    for (const plugin of membership) {
      expect(plugin.configSchema?.properties?.explicitSubscriberTerminations).toBeUndefined();
      expect(plugin.inputSchema?.properties?.explicitSubscriberTerminations).toBeDefined();
      expect(validateAgainstSchema(plugin.inputSchema!, { terminationLookbackMonths: 0 }).valid).toBe(false);
      expect(validateAgainstSchema(plugin.inputSchema!, { explicitDependentTerminations: "true" }).valid).toBe(false);
      expect(validateAgainstSchema(plugin.inputSchema!, {}).valid).toBe(true);
    }
    expect(requireEdiPlugin("sitespecific-smf-local11").configSchema?.properties?.terminationLookbackMonths).toBeUndefined();
    expect(requireEdiPlugin("sitespecific-smf-local11").inputSchema?.properties?.terminationLookbackMonths).toBeUndefined();
  });
  for (const id of ["delta", "hinge", "mlk"]) {
    it.each([[false, false], [true, false], [false, true], [true, true]])(
      `${id}: generates only selected term roles (%s/%s), preserving active rows`, async (subs, deps) => {
        const plugin = requireEdiPlugin(`sitespecific-smf-${id}`);
        const ctx = context(subs, deps);
        const keys = await plugin.getPrimaryKeys!(ctx);
        // Split across separate batches to exercise stable keys.
        const rows = (await Promise.all(keys.map(key => plugin.processBatch([key], ctx)))).flat();
        expect(rows.filter(r => !r.terminationRole)).toHaveLength(2);
        const terms = rows.filter(r => r.terminationRole);
        expect(terms).toHaveLength(Number(subs) + Number(deps));
        for (const row of terms) {
          expect(row.coverageEnd).toBe("20261031");
          expect(row.coverageStart).toBe(row.terminationRole === "dependent" ? "20260901" : "20260101");
          expect(plugin.encodeRow(row, ctx)).toContain("20261031");
          if (id === "delta") expect(row.divisionId).toBe("09002");
        }
        expect(new Set(rows.map(r => r.pk)).size).toBe(rows.length);
        if (terms.length) expect(fixture.contexts.some(c => c.input.asOfDate === "2026-10-31")).toBe(true);
        const qa = parse(carrierLayoutCsv(plugin, rows, ctx), { relax_column_count: true }) as string[][];
        const native = assembleEdiFileLines(plugin, rows, ctx);
        const records = qa.filter(r => r[0].startsWith("QA-only record kind:"));
        expect(records).toHaveLength(native.length);
        records.forEach((record, i) => {
          if (plugin.outputFormat === "csv") expect(record.slice(1)).toEqual(parse(native[i])[0]);
          else expect(record.slice(1).join("")).toBe(native[i]);
        });
        if (id === "delta") expect(native.at(-1)?.slice(2, 9).trim()).toBe(String(rows.length + 2));
      },
    );
  }
  it("refuses unresolved status contracts before population, while omission still works", async () => {
    for (const plugin of registeredEdiPlugins().filter(p => p.benefitSiriusIds?.length && terminationContractBlocker(p.id))) {
      for (const [subs, deps] of [[true, false], [false, true], [true, true]]) {
        await expect(plugin.getPrimaryKeys!(context(subs, deps))).rejects.toThrow(/Explicit termination generation blocked/);
        await expect(plugin.processBatch(["active"], context(subs, deps))).rejects.toThrow(/Explicit termination generation blocked/);
      }
      expect(await plugin.getPrimaryKeys!(context())).toEqual(["active"]);
    }
  });
  it("keeps missing settings equivalent to false for saved runs", async () => {
    const plugin = requireEdiPlugin("sitespecific-smf-delta");
    const ctx = context();
    const before = await plugin.processBatch(["active"], ctx);
    ctx.configData = {};
    expect(await plugin.processBatch(["active"], ctx)).toEqual(before);
  });
  it("all nine serializers and QA layouts carry their declared end date field", () => {
    for (const plugin of registeredEdiPlugins().filter(p => p.benefitSiriusIds?.length)) {
      const end = plugin.id.includes("carelon") ? "20261031" : "20260930";
      const row = { coverageEnd: end, memberType: "SUB" };
      expect(plugin.encodeRow(row, context())).toContain(end);
      expect(carrierLayoutCsv(plugin, [row], context())).toContain(end);
    }
  });
  it("generates from the selected snapshot, persists truthful counts and invalidates on new parameters", async () => {
    const ctx = context(false, true);
    const selected = {
      configId: ctx.configId, pluginId: "sitespecific-smf-delta", name: "Fixture",
      providerId: null, sftpClientId: null, data: structuredClone(ctx.configData),
    };
    const persisted: Record<string, unknown>[] = [];
    const runContext = {
      wizardId: "fixture", wizard: { data: { config: selected, input: ctx.input } },
      storage: { ...ctx.storage, wizards: {
        mergeData: vi.fn(async () => ({ id: "fixture" })),
        deleteReportData: vi.fn(),
        saveReportData: async (_id: string, _pk: string, row: Record<string, unknown>) => { persisted.push(row); },
      } },
      reportProgress: vi.fn(), input: { asOfDate: "2026-12-01" },
    } as any;
    ctx.configData.explicitSubscriberTerminations = true; // edited live configuration
    ctx.configData.explicitDependentTerminations = false;
    const step = trustProviderEdiWizardPlugin.steps.find(s => s.id === "run")!;
    const result = await step.run!(runContext);
    expect(persisted).toHaveLength(3);
    expect(persisted.filter(r => r.terminationRole).map(r => r.terminationRole)).toEqual(["dependent"]);
    expect(result?.data?.reportMeta).toMatchObject({
      recordCount: 3, terminationCounts: { subscribers: 0, dependents: 1, inferred: 1 },
    });
    const params = trustProviderEdiWizardPlugin.steps.find(s => s.id === "params")!;
    expect(await params.submit!(runContext)).toMatchObject({ data: { reportMeta: null, delivery: null } });
  });
});

describe("wizard-owned settings and legacy editing", () => {
  const params = trustProviderEdiWizardPlugin.steps.find(s => s.id === "params")!;
  const config = trustProviderEdiWizardPlugin.steps.find(s => s.id === "config")!;
  const run = trustProviderEdiWizardPlugin.steps.find(s => s.id === "run")!;
  function wizard(data: any = {}) {
    return { id: "fixture", type: "trust_provider_edi", data: {
      config: { configId: "old", pluginId: "sitespecific-smf-delta", data: {} },
      input: { asOfDate: "2026-11-01", mode: "T" }, ...data,
    } } as any;
  }
  const policy = (sub = false, dep = true, months = 3) => ({
    explicitSubscriberTerminations: sub, explicitDependentTerminations: dep, terminationLookbackMonths: months,
  });
  it("creates durable defaults, never using live carrier settings", async () => {
    const result = await trustProviderEdiWizardPlugin.create!({
      input: { type: "trust_provider_edi", data: { terminationPolicy: policy(false, true, 9) } },
      storage: { wizards: { create: async (value: any) => value } }, req: {},
    } as any);
    const created = result.wizard!;
    expect((created.data as any).terminationPolicy).toEqual(policy(true, false, 1));
    const selected = await config.submit!({
      wizard: created, input: { configId: "new" },
      storage: { pluginConfigs: { getWithSubsidiary: async () => ({
        config: { id: "new", pluginKind: "trust-provider-edi", enabled: true,
          pluginId: "sitespecific-smf-delta", data: policy(false, true, 9) },
      }) } },
    } as any);
    expect(selected.data?.terminationPolicy).toEqual(policy(true, false, 1));
  });
  it.each([policy(false, false, 1), policy(true, false, 2), policy(false, true, 3), policy(true, true, 12)])(
    "restores saved choices %j across JSON reload, retry and schema defaults", async choices => {
      const w = wizard({ terminationPolicy: choices,
        config: { configId: "old", pluginId: "sitespecific-smf-delta", data: policy(true, true, 9) },
        progress: { run: { status: "failed", error: "Old failure" } },
        reportMeta: { recordCount: 7 }, delivery: { deliveredAt: "old" },
      });
      const seed = params.getFormData!(JSON.parse(JSON.stringify(w)));
      expect(seed).toEqual({ asOfDate: "2026-11-01", mode: "T", ...choices });
      expect(run.getRunBlocker!(w)).toBeUndefined();
      const saved = await params.submit!({ wizard: w, input: seed } as any);
      Object.assign(w.data, saved.data);
      expect(w.data).toMatchObject({
        terminationPolicy: choices, reportMeta: null, delivery: null,
        previousGeneration: { error: "Old failure" }, progress: { run: null },
      });
      expect(run.getState!(w)).toBe("pending");
      expect(params.getFormData!(JSON.parse(JSON.stringify(w)))).toEqual(seed);
      const empty: any = {};
      expect(validateAgainstSchema(params.getSchema!(w)!, empty).valid).toBe(true);
      expect(empty).toMatchObject(choices);
    },
  );
  it("shows and adopts legacy snapshot choices, not new defaults", async () => {
    for (const legacy of [{}, policy(false, true, 4)]) {
      const w = wizard({ config: { configId: "old", pluginId: "sitespecific-smf-delta", data: legacy } });
      const expected = Object.keys(legacy).length ? legacy : policy(false, false, 1);
      const seed = params.getFormData!(w);
      expect(seed).toMatchObject(expected);
      expect((await params.submit!({ wizard: w, input: seed } as any)).data?.terminationPolicy).toEqual(expected);
      expect(w.data.terminationPolicy).toBeUndefined(); // reads/unsaved edits cannot mutate old runs
    }
  });
  it("retains legacy policy on carrier reselection and rechecks Carelon before run", async () => {
    const w = wizard({ config: { configId: "old", pluginId: "sitespecific-smf-delta", data: policy(false, true, 4) } });
    const selected = await config.submit!({
      wizard: w, input: { configId: "carelon" }, storage: { pluginConfigs: {
        getWithSubsidiary: async () => ({ config: { id: "carelon", enabled: true,
          pluginKind: "trust-provider-edi", pluginId: "sitespecific-smf-carelon", data: policy(true, false, 1) } }),
      } },
    } as any);
    Object.assign(w.data, selected.data);
    expect(w.data.terminationPolicy).toEqual(policy(false, true, 4));
    expect(run.getRunBlocker!(w)).toMatch(/Save Parameters/);
    const saved = await params.submit!({ wizard: w, input: params.getFormData!(w) } as any);
    Object.assign(w.data, saved.data);
    expect(params.getSchema!(w)?.description).toMatch(/Carelon MSTACD/);
    expect(run.getRunBlocker!(w)).toMatch(/Carelon MSTACD/);
    await expect(run.run!({ wizard: w } as any)).rejects.toThrow(/Carelon MSTACD/);
    Object.assign(w.data, (await params.submit!({ wizard: w, input: policy(false, false, 1) } as any)).data);
    expect(run.getRunBlocker!(w)).toBeUndefined();
  });
  it("rejects parameter changes while generating and rejects invalid lookbacks", () => {
    expect(() => params.submit!({ wizard: wizard({ progress: { run: { status: "in_progress" } } }), input: policy() } as any)).toThrow(/Generation is active/);
    for (const months of [0, 13, 1.5, "2", null]) {
      expect(() => params.submit!({ wizard: wizard(), input: { ...policy(), terminationLookbackMonths: months } } as any)).toThrow();
    }
  });
});
