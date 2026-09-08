import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import express, { type Request } from "express";
import { createHmac } from "node:crypto";
import { eventBus, EventType } from "../../server/services/event-bus";
import { assignmentForbidden } from "../../server/storage/sitespecific/bao/case-assignment";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../../server/db";
import { storage } from "../../server/storage";
import { getOptionsStorage, getOptionsType } from "../../server/modules/options-registry";
import { getComponentById } from "@shared/components";
import {
  entityNotes,
  comm,
  commPostal,
  files,
  optionsBaoAppealDenialReason,
  optionsBaoCaseResolution,
  optionsBaoCaseStatus,
  optionsBaoCaseType,
  rolePermissions,
  roles,
  sitespecificBaoAppealDetails,
  sitespecificBaoCaseDocuments,
  sitespecificBaoCaseComms,
  sitespecificBaoCases,
  trustBenefits,
  userRoles,
  users,
} from "@shared/schema";
import { ensureBaoCaseSchema, getGeneralCaseTypeId } from "./fixtures/bao-schema";
import { approveBaoAppealRequestSchema, denyBaoAppealRequestSchema } from "@shared/schema";
import { canonicalAppealResolutionName } from "../../server/storage/sitespecific/bao/cases";
import { createCommPostalStorage } from "../../server/storage/comm";
import { registerCommRoutes } from "../../server/modules/comm";
import {
  buildOptionUpdateData,
  checkOptionDeleteGuard,
  validateBaoCaseStatusWrite,
} from "../../server/modules/options-write-rules";
import { cleanupBaoRouteOpenStatuses } from "../../scripts/s1-migration/cleanup-bao-route-open-statuses";
import { runOptionsImport } from "../../server/modules/options-transfer";
import { formDataToPayload } from "../../client/src/components/shared/options-form-payload";

const run = `bao-case-test-${Date.now()}`;
let available = false;
let workerId = "";
let otherWorkerId = "";
let userId = "";
let secondUserId = "";
let secondRoleId = "";
let noteTypeId = "";
let openStatusId = "";
let closedStatusId = "";
let resolutionId = "";
const caseIds: string[] = [];
const noteIds: string[] = [];

beforeAll(async () => {
  // Component migrations are the supported schema path. Provision the focused
  // BAO case tables rather than silently dropping coverage on a non-BAO DB.
  await ensureBaoCaseSchema();
  available = await storage.baoCases.tableExists();
  if (!available) throw new Error("BAO case migration did not create its tables");
  const workers = await storage.workers.getAllWorkers();
  const assignees = await storage.users.getUsersWithAnyPermission(["staff", "admin"]);
  const noteTypes = await getOptionsStorage().list("note-type");
  const workerType = noteTypes.find((t: any) => t.data?.contextIds?.includes("worker"));
  if (workers.length < 2 || !assignees[0] || !workerType) {
    throw new Error("BAO case tests require two workers, one staff user, and a worker note type");
  }
  workerId = workers[0].id;
  otherWorkerId = workers[1].id;
  userId = assignees[0].id;
  noteTypeId = workerType.id;
  const options = getOptionsStorage();
  const caseTypeId = await getGeneralCaseTypeId();
  openStatusId = (await options.create("bao-case-status", { name: `${run}-open`, closed: false, caseTypeId })).id;
  closedStatusId = (await options.create("bao-case-status", {
    name: `${run}-closed`,
    closed: true,
    caseTypeId,
    requiresOutreachNote: true,
  })).id;
  resolutionId = (await options.create("bao-case-resolution", { name: `${run}-resolved` })).id;
  // A second assignable staff user, created for the assignment-race coverage.
  const secondUser = await storage.users.createUser({
    email: `${run}@example.test`,
    firstName: "Race",
    lastName: "Tester",
  } as any);
  secondUserId = secondUser.id;
  const role = await storage.users.createRole({
    name: `${run}-staff`,
    description: "BAO case test staff role",
  } as any);
  secondRoleId = role.id;
  // Insert the role permission directly: the in-process permission registry
  // is not initialized in this test harness, only the DB rows matter here.
  await db.insert(rolePermissions).values({ roleId: role.id, permissionKey: "staff" });
  await storage.users.assignRoleToUser({ userId: secondUser.id, roleId: role.id } as any);
});

afterAll(async () => {
  if (!available) return;
  for (const id of caseIds) await db.delete(sitespecificBaoCases).where(eq(sitespecificBaoCases.id, id));
  for (const id of noteIds) await db.delete(entityNotes).where(eq(entityNotes.id, id));
  const options = getOptionsStorage();
  await options.delete("bao-case-status", openStatusId).catch(() => {});
  await options.delete("bao-case-status", closedStatusId).catch(() => {});
  await options.delete("bao-case-resolution", resolutionId).catch(() => {});
  if (secondRoleId) {
    await db.delete(userRoles).where(eq(userRoles.roleId, secondRoleId)).catch(() => {});
    await db.delete(rolePermissions).where(eq(rolePermissions.roleId, secondRoleId)).catch(() => {});
    await db.delete(roles).where(eq(roles.id, secondRoleId)).catch(() => {});
  }
  if (secondUserId) await db.delete(users).where(eq(users.id, secondUserId)).catch(() => {});
});

