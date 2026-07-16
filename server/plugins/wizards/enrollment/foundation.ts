import crypto from "crypto";
import type {
  WizardPlugin,
  WizardStepContext,
  WizardStepHandler,
  WizardStepResult,
  WizardCreateContext,
  WizardCreateResult,
  WizardUpdateContext,
  WizardUpdateResult,
} from "../types";
import type { Wizard } from "@shared/schema";
import { insertFileSchema } from "@shared/schema";
import type { EnrollmentType } from "@shared/schema";
import { parseSSN } from "@shared/utils/ssn";
import {
  evaluateBenefitEligibility,
  pluginConfigToEligibilityRule,
} from "../../trust/eligibility/executor";
import type { EligibilityRule } from "../../trust/eligibility/types";
import { checkAccessInline } from "../../../services/access-policy-evaluator";
import { objectStorageService } from "../../../services/objectStorage";
import { logger } from "../../../logger";
import type { storage as StorageType } from "../../../storage";

type IStorage = typeof StorageType;

/**
 * Shared building blocks for enrollment-style wizards. First-time
 * enrollment is the first consumer; the Life Event wizard composes the
 * same helpers, step-builders, and dependent/signature/effective-date
 * logic exported here, differing only in its gate, its `enrollmentType`
 * stamp, its step set (event-type first, no benefit selection), and how
 * it builds the final election (carry the current benefits forward).
 *
 * The client renders the same escape-hatch components for every enrollment
 * wizard: each wizard's client folder re-exports the shared components in
 * `client/src/components/wizards/framework/enrollment/`.
 */

/* ------------------------------------------------------------------ */
/* Config-independent helpers                                          */
/* ------------------------------------------------------------------ */

export function todayYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Effective-date rule: first of the current month when today is on or
 * before the 15th, otherwise first of the following month.
 */
