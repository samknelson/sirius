import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const { stepData } = vi.hoisted(() => ({ stepData: { records: [], currentlyElectedBenefitIds: [] } as any }));

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: stepData, isLoading: false }),
  useMutation: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/lib/queryClient", () => ({
  apiRequest: vi.fn(),
  queryClient: { invalidateQueries: vi.fn() },
}));

import { BenefitsStep } from "@/components/wizards/framework/enrollment/BenefitsStep";

const availableBenefits = [
  {
    benefitId: "benefit-medical",
    benefitName: "Medical",
    benefitTypeId: null,
    benefitTypeName: null,
    benefitTypeSequence: null,
    benefitTypeOnlyOne: false,
    eligible: true,
    reasons: [],
  },
  {
    benefitId: "benefit-dental",
    benefitName: "Dental",
    benefitTypeId: null,
    benefitTypeName: null,
    benefitTypeSequence: null,
    benefitTypeOnlyOne: false,
    eligible: true,
    reasons: [],
  },
];

function renderBenefitStep(currentlyElectedBenefitIds: string[]) {
  stepData.records = availableBenefits;
  stepData.currentlyElectedBenefitIds = currentlyElectedBenefitIds;
  return renderToStaticMarkup(
    <BenefitsStep
      wizardId="wizard-1"
      wizardType="benefit_election_enrollment"
      step={{ id: "benefits" } as any}
      data={{ policyId: "policy-1", benefitIds: [] }}
    />,
  );
}

describe("BenefitsStep currently elected indicator", () => {
  it("marks only the offered benefit whose ID is in the current election", () => {
    const html = renderBenefitStep(["benefit-medical"]);

    expect(html).toContain('data-testid="badge-currently-elected-benefit-medical"');
    expect(html).toContain('aria-label="Currently elected"');
    expect(html).not.toContain('data-testid="badge-currently-elected-benefit-dental"');
    expect(html.match(/Currently elected/g)).toHaveLength(2);
    expect(html).toContain('data-testid="checkbox-benefit-benefit-medical"');
    expect(html).toContain('data-testid="checkbox-benefit-benefit-dental"');
  });

  it("shows the unchanged choices without a current election", () => {
    const html = renderBenefitStep([]);

    expect(html).not.toContain("Currently elected");
    expect(html).toContain("Medical");
    expect(html).toContain("Dental");
    expect(html).toContain("Eligible");
  });
});
