import { registerWizardPlugin } from "../registry";
import type {
  WizardPlugin,
  WizardStepContext,
  WizardStepHandler,
  WizardStepResult,
} from "../types";
import {
  assertDraft,
  wizardData,
  todayYmd,
  buildSignatureStep,
  runEnrollmentCreate,
  enrollmentPrepareUpdate,
} from "../enrollment/foundation";
import {
  BAO_COBRA_COVERED_LIVES_TIERS,
  BAO_COBRA_ADMIN_FEE_RATE,
  applyBaoCobraAdminFee,
  type BaoCobraCoveredLivesTier,
} from "../../../../shared/schema/sitespecific/bao/schema";
import { computeCobraDeadlines } from "../../../../shared/schema/sitespecific/bao/cobra";
import { createUnifiedOptionsStorage } from "../../../storage/unified-options";
import { runInTransaction } from "../../../storage/transaction-context";
import { logger } from "../../../logger";
import type { storage as StorageType } from "../../../storage";

type IStorage = typeof StorageType;

const WIZARD_TYPE = "bao_cobra_enrollment";

/**
 * COBRA continuation-coverage election.
 *
 * Launched from the worker COBRA screen for a covered person with an open,
 * un-elected COBRA case. The wizard:
 *
 *   - offers continuation of the coverage lost on the case (medical,
 *     dental, or both — only what the case actually lists),
 *   - lets a SUBSCRIBER case also cover the subscriber's dependents
 *     (active worker relations); a dependent's own case covers only that
 *     dependent,
 *   - prices the election live from the COBRA rate table by benefit and
 *     covered-lives tier (1 / 2 / 3+),
 *   - captures a signature, and on Post records the election on the case
 *     (election date set, status → Pending First Payment, payment deadline
 *     computed) and creates a trust election stamped
 *     `enrollmentType: "cobra"` so the continued coverage is represented
 *     like any other benefit election.
 *
 * The election's effective date is always the case's COBRA effective date
 * (coverage continues seamlessly from the loss) — there is no effective-date
 * step. Mutual exclusivity with regular coverage is enforced by the case
 * storage invariants (an active case cannot coexist with active
 * medical/dental benefits).
 */

const PENDING_FIRST_PAYMENT_STATUS = "Pending First Payment";

/**
 * COBRA elections are deliberately NOT attributed to the worker's real
 * employer — the employment relationship ended (that's what triggered
 * COBRA). Instead every COBRA election is attached to a dedicated
 * "COBRA" employer and "COBRA" policy, get-or-created here by sirius ID.
 * (worker_trust_elections.employer_id / policy_id are NOT NULL, so a
 * placeholder employer is required rather than "no employer".)
 */
const COBRA_SIRIUS_ID = "COBRA";
const COBRA_NAME = "COBRA";

async function resolveCobraEmployerPolicy(
  storage: IStorage,
): Promise<{ employerId: string; policyId: string }> {
  let policy = await storage.policies.getPolicyBySiriusId(COBRA_SIRIUS_ID);
  if (!policy) {
    try {
      policy = await storage.policies.createPolicy({
        siriusId: COBRA_SIRIUS_ID,
        name: COBRA_NAME,
      });
    } catch {
      // Lost a create race — the unique siriusId row now exists.
      policy = await storage.policies.getPolicyBySiriusId(COBRA_SIRIUS_ID);
    }
  }
  if (!policy) {
    throw new Error("The COBRA policy could not be resolved or created");
  }

  let employer = await storage.employers.getBySiriusId(COBRA_SIRIUS_ID);
  if (!employer) {
    try {
      employer = await storage.employers.createEmployer({
        siriusId: COBRA_SIRIUS_ID,
        name: COBRA_NAME,
        denormPolicyId: policy.id,
      });
    } catch {
      employer = await storage.employers.getBySiriusId(COBRA_SIRIUS_ID);
    }
  }
  if (!employer) {
    throw new Error("The COBRA employer could not be resolved or created");
  }

  return { employerId: employer.id, policyId: policy.id };
}

type CoverageChoice = "medical" | "dental" | "both";

interface CoverageOption {
  kind: "medical" | "dental";
  benefitId: string;
  benefitName: string;
}

interface CoveredPersonEntry {
  relationId: string;
  name: string;
  relationTypeName: string | null;
}

function coverageOptionsOf(data: Record<string, any>): CoverageOption[] {
  return Array.isArray(data.coverageOptions) ? data.coverageOptions : [];
}