export function computeDefaultEffectiveDate(now: Date = new Date()): string {
  let year = now.getFullYear();
  let month = now.getMonth() + 1; // 1-based
  if (now.getDate() > 15) {
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return `${year}-${String(month).padStart(2, "0")}-01`;
}

/**
 * Every mutating handler funnels through this: the Draft/Posted/Canceled
 * lifecycle is enforced server-side, not just hidden in the UI.
 */
export function assertDraft(wizard: Wizard): void {
  if (wizard.status !== "draft") {
    throw new Error(
      `This enrollment is ${wizard.status} and can no longer be modified`,
    );
  }
}

export function wizardData(wizard: Wizard): Record<string, any> {
  return (wizard.data as Record<string, any>) || {};
}

interface EmploymentOption {
  employerId: string;
  employerName: string;
  home: boolean;
  jobTitle: string | null;
  policyId: string | null;
  policyName: string | null;
  policySource: string | null;
}

/**
 * Employers where the worker has active employment, each with its
 * resolved policy (policy history as of today → employer current policy
 * → system default policy). Mirrors the benefits-scan resolution order.
 */
async function getEmploymentOptions(
  storage: IStorage,
  workerId: string,
): Promise<EmploymentOption[]> {
  const employments = await storage.workerHours.getCurrentEmployment(workerId);
  const options: EmploymentOption[] = [];
  const today = todayYmd();
  for (const row of employments) {
    const employer = await storage.employers.getEmployer(row.employerId);
    if (!employer) continue;

    let policyId: string | null = null;
    let policyName: string | null = null;
    let policySource: string | null = null;

    const history = await storage.employerPolicyHistory.getEmployerPolicyHistory(
      employer.id,
    );
    const effective = history
      .filter((entry: any) => entry.date <= today)
      .sort((a: any, b: any) => b.date.localeCompare(a.date))[0];
    if (effective?.policy) {
      policyId = effective.policy.id;
      policyName = effective.policy.name ?? null;
      policySource = "Employer policy history";
    } else if (employer.denormPolicyId) {
      const policy = await storage.policies.getPolicyById(
        employer.denormPolicyId,
      );
      if (policy) {
        policyId = policy.id;
        policyName = policy.name ?? null;
        policySource = "Employer current policy";
      }
    }
    if (!policyId) {
      const defaultVar = await storage.variables.getByName("policy_default");
      if (defaultVar?.value) {
        const policy = await storage.policies.getPolicyById(
          defaultVar.value as string,
        );
        if (policy) {
          policyId = policy.id;
          policyName = policy.name ?? null;
          policySource = "System default policy";
        }
      }
    }

    options.push({
      employerId: employer.id,
      employerName: employer.name || employer.siriusId || employer.id,
      home: !!row.home,
      jobTitle: row.jobTitle ?? null,
      policyId,
      policyName,
      policySource,
    });
  }
  return options;
}

interface EligibleBenefitRow {
  benefitId: string;
  benefitName: string;
  benefitTypeId: string | null;
  benefitTypeName: string | null;
  benefitTypeSequence: number | null;
  benefitTypeOnlyOne: boolean;
  eligible: boolean;
  reasons: Array<{ pluginName: string; eligible: boolean; reason?: string }>;
}

/**
 * Run the existing trust-eligibility plugins ("start" scan) for every
 * benefit of the chosen policy. Only these results decide what the
 * operator may select — ineligible benefits are never offered.
 */
async function evaluateEligibleBenefits(
  storage: IStorage,
  workerId: string,
  policyId: string,
): Promise<EligibleBenefitRow[]> {
  const worker = await storage.workers.getWorker(workerId);
  if (!worker) throw new Error("Worker not found");
  const policy = await storage.policies.getPolicyById(policyId);
  if (!policy) throw new Error("Policy not found");

  const policyBenefitIds: string[] =
    ((policy.data as any)?.benefitIds as string[]) || [];

  const ruleRows = await storage.pluginConfigs.search("trust-eligibility", {
    policy: policy.id,
  });
  const rulesByBenefit = new Map<string, EligibilityRule[]>();
  for (const row of ruleRows) {
    const benefitId = (row.subsidiary as any)?.benefit;
    if (!benefitId) continue;
    const rule = pluginConfigToEligibilityRule(row.config);
    // Skip the "election" rule inside this wizard: it requires an ACTIVE
    // election covering the benefit, which is circular here — the wizard's
    // purpose is to create that election. Every other rule still applies.
    // The rule is dropped entirely so it never appears in the per-benefit
    // reason list; all other consumers (benefits scan, test page) are
    // unaffected.
    if (rule.pluginKey === "election") continue;
    const list = rulesByBenefit.get(benefitId) ?? [];
    list.push(rule);
    rulesByBenefit.set(benefitId, list);
  }

  const allBenefits = await storage.trustBenefits.getAllTrustBenefits();
  const nameById = new Map<string, string>(
    allBenefits.map((b: any) => [b.id, b.name || b.id]),
  );
  // Benefit-type info drives grouping (client) and single-select enforcement
  // (submit). An absent "only one of this type" flag is treated as off, so
  // existing types keep allowing multiple selections.
  const typeInfoById = new Map<
    string,
    {
      benefitTypeId: string | null;
      benefitTypeName: string | null;
      benefitTypeSequence: number | null;
      benefitTypeOnlyOne: boolean;
    }
  >(
    allBenefits.map((b: any) => [
      b.id,
      {
        benefitTypeId: b.benefitType ?? null,
        benefitTypeName: b.benefitTypeName ?? null,
        benefitTypeSequence: b.benefitTypeSequence ?? null,
        benefitTypeOnlyOne: b.benefitTypeOnlyOne === true,
      },
    ]),
  );

  // A benefit type can be hidden from the enrollment wizards via its
  // "Show on enrollment wizards" toggle. Only a value of explicit `false`
  // hides it — an absent/unset flag (existing types) or a benefit with no
  // type stays shown, so nothing disappears until an admin turns it off.
  // This is the single place the offered list is built AND the submitted
  // selection is re-validated, so hidden-type benefits are neither offered
  // nor accepted. The Life Event wizard carries benefits forward without
  // calling this, so a hidden type never strips an existing election.
  const hiddenByType = new Set<string>(
    allBenefits
      .filter((b: any) => b.benefitTypeShowOnEnrollmentWizards === false)
      .map((b: any) => b.id),
  );

  const now = new Date();
  const results: EligibleBenefitRow[] = [];
  for (const benefitId of policyBenefitIds) {
    if (hiddenByType.has(benefitId)) continue;
    const evalResult = await evaluateBenefitEligibility(
      benefitId,
      rulesByBenefit.get(benefitId) || [],
      {
        scanType: "start",
        workerId,
        worker,
        asOfMonth: now.getMonth() + 1,
        asOfYear: now.getFullYear(),
        stopAfterIneligible: false,
      },
    );
    const typeInfo = typeInfoById.get(benefitId);
    results.push({
      benefitId,
      benefitName: nameById.get(benefitId) ?? benefitId,
      benefitTypeId: typeInfo?.benefitTypeId ?? null,
      benefitTypeName: typeInfo?.benefitTypeName ?? null,
      benefitTypeSequence: typeInfo?.benefitTypeSequence ?? null,
      benefitTypeOnlyOne: typeInfo?.benefitTypeOnlyOne ?? false,
      eligible: evalResult.eligible,
      reasons: (evalResult.results || []).map((r: any) => ({
        pluginName: r.pluginKey ?? "rule",
        eligible: !!r.eligible,
        reason: r.reason,
      })),
    });
  }
  return results;
}

export const ALLOWED_UPLOAD_MIMETYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/gif",
  "image/webp",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

export interface DependentEntry {
  relationId: string;
  workerId: string;
  name: string;
  ssnLast4: string;
  birthDate: string;
  relationTypeId: string;
  matchedExisting: boolean;
  documentFileId: string;
  documentFileName: string | null;
  /**
   * False when the wizard reused a pre-existing relationship row instead of
   * creating one; removal must not delete a relation the wizard doesn't own.
   * Absent (older drafts) means created by the wizard.
   */
  createdByWizard?: boolean;
}

export async function lookupDependent(
  storage: IStorage,
  ssn: string,
  birthDate: string,
): Promise<{
  status: "matched" | "dob_mismatch" | "no_match";
  workerId?: string;
  name?: string;
  message: string;
}> {
  const cleaned = parseSSN(ssn);
  const existing = await storage.workers.getWorkerBySSN(cleaned);
  if (!existing) {
    // A DoB-only match is deliberately NOT a match — many people share a
    // birth date. No SSN match means no match.
    return {
      status: "no_match",
      message:
        "No existing worker matches this SSN. A new worker record will be created for the dependent.",
    };
  }
  const contact = existing.contactId
    ? await storage.contacts.getContact(existing.contactId)
    : undefined;
  const dob = contact?.birthDate
    ? String(contact.birthDate).slice(0, 10)
    : null;
  if (dob && dob === birthDate) {
    return {
      status: "matched",
      workerId: existing.id,
      name: contact?.displayName || existing.id,
      message: `SSN and date of birth match existing worker ${contact?.displayName || existing.id}. Choose the relationship type to link them.`,
    };
  }
  return {
    status: "dob_mismatch",
    message:
      "This SSN matches an existing worker but the date of birth does not. Resolve the discrepancy before adding this dependent — it will not be added automatically.",
  };
}

/* ------------------------------------------------------------------ */
/* Shared step handlers (composed by both wizards)                     */
/* ------------------------------------------------------------------ */

/**
 * Store an uploaded wizard file in private object storage and register
 * it in the files table. Used by both the dependent supporting-document
 * upload and the uploaded-signature path.
 */
export async function storeWizardFile(
  ctx: WizardStepContext,
  folder: string,
  wizardType: string,
): Promise<{ fileId: string; fileName: string }> {
  const file = ctx.file;
  if (!file) throw new Error("No file uploaded");
  if (!ALLOWED_UPLOAD_MIMETYPES.has(file.mimetype)) {
    throw new Error(
      "Unsupported file type. Upload a PDF, image, or Word document.",
    );
  }
  const userId = (ctx.req.user as any)?.dbUser?.id;
  if (!userId) throw new Error("Not authenticated");

  const fileUuid = crypto.randomUUID();
  const extension = file.originalname.split(".").pop() || "";
  const storageName = extension ? `${fileUuid}.${extension}` : fileUuid;
  const uploadResult = await objectStorageService.uploadFile({
    fileName: storageName,
    fileContent: file.buffer,
    mimeType: file.mimetype,
    accessLevel: "private",
    customPath: `private/${folder}/${storageName}`,
  });

  const validated = insertFileSchema.parse({
    fileName: file.originalname,
    storagePath: uploadResult.storagePath,
    mimeType: file.mimetype,
    size: uploadResult.size,
    uploadedBy: userId,
    entityType: "wizard",
    entityId: ctx.wizardId,
    accessLevel: "private",
    metadata: { wizardType, purpose: folder },
  });
  const created = await ctx.storage.files.create(validated);
  return { fileId: created.id, fileName: created.fileName };
}

/**
 * The shared add-a-dependent flow (lookup → upload → add → remove-added).
 * First-time enrollment uses this directly; the Life Event wizard reuses
 * it for its birth/marriage (add) branch. Dependent worker records and
 * `worker_relations` rows are created immediately (real records), so the
 * `add`/`remove` here operate on relationships this wizard itself created.
 */
export interface DualCoverageConflictEntry {
  field: string;
  workerId: string;
  relationshipId: string | null;
  message: string;
}

/**
 * Preview the dual-coverage rule for the wizard's CURRENT dependent
 * selection so conflicts surface on the dependents step instead of only at
 * final post. Uses the same storage logic as the write-time check
 * (`assertNoDualCoverage`); that check remains the enforcement backstop.
 *
 * The effective date may not be chosen yet when dependents are added, so
 * the check runs against the best-known start date: the chosen `startYmd`,
 * the forced Open Enrollment date, or the computed default. End date is
 * open (null), matching what the post step creates.
 */
export async function computeDualCoverageConflicts(
  storage: IStorage,
  data: Record<string, any>,
  dependents: DependentEntry[],
): Promise<DualCoverageConflictEntry[]> {
  const subscriberId = data.workerId as string | undefined;
  if (!subscriberId) return [];

  const relationshipIds = new Set<string>(dependents.map((d) => d.relationId));
  // Life Event: carried-forward current relationships (minus the ones
  // marked for removal) are also covered on the new election.
  if (Array.isArray(data.currentRelationships)) {
    const removed = new Set<string>(
      Array.isArray(data.removedRelationshipIds)
        ? data.removedRelationshipIds
        : [],
    );
    for (const rel of data.currentRelationships as Array<{ relationId: string }>) {
      if (rel?.relationId && !removed.has(rel.relationId)) {
        relationshipIds.add(rel.relationId);
      }
    }
  }

  const startYmd =
    (data.startYmd as string | undefined) ||
    (data.forcedStartYmd as string | undefined) ||
    computeDefaultEffectiveDate();

  return await storage.workerTrustElections.checkDualCoverage({
    subscriberId,
    relationshipIds: Array.from(relationshipIds),
    startYmd,
    endYmd: null,
  });
}

export async function handleDependentsSubmit(
  ctx: WizardStepContext,
  wizardType: string,
): Promise<WizardStepResult> {
  assertDraft(ctx.wizard);
  const data = wizardData(ctx.wizard);
  const subscriberId = data.workerId as string;
  const dependents: DependentEntry[] = Array.isArray(data.dependents)
    ? [...data.dependents]
    : [];

  // Upload path: the dispatcher's upload route also calls `submit`, with
  // the file on ctx.file. Store the supporting document and stage it for
  // the next "add" action.
  if (ctx.file) {
    const stored = await storeWizardFile(
      ctx,
      "wizard-elections/documents",
      wizardType,
    );
    return {
      data: {
        pendingDocument: { fileId: stored.fileId, fileName: stored.fileName },
      },
    };
  }

  const input = ctx.input as {
    action?: string;
    ssn?: string;
    birthDate?: string;
    given?: string;
    family?: string;
    relationTypeId?: string;
    documentFileId?: string;
    relationId?: string;
  };

  if (input.action === "lookup") {
    if (!input.ssn || !input.birthDate) {
      throw new Error("SSN and date of birth are required");
    }
    const result = await lookupDependent(ctx.storage, input.ssn, input.birthDate);
    return { data: { dependentLookup: result } };
  }

  if (input.action === "add") {
    if (!input.ssn || !input.birthDate) {
      throw new Error("SSN and date of birth are required");
    }
    if (!input.relationTypeId) {
      throw new Error("Relationship type is required");
    }
    if (!input.documentFileId) {
      throw new Error(
        "A supporting document (marriage certificate, birth certificate, etc.) is required for every dependent",
      );
    }

    const lookup = await lookupDependent(ctx.storage, input.ssn, input.birthDate);
    if (lookup.status === "dob_mismatch") {
      throw new Error(lookup.message);
    }

    const cleaned = parseSSN(input.ssn);
    let dependentWorkerId: string;
    let dependentName: string;
    if (lookup.status === "matched") {
      dependentWorkerId = lookup.workerId!;
      dependentName = lookup.name!;
    } else {
      const given = (input.given ?? "").trim();
      const family = (input.family ?? "").trim();
      if (!given || !family) {
        throw new Error(
          "First and last name are required to create a new dependent worker",
        );
      }
      dependentName = `${given} ${family}`;
      const created = await ctx.storage.workers.createWorker(dependentName);
      dependentWorkerId = created.id;
      await ctx.storage.workers.updateWorkerSSN(dependentWorkerId, cleaned, {
        allowSsaRuleInvalid: true,
      });
      await ctx.storage.workers.updateWorkerContactBirthDate(
        dependentWorkerId,
        input.birthDate,
      );
    }

    if (dependentWorkerId === subscriberId) {
      throw new Error("A worker cannot be their own dependent");
    }
    if (dependents.some((d) => d.workerId === dependentWorkerId)) {
      throw new Error("This dependent has already been added");
    }

    // Reuse an existing active relationship of the same type between the
    // subscriber and this dependent, if there is one — repeated enrollment
    // attempts must not pile up duplicate relationship rows (storage also
    // rejects overlapping duplicates outright).
    const existingRels = await ctx.storage.workerRelations.searchWorkerRelations({
      workerId: subscriberId,
      role: "worker_1",
      relationTypeId: input.relationTypeId,
      activeAt: new Date(),
    });
    const reused = existingRels.find((r) => r.worker2 === dependentWorkerId);

    // Real records on purpose: dependent workers and relationships
    // persist regardless of whether the wizard is later posted.
    const relation =
      reused ??
      (await ctx.storage.workerRelations.create({
        worker1: subscriberId,
        worker2: dependentWorkerId,
        relationType: input.relationTypeId,
        startYmd: todayYmd(),
        endYmd: null,
        data: {
          documentFileId: input.documentFileId,
          wizardId: ctx.wizardId,
          source: wizardType,
        },
      }));

    dependents.push({
      createdByWizard: !reused,
      relationId: relation.id,
      workerId: dependentWorkerId,
      name: dependentName,
      ssnLast4: cleaned.slice(-4),
      birthDate: input.birthDate,
      relationTypeId: input.relationTypeId,
      matchedExisting: lookup.status === "matched",
      documentFileId: input.documentFileId,
      documentFileName:
        (data.pendingDocument as any)?.fileId === input.documentFileId
          ? ((data.pendingDocument as any)?.fileName ?? null)
          : null,
    });
    return {
      data: {
        dependents,
        pendingDocument: null,
        dependentLookup: null,
        dualCoverageConflicts: await computeDualCoverageConflicts(
          ctx.storage,
          data,
          dependents,
        ),
      },
    };
  }

  if (input.action === "remove") {
    const entry = dependents.find((d) => d.relationId === input.relationId);
    if (!entry) throw new Error("Dependent not found on this enrollment");
    // Remove only a relationship created by this wizard; a reused
    // pre-existing relationship stays (the wizard doesn't own it), and the
    // dependent's worker record persists (it is a real record once created).
    if (entry.createdByWizard !== false) {
      await ctx.storage.workerRelations.delete(entry.relationId);
    }
    const remaining = dependents.filter(
      (d) => d.relationId !== input.relationId,
    );
    return {
      data: {
        dependents: remaining,
        dualCoverageConflicts: await computeDualCoverageConflicts(
          ctx.storage,
          data,
          remaining,
        ),
      },
    };
  }

  if (input.action === "done") {
    // Explicit no-op submit so the operator can confirm the (possibly
    // empty) dependent list and move on. Refresh the conflict preview so a
    // conflict resolved elsewhere (or newly introduced) is reflected.
    return {
      data: {
        dualCoverageConflicts: await computeDualCoverageConflicts(
          ctx.storage,
          data,
          dependents,
        ),
      },
    };
  }

  throw new Error("Unknown dependents action");
}

export async function handleEffectiveDateSubmit(
  ctx: WizardStepContext,
): Promise<WizardStepResult> {
  assertDraft(ctx.wizard);
  // Forced effective date (Open Enrollment): the date is fixed to Jan 1 of
  // the configured plan year and cannot be changed by anyone.
  const forcedStartYmd = wizardData(ctx.wizard).forcedStartYmd as
    | string
    | undefined;
  if (forcedStartYmd) {
    return {
      data: { startYmd: forcedStartYmd, effectiveDateOverridden: false },
    };
  }
  const input = ctx.input as { startYmd?: string };
  const startYmd = (input.startYmd ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startYmd)) {
    throw new Error("Effective date must be a valid date (YYYY-MM-DD)");
  }
  const computed = computeDefaultEffectiveDate();
  if (startYmd !== computed) {
    // Only administrators may override the computed effective date.
    const access = await checkAccessInline(ctx.req, "admin");
    if (!access.granted) {
      throw new Error(
        `Only administrators can override the computed effective date (${computed})`,
      );
    }
  }
  return {
    data: { startYmd, effectiveDateOverridden: startYmd !== computed },
  };
}