describe("BAO case registration and component ownership", () => {
  it("registers component-gated status and resolution lists", () => {
    expect(getOptionsType("bao-case-status")?.requiredComponent).toBe("sitespecific.bao");
    expect(getOptionsType("bao-case-resolution")?.requiredComponent).toBe("sitespecific.bao");
  });

  it("exposes typed deadline administration fields", () => {
    const definition = getOptionsStorage().getDefinition("bao-case-status");
    const duration = definition?.fields.find((field) => field.name === "durationDays");
    const lapse = definition?.fields.find((field) => field.name === "lapseStatusId");
    expect(duration).toMatchObject({
      label: "Duration (days)",
      inputType: "number",
      min: 1,
      showInTable: true,
    });
    expect(lapse).toMatchObject({
      inputType: "select-options",
      selectOptionsType: "bao-case-status",
      selectOptionsMatchField: "caseTypeId",
      selectOptionsExcludeEditing: true,
      selectOptionsRequireClosedDefault: true,
    });
    expect((definition?.schema.properties?.lapseStatusId as any)?.["x-options-match-field"]).toBe("caseTypeId");
  });

  it("rejects invalid durations and incompatible lapse targets", async () => {
    const options = getOptionsStorage();
    const generalTypeId = await getGeneralCaseTypeId();
    const [appealType] = await db.select().from(optionsBaoCaseType)
      .where(eq(optionsBaoCaseType.workflowCode, "benefit_appeal")).limit(1);
    if (!appealType) throw new Error("Benefit Appeal case type is not configured");
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const sameType = await options.create("bao-case-status", {
      name: `${run}-lapse-same-${suffix}`,
      caseTypeId: generalTypeId,
      closed: false,
    });
    const otherType = await options.create("bao-case-status", {
      name: `${run}-lapse-other-${suffix}`,
      caseTypeId: appealType.id,
      closed: false,
    });
    const closedWithoutResolution = await options.create("bao-case-status", {
      name: `${run}-lapse-closed-${suffix}`,
      caseTypeId: generalTypeId,
      closed: true,
    });
    try {
      expect(await validateBaoCaseStatusWrite({ caseTypeId: generalTypeId, durationDays: 0 }))
        .toContain("positive whole number");
      expect(await validateBaoCaseStatusWrite(
        { lapseStatusId: sameType.id },
        sameType.id,
        sameType,
      )).toContain("cannot lapse to itself");
      expect(await validateBaoCaseStatusWrite({
        caseTypeId: generalTypeId,
        lapseStatusId: otherType.id,
      })).toContain("same case type");
      expect(await validateBaoCaseStatusWrite({
        caseTypeId: generalTypeId,
        lapseStatusId: closedWithoutResolution.id,
      })).toContain("default resolution");
      expect(await validateBaoCaseStatusWrite({
        caseTypeId: generalTypeId,
        lapseStatusId: sameType.id,
        durationDays: 12,
      })).toBeNull();
      expect(await validateBaoCaseStatusWrite(
        { caseTypeId: appealType.id },
        sameType.id,
        { ...sameType, lapseStatusId: closedWithoutResolution.id },
      )).toContain("same case type");
    } finally {
      await options.delete("bao-case-status", sameType.id).catch(() => {});
      await options.delete("bao-case-status", otherType.id).catch(() => {});
      await options.delete("bao-case-status", closedWithoutResolution.id).catch(() => {});
    }
  });

  it("protects lapse targets from ordinary deletion", async () => {
    const options = getOptionsStorage();
    const caseTypeId = await getGeneralCaseTypeId();
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const target = await options.create("bao-case-status", {
      name: `${run}-delete-target-${suffix}`, caseTypeId, closed: false,
    });
    const source = await options.create("bao-case-status", {
      name: `${run}-delete-source-${suffix}`, caseTypeId, closed: false, lapseStatusId: target.id,
    });
    try {
      const blocked = await checkOptionDeleteGuard("bao-case-status", target.id);
      expect(blocked).toMatchObject({ status: 409 });
      expect(blocked?.message).toContain("lapse destination");
      expect(await validateBaoCaseStatusWrite(
        { closed: true },
        target.id,
        target,
      )).toContain("cannot be closed without a default resolution");
      const [appealType] = await db.select().from(optionsBaoCaseType)
        .where(eq(optionsBaoCaseType.workflowCode, "benefit_appeal")).limit(1);
      if (!appealType) throw new Error("Benefit Appeal case type is not configured");
      expect(await validateBaoCaseStatusWrite(
        { caseTypeId: appealType.id },
        target.id,
        target,
      )).toContain("lapse destination cannot change");
    } finally {
      await options.update("bao-case-status", source.id, { lapseStatusId: null });
      await options.delete("bao-case-status", source.id);
      await options.delete("bao-case-status", target.id);
    }
  });

  it("persists cleared duration and lapse controls as null", async () => {
    const options = getOptionsStorage();
    const config = getOptionsType("bao-case-status");
    const definition = options.getDefinition("bao-case-status");
    if (!config || !definition) throw new Error("BAO case status options are not registered");
    const caseTypeId = await getGeneralCaseTypeId();
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const target = await options.create("bao-case-status", {
      name: `${run}-clear-target-${suffix}`,
      caseTypeId,
      closed: false,
    });
    const source = await options.create("bao-case-status", {
      name: `${run}-clear-source-${suffix}`,
      caseTypeId,
      closed: false,
      durationDays: 14,
      lapseStatusId: target.id,
    });
    try {
      const payload = formDataToPayload(
        { name: source.name, caseTypeId },
        definition.schema,
        {
          name: source.name,
          caseTypeId,
          durationDays: source.durationDays,
          lapseStatusId: source.lapseStatusId,
        },
      );
      const built = buildOptionUpdateData(config, payload);
      if ("error" in built) throw new Error(built.error);
      expect(built.updates).toMatchObject({
        durationDays: null,
        lapseStatusId: null,
      });
      await options.update("bao-case-status", source.id, built.updates);
      const persisted = await options.get("bao-case-status", source.id);
      expect(persisted).toMatchObject({
        durationDays: null,
        lapseStatusId: null,
      });
    } finally {
      await options.delete("bao-case-status", source.id).catch(() => {});
      await options.delete("bao-case-status", target.id).catch(() => {});
    }
  });

  it("prevents an in-use status from changing case type", async () => {
    const options = getOptionsStorage();
    const generalTypeId = await getGeneralCaseTypeId();
    const [appealType] = await db.select().from(optionsBaoCaseType)
      .where(eq(optionsBaoCaseType.workflowCode, "benefit_appeal")).limit(1);
    if (!appealType) throw new Error("Benefit Appeal case type is not configured");
    const status = await options.create("bao-case-status", {
      name: `${run}-in-use-type-${Date.now()}`,
      caseTypeId: generalTypeId,
      closed: false,
    });
    const [theCase] = await db.insert(sitespecificBaoCases).values({
      entityType: "worker",
      entityId: workerId,
      assigneeUserId: userId,
      statusId: status.id,
      caseTypeId: generalTypeId,
      deadlineYmd: "2099-09-08",
    }).returning();
    try {
      expect(await validateBaoCaseStatusWrite(
        { caseTypeId: appealType.id },
        status.id,
        status,
      )).toContain("in use cannot change case type");
    } finally {
      await db.delete(sitespecificBaoCases).where(eq(sitespecificBaoCases.id, theCase.id));
      await options.delete("bao-case-status", status.id);
    }
  });

  it("rejects incompatible lapse references created within one import", async () => {
    const generalTypeId = await getGeneralCaseTypeId();
    const [appealType] = await db.select().from(optionsBaoCaseType)
      .where(eq(optionsBaoCaseType.workflowCode, "benefit_appeal")).limit(1);
    if (!appealType) throw new Error("Benefit Appeal case type is not configured");
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const targetName = `${run}-import-target-${suffix}`;
    const config = getOptionsType("bao-case-status");
    if (!config) throw new Error("BAO case status options are not registered");
    const result = await runOptionsImport({
      type: "bao-case-status",
      config,
      dryRun: true,
      options: { create: true, update: false, delete: false },
      text: JSON.stringify({
        optionsType: "bao-case-status",
        records: [
          {
            name: `${run}-import-source-${suffix}`,
            caseTypeId: generalTypeId,
            lapseStatusId: { name: targetName },
          },
          {
            name: targetName,
            caseTypeId: appealType.id,
            closed: false,
          },
        ],
      }),
    });
    expect(result.applied).toBe(false);
    expect(result.errors.map((error) => error.message))
      .toContain("Lapse status must belong to the same case type");
  });

  it("transactionally cleans obsolete route-open statuses and is idempotent", async () => {
    const [appealType] = await db.select().from(optionsBaoCaseType)
      .where(eq(optionsBaoCaseType.workflowCode, "benefit_appeal")).limit(1);
    if (!appealType) throw new Error("Benefit Appeal case type is not configured");
    const [submitted] = await db.select().from(optionsBaoCaseStatus).where(and(
      eq(optionsBaoCaseStatus.caseTypeId, appealType.id),
      eq(optionsBaoCaseStatus.workflowStep, "submitted"),
    )).limit(1);
    if (!submitted) throw new Error("Benefit Appeal Submitted status is not configured");
    const marker = `bao-route-open-test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const [obsolete] = await db.insert(optionsBaoCaseStatus).values({
      name: marker,
      caseTypeId: appealType.id,
      closed: false,
    }).returning();
    const [inbound] = await db.insert(optionsBaoCaseStatus).values({
      name: `${run}-cleanup-inbound-${Date.now()}`,
      caseTypeId: appealType.id,
      closed: false,
      lapseStatusId: obsolete.id,
    }).returning();
    const [theCase] = await db.insert(sitespecificBaoCases).values({
      entityType: "worker",
      entityId: workerId,
      assigneeUserId: userId,
      statusId: obsolete.id,
      caseTypeId: appealType.id,
      deadlineYmd: "2099-09-08",
    }).returning();
    try {
      const first = await cleanupBaoRouteOpenStatuses(db, `${marker}%`);
      expect(first).toEqual({
        obsoleteStatuses: 1,
        movedCases: 1,
        clearedLapseReferences: 1,
        deletedStatuses: 1,
      });
      const [moved] = await db.select().from(sitespecificBaoCases)
        .where(eq(sitespecificBaoCases.id, theCase.id)).limit(1);
      const [cleared] = await db.select().from(optionsBaoCaseStatus)
        .where(eq(optionsBaoCaseStatus.id, inbound.id)).limit(1);
      expect(moved.statusId).toBe(submitted.id);
      expect(cleared.lapseStatusId).toBeNull();
      expect(await cleanupBaoRouteOpenStatuses(db, `${marker}%`)).toEqual({
        obsoleteStatuses: 0,
        movedCases: 0,
        clearedLapseReferences: 0,
        deletedStatuses: 0,
      });
    } finally {
      await db.delete(sitespecificBaoCases).where(eq(sitespecificBaoCases.id, theCase.id));
      await db.delete(optionsBaoCaseStatus).where(eq(optionsBaoCaseStatus.id, inbound.id));
      await db.delete(optionsBaoCaseStatus).where(eq(optionsBaoCaseStatus.id, obsolete.id)).catch(() => {});
    }
  });

  it("refuses cleanup when an obsolete status has the wrong case type", async () => {
    const caseTypeId = await getGeneralCaseTypeId();
    const marker = `bao-route-open-wrong-type-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const [obsolete] = await db.insert(optionsBaoCaseStatus).values({
      name: marker,
      caseTypeId,
      closed: false,
    }).returning();
    try {
      await expect(cleanupBaoRouteOpenStatuses(db, `${marker}%`))
        .rejects.toThrow("unexpected case types");
      const [stillThere] = await db.select().from(optionsBaoCaseStatus)
        .where(eq(optionsBaoCaseStatus.id, obsolete.id)).limit(1);
      expect(stillThere?.id).toBe(obsolete.id);
    } finally {
      await db.delete(optionsBaoCaseStatus).where(eq(optionsBaoCaseStatus.id, obsolete.id));
    }
  });

  it("declares the assign-to-others permission on the BAO component", () => {
    const permissions = getComponentById("sitespecific.bao")?.permissions ?? [];
    expect(permissions.map((p) => p.key)).toContain("bao.case.assign");
  });

  it("declares all case tables in the component manifest", () => {
    const tables = getComponentById("sitespecific.bao")?.schemaManifest?.tables ?? [];
    expect(tables).toEqual(expect.arrayContaining([
      "options_bao_case_status",
      "options_bao_case_resolution",
      "sitespecific_bao_cases",
      "sitespecific_bao_case_notes",
    ]));
  });
});

