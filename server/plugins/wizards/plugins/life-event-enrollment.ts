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
  handleDependentsSubmit,
  buildEffectiveDateStep,
  buildSignatureStep,
  runEnrollmentCreate,
  enrollmentPrepareUpdate,
  type DependentEntry,
} from "../enrollment/foundation";
import { logger } from "../../../logger";

const WIZARD_TYPE = "life_event_enrollment";

/**
 * Life Event enrollment.
 *
 * A focused variant of the shared enrollment foundation for updating ONLY
 * the dependents on a worker's EXISTING active election. It is offered only
 * to a worker who already has an active election (the inverse of first-time
 * enrollment). A qualifying life event drives the change:
 *
 *   - birth / marriage  → ADD a dependent
 *   - divorce / death   → REMOVE an existing dependent
 *
 * The resulting election carries the worker's current employer, policy, and
 * benefits forward unchanged; only the relationship set is adjusted. It uses
 * the same 15th-of-month effective-date rule and signature capture as
 * first-time enrollment, and posts an election stamped
 * `enrollmentType: "life_event"`.
 *
 * The employer/policy and benefit-selection steps are intentionally absent
 * — those are carried forward from the active election, not re-chosen.
 */

type EventType = "birth" | "marriage" | "divorce" | "death";
type EventAction = "add" | "remove";

const EVENT_ACTION: Record<EventType, EventAction> = {
  birth: "add",
  marriage: "add",
  divorce: "remove",
  death: "remove",
};

interface CurrentRelationship {
  relationId: string;
  label: string;
}

function eventActionOf(data: Record<string, any>): EventAction | undefined {
  const type = data.eventType as EventType | undefined;
  return type ? EVENT_ACTION[type] : undefined;
}

/* ------------------------------------------------------------------ */
/* Step 1: event type                                                  */
/* ------------------------------------------------------------------ */

async function submitEventType(
  ctx: WizardStepContext,
): Promise<WizardStepResult> {
  assertDraft(ctx.wizard);
  const data = wizardData(ctx.wizard);
  const input = ctx.input as { eventType?: EventType };
  const eventType = input.eventType;
  if (!eventType || !(eventType in EVENT_ACTION)) {
    throw new Error(
      "Choose a life event: birth, marriage, divorce, or death",
    );
  }
  const eventAction = EVENT_ACTION[eventType];

  // Switching to a different event resets any staged dependent changes so
  // an add-then-switch-to-remove can't post a mix of both. Dependent worker
  // records already created stay on the worker (they are real records), the
  // same way a canceled first-time enrollment leaves added dependents behind.
  const changed = data.eventType && data.eventType !== eventType;
  return {
    data: {
      eventType,
      eventAction,
      ...(changed
        ? {
            dependents: [],
            removedRelationshipIds: [],
            pendingDocument: null,
            dependentLookup: null,
          }
        : {}),
    },
  };
}

const eventTypeStep: WizardStepHandler = {
  id: "event_type",
  name: "Life Event",
  description: "What happened?",
  kind: "form",
  schema: {
    type: "object",
    title: "Life Event",
    description:
      "Choose the life event driving this change. Birth and marriage add a dependent; divorce and death remove one.",
    properties: {
      eventType: {
        type: "string",
        title: "Life event",
        enum: ["birth", "marriage", "divorce", "death"],
        enumNames: [
          "Birth (add a dependent)",
          "Marriage (add a dependent)",
          "Divorce (remove a dependent)",
          "Death (remove a dependent)",
        ],
      },
    },
    required: ["eventType"],
  },
  getState: (wizard) => {
    const data = wizardData(wizard);
    if (data.eventType) return "completed";
    return wizard.currentStep === "event_type" ? "in_progress" : "pending";
  },
  submit: submitEventType,
};

/* ------------------------------------------------------------------ */
/* Step 2: dependents (add or remove, driven by the event)             */
/* ------------------------------------------------------------------ */

async function submitDependents(
  ctx: WizardStepContext,
): Promise<WizardStepResult> {
  assertDraft(ctx.wizard);
  const data = wizardData(ctx.wizard);
  const action = eventActionOf(data);
  if (!action) throw new Error("Choose a life event first");

  if (action === "add") {
    // Reuse the shared add-a-dependent flow verbatim (lookup → upload →
    // add → remove-added). It reads/writes data.dependents just as
    // first-time enrollment does.
    return handleDependentsSubmit(ctx, WIZARD_TYPE);
  }

  // Remove flow: mark/unmark one of the CURRENT relationships for removal.
  // Nothing is deleted — the relationship simply won't carry forward onto
  // the new election.
  const input = ctx.input as { action?: string; relationId?: string };
  const current: CurrentRelationship[] = Array.isArray(data.currentRelationships)
    ? data.currentRelationships
    : [];
  const currentIds = new Set(current.map((r) => r.relationId));
  const removed: string[] = Array.isArray(data.removedRelationshipIds)
    ? [...data.removedRelationshipIds]
    : [];

  if (input.action === "removeCurrent") {
    if (!input.relationId || !currentIds.has(input.relationId)) {
      throw new Error("That relationship is not on the current election");
    }
    if (!removed.includes(input.relationId)) removed.push(input.relationId);
    return { data: { removedRelationshipIds: removed } };
  }

  if (input.action === "restoreCurrent") {
    return {
      data: {
        removedRelationshipIds: removed.filter((id) => id !== input.relationId),
      },
    };
  }

  throw new Error("Unknown dependents action");
}