export async function handleSignatureSubmit(
  ctx: WizardStepContext,
  wizardType: string,
): Promise<WizardStepResult> {
  assertDraft(ctx.wizard);

  // Uploaded signature image comes through the dispatcher upload route.
  if (ctx.file) {
    const stored = await storeWizardFile(
      ctx,
      "wizard-elections/signatures",
      wizardType,
    );
    return {
      data: {
        signature: {
          type: "upload",
          fileId: stored.fileId,
          fileName: stored.fileName,
          signedAt: new Date().toISOString(),
        },
      },
    };
  }

  const input = ctx.input as {
    signature?: { type?: string; value?: string };
  };
  const sig = input.signature;
  if (!sig || (sig.type !== "typed" && sig.type !== "drawn")) {
    throw new Error("Signature type must be typed, drawn, or an uploaded file");
  }
  if (!sig.value || !sig.value.trim()) {
    throw new Error("Signature is required");
  }
  return {
    data: {
      signature: {
        type: sig.type,
        value: sig.value,
        signedAt: new Date().toISOString(),
      },
    },
  };
}

/* ------------------------------------------------------------------ */
/* Shared step-builder factories                                       */
/* ------------------------------------------------------------------ */

/**
 * The effective-date form step, identical for every enrollment wizard:
 * defaults to the 15th-of-month rule and only admins may override it.
 */