describe("Benefit Appeal outcome request contract", () => {
  it("maps trustee decisions to their fixed business resolutions", () => {
    expect(canonicalAppealResolutionName("approved")).toBe("Appeal Granted");
    expect(canonicalAppealResolutionName("denied")).toBe("Appeal Denied");
  });

  it("keeps accepting legacy resolution overrides so the server can ignore them", () => {
    expect(approveBaoAppealRequestSchema.parse({
      eligibilityPlugins: ["hours"],
      startYmd: "2026-09-01",
      resolutionId: "wrong-resolution",
      resolutionYmd: "2026-09-08",
    }).resolutionId).toBe("wrong-resolution");
    expect(denyBaoAppealRequestSchema.parse({
      resolutionId: "wrong-resolution",
      resolutionYmd: "2026-09-08",
    }).resolutionId).toBe("wrong-resolution");
  });

  it("rejects malformed outcome dates", () => {
    expect(() => denyBaoAppealRequestSchema.parse({ resolutionYmd: "09/08/2026" })).toThrow();
  });

  it("persists the canonical resolution for both outcomes regardless of status defaults", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const [caseType] = await db.select().from(optionsBaoCaseType)
      .where(eq(optionsBaoCaseType.workflowCode, "benefit_appeal")).limit(1);
    if (!caseType) throw new Error("Benefit Appeal case type is not configured");
    const [wrongResolution] = await db.insert(optionsBaoCaseResolution).values({
      name: `${run}-wrong-${suffix}`,
    }).returning();
    const canonicalRows: Array<{ id: string; created: boolean }> = [];
    for (const name of ["Appeal Granted", "Appeal Denied"]) {
      const [existing] = await db.select({ id: optionsBaoCaseResolution.id })
        .from(optionsBaoCaseResolution).where(eq(optionsBaoCaseResolution.name, name)).limit(1);
      if (existing) canonicalRows.push({ id: existing.id, created: false });
      else {
        const [created] = await db.insert(optionsBaoCaseResolution).values({ name }).returning();
        canonicalRows.push({ id: created.id, created: true });
      }
    }
    const [trustee] = await db.select().from(optionsBaoCaseStatus)
      .where(and(eq(optionsBaoCaseStatus.caseTypeId, caseType.id), eq(optionsBaoCaseStatus.workflowStep, "trustee_review"))).limit(1);
    const [approved] = await db.select().from(optionsBaoCaseStatus)
      .where(and(eq(optionsBaoCaseStatus.caseTypeId, caseType.id), eq(optionsBaoCaseStatus.workflowStep, "approved"))).limit(1);
    const [denied] = await db.select().from(optionsBaoCaseStatus)
      .where(and(eq(optionsBaoCaseStatus.caseTypeId, caseType.id), eq(optionsBaoCaseStatus.workflowStep, "denied"))).limit(1);
    if (!trustee || !approved || !denied) throw new Error("Benefit Appeal outcome statuses are not configured");
    await db.update(optionsBaoCaseStatus)
      .set({ defaultResolutionId: wrongResolution.id, requiresOutreachNote: true })
      .where(inArray(optionsBaoCaseStatus.id, [approved.id, denied.id]));
    const [reason] = await db.insert(optionsBaoAppealDenialReason).values({ name: `${run}-reason-${suffix}` }).returning();
    const benefit = await storage.trustBenefits.createTrustBenefit({ name: `${run}-benefit-${suffix}` } as any);
    const createdCaseIds: string[] = [];
    const eventSpy = vi.spyOn(eventBus, "emit").mockResolvedValue(undefined as any);
    try {
      const makeCase = async () => {
        const [appeal] = await db.insert(sitespecificBaoCases).values({
          entityType: "worker",
          entityId: workerId,
          assigneeUserId: userId,
          statusId: trustee.id,
          caseTypeId: caseType.id,
          benefitId: benefit.id,
          deadlineYmd: "2099-09-01",
        }).returning();
        createdCaseIds.push(appeal.id);
        await db.insert(sitespecificBaoAppealDetails).values({
          caseId: appeal.id,
          denialReasonId: reason.id,
          data: { spdCitation: null },
        });
        return appeal;
      };
      const approval = await makeCase();
      const approvedResult = await storage.baoCases.recordAppealOutcome(approval.id, {
        outcome: "approved",
        actorUserId: userId,
        resolutionYmd: "2026-09-08",
        grantExemption: async () => ({ exemptionId: `test-exemption-${suffix}`, created: true }),
      });
      expect(approvedResult.case.statusId).toBe(approved.id);
      expect(approvedResult.case.resolutionId).toBe(canonicalRows[0].id);

      const denial = await makeCase();
      await db.update(optionsBaoCaseResolution)
        .set({ name: `${run}-temporarily-missing-denied-${suffix}` })
        .where(eq(optionsBaoCaseResolution.id, canonicalRows[1].id));
      try {
        await expect(storage.baoCases.recordAppealOutcome(denial.id, {
          outcome: "denied",
          actorUserId: userId,
          resolutionYmd: "2026-09-08",
        })).rejects.toThrow("OUTCOME_RESOLUTION_MISSING");
      } finally {
        await db.update(optionsBaoCaseResolution)
          .set({ name: "Appeal Denied" })
          .where(eq(optionsBaoCaseResolution.id, canonicalRows[1].id));
      }
      const deniedResult = await storage.baoCases.recordAppealOutcome(denial.id, {
        outcome: "denied",
        actorUserId: userId,
        resolutionYmd: "2026-09-08",
      });
      expect(deniedResult.case.statusId).toBe(denied.id);
      expect(deniedResult.case.resolutionId).toBe(canonicalRows[1].id);
    } finally {
      eventSpy.mockRestore();
      for (const id of createdCaseIds) await db.delete(sitespecificBaoCases).where(eq(sitespecificBaoCases.id, id));
      await storage.trustBenefits.deleteTrustBenefit(benefit.id).catch(() => {});
      await db.delete(optionsBaoAppealDenialReason).where(eq(optionsBaoAppealDenialReason.id, reason.id));
      await db.update(optionsBaoCaseStatus)
        .set({ defaultResolutionId: approved.defaultResolutionId, requiresOutreachNote: approved.requiresOutreachNote })
        .where(eq(optionsBaoCaseStatus.id, approved.id));
      await db.update(optionsBaoCaseStatus)
        .set({ defaultResolutionId: denied.defaultResolutionId, requiresOutreachNote: denied.requiresOutreachNote })
        .where(eq(optionsBaoCaseStatus.id, denied.id));
      await db.delete(optionsBaoCaseResolution).where(eq(optionsBaoCaseResolution.id, wrongResolution.id));
      for (const row of canonicalRows.filter((item) => item.created)) {
        await db.delete(optionsBaoCaseResolution).where(eq(optionsBaoCaseResolution.id, row.id));
      }
    }
  });
});

