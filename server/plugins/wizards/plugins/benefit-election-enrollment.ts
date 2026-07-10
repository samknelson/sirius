import crypto from "crypto";
import { registerWizardPlugin } from "../registry";
import type {
  WizardPlugin,
  WizardStepContext,
  WizardStepResult,
} from "../types";
import type { Wizard } from "@shared/schema";
import { insertFileSchema } from "@shared/schema";
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

const SERVICE = "benefit-election-enrollment-plugin";
const WIZARD_TYPE = "benefit_election_enrollment";

type IStorage = typeof StorageType;

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function todayYmd(): string {
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
function assertDraft(wizard: Wizard): void {
  if (wizard.status !== "draft") {
    throw new Error(
      `This enrollment is ${wizard.status} and can no longer be modified`,
    );
  }
}

function wizardData(wizard: Wizard): Record<string, any> {
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

  const now = new Date();
  const results: EligibleBenefitRow[] = [];
  for (const benefitId of policyBenefitIds) {
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
    results.push({
      benefitId,
      benefitName: nameById.get(benefitId) ?? benefitId,
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

const ALLOWED_UPLOAD_MIMETYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/gif",
  "image/webp",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

/**
 * Store an uploaded wizard file in private object storage and register
 * it in the files table. Used by both the dependent supporting-document
 * upload and the uploaded-signature path.
 */
async function storeWizardFile(
  ctx: WizardStepContext,
  folder: string,
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
    metadata: { wizardType: WIZARD_TYPE, purpose: folder },
  });
  const created = await ctx.storage.files.create(validated);
  return { fileId: created.id, fileName: created.fileName };
}

interface DependentEntry {
  relationId: string;
  workerId: string;
  name: string;
  ssnLast4: string;
  birthDate: string;
  relationTypeId: string;
  matchedExisting: boolean;
  documentFileId: string;
  documentFileName: string | null;
}

async function lookupDependent(
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
/* Step handlers                                                       */
/* ------------------------------------------------------------------ */

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
      ...(changed ? { benefitIds: [], benefitNames: [] } : {}),
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
  const nameById = new Map(rows.map((r) => [r.benefitId, r.benefitName]));
  return {
    data: {
      benefitIds,
      benefitNames: benefitIds.map((id) => nameById.get(id) ?? id),
    },
  };
}

async function submitDependents(
  ctx: WizardStepContext,
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
    const stored = await storeWizardFile(ctx, "wizard-elections/documents");
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
    const result = await lookupDependent(
      ctx.storage,
      input.ssn,
      input.birthDate,
    );
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

    const lookup = await lookupDependent(
      ctx.storage,
      input.ssn,
      input.birthDate,
    );
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

    // Real records on purpose: dependent workers and relationships
    // persist regardless of whether the wizard is later posted.
    const relation = await ctx.storage.workerRelations.create({
      worker1: subscriberId,
      worker2: dependentWorkerId,
      relationType: input.relationTypeId,
      startYmd: todayYmd(),
      endYmd: null,
      data: {
        documentFileId: input.documentFileId,
        wizardId: ctx.wizardId,
        source: WIZARD_TYPE,
      },
    });

    dependents.push({
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
      data: { dependents, pendingDocument: null, dependentLookup: null },
    };
  }

  if (input.action === "remove") {
    const entry = dependents.find((d) => d.relationId === input.relationId);
    if (!entry) throw new Error("Dependent not found on this enrollment");
    // Remove only the relationship created by this wizard; the dependent's
    // worker record persists (it is a real record once created).
    await ctx.storage.workerRelations.delete(entry.relationId);
    return {
      data: {
        dependents: dependents.filter(
          (d) => d.relationId !== input.relationId,
        ),
      },
    };
  }

  if (input.action === "done") {
    // Explicit no-op submit so the operator can confirm the (possibly
    // empty) dependent list and move on.
    return { data: {} };
  }

  throw new Error("Unknown dependents action");
}

async function submitEffectiveDate(
  ctx: WizardStepContext,
): Promise<WizardStepResult> {
  assertDraft(ctx.wizard);
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
  return { data: { startYmd, effectiveDateOverridden: startYmd !== computed } };
}

async function submitSignature(
  ctx: WizardStepContext,
): Promise<WizardStepResult> {
  assertDraft(ctx.wizard);

  // Uploaded signature image comes through the dispatcher upload route.
  if (ctx.file) {
    const stored = await storeWizardFile(ctx, "wizard-elections/signatures");
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

async function submitReview(
  ctx: WizardStepContext,
): Promise<WizardStepResult> {
  const data = wizardData(ctx.wizard);
  const input = ctx.input as { action?: string };

  if (input.action === "cancel") {
    assertDraft(ctx.wizard);
    // Canceled enrollments never create elections and are no longer
    // editable (every handler runs assertDraft).
    return { data: { canceledAt: new Date().toISOString() }, status: "canceled" };
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
      data: {
        signature: data.signature,
        wizardId: ctx.wizardId,
        source: WIZARD_TYPE,
      },
    },
  );

  logger.info("Benefit election enrollment posted", {
    service: SERVICE,
    wizardId: ctx.wizardId,
    workerId: data.workerId,
    electionId: election.id,
  });

  return {
    data: { electionId: election.id, postedAt: new Date().toISOString() },
    status: "posted",
  };
}

/* ------------------------------------------------------------------ */
/* Plugin definition                                                   */
/* ------------------------------------------------------------------ */

export const benefitElectionEnrollmentPlugin: WizardPlugin = {
  id: WIZARD_TYPE,
  name: "Benefit Election Enrollment",
  description:
    "Enroll a worker in trust benefits: pick the employer/policy, select eligible benefits, add dependents with supporting documents, capture a signature, and post the election.",
  requiredComponent: "trust.benefits",
  requiredPolicy: "staff",
  category: "enrollment",
  launchSchema: {
    type: "object",
    properties: {
      workerId: {
        type: "string",
        title: "Worker",
        description: "The worker being enrolled",
      },
    },
    required: ["workerId"],
  },
  create: async (ctx) => {
    const launchArgs =
      ((ctx.input.data as any)?.launchArguments as Record<string, unknown>) ??
      {};
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
    // Default the employer/policy to the worker's home employer (when it
    // has a resolvable policy) so the first step starts prefilled.
    let homeDefaults: Record<string, unknown> = {};
    const options = await getEmploymentOptions(ctx.storage, workerId);
    const home = options.find((o) => o.home && o.policyId);
    if (home) {
      homeDefaults = {
        employerId: home.employerId,
        employerName: home.employerName,
        policyId: home.policyId,
        policyName: home.policyName,
        policySource: home.policySource,
      };
    }
    const wizard = await ctx.storage.wizards.create({
      ...(ctx.input as any),
      entityId: null,
      data: {
        ...((ctx.input.data as Record<string, unknown>) ?? {}),
        workerId,
        workerName: await ctx.storage.workers.getWorkerDisplayName(workerId),
        ...homeDefaults,
      },
    } as any);
    return { wizard };
  },
  prepareUpdate: (ctx) => {
    // Posted and canceled enrollments are immutable through the generic
    // PATCH route as well — not just hidden in the UI.
    if (ctx.existing.status !== "draft") {
      return {
        error: `This enrollment is ${ctx.existing.status} and can no longer be modified`,
        status: 400,
      };
    }
    return { data: ctx.merged };
  },
  steps: [
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
      submit: submitDependents,
    },
    {
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
        const computed = computeDefaultEffectiveDate();
        const data = wizardData(wizard);
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
      submit: submitEffectiveDate,
    },
    {
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
      submit: submitSignature,
    },
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
  ],
};

registerWizardPlugin(benefitElectionEnrollmentPlugin);