export function buildEffectiveDateStep(): WizardStepHandler {
  return {
    id: "effective_date",
    name: "Effective Date",
    description: "Confirm when the election takes effect",
    kind: "form",
    getState: (wizard) => {
      const data = wizardData(wizard);
      if (data.startYmd) return "completed";
      return wizard.currentStep === "effective_date"
        ? "in_progress"
        : "pending";
    },
    getSchema: (wizard) => {
      const data = wizardData(wizard);
      const forcedStartYmd = data.forcedStartYmd as string | undefined;
      if (forcedStartYmd) {
        return {
          type: "object",
          title: "Effective Date",
          description: `Open Enrollment elections always take effect on ${forcedStartYmd} (January 1 of the plan year). This date is fixed and cannot be changed.`,
          properties: {
            startYmd: {
              type: "string",
              format: "date",
              title: "Effective date",
              default: forcedStartYmd,
              readOnly: true,
            },
          },
          required: ["startYmd"],
        };
      }
      const computed = computeDefaultEffectiveDate();
      return {
        type: "object",
        title: "Effective Date",
        description: `Elections posted on or before the 15th take effect the first of the current month; after the 15th they take effect the first of the following month. Based on today's date, the computed effective date is ${computed}. Only administrators can override it.`,
        properties: {
          startYmd: {
            type: "string",
            format: "date",
            title: "Effective date",
            default: (data.startYmd as string) || computed,
          },
        },
        required: ["startYmd"],
      };
    },
    submit: handleEffectiveDateSubmit,
  };
}