describe("BAO case assignment authority rule", () => {
  const actor = "actor-1";
  it("allows omitting an assignee and self-assignment without the permission", () => {
    expect(assignmentForbidden({ requestedAssigneeId: undefined, actorUserId: actor, existingAssigneeId: null, canAssignOthers: false })).toBe(false);
    expect(assignmentForbidden({ requestedAssigneeId: actor, actorUserId: actor, existingAssigneeId: null, canAssignOthers: false })).toBe(false);
    // Taking a case assigned to somebody else is always self-assignment.
    expect(assignmentForbidden({ requestedAssigneeId: actor, actorUserId: actor, existingAssigneeId: "other-1", canAssignOthers: false })).toBe(false);
  });

  it("allows a lifecycle edit that echoes the unchanged assignee", () => {
    expect(assignmentForbidden({ requestedAssigneeId: "other-1", actorUserId: actor, existingAssigneeId: "other-1", canAssignOthers: false })).toBe(false);
  });

  it("forbids assigning to another user without the permission, on create and update", () => {
    expect(assignmentForbidden({ requestedAssigneeId: "other-1", actorUserId: actor, existingAssigneeId: null, canAssignOthers: false })).toBe(true);
    expect(assignmentForbidden({ requestedAssigneeId: "other-2", actorUserId: actor, existingAssigneeId: "other-1", canAssignOthers: false })).toBe(true);
  });

  it("allows any assignee with the permission", () => {
    expect(assignmentForbidden({ requestedAssigneeId: "other-2", actorUserId: actor, existingAssigneeId: "other-1", canAssignOthers: true })).toBe(false);
  });

  it("enforces the rule inside the lifecycle transaction", async () => {
    const created = await storage.baoCases.create({
      entityType: "worker", entityId: workerId, deadlineYmd: "2099-08-01",
      statusId: openStatusId, assigneeUserId: secondUserId, actorUserId: userId,
      initialNote: { typeId: noteTypeId, subject: `${run} in-tx enforcement` },
    });
    caseIds.push(created.id);
    noteIds.push((await storage.baoCases.get(created.id, true))!.notes![0].id);
    // Unprivileged reassignment to another user is rejected by storage itself.
    await expect(storage.baoCases.updateLifecycle(
      created.id,
      { assigneeUserId: userId, deadlineYmd: "2099-08-02" },
      { actorUserId: secondUserId === userId ? "someone-else" : "third-user", canAssignOthers: false },
    )).rejects.toThrow("ASSIGN_OTHERS_FORBIDDEN");
    // Taking the case (assigning to the actor) needs no permission.
    await storage.baoCases.updateLifecycle(
      created.id,
      { assigneeUserId: userId },
      { actorUserId: userId, canAssignOthers: false },
    );
    expect((await storage.baoCases.get(created.id))?.assigneeUserId).toBe(userId);
  });

  it("re-checks authority against the row-locked assignee, so a stale unchanged-assignee echo cannot reassign", async () => {
    // Case assigned to the second user. An unprivileged actor echoes that
    // assignee (allowed: unchanged). Concurrently, a permitted user
    // reassigns the case to the actor while holding the row lock. When the
    // echo's transaction finally locks the row, its requested assignee is no
    // longer the current one — it must now be treated as a reassignment and
    // rejected, not written back.
    const created = await storage.baoCases.create({
      entityType: "worker", entityId: workerId, deadlineYmd: "2099-09-01",
      statusId: openStatusId, assigneeUserId: secondUserId, actorUserId: userId,
      initialNote: { typeId: noteTypeId, subject: `${run} stale echo race` },
    });
    caseIds.push(created.id);
    noteIds.push((await storage.baoCases.get(created.id, true))!.notes![0].id);

    let release!: () => void;
    let locked!: () => void;
    const releaseGate = new Promise<void>((resolve) => { release = resolve; });
    const lockedGate = new Promise<void>((resolve) => { locked = resolve; });
    const reassigner = db.transaction(async (tx) => {
      await tx.execute(sql`SELECT id FROM sitespecific_bao_cases WHERE id = ${created.id} FOR UPDATE`);
      locked();
      await releaseGate;
      await tx.execute(sql`UPDATE sitespecific_bao_cases SET assignee_user_id = ${userId} WHERE id = ${created.id}`);
    });
    await lockedGate;
    const staleEcho = storage.baoCases.updateLifecycle(
      created.id,
      { assigneeUserId: secondUserId, deadlineYmd: "2099-09-02" },
      { actorUserId: userId, canAssignOthers: false },
    );
    release();
    await reassigner;
    await expect(staleEcho).rejects.toThrow("ASSIGN_OTHERS_FORBIDDEN");
    expect((await storage.baoCases.get(created.id))?.assigneeUserId).toBe(userId);
  });
});

