import { afterEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import {
  ADULT_ENROLLMENT_RELATIONSHIPS, CHILD_ENROLLMENT_RELATIONSHIPS,
  evaluateEnrollmentDependentAge as evaluate, classifyEnrollmentRelationship,
} from "@shared/utils/enrollment-dependent-age";
import { lookupDependent } from "../../server/plugins/wizards/enrollment/foundation";
import { benefitElectionEnrollmentPlugin } from "../../server/plugins/wizards/plugins/benefit-election-enrollment";
import { openEnrollmentEnrollmentPlugin } from "../../server/plugins/wizards/plugins/open-enrollment-enrollment";
import { lifeEventEnrollmentPlugin } from "../../server/plugins/wizards/plugins/life-event-enrollment";

const options = vi.hoisted(() => new Map<string, { id: string; name: string }>());
vi.mock("../../server/plugins/wizards/attachments", () => ({
  listWizardAttachments: async () => [{ id: "doc" }],
}));
// These pre-existing cases exercise the original staff-assisted add flow.
vi.mock("../../server/services/access-policy-evaluator", () => ({
  checkAccessInline: async () => ({ granted: true }),
}));
vi.mock("../../server/storage/unified-options", () => ({
  createUnifiedOptionsStorage: () => ({
    get: async (type: string, id: string) => type === "worker-relation-type" ? options.get(id) : undefined,
  }),
}));

const plugins = [benefitElectionEnrollmentPlugin, openEnrollmentEnrollmentPlugin, lifeEventEnrollmentPlugin];
const names = [...CHILD_ENROLLMENT_RELATIONSHIPS, ...ADULT_ENROLLMENT_RELATIONSHIPS, "Unknown configured type"];
names.forEach((name, i) => options.set(`configured-${i}`, { id: `configured-${i}`, name }));
afterEach(() => vi.useRealTimers());

describe("calendar-day enrollment dependent age policy", () => {
  it.each([
    ["2025-06-14", false, false], ["2025-06-15", true, false],
    ["2026-06-14", true, false], ["2026-06-15", false, true],
    ["2030-06-15", false, true],
  ])("evaluates 2000-06-15 on %s", (today, warned, refused) => {
    const result = evaluate("2000-06-15", "Parent", today);
    expect(!!result.warning).toBe(warned);
    expect(!!result.error).toBe(refused);
    expect(result.adultOnly).toBe(refused);
    if (warned) expect(result.warning).toContain("June 15, 2026");
  });
  it.each(CHILD_ENROLLMENT_RELATIONSHIPS)("warns and then blocks %s, including handicapped child", name => {
    expect(classifyEnrollmentRelationship(name)).toBe("child");
    expect(evaluate("2000-06-15", name, "2025-06-15").warning).toBeTruthy();
    expect(evaluate("2000-06-15", name, "2026-06-15").error).toContain("26 or older");
    expect(evaluate("2000-06-15", name, "2025-06-14").warning).toBeNull();
  });
  it.each(ADULT_ENROLLMENT_RELATIONSHIPS)("permits %s without warning at any age", name => {
    for (const birthDate of ["2002-01-01", "2001-01-01", "2000-01-01", "1950-01-01"]) {
      expect(evaluate(birthDate, name, "2026-01-01")).toMatchObject({ error: null, warning: null });
    }
  });
  it.each(["", undefined, null, 20000101, "2000-2-03", "2000-02-30", "1900-02-29",
    "0000-01-01", "2000-00-01", "2000-13-01", "2000-01-00", "2000-04-31", "2027-01-01",
    "2000-01-01T00:00:00Z"])("rejects invalid/future DOB %s", dob => {
    expect(evaluate(dob, "Spouse", "2026-01-01").error).toBeTruthy();
  });
  it("uses March 1 for Feb 29 in non-leap years and respects leap centuries", () => {
    expect(evaluate("2000-02-29", "Parent", "2025-02-28").warning).toBeNull();
    expect(evaluate("2000-02-29", "Parent", "2025-03-01").warning).toContain("March 1, 2026");
    expect(evaluate("2000-02-29", "Parent", "2026-02-28").error).toBeNull();
    expect(evaluate("2000-02-29", "Parent", "2026-03-01").error).toBeTruthy();
    expect(evaluate("2004-02-29", "Parent", "2030-02-28").error).toBeNull();
    expect(evaluate("2000-02-29", "Parent", "2024-02-29").error).toBeNull();
    expect(evaluate("2100-02-29", "Spouse", "2101-01-01").error).toBeTruthy();
  });
  it("uses the process's application date at timezone midnight, not the UTC date", () => {
    const script = `import {getTodayYmd} from './shared/utils/date.ts';
      const NativeDate = Date;
      globalThis.Date = class extends NativeDate { constructor() { super('2026-06-15T00:30:00Z'); } };
      console.log(getTodayYmd());`;
    const run = (zone: string) => execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], {
      env: { ...process.env, TZ: zone }, encoding: "utf8",
    }).trim();
    expect(evaluate("2000-06-15", "Parent", run("America/Los_Angeles")).error).toBeNull();
    expect(evaluate("2000-06-15", "Parent", run("Asia/Tokyo")).error).toBeTruthy();
  });
});