function selectedBenefits(data: Record<string, any>): CoverageOption[] {
  const choice = data.coverageChoice as CoverageChoice | undefined;
  if (!choice) return [];
  return coverageOptionsOf(data).filter(
    (o) => choice === "both" || o.kind === choice,
  );
}

function coveredLivesTier(count: number): BaoCobraCoveredLivesTier {
  if (count <= 1) return "1";
  if (count === 2) return "2";
  return "3+";
}

function selectedRelationIds(data: Record<string, any>): string[] {
  return Array.isArray(data.selectedRelationIds)
    ? data.selectedRelationIds
    : [];
}

interface PricingLine {
  kind: "medical" | "dental";
  benefitId: string;
  benefitName: string;
  rate: string | null;
}

interface Pricing {
  asOfYmd: string;
  coveredLives: number;
  tier: BaoCobraCoveredLivesTier;
  lines: PricingLine[];
  /** Sum of the line rates before the admin fee; null when any selected line has no rate. */
  preFeeTotal: string | null;
  /** The 2% COBRA administration fee on the pre-fee total; null when preFeeTotal is null. */
  adminFee: string | null;
  /** The admin fee rate (e.g. 0.02). */
  adminFeeRate: number;
  /** Final monthly premium: preFeeTotal + adminFee; null when any selected line has no rate. */
  monthlyTotal: string | null;
}

async function computePricing(
  storage: IStorage,
  data: Record<string, any>,
): Promise<Pricing> {
  const today = todayYmd();
  const effective = (data.cobraEffectiveYmd as string) || today;
  const asOfYmd = effective > today ? effective : today;
  const coveredLives = 1 + selectedRelationIds(data).length;
  const tier = coveredLivesTier(coveredLives);

  const ratesTableExists = await storage.baoCobraRates.tableExists();
  const lines: PricingLine[] = [];
  for (const option of selectedBenefits(data)) {
    const rate = ratesTableExists
      ? await storage.baoCobraRates.getEffectiveRate(
          option.benefitId,
          tier,
          asOfYmd,
        )
      : undefined;
    lines.push({ ...option, rate: rate ? rate.rate : null });
  }
  const priced = lines.length > 0 && lines.every((l) => l.rate !== null);
  const fee = priced
    ? applyBaoCobraAdminFee(lines.reduce((sum, l) => sum + Number(l.rate), 0))
    : null;
  return {
    asOfYmd,
    coveredLives,
    tier,
    lines,
    preFeeTotal: fee ? fee.preFeeTotal.toFixed(2) : null,
    adminFee: fee ? fee.adminFee.toFixed(2) : null,
    adminFeeRate: BAO_COBRA_ADMIN_FEE_RATE,
    monthlyTotal: fee ? fee.total.toFixed(2) : null,
  };
}

/* ------------------------------------------------------------------ */
/* Step 1: coverage choice (medical / dental / both)                   */
/* ------------------------------------------------------------------ */

async function submitCoverage(
  ctx: WizardStepContext,
): Promise<WizardStepResult> {
  assertDraft(ctx.wizard);
  const data = wizardData(ctx.wizard);
  const input = ctx.input as { coverageChoice?: CoverageChoice };
  const choice = input.coverageChoice;
  const options = coverageOptionsOf(data);
  const hasMedical = options.some((o) => o.kind === "medical");
  const hasDental = options.some((o) => o.kind === "dental");

  const valid: CoverageChoice[] = [];
  if (hasMedical) valid.push("medical");
  if (hasDental) valid.push("dental");
  if (hasMedical && hasDental) valid.push("both");
  if (!choice || !valid.includes(choice)) {
    throw new Error("Choose which coverage to continue");
  }
  return { data: { coverageChoice: choice } };
}

const coverageStep: WizardStepHandler = {
  id: "coverage",
  name: "Coverage",
  description: "Choose which lost coverage to continue under COBRA",
  kind: "form",
  getSchema: (wizard) => {
    const data = wizardData(wizard);
    const options = coverageOptionsOf(data);
    const medical = options.find((o) => o.kind === "medical");
    const dental = options.find((o) => o.kind === "dental");

    const enumValues: string[] = [];
    const enumNames: string[] = [];
    if (medical) {
      enumValues.push("medical");
      enumNames.push(`Medical only (${medical.benefitName})`);
    }
    if (dental) {
      enumValues.push("dental");
      enumNames.push(`Dental only (${dental.benefitName})`);
    }
    if (medical && dental) {
      enumValues.push("both");
      enumNames.push(
        `Both medical and dental (${medical.benefitName} + ${dental.benefitName})`,
      );
    }
    return {
      type: "object",
      title: "Coverage",
      description:
        "Choose which of the coverage lost on this COBRA case to continue. Only coverage actually lost can be continued.",
      properties: {
        coverageChoice: {
          type: "string",
          title: "Coverage to continue",
          enum: enumValues,
          enumNames,
          ...(data.coverageChoice
            ? { default: data.coverageChoice as string }
            : {}),
        },
      },
      required: ["coverageChoice"],
    };
  },
  getState: (wizard) => {
    const data = wizardData(wizard);
    if (data.coverageChoice) return "completed";
    return wizard.currentStep === "coverage" ? "in_progress" : "pending";
  },
  submit: submitCoverage,
};