describe("BAO case status events", () => {
  afterEach(() => vi.restoreAllMocks());

  function statusEmits(spy: ReturnType<typeof vi.spyOn>) {
    return spy.mock.calls.filter(([type]: [unknown, ...unknown[]]) => type === EventType.BAO_CASE_STATUS_SAVED);
  }

  it("emits a committed snapshot on creation and on lifecycle updates", async () => {
    const spy = vi.spyOn(eventBus, "emit").mockResolvedValue(undefined as any);
    const created = await storage.baoCases.create({
      entityType: "worker", entityId: workerId, deadlineYmd: "2099-06-01",
      statusId: openStatusId, assigneeUserId: userId, actorUserId: userId,
      initialNote: { typeId: noteTypeId, subject: `${run} status events` },
    });
    caseIds.push(created.id);
    noteIds.push((await storage.baoCases.get(created.id, true))!.notes![0].id);
    let emits = statusEmits(spy);
    expect(emits).toHaveLength(1);
    expect(emits[0][1]).toMatchObject({
      caseId: created.id,
      operation: "created",
      previousStatusId: null,
      statusId: openStatusId,
      statusName: `${run}-open`,
      row: expect.objectContaining({ id: created.id, statusId: openStatusId }),
      // Assignment + actor identity, captured by the committed write: null
      // previous assignee on creation, and the creating actor.
      previousAssigneeUserId: null,
      assigneeUserId: userId,
      actorUserId: userId,
    });
    expect(typeof (emits[0][1] as any).assigneeName).toBe("string");

    spy.mockClear();
    await storage.baoCases.updateLifecycle(created.id, {
      statusId: closedStatusId, resolutionId, resolutionYmd: "2099-06-02",
    });
    emits = statusEmits(spy);
    expect(emits).toHaveLength(1);
    expect(emits[0][1]).toMatchObject({
      operation: "updated",
      previousStatusId: openStatusId,
      statusId: closedStatusId,
      statusName: `${run}-closed`,
    });

    // An unchanged-status edit still emits (the notifier filters it), but
    // must carry previous === current so a listener can tell no transition
    // happened.
    spy.mockClear();
    await storage.baoCases.updateLifecycle(created.id, {
      statusId: openStatusId, deadlineYmd: "2099-06-03",
    });
    await storage.baoCases.updateLifecycle(created.id, { deadlineYmd: "2099-06-04" });
    emits = statusEmits(spy);
    expect(emits).toHaveLength(2);
    expect(emits[1][1]).toMatchObject({
      previousStatusId: openStatusId,
      statusId: openStatusId,
    });
  });

  it("carries previous/current assignee and the acting user on a reassignment", async () => {
    const created = await storage.baoCases.create({
      entityType: "worker", entityId: workerId, deadlineYmd: "2099-08-01",
      statusId: openStatusId, assigneeUserId: userId, actorUserId: userId,
      initialNote: { typeId: noteTypeId, subject: `${run} reassignment event` },
    });
    caseIds.push(created.id);
    noteIds.push((await storage.baoCases.get(created.id, true))!.notes![0].id);
    const spy = vi.spyOn(eventBus, "emit").mockResolvedValue(undefined as any);
    // Assignment-only change: status untouched, assignee moves to secondUser.
    await storage.baoCases.updateLifecycle(
      created.id,
      { assigneeUserId: secondUserId },
      { actorUserId: userId, canAssignOthers: true },
    );
    const emits = statusEmits(spy);
    expect(emits).toHaveLength(1);
    expect(emits[0][1]).toMatchObject({
      operation: "updated",
      previousStatusId: openStatusId,
      statusId: openStatusId,
      previousAssigneeUserId: userId,
      assigneeUserId: secondUserId,
      assigneeName: "Race Tester",
      actorUserId: userId,
    });
  });

  it("does not emit for a rolled-back lifecycle write", async () => {
    const created = await storage.baoCases.create({
      entityType: "worker", entityId: workerId, deadlineYmd: "2099-07-01",
      statusId: openStatusId, assigneeUserId: userId, actorUserId: userId,
      initialNote: { typeId: noteTypeId, subject: `${run} rollback` },
    });
    caseIds.push(created.id);
    noteIds.push((await storage.baoCases.get(created.id, true))!.notes![0].id);
    const spy = vi.spyOn(eventBus, "emit").mockResolvedValue(undefined as any);
    await expect(storage.baoCases.updateLifecycle(created.id, { statusId: closedStatusId }))
      .rejects.toThrow("RESOLUTION_REQUIRED");
    expect(statusEmits(spy)).toHaveLength(0);
  });
});

describe("role-filtered staff recipient candidates", () => {
  it("returns only active staff/admin holders of the given role", async () => {
    const inRole = await storage.users.getUsersWithAnyPermissionInRole(secondRoleId, ["staff", "admin"]);
    expect(inRole.map((u) => u.id)).toEqual([secondUserId]);
    // Every returned candidate is active; users outside the role are excluded
    // even when they are staff (userId is staff but not in the test role).
    expect(inRole.every((u) => u.isActive)).toBe(true);
    expect(inRole.map((u) => u.id)).not.toContain(userId);
  });

  it("returns nobody for a role whose members lack staff/admin permissions", async () => {
    const bareRole = await storage.users.createRole({
      name: `${run}-bare`,
      description: "no permissions",
    } as any);
    try {
      await storage.users.assignRoleToUser({ userId: secondUserId, roleId: bareRole.id } as any);
      // secondUser holds staff through their OTHER role, so they still qualify
      // when filtered by the bare role (permission comes from any role)...
      const viaBare = await storage.users.getUsersWithAnyPermissionInRole(bareRole.id, ["staff", "admin"]);
      expect(viaBare.map((u) => u.id)).toEqual([secondUserId]);
      // ...but with the staff role membership removed, the bare role alone
      // does not make them eligible.
      await storage.users.unassignRoleFromUser(secondUserId, secondRoleId);
      const withoutStaff = await storage.users.getUsersWithAnyPermissionInRole(bareRole.id, ["staff", "admin"]);
      expect(withoutStaff).toEqual([]);
    } finally {
      await storage.users.assignRoleToUser({ userId: secondUserId, roleId: secondRoleId } as any).catch(() => {});
      await db.delete(userRoles).where(eq(userRoles.roleId, bareRole.id)).catch(() => {});
      await db.delete(roles).where(eq(roles.id, bareRole.id)).catch(() => {});
    }
  });

  it("resolves saved selections by id regardless of status or role", async () => {
    const found = await storage.users.getUsersByIds([secondUserId, "missing-user-id"]);
    expect(found.map((u) => u.id)).toEqual([secondUserId]);
    expect(await storage.users.getUsersByIds([])).toEqual([]);
  });
});

