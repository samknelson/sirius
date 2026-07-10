import { registerWizardPlugin } from "../registry";
import type { WizardPlugin } from "../types";
import {
  createEnrollmentFoundation,
  computeDefaultEffectiveDate,
} from "../enrollment/foundation";

const WIZARD_TYPE = "benefit_election_enrollment";

// Re-exported for backward compatibility with any existing importer.
export { computeDefaultEffectiveDate };

/**
 * First-time enrollment.
 *
 * This is the reframed benefit-election wizard: it is only offered to a
 * worker who has NO active election covering a Medical or Dental benefit
 * (baseline AD&D/Life-only workers still qualify — those benefit types are
 * not Medical/Dental). The gate is enforced both on the launch button
 * (`GET /api/workers/:id/trust-elections/first-time-eligibility`) and here,
 * server-side, in the create hook via `guardWorker`.
 *
 * All of the step logic (employer/policy, eligible-benefit selection,
 * dependents, effective date, signature, review + election creation) lives
 * in the shared enrollment foundation so future Life Event and Open
 * Enrollment wizards reuse it. This wizard differs only in its display
 * metadata, its `enrollmentType: "first_time"` stamp, and its gate.
 */
const foundation = createEnrollmentFoundation({
  wizardType: WIZARD_TYPE,
  enrollmentType: "first_time",
  guardWorker: async (storage, workerId) => {
    const hasMedicalOrDental =
      await storage.workerTrustElections.hasActiveMedicalOrDentalElection(
        workerId,
      );
    return hasMedicalOrDental
      ? "This worker already has an active medical or dental election, so first-time enrollment is not available."
      : null;
  },
});

export const benefitElectionEnrollmentPlugin: WizardPlugin = {
  id: WIZARD_TYPE,
  name: "First-time Enrollment",
  description:
    "Enroll a worker in trust benefits for the first time: pick the employer/policy, select eligible benefits, add dependents with supporting documents, capture a signature, and post the election. Only available when the worker has no active medical or dental election.",
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
  create: foundation.create,
  prepareUpdate: foundation.prepareUpdate,
  steps: foundation.steps,
};

registerWizardPlugin(benefitElectionEnrollmentPlugin);