/* ------------------------------------------------------------------ */
/* Step 2: covered people (subscriber case only)                       */
/* ------------------------------------------------------------------ */

async function listDependentOptions(
  storage: IStorage,
  subscriberWorkerId: string,
): Promise<CoveredPersonEntry[]> {
  const relations = await storage.workerRelations.searchWorkerRelations({
    workerId: subscriberWorkerId,
    role: "worker_1",
    activeAt: new Date(),
  });
  return relations.map((r) => ({
    relationId: r.id,
    name:
      r.otherWorker?.displayName ||
      [r.otherWorker?.given, r.otherWorker?.family].filter(Boolean).join(" ") ||
      r.otherWorker?.id ||
      "Unknown",
    relationTypeName: r.relationTypeName ?? null,
  }));
}

async function submitCoveredPeople(
  ctx: WizardStepContext,
): Promise<WizardStepResult> {
  assertDraft(ctx.wizard);
  const data = wizardData(ctx.wizard);
  const input = ctx.input as { relationIds?: string[] };

  if (!data.isSubscriberCase) {
    // A dependent's own case covers exactly that dependent; nothing to pick.
    return { data: { selectedRelationIds: [], coveredPeopleConfirmed: true } };
  }

  const requested = Array.isArray(input.relationIds) ? input.relationIds : [];
  const available = await listDependentOptions(
    ctx.storage,
    data.subscriberWorkerId as string,
  );
  const availableIds = new Set(available.map((o) => o.relationId));
  for (const id of requested) {
    if (!availableIds.has(id)) {
      throw new Error(
        "One or more selected dependents are not active dependents of this subscriber",
      );
    }
  }
  return {
    data: {
      selectedRelationIds: requested,
      selectedRelationLabels: available
        .filter((o) => requested.includes(o.relationId))
        .map((o) => o.name),
      coveredPeopleConfirmed: true,
    },
  };
}

const coveredPeopleStep: WizardStepHandler = {
  id: "covered_people",
  name: "Covered People",
  description: "Choose who the continued coverage applies to",
  kind: "custom",
  component: "CobraCoveredPeopleStep",
  getState: (wizard) => {
    const data = wizardData(wizard);
    if (data.coveredPeopleConfirmed) return "completed";
    return wizard.currentStep === "covered_people" ? "in_progress" : "pending";
  },
  getData: async (ctx) => {
    const data = wizardData(ctx.wizard);
    if (!data.isSubscriberCase) {
      return { records: [], pricing: await computePricing(ctx.storage, data) };
    }
    return {
      records: await listDependentOptions(
        ctx.storage,
        data.subscriberWorkerId as string,
      ),
      pricing: await computePricing(ctx.storage, data),
    };
  },
  submit: submitCoveredPeople,
};

/* ------------------------------------------------------------------ */
/* Step 4: review & post                                               */
/* ------------------------------------------------------------------ */