function fixture(matched = false, birthDate = "2000-06-15") {
  const worker = { id: "dependent", contactId: "contact" };
  const storage: any = {
    workers: {
      getWorkerBySSN: vi.fn(async () => matched ? worker : undefined),
      getWorker: vi.fn(async () => worker),
      createWorker: vi.fn(async () => worker), updateWorkerSSN: vi.fn(),
      updateWorkerContactBirthDate: vi.fn(), updateWorkerContactGender: vi.fn(),
    },
    contacts: { getContact: vi.fn(async () => ({ birthDate, displayName: "Fictional Dependent" })) },
    workerRelations: { searchWorkerRelations: vi.fn(async () => []), create: vi.fn(async () => ({ id: "relation" })), delete: vi.fn() },
    workerTrustElections: { checkDualCoverage: vi.fn(async () => []), getViewById: vi.fn(async () => undefined) },
  };
  const ctx: any = { storage, wizardId: "wizard", wizard: { status: "draft", data: {
    workerId: "subscriber", eventType: "birth", dependents: [], pendingDocument: { fileId: "doc", fileName: "birth.pdf" },
  } }, input: { action: "add", ssn: "123-45-6789", birthDate, given: "Fictional", family: "Dependent",
    relationTypeId: "configured-0", gender: "gender", documentFileId: "doc" } };
  const assertNoWrites = () => {
    for (const key of ["createWorker", "updateWorkerSSN", "updateWorkerContactBirthDate", "updateWorkerContactGender"]) {
      expect(storage.workers[key]).not.toHaveBeenCalled();
    }
    expect(storage.workerRelations.create).not.toHaveBeenCalled();
    expect(ctx.wizard.data.dependents).toEqual([]);
    expect(ctx.wizard.data.pendingDocument).toEqual({ fileId: "doc", fileName: "birth.pdf" });
  };
  return { ctx, storage, assertNoWrites };
}

describe.each(plugins)("authoritative dependent add: $id", plugin => {
  const step = plugin.steps.find(step => step.id === "dependents")!;
  it.each([false, true])("refuses all disallowed and forged options before mutations (matched=%s)", async matched => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 5, 15, 12));
    for (const relationTypeId of ["configured-0", "configured-1", "configured-2", "configured-3", "configured-4",
      "configured-10", "forged-spouse", "", undefined]) {
      const { ctx, assertNoWrites } = fixture(matched);
      ctx.input = { ...ctx.input, relationTypeId, name: "Spouse", classification: "adult" };
      await expect(step.submit!(ctx)).rejects.toThrow();
      assertNoWrites();
    }
  });
  it.each([false, true])("permits each adult option at the cutoff (matched=%s)", async matched => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 5, 15, 12));
    for (let i = 5; i < 10; i++) {
      const { ctx, storage } = fixture(matched);
      ctx.input.relationTypeId = `configured-${i}`;
      const result = await step.submit!(ctx);
      expect(result.data?.dependents).toHaveLength(1);
      expect(storage.workers.createWorker).toHaveBeenCalledTimes(matched ? 0 : 1);
      expect(storage.workerRelations.create).toHaveBeenCalledWith(expect.objectContaining({
        worker1: "subscriber", worker2: "dependent", relationType: `configured-${i}`,
      }));
    }
  });
  it("permits all child options during the warning period, and under 25", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 5, 14, 12));
    for (let i = 0; i < 5; i++) {
      for (const dob of ["2000-06-15", "2002-06-15"]) {
        const { ctx } = fixture(false, dob);
        ctx.input.relationTypeId = `configured-${i}`;
        expect((await step.submit!(ctx)).data?.dependents).toHaveLength(1);
      }
    }
  });
  it("rechecks DOB after lookup; rejects missing, impossible and future DOBs without writes", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 5, 15, 12));
    for (const birthDate of ["2000-06-16", "2000-02-30", "2030-01-01", "", undefined]) {
      const { ctx, assertNoWrites } = fixture(true);
      ctx.wizard.data.dependentLookup = { status: "matched", workerId: "dependent" };
      ctx.input.birthDate = birthDate;
      ctx.input.relationTypeId = "configured-9";
      await expect(step.submit!(ctx)).rejects.toThrow();
      assertNoWrites();
    }
    const { ctx, storage } = fixture();
    await expect(lookupDependent(storage, ctx.input.ssn, "2000-02-30")).rejects.toThrow("real date");
    expect(storage.workers.getWorkerBySSN).not.toHaveBeenCalled();
  });
  it("preserves documents, duplicate detection, reuse and removal ownership", async () => {
    const { ctx, storage } = fixture(true, "2010-06-15");
    delete ctx.input.documentFileId;
    await expect(step.submit!(ctx)).rejects.toThrow("supporting document");
    ctx.input.documentFileId = "doc";
    ctx.wizard.data.dependents = [{ workerId: "dependent" }];
    await expect(step.submit!(ctx)).rejects.toThrow("already been added");
    ctx.wizard.data.dependents = [];
    storage.workerRelations.searchWorkerRelations.mockResolvedValue([{ id: "existing",
      worker1: "subscriber", worker2: "dependent", relationType: ctx.input.relationTypeId }]);
    const result = await step.submit!(ctx);
    expect(storage.workerRelations.create).not.toHaveBeenCalled();
    expect(result.data?.dependents).toMatchObject([{ createdByWizard: false, relationId: "existing" }]);
    ctx.wizard.data = { ...ctx.wizard.data, ...result.data };
    ctx.input = { action: "remove", relationId: "existing" };
    expect((await step.submit!(ctx)).data?.dependents).toEqual([]);
    expect(storage.workerRelations.delete).not.toHaveBeenCalled();
    ctx.wizard.data.dependents[0].createdByWizard = true;
    await step.submit!(ctx);
    expect(storage.workerRelations.delete).toHaveBeenCalledWith("existing");
  });
});