/** The signature capture step, identical for every enrollment wizard. */
export function buildSignatureStep(wizardType: string): WizardStepHandler {
  return {
    id: "signature",
    name: "Signature",
    description: "Capture the worker's signature",
    kind: "custom",
    component: "SignatureStep",
    getState: (wizard) => {
      const data = wizardData(wizard);
      if (data.signature) return "completed";
      return wizard.currentStep === "signature" ? "in_progress" : "pending";
    },
    submit: (ctx) => handleSignatureSubmit(ctx, wizardType),
  };
}

/* ------------------------------------------------------------------ */
/* Config                                                              */
/* ------------------------------------------------------------------ */

export interface EnrollmentFoundationConfig {
  /** The wizard's type id (used for file/relation/election provenance). */
  wizardType: string;
  /** Stamped onto the election created when the wizard is posted. */
  enrollmentType: EnrollmentType;
  /**
   * Optional per-wizard gate run in the create hook after the worker is
   * resolved. Return an error message to reject creation (mapped to HTTP
   * 400) or null to allow it. First-time enrollment uses this to refuse
   * workers who already have an active medical/dental election.
   */
  guardWorker?: (
    storage: IStorage,
    workerId: string,
  ) => Promise<string | null> | string | null;
  /**
   * Optional per-wizard hook run in the create hook after the worker is
   * resolved (and after `guardWorker`). Return `{ error }` to reject
   * creation (mapped to HTTP `status` or 400), or `{ data }` to seed extra
   * fields onto the new wizard's data. Open Enrollment uses this to resolve
   * the active admin window and force the Jan-1 effective date via
   * `forcedStartYmd`.
   */
  prepareCreateData?: (
    storage: IStorage,
    workerId: string,
  ) => Promise<{ error?: string; status?: number; data?: Record<string, unknown> }>;
}