describe("BAO transactional case invariants", () => {
  function expectLifecycleInvariant(record: Awaited<ReturnType<typeof storage.baoCases.get>>) {
    expect(record).toBeTruthy();
    if (record!.statusClosed) {
      expect(record!.resolutionId).toBeTruthy();
      expect(record!.resolutionYmd).toBeTruthy();
    } else {
      expect(record!.resolutionId).toBeNull();
      expect(record!.resolutionYmd).toBeNull();
    }
  }

  it("creates a benefit appeal in Submitted while initiating its Auto-Denied notice", async () => {
    const [caseType] = await db.select().from(optionsBaoCaseType)
      .where(eq(optionsBaoCaseType.workflowCode, "benefit_appeal")).limit(1);
    if (!caseType) throw new Error("Benefit Appeal case type is not configured");
    const [submitted] = await db.select().from(optionsBaoCaseStatus).where(and(
      eq(optionsBaoCaseStatus.caseTypeId, caseType.id),
      eq(optionsBaoCaseStatus.workflowStep, "submitted"),
    )).limit(1);
    const [autoDenied] = await db.select().from(optionsBaoCaseStatus).where(and(
      eq(optionsBaoCaseStatus.caseTypeId, caseType.id),
      eq(optionsBaoCaseStatus.workflowStep, "auto_denied"),
    )).limit(1);
    if (!submitted || !autoDenied) throw new Error("Benefit Appeal statuses are not configured");
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const [reason] = await db.insert(optionsBaoAppealDenialReason).values({
      name: `${run}-deferred-reason-${suffix}`,
      data: { spdCitation: "Test citation" },
    }).returning();
    const benefit = await storage.trustBenefits.createTrustBenefit({
      name: `${run}-deferred-benefit-${suffix}`,
    } as any);
    const eventSpy = vi.spyOn(eventBus, "emit").mockResolvedValue(undefined as any);
    let createdId: string | null = null;
    let createdNoteId: string | null = null;
    try {
      const created = await storage.baoCases.create({
        entityType: "worker",
        entityId: workerId,
        deadlineYmd: "2099-01-01",
        statusId: submitted.id,
        caseTypeId: caseType.id,
        assigneeUserId: userId,
        actorUserId: userId,
        benefitId: benefit.id,
        denialReasonId: reason.id,
        initialNote: { typeId: noteTypeId, subject: `${run} deferred appeal` },
      });
      createdId = created.id;
      expect(created.statusId).toBe(submitted.id);
      const detail = await storage.baoCases.get(created.id, true);
      createdNoteId = detail?.notes?.[0]?.id ?? null;
      expect(detail).toMatchObject({
        workflowStep: "submitted",
      });
      const [appealDetails] = await db.select().from(sitespecificBaoAppealDetails)
        .where(eq(sitespecificBaoAppealDetails.caseId, created.id)).limit(1);
      expect(appealDetails).toMatchObject({ denialReasonId: reason.id });
      const creationEvent = eventSpy.mock.calls.find(([event, payload]) =>
        event === EventType.BAO_CASE_STATUS_SAVED &&
        (payload as any).caseId === created.id
      );
      expect(creationEvent?.[1]).toMatchObject({
        statusId: submitted.id,
        previousStatusId: null,
        operation: "created",
        memberNoticeTarget: {
          statusId: autoDenied.id,
          statusName: autoDenied.name,
        },
      });
    } finally {
      eventSpy.mockRestore();
      if (createdId) await db.delete(sitespecificBaoCases).where(eq(sitespecificBaoCases.id, createdId));
      if (createdNoteId) await db.delete(entityNotes).where(eq(entityNotes.id, createdNoteId));
      await db.delete(trustBenefits).where(eq(trustBenefits.id, benefit.id));
      await db.delete(optionsBaoAppealDenialReason).where(eq(optionsBaoAppealDenialReason.id, reason.id));
    }
  });

  it("promotes a Submitted appeal exactly once after an early Lob mailing confirmation is linked", async () => {
    const [caseType] = await db.select().from(optionsBaoCaseType)
      .where(eq(optionsBaoCaseType.workflowCode, "benefit_appeal")).limit(1);
    if (!caseType) throw new Error("Benefit Appeal case type is not configured");
    const [submitted] = await db.select().from(optionsBaoCaseStatus).where(and(
      eq(optionsBaoCaseStatus.caseTypeId, caseType.id),
      eq(optionsBaoCaseStatus.workflowStep, "submitted"),
    )).limit(1);
    const [autoDenied] = await db.select().from(optionsBaoCaseStatus).where(and(
      eq(optionsBaoCaseStatus.caseTypeId, caseType.id),
      eq(optionsBaoCaseStatus.workflowStep, "auto_denied"),
    )).limit(1);
    if (!submitted || !autoDenied) throw new Error("Benefit Appeal statuses are not configured");
    const worker = await storage.workers.getWorker(workerId);
    if (!worker?.contactId) throw new Error("Worker contact is required");

    const [appeal] = await db.insert(sitespecificBaoCases).values({
      entityType: "worker",
      entityId: workerId,
      assigneeUserId: userId,
      statusId: submitted.id,
      caseTypeId: caseType.id,
      deadlineYmd: "2099-01-01",
    }).returning();
    const [letterComm] = await db.insert(comm).values({
      medium: "postal",
      contactId: worker.contactId,
      status: "queued",
      data: { letterId: "ltr_appeal_confirmation_test" },
      sendKey: `bao_case_member_notice:${appeal.id}:${autoDenied.id}:2026-12-03`,
    }).returning();
    await db.insert(commPostal).values({
      commId: letterComm.id,
      toAddressLine1: "1 Test Way",
      toCity: "Test",
      toState: "CA",
      toZip: "90001",
      lobLetterId: "ltr_appeal_confirmation_test",
      data: {
        providerStatus: "letter.created",
      },
    });
    await db.insert(sitespecificBaoAppealDetails).values({
      caseId: appeal.id,
      denialReasonId: (
        await db.select({ id: optionsBaoAppealDenialReason.id })
          .from(optionsBaoAppealDenialReason).limit(1)
      )[0].id,
      data: null,
    });
    const eventSpy = vi.spyOn(eventBus, "emit").mockResolvedValue(undefined as any);
    try {
      await expect(storage.baoCases.updateLifecycle(appeal.id, {
        statusId: autoDenied.id,
      })).rejects.toThrow("MAILING_CONFIRMATION_REQUIRED");
      expect((await storage.baoCases.get(appeal.id))?.statusId).toBe(submitted.id);

      const postalStorage = createCommPostalStorage();
      const postal = await postalStorage.getCommPostalByComm(letterComm.id);
      if (!postal) throw new Error("Postal communication was not created");
      const webhookSecret = "test-lob-static-webhook-secret";
      const previousSecret = process.env.LOB_WEBHOOK_SECRET;
      process.env.LOB_WEBHOOK_SECRET = webhookSecret;
      const app = express();
      app.use(express.json({
        verify: (req, _res, body) => {
          (req as Request & { rawBody?: Buffer }).rawBody = Buffer.from(body);
        },
      }));
      const pass = (_req: any, _res: any, next: any) => next();
      registerCommRoutes(app, pass, () => pass, () => pass);
      const server = app.listen(0);
      try {
        const address = server.address();
        if (!address || typeof address === "string") throw new Error("Webhook test server did not start");
        const rawBody = JSON.stringify({
          id: "evt_appeal_confirmation_test",
          event_type: { id: "letter.delivered" },
          date_created: "2026-09-08T12:00:00.000Z",
          date_modified: "2026-09-08T12:00:00.000Z",
          body: { id: "ltr_appeal_confirmation_test" },
        });
        const timestamp = String(Math.floor(Date.now() / 1000));
        const signature = createHmac("sha256", webhookSecret)
          .update(`${timestamp}.`)
          .update(rawBody)
          .digest("hex");
        const [response] = await Promise.all([
          fetch(`http://127.0.0.1:${address.port}/api/comm/statuscallback/lob`, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "lob-signature": signature,
              "lob-signature-timestamp": timestamp,
            },
            body: rawBody,
          }),
          postalStorage.mergeCommPostalData(postal.id, {
            providerStatus: "letter.returned_to_sender",
          }, false),
        ]);
        expect(response.status).toBe(200);
      } finally {
        process.env.LOB_WEBHOOK_SECRET = previousSecret;
        await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
      }
      const afterOutOfOrderCallbacks = await postalStorage.getCommPostal(postal.id);
      expect(afterOutOfOrderCallbacks?.data).toMatchObject({
        mailingConfirmedAt: expect.any(String),
        mailingConfirmedEvent: "letter.delivered",
      });

      // No onCommCreated link was written. The signed callback reconstructs
      // it from the durable send key and promotes without sending again.
      expect(await db.select().from(sitespecificBaoCaseComms)
        .where(eq(sitespecificBaoCaseComms.commId, letterComm.id)))
        .toHaveLength(1);
      await Promise.all([
        storage.baoCases.promoteAppealAfterConfirmedMailing(letterComm.id),
        storage.baoCases.promoteAppealAfterConfirmedMailing(letterComm.id),
      ]);

      const promoted = await storage.baoCases.get(appeal.id);
      expect(promoted).toMatchObject({
        statusId: autoDenied.id,
        workflowStep: "auto_denied",
        deadlineYmd: "2026-12-03",
      });
      const statusEvents = eventSpy.mock.calls.filter(([event, payload]) =>
        event === EventType.BAO_CASE_STATUS_SAVED &&
        (payload as any).caseId === appeal.id &&
        (payload as any).statusId === autoDenied.id
      );
      expect(statusEvents).toHaveLength(1);
      expect(statusEvents[0][1]).toMatchObject({
        previousStatusId: submitted.id,
        operation: "updated",
      });
    } finally {
      eventSpy.mockRestore();
      await db.delete(sitespecificBaoCaseComms).where(eq(sitespecificBaoCaseComms.commId, letterComm.id));
      await db.delete(comm).where(eq(comm.id, letterComm.id));
      await db.delete(sitespecificBaoCases).where(eq(sitespecificBaoCases.id, appeal.id));
    }
  });

  it("attaches a case document by persisting the files row and the document row together", async () => {
    if (!available) throw new Error("BAO case schema unavailable");
    const created = await storage.baoCases.create({
      entityType: "worker",
      entityId: workerId,
      deadlineYmd: "2099-01-01",
      statusId: openStatusId,
      assigneeUserId: userId,
      actorUserId: userId,
      initialNote: { typeId: noteTypeId, subject: `${run} document case` },
    });
    caseIds.push(created.id);
    const detail = await storage.baoCases.get(created.id, true);
    noteIds.push(detail!.notes![0].id);
    // The entity-files route hands over an UNPERSISTED file (no id yet).
    const attached = await storage.baoCases.attachCaseDocument(created.id, {
      fileName: `${run}.pdf`,
      storagePath: `bao-case/${created.id}/${run}.pdf`,
      mimeType: "application/pdf",
      size: 3,
      uploadedBy: userId,
      entityType: "entity-files:bao-case",
      entityId: created.id,
      fileSystemId: "test",
      metadata: null,
    }, userId);
    try {
      expect(attached.file.id).toBeTruthy();
      expect(attached.document.fileId).toBe(attached.file.id);
      const listed = await storage.baoCases.listCaseDocuments(created.id);
      expect(listed.map((r: any) => r.document.id)).toEqual([attached.document.id]);
    } finally {
      await db.delete(sitespecificBaoCaseDocuments).where(eq(sitespecificBaoCaseDocuments.id, attached.document.id));
      await db.delete(files).where(eq(files.id, attached.file.id));
    }
  });

  it("creates with an ordinary initial note and enforces one-case-per-note", async (ctx) => {
    if (!available) throw new Error("BAO case schema unavailable");
    const created = await storage.baoCases.create({
      entityType: "worker",
      entityId: workerId,
      deadlineYmd: "2099-01-01",
      statusId: openStatusId,
      assigneeUserId: userId,
      actorUserId: userId,
      initialNote: { typeId: noteTypeId, subject: `${run} initial` },
    });
    caseIds.push(created.id);
    const detail = await storage.baoCases.get(created.id, true);
    expect(detail?.notes).toHaveLength(1);
    noteIds.push(detail!.notes![0].id);
    await expect(storage.baoCases.create({
      entityType: "worker",
      entityId: workerId,
      deadlineYmd: "2099-01-02",
      statusId: openStatusId,
      assigneeUserId: userId,
      actorUserId: userId,
      noteId: detail!.notes![0].id,
    })).rejects.toMatchObject({ cause: { code: "23505" } });
    expect(await storage.baoCases.getByNoteId(detail!.notes![0].id)).toEqual({
      caseId: created.id,
    });
  });

  it("rejects non-staff assignees and exposes linked notes in case detail", async () => {
    await expect(storage.baoCases.create({
      entityType: "worker", entityId: workerId, deadlineYmd: "2099-01-01",
      statusId: openStatusId, assigneeUserId: "00000000-0000-0000-0000-000000000000",
      actorUserId: userId, initialNote: { typeId: noteTypeId, subject: `${run} invalid assignee` },
    })).rejects.toThrow("INVALID_ASSIGNEE");
  });

  it("refuses cross-entity note conversion and preserves the note", async (ctx) => {
    if (!available) throw new Error("BAO case schema unavailable");
    const note = await storage.entityNotes.create({
      contextId: "worker", entityId: workerId, typeId: noteTypeId,
      subject: `${run} cross entity`, body: null, data: null, userId,
    });
    noteIds.push(note.id);
    await expect(storage.baoCases.create({
      entityType: "worker", entityId: otherWorkerId, noteId: note.id,
      deadlineYmd: "2099-01-01", statusId: openStatusId,
      assigneeUserId: userId, actorUserId: userId,
    })).rejects.toThrow("NOTE_ENTITY_MISMATCH");
    expect(await storage.entityNotes.get(note.id)).toBeTruthy();
  });

  it("requires resolution on close, does not require outreach, and clears it on reopen", async (ctx) => {
    if (!available) throw new Error("BAO case schema unavailable");
    const created = await storage.baoCases.create({
      entityType: "worker", entityId: workerId,
      deadlineYmd: "2099-01-01", statusId: openStatusId,
      assigneeUserId: userId, actorUserId: userId,
      initialNote: { typeId: noteTypeId, subject: `${run} lifecycle` },
    });
    caseIds.push(created.id);
    const initial = await storage.baoCases.get(created.id, true);
    noteIds.push(initial!.notes![0].id);
    await expect(storage.baoCases.updateLifecycle(created.id, { statusId: closedStatusId }))
      .rejects.toThrow("RESOLUTION_REQUIRED");
    await storage.baoCases.updateLifecycle(created.id, {
      statusId: closedStatusId, resolutionId, resolutionYmd: "2099-01-03",
    });
    await storage.baoCases.updateLifecycle(created.id, { statusId: openStatusId });
    const reopened = await storage.baoCases.get(created.id);
    expect(reopened?.resolutionId).toBeNull();
    expect(reopened?.resolutionYmd).toBeNull();
  });

  it("serializes status reclassification with case writes", async () => {
    const created = await storage.baoCases.create({
      entityType: "worker", entityId: workerId, deadlineYmd: "2099-02-01",
      statusId: openStatusId, assigneeUserId: userId, actorUserId: userId,
      initialNote: { typeId: noteTypeId, subject: `${run} serialized` },
    });
    caseIds.push(created.id);
    const detail = await storage.baoCases.get(created.id, true);
    noteIds.push(detail!.notes![0].id);

    // A close classification is rejected while its case is still unresolved.
    await expect(storage.baoCases.updateStatusClassificationAtomically(
      openStatusId, { closed: true },
    )).rejects.toThrow("STATUS_CLASSIFICATION_CONFLICT");

    // Hold the exclusive status lock as a reclassification does, then start a
    // lifecycle write. It cannot complete until that lock is released.
    let release!: () => void;
    const releaseGate = new Promise<void>((resolve) => { release = resolve; });
    let locked!: () => void;
    const lockedGate = new Promise<void>((resolve) => { locked = resolve; });
    const holder = db.transaction(async (tx) => {
      await tx.execute(sql`SELECT id FROM options_bao_case_status WHERE id = ${openStatusId} FOR UPDATE`);
      locked();
      await releaseGate;
    });
    await lockedGate;
    let settled = false;
    const writer = storage.baoCases.updateLifecycle(created.id, { deadlineYmd: "2099-02-02" })
      .then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    release();
    await holder;
    await writer;
    expect((await storage.baoCases.get(created.id))?.deadlineYmd).toBe("2099-02-02");
  });

  it("filters and paginates active and historical queues", async () => {
    const active = await storage.baoCases.list({
      entityType: "worker", entityId: workerId, closed: false,
      page: 1, pageSize: 1, sort: "deadline", direction: "asc",
    });
    expect(active.items.every((item) => item.entityId === workerId && !item.statusClosed)).toBe(true);
    expect(active.items.length).toBeLessThanOrEqual(1);
    const historical = await storage.baoCases.list({
      entityType: "worker", entityId: workerId, closed: true,
      page: 1, pageSize: 25, sort: "created", direction: "desc",
    });
    expect(historical.items.every((item) => item.statusClosed)).toBe(true);
  });

  it("serializes concurrent close and deadline-only updates on one case", async () => {
    const created = await storage.baoCases.create({
      entityType: "worker", entityId: workerId, deadlineYmd: "2099-04-01",
      statusId: openStatusId, assigneeUserId: userId, actorUserId: userId,
      initialNote: { typeId: noteTypeId, subject: `${run} close deadline race` },
    });
    caseIds.push(created.id);
    noteIds.push((await storage.baoCases.get(created.id, true))!.notes![0].id);

    let release!: () => void;
    let locked!: () => void;
    const releaseGate = new Promise<void>((resolve) => { release = resolve; });
    const lockedGate = new Promise<void>((resolve) => { locked = resolve; });
    const blocker = db.transaction(async (tx) => {
      await tx.execute(sql`SELECT id FROM sitespecific_bao_cases WHERE id = ${created.id} FOR UPDATE`);
      locked();
      await releaseGate;
    });
    await lockedGate;
    const close = storage.baoCases.updateLifecycle(created.id, {
      statusId: closedStatusId, resolutionId, resolutionYmd: "2099-04-02",
    });
    const deadline = storage.baoCases.updateLifecycle(created.id, { deadlineYmd: "2099-04-03" });
    release();
    await blocker;
    await Promise.all([close, deadline]);
    expectLifecycleInvariant(await storage.baoCases.get(created.id));
  });

  it("serializes concurrent close and reopen/update on one case", async () => {
    const created = await storage.baoCases.create({
      entityType: "worker", entityId: workerId, deadlineYmd: "2099-05-01",
      statusId: openStatusId, assigneeUserId: userId, actorUserId: userId,
      initialNote: { typeId: noteTypeId, subject: `${run} close reopen race` },
    });
    caseIds.push(created.id);
    noteIds.push((await storage.baoCases.get(created.id, true))!.notes![0].id);
    await storage.baoCases.updateLifecycle(created.id, {
      statusId: closedStatusId, resolutionId, resolutionYmd: "2099-05-02",
    });

    let release!: () => void;
    let locked!: () => void;
    const releaseGate = new Promise<void>((resolve) => { release = resolve; });
    const lockedGate = new Promise<void>((resolve) => { locked = resolve; });
    const blocker = db.transaction(async (tx) => {
      await tx.execute(sql`SELECT id FROM sitespecific_bao_cases WHERE id = ${created.id} FOR UPDATE`);
      locked();
      await releaseGate;
    });
    await lockedGate;
    const closeUpdate = storage.baoCases.updateLifecycle(created.id, {
      statusId: closedStatusId, resolutionId, resolutionYmd: "2099-05-03",
    });
    const reopen = storage.baoCases.updateLifecycle(created.id, {
      statusId: openStatusId, deadlineYmd: "2099-05-04",
    });
    release();
    await blocker;
    await Promise.all([closeUpdate, reopen]);
    expectLifecycleInvariant(await storage.baoCases.get(created.id));
  });
});