async function submitReview(
  ctx: WizardStepContext,
): Promise<WizardStepResult> {
  const data = wizardData(ctx.wizard);
  const input = ctx.input as { action?: string };

  if (input.action === "cancel") {
    assertDraft(ctx.wizard);
    return {
      data: { canceledAt: new Date().toISOString() },
      status: "canceled",
    };
  }
  if (input.action !== "post") {
    throw new Error("Unknown review action");
  }

  assertDraft(ctx.wizard);
  // Idempotence guard: a second Post can never create a second election.
  if (data.electionId) {
    throw new Error("This COBRA election has already been posted");
  }
  if (!data.caseId) throw new Error("Missing COBRA case");
  if (!data.coverageChoice) {
    throw new Error("Choose which coverage to continue before posting");
  }
  if (!data.coveredPeopleConfirmed) {
    throw new Error("Confirm who is covered before posting");
  }
  if (!data.signature) {
    throw new Error("The signature is required before posting");
  }
  const benefits = selectedBenefits(data);
  if (benefits.length === 0) {
    throw new Error("The selected coverage is not available on this case");
  }

  // Re-fetch the case: it must still be open, un-elected, and inside the
  // election window at the moment of posting.
  const theCase = await ctx.storage.baoCobraCases.getRaw(data.caseId as string);
  if (!theCase) throw new Error("The COBRA case no longer exists");
  if (theCase.electionMadeYmd) {
    throw new Error("An election has already been made on this COBRA case");
  }
  const unifiedOptions = createUnifiedOptionsStorage();
  const currentStatus = await unifiedOptions.get(
    "bao-cobra-status",
    theCase.statusId,
  );
  if (!currentStatus || currentStatus.closed) {
    throw new Error("This COBRA case is closed and can no longer be elected");
  }
  const today = todayYmd();
  if (theCase.lastDayToElectYmd && today > theCase.lastDayToElectYmd) {
    throw new Error(
      `The COBRA election window closed on ${theCase.lastDayToElectYmd}`,
    );
  }

  // Live pricing at post time: every continued benefit must have a rate.
  const pricing = await computePricing(ctx.storage, data);
  if (pricing.monthlyTotal === null) {
    throw new Error(
      "No COBRA rate is configured for the selected coverage and covered-lives tier — the election cannot be posted until rates are set up",
    );
  }

  // Resolve the Pending First Payment status by name.
  const statuses = await unifiedOptions.list("bao-cobra-status");
  const pendingStatus = (statuses as Array<{ id: string; name: string }>).find(
    (s) => s.name === PENDING_FIRST_PAYMENT_STATUS,
  );
  if (!pendingStatus) {
    throw new Error(
      `COBRA status "${PENDING_FIRST_PAYMENT_STATUS}" is not configured`,
    );
  }

  // Resolve the dedicated COBRA employer/policy at post time (never the
  // worker's real employer) — drafts created before this rule may carry a
  // stale real-employer pair, so the stored draft values are ignored.
  const { employerId, policyId } = await resolveCobraEmployerPolicy(
    ctx.storage,
  );

  // 1) Record the election on the case (deadlines recomputed centrally).
  const deadlines = computeCobraDeadlines(
    theCase.source,
    theCase.cobraEffectiveYmd,
    today,
  );
  // Both writes run in a single transaction so a failure in the election
  // create rolls back the case update — the case can never be marked
  // elected without a matching trust election.
  const election = await runInTransaction(async () => {
    await ctx.storage.baoCobraCases.updateEnforcingInvariants(
      theCase.id,
      {
        statusId: pendingStatus.id,
        electionMadeYmd: today,
        offerYmd: deadlines.offerYmd,
        lastDayToElectYmd: deadlines.lastDayToElectYmd,
        initialPaymentDeadlineYmd: deadlines.initialPaymentDeadlineYmd,
        maxPeriodYmd: deadlines.maxPeriodYmd,
      },
      theCase.coveredPersonWorkerId,
      false,
    );

    // 2) Create the trust election representing the continued coverage.
    return ctx.storage.workerTrustElections.create(
      theCase.coveredPersonWorkerId,
      {
        employerId,
        policyId,
        startYmd: theCase.cobraEffectiveYmd,
        benefitIds: benefits.map((b) => b.benefitId),
        relationshipIds: selectedRelationIds(data),
        enrollmentType: "cobra",
        data: {
          signature: data.signature,
          wizardId: ctx.wizardId,
          source: WIZARD_TYPE,
          cobraCaseId: theCase.id,
          coveredLivesTier: pricing.tier,
          monthlyPremium: pricing.monthlyTotal,
          preFeeTotal: pricing.preFeeTotal,
          adminFee: pricing.adminFee,
          adminFeeRate: pricing.adminFeeRate,
        },
      },
    );
  });

  logger.info("COBRA election posted", {
    service: `${WIZARD_TYPE}-plugin`,
    wizardId: ctx.wizardId,
    caseId: theCase.id,
    workerId: theCase.coveredPersonWorkerId,
    electionId: election.id,
    tier: pricing.tier,
    monthlyPremium: pricing.monthlyTotal,
  });

  return {
    data: {
      electionId: election.id,
      postedAt: new Date().toISOString(),
      postedPricing: pricing,
    },
    status: "posted",
  };
}

const reviewStep: WizardStepHandler = {
  id: "review",
  name: "Review & Post",
  description: "Review the COBRA election, see the price, and post it",
  kind: "custom",
  component: "CobraReviewPostStep",
  getState: (wizard) =>
    wizard.status === "posted" ? "completed" : "in_progress",
  getData: async (ctx) => {
    const data = wizardData(ctx.wizard);
    return { pricing: await computePricing(ctx.storage, data) };
  },
  submit: submitReview,
};