/** The reusable plugin fragment an enrollment wizard composes. */
export interface EnrollmentFoundation {
  steps: WizardStepHandler[];
  create: (ctx: WizardCreateContext) => Promise<WizardCreateResult>;
  prepareUpdate: (ctx: WizardUpdateContext) => WizardUpdateResult;
}

/**
 * Shared create hook: resolve the worker, run the optional gate, and
 * prefill the wizard's data with the worker identity + optional seed. The
 * `seed` callback lets a wizard stage its own carry-forward data (e.g. the
 * Life Event wizard seeds the current election's employer/policy/benefits
 * and current relationships).
 */
export async function runEnrollmentCreate(
  ctx: WizardCreateContext,
  opts: {
    guardWorker?: EnrollmentFoundationConfig["guardWorker"];
    prepareCreateData?: EnrollmentFoundationConfig["prepareCreateData"];
    seed?: (
      storage: IStorage,
      workerId: string,
    ) => Promise<Record<string, unknown>>;
  },
): Promise<WizardCreateResult> {
  const launchArgs =
    ((ctx.input.data as any)?.launchArguments as Record<string, unknown>) ?? {};
  const workerId = (launchArgs.workerId ?? ctx.input.entityId) as
    | string
    | undefined;
  if (!workerId) {
    return { error: "workerId is required", status: 400 };
  }
  const worker = await ctx.storage.workers.getWorker(workerId);
  if (!worker) {
    return { error: "Worker not found", status: 404 };
  }
  // Per-wizard gate (e.g. first-time enrollment refuses workers who
  // already have an active medical/dental election; Life Event requires an
  // active election). Enforced here on the server, not just hidden behind a
  // disabled launch button.
  if (opts.guardWorker) {
    const reason = await opts.guardWorker(ctx.storage, workerId);
    if (reason) {
      return { error: reason, status: 400 };
    }
  }
  const seedData = opts.seed ? await opts.seed(ctx.storage, workerId) : {};
  // Per-wizard prepare hook (e.g. Open Enrollment resolves the active admin
  // window and forces the Jan-1 effective date via `forcedStartYmd`). It can
  // reject creation and its data wins over the generic seed defaults.
  let preparedData: Record<string, unknown> = {};
  if (opts.prepareCreateData) {
    const prep = await opts.prepareCreateData(ctx.storage, workerId);
    if (prep.error) {
      return { error: prep.error, status: prep.status ?? 400 };
    }
    preparedData = prep.data ?? {};
  }
  const wizard = await ctx.storage.wizards.create({
    ...(ctx.input as any),
    entityId: null,
    data: {
      ...((ctx.input.data as Record<string, unknown>) ?? {}),
      workerId,
      workerName: await ctx.storage.workers.getWorkerDisplayName(workerId),
      ...seedData,
      ...preparedData,
    },
  } as any);
  return { wizard };
}

/**
 * Shared prepareUpdate: posted and canceled enrollments are immutable
 * through the generic PATCH route as well — not just hidden in the UI.
 */
export function enrollmentPrepareUpdate(
  ctx: WizardUpdateContext,
): WizardUpdateResult {
  if (ctx.existing.status !== "draft") {
    return {
      error: `This enrollment is ${ctx.existing.status} and can no longer be modified`,
      status: 400,
    };
  }
  return { data: ctx.merged };
}

/* ------------------------------------------------------------------ */
/* Factory (first-time enrollment)                                     */
/* ------------------------------------------------------------------ */