const dependentsStep: WizardStepHandler = {
  id: "dependents",
  name: "Dependents",
  description: "Add or remove the dependent affected by the life event",
  kind: "custom",
  component: "LifeEventDependentsStep",
  requiredComponent: "worker.relations",
  getState: (wizard) => {
    const data = wizardData(wizard);
    const action = eventActionOf(data);
    const done =
      action === "add"
        ? Array.isArray(data.dependents) && data.dependents.length > 0
        : action === "remove"
          ? Array.isArray(data.removedRelationshipIds) &&
            data.removedRelationshipIds.length > 0
          : false;
    if (done) return "completed";
    return wizard.currentStep === "dependents" ? "in_progress" : "pending";
  },
  submit: submitDependents,
};

/* ------------------------------------------------------------------ */
/* Step 5: review & post                                               */
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
  if (data.electionId) {
    throw new Error("This life event has already been posted");
  }
  if (!data.workerId) throw new Error("Missing worker");
  if (!data.employerId || !data.policyId) {
    throw new Error(
      "This worker's active election is missing an employer or policy",
    );
  }
  if (!data.startYmd) {
    throw new Error("Set the effective date before posting");
  }
  if (!data.signature) {
    throw new Error("The worker's signature is required before posting");
  }

  const action = eventActionOf(data);
  if (!action) throw new Error("Choose a life event before posting");

  const currentIds: string[] = Array.isArray(data.currentRelationshipIds)
    ? data.currentRelationshipIds
    : [];

  let relationshipIds: string[];
  if (action === "add") {
    const addedIds = ((data.dependents as DependentEntry[] | undefined) ?? []).map(
      (d) => d.relationId,
    );
    if (addedIds.length === 0) {
      throw new Error("Add the dependent before posting");
    }
    relationshipIds = [...currentIds, ...addedIds];
  } else {
    const removed: string[] = Array.isArray(data.removedRelationshipIds)
      ? data.removedRelationshipIds
      : [];
    if (removed.length === 0) {
      throw new Error("Select the dependent to remove before posting");
    }
    relationshipIds = currentIds.filter((id) => !removed.includes(id));
  }

  const benefitIds: string[] = Array.isArray(data.benefitIds)
    ? data.benefitIds
    : [];

  const election = await ctx.storage.workerTrustElections.create(
    data.workerId as string,
    {
      employerId: data.employerId,
      policyId: data.policyId,
      startYmd: data.startYmd,
      benefitIds,
      relationshipIds,
      enrollmentType: "life_event",
      data: {
        signature: data.signature,
        wizardId: ctx.wizardId,
        source: WIZARD_TYPE,
        eventType: data.eventType,
        sourceElectionId: data.sourceElectionId ?? null,
      },
    },
  );

  logger.info("Life event enrollment posted", {
    service: `${WIZARD_TYPE}-plugin`,
    wizardId: ctx.wizardId,
    workerId: data.workerId,
    electionId: election.id,
    eventType: data.eventType,
  });

  return {
    data: { electionId: election.id, postedAt: new Date().toISOString() },
    status: "posted",
  };
}

const reviewStep: WizardStepHandler = {
  id: "review",
  name: "Review & Post",
  description: "Review the change and post the updated election",
  kind: "custom",
  component: "LifeEventReviewPostStep",
  getState: (wizard) =>
    wizard.status === "posted" ? "completed" : "in_progress",
  submit: submitReview,
};

/* ------------------------------------------------------------------ */
/* Plugin                                                              */
/* ------------------------------------------------------------------ */

export const lifeEventEnrollmentPlugin: WizardPlugin = {
  id: WIZARD_TYPE,
  name: "Life Event",
  description:
    "Update the dependents on a worker's active trust election after a life event: birth or marriage adds a dependent, divorce or death removes one. The employer, policy, and benefits are carried forward from the current election. Only available when the worker has an active election.",
  requiredComponent: "trust.benefits",
  requiredPolicy: "staff",
  category: "enrollment",
  launchSchema: {
    type: "object",
    properties: {
      workerId: {
        type: "string",
        title: "Worker",
        description: "The worker whose election is changing",
      },
    },
    required: ["workerId"],
  },
  create: (ctx) =>
    runEnrollmentCreate(ctx, {
      // Life Event is only offered to workers who ALREADY have an active
      // election — the inverse of first-time enrollment. Enforced here,
      // server-side, not just behind a disabled launch button.
      guardWorker: async (storage, workerId) => {
        const active = await storage.workerTrustElections.getActiveByWorker(
          workerId,
        );
        return active
          ? null
          : "This worker has no active election, so a life event change cannot be made.";
      },
      // Carry the current election forward: employer, policy, benefits, and
      // the existing relationships (with labels for the remove UI).
      seed: async (storage, workerId) => {
        const view = await storage.workerTrustElections.getActiveViewByWorker(
          workerId,
        );
        if (!view) return {};
        return {
          sourceElectionId: view.id,
          employerId: view.employerId,
          employerName: view.employerName ?? null,
          policyId: view.policyId,
          policyName: view.policyName ?? null,
          benefitIds: view.benefitIds ?? [],
          benefitNames: (view.benefits ?? []).map((b) => b.name),
          currentRelationshipIds: view.relationshipIds ?? [],
          currentRelationships: (view.relationships ?? []).map((r) => ({
            relationId: r.id,
            label: r.label,
          })),
        };
      },
    }),
  prepareUpdate: enrollmentPrepareUpdate,
  steps: [
    eventTypeStep,
    dependentsStep,
    buildEffectiveDateStep(),
    buildSignatureStep(WIZARD_TYPE),
    reviewStep,
  ],
};

registerWizardPlugin(lifeEventEnrollmentPlugin);
