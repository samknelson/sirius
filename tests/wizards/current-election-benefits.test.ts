import { beforeEach, describe, expect, it, vi } from "vitest";

const { evaluateBenefitEligibility } = vi.hoisted(() => ({
  evaluateBenefitEligibility: vi.fn(),
}));

vi.mock("../../server/trust/eligibility/executor", () => ({
  evaluateBenefitEligibility,
  pluginConfigToEligibilityRule: vi.fn(() => ({})),
}));

import { benefitElectionEnrollmentPlugin } from "../../server/plugins/wizards/plugins/benefit-election-enrollment";
import { openEnrollmentEnrollmentPlugin } from "../../server/plugins/wizards/plugins/open-enrollment-enrollment";
import type { WizardStepContext } from "../../server/plugins/wizards/types";

const benefits = [
  {
    id: "benefit-medical",
    name: "Medical",
    benefitType: null,
    benefitTypeName: null,
    benefitTypeSequence: null,
    benefitTypeOnlyOne: false,
    benefitTypeShowOnEnrollmentWizards: true,
  },
  {
    id: "benefit-dental",
    name: "Dental",
    benefitType: null,
    benefitTypeName: null,
    benefitTypeSequence: null,
    benefitTypeOnlyOne: false,
    benefitTypeShowOnEnrollmentWizards: true,
  },
];

function makeContext(currentElection: { benefitIds: string[] } | null) {
  const getActiveByWorker = vi.fn().mockResolvedValue(currentElection ?? undefined);
  const storage = {
    workers: { getWorker: vi.fn().mockResolvedValue({ id: "worker-1" }) },
    policies: {
      getPolicyById: vi.fn().mockResolvedValue({
        id: "policy-1",
        data: { benefitIds: benefits.map((benefit) => benefit.id) },
      }),
    },
    pluginConfigs: { search: vi.fn().mockResolvedValue([]) },
    trustBenefits: { getAllTrustBenefits: vi.fn().mockResolvedValue(benefits) },
    workerTrustElections: { getActiveByWorker },
  };
  const context = {
    wizard: {
      data: { workerId: "worker-1", policyId: "policy-1" },
    },
    storage,
  } as unknown as WizardStepContext;
  return { context, getActiveByWorker };
}

const enrollmentPlugins = [
  ["First-time Enrollment", benefitElectionEnrollmentPlugin],
  ["Open Enrollment", openEnrollmentEnrollmentPlugin],
] as const;

describe("enrollment wizard current-election benefit context", () => {
  beforeEach(() => {
    evaluateBenefitEligibility.mockResolvedValue({ eligible: true, results: [] });
  });

  it.each(enrollmentPlugins)(
    "%s returns current benefit IDs without changing the eligible choices",
    async (_name, plugin) => {
      const { context, getActiveByWorker } = makeContext({
        benefitIds: ["benefit-medical"],
      });
      const benefitsStep = plugin.steps?.find((step) => step.id === "benefits");
      expect(benefitsStep?.getData).toBeTypeOf("function");

      const result = await benefitsStep!.getData!(context);

      expect(getActiveByWorker).toHaveBeenCalledWith("worker-1");
      expect(result).toEqual({
        records: [
          expect.objectContaining({ benefitId: "benefit-medical", eligible: true }),
          expect.objectContaining({ benefitId: "benefit-dental", eligible: true }),
        ],
        currentlyElectedBenefitIds: ["benefit-medical"],
        ineligibleCount: 0,
      });
    },
  );

  it("returns no current election benefit IDs when the worker has no current election", async () => {
    const { context } = makeContext(null);
    const benefitsStep = benefitElectionEnrollmentPlugin.steps?.find(
      (step) => step.id === "benefits",
    );

    const result = await benefitsStep!.getData!(context);

    expect(result).toMatchObject({
      records: expect.arrayContaining([
        expect.objectContaining({ benefitId: "benefit-medical" }),
        expect.objectContaining({ benefitId: "benefit-dental" }),
      ]),
      currentlyElectedBenefitIds: [],
      ineligibleCount: 0,
    });
  });
});
