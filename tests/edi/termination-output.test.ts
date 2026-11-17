import { beforeEach, describe, expect, it, vi } from "vitest";
import { parse } from "csv-parse/sync";

const fixture = vi.hoisted(() => ({
  units: [] as any[], events: [] as any[], coverage: [] as any[], relations: [] as any[], contexts: [] as any[],
}));
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
vi.mock("../../server/plugins/trust/provider-edi/termination-population", async importOriginal => {
  const actual = await importOriginal<typeof import("../../server/plugins/trust/provider-edi/termination-population")>();
  return { ...actual, loadTerminationCandidates: async (ctx: TrustProviderEdiContext) =>
    actual.selectTerminationCandidates(fixture.events, fixture.coverage, fixture.relations,
      new Set(), String(ctx.input.asOfDate), ctx.terminationPolicy ?? readTerminationPolicy(ctx.configData)),
  };
});
import { registeredEdiPlugins, requireEdiPlugin } from "./fixtures/harness";
import { assembleEdiFileLines } from "../../server/plugins/trust/provider-edi/base";
import { carrierLayoutCsv } from "../../server/plugins/trust/provider-edi/carrier-csv";
import { validateAgainstSchema } from "../../server/lib/json-schema-validator";
import { readTerminationPolicy } from "../../server/plugins/trust/provider-edi/termination-policy";
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
    dependents: [{ ...person, ssn: "009876543", relationId: "relation", relationSiriusId: "SP" }],
  }));
  fixture.events = ["history", "child"].map(workerId => ({
    id: workerId, benefitId: "benefit", workerId, year: 2026, month: 11,
    data: { provenance: "coverage_inferred" },
  }));
  fixture.coverage = [
    ...Array.from({ length: 10 }, (_, i) => ({ workerId: "history", month: i + 1, sourceRelationId: null })),
    ...[9, 10].map(month => ({ workerId: "child", month, sourceRelationId: "relation" })),
  ].map(r => ({
    ...r, id: r.workerId === "history" && r.month === 10 ? "history" : `${r.workerId}-${r.month}`,
    benefitId: "benefit", year: 2026, employerId: "COBRA",
  }));
  fixture.relations = [{
    id: "relation", worker1: "history", worker2: "child", startYmd: "2020-01-01", endYmd: "2026-10-31",
  }];
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
  for (const plugin of registeredEdiPlugins().filter(p => p.benefitSiriusIds?.length)) {
    it.each([
      [false, false, false], [true, false, false], [false, true, false], [true, true, false],
      [false, false, true], [true, false, true], [false, true, true], [true, true, true],
    ])(
      `${plugin.id}: selected term roles (%s/%s), COBRA %s`, async (subs, deps, cobra) => {
        fixture.units.find(u => u.wmb.id === "history").isCobra = cobra;
        const ctx = context(subs, deps);
        const baseline = await plugin.processBatch(["active"], context());
        const historical = await plugin.processBatch(["history"], {
          ...context(), input: { asOfDate: "2026-10-31" },
        });
        const params = trustProviderEdiWizardPlugin.steps.find(s => s.id === "params")!;
        const run = trustProviderEdiWizardPlugin.steps.find(s => s.id === "run")!;
        const w = { data: {
          config: { configId: "fixture", pluginId: plugin.id, data: {} },
          input: ctx.input, terminationPolicy: {
            explicitSubscriberTerminations: subs, explicitDependentTerminations: deps, terminationLookbackMonths: 1,
          },
        } } as any;
        expect(run.getRunBlocker!(w)).toBeUndefined();
        expect(params.getSchema!(w)?.description).not.toMatch(/blocked|MSTACD/);
        const keys = await plugin.getPrimaryKeys!(ctx);
        // Split across separate batches to exercise stable keys.
        const rows = (await Promise.all(keys.map(key => plugin.processBatch([key], ctx)))).flat();
        expect(baseline).toHaveLength(2);
        expect(rows.filter(r => !r.terminationRole)).toEqual(baseline);
        const terms = rows.filter(r => r.terminationRole);
        expect(terms).toHaveLength(Number(subs) + Number(deps));
        expect(terms.map(r => r.terminationRole).sort()).toEqual([
          ...(deps ? ["dependent"] : []), ...(subs ? ["subscriber"] : []),
        ]);
        for (const row of terms) {
          expect(row.coverageEnd).toBe("20261031");
          expect(row.coverageStart).toBe(row.terminationRole === "dependent" ? "20260901" : "20260101");
          expect(plugin.encodeRow(row, ctx)).toContain("20261031");
          // All status, demographic, layout and COBRA values come from the
          // existing encoder unchanged; only lifecycle dates/key/evidence differ.
          const original = historical.find(r => r.pk === (row.terminationRole === "subscriber" ? "history" : "history:relation"))!;
          expect(row).toEqual({
            ...original, pk: row.pk, coverageStart: row.coverageStart, coverageEnd: "20261031",
            terminationRole: row.terminationRole, terminationEnd: "2026-10-31", terminationEvidence: "coverage inferred",
          });
        }
        expect(new Set(rows.map(r => r.pk)).size).toBe(rows.length);
        if (terms.length) expect(fixture.contexts.some(c => c.input.asOfDate === "2026-10-31")).toBe(true);
        const qa = parse(carrierLayoutCsv(plugin, rows, ctx), { relax_column_count: true }) as string[][];
        const native = assembleEdiFileLines(plugin, rows, ctx);
        const records = qa.filter(r => r[0].startsWith("QA-only record kind:"));
        expect(records).toHaveLength(native.length);
        records.forEach((record, i) => {
          if (plugin.outputFormat === "csv") expect(record.slice(1)).toEqual(parse(native[i])[0] ?? []);
          else expect(record.slice(1).join("")).toBe(native[i]);
        });
        const fields = plugin.csvFields ?? plugin.ediFields;
        const endIndex = fields.findIndex(f => /^(Eligibility Termination Date|term_date|TERM DT|GRPEXP|TerminationDate|Vision Coverage End Date|Termination Date|Coverage End Date|Participant Expiration Date)$/.test(f.name));
        expect(endIndex).toBeGreaterThanOrEqual(0);
        const details = qa.filter(r => r[0] === "QA-only record kind: detail");
        expect(details.map(r => r[endIndex + 1].trim())).toEqual(rows.map(r => String(r.coverageEnd ?? "")));
        if (plugin.id.endsWith("-delta")) expect(native.at(-1)?.slice(2, 9).trim()).toBe(String(rows.length + 2));
      },
    );
  }
  it("keeps missing settings equivalent to false for saved runs", async () => {
    const plugin = requireEdiPlugin("sitespecific-smf-delta");
    const ctx = context();
    const before = await plugin.processBatch(["active"], ctx);
    ctx.configData = {};
    expect(await plugin.processBatch(["active"], ctx)).toEqual(before);
  });
  it.each([
    [false, false], [true, false], [false, true], [true, true],
  ])("keeps the ESI QMSCO feed split for both ended roles (%s/%s)", async (subs, deps) => {
    const plugin = requireEdiPlugin("sitespecific-smf-expressscripts");
    for (const qmsco of ["include", "exclude"]) {
      fixture.units.forEach(u => { u.dependents[0].relationSiriusId = "QMSCO"; });
      const ctx = context(subs, deps);
      ctx.input.qmsco = qmsco;
      const baseline = await plugin.processBatch(["active"], { ...ctx, configData: {} });
      const rows = await plugin.processBatch(await plugin.getPrimaryKeys!(ctx), ctx);
      expect(rows.filter(r => !r.terminationRole)).toEqual(baseline);
      const terms = rows.filter(r => r.terminationRole);
      expect(terms.map(r => r.terminationRole)).toEqual(
        qmsco === "include" ? (deps ? ["dependent"] : []) : (subs ? ["subscriber"] : []),
      );
      for (const row of terms) {
        expect(row.coverageEnd).toBe("20261031");
        expect(row.memberLevelAddressType).toBe(qmsco === "include" ? "C" : "");
        expect(row.contractType).toBe("CB");
      }
    }
  });
  it("still refuses a missing historical row that the carrier did not intentionally exclude", async () => {
    fixture.units = fixture.units.filter(u => u.wmb.id !== "history");
    const plugin = requireEdiPlugin("sitespecific-smf-carelon");
    const ctx = context(true, true);
    const keys = await plugin.getPrimaryKeys!(ctx);
    await expect(plugin.processBatch(keys, ctx)).rejects.toThrow(/could not be reconstructed/);
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
  it("retains legacy policy on carrier reselection and admits Carelon after Parameters save", async () => {
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
    expect(params.getSchema!(w)?.description).toMatch(/Generation does not establish carrier acceptance/);
    expect(params.getFormData!(w)).toMatchObject(policy(false, true, 4));
    expect(run.getRunBlocker!(w)).toBeUndefined();
  });
  it("rejects parameter changes while generating and rejects invalid lookbacks", () => {
    expect(() => params.submit!({ wizard: wizard({ progress: { run: { status: "in_progress" } } }), input: policy() } as any)).toThrow(/Generation is active/);
    for (const months of [0, 13, 1.5, "2", null]) {
      expect(() => params.submit!({ wizard: wizard(), input: { ...policy(), terminationLookbackMonths: months } } as any)).toThrow();
    }
  });
});