/* ------------------------------------------------------------------ */
/* Plugin                                                              */
/* ------------------------------------------------------------------ */

export const baoCobraEnrollmentPlugin: WizardPlugin = {
  id: WIZARD_TYPE,
  name: "COBRA Election",
  description:
    "Elect COBRA continuation coverage on an open COBRA case: choose which lost coverage to continue (medical, dental, or both), who is covered, see the live monthly premium from the rate table, and sign. Posting records the election on the case (status moves to Pending First Payment) and creates the matching trust election.",
  requiredComponent: "sitespecific.bao",
  // No plugin-level policy: access is entity-scoped instead. The
  // `worker.cobra` policy grants staff OR the worker's own record, and only
  // while an open COBRA case exists — which is exactly the self-service
  // surface this wizard needs. `guardWorker` still enforces the electable
  // case server-side on create.
  entityType: "worker",
  entityAccessPolicy: "worker.cobra",
  category: "enrollment",
  // No launch inputs: the wizard is launched from the worker's COBRA
  // screen with the covered person as the wizard entity (`entityId`), which
  // `runEnrollmentCreate` falls back to when no workerId launch argument is
  // provided.
  create: (ctx) =>
    runEnrollmentCreate(ctx, {
      // Persist the covered worker as the wizard's entityId so the
      // worker.cobra entity-access checks apply to the saved instance.
      entityScoped: true,
      // Only offered when this person has an open, un-elected COBRA case
      // still inside its election window. Enforced server-side.
      guardWorker: async (storage, workerId) => {
        const cases =
          await storage.baoCobraCases.listActiveUnelectedCasesForCoveredPerson(
            workerId,
          );
        if (cases.length === 0) {
          return "This person has no open COBRA case awaiting an election.";
        }
        const today = todayYmd();
        const electable = cases.find(
          (c) => !c.lastDayToElectYmd || today <= c.lastDayToElectYmd,
        );
        if (!electable) {
          return "The COBRA election window has closed for this person's case.";
        }
        return null;
      },
      seed: async (storage, workerId) => {
        const cases =
          await storage.baoCobraCases.listActiveUnelectedCasesForCoveredPerson(
            workerId,
          );
        const today = todayYmd();
        const theCase = cases.find(
          (c) => !c.lastDayToElectYmd || today <= c.lastDayToElectYmd,
        );
        if (!theCase) return {};

        const coverageOptions: CoverageOption[] = [];
        if (theCase.medicalBenefitLostId) {
          const benefit = await storage.trustBenefits.getTrustBenefit(
            theCase.medicalBenefitLostId,
          );
          coverageOptions.push({
            kind: "medical",
            benefitId: theCase.medicalBenefitLostId,
            benefitName: benefit?.name || theCase.medicalBenefitLostId,
          });
        }
        if (theCase.dentalBenefitLostId) {
          const benefit = await storage.trustBenefits.getTrustBenefit(
            theCase.dentalBenefitLostId,
          );
          coverageOptions.push({
            kind: "dental",
            benefitId: theCase.dentalBenefitLostId,
            benefitName: benefit?.name || theCase.dentalBenefitLostId,
          });
        }

        // Every COBRA election is attached to the dedicated "COBRA"
        // employer + policy (never the worker's real employer — that
        // relationship ended). Get-or-created idempotently.
        const { employerId, policyId } =
          await resolveCobraEmployerPolicy(storage);

        const isSubscriberCase =
          theCase.coveredPersonWorkerId === theCase.subscriberWorkerId;

        return {
          caseId: theCase.id,
          caseSource: theCase.source,
          cobraEffectiveYmd: theCase.cobraEffectiveYmd,
          lastDayToElectYmd: theCase.lastDayToElectYmd,
          qualifyingEventId: theCase.qualifyingEventId ?? null,
          subscriberWorkerId: theCase.subscriberWorkerId,
          coveredPersonWorkerId: theCase.coveredPersonWorkerId,
          isSubscriberCase,
          coverageOptions,
          employerId,
          policyId,
        };
      },
    }),
  prepareUpdate: enrollmentPrepareUpdate,
  steps: [
    coverageStep,
    coveredPeopleStep,
    buildSignatureStep(WIZARD_TYPE),
    reviewStep,
  ],
};

registerWizardPlugin(baoCobraEnrollmentPlugin);
