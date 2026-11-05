// Browser fixture resolves only the shipped components under test, avoiding
// loading every unrelated wizard plugin into the isolated test page.
import { BenefitsStep } from "@/components/wizards/framework/enrollment/BenefitsStep";
import { SignatureStep } from "@/components/wizards/framework/enrollment/SignatureStep";
import { DependentsStep } from "@/components/wizards/framework/enrollment/DependentsStep";
import { LifeEventDependentsStep } from "@/plugins/wizards/life_event_enrollment/LifeEventDependentsStep";

export const wizardComponentRegistry = {
  resolve(name: string) {
    if (name.endsWith(":BenefitsStep")) return BenefitsStep;
    if (name.endsWith(":SignatureStep")) return SignatureStep;
    if (name.endsWith(":DependentsStep")) return DependentsStep;
    if (name.endsWith(":LifeEventDependentsStep")) return LifeEventDependentsStep;
    // Navigation targets outside the changed steps are intentionally inert:
    // no final posting occurs in this browser fixture.
    return () => "Unchanged enrollment step";
  },
};