export function createEnrollmentFoundation(
  config: EnrollmentFoundationConfig,
): EnrollmentFoundation {
  const { wizardType, enrollmentType, guardWorker, prepareCreateData } = config;

  /* ---------------------------------------------------------------- */
  /* Step handlers                                                     */
  /* ---------------------------------------------------------------- */

  async function submitEmployerPolicy(
    ctx: WizardStepContext,
  ): Promise<WizardStepResult> {
    assertDraft(ctx.wizard);
    const data = wizardData(ctx.wizard);
    const workerId = data.workerId as string;
    const input = ctx.input as { employerId?: string };
    if (!input.employerId) throw new Error("employerId is required");

    const options = await getEmploymentOptions(ctx.storage, workerId);
    const chosen = options.find((o) => o.employerId === input.employerId);
    if (!chosen) {
      throw new Error(
        "Selected employer is not one of the worker's active employments",
      );
    }
    if (!chosen.policyId) {
      throw new Error("No policy could be resolved for the selected employer");
    }

    const changed = data.employerId && data.employerId !== chosen.employerId;
    return {
      data: {
        employerId: chosen.employerId,
        employerName: chosen.employerName,
        policyId: chosen.policyId,
        policyName: chosen.policyName,
        policySource: chosen.policySource,
        // Changing the employer/policy invalidates any benefit selection
        // made against the previous policy.
        ...(changed
          ? { benefitIds: [], benefitNames: [], benefitSelections: [] }
          : {}),
      },
    };
  }

  async function submitBenefits(
    ctx: WizardStepContext,
  ): Promise<WizardStepResult> {
    assertDraft(ctx.wizard);
    const data = wizardData(ctx.wizard);
    if (!data.policyId) throw new Error("Choose an employer and policy first");
    const input = ctx.input as { benefitIds?: string[] };
    const benefitIds = Array.isArray(input.benefitIds) ? input.benefitIds : [];
    if (benefitIds.length === 0) {
      throw new Error("Select at least one benefit");
    }
    // Re-evaluate server-side: the client can only pick from what the
    // eligibility plugins say is eligible right now.
    const rows = await evaluateEligibleBenefits(
      ctx.storage,
      data.workerId,
      data.policyId,
    );
    const eligibleIds = new Set(
      rows.filter((r) => r.eligible).map((r) => r.benefitId),
    );
    for (const id of benefitIds) {
      if (!eligibleIds.has(id)) {
        throw new Error(
          "One or more selected benefits are not eligible for this worker under the chosen policy",
        );
      }
    }
    const rowById = new Map(rows.map((r) => [r.benefitId, r]));

    // Enforce the per-type "only one of this type" rule server-side. A type
    // without the flag allows as many benefits as today. This mirrors the
    // client single-select UI but is the real gate, since the client can be
    // bypassed. Life Event never runs this path, so existing carried-forward
    // elections that predate a newly-set rule are untouched.
    const countByOnlyOneType = new Map<string, { name: string; count: number }>();
    for (const id of benefitIds) {
      const row = rowById.get(id);
      if (!row?.benefitTypeOnlyOne || !row.benefitTypeId) continue;
      const entry = countByOnlyOneType.get(row.benefitTypeId) ?? {
        name: row.benefitTypeName ?? "this type",
        count: 0,
      };
      entry.count += 1;
      countByOnlyOneType.set(row.benefitTypeId, entry);
    }
    for (const { name, count } of countByOnlyOneType.values()) {
      if (count > 1) {
        throw new Error(
          `Only one ${name} benefit can be selected. Please choose a single ${name} benefit.`,
        );
      }
    }

    // Persist a typed view of the selection so the review screen can group by
    // benefit type without another lookup. benefitNames is kept for backward
    // compatibility with existing consumers.
    const benefitSelections = benefitIds.map((id) => {
      const row = rowById.get(id);
      return {
        benefitId: id,
        benefitName: row?.benefitName ?? id,
        benefitTypeId: row?.benefitTypeId ?? null,
        benefitTypeName: row?.benefitTypeName ?? null,
        benefitTypeSequence: row?.benefitTypeSequence ?? null,
      };
    });
    return {
      data: {
        benefitIds,
        benefitNames: benefitSelections.map((b) => b.benefitName),
        benefitSelections,
      },
    };
  }

  async function submitReview(
    ctx: WizardStepContext,
  ): Promise<WizardStepResult> {
    const data = wizardData(ctx.wizard);
    const input = ctx.input as { action?: string };

    if (input.action === "cancel") {
      assertDraft(ctx.wizard);
      // Canceled enrollments never create elections and are no longer
      // editable (every handler runs assertDraft).
      return {
        data: { canceledAt: new Date().toISOString() },
        status: "canceled",
      };
    }

    if (input.action !== "post") {
      throw new Error("Unknown review action");
    }

    assertDraft(ctx.wizard);
    // Idempotence guard: even if the wizard status were tampered back to
    // draft, a second Post can never create a second election.
    if (data.electionId) {
      throw new Error("This enrollment has already been posted");
    }
    if (!data.workerId) throw new Error("Missing worker");
    if (!data.employerId || !data.policyId) {
      throw new Error("Choose an employer and policy before posting");
    }
    if (!Array.isArray(data.benefitIds) || data.benefitIds.length === 0) {
      throw new Error("Select at least one benefit before posting");
    }
    if (!data.startYmd) {
      throw new Error("Set the effective date before posting");
    }
    if (!data.signature) {
      throw new Error("The worker's signature is required before posting");
    }

    const relationshipIds = (
      (data.dependents as DependentEntry[] | undefined) ?? []
    ).map((d) => d.relationId);

    const election = await ctx.storage.workerTrustElections.create(
      data.workerId as string,
      {
        employerId: data.employerId,
        policyId: data.policyId,
        startYmd: data.startYmd,
        benefitIds: data.benefitIds,
        relationshipIds,
        enrollmentType,
        data: {
          signature: data.signature,
          wizardId: ctx.wizardId,
          source: wizardType,
        },
      },
    );

    logger.info("Benefit election enrollment posted", {
      service: `${wizardType}-plugin`,
      wizardId: ctx.wizardId,
      workerId: data.workerId,
      electionId: election.id,
      enrollmentType,
    });

    return {
      data: { electionId: election.id, postedAt: new Date().toISOString() },
      status: "posted",
    };
  }

  /* ---------------------------------------------------------------- */
  /* Create / update hooks                                            */
  /* ---------------------------------------------------------------- */

  const create = async (
    ctx: WizardCreateContext,
  ): Promise<WizardCreateResult> =>
    runEnrollmentCreate(ctx, {
      guardWorker,
      // Per-wizard prepare hook (e.g. Open Enrollment resolves the active
      // admin window and forces the Jan-1 effective date via
      // `forcedStartYmd`). It can reject creation and its data wins over the
      // home-employer seed defaults.
      prepareCreateData,
      // Default the employer/policy to the worker's home employer (when it
      // has a resolvable policy) so the first step starts prefilled.
      seed: async (storage, workerId) => {
        const options = await getEmploymentOptions(storage, workerId);
        const home = options.find((o) => o.home && o.policyId);
        if (!home) return {};
        return {
          employerId: home.employerId,
          employerName: home.employerName,
          policyId: home.policyId,
          policyName: home.policyName,
          policySource: home.policySource,
        };
      },
    });

  const prepareUpdate = enrollmentPrepareUpdate;

  /* ---------------------------------------------------------------- */
  /* Steps                                                            */
  /* ---------------------------------------------------------------- */

  const steps: WizardStepHandler[] = [
    {
      id: "employer_policy",
      name: "Employer & Policy",
      description: "Choose the employer and its benefit policy",
      kind: "custom",
      component: "EmployerPolicyStep",
      getState: (wizard) => {
        const data = wizardData(wizard);
        if (data.employerId && data.policyId) return "completed";
        return wizard.currentStep === "employer_policy"
          ? "in_progress"
          : "pending";
      },
      getData: async (ctx) => {
        const data = wizardData(ctx.wizard);
        const options = await getEmploymentOptions(
          ctx.storage,
          data.workerId as string,
        );
        return { records: options };
      },
      submit: submitEmployerPolicy,
    },
    {
      id: "benefits",
      name: "Benefits",
      description: "Select from the benefits the worker is eligible for",
      kind: "custom",
      component: "BenefitsStep",
      getState: (wizard) => {
        const data = wizardData(wizard);
        if (Array.isArray(data.benefitIds) && data.benefitIds.length > 0) {
          return "completed";
        }
        return wizard.currentStep === "benefits" ? "in_progress" : "pending";
      },
      getData: async (ctx) => {
        const data = wizardData(ctx.wizard);
        if (!data.policyId) {
          return { records: [], message: "Choose an employer first" };
        }
        const rows = await evaluateEligibleBenefits(
          ctx.storage,
          data.workerId as string,
          data.policyId as string,
        );
        // Ineligible benefits are not offered at all — only eligible ones
        // are surfaced for selection.
        return {
          records: rows.filter((r) => r.eligible),
          ineligibleCount: rows.filter((r) => !r.eligible).length,
        };
      },
      submit: submitBenefits,
    },
    {
      id: "dependents",
      name: "Dependents",
      description:
        "Add dependents with SSN matching and supporting documents (optional)",
      kind: "custom",
      component: "DependentsStep",
      requiredComponent: "worker.relations",
      // Dependents are optional: the step is always navigable past.
      getState: () => "completed",
      // Fresh dual-coverage preview each time the step renders, so a
      // conflict (including one on the subscriber themselves) is visible
      // before the user proceeds — not just at final post.
      getData: async (ctx) => {
        const data = wizardData(ctx.wizard);
        const deps: DependentEntry[] = Array.isArray(data.dependents)
          ? data.dependents
          : [];
        return {
          dualCoverageConflicts: await computeDualCoverageConflicts(
            ctx.storage,
            data,
            deps,
          ),
        };
      },
      submit: (ctx) => handleDependentsSubmit(ctx, wizardType),
    },
    buildEffectiveDateStep(),
    buildSignatureStep(wizardType),
    {
      id: "review",
      name: "Review & Post",
      description: "Review the enrollment and post the election",
      kind: "custom",
      component: "ReviewPostStep",
      getState: (wizard) =>
        wizard.status === "posted" ? "completed" : "in_progress",
      submit: submitReview,
    },
  ];

  return { steps, create, prepareUpdate };
}

// Re-exported so the existing WizardPlugin shape is easy to compose.
export type { WizardPlugin };
